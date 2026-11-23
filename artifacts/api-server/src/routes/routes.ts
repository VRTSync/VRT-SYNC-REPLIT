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
import { isUniqueViolation, pgErrorOf } from "./errors";
import * as policy from "../policy";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { requireAuth, requireAdmin, requireAdminOrMapCreator, enforceOrgScoping, registerAuthRoutes, enforceHoaScoping, isHoaRole, isMapCreatorRole, isClientRole, isContractorSide } from "../auth";
import { ObjectStorageService } from "../objectStorage";
import * as storage from "../storage";
import { sendDueReminders } from "../pushNotifications";
import { getMissingRequiredKeys } from "../assetSync";
import { getAssetTypeCache } from "../assetTypeCache";
import {
  insertCommunitySchema, registerPushTokenSchema,
  insertTaskTemplateSchema, generateFromTemplateSchema, insertTaskScheduleSchema,
  insertServiceScheduleSchema, updateServiceScheduleSchema, logServiceVisitSchema,
  userRoleEnum,
  normalizeCompanyName,
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

export const PUSH_TOKEN_RATE_LIMIT_MS = 86_400_000; // 24 hours
export const pushTokenLastReg = new Map<string, { ts: number; token: string }>();

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

async function checkHoaLimits(communityId: string, role: string, excludeUserId?: string): Promise<string | null> {
  const count = await storage.getHoaUserCountByCommunity(communityId, role, excludeUserId);
  if (role === 'hoa_admin' && count >= 1) {
    return 'This community already has an HOA Admin (limit: 1)';
  }
  if (role === 'hoa_member' && count >= 4) {
    return 'This community already has 4 HOA Members (limit: 4)';
  }
  return null;
}

/** Return the specified public validation error without changing access rules. */
async function companySelectionError(role: string, companyId: unknown): Promise<string | null> {
  if (role === "contractor_manager" && !companyId) return "Account managers must have a contractor company";
  if (companyId === undefined || companyId === null) return null;
  if (!isContractorSide(role) && role !== "property_manager") return "Only contractors and property managers can have a company";
  if (typeof companyId !== "string" || !companyId) return "Company not found";
  const company = await storage.getCompanyById(companyId);
  if (!company?.isActive) return "Company not found";
  if (company.kind !== (isContractorSide(role) ? "contractor" : "management_company")) return "Company type does not match the user's role";
  return null;
}

function companyUniqueConflict(error: any): boolean {
  return error?.code === "23505" || error?.cause?.code === "23505";
}

export async function registerRoutes(app: Express): Promise<Server> {
  async function userCanAccessCommunity(user: NonNullable<Request["currentUser"]>, communityId: string): Promise<boolean> {
    return policy.canAccessCommunity(policy.actorFromUser(user), communityId);
  }

  registerAuthRoutes(app);

  app.use("/api", enforceHoaScoping);
  app.use("/api", enforceOrgScoping);

  registerObjectRoutes(app);

  app.get("/api/communities", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (user?.role === "admin" || user?.role === "map_creator") {
        // Admins and map creators see all communities, including commercial branches
        const allCommunities = await storage.getCommunities();
        return void res.json(allCommunities);
      }
      if (isHoaRole(user?.role || '') && user?.hoaCommunityId) {
        const community = await storage.getCommunityById(user.hoaCommunityId);
        return void res.json(community ? [community] : []);
      }
      // For property_manager, contractor, and other non-admin/non-HOA roles:
      // exclude commercial branches (communities with an organizationId)
      const memberships = await storage.getUserCommunities(req.session.userId!);
      const nonCommercial = memberships
        .map((m) => m.community)
        .filter((c) => !c.organizationId);
      res.json(nonCommercial);
    } catch (error) {
      console.error("Get communities error:", error);
      res.status(500).json({ error: "Failed to fetch communities" });
    }
  });

  app.post("/api/communities", requireAdminOrMapCreator, async (req: Request, res: Response) => {
    try {
      const parsed = insertCommunitySchema.safeParse(req.body);
      if (!parsed.success) {
        return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      }
      const community = await storage.createCommunity({
        name: parsed.data.name,
        description: parsed.data.description ?? undefined,
      });
      const currentUser = (req as any).currentUser;
      if (currentUser && isMapCreatorRole(currentUser.role)) {
        await storage.addCommunityMember(community.id, currentUser.id);
      }
      res.status(201).json(community);
    } catch (error) {
      req.log.error({ error }, "Create community error");
      res.status(500).json({ error: "Failed to create community" });
    }
  });

  app.patch("/api/communities/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { name, description } = req.body;
      const id = req.params.id as string;
      const community = await storage.updateCommunity(id, { name, description });
      if (!community) {
        return void res.status(404).json({ error: "Community not found" });
      }
      res.json(community);
    } catch (error) {
      console.error("Update community error:", error);
      res.status(500).json({ error: "Failed to update community" });
    }
  });

  app.get("/api/communities/:id/bounds", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!(await userCanAccessCommunity(req.currentUser!, req.params.id as string))) {
        return void res.status(403).json({ error: "You do not have access to this community" });
      }
      const bounds = await storage.getCommunityBounds(req.params.id as string);
      res.json(bounds);
    } catch (error) {
      console.error("Get community bounds error:", error);
      res.status(500).json({ error: "Failed to compute community bounds" });
    }
  });

  app.get("/api/communities/:id/crew", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.currentUser!;
      if (!["admin", "contractor_manager"].includes(user.role)) return void res.status(403).json({ error: "Access denied" });
      if (user.role === "contractor_manager" &&
          (!user.companyId || !await storage.isUserMemberOfCommunity(user.id, req.params.id as string))) {
        return void res.status(403).json({ error: "Access denied" });
      }
      const companyId = user.role === "admin" ? req.query.companyId : user.companyId;
      if (typeof companyId !== "string" || !companyId) return void res.status(400).json({ error: "companyId is required" });
      res.json(await storage.getCompanyCrew(req.params.id as string, companyId));
    } catch (error) {
      req.log.error({ error }, "Get crew error");
      res.status(500).json({ error: "Failed to fetch crew" });
    }
  });

  app.get("/api/communities/:id/members", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!(await userCanAccessCommunity(req.currentUser!, req.params.id as string))) {
        return void res.status(403).json({ error: "You do not have access to this community" });
      }
      const members = await storage.getCommunityMembers(req.params.id as string);
      res.json(members.map((m) => ({
        id: m.id,
        userId: m.userId,
        displayName: m.user.displayName,
        ...(req.currentUser!.role === "admin" ? { username: m.user.username } : {}),
        ...(["admin", "property_manager"].includes(req.currentUser!.role) ? { companyName: m.companyName ?? null } : {}),
        role: m.user.role,
        joinedAt: m.joinedAt,
      })));
    } catch (error) {
      console.error("Get members error:", error);
      res.status(500).json({ error: "Failed to fetch members" });
    }
  });

  app.post("/api/communities/:id/members", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { userId, userIds, companyId } = req.body;
      let ids: string[];
      if (companyId !== undefined) {
        const company = typeof companyId === "string" ? await storage.getCompanyById(companyId) : undefined;
        if (!company) {
          return void res.status(404).json({ error: "Company not found" });
        }
        if (!company.isActive) return void res.status(400).json({ error: "Company not found" });
        ids = await storage.getCompanyUserIds(companyId);
      } else {
        ids = userIds || (userId ? [userId] : []);
      }
      if (companyId !== undefined && ids.length === 0) return void res.status(201).json({ added: 0, skipped: 0 });
      if (ids.length === 0) {
        return void res.status(400).json({ error: "userId or userIds[] is required" });
      }
      const result = await storage.addCommunityMembers(req.params.id as string, ids);
      res.status(201).json(result);
    } catch (error) {
      console.error("Add member error:", error);
      res.status(500).json({ error: "Failed to add member" });
    }
  });

  app.delete("/api/communities/:id/members/:userId", requireAdmin, async (req: Request, res: Response) => {
    try {
      await storage.removeCommunityMember(req.params.id as string, req.params.userId as string);
      res.json({ message: "Member removed" });
    } catch (error) {
      console.error("Remove member error:", error);
      res.status(500).json({ error: "Failed to remove member" });
    }
  });

  app.delete("/api/communities/:id/companies/:companyId", requireAdmin, async (req: Request, res: Response) => {
    try {
      if (!(await storage.getCompanyById(req.params.companyId as string))) {
        return void res.status(404).json({ error: "Company not found" });
      }
      res.json(await storage.removeCompanyCommunityMembers(req.params.id as string, req.params.companyId as string));
    } catch (error) {
      console.error("Remove company members error:", error);
      res.status(500).json({ error: "Failed to remove company members" });
    }
  });

  app.get("/api/communities/:id/controllers", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return void res.status(401).json({ error: "User not found" });
      const communityId = req.params.id as string;
      if (user.role !== "admin") {
        const isMember = await storage.isUserMemberOfCommunity(user.id, communityId);
        if (!isMember) return void res.status(403).json({ error: "You are not a member of this community" });
      }

      const controllerAssets = await storage.getAssetsByCommunitySorted(communityId, "controller");
      const zoneAssets = await storage.getAssetsByCommunitySorted(communityId, "zone");

      const controllerIds = controllerAssets.map(a => a.id);
      const zoneIds = zoneAssets.map(a => a.id);
      const allIds = [...controllerIds, ...zoneIds];

      let allProps: { assetId: string; key: string; value: string }[] = [];
      if (allIds.length > 0) {
        allProps = await storage.getAssetPropertiesBulk(allIds);
      }

      const propsMap = new Map<string, Record<string, string>>();
      for (const p of allProps) {
        if (!propsMap.has(p.assetId)) propsMap.set(p.assetId, {});
        propsMap.get(p.assetId)![p.key] = p.value;
      }

      const zonesByController = new Map<string, typeof zoneAssets>();
      for (const zone of zoneAssets) {
        if (zone.isArchived) continue;
        const zProps = propsMap.get(zone.id) || {};
        const ctrlRef = zProps.controllerFeatureRef;
        if (ctrlRef) {
          if (!zonesByController.has(ctrlRef)) zonesByController.set(ctrlRef, []);
          zonesByController.get(ctrlRef)!.push(zone);
        }
      }

      const result = controllerAssets
        .filter(c => !c.isArchived)
        .map(c => {
          const cProps = propsMap.get(c.id) || {};
          const zones = zonesByController.get(c.featureRef || "") || [];
          return {
            id: c.id,
            label: c.label,
            featureRef: c.featureRef,
            controllerKey: cProps.controllerKey || "",
            controllerColor: cProps.controllerColor || "#999999",
            latitude: c.latitude,
            longitude: c.longitude,
            zoneCount: zones.length,
            zones: zones.map(z => {
              const zProps = propsMap.get(z.id) || {};
              return {
                id: z.id,
                label: z.label,
                featureRef: z.featureRef,
                zoneNumber: zProps.zoneNumber ? parseInt(zProps.zoneNumber) : null,
                zoneType: zProps.zoneType || null,
                zoneLabelShort: zProps.zoneLabelShort || null,
                zoneColor: zProps.zoneColor || null,
                valveBoxRef: zProps.valveBoxRef || null,
                valveBoxLabel: zProps.valveBoxLabel || null,
                latitude: z.latitude,
                longitude: z.longitude,
              };
            }).sort((a, b) => (a.zoneNumber || 999) - (b.zoneNumber || 999)),
          };
        })
        .sort((a, b) => a.controllerKey.localeCompare(b.controllerKey));

      res.json(result);
    } catch (error) {
      console.error("Get controllers error:", error);
      res.status(500).json({ error: "Failed to fetch controllers" });
    }
  });

  app.get("/api/dashboard", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return void res.status(401).json({ error: "User not found" });
      const communityId = req.query.communityId as string;
      if (!communityId) return void res.status(400).json({ error: "communityId is required" });
      if (user.role !== "admin") {
        const isMember = await storage.isUserMemberOfCommunity(user.id, communityId);
        if (!isMember) return void res.status(403).json({ error: "You are not a member of this community" });
      }
      const data = await storage.getDashboardData(user.id, communityId, user.role === "admin");
      res.json(storage.toTaskResponse(data, user));
    } catch (error) {
      console.error("Dashboard error:", error);
      res.status(500).json({ error: "Failed to fetch dashboard data" });
    }
  });

  app.get("/api/dashboard/role", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return void res.status(401).json({ error: "User not found" });

      let communityId: string | undefined;

      if (isHoaRole(user.role)) {
        if (!user.hoaCommunityId) {
          return void res.status(403).json({ error: "HOA user is not assigned to a community" });
        }
        communityId = user.hoaCommunityId;
      } else {
        communityId = req.query.communityId as string | undefined;
      }

      if (!communityId) {
        return void res.status(400).json({ error: "communityId is required" });
      }

      if (user.role !== "admin" && !isHoaRole(user.role)) {
        const isMember = await storage.isUserMemberOfCommunity(user.id, communityId);
        if (!isMember) {
          return void res.status(403).json({ error: "You are not a member of this community" });
        }
      }

      const viewModel = await storage.getDashboardDataForRole(user.role, user.id, communityId);
      res.json(storage.toTaskResponse(viewModel, user));
    } catch (error) {
      console.error("Dashboard role error:", error);
      res.status(500).json({ error: "Failed to fetch dashboard data" });
    }
  });

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

  app.get("/api/contractors", requireAuth, async (req: Request, res: Response) => {
    try {
      const actor = await storage.getUserById(req.session.userId!);
      if (!actor) return void res.status(401).json({ error: "User not found" });
      if (actor.role !== "admin" && actor.role !== "property_manager") {
        return void res.status(403).json({ error: "Access denied" });
      }
      const communityId = req.query.communityId as string | undefined;
      let contractors: Awaited<ReturnType<typeof storage.getAllContractors>>;
      if (communityId) {
        if (actor.role === "property_manager") {
          const isMember = await storage.isUserMemberOfCommunity(actor.id, communityId);
          if (!isMember) return void res.status(403).json({ error: "You are not a member of this community" });
        }
        contractors = await storage.getContractorsForCommunity(communityId);
      } else {
        if (actor.role !== "admin") {
          return void res.status(400).json({ error: "communityId is required" });
        }
        contractors = await storage.getAllContractors();
      }
      res.json(contractors.map(({ password: _, ...c }) => c));
    } catch (error) {
      console.error("Get contractors error:", error);
      res.status(500).json({ error: "Failed to fetch contractors" });
    }
  });

  // Company management is intentionally staff-only, independent of community access.
  app.get("/api/admin/companies", requireAdmin, async (req: Request, res: Response) => {
    const parsed = z.object({
      search: z.string().optional(), kind: z.enum(["contractor", "management_company"]).optional(),
      includeInactive: z.enum(["true", "false"]).optional(),
    }).safeParse(req.query);
    if (!parsed.success) return void res.status(400).json({ error: parsed.error.flatten() });
    try {
      res.json(await storage.listCompanies({ ...parsed.data, includeInactive: parsed.data.includeInactive === "true" }));
    } catch (error) {
      console.error("List companies error:", error);
      res.status(500).json({ error: "Failed to fetch companies" });
    }
  });

  app.post("/api/admin/companies", requireAdmin, async (req: Request, res: Response) => {
    const parsed = z.object({
      name: z.string().trim().min(1), kind: z.enum(["contractor", "management_company"]), confirmNew: z.boolean().optional(),
    }).safeParse(req.body);
    if (!parsed.success || !normalizeCompanyName(parsed.data.name)) return void res.status(400).json({ error: "Name and kind are required" });
    const { name, kind, confirmNew } = parsed.data;
    try {
      const matches = await storage.findSimilarCompanies(name, kind);
      // The normalized-name constraint is global, including other kinds and
      // inactive records; neither may be silently duplicated.
      const exact = (await storage.listCompanies({ search: name, includeInactive: true }))
        .filter(c => normalizeCompanyName(c.name) === normalizeCompanyName(name));
      if (exact.length) {
        return void res.status(409).json({ error: "A company with this name already exists", matches: exact });
      }
      if (matches.length && confirmNew !== true) return void res.status(409).json({ error: "Similar companies exist", matches });
      res.status(201).json(await storage.createCompany(name, kind));
    } catch (error) {
      if (companyUniqueConflict(error)) {
        const matches = (await storage.listCompanies({ search: name, includeInactive: true }))
          .filter(c => normalizeCompanyName(c.name) === normalizeCompanyName(name));
        return void res.status(409).json({ error: "A company with this name already exists", matches });
      }
      console.error("Create company error:", error);
      res.status(500).json({ error: "Failed to create company" });
    }
  });

  app.patch("/api/admin/companies/:id", requireAdmin, async (req: Request, res: Response) => {
    const parsed = z.object({ name: z.string().trim().min(1).optional(), isActive: z.boolean().optional() }).safeParse(req.body);
    if (!parsed.success || !Object.keys(parsed.data).length || (parsed.data.name !== undefined && !normalizeCompanyName(parsed.data.name))) {
      return void res.status(400).json({ error: "Invalid company update" });
    }
    try {
      const company = await storage.getCompanyById(req.params.id as string);
      if (!company) return void res.status(404).json({ error: "Company not found" });
      if (parsed.data.name !== undefined) {
        const exactMatches = (await storage.listCompanies({ search: parsed.data.name, includeInactive: true }))
          .filter(c => c.id !== company.id && normalizeCompanyName(c.name) === normalizeCompanyName(parsed.data.name!));
        if (exactMatches.length) return void res.status(409).json({ error: "A company with this name already exists", matches: exactMatches });
        const matches = (await storage.findSimilarCompanies(parsed.data.name, company.kind)).filter(c => c.id !== company.id);
        if (matches.length) {
          const exact = matches.some(c => c.normalizedName === normalizeCompanyName(parsed.data.name!));
          return void res.status(409).json({ error: exact ? "A company with this name already exists" : "Similar companies exist", matches });
        }
      }
      res.json(await storage.updateCompany(company.id, parsed.data));
    } catch (error) {
      if (companyUniqueConflict(error)) return void res.status(409).json({ error: "A company with this name already exists", matches: [] });
      console.error("Update company error:", error);
      res.status(500).json({ error: "Failed to update company" });
    }
  });

  app.get("/api/users", requireAuth, async (req: Request, res: Response) => {
    try {
      const actor = await storage.getUserById(req.session.userId!);
      if (!actor) return void res.status(401).json({ error: "Not authenticated" });

      /* Super Admin: return all users */
      if (actor.role === "admin") {
        let allUsers = await storage.getAllUsers();
        const roleFilter = req.query.role as string | undefined;
        if (roleFilter) {
          allUsers = allUsers.filter(u => u.role === roleFilter);
        }
        return void res.json(allUsers.map(({ password: _, ...u }) => u));
      }

      /* PM and HOA Admin: community-scoped */
      if (actor.role === "property_manager" || actor.role === "hoa_admin") {
        const communityId = req.query.communityId as string | undefined;
        if (!communityId) {
          return void res.status(400).json({ error: "communityId is required for this role" });
        }
        if (actor.role === "property_manager") {
          const isMember = await storage.isUserMemberOfCommunity(actor.id, communityId);
          if (!isMember) return void res.status(403).json({ error: "Not a member of this community" });
        } else if (actor.role === "hoa_admin") {
          if (actor.hoaCommunityId !== communityId) {
            return void res.status(403).json({ error: "Access denied" });
          }
        }
        const communityUsers = await storage.getUsersByCommunity(communityId);
        return void res.json(communityUsers.map(({ password: _, ...u }) => u));
      }

      return void res.status(403).json({ error: "Not authorized" });
    } catch (error) {
      console.error("Get users error:", error);
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  app.put("/api/users/:id/role", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { role, hoaCommunityId, companyId } = req.body;
      const validRoles = userRoleEnum.enumValues;
      if (!validRoles.includes(role as (typeof validRoles)[number])) {
        return void res.status(400).json({ error: "Invalid role" });
      }
      if (req.params.id === req.session.userId) {
        return void res.status(400).json({ error: "Cannot change your own role" });
      }
      if (isHoaRole(role) && !hoaCommunityId) {
        return void res.status(400).json({ error: "HOA roles require a community assignment" });
      }
      if (isHoaRole(role) && hoaCommunityId) {
        const limitCheck = await checkHoaLimits(hoaCommunityId, role, req.params.id as string);
        if (limitCheck) {
          return void res.status(400).json({ error: limitCheck });
        }
      }
      const targetUser = await storage.getUserById(req.params.id as string);
      const effectiveCompanyId = companyId === undefined && isContractorSide(targetUser?.role || "") && isContractorSide(role)
        ? targetUser?.companyId : companyId;
      const companyError = companyId === undefined && role !== "contractor_manager" ? null : await companySelectionError(role, effectiveCompanyId);
      if (companyError) return void res.status(400).json({ error: companyError });
      const updated = await storage.updateUserRole(req.params.id as string, role, isHoaRole(role) ? hoaCommunityId : null, companyId);
      if (!updated) {
        return void res.status(404).json({ error: "User not found" });
      }
      await storage.revokeUserSessions(req.params.id as string);
      const { password: _, ...safeUser } = updated;
      res.json(safeUser);
    } catch (error) {
      console.error("Update role error:", error);
      res.status(500).json({ error: "Failed to update role" });
    }
  });

  app.post("/api/admin/users", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { username, password, displayName, role, hoaCommunityId, organizationId, companyId } = req.body;
      if (!username || !password) {
        return void res.status(400).json({ error: "username and password are required" });
      }
      const validRoles = userRoleEnum.enumValues;
      if (role && !validRoles.includes(role as (typeof validRoles)[number])) {
        return void res.status(400).json({ error: `role must be one of: ${validRoles.join(', ')}` });
      }
      if (isHoaRole(role) && !hoaCommunityId) {
        return void res.status(400).json({ error: "HOA roles require a community assignment" });
      }
      if (isHoaRole(role) && hoaCommunityId) {
        const limitCheck = await checkHoaLimits(hoaCommunityId, role);
        if (limitCheck) {
          return void res.status(400).json({ error: limitCheck });
        }
      }
      if (isClientRole(role) && !organizationId) {
        return void res.status(400).json({ error: "client_admin role requires an organizationId" });
      }
      if (!isClientRole(role) && organizationId) {
        return void res.status(400).json({ error: "organizationId is only valid for client_admin role" });
      }
      const existing = await storage.getUserByUsername(username);
      if (existing) {
        return void res.status(409).json({ error: "Username already taken" });
      }
      const hashedPassword = await bcrypt.hash(password, 10);
      const companyError = await companySelectionError(role || "contractor", companyId);
      if (companyError) return void res.status(400).json({ error: companyError });
      const user = await storage.createAdminUser({
        username,
        password: hashedPassword,
        displayName: displayName || username,
        role: role || "contractor",
        hoaCommunityId: isHoaRole(role) ? hoaCommunityId : undefined,
        organizationId: isClientRole(role) ? organizationId : undefined,
        companyId: companyId ?? null,
      });
      const { password: _, ...safeUser } = user;
      res.status(201).json(safeUser);
    } catch (error) {
      console.error("Create user error:", error);
      res.status(500).json({ error: "Failed to create user" });
    }
  });

  app.patch("/api/admin/users/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = req.params.id as string;
      const { displayName, newPassword, companyId } = req.body ?? {};

      const updates: { displayName?: string; password?: string; companyId?: string | null } = {};

      if (displayName !== undefined) {
        if (typeof displayName !== "string" || displayName.trim().length === 0) {
          return void res.status(400).json({ error: "Display name cannot be empty" });
        }
        updates.displayName = displayName.trim();
      }

      if (newPassword !== undefined) {
        if (typeof newPassword !== "string" || newPassword.length < 6) {
          return void res.status(400).json({ error: "New password must be at least 6 characters" });
        }
        updates.password = await bcrypt.hash(newPassword, 10);
      }

      if (companyId !== undefined) updates.companyId = companyId;
      if (Object.keys(updates).length === 0) {
        return void res.status(400).json({ error: "No changes provided" });
      }

      const existing = await storage.getUserById(userId);
      if (!existing) {
        return void res.status(404).json({ error: "User not found" });
      }

      const companyError = companyId === undefined ? null : await companySelectionError(existing.role, companyId);
      if (companyError) return void res.status(400).json({ error: companyError });
      const updated = await storage.updateUserProfile(userId, updates);
      if (!updated) {
        return void res.status(500).json({ error: "Failed to update user" });
      }
      if (updates.password) await storage.revokeUserSessions(userId);
      const { password: _, ...safeUser } = updated;
      res.json(safeUser);
    } catch (error) {
      console.error("Admin update user error:", error);
      res.status(500).json({ error: "Failed to update user" });
    }
  });

  app.delete("/api/admin/users/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = req.params.id as string;
      if (userId === req.session.userId) {
        return void res.status(400).json({ error: "Cannot delete yourself" });
      }
      const user = await storage.getUserById(userId);
      if (!user) {
        return void res.status(404).json({ error: "User not found" });
      }
      await storage.deleteUser(userId);
      await storage.revokeUserSessions(userId);
      await storage.removeAllPushTokens(userId);
      res.json({ message: "User deleted" });
    } catch (error) {
      console.error("Delete user error:", error);
      res.status(500).json({ error: "Failed to delete user" });
    }
  });

  app.get("/api/users/:id/communities", requireAdmin, async (req: Request, res: Response) => {
    try {
      const comms = await storage.getUserCommunitiesList(req.params.id as string);
      res.json(comms);
    } catch (error) {
      console.error("Get user communities error:", error);
      res.status(500).json({ error: "Failed to fetch user communities" });
    }
  });

  /* ── Status toggle (admin, PM, HOA Admin) ───────────────────────────────── */
  app.put("/api/users/:id/status", requireAuth, async (req: Request, res: Response) => {
    try {
      const actor = await storage.getUserById(req.session.userId!);
      if (!actor) return void res.status(401).json({ error: "Not authenticated" });

      const allowedActorRoles = ["admin", "property_manager", "hoa_admin"];
      if (!allowedActorRoles.includes(actor.role)) {
        return void res.status(403).json({ error: "Not authorized" });
      }

      const targetUser = await storage.getUserById(req.params.id as string);
      if (!targetUser) return void res.status(404).json({ error: "User not found" });

      if (req.params.id === req.session.userId) {
        return void res.status(400).json({ error: "Cannot change your own status" });
      }

      /* Scope check for PM and HOA Admin */
      if (actor.role === "property_manager") {
        const isMember = await storage.isUserMemberOfCommunity(actor.id, targetUser.hoaCommunityId || '');
        if (!targetUser.hoaCommunityId || !isMember) {
          return void res.status(403).json({ error: "User is not in your community" });
        }
      } else if (actor.role === "hoa_admin") {
        if (targetUser.hoaCommunityId !== actor.hoaCommunityId) {
          return void res.status(403).json({ error: "User is not in your community" });
        }
        if (targetUser.role !== "hoa_member") {
          return void res.status(403).json({ error: "HOA Admins can only manage HOA Members" });
        }
      }

      const { isActive } = req.body;
      if (typeof isActive !== "boolean") {
        return void res.status(400).json({ error: "isActive (boolean) is required" });
      }

      const updated = await storage.updateUserStatus(req.params.id as string, isActive);
      if (!updated) return void res.status(404).json({ error: "User not found" });
      if (!isActive) {
        await storage.revokeUserSessions(req.params.id as string);
        await storage.removeAllPushTokens(req.params.id as string);
      }
      const { password: _, ...safeUser } = updated;
      res.json(safeUser);
    } catch (error) {
      console.error("Update user status error:", error);
      res.status(500).json({ error: "Failed to update user status" });
    }
  });

  /* ── Community-scoped user list (PM, HOA Admin) ─────────────────────────── */
  app.get("/api/portal/users", requireAuth, async (req: Request, res: Response) => {
    try {
      const actor = await storage.getUserById(req.session.userId!);
      if (!actor) return void res.status(401).json({ error: "Not authenticated" });

      const communityId = req.query.communityId as string;
      if (!communityId) return void res.status(400).json({ error: "communityId is required" });

      if (actor.role === "property_manager") {
        const isMember = await storage.isUserMemberOfCommunity(actor.id, communityId);
        if (!isMember) return void res.status(403).json({ error: "Not a member of this community" });
      } else if (actor.role === "hoa_admin") {
        if (actor.hoaCommunityId !== communityId) {
          return void res.status(403).json({ error: "Access denied" });
        }
      } else {
        return void res.status(403).json({ error: "Not authorized" });
      }

      const communityUsers = await storage.getUsersByCommunity(communityId);
      res.json(communityUsers.map(({ password: _, ...u }) => u));
    } catch (error) {
      console.error("Get portal users error:", error);
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  /* ── Create user in community (PM, HOA Admin) ───────────────────────────── */
  app.post("/api/portal/users", requireAuth, async (req: Request, res: Response) => {
    try {
      const actor = await storage.getUserById(req.session.userId!);
      if (!actor) return void res.status(401).json({ error: "Not authenticated" });

      const allowedActorRoles = ["property_manager", "hoa_admin"];
      if (!allowedActorRoles.includes(actor.role)) {
        return void res.status(403).json({ error: "Not authorized" });
      }

      const { username, password, displayName, role, communityId } = req.body;
      if (!username || !password || !communityId) {
        return void res.status(400).json({ error: "username, password, and communityId are required" });
      }
      if (password.length < 6) {
        return void res.status(400).json({ error: "Password must be at least 6 characters" });
      }

      /* Role restrictions */
      if (actor.role === "hoa_admin") {
        if (role !== "hoa_member") {
          return void res.status(403).json({ error: "HOA Admins can only create HOA Member users" });
        }
        if (communityId !== actor.hoaCommunityId) {
          return void res.status(403).json({ error: "Access denied" });
        }
      } else if (actor.role === "property_manager") {
        const allowedRoles = ["hoa_admin", "hoa_member"];
        if (!allowedRoles.includes(role)) {
          return void res.status(403).json({ error: "Property Managers can only create HOA Admin or HOA Member users" });
        }
        const isMember = await storage.isUserMemberOfCommunity(actor.id, communityId);
        if (!isMember) return void res.status(403).json({ error: "Not a member of this community" });
      }

      const existing = await storage.getUserByUsername(username);
      if (existing) return void res.status(409).json({ error: "Username already taken" });

      const validPortalRoles = ["hoa_admin", "hoa_member"] as const;
      type PortalRole = typeof validPortalRoles[number];
      const typedRole: PortalRole = validPortalRoles.includes(role) ? (role as PortalRole) : "hoa_member";

      const hashedPassword = await bcrypt.hash(password, 10);
      const user = await storage.createUser({
        username,
        password: hashedPassword,
        displayName: displayName || username,
        role: typedRole,
        hoaCommunityId: communityId,
      });
      await storage.addCommunityMembers(communityId, [user.id]);
      const { password: _, ...safeUser } = user;
      res.status(201).json(safeUser);
    } catch (error) {
      console.error("Create portal user error:", error);
      res.status(500).json({ error: "Failed to create user" });
    }
  });

  /* ── Edit community user role/status (PM, HOA Admin) ───────────────────── */
  app.put("/api/portal/users/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const actor = await storage.getUserById(req.session.userId!);
      if (!actor) return void res.status(401).json({ error: "Not authenticated" });

      const allowedActorRoles = ["property_manager", "hoa_admin"];
      if (!allowedActorRoles.includes(actor.role)) {
        return void res.status(403).json({ error: "Not authorized" });
      }

      const targetUser = await storage.getUserById(req.params.id as string);
      if (!targetUser) return void res.status(404).json({ error: "User not found" });

      if (req.params.id === req.session.userId) {
        return void res.status(400).json({ error: "Cannot edit yourself" });
      }

      if (actor.role === "hoa_admin") {
        if (targetUser.hoaCommunityId !== actor.hoaCommunityId) {
          return void res.status(403).json({ error: "User is not in your community" });
        }
        if (targetUser.role !== "hoa_member") {
          return void res.status(403).json({ error: "HOA Admins can only edit HOA Members" });
        }
      } else if (actor.role === "property_manager") {
        if (!targetUser.hoaCommunityId) {
          return void res.status(403).json({ error: "User has no community assignment" });
        }
        const isMember = await storage.isUserMemberOfCommunity(actor.id, targetUser.hoaCommunityId);
        if (!isMember) return void res.status(403).json({ error: "User is not in your community" });
      }

      const { role, isActive } = req.body;
      let updated = targetUser;

      if (role !== undefined) {
        if (actor.role === "hoa_admin" && role !== "hoa_member") {
          return void res.status(403).json({ error: "HOA Admins can only assign HOA Member role" });
        }
        if (actor.role === "property_manager") {
          const allowedRoles = ["hoa_admin", "hoa_member"];
          if (!allowedRoles.includes(role)) {
            return void res.status(403).json({ error: "Property Managers can only assign HOA Admin or HOA Member roles" });
          }
        }
        const r = await storage.updateUserRole(req.params.id as string, role, targetUser.hoaCommunityId);
        if (r) {
          updated = r;
          await storage.revokeUserSessions(req.params.id as string);
        }
      }

      if (typeof isActive === "boolean") {
        const r = await storage.updateUserStatus(req.params.id as string, isActive);
        if (r) {
          updated = r;
          if (!isActive) {
            await storage.revokeUserSessions(req.params.id as string);
            await storage.removeAllPushTokens(req.params.id as string);
          }
        }
      }

      const { password: _, ...safeUser } = updated;
      res.json(safeUser);
    } catch (error) {
      console.error("Edit portal user error:", error);
      res.status(500).json({ error: "Failed to edit user" });
    }
  });

  /* ── Remove user from community (PM, HOA Admin) — unlinks, does not delete ─ */
  app.delete("/api/portal/users/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const actor = await storage.getUserById(req.session.userId!);
      if (!actor) return void res.status(401).json({ error: "Not authenticated" });

      const allowedActorRoles = ["property_manager", "hoa_admin"];
      if (!allowedActorRoles.includes(actor.role)) {
        return void res.status(403).json({ error: "Not authorized" });
      }

      const targetUser = await storage.getUserById(req.params.id as string);
      if (!targetUser) return void res.status(404).json({ error: "User not found" });

      if (req.params.id === req.session.userId) {
        return void res.status(400).json({ error: "Cannot remove yourself" });
      }

      if (actor.role === "hoa_admin") {
        if (targetUser.hoaCommunityId !== actor.hoaCommunityId) {
          return void res.status(403).json({ error: "User is not in your community" });
        }
        if (targetUser.role !== "hoa_member") {
          return void res.status(403).json({ error: "HOA Admins can only remove HOA Members" });
        }
      } else if (actor.role === "property_manager") {
        if (!targetUser.hoaCommunityId) {
          return void res.status(403).json({ error: "User has no community" });
        }
        const isMember = await storage.isUserMemberOfCommunity(actor.id, targetUser.hoaCommunityId);
        if (!isMember) return void res.status(403).json({ error: "User is not in your community" });
      }

      /* Unlink from community (remove hoaCommunityId and community_members row), do NOT delete account */
      await storage.removeCommunityMember(targetUser.hoaCommunityId!, req.params.id as string);
      await storage.updateUserRole(req.params.id as string, targetUser.role, null);
      await storage.revokeUserSessions(req.params.id as string);
      res.json({ message: "User removed from community" });
    } catch (error) {
      console.error("Remove portal user error:", error);
      res.status(500).json({ error: "Failed to remove user from community" });
    }
  });

  app.get("/api/ping", (_req: Request, res: Response) => {
    res.json({ ok: true, ts: Date.now() });
  });

  app.post("/api/push-tokens", requireAuth, async (req: Request, res: Response) => {
    try {
      const parsed = registerPushTokenSchema.safeParse(req.body);
      if (!parsed.success) {
        return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      }
      const deviceId = parsed.data.deviceId;
      const newToken = parsed.data.token;
      const now = Date.now();
      const lastReg = pushTokenLastReg.get(deviceId);
      if (lastReg && lastReg.token === newToken && now - lastReg.ts < PUSH_TOKEN_RATE_LIMIT_MS) {
        return void res.status(200).json({ rateLimited: true });
      }
      const pushToken = await storage.registerPushToken(
        req.session.userId!,
        newToken,
        parsed.data.platform,
        deviceId,
      );
      pushTokenLastReg.set(deviceId, { ts: now, token: newToken });
      res.status(201).json(pushToken);
    } catch (error) {
      console.error("Register push token error:", error);
      res.status(500).json({ error: "Failed to register push token" });
    }
  });

  app.delete("/api/push-tokens", requireAuth, async (req: Request, res: Response) => {
    try {
      const { token, deviceId } = req.body;
      if (deviceId) {
        await storage.removePushTokenByDevice(req.session.userId!, deviceId);
        pushTokenLastReg.delete(deviceId);
      } else if (token) {
        await storage.removePushToken(req.session.userId!, token);
        // Clear any Map entry whose stored token matches, so account-switch flows
        // don't leave a stale throttle behind when there is no deviceId to key on.
        for (const [key, entry] of pushTokenLastReg.entries()) {
          if (entry.token === token) {
            pushTokenLastReg.delete(key);
            break;
          }
        }
      } else {
        return void res.status(400).json({ error: "token or deviceId is required" });
      }
      res.json({ message: "Push token removed" });
    } catch (error) {
      console.error("Remove push token error:", error);
      res.status(500).json({ error: "Failed to remove push token" });
    }
  });

  app.post("/api/push/due-reminders", requireAdmin, async (_req: Request, res: Response) => {
    try {
      await sendDueReminders();
      res.json({ message: "Due reminders sent" });
    } catch (error) {
      console.error("Due reminders error:", error);
      res.status(500).json({ error: "Failed to send due reminders" });
    }
  });

  registerAssetRoutes(app);

  registerMapLayerRoutes(app);

  app.get("/api/communities/:communityId/assets/completeness", requireAdmin, async (req: Request, res: Response) => {
    try {
      const communityId = req.params.communityId as string;
      const type = req.query.type as string | undefined;
      const allAssets = await storage.getAssetsByCommunitySorted(communityId, type, true);
      const active = allAssets.filter(a => !a.isArchived);
      const archived = allAssets.filter(a => a.isArchived);

      const missingRequired: { id: string; label: string; assetType: string; missingKeys: string[] }[] = [];
      for (const asset of active) {
        const props = await storage.getAssetProperties(asset.id);
        const missing = await getMissingRequiredKeys(asset.assetType, props);
        if (missing.length > 0) {
          missingRequired.push({ id: asset.id, label: asset.label, assetType: asset.assetType, missingKeys: missing });
        }
      }

      res.json({
        total: allAssets.length,
        active: active.length,
        archived: archived.length,
        missingRequired: missingRequired.length,
        missingRequiredAssets: missingRequired,
      });
    } catch (error) {
      console.error("Get asset completeness error:", error);
      res.status(500).json({ error: "Failed to fetch asset completeness" });
    }
  });

  app.get("/api/communities/:communityId/assets/incomplete", requireAdmin, async (req: Request, res: Response) => {
    try {
      const communityId = req.params.communityId as string;
      const assetType = req.query.assetType as string | undefined;
      const mapLayerId = req.query.mapLayerId as string | undefined;
      const missingKey = req.query.missingKey as string | undefined;
      const results = await storage.getIncompleteAssets(communityId, assetType, mapLayerId, missingKey);
      res.json(results);
    } catch (error) {
      console.error("Get incomplete assets error:", error);
      res.status(500).json({ error: "Failed to fetch incomplete assets" });
    }
  });

  app.get("/api/search", requireAuth, async (req: Request, res: Response) => {
    try {
      const q = (req.query.q as string || '').trim();
      if (!q) return void res.json([]);

      const user = await storage.getUserById(req.session.userId!);
      if (!user) return void res.status(401).json({ error: "User not found" });

      const isAdmin = user.role === "admin";
      let communityIds: string[] = [];

      const communityId = req.query.communityId as string | undefined;
      if (communityId) {
        if (!isAdmin) {
          const isMember = await storage.isUserMemberOfCommunity(user.id, communityId);
          if (!isMember) return void res.status(403).json({ error: "Not a member of this community" });
          // Non-admin users cannot search commercial branches (organizationId IS NOT NULL)
          const comm = await storage.getCommunityById(communityId);
          if (comm?.organizationId) return void res.status(403).json({ error: "Not a member of this community" });
        }
        communityIds = [communityId];
      } else {
        if (isAdmin) {
          const allComms = await storage.getCommunities();
          communityIds = allComms.map(c => c.id);
        } else {
          // Non-admin users only search non-commercial communities (organizationId IS NULL)
          const memberships = await storage.getUserCommunities(user.id);
          communityIds = memberships
            .map(m => m.community)
            .filter(c => !c.organizationId)
            .map(c => c.id);
        }
      }

      const typesStr = (req.query.types as string) || '';
      const types = typesStr ? typesStr.split(',').map(t => t.trim()).filter(Boolean) : [];

      const results = await storage.searchAll(q, communityIds, types, user.id, isAdmin);
      res.json(storage.toTaskResponse(results, user));
    } catch (error) {
      console.error("Search error:", error);
      res.status(500).json({ error: "Search failed" });
    }
  });

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

  app.get("/api/communities/:communityId/service-schedules", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!(await userCanAccessCommunity(req.currentUser!, req.params.communityId as string))) {
        return void res.status(403).json({ error: "You do not have access to this community" });
      }
      const schedules = await storage.getServiceSchedulesByCommunity(req.params.communityId as string);
      res.json(schedules);
    } catch (error) {
      console.error("Get service schedules error:", error);
      res.status(500).json({ error: "Failed to get service schedules" });
    }
  });

  app.post("/api/communities/:communityId/service-schedules", requireAdmin, async (req: Request, res: Response) => {
    try {
      const parsed = insertServiceScheduleSchema.safeParse({
        ...req.body,
        communityId: req.params.communityId,
      });
      if (!parsed.success) {
        return void res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
      }
      const schedule = await storage.createServiceSchedule(parsed.data);
      res.status(201).json(schedule);
    } catch (error) {
      console.error("Create service schedule error:", error);
      res.status(500).json({ error: "Failed to create service schedule" });
    }
  });

  app.patch("/api/service-schedules/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const parsed = updateServiceScheduleSchema.safeParse(req.body);
      if (!parsed.success) {
        return void res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
      }
      const schedule = await storage.updateServiceSchedule(req.params.id as string, parsed.data);
      if (!schedule) {
        return void res.status(404).json({ error: "Service schedule not found" });
      }
      res.json(schedule);
    } catch (error) {
      console.error("Update service schedule error:", error);
      res.status(500).json({ error: "Failed to update service schedule" });
    }
  });

  app.delete("/api/service-schedules/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const deleted = await storage.deleteServiceSchedule(req.params.id as string);
      if (!deleted) {
        return void res.status(404).json({ error: "Service schedule not found" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Delete service schedule error:", error);
      res.status(500).json({ error: "Failed to delete service schedule" });
    }
  });

  app.get("/api/service-schedules/:scheduleId/visits", requireAuth, async (req: Request, res: Response) => {
    try {
      const schedule = await storage.getServiceScheduleById(req.params.scheduleId as string);
      if (!schedule) {
        return void res.status(404).json({ error: "Service schedule not found" });
      }
      if (!(await userCanAccessCommunity(req.currentUser!, schedule.communityId))) {
        return void res.status(403).json({ error: "You do not have access to this community" });
      }
      const { from, to } = req.query as { from?: string; to?: string };
      const visits = await storage.getServiceVisits(req.params.scheduleId as string, { from, to });
      res.json(visits);
    } catch (error) {
      console.error("Get service visits error:", error);
      res.status(500).json({ error: "Failed to get service visits" });
    }
  });

  app.get("/api/communities/:communityId/service-visits", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!(await userCanAccessCommunity(req.currentUser!, req.params.communityId as string))) {
        return void res.status(403).json({ error: "You do not have access to this community" });
      }
      const { from, to } = req.query as { from?: string; to?: string };
      const visits = await storage.getServiceVisitsByCommunity(req.params.communityId as string, { from, to });
      res.json(visits);
    } catch (error) {
      console.error("Get community service visits error:", error);
      res.status(500).json({ error: "Failed to get service visits" });
    }
  });

  app.post("/api/service-schedules/:scheduleId/log", requireAuth, async (req: Request, res: Response) => {
    try {
      const parsed = logServiceVisitSchema.safeParse(req.body);
      if (!parsed.success) {
        return void res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
      }
      const schedule = await storage.getServiceScheduleById(req.params.scheduleId as string);
      if (!schedule) {
        return void res.status(404).json({ error: "Service schedule not found" });
      }
      const user = req.currentUser!;
      if ((user.role !== "admin" && user.role !== "contractor") ||
          !(await userCanAccessCommunity(user, schedule.communityId))) {
        return void res.status(403).json({ error: "You do not have access to this community" });
      }
      const visit = await storage.upsertServiceVisit({
        scheduleId: schedule.id,
        communityId: schedule.communityId,
        serviceDate: parsed.data.serviceDate,
        completedAt: parsed.data.completedAt ? new Date(parsed.data.completedAt) : new Date(),
        completedBy: user.id,
        employeeSignOffName: parsed.data.employeeSignOffName,
        notes: parsed.data.notes ?? null,
      });
      res.status(201).json(visit);
    } catch (error) {
      console.error("Log service visit error:", error);
      res.status(500).json({ error: "Failed to log service visit" });
    }
  });

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

  app.get("/api/notification-preferences", requireAuth, async (req: Request, res: Response) => {
    try {
      const prefs = await storage.getUserNotificationPreferences(req.session.userId!);
      res.json(prefs);
    } catch (error) {
      console.error("Get notification preferences error:", error);
      res.status(500).json({ error: "Failed to fetch notification preferences" });
    }
  });

  app.put("/api/notification-preferences", requireAuth, async (req: Request, res: Response) => {
    try {
      const { taskAssigned, dueReminders, syncFailure, taskCompleted, requestSubmitted, requestCompleted, requestStatusUpdates } = req.body;
      const prefs = {
        taskAssigned: typeof taskAssigned === 'boolean' ? taskAssigned : true,
        dueReminders: typeof dueReminders === 'boolean' ? dueReminders : true,
        syncFailure: typeof syncFailure === 'boolean' ? syncFailure : true,
        taskCompleted: typeof taskCompleted === 'boolean' ? taskCompleted : true,
        requestSubmitted: typeof requestSubmitted === 'boolean' ? requestSubmitted : true,
        requestCompleted: typeof requestCompleted === 'boolean' ? requestCompleted : true,
        requestStatusUpdates: typeof requestStatusUpdates === 'boolean' ? requestStatusUpdates : true,
      };
      await storage.setUserNotificationPreferences(req.session.userId!, prefs);
      res.json(prefs);
    } catch (error) {
      console.error("Set notification preferences error:", error);
      res.status(500).json({ error: "Failed to save notification preferences" });
    }
  });

  app.get("/api/notifications", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return void res.status(401).json({ error: "Not authenticated" });

      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = parseInt(req.query.offset as string) || 0;
      const notifs = await storage.getNotificationsForUser(user.id, limit, offset);
      res.json(notifs);
    } catch (error) {
      console.error("Get notifications error:", error);
      res.status(500).json({ error: "Failed to fetch notifications" });
    }
  });

  app.get("/api/notifications/unread-count", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return void res.status(401).json({ error: "Not authenticated" });

      const count = await storage.getUnreadNotificationCount(user.id);
      res.json({ count });
    } catch (error) {
      console.error("Get unread count error:", error);
      res.status(500).json({ error: "Failed to get unread count" });
    }
  });

  app.put("/api/notifications/read-all", requireAuth, async (req: Request, res: Response) => {
    try {
      await storage.markAllNotificationsRead(req.session.userId!);
      res.json({ success: true });
    } catch (error) {
      console.error("Mark all read error:", error);
      res.status(500).json({ error: "Failed to mark all read" });
    }
  });

  app.put("/api/notifications/:id/read", requireAuth, async (req: Request, res: Response) => {
    try {
      const notif = await storage.markNotificationRead((req.params.id as string), req.session.userId!);
      if (!notif) return void res.status(404).json({ error: "Notification not found" });
      res.json(notif);
    } catch (error) {
      console.error("Mark read error:", error);
      res.status(500).json({ error: "Failed to mark notification read" });
    }
  });

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
