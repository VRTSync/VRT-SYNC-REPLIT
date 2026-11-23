import type { Express, Request, Response } from "express";
import { requireAuth, requireAdmin } from "../auth";
import * as storage from "../storage";
import * as policy from "../policy";
import { insertOfflinePackSchema } from "@workspace/db";
import { getAssetTypeCache } from "../assetTypeCache";
import { route } from "./handler";

export function registerOfflinePackRoutes(app: Express): void {
  app.get("/api/communities/:communityId/offline-pack", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const communityId = req.params.communityId as string;
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return void res.status(401).json({ error: "User not found" });
      const actor = policy.actorFromUser(user);
      if (!await policy.canUseCommunityMapData(actor, communityId)) {
        return void res.status(403).json({ error: "You are not a member of this community" });
      }
      const pack = await storage.getLatestOfflinePack(communityId);
      if (!pack) return void res.json(null);
      res.json({
        id: pack.id,
        communityId: pack.communityId,
        packVersion: pack.packVersion,
        updatedAt: pack.updatedAt,
        checksum: pack.checksum,
      });
    } catch (error) {
      console.error("Get offline pack error:", error);
      res.status(500).json({ error: "Failed to fetch offline pack" });
    }
  }));

  app.post("/api/offline-packs", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const parsed = insertOfflinePackSchema.safeParse(req.body);
      if (!parsed.success) return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      const pack = await storage.createOfflinePack(parsed.data);
      res.status(201).json(pack);
    } catch (error: any) {
      if (error?.constraint === "offline_packs_community_version_idx") {
        return void res.status(409).json({ error: "A pack with that version already exists for this community" });
      }
      console.error("Create offline pack error:", error);
      res.status(500).json({ error: "Failed to create offline pack" });
    }
  }));

  app.post("/api/offline-packs/:id/download-urls", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const pack = await storage.getOfflinePackById(req.params.id as string);
      if (!pack) return void res.status(404).json({ error: "Pack not found" });
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return void res.status(401).json({ error: "User not found" });
      const actor = policy.actorFromUser(user);
      if (!await policy.canUseCommunityMapData(actor, pack.communityId)) {
        return void res.status(403).json({ error: "You are not a member of this community" });
      }
      res.json({
        mbtilesRef: pack.mbtilesRef,
        manifestRef: pack.manifestRef,
        geojsonBundleRef: pack.geojsonBundleRef,
        assetIndexRef: pack.assetIndexRef,
        searchIndexRef: pack.searchIndexRef,
      });
    } catch (error) {
      console.error("Get download URLs error:", error);
      res.status(500).json({ error: "Failed to get download URLs" });
    }
  }));

  app.get("/api/offline-packs", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const communityId = req.query.communityId as string;
      if (!communityId) return void res.status(400).json({ error: "communityId query parameter is required" });
      const packs = await storage.listOfflinePacks(communityId);
      res.json(packs);
    } catch (error) {
      console.error("List offline packs error:", error);
      res.status(500).json({ error: "Failed to list offline packs" });
    }
  }));

  app.delete("/api/offline-packs/:id", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const deleted = await storage.deleteOfflinePack(req.params.id as string);
      if (!deleted) return void res.status(404).json({ error: "Pack not found" });
      res.json({ success: true });
    } catch (error) {
      console.error("Delete offline pack error:", error);
      res.status(500).json({ error: "Failed to delete offline pack" });
    }
  }));

  app.post("/api/communities/:communityId/generate-offline-pack", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const communityId = req.params.communityId as string;
      const community = await storage.getCommunityById(communityId);
      if (!community) return void res.status(404).json({ error: "Community not found" });

      const existingPack = await storage.getLatestOfflinePack(communityId);
      const newVersion = existingPack ? existingPack.packVersion + 1 : 1;

      const [manifest, assetIndex, geojsonBundle, workHistorySnapshot, searchIndex] = await Promise.all([
        storage.generatePackManifest(communityId),
        storage.generateAssetIndex(communityId),
        storage.generateGeojsonBundle(communityId),
        storage.generateWorkHistorySnapshot(communityId),
        storage.generateSearchIndex(communityId),
      ]);

      const pack = await storage.createOfflinePack({
        communityId,
        packVersion: newVersion,
      });

      res.status(201).json({
        pack,
        manifest,
        assetIndex,
        geojsonBundle,
        workHistorySnapshot,
        searchIndex,
      });
    } catch (error) {
      console.error("Generate offline pack error:", error);
      res.status(500).json({ error: "Failed to generate offline pack" });
    }
  }));

  app.get("/api/communities/:communityId/offline-pack-data", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const communityId = req.params.communityId as string;
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return void res.status(401).json({ error: "User not found" });
      const actor = policy.actorFromUser(user);
      if (!await policy.canUseCommunityMapData(actor, communityId)) {
        return void res.status(403).json({ error: "You are not a member of this community" });
      }

      const pack = await storage.getLatestOfflinePack(communityId);
      if (!pack) return void res.status(404).json({ error: "No offline pack available for this community" });

      const isAdmin = policy.seesFullSearchIndex(actor);
      const [manifest, assetIndex, geojsonBundle, workHistorySnapshot, searchIndex] = await Promise.all([
        storage.generatePackManifest(communityId),
        storage.generateAssetIndex(communityId),
        storage.generateGeojsonBundle(communityId),
        storage.generateWorkHistorySnapshot(communityId, 5, policy.assetHistoryCompanyScope(actor)),
        storage.generateSearchIndex(communityId, user.id, isAdmin),
      ]);

      const assetTypesData = await getAssetTypeCache();
      res.json({
        pack: {
          id: pack.id,
          communityId: pack.communityId,
          packVersion: pack.packVersion,
          updatedAt: pack.updatedAt,
          checksum: pack.checksum,
        },
        manifest,
        assetIndex,
        geojsonBundle,
        workHistorySnapshot,
        searchIndex,
        assetTypes: assetTypesData.filter(t => t.isActive),
      });
    } catch (error) {
      console.error("Get offline pack data error:", error);
      res.status(500).json({ error: "Failed to fetch offline pack data" });
    }
  }));
}
