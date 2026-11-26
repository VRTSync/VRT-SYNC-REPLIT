import type { Express, Request, Response } from "express";
import { insertCommunitySchema } from "@workspace/db";
import { requireAuth, requireAdmin, requireAdminOrMapCreator } from "../auth";
import * as storage from "../storage";
import * as policy from "../policy";
import { route } from "./handler";

export function registerCommunityRoutes(app: Express): void {
  app.get("/api/communities", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const plan = policy.communityListPlan(policy.actorFromUser(req.currentUser!));
      if (plan.kind === "none") return void res.json([]);
      if (plan.kind === "all") {
        // Admins and map creators see all communities, including commercial branches
        const allCommunities = await storage.getCommunities();
        return void res.json(allCommunities);
      }
      if (plan.kind === "hoa") {
        const community = await storage.getCommunityById(plan.communityId);
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
  }));

  app.post("/api/communities", requireAdminOrMapCreator, route(async (req: Request, res: Response) => {
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
      if (currentUser && policy.joinsCreatedCommunity(policy.actorFromUser(currentUser))) {
        await storage.addCommunityMember(community.id, currentUser.id);
      }
      res.status(201).json(community);
    } catch (error) {
      req.log.error({ error }, "Create community error");
      res.status(500).json({ error: "Failed to create community" });
    }
  }));

  app.patch("/api/communities/:id", requireAdmin, route(async (req: Request, res: Response) => {
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
  }));

  app.get("/api/communities/:id/bounds", requireAuth, route(async (req: Request, res: Response) => {
    try {
      if (!(await policy.canAccessCommunity(policy.actorFromUser(req.currentUser!), req.params.id as string))) {
        return void res.status(403).json({ error: "You do not have access to this community" });
      }
      const bounds = await storage.getCommunityBounds(req.params.id as string);
      res.json(bounds);
    } catch (error) {
      console.error("Get community bounds error:", error);
      res.status(500).json({ error: "Failed to compute community bounds" });
    }
  }));

  app.get("/api/communities/:id/crew", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const user = req.currentUser!;
      const access = await policy.crewAccess(policy.actorFromUser(user), req.params.id as string, req.query.companyId);
      if (access === "denied") return void res.status(403).json({ error: "Access denied" });
      if (access === "company_required") return void res.status(400).json({ error: "companyId is required" });
      res.json(await storage.getCompanyCrew(req.params.id as string, access.companyId));
    } catch (error) {
      req.log.error({ error }, "Get crew error");
      res.status(500).json({ error: "Failed to fetch crew" });
    }
  }));

  app.get("/api/communities/:id/members", requireAuth, route(async (req: Request, res: Response) => {
    try {
      if (!(await policy.canAccessCommunity(policy.actorFromUser(req.currentUser!), req.params.id as string))) {
        return void res.status(403).json({ error: "You do not have access to this community" });
      }
      const members = await storage.getCommunityMembers(req.params.id as string);
      res.json(members.map((m) => ({
        id: m.id,
        userId: m.userId,
        displayName: m.user.displayName,
        ...(policy.seesMemberUsernames(policy.actorFromUser(req.currentUser!)) ? { username: m.user.username } : {}),
        ...(policy.seesMemberCompanies(policy.actorFromUser(req.currentUser!)) ? { companyName: m.companyName ?? null } : {}),
        role: m.user.role,
        joinedAt: m.joinedAt,
      })));
    } catch (error) {
      console.error("Get members error:", error);
      res.status(500).json({ error: "Failed to fetch members" });
    }
  }));

  app.post("/api/communities/:id/members", requireAdmin, route(async (req: Request, res: Response) => {
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
  }));

  app.delete("/api/communities/:id/members/:userId", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      await storage.removeCommunityMember(req.params.id as string, req.params.userId as string);
      res.json({ message: "Member removed" });
    } catch (error) {
      console.error("Remove member error:", error);
      res.status(500).json({ error: "Failed to remove member" });
    }
  }));

  app.delete("/api/communities/:id/companies/:companyId", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      if (!(await storage.getCompanyById(req.params.companyId as string))) {
        return void res.status(404).json({ error: "Company not found" });
      }
      res.json(await storage.removeCompanyCommunityMembers(req.params.id as string, req.params.companyId as string));
    } catch (error) {
      console.error("Remove company members error:", error);
      res.status(500).json({ error: "Failed to remove company members" });
    }
  }));

  app.get("/api/communities/:id/controllers", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserById(req.session.userId!);
      if (!user) return void res.status(401).json({ error: "User not found" });
      const communityId = req.params.id as string;
      if (!await policy.canUseCommunityAssets(policy.actorFromUser(user), communityId)) {
        return void res.status(403).json({ error: "You are not a member of this community" });
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
  }));
}
