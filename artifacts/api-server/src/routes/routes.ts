import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { upload } from "./upload";
import { registerTaskRoutes } from "./tasks";
import { registerAssetRoutes } from "./assets";
import { registerMapLayerRoutes } from "./mapLayers";
import { registerAssetTypeRoutes } from "./assetTypes";
import { registerOfflinePackRoutes } from "./offlinePacks";
import { registerHoaRoutes } from "./hoa";
import { registerPortfolioRoutes } from "./portfolio";
import { registerPortfolioWorkOrderRoutes } from "./portfolioWorkOrders";
import { registerInvoiceRoutes } from "./invoices";
import { registerReportRoutes } from "./reports";
import { registerContractRoutes } from "./contracts";
import { registerObjectRoutes } from "./objects";
import { registerDriveRoutes } from "./drive";
import { registerContactRoutes } from "./contacts";
import { registerCommunityRoutes } from "./communities";
import { registerDashboardRoutes } from "./dashboard";
import { registerSearchRoutes } from "./search";
import { registerCompanyRoutes } from "./companies";
import { registerUserRoutes } from "./users";
import { registerServiceScheduleRoutes } from "./serviceSchedules";
import { registerNotificationRoutes } from "./notifications";
import { registerPushRoutes } from "./push";
import { isUniqueViolation, pgErrorOf } from "./errors";
import * as policy from "../policy";
import { z } from "zod";
import { requireAuth, requireAdmin, enforceOrgScoping, registerAuthRoutes, enforceHoaScoping } from "../auth";
import { ObjectStorageService } from "../objectStorage";
import * as storage from "../storage";
import { getAssetTypeCache } from "../assetTypeCache";
import {
  insertTaskTemplateSchema, generateFromTemplateSchema, insertTaskScheduleSchema,
} from "@workspace/db";
import { runDueSchedules, computeInitialNextRunAt } from "../scheduler";
import { runExportGeneration } from "../exportGenerator";
import { parseFile, generatePreview, commitImport } from "../contractImporter";
import {
  parseMasterBill, previewMasterBill, commitMasterBill,
  type MasterBillParseResult, type MasterBillPreviewResult,
} from "../masterBillImporter";
import {
  parseSeasonal, previewSeasonal, commitSeasonal,
} from "../seasonalImporter";
import { normalizeAcknowledgedCodes } from "../importAcknowledgements";
import { db, pool } from "../db";
import { eq, and, desc, ne, inArray, isNull } from "drizzle-orm";
import { exportJobs as exportsTable, plannerRecords, xeriscapePackets, assets as assetsTable, assetProperties as assetPropertiesTable } from "@workspace/db";

export { PUSH_TOKEN_RATE_LIMIT_MS, pushTokenLastReg } from "./push";

// 60-second in-process cache for GET /api/admin/dashboard
let adminDashboardCache: { data: Awaited<ReturnType<typeof storage.getAdminDashboard>>; expiresAt: number } | null = null;

/** Convert a 0-based index to Excel-column-style letter key: 0→A, 25→Z, 26→AA, 27→AB … */
function nextControllerKey(n: number): string {
  let result = "";
  let i = n;
  do {
    result = String.fromCharCode(65 + (i % 26)) + result;
    i = Math.floor(i / 26) - 1;
  } while (i >= 0);
  return result;
}

