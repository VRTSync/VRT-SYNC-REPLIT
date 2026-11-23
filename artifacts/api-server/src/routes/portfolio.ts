import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requireClient, requireClientOrAdmin } from "../auth";
import * as storage from "../storage";
import {
  resolvePortfolioOrg, clientPortfolioOrg, orgOwnsCommunity,
  orgOwnsGroup, orgOwnsGroupSet, orgOwnsCommunities,
} from "../policy";
import { isUniqueViolation } from "./errors";
import { route } from "./handler";

export function registerPortfolioRoutes(app: Express): void {
  // ── Portfolio endpoint (client_admin) ─────────────────────────────────────
  app.get("/api/portfolio/me", requireClient, route(async (req: Request, res: Response) => {
    try {
      const orgId = clientPortfolioOrg(req);
      if (!orgId) {
        return void res.status(403).json({ error: "No organization assigned to this user" });
      }
      const portfolio = await storage.getPortfolioForOrg(orgId);
      if (!portfolio) {
        return void res.status(404).json({ error: "Organization not found" });
      }
      res.json(portfolio);
    } catch (error) {
      console.error("Portfolio me error:", error);
      res.status(500).json({ error: "Failed to fetch portfolio" });
    }
  }));

  // ── Portfolio Phase 2b: read endpoints (requireClientOrAdmin) ────────────
  //
  // Org resolution:
  //   admin → uses ?organizationId= query param (400 if absent)
  //   client_admin → uses session.organizationId (ignores any param)
  // enforceOrgScoping already blocks client_admin cross-org param abuse.
  app.get("/api/portfolio/dashboard", requireClientOrAdmin, route(async (req: Request, res: Response) => {
    const t0 = Date.now();
    try {
      const resolved = resolvePortfolioOrg(req);
      if (!resolved.orgId) return void res.status((resolved as any).status).json({ error: (resolved as any).error });
      const data = await storage.getPortfolioDashboard(resolved.orgId);
      console.log(`[GET /api/portfolio/dashboard] org=${resolved.orgId} (${Date.now() - t0}ms)`);
      return void res.json(data);
    } catch (error) {
      console.error("Portfolio dashboard error:", error);
      return void res.status(500).json({ error: "Failed to fetch portfolio dashboard" });
    }
  }));

  app.get("/api/portfolio/branches", requireClientOrAdmin, route(async (req: Request, res: Response) => {
    const t0 = Date.now();
    try {
      const resolved = resolvePortfolioOrg(req);
      if (!resolved.orgId) return void res.status((resolved as any).status).json({ error: (resolved as any).error });
      const data = await storage.getPortfolioBranches(resolved.orgId);
      console.log(`[GET /api/portfolio/branches] org=${resolved.orgId} count=${data.length} (${Date.now() - t0}ms)`);
      return void res.json(data);
    } catch (error) {
      console.error("Portfolio branches error:", error);
      return void res.status(500).json({ error: "Failed to fetch portfolio branches" });
    }
  }));

  app.get("/api/portfolio/branches/:communityId", requireClientOrAdmin, route(async (req: Request, res: Response) => {
    const t0 = Date.now();
    try {
      const resolved = resolvePortfolioOrg(req);
      if (!resolved.orgId) return void res.status((resolved as any).status).json({ error: (resolved as any).error });
      const communityId = req.params.communityId as string;
      const data = await storage.getPortfolioBranchDetail(resolved.orgId, communityId);
      if (!data) {
        // null means community not found or doesn't belong to this org
        return void res.status(403).json({ error: "Branch not found or does not belong to this organization" });
      }
      console.log(`[GET /api/portfolio/branches/:communityId] org=${resolved.orgId} branch=${communityId} (${Date.now() - t0}ms)`);
      return void res.json(data);
    } catch (error) {
      console.error("Portfolio branch detail error:", error);
      return void res.status(500).json({ error: "Failed to fetch branch detail" });
    }
  }));

  app.get("/api/portfolio/map", requireClientOrAdmin, route(async (req: Request, res: Response) => {
    const t0 = Date.now();
    try {
      const resolved = resolvePortfolioOrg(req);
      if (!resolved.orgId) return void res.status((resolved as any).status).json({ error: (resolved as any).error });
      const data = await storage.getBranchMapPoints(resolved.orgId);
      console.log(`[GET /api/portfolio/map] org=${resolved.orgId} mapped=${data.branches.length} unmapped=${data.unmapped.length} (${Date.now() - t0}ms)`);
      return void res.json(data);
    } catch (error) {
      console.error("Portfolio map error:", error);
      return void res.status(500).json({ error: "Failed to fetch portfolio map data" });
    }
  }));

  app.get("/api/portfolio/water-savings/polygons", requireClientOrAdmin, route(async (req: Request, res: Response) => {
    const t0 = Date.now();
    try {
      const resolved = resolvePortfolioOrg(req);
      if (!resolved.orgId) return void res.status((resolved as any).status).json({ error: (resolved as any).error });

      const communityId = typeof req.query.communityId === "string" ? req.query.communityId : null;
      if (communityId) {
        const community = await storage.getWaterSavingsCommunity(resolved.orgId, communityId);
        if (!community) return void res.status(404).json({ error: "Location not found" });
      }

      const allData = await storage.getPortfolioXeriscapePolygons(resolved.orgId);
      const data = communityId
        ? {
            ...allData,
            features: allData.features.filter((feature) => feature.properties.communityId === communityId),
            unresolved: allData.unresolved.filter((item) => item.communityId === communityId),
            byCommunity: allData.byCommunity.filter((item) => item.communityId === communityId),
          }
        : allData;
      if (communityId) {
        data.assetsFound = data.byCommunity.reduce((sum, item) => sum + item.assetsFound, 0);
        data.featuresResolved = data.features.length;
        data.sqFtResolved = data.byCommunity.reduce((sum, item) => sum + item.sqFtResolved, 0);
      }
      req.log.info(
        {
          organizationId: resolved.orgId,
          communityId,
          communityCount: data.byCommunity.length,
          assetsFound: data.assetsFound,
          featuresResolved: data.featuresResolved,
          elapsedMs: Date.now() - t0,
        },
        "portfolio xeriscape polygons: resolution complete",
      );
      return void res.json(data);
    } catch (error) {
      req.log.error({ err: error }, "portfolio xeriscape polygons error");
      return void res.status(500).json({ error: "Failed to load portfolio xeriscape polygons" });
    }
  }));

  const waterSavingsAssumptionsSchema = z.object({
    costPerSf: z.coerce.number().nonnegative(),
    gallonsPerSfYear: z.coerce.number().nonnegative(),
    waterRatePerKGal: z.coerce.number().nonnegative(),
    maintenancePerSfYear: z.coerce.number().nonnegative(),
    rebatePerSf: z.coerce.number().nonnegative(),
  });
  const waterSavingsPinsSchema = z.record(z.string(), z.enum(["in", "out"]));
  const waterSavingsScenarioCreateSchema = z.object({
    name: z.string().trim().min(1).max(120),
    targetPct: z.coerce.number().min(0).max(100).default(20),
    tier: z.enum(["rock", "colorado"]).default("rock"),
    annualBudget: z.union([z.coerce.number().nonnegative(), z.null()]).optional(),
    assumptions: waterSavingsAssumptionsSchema,
    pins: waterSavingsPinsSchema.default({}),
    status: z.enum(["draft", "saved", "archived"]).default("draft"),
  });
  const waterSavingsScenarioPatchSchema = waterSavingsScenarioCreateSchema.partial();

  app.get("/api/portfolio/water-savings", requireClientOrAdmin, route(async (req: Request, res: Response) => {
    try {
      const resolved = resolvePortfolioOrg(req);
      if (!resolved.orgId) return void res.status((resolved as any).status).json({ error: (resolved as any).error });
      const [communitiesData, polygonData] = await Promise.all([
        storage.getWaterSavingsCommunities(resolved.orgId),
        storage.getPortfolioXeriscapePolygons(resolved.orgId),
      ]);
      const rollupByCommunity = new Map(
        polygonData.byCommunity.map((item) => [item.communityId, item]),
      );
      const communitiesWithTurf = communitiesData.map((community) => ({
        ...community,
        turf: rollupByCommunity.get(community.id) ?? {
          communityId: community.id,
          communityName: community.name,
          assetsFound: 0,
          featuresResolved: 0,
          sqFtResolved: 0,
          unresolvedCount: 0,
        },
      }));
      return void res.json({
        communities: communitiesWithTurf,
        totals: {
          assetsFound: polygonData.assetsFound,
          featuresResolved: polygonData.featuresResolved,
          sqFtResolved: polygonData.sqFtResolved,
          unresolvedCount: polygonData.unresolved.length,
        },
      });
    } catch (error) {
      req.log.error({ err: error }, "portfolio water savings summary error");
      return void res.status(500).json({ error: "Failed to load Water Savings summary" });
    }
  }));

  app.get("/api/portfolio/water-savings/communities/:communityId", requireClientOrAdmin, route(async (req: Request, res: Response) => {
    try {
      const resolved = resolvePortfolioOrg(req);
      if (!resolved.orgId) return void res.status((resolved as any).status).json({ error: (resolved as any).error });
      const communityId = req.params.communityId as string;
      const community = await storage.getWaterSavingsCommunity(resolved.orgId, communityId);
      if (!community) return void res.status(404).json({ error: "Location not found" });
      const polygons = await storage.getXeriscapeCommunityPolygons(communityId);
      return void res.json({ community, polygons });
    } catch (error) {
      req.log.error({ err: error }, "portfolio water savings location error");
      return void res.status(500).json({ error: "Failed to load Water Savings location" });
    }
  }));

  app.get("/api/portfolio/water-savings/scenarios", requireClientOrAdmin, route(async (req: Request, res: Response) => {
    try {
      const resolved = resolvePortfolioOrg(req);
      if (!resolved.orgId) return void res.status((resolved as any).status).json({ error: (resolved as any).error });
      return void res.json(await storage.listWaterSavingsScenarios(resolved.orgId));
    } catch (error) {
      req.log.error({ err: error }, "list Water Savings scenarios error");
      return void res.status(500).json({ error: "Failed to list Water Savings scenarios" });
    }
  }));

  app.get("/api/portfolio/water-savings/scenarios/:scenarioId", requireClientOrAdmin, route(async (req: Request, res: Response) => {
    try {
      const resolved = resolvePortfolioOrg(req);
      if (!resolved.orgId) return void res.status((resolved as any).status).json({ error: (resolved as any).error });
      const scenario = await storage.getWaterSavingsScenario(resolved.orgId, req.params.scenarioId as string);
      if (!scenario) return void res.status(404).json({ error: "Scenario not found" });
      return void res.json(scenario);
    } catch (error) {
      req.log.error({ err: error }, "get Water Savings scenario error");
      return void res.status(500).json({ error: "Failed to load Water Savings scenario" });
    }
  }));

  app.post("/api/portfolio/water-savings/scenarios", requireClientOrAdmin, route(async (req: Request, res: Response) => {
    try {
      const resolved = resolvePortfolioOrg(req);
      if (!resolved.orgId) return void res.status((resolved as any).status).json({ error: (resolved as any).error });
      const parsed = waterSavingsScenarioCreateSchema.safeParse(req.body);
      if (!parsed.success) return void res.status(400).json({ error: parsed.error.flatten() });
      if (!await storage.waterSavingsPinsBelongToOrg(resolved.orgId, parsed.data.pins)) {
        return void res.status(404).json({ error: "One or more mapped areas were not found" });
      }
      const scenario = await storage.createWaterSavingsScenario({
        organizationId: resolved.orgId,
        name: parsed.data.name,
        targetPct: parsed.data.targetPct,
        tier: parsed.data.tier,
        annualBudget: parsed.data.annualBudget ?? null,
        assumptionsJson: parsed.data.assumptions,
        pinsJson: parsed.data.pins,
        status: parsed.data.status,
        createdBy: req.session.userId ?? null,
      });
      req.log.info(
        { organizationId: resolved.orgId, scenarioId: scenario.id },
        "create portfolio Water Savings scenario",
      );
      return void res.status(201).json(scenario);
    } catch (error) {
      req.log.error({ err: error }, "create Water Savings scenario error");
      return void res.status(500).json({ error: "Failed to create Water Savings scenario" });
    }
  }));

  app.patch("/api/portfolio/water-savings/scenarios/:scenarioId", requireClientOrAdmin, route(async (req: Request, res: Response) => {
    try {
      const resolved = resolvePortfolioOrg(req);
      if (!resolved.orgId) return void res.status((resolved as any).status).json({ error: (resolved as any).error });
      const scenarioId = req.params.scenarioId as string;
      const existing = await storage.getWaterSavingsScenario(resolved.orgId, scenarioId);
      if (!existing) return void res.status(404).json({ error: "Scenario not found" });
      const parsed = waterSavingsScenarioPatchSchema.safeParse(req.body);
      if (!parsed.success) return void res.status(400).json({ error: parsed.error.flatten() });
      if (parsed.data.pins && !await storage.waterSavingsPinsBelongToOrg(resolved.orgId, parsed.data.pins)) {
        return void res.status(404).json({ error: "One or more mapped areas were not found" });
      }
      const updates: Parameters<typeof storage.updateWaterSavingsScenario>[2] = {};
      if (parsed.data.name !== undefined) updates.name = parsed.data.name;
      if (parsed.data.targetPct !== undefined) updates.targetPct = parsed.data.targetPct;
      if (parsed.data.tier !== undefined) updates.tier = parsed.data.tier;
      if (parsed.data.annualBudget !== undefined) updates.annualBudget = parsed.data.annualBudget;
      if (parsed.data.assumptions !== undefined) updates.assumptionsJson = parsed.data.assumptions;
      if (parsed.data.pins !== undefined) updates.pinsJson = parsed.data.pins;
      if (parsed.data.status !== undefined) updates.status = parsed.data.status;
      const scenario = await storage.updateWaterSavingsScenario(resolved.orgId, scenarioId, updates);
      req.log.info(
        { organizationId: resolved.orgId, scenarioId },
        "update portfolio Water Savings scenario",
      );
      return void res.json(scenario);
    } catch (error) {
      req.log.error({ err: error }, "update Water Savings scenario error");
      return void res.status(500).json({ error: "Failed to update Water Savings scenario" });
    }
  }));

  app.delete("/api/portfolio/water-savings/scenarios/:scenarioId", requireClientOrAdmin, route(async (req: Request, res: Response) => {
    try {
      const resolved = resolvePortfolioOrg(req);
      if (!resolved.orgId) return void res.status((resolved as any).status).json({ error: (resolved as any).error });
      const scenarioId = req.params.scenarioId as string;
      if (!await storage.getWaterSavingsScenario(resolved.orgId, scenarioId)) {
        return void res.status(404).json({ error: "Scenario not found" });
      }
      await storage.deleteWaterSavingsScenario(resolved.orgId, scenarioId);
      req.log.info(
        { organizationId: resolved.orgId, scenarioId },
        "delete portfolio Water Savings scenario",
      );
      return void res.status(204).end();
    } catch (error) {
      req.log.error({ err: error }, "delete Water Savings scenario error");
      return void res.status(500).json({ error: "Failed to delete Water Savings scenario" });
    }
  }));

  app.get("/api/portfolio/branches/:communityId/layers/:layerId/geojson", requireClientOrAdmin, route(async (req: Request, res: Response) => {
    const t0 = Date.now();
    try {
      const resolved = resolvePortfolioOrg(req);
      if (!resolved.orgId) return void res.status((resolved as any).status).json({ error: (resolved as any).error });
      const { communityId, layerId } = req.params as { communityId: string; layerId: string };

      // Verify the community belongs to this org (no existence leak)
      const community = await storage.getCommunityById(communityId);
      if (!orgOwnsCommunity(resolved.orgId, community)) {
        return void res.status(403).json({ error: "Branch not found or does not belong to this organization" });
      }

      // Verify the layer belongs to this community (404 — existence leak within org is acceptable)
      const layer = await storage.getMapLayerById(layerId);
      if (!layer || layer.communityId !== communityId) {
        return void res.status(404).json({ error: "Layer not found for this branch" });
      }

      if (!layer.geojsonData) {
        return void res.json(null);
      }

      console.log(`[GET /api/portfolio/branches/:communityId/layers/:layerId/geojson] org=${resolved.orgId} community=${communityId} layer=${layerId} (${Date.now() - t0}ms)`);
      res.setHeader("Content-Type", "application/json");
      return void res.send(layer.geojsonData);
    } catch (error) {
      console.error("Portfolio branch layer geojson error:", error);
      return void res.status(500).json({ error: "Failed to fetch layer GeoJSON" });
    }
  }));

  app.get("/api/portfolio/branches/:communityId/controllers", requireClientOrAdmin, route(async (req: Request, res: Response) => {
    const t0 = Date.now();
    try {
      const resolved = resolvePortfolioOrg(req);
      if (!resolved.orgId) return void res.status((resolved as any).status).json({ error: (resolved as any).error });
      const communityId = req.params.communityId as string;

      // Verify the community belongs to this org (no existence leak)
      const community = await storage.getCommunityById(communityId);
      if (!orgOwnsCommunity(resolved.orgId, community)) {
        return void res.status(403).json({ error: "Branch not found or does not belong to this organization" });
      }

      // Same shape as GET /api/communities/:id/controllers
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

      console.log(`[GET /api/portfolio/branches/:communityId/controllers] org=${resolved.orgId} community=${communityId} count=${result.length} (${Date.now() - t0}ms)`);
      return void res.json(result);
    } catch (error) {
      console.error("Portfolio branch controllers error:", error);
      return void res.status(500).json({ error: "Failed to fetch branch controllers" });
    }
  }));

  app.get("/api/portfolio/groups", requireClientOrAdmin, route(async (req: Request, res: Response) => {
    const t0 = Date.now();
    try {
      const resolved = resolvePortfolioOrg(req);
      if (!resolved.orgId) return void res.status((resolved as any).status).json({ error: (resolved as any).error });
      const data = await storage.getPortfolioGroups(resolved.orgId);
      console.log(`[GET /api/portfolio/groups] org=${resolved.orgId} count=${data.length} (${Date.now() - t0}ms)`);
      return void res.json(data);
    } catch (error) {
      console.error("Portfolio groups error:", error);
      return void res.status(500).json({ error: "Failed to fetch portfolio groups" });
    }
  }));

  app.get("/api/portfolio/analytics", requireClientOrAdmin, route(async (req: Request, res: Response) => {
    const t0 = Date.now();
    try {
      const resolved = resolvePortfolioOrg(req);
      if (!resolved.orgId) return void res.status((resolved as any).status).json({ error: (resolved as any).error });
      const data = await storage.getPortfolioAnalytics(resolved.orgId);
      console.log(`[GET /api/portfolio/analytics] org=${resolved.orgId} locations=${data.locations.length} (${Date.now() - t0}ms)`);
      return void res.json(data);
    } catch (error) {
      console.error("Portfolio analytics error:", error);
      return void res.status(500).json({ error: "Failed to fetch portfolio analytics" });
    }
  }));

  app.get("/api/portfolio/group-sets", requireClientOrAdmin, route(async (req: Request, res: Response) => {
    const t0 = Date.now();
    try {
      const resolved = resolvePortfolioOrg(req);
      if (!resolved.orgId) return void res.status((resolved as any).status).json({ error: (resolved as any).error });
      const data = await storage.getPortfolioGroupSets(resolved.orgId);
      console.log(`[GET /api/portfolio/group-sets] org=${resolved.orgId} count=${data.length} (${Date.now() - t0}ms)`);
      return void res.json(data);
    } catch (error) {
      console.error("Portfolio group sets error:", error);
      return void res.status(500).json({ error: "Failed to fetch portfolio group sets" });
    }
  }));

  // ── Portfolio: Group write routes (requireClientOrAdmin) ─────────────────
  // These mirror /api/admin/* group routes but scope every action to the
  // caller's org (via resolvePortfolioOrg) and verify group/set ownership
  // before acting.  The admin routes at 6936-7119 are untouched.

  app.post("/api/portfolio/groups", requireClientOrAdmin, route(async (req: Request, res: Response) => {
    try {
      const resolved = resolvePortfolioOrg(req);
      if (!resolved.orgId) return void res.status((resolved as any).status).json({ error: (resolved as any).error });
      const orgId = resolved.orgId;
      const { name, color, sortOrder, setId } = req.body;
      if (!name || typeof name !== "string" || name.trim().length === 0) {
        return void res.status(400).json({ error: "name is required" });
      }
      // Verify setId belongs to this org if provided
      if (setId) {
        if (!await orgOwnsGroupSet(orgId, setId)) {
          return void res.status(403).json({ error: "Group set not found or does not belong to this organization" });
        }
      }
      let group = await storage.createBranchGroup(orgId, {
        name: name.trim(),
        color: color ?? undefined,
        sortOrder: sortOrder ?? 0,
      });
      if (setId) {
        group = (await storage.updateBranchGroup(group.id, { setId })) ?? group;
      }
      return void res.status(201).json(group);
    } catch (error) {
      console.error("Portfolio create group error:", error);
      return void res.status(500).json({ error: "Failed to create group" });
    }
  }));

  app.patch("/api/portfolio/groups/:groupId", requireClientOrAdmin, route(async (req: Request, res: Response) => {
    const groupId = req.params.groupId as string;
    try {
      const resolved = resolvePortfolioOrg(req);
      if (!resolved.orgId) return void res.status((resolved as any).status).json({ error: (resolved as any).error });
      const orgId = resolved.orgId;
      if (!await orgOwnsGroup(orgId, groupId)) {
        return void res.status(403).json({ error: "Group not found or does not belong to this organization" });
      }
      const { name, color, sortOrder, setId } = req.body;
      // Validate setId belongs to this org before accepting it.
      if (setId !== undefined && setId !== null) {
        if (!await orgOwnsGroupSet(orgId, setId)) {
          return void res.status(403).json({ error: "Group set not found or does not belong to this organization" });
        }
      }
      const updates: Record<string, unknown> = {};
      if (name !== undefined) updates.name = name;
      if (color !== undefined) updates.color = color;
      if (sortOrder !== undefined) updates.sortOrder = sortOrder;
      if (setId !== undefined) updates.setId = setId;
      const group = await storage.updateBranchGroup(groupId, updates as any);
      if (!group) return void res.status(404).json({ error: "Group not found" });
      return void res.json(group);
    } catch (error) {
      if (isUniqueViolation(error, "branch_group_members_one_per_set_idx") && req.body?.setId) {
        return void res.status(409).json({ error: "Some locations in this group already belong to another group in that set. Move them or choose a different set." });
      }
      console.error("Portfolio update group error:", error);
      return void res.status(500).json({ error: "Failed to update group" });
    }
  }));

  app.delete("/api/portfolio/groups/:groupId", requireClientOrAdmin, route(async (req: Request, res: Response) => {
    const groupId = req.params.groupId as string;
    try {
      const resolved = resolvePortfolioOrg(req);
      if (!resolved.orgId) return void res.status((resolved as any).status).json({ error: (resolved as any).error });
      const orgId = resolved.orgId;
      if (!await orgOwnsGroup(orgId, groupId)) {
        return void res.status(403).json({ error: "Group not found or does not belong to this organization" });
      }
      const deleted = await storage.deleteBranchGroup(groupId);
      if (!deleted) return void res.status(404).json({ error: "Group not found" });
      return void res.status(204).send();
    } catch (error) {
      console.error("Portfolio delete group error:", error);
      return void res.status(500).json({ error: "Failed to delete group" });
    }
  }));

  app.put("/api/portfolio/groups/:groupId/members", requireClientOrAdmin, route(async (req: Request, res: Response) => {
    const groupId = req.params.groupId as string;
    try {
      const resolved = resolvePortfolioOrg(req);
      if (!resolved.orgId) return void res.status((resolved as any).status).json({ error: (resolved as any).error });
      const orgId = resolved.orgId;
      if (!await orgOwnsGroup(orgId, groupId)) {
        return void res.status(403).json({ error: "Group not found or does not belong to this organization" });
      }
      const { communityIds } = req.body;
      if (!Array.isArray(communityIds)) {
        return void res.status(400).json({ error: "communityIds must be an array" });
      }
      // Validate every supplied community belongs to the caller's org.
      // This prevents a client_admin from attaching another org's locations.
      if ((communityIds as string[]).length > 0) {
        if (!await orgOwnsCommunities(orgId, communityIds as string[])) {
          return void res.status(403).json({ error: "One or more locations do not belong to this organization" });
        }
      }
      // Pass directly to setBranchGroupMembers — it handles move semantics atomically.
      await storage.setBranchGroupMembers(groupId, communityIds as string[]);
      return void res.json({ ok: true });
    } catch (error) {
      if (isUniqueViolation(error, "branch_group_members_one_per_set_idx")) {
        return void res.status(409).json({ error: "A location already belongs to another group in the same set." });
      }
      console.error("Portfolio set group members error:", error);
      return void res.status(500).json({ error: "Failed to set group members" });
    }
  }));

  app.post("/api/portfolio/group-sets", requireClientOrAdmin, route(async (req: Request, res: Response) => {
    try {
      const resolved = resolvePortfolioOrg(req);
      if (!resolved.orgId) return void res.status((resolved as any).status).json({ error: (resolved as any).error });
      const orgId = resolved.orgId;
      const { name, sortOrder } = req.body;
      if (!name || typeof name !== "string" || name.trim().length === 0) {
        return void res.status(400).json({ error: "name is required" });
      }
      const set = await storage.createGroupSet(orgId, { name: name.trim(), sortOrder: sortOrder ?? 0 });
      return void res.status(201).json(set);
    } catch (error) {
      if (isUniqueViolation(error, "branch_group_sets_org_name_unique")) {
        return void res.status(409).json({ error: `A group set named "${String(req.body?.name).trim()}" already exists in this organization.` });
      }
      console.error("Portfolio create group set error:", error);
      return void res.status(500).json({ error: "Failed to create group set" });
    }
  }));

  app.patch("/api/portfolio/group-sets/:setId", requireClientOrAdmin, route(async (req: Request, res: Response) => {
    const setId = req.params.setId as string;
    try {
      const resolved = resolvePortfolioOrg(req);
      if (!resolved.orgId) return void res.status((resolved as any).status).json({ error: (resolved as any).error });
      const orgId = resolved.orgId;
      if (!await orgOwnsGroupSet(orgId, setId)) {
        return void res.status(403).json({ error: "Group set not found or does not belong to this organization" });
      }
      const { name, sortOrder } = req.body;
      const updates: Record<string, unknown> = {};
      if (name !== undefined) {
        if (typeof name !== "string" || name.trim().length === 0) {
          return void res.status(400).json({ error: "name must be a non-empty string" });
        }
        updates.name = name.trim();
      }
      if (sortOrder !== undefined) updates.sortOrder = sortOrder;
      const set = await storage.updateGroupSet(setId, updates as any);
      if (!set) return void res.status(404).json({ error: "Group set not found" });
      return void res.json(set);
    } catch (error) {
      if (isUniqueViolation(error, "branch_group_sets_org_name_unique")) {
        return void res.status(409).json({ error: `A group set named "${String(req.body?.name).trim()}" already exists in this organization.` });
      }
      console.error("Portfolio update group set error:", error);
      return void res.status(500).json({ error: "Failed to update group set" });
    }
  }));

  app.delete("/api/portfolio/group-sets/:setId", requireClientOrAdmin, route(async (req: Request, res: Response) => {
    const setId = req.params.setId as string;
    try {
      const resolved = resolvePortfolioOrg(req);
      if (!resolved.orgId) return void res.status((resolved as any).status).json({ error: (resolved as any).error });
      const orgId = resolved.orgId;
      if (!await orgOwnsGroupSet(orgId, setId)) {
        return void res.status(403).json({ error: "Group set not found or does not belong to this organization" });
      }
      // ON DELETE SET NULL cascades to branch_groups.set_id via FK trigger;
      // re-render surfaces orphaned groups in the "Ungrouped" bucket.
      const deleted = await storage.deleteGroupSet(setId);
      if (!deleted) return void res.status(404).json({ error: "Group set not found" });
      return void res.status(204).send();
    } catch (error) {
      console.error("Portfolio delete group set error:", error);
      return void res.status(500).json({ error: "Failed to delete group set" });
    }
  }));
}
