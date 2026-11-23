import type { Express, Request, Response } from "express";
import { requireAdmin } from "../auth";
import { route } from "./handler";
import * as storage from "../storage";
import { db } from "../db";
import { eq, and, desc, ne } from "drizzle-orm";
import { plannerRecords, xeriscapePackets } from "@workspace/db";

export function registerXeriscapeRoutes(app: Express): void {
  // ── Xeriscape Planning Records ─────────────────────────────────────────────
  app.get("/api/admin/xeriscape/records", requireAdmin, route(async (req: Request, res: Response) => {
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
  }));

  app.post("/api/admin/xeriscape/records", requireAdmin, route(async (req: Request, res: Response) => {
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
  }));

  app.put("/api/admin/xeriscape/records/:id", requireAdmin, route(async (req: Request, res: Response) => {
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
  }));

  app.post("/api/admin/xeriscape/records/:id/duplicate", requireAdmin, route(async (req: Request, res: Response) => {
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
  }));

  app.delete("/api/admin/xeriscape/records/:id", requireAdmin, route(async (req: Request, res: Response) => {
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
  }));

  // ── Xeriscape Community Polygons ────────────────────────────────────────────
  app.get("/api/admin/xeriscape/community/:communityId/polygons", requireAdmin, route(async (req: Request, res: Response) => {
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
  }));

  // ── Xeriscape Packet CRUD ───────────────────────────────────────────────────
  app.get("/api/admin/xeriscape/records/:recordId/packets", requireAdmin, route(async (req: Request, res: Response) => {
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
  }));

  app.post("/api/admin/xeriscape/records/:recordId/packets", requireAdmin, route(async (req: Request, res: Response) => {
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
  }));

  app.put("/api/admin/xeriscape/records/:recordId/packets/:packetId", requireAdmin, route(async (req: Request, res: Response) => {
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
  }));
}
