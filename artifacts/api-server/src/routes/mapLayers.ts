import type { Express, Request, Response } from "express";
import { requireAuth, requireAdmin } from "../auth";
import * as storage from "../storage";
import * as policy from "../policy";
import { insertMapLayerSchema, updateMapLayerSchema } from "@workspace/db";
import { syncAssetsFromLayer, syncIrrigationAssets, previewSyncFromLayer, getUnlinkedFeatures, getGeoJsonCollisions, resolveAssetType, extractFeatureId, extractLabel, resolveGeometry, computeAreaSqFt } from "../assetSync";
import { getAssetTypeCache, validateLayerKeysFromCatalogue } from "../assetTypeCache";
import { parseIrrigationKml } from "../kmlIrrigationParser";
import { validateLayerGeoJSON } from "../layerValidation";
import { CANONICAL_LAYER_HIERARCHY } from "../layerKeys";
import { convertKmlToGeojson, normalizeGeojsonFeatureIds } from "../kmlConverter";
import { getDefaultLayerColor } from "@workspace/layer-colors";
import { upload } from "./upload";
import { isUniqueViolation } from "./errors";
import { route } from "./handler";

export function registerMapLayerRoutes(app: Express): void {
  /**
   * Validates that (layerKey, subLayerKey) resolves to an active asset type in the
   * asset_types catalogue. Returns null on success, or an error message on failure.
   * Layers that legitimately produce no assets (e.g. "outline") are exempt.
   */
  async function validateAssetTypeMapping(layerKey: string, subLayerKey: string): Promise<string | null> {
    if (layerKey === "outline") return null;
    const resolvedType = await resolveAssetType(layerKey, subLayerKey);
    if (!resolvedType) {
      return `No asset type mapping found for layer "${layerKey}/${subLayerKey}". Upload rejected to prevent silent data loss. Add this sub-layer to the asset_types catalogue first.`;
    }
    return null;
  }

  app.get("/api/map-layers", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const communityId = req.query.communityId as string;
      if (!communityId) return void res.status(400).json({ error: "communityId is required" });
      const actor = policy.actorFromUser(req.currentUser!);
      if (!await policy.canUseCommunityMapData(actor, communityId)) {
        return void res.status(403).json({ error: "Not a member of this community" });
      }
      const layerKey = req.query.layerKey as string | undefined;
      const layers = await storage.getMapLayersByCommunity(communityId, layerKey);
      const result = layers.map(({ geojsonData, ...rest }) => rest);
      res.json(result);
    } catch (error) {
      console.error("Get map layers error:", error);
      res.status(500).json({ error: "Failed to fetch map layers" });
    }
  }));

  app.get("/api/map-layers/:id/geojson", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const layer = await storage.getMapLayerById(req.params.id as string);
      if (!layer) return void res.status(404).json({ error: "Layer not found" });
      const actor = policy.actorFromUser(req.currentUser!);
      if (!await policy.canUseCommunityMapData(actor, layer.communityId)) {
        return void res.status(403).json({ error: "Not a member of this community" });
      }
      if (!layer.geojsonData) return void res.json(null);
      res.setHeader("Content-Type", "application/json");
      res.send(layer.geojsonData);
    } catch (error) {
      console.error("Get geojson error:", error);
      res.status(500).json({ error: "Failed to fetch GeoJSON" });
    }
  }));

  app.get("/api/layer-hierarchy", requireAuth, route(async (_req: Request, res: Response) => {
    try {
      const types = await getAssetTypeCache();
      // Return catalogue-derived hierarchy grouped by layerKey, sorted by sortOrder.
      // The outline layer is structural (not in the catalogue) and is appended as-is.
      const hierarchy: Record<string, string[]> = {};
      for (const t of types.filter(t => t.isActive).sort((a, b) => a.sortOrder - b.sortOrder)) {
        if (!hierarchy[t.layerKey]) hierarchy[t.layerKey] = [];
        hierarchy[t.layerKey].push(t.subLayerKey);
      }
      hierarchy.outline = CANONICAL_LAYER_HIERARCHY.outline ?? ["community_boundary"];
      res.json(hierarchy);
    } catch (error) {
      // Fall back to hardcoded hierarchy on DB failure
      res.json(CANONICAL_LAYER_HIERARCHY);
    }
  }));

  app.post("/api/map-layers", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const parsed = insertMapLayerSchema.safeParse(req.body);
      if (!parsed.success) return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

      const keyValidation = await validateLayerKeysFromCatalogue(parsed.data.layerKey, parsed.data.subLayerKey);
      if (!keyValidation.valid) return void res.status(400).json({ error: keyValidation.error });

      const assetTypeError = await validateAssetTypeMapping(parsed.data.layerKey, parsed.data.subLayerKey);
      if (assetTypeError) return void res.status(400).json({ error: assetTypeError });

      if (!parsed.data.color) {
        const count = (await storage.getMapLayersByCommunity(parsed.data.communityId, parsed.data.layerKey)).length;
        parsed.data.color = getDefaultLayerColor(parsed.data.subLayerKey, count);
      }

      let featureCount = 0;
      let cachedCount: number | null = null;
      if (parsed.data.geojsonData) {
        try {
          const geo = JSON.parse(parsed.data.geojsonData);
          featureCount = geo.features?.length || 0;
          cachedCount = Array.isArray(geo.features) ? geo.features.length : null;
        } catch {}
      }
      const layer = await storage.createMapLayer(parsed.data, cachedCount);
      let syncResult = null;
      if (layer.geojsonData) {
        syncResult = await syncAssetsFromLayer(layer.communityId, layer.id, layer.layerKey, layer.subLayerKey, layer.geojsonData, req.session.userId!);
      }
      const { geojsonData, ...rest } = layer;
      res.status(201).json({ ...rest, featureCount, syncResult });
    } catch (error: any) {
      if (isUniqueViolation(error, "map_layers_community_layer_sub_idx")) {
        return void res.status(409).json({ error: "A layer with that key combination already exists" });
      }
      console.error("Create map layer error:", error);
      res.status(500).json({ error: "Failed to create map layer" });
    }
  }));

  app.post("/api/map-layers/upload-validate", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const { communityId, layerKey, subLayerKey, geojsonData } = req.body;
      if (!communityId || !layerKey || !subLayerKey) {
        return void res.status(400).json({ error: "communityId, layerKey, subLayerKey are required" });
      }

      const existingLayers = await storage.getMapLayersByCommunity(communityId, layerKey);
      const matchingLayer = existingLayers.find(l => l.subLayerKey === subLayerKey);

      if (matchingLayer) {
        const result = await previewSyncFromLayer(communityId, matchingLayer.id, layerKey, subLayerKey, geojsonData || null);
        return void res.json(result);
      }

      let featureCount = 0;
      try {
        const parsed = JSON.parse(geojsonData);
        featureCount = parsed.features?.length || 0;
      } catch {}

      res.json({
        featureCount,
        wouldCreateCount: featureCount,
        wouldUpdateCount: 0,
        wouldArchiveCount: 0,
        wouldSkipCount: 0,
        wouldCreateSamples: [],
        wouldArchiveSamples: [],
      });
    } catch (error) {
      console.error("Upload validate error:", error);
      res.status(500).json({ error: "Failed to generate preview" });
    }
  }));

  app.post("/api/map-layers/upload", requireAdmin, upload.single("file"), route(async (req: Request, res: Response) => {
    try {
      const { communityId, layerKey, subLayerKey, displayName } = req.body;
      if (!communityId || !layerKey || !subLayerKey || !displayName) {
        return void res.status(400).json({ error: "communityId, layerKey, subLayerKey, and displayName are required" });
      }

      const keyValidation = await validateLayerKeysFromCatalogue(layerKey, subLayerKey);
      if (!keyValidation.valid) return void res.status(400).json({ error: keyValidation.error });

      const assetTypeError = await validateAssetTypeMapping(layerKey, subLayerKey);
      if (assetTypeError) return void res.status(400).json({ error: assetTypeError });

      let geojsonData: string;
      let sourceFormat: "kml" | "geojson" = "geojson";

      if (req.file) {
        const fileContent = req.file.buffer.toString("utf-8");
        const fileName = (req.file.originalname || "").toLowerCase();

        if (fileName.endsWith(".kml")) {
          sourceFormat = "kml";
          const result = convertKmlToGeojson(fileContent);
          geojsonData = JSON.stringify(result.geojson);
        } else {
          sourceFormat = "geojson";
          const result = normalizeGeojsonFeatureIds(fileContent);
          geojsonData = JSON.stringify(result.geojson);
        }
      } else if (req.body.geojsonData) {
        const raw = req.body.geojsonData;
        const result = normalizeGeojsonFeatureIds(raw);
        geojsonData = JSON.stringify(result.geojson);
      } else {
        return void res.status(400).json({ error: "No file or GeoJSON data provided" });
      }

      const uploadedFeatures: any[] = JSON.parse(geojsonData).features || [];
      const featureCount = uploadedFeatures.length;

      // --- Explicit layerId replace path (used by outline flow) ---
      const existingLayerById = req.body.layerId ? await storage.getMapLayerById(req.body.layerId) : null;
      if (existingLayerById) {
        const version = parseInt(req.body.version || "1", 10);
        const updated = await storage.updateMapLayer(existingLayerById.id, version, {
          displayName,
          sourceFormat,
          geojsonData,
        }, Array.isArray(uploadedFeatures) ? featureCount : null);
        if (!updated) {
          return void res.status(409).json({
            error: "Conflict: layer was modified. Please refresh and try again.",
            code: "VERSION_CONFLICT",
          });
        }
        const syncResult = await syncAssetsFromLayer(updated.communityId, updated.id, updated.layerKey, updated.subLayerKey, updated.geojsonData, req.session.userId!);
        const { geojsonData: _, ...rest } = updated;
        return void res.json({ ...rest, featureCount, syncResult });
      }

      // --- Conflict pre-check by (communityId, layerKey, subLayerKey) ---
      const mode = req.body.mode as "replace" | "merge" | undefined;
      const existingLayer = await storage.getMapLayerByKeys(communityId, layerKey, subLayerKey);

      if (existingLayer && !mode) {
        // No explicit mode sent — return conflict info so the client can ask
        let existingFeatureCount = 0;
        if (existingLayer.geojsonData) {
          try {
            existingFeatureCount = JSON.parse(existingLayer.geojsonData).features?.length || 0;
          } catch {}
        }
        return void res.status(409).json({
          code: "LAYER_EXISTS",
          existing: {
            id: existingLayer.id,
            displayName: existingLayer.displayName,
            featureCount: existingFeatureCount,
            updatedAt: existingLayer.updatedAt,
            version: existingLayer.version,
          },
        });
      }

      if (existingLayer && mode === "replace") {
        // Version-checked replace
        const version = parseInt(req.body.version || String(existingLayer.version), 10);
        const updated = await storage.updateMapLayer(existingLayer.id, version, {
          displayName,
          sourceFormat,
          geojsonData,
        }, Array.isArray(uploadedFeatures) ? featureCount : null);
        if (!updated) {
          return void res.status(409).json({
            error: "Conflict: layer was modified. Please refresh and try again.",
            code: "VERSION_CONFLICT",
          });
        }
        const syncResult = await syncAssetsFromLayer(updated.communityId, updated.id, updated.layerKey, updated.subLayerKey, updated.geojsonData, req.session.userId!);
        const { geojsonData: _, ...rest } = updated;
        return void res.json({ ...rest, featureCount, syncResult, mode: "replace" });
      }

      if (existingLayer && mode === "merge") {
        // Merge: append uploaded features to existing, de-duplicate by feature id
        let existingFeatures: any[] = [];
        if (existingLayer.geojsonData) {
          try {
            existingFeatures = JSON.parse(existingLayer.geojsonData).features || [];
          } catch {}
        }
        const existingIds = new Set(existingFeatures.map((f: any) => f.id ?? f.properties?.featureId).filter(Boolean));
        let featuresAdded = 0;
        let featuresSkipped = 0;
        const mergedFeatures = [...existingFeatures];
        for (const f of uploadedFeatures) {
          const fid = f.id ?? f.properties?.featureId;
          if (fid && existingIds.has(fid)) {
            featuresSkipped++;
          } else {
            mergedFeatures.push(f);
            if (fid) existingIds.add(fid);
            featuresAdded++;
          }
        }
        const mergedGeojson = JSON.stringify({ type: "FeatureCollection", features: mergedFeatures });
        const version = parseInt(req.body.version || String(existingLayer.version), 10);
        const updated = await storage.updateMapLayer(existingLayer.id, version, {
          displayName: displayName || existingLayer.displayName,
          sourceFormat,
          geojsonData: mergedGeojson,
        }, mergedFeatures.length);
        if (!updated) {
          return void res.status(409).json({
            error: "Conflict: layer was modified. Please refresh and try again.",
            code: "VERSION_CONFLICT",
          });
        }
        const syncResult = await syncAssetsFromLayer(updated.communityId, updated.id, updated.layerKey, updated.subLayerKey, updated.geojsonData, req.session.userId!);
        const { geojsonData: _, ...rest } = updated;
        return void res.json({ ...rest, featureCount: mergedFeatures.length, featuresAdded, featuresSkipped, syncResult, mode: "merge" });
      }

      // --- No existing layer: standard insert ---
      const uploadCount = (await storage.getMapLayersByCommunity(communityId, layerKey)).length;
      const autoColor = getDefaultLayerColor(subLayerKey, uploadCount);
      const layer = await storage.createMapLayer({
        communityId,
        layerKey,
        subLayerKey,
        displayName,
        sourceFormat,
        geojsonData,
        color: autoColor,
      }, Array.isArray(uploadedFeatures) ? featureCount : null);
      const syncResult = await syncAssetsFromLayer(layer.communityId, layer.id, layer.layerKey, layer.subLayerKey, layer.geojsonData, req.session.userId!);
      const { geojsonData: _, ...rest } = layer;
      return void res.status(201).json({ ...rest, featureCount, syncResult });
    } catch (error: any) {
      if (isUniqueViolation(error, "map_layers_community_layer_sub_idx")) {
        return void res.status(409).json({ error: "A layer with that key combination already exists for this community" });
      }
      if (req.log) { req.log.error({ err: error }, "Map layer upload error"); } else { console.error("Map layer upload error:", error); }
      res.status(500).json({ error: "Failed to process upload" });
    }
  }));

  // Preview-only endpoint: parse KML and return summary without writing anything
  app.post("/api/map-layers/preview-irrigation", requireAdmin, upload.single("file"), route(async (req: Request, res: Response) => {
    try {
      const { communityId } = req.body;
      if (!communityId) return void res.status(400).json({ error: "communityId is required" });
      if (!req.file) return void res.status(400).json({ error: "KML file is required" });

      const fileContent = req.file.buffer.toString("utf-8");
      const fileName = (req.file.originalname || "").toLowerCase();
      if (!fileName.endsWith(".kml")) {
        return void res.status(400).json({ error: "Only KML files are supported" });
      }

      const parseResult = parseIrrigationKml(fileContent);

      // Summarise multi-zone valve boxes (boxes with >1 zone)
      const multiZoneBoxes: { label: string; zones: number[] }[] = [];
      for (const ctrl of parseResult.controllers) {
        const boxMap = new Map<string, { label: string; zones: number[] }>();
        for (const z of ctrl.zones) {
          if (!z.valveBoxRef) continue;
          if (!boxMap.has(z.valveBoxRef)) {
            boxMap.set(z.valveBoxRef, { label: z.valveBoxLabel || z.valveBoxRef, zones: [] });
          }
          if (z.zoneNumber != null) boxMap.get(z.valveBoxRef)!.zones.push(z.zoneNumber);
        }
        for (const box of boxMap.values()) {
          if (box.zones.length > 1) multiZoneBoxes.push(box);
        }
      }

      // Sibling asset counts by type
      const siblingCounts: Record<string, number> = {};
      for (const a of parseResult.siblingAssets) {
        siblingCounts[a.assetType] = (siblingCounts[a.assetType] || 0) + 1;
      }

      const controllerSummaries = parseResult.controllers.map(ctrl => ({
        name: ctrl.name,
        featureRef: ctrl.featureRef,
        totalDeclaredZones: ctrl.totalDeclaredZones,
        mappedZoneCount: ctrl.zones.filter(z => z.lat != null).length,
        unmappedZoneCount: ctrl.zones.filter(z => z.lat == null).length,
        zoneNumbers: ctrl.zones.map(z => z.zoneNumber).filter(Boolean),
      }));

      res.json({
        controllers: controllerSummaries,
        totalMappedZones: parseResult.controllers.reduce((s, c) => s + c.zones.filter(z => z.lat != null).length, 0),
        totalUnmappedZones: parseResult.controllers.reduce((s, c) => s + c.zones.filter(z => z.lat == null).length, 0),
        multiZoneBoxes,
        siblingAssets: siblingCounts,
        warnings: parseResult.warnings,
      });
    } catch (error: any) {
      req.log.error({ err: error }, "Irrigation preview error");
      res.status(500).json({ error: "Failed to parse irrigation KML" });
    }
  }));

  app.post("/api/map-layers/upload-irrigation", requireAdmin, upload.single("file"), route(async (req: Request, res: Response) => {
    try {
      const { communityId, displayName, totalZonesOverride: totalZonesOverrideRaw } = req.body;
      if (!communityId) {
        return void res.status(400).json({ error: "communityId is required" });
      }

      if (!req.file) {
        return void res.status(400).json({ error: "KML file is required" });
      }

      const fileContent = req.file.buffer.toString("utf-8");
      const fileName = (req.file.originalname || "").toLowerCase();

      if (!fileName.endsWith(".kml")) {
        return void res.status(400).json({ error: "Only KML files are supported for irrigation controller+zone upload" });
      }

      // Parse per-controller totalZones overrides from the UI
      let totalZonesOverride: Record<string, number> | undefined;
      if (totalZonesOverrideRaw) {
        try {
          totalZonesOverride = JSON.parse(totalZonesOverrideRaw);
        } catch { /* ignore malformed override */ }
      }

      const parseResult = parseIrrigationKml(fileContent, totalZonesOverride);

      if (parseResult.controllers.length === 0 && parseResult.siblingAssets.length === 0) {
        return void res.status(400).json({
          error: "No controller/zone data found in this KML file. Make sure the file contains controller folders with zone placemarks.",
          warnings: parseResult.warnings,
        });
      }

      const controllerDisplayName = displayName || "Controllers";
      const zoneDisplayName = displayName
        ? displayName.replace(/controller/i, "Zone").replace(/Controller/i, "Zone")
        : "Zones";

      const existingLayers = await storage.getMapLayersByCommunity(communityId, "irrigation");
      let controllerLayer = existingLayers.find(l => l.subLayerKey === "controller");
      let zoneLayer = existingLayers.find(l => l.subLayerKey === "zone");

      const controllerGeojsonStr = JSON.stringify(parseResult.controllerGeojson);
      const zoneGeojsonStr = JSON.stringify(parseResult.zoneGeojson);

      const irrLayerCount = existingLayers.length;

      if (controllerLayer) {
        const updated = await storage.updateMapLayer(controllerLayer.id, controllerLayer.version, {
          displayName: controllerDisplayName,
          sourceFormat: "kml",
          geojsonData: controllerGeojsonStr,
        }, parseResult.controllerGeojson.features.length);
        if (updated) controllerLayer = updated;
      } else {
        controllerLayer = await storage.createMapLayer({
          communityId,
          layerKey: "irrigation",
          subLayerKey: "controller",
          displayName: controllerDisplayName,
          sourceFormat: "kml",
          geojsonData: controllerGeojsonStr,
          color: getDefaultLayerColor("controller", irrLayerCount),
        }, parseResult.controllerGeojson.features.length);
      }

      if (zoneLayer) {
        const updated = await storage.updateMapLayer(zoneLayer.id, zoneLayer.version, {
          displayName: zoneDisplayName.includes("Zone") ? zoneDisplayName : "Zones",
          sourceFormat: "kml",
          geojsonData: zoneGeojsonStr,
        }, parseResult.zoneGeojson.features.length);
        if (updated) zoneLayer = updated;
      } else {
        zoneLayer = await storage.createMapLayer({
          communityId,
          layerKey: "irrigation",
          subLayerKey: "zone",
          displayName: "Zones",
          sourceFormat: "kml",
          geojsonData: zoneGeojsonStr,
          color: getDefaultLayerColor("zone", irrLayerCount + 1),
        }, parseResult.zoneGeojson.features.length);
      }

      // Ensure sibling sub-layers exist and collect their IDs
      const SIBLING_SUBLAYER_DISPLAY: Record<string, string> = {
        isolation_valve: "Gate Valves",
        quick_connect: "Quick Connects",
        backflow: "Backflow",
        wire_splice: "Wire Splices",
      };

      const siblingLayerMap = new Map<string, string>(); // subLayerKey → layerId
      const siblingSubLayers = [...new Set(parseResult.siblingAssets.map(a => a.subLayerKey))];
      for (const subLayerKey of siblingSubLayers) {
        let layer = existingLayers.find(l => l.subLayerKey === subLayerKey);
        if (!layer) {
          layer = await storage.createMapLayer({
            communityId,
            layerKey: "irrigation",
            subLayerKey,
            displayName: SIBLING_SUBLAYER_DISPLAY[subLayerKey] || subLayerKey,
            sourceFormat: "kml",
            color: getDefaultLayerColor(subLayerKey, irrLayerCount + siblingSubLayers.indexOf(subLayerKey) + 2),
          });
        }
        siblingLayerMap.set(subLayerKey, layer.id);
      }

      // Prepare sibling assets with resolved layerIds
      const resolvedSiblingAssets = parseResult.siblingAssets.map(a => ({
        name: a.name,
        featureRef: a.featureRef,
        lat: a.lat,
        lng: a.lng,
        assetType: a.assetType,
        mapLayerId: siblingLayerMap.get(a.subLayerKey)!,
      })).filter(a => a.mapLayerId);

      const syncResult = await syncIrrigationAssets(
        communityId,
        controllerLayer.id,
        zoneLayer.id,
        parseResult.controllers,
        req.session.userId!,
        resolvedSiblingAssets,
      );

      const mappedZones = parseResult.controllers.reduce((s, c) => s + c.zones.filter(z => z.lat != null).length, 0);
      const unmappedZones = parseResult.controllers.reduce((s, c) => s + c.zones.filter(z => z.lat == null).length, 0);

      res.json({
        controllerLayerId: controllerLayer.id,
        zoneLayerId: zoneLayer.id,
        controllerCount: parseResult.controllers.length,
        zoneCount: mappedZones,
        unmappedZoneCount: unmappedZones,
        siblingAssetCount: parseResult.siblingAssets.length,
        syncResult,
        warnings: parseResult.warnings,
      });
    } catch (error: any) {
      req.log.error({ err: error }, "Irrigation upload error");
      res.status(500).json({ error: "Failed to process irrigation KML" });
    }
  }));

  app.patch("/api/map-layers/:id", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const parsed = updateMapLayerSchema.safeParse(req.body);
      if (!parsed.success) return void res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      const { version, ...data } = parsed.data;
      let featureCount = 0;
      let cachedCount: number | null = null;
      if (parsed.data.geojsonData) {
        try {
          const geo = JSON.parse(parsed.data.geojsonData);
          featureCount = geo.features?.length || 0;
          cachedCount = Array.isArray(geo.features) ? geo.features.length : null;
        } catch {}
      }
      const updated = await storage.updateMapLayer(req.params.id as string, version, data, cachedCount);
      if (!updated) {
        const existing = await storage.getMapLayerById(req.params.id as string);
        if (!existing) return void res.status(404).json({ error: "Layer not found" });
        return void res.status(409).json({
          error: "Conflict: layer was modified. Please refresh and try again.",
          code: "VERSION_CONFLICT",
          latestLayer: { ...existing, geojsonData: undefined },
        });
      }
      let syncResult = null;
      if (parsed.data.geojsonData) {
        syncResult = await syncAssetsFromLayer(updated.communityId, updated.id, updated.layerKey, updated.subLayerKey, updated.geojsonData, req.session.userId!);
      }
      const { geojsonData, ...rest } = updated;
      res.json({ ...rest, featureCount, syncResult });
    } catch (error) {
      console.error("Update map layer error:", error);
      res.status(500).json({ error: "Failed to update map layer" });
    }
  }));

  app.delete("/api/map-layers/:id", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const deleted = await storage.deleteMapLayer(req.params.id as string);
      if (!deleted) return void res.status(404).json({ error: "Layer not found" });
      res.json({ success: true });
    } catch (error) {
      console.error("Delete map layer error:", error);
      res.status(500).json({ error: "Failed to delete map layer" });
    }
  }));

  app.post("/api/map-layers/:id/sync-assets", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const layer = await storage.getMapLayerById(req.params.id as string);
      if (!layer) return void res.status(404).json({ error: "Layer not found" });
      const result = await syncAssetsFromLayer(layer.communityId, layer.id, layer.layerKey, layer.subLayerKey, layer.geojsonData, req.session.userId!);
      res.json(result);
    } catch (error) {
      console.error("Sync assets from layer error:", error);
      res.status(500).json({ error: "Failed to sync assets" });
    }
  }));

  app.post("/api/map-layers/:id/validate", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const layer = await storage.getMapLayerById(req.params.id as string);
      if (!layer) return void res.status(404).json({ error: "Layer not found" });
      if (!layer.geojsonData) return void res.json({ featureCount: 0, geometryCounts: { points: 0, lines: 0, polygons: 0, other: 0 }, missingIdCount: 0, missingIdSamples: [], duplicateIdCount: 0, duplicateIdSamples: [], invalidGeometryCount: 0, invalidGeometrySamples: [], warnings: [], errors: ["No GeoJSON data in this layer"], valid: false });
      const geojson = JSON.parse(layer.geojsonData);
      const catalogueEntry = (await getAssetTypeCache()).find(
        t => t.layerKey === layer.layerKey && t.subLayerKey === layer.subLayerKey
      );
      const result = validateLayerGeoJSON(geojson, {
        layerKey: layer.layerKey,
        subLayerKey: layer.subLayerKey,
        allowedGeometry: catalogueEntry?.allowedGeometry ?? null,
      });
      res.json(result);
    } catch (error) {
      console.error("Validate layer error:", error);
      res.status(500).json({ error: "Failed to validate layer" });
    }
  }));

  app.post("/api/map-layers/:id/sync-preview", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const layer = await storage.getMapLayerById(req.params.id as string);
      if (!layer) return void res.status(404).json({ error: "Layer not found" });
      const geojsonData = req.body?.geojsonData || layer.geojsonData;
      const result = await previewSyncFromLayer(layer.communityId, layer.id, layer.layerKey, layer.subLayerKey, geojsonData);
      res.json(result);
    } catch (error) {
      console.error("Sync preview error:", error);
      res.status(500).json({ error: "Failed to generate sync preview" });
    }
  }));

  app.get("/api/map-layers/:id/unlinked-features", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const layer = await storage.getMapLayerById(req.params.id as string);
      if (!layer) return void res.status(404).json({ error: "Layer not found" });
      const existingAssets = await storage.getAssetsByMapLayer(layer.communityId, layer.id);
      const unlinked = getUnlinkedFeatures(layer.geojsonData, existingAssets);
      res.json(unlinked);
    } catch (error) {
      console.error("Unlinked features error:", error);
      res.status(500).json({ error: "Failed to fetch unlinked features" });
    }
  }));

  app.post("/api/map-layers/:id/create-missing-assets", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const layer = await storage.getMapLayerById(req.params.id as string);
      if (!layer) return void res.status(404).json({ error: "Layer not found" });

      const assetType = await resolveAssetType(layer.layerKey, layer.subLayerKey);
      if (!assetType) return void res.status(400).json({ error: "Cannot resolve asset type for this layer" });

      const existingAssets = await storage.getAssetsByMapLayer(layer.communityId, layer.id);
      const unlinked = getUnlinkedFeatures(layer.geojsonData, existingAssets);

      const requestedIds = req.body?.featureIds as string[] | undefined;
      const toCreate = requestedIds
        ? unlinked.filter(u => requestedIds.includes(u.featureId) && u.reason !== "invalid_id")
        : unlinked.filter(u => u.reason !== "invalid_id");

      let created = 0;
      let reactivated = 0;

      for (const item of toCreate) {
        if (item.reason === "archived_asset_exists") {
          const existing = existingAssets.find(a => a.featureRef === item.featureId && a.isArchived);
          if (existing) {
            await storage.updateAssetArchived(existing.id, false);
            reactivated++;
            continue;
          }
        }

        let features: any[] = [];
        try {
          const parsed = JSON.parse(layer.geojsonData!);
          features = parsed.features || [];
        } catch {}

        const feature = features.find((f: any, i: number) => {
          const fId = extractFeatureId(f, i);
          return fId === item.featureId;
        });

        if (feature) {
          const label = extractLabel(feature, assetType, 0);
          const { geometryType, lat, lng } = resolveGeometry(feature);
          const newAsset = await storage.createAssetFromFeature({
            communityId: layer.communityId,
            assetType: assetType as any,
            label,
            featureRef: item.featureId,
            mapLayerId: layer.id,
            geometryType,
            latitude: lat,
            longitude: lng,
            createdBy: req.session.userId!,
          });

          const sqFt = computeAreaSqFt(feature);
          if (sqFt != null) {
            await storage.upsertAssetProperty(newAsset.id, "sqFt", String(sqFt));
          }

          created++;
        }
      }

      res.json({ created, reactivated, total: created + reactivated });
    } catch (error) {
      console.error("Create missing assets error:", error);
      res.status(500).json({ error: "Failed to create missing assets" });
    }
  }));

  app.get("/api/map-layers/:id/collisions", requireAdmin, route(async (req: Request, res: Response) => {
    try {
      const layer = await storage.getMapLayerById(req.params.id as string);
      if (!layer) return void res.status(404).json({ error: "Layer not found" });
      const existingAssets = await storage.getAssetsByMapLayer(layer.communityId, layer.id);
      const collisions = getGeoJsonCollisions(layer.geojsonData, existingAssets);
      res.json(collisions);
    } catch (error) {
      console.error("Collisions error:", error);
      res.status(500).json({ error: "Failed to fetch collisions" });
    }
  }));

  app.get("/api/map-layers/:id/summary", requireAuth, route(async (req: Request, res: Response) => {
    try {
      const layer = await storage.getMapLayerSummaryMetadata(req.params.id as string);
      if (!layer) return void res.status(404).json({ error: "Layer not found" });
      if (!(await policy.canAccessCommunity(policy.actorFromUser(req.currentUser!), layer.communityId))) {
        return void res.status(403).json({ error: "You do not have access to this community" });
      }

      let featureCount = layer.featureCount ?? 0;
      if (layer.featureCount == null && layer.geojsonData) {
        try {
          const geo = JSON.parse(layer.geojsonData);
          featureCount = geo.features?.length || 0;
        } catch {}
      }

      const summary = await storage.getMapLayerSummary(layer.id, layer.communityId);
      res.json({
        featureCount,
        sourceFormat: layer.sourceFormat,
        ...summary,
      });
    } catch (error) {
      console.error("Map layer summary error:", error);
      res.status(500).json({ error: "Failed to fetch layer summary" });
    }
  }));
}
