import type { Express, Request, Response } from "express";
import { requireAuth, requireAdmin } from "../auth";
import * as storage from "../storage";
import * as policy from "../policy";
import { getMissingRequiredKeys } from "../assetSync";
import { route } from "./handler";

export function registerSearchRoutes(app: Express): void {
  app.get("/api/communities/:communityId/assets/completeness", requireAdmin, route(async (req: Request, res: Response) => {
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
  }));

  app.get("/api/communities/:communityId/assets/incomplete", requireAdmin, route(async (req: Request, res: Response) => {
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
  }));

  app.get("/api/search", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const q = (req.query.q as string || '').trim();
      if (!q) return void res.json([]);

      const user = await storage.getUserById(req.session.userId!);
      if (!user) return void res.status(401).json({ error: "User not found" });

      const actor = policy.actorFromUser(user);
      const isAdmin = policy.isAdminView(actor);
      let communityIds: string[] = [];

      const communityId = req.query.communityId as string | undefined;
      const scope = await policy.searchScope(actor, communityId);
      if (scope === "not_member") {
        return void res.status(403).json({ error: "Not a member of this community" });
      }
      if (scope.kind === "one") {
        communityIds = [scope.communityId];
      } else if (scope.kind === "all") {
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

      const typesStr = (req.query.types as string) || '';
      const types = typesStr ? typesStr.split(',').map(t => t.trim()).filter(Boolean) : [];

      const results = await storage.searchAll(q, communityIds, types, user.id, isAdmin);
      res.json(storage.toTaskResponse(results, user));
    } catch (error) {
      console.error("Search error:", error);
      res.status(500).json({ error: "Search failed" });
    }
  }));
}