export async function registerRoutes(app: Express): Promise<Server> {
  async function userCanAccessCommunity(user: NonNullable<Request["currentUser"]>, communityId: string): Promise<boolean> {
    return policy.canAccessCommunity(policy.actorFromUser(user), communityId);
  }

  registerAuthRoutes(app);

  app.use("/api", enforceHoaScoping);
  app.use("/api", enforceOrgScoping);

  registerObjectRoutes(app);

  registerCommunityRoutes(app);
  registerDashboardRoutes(app);

  registerTaskRoutes(app);

























  app.get("/api/admin/migrations", requireAdmin, async (_req: Request, res: Response) => {
    try {
      // 1. Read all hashes stored by Drizzle's migration tracker
      const dbResult = await pool.query<{ id: number; hash: string; created_at: string }>(
        "SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id"
      );
      const storedHashSet = new Set(dbResult.rows.map((r) => r.hash));

      // 2. Read the migration journal bundled into dist/migrations at build time
      const migrationsDir = path.join(__dirname, "./migrations");
      const journalPath = path.join(migrationsDir, "meta/_journal.json");
      let journal: { entries: Array<{ idx: number; tag: string; when: number }> };
      try {
        journal = JSON.parse(readFileSync(journalPath, "utf8"));
      } catch {
        return void res.status(500).json({ error: "Could not read migrations journal — dist/migrations may be missing" });
      }

      // 3. For each journal entry, compute the SHA-256 hash of the SQL file (same algorithm as Drizzle)
      //    and determine applied vs pending by hash-set lookup — not by row count or position.
      const available: string[] = journal.entries.map((e) => e.tag);
      const applied: Array<{ tag: string; hash: string }> = [];
      const pending: string[] = [];
      const journalHashSet = new Set<string>();

      for (const entry of journal.entries) {
        const sqlPath = path.join(migrationsDir, `${entry.tag}.sql`);
        let hash: string;
        try {
          const content = readFileSync(sqlPath, "utf8");
          hash = createHash("sha256").update(content).digest("hex");
        } catch {
          // SQL file missing from dist — treat as pending
          pending.push(entry.tag);
          continue;
        }
        journalHashSet.add(hash);
        if (storedHashSet.has(hash)) {
          applied.push({ tag: entry.tag, hash });
        } else {
          pending.push(entry.tag);
        }
      }

      // 4. Surface any DB rows whose hash does not match any journal entry (corruption / drift)
      const drift = dbResult.rows
        .filter((r) => !journalHashSet.has(r.hash))
        .map((r) => ({
          id: r.id,
          hash: r.hash,
          createdAt: new Date(Number(r.created_at)).toISOString(),
        }));

      const inSync = pending.length === 0 && drift.length === 0;

      res.json({ applied, available, pending, inSync, drift });
    } catch (error) {
      console.error("Migrations status error:", error);
      res.status(500).json({ error: "Failed to fetch migration status" });
    }
  });

  app.get("/api/admin/summary", requireAdmin, async (req: Request, res: Response) => {
    try {
      const communityId = req.query.communityId as string | undefined;
      const summary = await storage.getAdminSummary(communityId);
      res.json(summary);
    } catch (error) {
      console.error("Admin summary error:", error);
      res.status(500).json({ error: "Failed to fetch admin summary" });
    }
  });

  app.get("/api/admin/dashboard", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const now = Date.now();
      if (adminDashboardCache && adminDashboardCache.expiresAt > now) {
        return void res.json(adminDashboardCache.data);
      }
      const data = await storage.getAdminDashboard();
      adminDashboardCache = { data, expiresAt: now + 60_000 };
      res.json(data);
    } catch (error) {
      console.error("Admin dashboard error:", error);
      res.status(500).json({ error: "Failed to fetch admin dashboard" });
    }
  });

  app.get("/api/admin/completed-tasks", requireAdmin, async (req: Request, res: Response) => {
    try {
      const communityId = req.query.communityId as string;
      if (!communityId) {
        return void res.status(400).json({ error: "communityId is required" });
      }
      const completedTasks = await storage.getCompletedTasksWithDetails(communityId);
      res.json(completedTasks);
    } catch (error) {
      console.error("Get completed tasks error:", error);
      res.status(500).json({ error: "Failed to fetch completed tasks" });
    }
  });

  // ── Xeriscape Planning Records ─────────────────────────────────────────────
  app.get("/api/admin/xeriscape/records", requireAdmin, async (req: Request, res: Response) => {
    try {
      const propertyId = typeof req.query.propertyId === "string" ? req.query.propertyId.trim() : "";
      if (!propertyId) {
        return void res.status(400).json({ error: "propertyId query param is required" });
      }

      const community = await storage.getCommunityById(propertyId);
      if (!community) {
        return void res.status(404).json({ error: "Community not found" });
      }

      const records = await db
        .select()
        .from(plannerRecords)
        .where(eq(plannerRecords.propertyId, propertyId))
        .orderBy(desc(plannerRecords.updatedAt));
      res.json(records);
    } catch (error) {
      console.error("List planner records error:", error);
      res.status(500).json({ error: "Failed to fetch planner records" });
    }
  });

  app.post("/api/admin/xeriscape/records", requireAdmin, async (req: Request, res: Response) => {
    try {
      const {
        propertyId: rawPropertyId,
        recordName,
        internalNotes,
        assumptionsJson,
        groupsJson,
        totalSqft,
        totalEstimatedCost,
        totalAnnualSavings,
        paybackYears,
      } = req.body ?? {};

      const propertyId = typeof rawPropertyId === "string" ? rawPropertyId.trim() : "";
      if (!propertyId) {
        return void res.status(400).json({ error: "propertyId is required" });
      }

      const community = await storage.getCommunityById(propertyId);
      if (!community) {
        return void res.status(404).json({ error: "Community not found" });
      }

      if (!recordName || typeof recordName !== "string" || !recordName.trim()) {
        return void res.status(400).json({ error: "recordName is required" });
      }

      req.log.info({ communityId: community.id, propertyId: community.id }, "Create planner record");
      const [record] = await db
        .insert(plannerRecords)
        .values({
          propertyId,
          recordName: recordName.trim(),
          status: "draft",
          internalNotes: internalNotes || null,
          assumptionsJson: assumptionsJson || {},
          groupsJson: groupsJson || [],
          totalSqft: totalSqft || 0,
          totalEstimatedCost: totalEstimatedCost || 0,
          totalAnnualSavings: totalAnnualSavings || 0,
          paybackYears: paybackYears ?? null,
          createdBy: req.session.userId!,
        })
        .returning();

      res.status(201).json(record);
    } catch (error) {
      console.error("Create planner record error:", error);
      res.status(500).json({ error: "Failed to create planner record" });
    }
  });

  app.put("/api/admin/xeriscape/records/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const {
        recordName,
        internalNotes,
        assumptionsJson,
        groupsJson,
        totalSqft,
        totalEstimatedCost,
        totalAnnualSavings,
        paybackYears,
        status,
      } = req.body;

      const existing = await db
        .select()
        .from(plannerRecords)
        .where(eq(plannerRecords.id, id))
        .limit(1);

      if (existing.length === 0) {
        return void res.status(404).json({ error: "Record not found" });
      }

      const rec = existing[0];
      const community = await storage.getCommunityById(rec.propertyId);
      if (!community) {
        return void res.status(404).json({ error: "Community not found" });
      }

      req.log.info({ communityId: community.id, propertyId: community.id }, "Update planner record");

      const updateData: Record<string, any> = { updatedAt: new Date() };
      if (recordName !== undefined) updateData.recordName = recordName.trim();
      if (internalNotes !== undefined) updateData.internalNotes = internalNotes || null;
      if (assumptionsJson !== undefined) updateData.assumptionsJson = assumptionsJson;
      if (groupsJson !== undefined) updateData.groupsJson = groupsJson;
      if (totalSqft !== undefined) updateData.totalSqft = totalSqft;
      if (totalEstimatedCost !== undefined) updateData.totalEstimatedCost = totalEstimatedCost;
      if (totalAnnualSavings !== undefined) updateData.totalAnnualSavings = totalAnnualSavings;
      if (paybackYears !== undefined) updateData.paybackYears = paybackYears ?? null;
      if (status !== undefined) updateData.status = status;

      // If marking as selected_for_estimate, clear any previous selection for same property
      if (status === "selected_for_estimate") {
        await db
          .update(plannerRecords)
          .set({ status: "reviewed", updatedAt: new Date() })
          .where(
            and(
              eq(plannerRecords.propertyId, rec.propertyId),
              eq(plannerRecords.status, "selected_for_estimate"),
              ne(plannerRecords.id, id)
            )
          );
      }

      const [updated] = await db
        .update(plannerRecords)
        .set(updateData)
        .where(eq(plannerRecords.id, id))
        .returning();

      res.json(updated);
    } catch (error) {
      console.error("Update planner record error:", error);
      res.status(500).json({ error: "Failed to update planner record" });
    }
  });

  app.post("/api/admin/xeriscape/records/:id/duplicate", requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;

      const existing = await db
        .select()
        .from(plannerRecords)
        .where(eq(plannerRecords.id, id))
        .limit(1);

      if (existing.length === 0) {
        return void res.status(404).json({ error: "Record not found" });
      }

      const src = existing[0];
      const community = await storage.getCommunityById(src.propertyId);
      if (!community) {
        return void res.status(404).json({ error: "Community not found" });
      }

      req.log.info({ communityId: community.id, propertyId: community.id }, "Duplicate planner record");
      const [copy] = await db
        .insert(plannerRecords)
        .values({
          propertyId: src.propertyId,
          recordName: src.recordName + " (Copy)",
          status: "draft",
          internalNotes: src.internalNotes,
          assumptionsJson: src.assumptionsJson as any,
          groupsJson: src.groupsJson as any,
          totalSqft: src.totalSqft,
          totalEstimatedCost: src.totalEstimatedCost,
          totalAnnualSavings: src.totalAnnualSavings,
          paybackYears: src.paybackYears,
          createdBy: req.session.userId!,
        })
        .returning();

      res.status(201).json(copy);
    } catch (error) {
      console.error("Duplicate planner record error:", error);
      res.status(500).json({ error: "Failed to duplicate planner record" });
    }
  });

  app.delete("/api/admin/xeriscape/records/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;

      const existing = await db
        .select()
        .from(plannerRecords)
        .where(eq(plannerRecords.id, id))
        .limit(1);

      if (existing.length === 0) {
        return void res.status(404).json({ error: "Record not found" });
      }

      const community = await storage.getCommunityById(existing[0].propertyId);
      if (!community) {
        return void res.status(404).json({ error: "Community not found" });
      }

      if (existing[0].status !== "draft") {
        return void res.status(400).json({ error: "Only draft records can be permanently deleted" });
      }

      req.log.info({ communityId: community.id, propertyId: community.id }, "Delete planner record");
      await db.delete(plannerRecords).where(eq(plannerRecords.id, id));
      res.json({ message: "Record deleted" });
    } catch (error) {
      console.error("Delete planner record error:", error);
      res.status(500).json({ error: "Failed to delete planner record" });
    }
  });

  // ── Xeriscape Community Polygons ────────────────────────────────────────────
  app.get("/api/admin/xeriscape/community/:communityId/polygons", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { communityId } = req.params as { communityId: string };
      const resolved = await storage.getXeriscapeCommunityPolygons(communityId);
      if (!resolved) {
        return void res.json({ type: "FeatureCollection", features: [], assetsFound: 0, featuresResolved: 0 });
      }

      req.log.info({ communityId, assetsFound: resolved.assetsFound }, "xeriscape polygons: bluegrass assets found");
      for (const asset of resolved.unresolved) {
        req.log.warn(asset, "xeriscape polygons: asset could not be resolved");
      }
      req.log.info(
        { communityId, assetsFound: resolved.assetsFound, featuresResolved: resolved.featuresResolved, skipped: resolved.unresolved.length },
        "xeriscape polygons: resolution complete"
      );

      // Keep the established admin envelope and feature payload unchanged.
      const features = resolved.features.map((feature) => ({
        type: "Feature" as const,
        id: feature.id,
        geometry: feature.geometry,
        properties: {
          id: feature.properties.id,
          name: feature.properties.name,
          area_sqft: feature.properties.area_sqft,
          featureRef: feature.properties.featureRef,
        },
      }));
      return void res.json({
        type: "FeatureCollection",
        features,
        assetsFound: resolved.assetsFound,
        featuresResolved: resolved.featuresResolved,
      });
    } catch (error) {
      req.log.error({ err: error }, "xeriscape community polygons error");
      res.status(500).json({ error: "Failed to load community xeriscape polygons" });
    }
  });

  // ── Xeriscape Packet CRUD ───────────────────────────────────────────────────
  app.get("/api/admin/xeriscape/records/:recordId/packets", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { recordId } = req.params as { recordId: string };
      const packets = await db
        .select()
        .from(xeriscapePackets)
        .where(eq(xeriscapePackets.plannerRecordId, recordId))
        .orderBy(desc(xeriscapePackets.generatedAt));
      res.json(packets);
    } catch (error) {
      console.error("List packets error:", error);
      res.status(500).json({ error: "Failed to fetch packets" });
    }
  });

  app.post("/api/admin/xeriscape/records/:recordId/packets", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { recordId } = req.params as { recordId: string };
      const { packetTitle, packetSummaryText, narrativeIntro, narrativeRecommendation, narrativeNextSteps } = req.body;

      if (!packetTitle || typeof packetTitle !== "string" || !packetTitle.trim()) {
        return void res.status(400).json({ error: "packetTitle is required" });
      }

      // Verify the planning record exists and is in a reviewable state
      const existing = await db
        .select()
        .from(plannerRecords)
        .where(eq(plannerRecords.id, recordId))
        .limit(1);

      if (existing.length === 0) {
        return void res.status(404).json({ error: "Planning record not found" });
      }

      const record = existing[0];
      if (record.status !== "reviewed" && record.status !== "selected_for_estimate") {
        return void res.status(400).json({ error: "Packet can only be created for reviewed or selected_for_estimate records" });
      }

      // Supersede any existing active packets for this record
      await db
        .update(xeriscapePackets)
        .set({ packetStatus: "superseded", updatedAt: new Date() })
        .where(
          and(
            eq(xeriscapePackets.plannerRecordId, recordId),
            eq(xeriscapePackets.packetStatus, "active_proposal_support")
          )
        );

      const [packet] = await db
        .insert(xeriscapePackets)
        .values({
          plannerRecordId: recordId,
          packetTitle: packetTitle.trim(),
          packetSummaryText: packetSummaryText || null,
          narrativeIntro: narrativeIntro || null,
          narrativeRecommendation: narrativeRecommendation || null,
          narrativeNextSteps: narrativeNextSteps || null,
          packetStatus: "active_proposal_support",
          generatedBy: req.session.userId!,
        })
        .returning();

      res.status(201).json(packet);
    } catch (error) {
      console.error("Create packet error:", error);
      res.status(500).json({ error: "Failed to create packet" });
    }
  });

  app.put("/api/admin/xeriscape/records/:recordId/packets/:packetId", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { recordId, packetId } = req.params as { recordId: string; packetId: string };
      const { packetTitle, packetSummaryText, narrativeIntro, narrativeRecommendation, narrativeNextSteps, packetStatus } = req.body;

      const existing = await db
        .select()
        .from(xeriscapePackets)
        .where(and(eq(xeriscapePackets.id, packetId), eq(xeriscapePackets.plannerRecordId, recordId)))
        .limit(1);

      if (existing.length === 0) {
        return void res.status(404).json({ error: "Packet not found" });
      }

      const updateData: Record<string, any> = { updatedAt: new Date() };
      if (packetTitle !== undefined) updateData.packetTitle = packetTitle.trim();
      if (packetSummaryText !== undefined) updateData.packetSummaryText = packetSummaryText || null;
      if (narrativeIntro !== undefined) updateData.narrativeIntro = narrativeIntro || null;
      if (narrativeRecommendation !== undefined) updateData.narrativeRecommendation = narrativeRecommendation || null;
      if (narrativeNextSteps !== undefined) updateData.narrativeNextSteps = narrativeNextSteps || null;
      if (packetStatus !== undefined) updateData.packetStatus = packetStatus;

      const [updated] = await db
        .update(xeriscapePackets)
        .set(updateData)
        .where(eq(xeriscapePackets.id, packetId))
        .returning();

      res.json(updated);
    } catch (error) {
      console.error("Update packet error:", error);
      res.status(500).json({ error: "Failed to update packet" });
    }
  });

  registerCompanyRoutes(app);
  registerUserRoutes(app);

  app.get("/api/ping", (_req: Request, res: Response) => {
    res.json({ ok: true, ts: Date.now() });
  });

  registerPushRoutes(app);

  registerAssetRoutes(app);

  registerMapLayerRoutes(app);

  registerSearchRoutes(app);

  // ── Asset Types catalogue (data-driven) ──────────────────────────────────

  registerAssetTypeRoutes(app);
  registerOfflinePackRoutes(app);

  // Task Templates CRUD
  app.get("/api/task-templates", requireAdmin, async (req: Request, res: Response) => {
    try {
      const communityType = req.query.communityType as 'hoa' | 'commercial' | undefined;
      const templates = await storage.getTaskTemplates(communityType);
      res.json(templates);
    } catch (error) {
      console.error("Get task templates error:", error);
      res.status(500).json({ error: "Failed to fetch task templates" });
    }
  });

  app.post("/api/task-templates", requireAdmin, async (req: Request, res: Response) => {
    try {
      const parsed = insertTaskTemplateSchema.safeParse(req.body);
      if (!parsed.success) {
        return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      }
      const template = await storage.createTaskTemplate({
        ...parsed.data,
        description: parsed.data.description ?? null,
        dueDaysOffset: parsed.data.dueDaysOffset ?? null,
        targetAssetType: parsed.data.targetAssetType ?? null,
        targetMapLayerId: parsed.data.targetMapLayerId ?? null,
        targetAssetId: parsed.data.targetAssetId ?? null,
        createdBy: req.session.userId!,
      });
      res.status(201).json(template);
    } catch (error) {
      console.error("Create task template error:", error);
      res.status(500).json({ error: "Failed to create task template" });
    }
  });

  app.patch("/api/task-templates/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const parsed = insertTaskTemplateSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      }
      const updated = await storage.updateTaskTemplate(req.params.id as string, parsed.data);
      if (!updated) return void res.status(404).json({ error: "Template not found" });
      res.json(updated);
    } catch (error) {
      console.error("Update task template error:", error);
      res.status(500).json({ error: "Failed to update task template" });
    }
  });

  app.delete("/api/task-templates/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      await storage.deleteTaskTemplate(req.params.id as string);
      res.json({ message: "Template deleted" });
    } catch (error) {
      console.error("Delete task template error:", error);
      res.status(500).json({ error: "Failed to delete task template" });
    }
  });

  // Template preview — returns count of tasks that would be generated
  app.post("/api/task-templates/:id/preview", requireAdmin, async (req: Request, res: Response) => {
    try {
      const template = await storage.getTaskTemplateById(req.params.id as string);
      if (!template) return void res.status(404).json({ error: "Template not found" });

      const parsed = generateFromTemplateSchema.safeParse(req.body);
      if (!parsed.success) return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

      const { communityId, includeArchivedAssets, limit: assetLimit } = parsed.data;

      if (template.targetType === 'none') {
        return void res.json({ taskCount: 1, assets: [] });
      }

      const targetAssets = await storage.getTargetAssets(
        communityId, template.targetType, template.targetAssetType,
        template.targetMapLayerId, template.targetAssetId,
        includeArchivedAssets, assetLimit,
      );

      res.json({
        taskCount: targetAssets.length,
        assets: targetAssets.slice(0, 10).map(a => ({ id: a.id, label: a.label, assetType: a.assetType })),
      });
    } catch (error) {
      console.error("Template preview error:", error);
      res.status(500).json({ error: "Failed to preview template" });
    }
  });

  // Generate tasks from template
  app.post("/api/task-templates/:id/generate", requireAdmin, async (req: Request, res: Response) => {
    try {
      const template = await storage.getTaskTemplateById(req.params.id as string);
      if (!template) return void res.status(404).json({ error: "Template not found" });

      const parsed = generateFromTemplateSchema.safeParse(req.body);
      if (!parsed.success) return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

      const { communityId, dueDate: dueDateStr, assignToUserId, includeArchivedAssets, limit: assetLimit } = parsed.data;

      // Enforce template scope against community type
      if (template.scope !== 'all') {
        const community = await storage.getCommunityById(communityId);
        if (!community) return void res.status(404).json({ error: "Community not found" });
        const communityType = community.organizationId ? 'commercial' : 'hoa';
        if (template.scope !== communityType) {
          return void res.status(400).json({
            error: `This template is scoped to ${template.scope} clients only and cannot be used with this ${communityType} community.`,
          });
        }
      }

      let dueDate: Date | undefined;
      if (dueDateStr) {
        dueDate = new Date(dueDateStr);
      } else if (template.dueDaysOffset != null) {
        dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + template.dueDaysOffset);
      }

      const createdTasks: any[] = [];

      if (template.targetType === 'none') {
        const task = await storage.createTask({
          communityId,
          title: template.title,
          description: template.description || undefined,
          priority: template.priority,
          assignedTo: assignToUserId,
          createdBy: req.session.userId!,
          dueDate,
        });
        createdTasks.push(task);
      } else {
        const targetAssets = await storage.getTargetAssets(
          communityId, template.targetType, template.targetAssetType,
          template.targetMapLayerId, template.targetAssetId,
          includeArchivedAssets, assetLimit,
        );

        for (const asset of targetAssets) {
          const task = await storage.createTask({
            communityId,
            title: `${template.title} — ${asset.label || asset.featureRef || asset.id.substring(0, 8)}`,
            description: template.description || undefined,
            priority: template.priority,
            latitude: asset.latitude ?? undefined,
            longitude: asset.longitude ?? undefined,
            assignedTo: assignToUserId,
            createdBy: req.session.userId!,
            dueDate,
          });

          await storage.setTaskLink(task.id, {
            linkType: 'asset',
            assetId: asset.id,
          });

          createdTasks.push(task);
        }
      }

      const run = await storage.createTemplateRun({
        templateId: template.id,
        communityId,
        createdBy: req.session.userId!,
        taskCountCreated: createdTasks.length,
        assignmentUserId: assignToUserId || null,
      });

      res.status(201).json({
        runId: run.id,
        createdCount: createdTasks.length,
        skippedCount: 0,
        sample: createdTasks.slice(0, 5).map(t => ({ id: t.id, title: t.title, status: t.status })),
      });
    } catch (error) {
      console.error("Generate from template error:", error);
      res.status(500).json({ error: "Failed to generate tasks from template" });
    }
  });

  // Bulk assign tasks


  // CSV Task Import


  // Task Schedules CRUD
  app.get("/api/task-schedules", requireAdmin, async (req: Request, res: Response) => {
    try {
      const communityId = req.query.communityId as string | undefined;
      const schedules = await storage.getTaskSchedules(communityId);
      res.json(schedules);
    } catch (error) {
      console.error("Get schedules error:", error);
      res.status(500).json({ error: "Failed to fetch schedules" });
    }
  });

  app.post("/api/task-schedules", requireAdmin, async (req: Request, res: Response) => {
    try {
      const parsed = insertTaskScheduleSchema.safeParse(req.body);
      if (!parsed.success) {
        return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      }
      const { communityId, templateId, frequency, daysOfWeek, dayOfMonth, timezone, startDate: startDateStr, endDate: endDateStr, assignToUserId, isEnabled } = parsed.data;

      // Enforce template scope against community type
      const [schedCommunity, schedTemplate] = await Promise.all([
        storage.getCommunityById(communityId),
        storage.getTaskTemplateById(templateId),
      ]);
      if (!schedCommunity) return void res.status(404).json({ error: "Community not found" });
      if (!schedTemplate) return void res.status(404).json({ error: "Template not found" });
      if (schedTemplate.scope !== 'all') {
        const communityType = schedCommunity.organizationId ? 'commercial' : 'hoa';
        if (schedTemplate.scope !== communityType) {
          return void res.status(400).json({
            error: `This template is scoped to ${schedTemplate.scope} clients only and cannot be scheduled for this ${communityType} community.`,
          });
        }
      }

      const startDate = new Date(startDateStr);
      const endDate = endDateStr ? new Date(endDateStr) : null;

      const nextRunAt = computeInitialNextRunAt(
        frequency, daysOfWeek ?? null, dayOfMonth ?? null, startDate, endDate
      );

      const schedule = await storage.createTaskSchedule({
        communityId,
        templateId,
        frequency,
        daysOfWeek: daysOfWeek ?? null,
        dayOfMonth: dayOfMonth ?? null,
        timezone,
        startDate,
        endDate,
        nextRunAt,
        assignToUserId: assignToUserId ?? null,
        isEnabled,
        createdBy: req.session.userId!,
      });
      res.status(201).json(schedule);
    } catch (error) {
      console.error("Create schedule error:", error);
      res.status(500).json({ error: "Failed to create schedule" });
    }
  });

  app.patch("/api/task-schedules/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const existing = await storage.getTaskScheduleById(req.params.id as string);
      if (!existing) return void res.status(404).json({ error: "Schedule not found" });

      const parsed = insertTaskScheduleSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      }

      const updates: any = {};
      if (parsed.data.frequency !== undefined) updates.frequency = parsed.data.frequency;
      if (parsed.data.daysOfWeek !== undefined) updates.daysOfWeek = parsed.data.daysOfWeek ?? null;
      if (parsed.data.dayOfMonth !== undefined) updates.dayOfMonth = parsed.data.dayOfMonth ?? null;
      if (parsed.data.timezone !== undefined) updates.timezone = parsed.data.timezone;
      if (parsed.data.startDate !== undefined) updates.startDate = new Date(parsed.data.startDate);
      if (parsed.data.endDate !== undefined) updates.endDate = parsed.data.endDate ? new Date(parsed.data.endDate) : null;
      if (parsed.data.assignToUserId !== undefined) updates.assignToUserId = parsed.data.assignToUserId ?? null;
      if (parsed.data.isEnabled !== undefined) updates.isEnabled = parsed.data.isEnabled;

      const freq = updates.frequency || existing.frequency;
      const dow = updates.daysOfWeek !== undefined ? updates.daysOfWeek : existing.daysOfWeek;
      const dom = updates.dayOfMonth !== undefined ? updates.dayOfMonth : existing.dayOfMonth;
      const sd = updates.startDate || existing.startDate;
      const ed = updates.endDate !== undefined ? updates.endDate : existing.endDate;

      updates.nextRunAt = computeInitialNextRunAt(freq, dow, dom, sd, ed);

      const updated = await storage.updateTaskSchedule(req.params.id as string, updates);
      res.json(updated);
    } catch (error) {
      console.error("Update schedule error:", error);
      res.status(500).json({ error: "Failed to update schedule" });
    }
  });

  app.delete("/api/task-schedules/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      await storage.deleteTaskSchedule(req.params.id as string);
      res.json({ message: "Schedule deleted" });
    } catch (error) {
      console.error("Delete schedule error:", error);
      res.status(500).json({ error: "Failed to delete schedule" });
    }
  });

  app.get("/api/task-schedules/:id/runs", requireAdmin, async (req: Request, res: Response) => {
    try {
      const runs = await storage.getScheduleRuns(req.params.id as string);
      res.json(runs);
    } catch (error) {
      console.error("Get schedule runs error:", error);
      res.status(500).json({ error: "Failed to fetch schedule runs" });
    }
  });

  app.post("/api/task-schedules/run-now", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const reports = await runDueSchedules();
      res.json({
        processed: reports.length,
        reports,
      });
    } catch (error) {
      console.error("Run now error:", error);
      res.status(500).json({ error: "Failed to run schedules" });
    }
  });

  // ── Export endpoints ──

  app.post("/api/exports/proof-of-work", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { communityId, dateFrom, dateTo, assetType, contractorId, status, includePhotosZip } = req.body;
      if (!communityId || !dateFrom || !dateTo) {
        return void res.status(400).json({ error: "communityId, dateFrom, and dateTo are required" });
      }

      const filters = {
        communityId,
        dateFrom,
        dateTo,
        assetType: assetType || undefined,
        contractorId: contractorId || undefined,
        status: status || "completed",
        includePhotosZip: !!includePhotosZip,
      };

      const [exportRow] = await db
        .insert(exportsTable)
        .values({
          communityId,
          createdBy: req.session.userId!,
          type: "proof_of_work",
          status: "queued",
          filters,
        })
        .returning();

      runExportGeneration(exportRow.id).catch((err) =>
        console.error("Background export failed:", err)
      );

      res.json({ exportId: exportRow.id });
    } catch (error) {
      console.error("Create export error:", error);
      res.status(500).json({ error: "Failed to create export" });
    }
  });

  app.get("/api/exports", requireAdmin, async (req: Request, res: Response) => {
    try {
      const communityId = req.query.communityId as string | undefined;
      const conditions = communityId
        ? [eq(exportsTable.communityId, communityId)]
        : [];

      const rows = await db
        .select({
          id: exportsTable.id,
          communityId: exportsTable.communityId,
          createdBy: exportsTable.createdBy,
          type: exportsTable.type,
          status: exportsTable.status,
          filters: exportsTable.filters,
          pdfFileRef: exportsTable.pdfFileRef,
          photosZipRef: exportsTable.photosZipRef,
          createdAt: exportsTable.createdAt,
          completedAt: exportsTable.completedAt,
          errorMessage: exportsTable.errorMessage,
        })
        .from(exportsTable)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(exportsTable.createdAt))
        .limit(50);

      res.json(rows);
    } catch (error) {
      console.error("List exports error:", error);
      res.status(500).json({ error: "Failed to list exports" });
    }
  });

  app.get("/api/exports/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const [exportRow] = await db
        .select()
        .from(exportsTable)
        .where(eq(exportsTable.id, req.params.id as string));

      if (!exportRow) {
        return void res.status(404).json({ error: "Export not found" });
      }

      res.json(exportRow);
    } catch (error) {
      console.error("Get export error:", error);
      res.status(500).json({ error: "Failed to fetch export" });
    }
  });

  app.get("/api/exports/:id/download/pdf", requireAdmin, async (req: Request, res: Response) => {
    try {
      const [exportRow] = await db
        .select()
        .from(exportsTable)
        .where(eq(exportsTable.id, req.params.id as string));

      if (!exportRow || !exportRow.pdfFileRef) {
        return void res.status(404).json({ error: "PDF not found" });
      }

      const objectStorageService = new ObjectStorageService();
      const objectFile = await objectStorageService.getObjectEntityFile(exportRow.pdfFileRef);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="proof_of_work_${exportRow.id}.pdf"`);
      const stream = objectFile.createReadStream();
      stream.pipe(res);
    } catch (error) {
      console.error("Download PDF error:", error);
      res.status(500).json({ error: "Failed to download PDF" });
    }
  });

  app.get("/api/exports/:id/download/zip", requireAdmin, async (req: Request, res: Response) => {
    try {
      const [exportRow] = await db
        .select()
        .from(exportsTable)
        .where(eq(exportsTable.id, req.params.id as string));

      if (!exportRow || !exportRow.photosZipRef) {
        return void res.status(404).json({ error: "ZIP not found" });
      }

      const objectStorageService = new ObjectStorageService();
      const objectFile = await objectStorageService.getObjectEntityFile(exportRow.photosZipRef);
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="photos_${exportRow.id}.zip"`);
      const stream = objectFile.createReadStream();
      stream.pipe(res);
    } catch (error) {
      console.error("Download ZIP error:", error);
      res.status(500).json({ error: "Failed to download ZIP" });
    }
  });

  registerServiceScheduleRoutes(app);

  // ── Master Bill import routes ────────────────────────────────────────────

  app.post("/api/admin/import/master-bill/parse", requireAdmin, upload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) return void res.status(400).json({ error: "No file uploaded" });
      const batchLabel = (req.body?.batchLabel ?? "").trim();
      if (!batchLabel) return void res.status(400).json({ error: "batchLabel is required" });
      const result = parseMasterBill(req.file.buffer, batchLabel);
      res.json(result);
    } catch (error: any) {
      console.error("Master-bill parse error:", error);
      res.status(400).json({ error: error.message || "Failed to parse file" });
    }
  });

  app.post("/api/admin/import/master-bill/preview", requireAdmin, async (req: Request, res: Response) => {
    try {
      const parsed: MasterBillParseResult = req.body;
      if (!parsed?.batchLabel || !parsed?.rows) {
        return void res.status(400).json({ error: "Missing parsed data — run /parse first" });
      }
      const result = await previewMasterBill(parsed, pool);
      res.json(result);
    } catch (error: any) {
      console.error("Master-bill preview error:", error);
      res.status(500).json({ error: error.message || "Failed to generate preview" });
    }
  });

  app.post("/api/admin/import/master-bill/commit", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { parsed, preview, acknowledgedCodes }: {
        parsed: MasterBillParseResult;
        preview: MasterBillPreviewResult;
        acknowledgedCodes?: string[];
      } = req.body;
      if (!parsed?.batchLabel || !preview) {
        return void res.status(400).json({ error: "Missing parsed or preview data" });
      }
      const codes = normalizeAcknowledgedCodes(acknowledgedCodes);
      const result = await commitMasterBill(parsed, preview, pool, req.session.userId!, codes);
      res.json(result);
    } catch (error: any) {
      console.error("Master-bill commit error:", error);
      // Validation failures (bad/absent acknowledgements) carry their own
      // status; anything else is a genuine server error.
      const status = typeof error?.statusCode === "number" ? error.statusCode : 500;
      res.status(status).json({ error: error.message || "Failed to commit import" });
    }
  });

  // ── Seasonal import routes ───────────────────────────────────────────────

  app.post("/api/admin/import/seasonal/parse", requireAdmin, upload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) return void res.status(400).json({ error: "No file uploaded" });
      const result = parseSeasonal(req.file.buffer, req.file.originalname);
      res.json(result);
    } catch (error: any) {
      console.error("Seasonal parse error:", error);
      res.status(400).json({ error: error.message || "Failed to parse file" });
    }
  });

  app.post("/api/admin/import/seasonal/preview", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { allRows }: { allRows: Record<string, any>[] } = req.body;
      if (!allRows || !Array.isArray(allRows)) {
        return void res.status(400).json({ error: "Missing allRows in request body" });
      }
      const result = await previewSeasonal(allRows, pool);
      res.json(result);
    } catch (error: any) {
      console.error("Seasonal preview error:", error);
      res.status(500).json({ error: error.message || "Failed to generate preview" });
    }
  });

  app.post("/api/admin/import/seasonal/commit", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { allRows, acknowledgedCodes }: {
        allRows: Record<string, any>[];
        acknowledgedCodes?: string[];
      } = req.body;
      if (!allRows || !Array.isArray(allRows)) {
        return void res.status(400).json({ error: "Missing allRows in request body" });
      }
      const codes  = normalizeAcknowledgedCodes(acknowledgedCodes);
      const result = await commitSeasonal(allRows, pool, req.session.userId!, codes);
      res.json(result);
    } catch (error: any) {
      console.error("Seasonal commit error:", error);
      // Acknowledgement failures are caller-correctable and carry their own
      // status; anything else is a genuine server error.
      const status = typeof error?.statusCode === "number" ? error.statusCode : 500;
      res.status(status).json({ error: error.message || "Failed to commit seasonal import" });
    }
  });

  // ── Import batch history ─────────────────────────────────────────────────

  app.get("/api/admin/import/batches", requireAdmin, async (req: Request, res: Response) => {
    try {
      const result = await pool.query<{
        id: string; mode: string; batch_label: string; run_by: string | null;
        run_at: string; invoice_count: number | null; task_count: number | null;
        completion_count: number | null; schedule_count: number | null;
        visit_count: number | null; runner_name: string | null;
      }>(
        `SELECT b.id, b.mode, b.batch_label, b.run_by, b.run_at,
                b.invoice_count, b.task_count, b.completion_count,
                b.schedule_count, b.visit_count,
                u.display_name AS runner_name
           FROM import_batches b
           LEFT JOIN users u ON u.id = b.run_by
          ORDER BY b.run_at DESC`,
      );
      res.json(result.rows);
    } catch (error: any) {
      console.error("Import batches list error:", error);
      res.status(500).json({ error: error.message || "Failed to fetch import batches" });
    }
  });

  app.delete("/api/admin/import/batches/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const batchRow = await pool.query<{
        id: string; mode: string; batch_label: string;
      }>(
        `SELECT id, mode, batch_label FROM import_batches WHERE id = $1`,
        [id],
      );
      if (batchRow.rows.length === 0) {
        return void res.status(404).json({ error: "Batch not found" });
      }
      const batch = batchRow.rows[0]!;

      let invoicesDeleted = 0;
      let tasksDeleted    = 0;
      let visitsDeleted   = 0;

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        if (batch.mode === "master_bill") {
          const invResult = await client.query(
            `DELETE FROM invoices WHERE source_batch = $1`,
            [batch.batch_label],
          );
          invoicesDeleted = invResult.rowCount ?? 0;

          const taskResult = await client.query(
            `DELETE FROM tasks
              WHERE origin = 'master_bill_import'
                AND import_fingerprint LIKE $1`,
            [`${batch.batch_label}:%`],
          );
          tasksDeleted = taskResult.rowCount ?? 0;
        } else if (batch.mode === "seasonal") {
          // 1. Delete task completions scoped to this batch (cascade would handle it, but be explicit)
          await client.query(
            `DELETE FROM task_completions
              WHERE task_id IN (
                SELECT id FROM tasks
                 WHERE import_fingerprint = $1
                   AND origin = 'contract_schedule'
              )`,
            [id],
          );

          // 2. Delete tasks scoped to this batch only — never touches other orgs
          const taskResult = await client.query(
            `DELETE FROM tasks
              WHERE import_fingerprint = $1
                AND origin = 'contract_schedule'`,
            [id],
          );
          tasksDeleted = taskResult.rowCount ?? 0;

          // 3. Delete service_visits that were inserted by this batch.
          //    Each newly-inserted visit carries notes = 'batch:{id}', covering
          //    both new schedules and pre-existing (reused) schedules alike.
          const visitResult = await client.query(
            `DELETE FROM service_visits WHERE notes = $1`,
            [`batch:${id}`],
          );
          visitsDeleted = visitResult.rowCount ?? 0;

          // 4. Delete service_schedules created by this batch — but only if they
          //    have no visits outside this batch. A schedule reused by a later
          //    batch will have visits with different (or null) notes; retain it.
          await client.query(
            `DELETE FROM service_schedules
              WHERE notes LIKE $1
                AND NOT EXISTS (
                  SELECT 1 FROM service_visits sv
                   WHERE sv.schedule_id = service_schedules.id
                     AND (sv.notes IS NULL OR sv.notes != $2)
                )`,
            [`%batch:${id}%`, `batch:${id}`],
          );
        }

        await client.query(`DELETE FROM import_batches WHERE id = $1`, [id]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }

      res.json({ id, invoicesDeleted, tasksDeleted, visitsDeleted });
    } catch (error: any) {
      console.error("Import batch delete error:", error);
      res.status(500).json({ error: error.message || "Failed to undo batch" });
    }
  });

  // ── Contract-tasks import routes (unchanged) ─────────────────────────────

  app.post("/api/admin/import/contract-tasks/parse", requireAdmin, upload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return void res.status(400).json({ error: "No file uploaded" });
      }
      const sheetName = req.body?.sheetName || undefined;
      const result = parseFile(req.file.buffer, req.file.originalname, sheetName);
      res.json(result);
    } catch (error: any) {
      console.error("Parse error:", error);
      res.status(400).json({ error: error.message || "Failed to parse file" });
    }
  });

  app.post("/api/admin/import/contract-tasks/preview", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { communityId, mappings, mowingConfig, defaultPriority, importMode, parsedData } = req.body;
      if (!communityId || !mappings || !mowingConfig || !parsedData) {
        return void res.status(400).json({ error: "Missing required fields" });
      }
      if (!mappings.title || !mappings.windowStart || !mappings.windowEnd) {
        return void res.status(400).json({ error: "Title, Window Start, and Window End mappings are required" });
      }
      const result = await generatePreview(
        parsedData,
        communityId,
        mappings,
        mowingConfig,
        defaultPriority || "medium",
        importMode || "create"
      );
      res.json(result);
    } catch (error: any) {
      console.error("Preview error:", error);
      res.status(500).json({ error: error.message || "Failed to generate preview" });
    }
  });

  app.post("/api/admin/import/contract-tasks/commit", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { communityId, tasksPreview, mowingSchedulePreview, defaultPriority } = req.body;
      if (!communityId || !tasksPreview) {
        return void res.status(400).json({ error: "Missing required fields" });
      }
      const result = await commitImport(
        tasksPreview,
        mowingSchedulePreview || null,
        communityId,
        req.session.userId!,
        defaultPriority || "medium"
      );
      res.json(result);
    } catch (error: any) {
      console.error("Commit error:", error);
      res.status(500).json({ error: error.message || "Failed to commit import" });
    }
  });

  registerHoaRoutes(app);

  registerNotificationRoutes(app);

  registerInvoiceRoutes(app);
  registerReportRoutes(app);
  registerContractRoutes(app);

  registerDriveRoutes(app);
  registerContactRoutes(app);

  registerPortfolioRoutes(app);
  registerPortfolioWorkOrderRoutes(app);

  // ── Admin: Organization provisioning routes ───────────────────────────────

  app.post("/api/admin/organizations", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { name, kind, contactName, contactEmail } = req.body;
      if (!name || typeof name !== "string" || name.trim().length === 0) {
        return void res.status(400).json({ error: "name is required" });
      }
      const org = await storage.createOrganization({
        name: name.trim(),
        kind: kind ?? "commercial",
        contactName: contactName ?? null,
        contactEmail: contactEmail ?? null,
      });
      res.status(201).json(org);
    } catch (error) {
      console.error("Create organization error:", error);
      res.status(500).json({ error: "Failed to create organization" });
    }
  });

  app.get("/api/admin/organizations", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const orgs = await storage.listOrganizations();
      res.json(orgs);
    } catch (error) {
      console.error("List organizations error:", error);
      res.status(500).json({ error: "Failed to list organizations" });
    }
  });

  app.get("/api/admin/organizations/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const org = await storage.getOrganizationById(req.params.id as string);
      if (!org) return void res.status(404).json({ error: "Organization not found" });
      res.json(org);
    } catch (error) {
      console.error("Get organization error:", error);
      res.status(500).json({ error: "Failed to get organization" });
    }
  });

  app.patch("/api/admin/organizations/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { name, kind, contactName, contactEmail } = req.body;
      const updates: Record<string, unknown> = {};
      if (name !== undefined) updates.name = name;
      if (kind !== undefined) updates.kind = kind;
      if (contactName !== undefined) updates.contactName = contactName;
      if (contactEmail !== undefined) updates.contactEmail = contactEmail;
      const org = await storage.updateOrganization(req.params.id as string, updates as any);
      if (!org) return void res.status(404).json({ error: "Organization not found" });
      res.json(org);
    } catch (error) {
      console.error("Update organization error:", error);
      res.status(500).json({ error: "Failed to update organization" });
    }
  });

  app.delete("/api/admin/organizations/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const hasBranches = await storage.orgHasBranches(id);
      if (hasBranches) {
        return void res.status(409).json({ error: "Organization still has branches — reassign or delete them first" });
      }
      const deleted = await storage.deleteOrganization(id);
      if (!deleted) return void res.status(404).json({ error: "Organization not found" });
      res.status(204).send();
    } catch (error) {
      console.error("Delete organization error:", error);
      res.status(500).json({ error: "Failed to delete organization" });
    }
  });

  app.get("/api/admin/organizations/:id/portfolio", requireAdmin, async (req: Request, res: Response) => {
    try {
      const portfolio = await storage.getPortfolioForOrg(req.params.id as string);
      if (!portfolio) return void res.status(404).json({ error: "Organization not found" });
      res.json(portfolio);
    } catch (error) {
      console.error("Admin portfolio error:", error);
      res.status(500).json({ error: "Failed to fetch portfolio" });
    }
  });

  // ── Admin: Branch (community) routes ──────────────────────────────────────

  app.get("/api/admin/organizations/:id/branches", requireAdmin, async (req: Request, res: Response) => {
    try {
      const branches = await storage.listBranchesByOrg(req.params.id as string);
      res.json(branches);
    } catch (error) {
      console.error("List branches error:", error);
      res.status(500).json({ error: "Failed to list branches" });
    }
  });

  app.post("/api/admin/organizations/:id/branches", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { name, code, address, city, description } = req.body;
      if (!name || typeof name !== "string" || name.trim().length === 0) {
        return void res.status(400).json({ error: "name is required" });
      }
      if (!code || typeof code !== "string" || code.trim().length === 0) {
        return void res.status(400).json({ error: "code is required" });
      }
      const orgId = req.params.id as string;
      const org = await storage.getOrganizationById(orgId);
      if (!org) return void res.status(404).json({ error: "Organization not found" });

      try {
        const branch = await storage.createBranch({
          organizationId: orgId,
          name: name.trim(),
          code: code.trim(),
          address: address ?? undefined,
          city: city ?? undefined,
          description: description ?? undefined,
        });
        res.status(201).json(branch);
      } catch (err: any) {
        // Catch unique constraint on (organization_id, code)
        if (err?.code === "23505" || err?.message?.includes("duplicate")) {
          return void res.status(409).json({ error: `A branch with code '${code}' already exists in this organization` });
        }
        throw err;
      }
    } catch (error) {
      if ((error as any)?.statusCode === 409) return void res.status(409).json(error);
      console.error("Create branch error:", error);
      res.status(500).json({ error: "Failed to create branch" });
    }
  });

  app.delete("/api/admin/branches/:communityId", requireAdmin, async (req: Request, res: Response) => {
    try {
      const result = await storage.deleteBranch(req.params.communityId as string);
      if (result.notABranch) return void res.status(403).json({ error: "Not an organization branch" });
      if (result.conflict) return void res.status(409).json({ error: result.conflict });
      if (!result.deleted) return void res.status(404).json({ error: "Branch not found" });
      res.status(204).send();
    } catch (error) {
      console.error("Delete branch error:", error);
      res.status(500).json({ error: "Failed to delete branch" });
    }
  });

  app.patch("/api/admin/branches/:communityId", requireAdmin, async (req: Request, res: Response) => {
    try {
      // Guard: only allow editing organization-owned branches, not HOA communities
      const orgId = await storage.getBranchOrgId(req.params.communityId as string);
      if (orgId === undefined) return void res.status(404).json({ error: "Branch not found" });
      if (orgId === null) return void res.status(403).json({ error: "Not an organization branch" });

      const { code, address, city, name, description } = req.body;
      const updates: Record<string, unknown> = {};
      if (code !== undefined) updates.code = code;
      if (address !== undefined) updates.address = address;
      if (city !== undefined) updates.city = city;
      if (name !== undefined) updates.name = name;
      if (description !== undefined) updates.description = description;
      try {
        const branch = await storage.updateBranch(req.params.communityId as string, updates as any);
        if (!branch) return void res.status(404).json({ error: "Branch not found" });
        res.json(branch);
      } catch (err: any) {
        if (err?.code === "23505" || err?.message?.includes("duplicate")) {
          return void res.status(409).json({ error: `A branch with code '${code}' already exists in this organization` });
        }
        throw err;
      }
    } catch (error) {
      console.error("Update branch error:", error);
      res.status(500).json({ error: "Failed to update branch" });
    }
  });

  // ── Admin: Branch group routes ────────────────────────────────────────────

  app.get("/api/admin/organizations/:id/groups", requireAdmin, async (req: Request, res: Response) => {
    try {
      const groups = await storage.listBranchGroupsWithMembers(req.params.id as string);
      res.json(groups);
    } catch (error) {
      console.error("List branch groups error:", error);
      res.status(500).json({ error: "Failed to list branch groups" });
    }
  });

  app.post("/api/admin/organizations/:id/groups", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { name, color, sortOrder } = req.body;
      if (!name || typeof name !== "string" || name.trim().length === 0) {
        return void res.status(400).json({ error: "name is required" });
      }
      const orgId = req.params.id as string;
      const org = await storage.getOrganizationById(orgId);
      if (!org) return void res.status(404).json({ error: "Organization not found" });
      const group = await storage.createBranchGroup(orgId, {
        name: name.trim(),
        color: color ?? undefined,
        sortOrder: sortOrder ?? 0,
      });
      res.status(201).json(group);
    } catch (error) {
      console.error("Create branch group error:", error);
      res.status(500).json({ error: "Failed to create branch group" });
    }
  });

  app.patch("/api/admin/groups/:groupId", requireAdmin, async (req: Request, res: Response) => {
    const groupId = req.params.groupId as string;
    try {
      const { name, color, sortOrder, setId } = req.body;
      const updates: Record<string, unknown> = {};
      if (name !== undefined) updates.name = name;
      if (color !== undefined) updates.color = color;
      if (sortOrder !== undefined) updates.sortOrder = sortOrder;
      if (setId !== undefined) updates.setId = setId; // a set id, or null to unassign
      const group = await storage.updateBranchGroup(groupId, updates as any);
      if (!group) return void res.status(404).json({ error: "Branch group not found" });
      return void res.json(group);
    } catch (error) {
      // Moving a group into a set fires the propagate trigger on member rows;
      // if any member already belongs to another group of that set, the
      // one-per-set index rejects it. Explain which group and how many
      // locations conflict instead of surfacing a 500.
      if (isUniqueViolation(error, "branch_group_members_one_per_set_idx") && req.body?.setId) {
        let conflictMsg = "Some locations in this group already belong to another group in that set. Move them or choose a different set.";
        try {
          const { rows } = await pool.query<{ group_name: string; set_name: string; cnt: string }>(
            `SELECT bg.name AS group_name, s.name AS set_name, COUNT(DISTINCT me.community_id) AS cnt
               FROM branch_group_members me
               JOIN branch_group_members other
                 ON other.community_id = me.community_id AND other.group_id <> me.group_id
               JOIN branch_groups bg ON bg.id = other.group_id AND bg.set_id = $2
               JOIN branch_group_sets s ON s.id = $2
              WHERE me.group_id = $1
              GROUP BY bg.name, s.name
              ORDER BY cnt DESC
              LIMIT 1`,
            [groupId, req.body.setId],
          );
          if (rows[0]) {
            const n = Number(rows[0].cnt);
            conflictMsg = `${n} location${n === 1 ? "" : "s"} in this group already belong${n === 1 ? "s" : ""} to ${rows[0].group_name} in the ${rows[0].set_name} set. Move them or choose a different set.`;
          }
        } catch { /* best-effort lookup only */ }
        return void res.status(409).json({ error: conflictMsg });
      }
      console.error("Update branch group error:", error);
      return void res.status(500).json({ error: "Failed to update branch group" });
    }
  });

  app.delete("/api/admin/groups/:groupId", requireAdmin, async (req: Request, res: Response) => {
    try {
      const deleted = await storage.deleteBranchGroup(req.params.groupId as string);
      if (!deleted) return void res.status(404).json({ error: "Branch group not found" });
      return void res.status(204).send();
    } catch (error) {
      console.error("Delete branch group error:", error);
      return void res.status(500).json({ error: "Failed to delete branch group" });
    }
  });

  app.put("/api/admin/groups/:groupId/members", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { communityIds } = req.body;
      if (!Array.isArray(communityIds)) {
        return void res.status(400).json({ error: "communityIds must be an array" });
      }
      await storage.setBranchGroupMembers(req.params.groupId as string, communityIds as string[]);
      return void res.json({ ok: true });
    } catch (error) {
      // One-group-per-set violation: move semantics in setBranchGroupMembers
      // should prevent this, but if a case is ever missed the admin gets a
      // real explanation, not a generic 500.
      if (isUniqueViolation(error, "branch_group_members_one_per_set_idx")) {
        const pg = pgErrorOf(error);
        // detail looks like: Key (community_id, set_id)=(abc, def) already exists.
        const detailMatch = /\(community_id, set_id\)=\(([^,]+), ([^)]+)\)/.exec(pg?.detail ?? "");
        let conflictMsg = "This location already belongs to another group in the same group set.";
        if (detailMatch) {
          try {
            const { rows } = await pool.query<{ group_name: string }>(
              `SELECT bg.name AS group_name
                 FROM branch_group_members bgm
                 JOIN branch_groups bg ON bg.id = bgm.group_id
                WHERE bgm.community_id = $1 AND bgm.set_id = $2
                LIMIT 1`,
              [detailMatch[1], detailMatch[2]],
            );
            if (rows[0]) conflictMsg = `This location already belongs to "${rows[0].group_name}" in the same group set. A location can only be in one group per set.`;
          } catch { /* best-effort lookup only */ }
        }
        return void res.status(409).json({ error: conflictMsg });
      }
      console.error("Set branch group members error:", error);
      return void res.status(500).json({ error: "Failed to set branch group members" });
    }
  });

  // ── Admin: Branch group set routes ────────────────────────────────────────

  app.get("/api/admin/organizations/:id/group-sets", requireAdmin, async (req: Request, res: Response) => {
    try {
      const sets = await storage.getGroupSets(req.params.id as string);
      res.json(sets);
    } catch (error) {
      console.error("List group sets error:", error);
      res.status(500).json({ error: "Failed to list group sets" });
    }
  });

  app.post("/api/admin/organizations/:id/group-sets", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { name, sortOrder } = req.body;
      if (!name || typeof name !== "string" || name.trim().length === 0) {
        return void res.status(400).json({ error: "name is required" });
      }
      const orgId = req.params.id as string;
      const org = await storage.getOrganizationById(orgId);
      if (!org) return void res.status(404).json({ error: "Organization not found" });
      const set = await storage.createGroupSet(orgId, {
        name: name.trim(),
        sortOrder: sortOrder ?? 0,
      });
      res.status(201).json(set);
    } catch (error) {
      if (isUniqueViolation(error, "branch_group_sets_org_name_unique")) {
        return void res.status(409).json({ error: `A group set named "${String(req.body?.name).trim()}" already exists in this organization.` });
      }
      console.error("Create group set error:", error);
      res.status(500).json({ error: "Failed to create group set" });
    }
  });

  app.patch("/api/admin/group-sets/:setId", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { name, sortOrder } = req.body;
      const updates: Record<string, unknown> = {};
      if (name !== undefined) {
        if (typeof name !== "string" || name.trim().length === 0) {
          return void res.status(400).json({ error: "name must be a non-empty string" });
        }
        updates.name = name.trim();
      }
      if (sortOrder !== undefined) updates.sortOrder = sortOrder;
      const set = await storage.updateGroupSet(req.params.setId as string, updates as any);
      if (!set) return void res.status(404).json({ error: "Group set not found" });
      return void res.json(set);
    } catch (error) {
      if (isUniqueViolation(error, "branch_group_sets_org_name_unique")) {
        return void res.status(409).json({ error: `A group set named "${String(req.body?.name).trim()}" already exists in this organization.` });
      }
      console.error("Update group set error:", error);
      return void res.status(500).json({ error: "Failed to update group set" });
    }
  });

  app.delete("/api/admin/group-sets/:setId", requireAdmin, async (req: Request, res: Response) => {
    try {
      // ON DELETE SET NULL nulls branch_groups.set_id; that referential-action
      // UPDATE fires the propagate trigger, which nulls member rows' set_id.
      const deleted = await storage.deleteGroupSet(req.params.setId as string);
      if (!deleted) return void res.status(404).json({ error: "Group set not found" });
      return void res.status(204).send();
    } catch (error) {
      console.error("Delete group set error:", error);
      return void res.status(500).json({ error: "Failed to delete group set" });
    }
  });

  // ── Admin: Organization users ─────────────────────────────────────────────

  app.get("/api/admin/organizations/:id/users", requireAdmin, async (req: Request, res: Response) => {
    try {
      const orgId = req.params.id as string;
      const users = await storage.getClientUsersByOrg(orgId);
      res.json(users);
    } catch (error) {
      console.error("List org users error:", error);
      res.status(500).json({ error: "Failed to list organization users" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
