import { eq, and, notInArray, isNotNull } from "drizzle-orm";
import { db } from "./db";
import { assets, assetProperties, type Asset } from "@shared/schema";

export const ASSET_TYPE_TEMPLATES: Record<string, {
  requiredKeys: string[];
  optionalKeys: string[];
}> = {
  backflow: {
    requiredKeys: ["brand", "serialNumber", "size"],
    optionalKeys: [],
  },
  controller: {
    requiredKeys: ["brand"],
    optionalKeys: ["installDate", "seasonalAdjustment", "controllerKey", "controllerColor"],
  },
  zone: {
    requiredKeys: ["zoneNumber", "runTime"],
    optionalKeys: ["controllerFeatureRef", "controllerLabel", "zoneType", "zoneLabelShort"],
  },
  tree: {
    requiredKeys: ["species"],
    optionalKeys: ["plantedDate"],
  },
  pet_station: {
    requiredKeys: [],
    optionalKeys: ["serviceFrequency"],
  },
  landscape_bed: {
    requiredKeys: [],
    optionalKeys: ["name", "sqFt"],
  },
  bluegrass_area: {
    requiredKeys: [],
    optionalKeys: ["name", "sqFt"],
  },
  native_area: {
    requiredKeys: [],
    optionalKeys: ["name", "sqFt"],
  },
  snow_area: {
    requiredKeys: [],
    optionalKeys: ["name", "sqFt"],
  },
};

export const SUB_LAYER_TO_ASSET_TYPE: Record<string, string> = {
  "irrigation/backflow": "backflow",
  "irrigation/controller": "controller",
  "irrigation/zone": "zone",
  "irrigation/master_valve": "master_valve",
  "irrigation/flow_meter": "flow_meter",
  "irrigation/qc_iso_valve": "qc_iso_valve",
  "trees/tree": "tree",
  "community/pet_station": "pet_station",
  "community/landscape_bed": "landscape_bed",
  "community/bluegrass_area": "bluegrass_area",
  "community/native_area": "native_area",
  "snow/plow": "plow",
  "snow/atv": "atv",
  "snow/hand_shovel": "hand_shovel",
  "snow/ice_melt": "ice_melt",
  "snow/slicer": "slicer",
  "snow/storage_area": "storage_area",
  "snow/snow_area": "snow_area",
};

export function resolveAssetType(layerKey: string, subLayerKey: string): string | null {
  const compositeKey = `${layerKey}/${subLayerKey}`;
  return SUB_LAYER_TO_ASSET_TYPE[compositeKey] || null;
}

function extractFeatureId(feature: any, index: number): string {
  if (feature.id != null && feature.id !== "") return String(feature.id);
  if (feature.properties?.featureId) return String(feature.properties.featureId);
  if (feature.properties?.id) return String(feature.properties.id);
  return `auto_${index}`;
}

function extractLabel(feature: any, assetType: string, index: number): string {
  const props = feature.properties || {};
  if (props.name) return String(props.name);
  if (props.label) return String(props.label);
  if (props.title) return String(props.title);
  const typeLabel = assetType.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  return `${typeLabel} ${index + 1}`;
}

function resolveGeometry(feature: any): {
  geometryType: "point" | "polygon" | "line" | null;
  lat: number | null;
  lng: number | null;
} {
  const geom = feature.geometry;
  if (!geom) return { geometryType: null, lat: null, lng: null };

  let geometryType: "point" | "polygon" | "line" | null = null;
  if (geom.type === "Point") geometryType = "point";
  else if (geom.type === "Polygon" || geom.type === "MultiPolygon") geometryType = "polygon";
  else if (geom.type === "LineString" || geom.type === "MultiLineString") geometryType = "line";

  let lat: number | null = null;
  let lng: number | null = null;

  if (geom.type === "Point" && geom.coordinates) {
    lng = geom.coordinates[0];
    lat = geom.coordinates[1];
  } else if (geom.type === "Polygon" && geom.coordinates?.[0]) {
    const ring = geom.coordinates[0];
    let sumLat = 0, sumLng = 0;
    for (const coord of ring) { sumLng += coord[0]; sumLat += coord[1]; }
    lng = sumLng / ring.length;
    lat = sumLat / ring.length;
  } else if (geom.type === "MultiPolygon" && geom.coordinates) {
    let allCoords: number[][] = [];
    for (const poly of geom.coordinates) {
      if (poly[0]) allCoords.push(...poly[0]);
    }
    if (allCoords.length > 0) {
      let sumLat = 0, sumLng = 0;
      for (const coord of allCoords) { sumLng += coord[0]; sumLat += coord[1]; }
      lng = sumLng / allCoords.length;
      lat = sumLat / allCoords.length;
    }
  } else if ((geom.type === "LineString") && geom.coordinates) {
    const mid = Math.floor(geom.coordinates.length / 2);
    lng = geom.coordinates[mid][0];
    lat = geom.coordinates[mid][1];
  }

  return { geometryType, lat, lng };
}

export interface SyncResult {
  created: number;
  updated: number;
  archived: number;
  skippedMissingId: number;
  total: number;
}

export async function syncAssetsFromLayer(
  communityId: string,
  mapLayerId: string,
  layerKey: string,
  subLayerKey: string,
  geojsonData: string | null,
): Promise<SyncResult> {
  const assetType = resolveAssetType(layerKey, subLayerKey);
  if (!assetType) {
    return { created: 0, updated: 0, archived: 0, skippedMissingId: 0, total: 0 };
  }

  let features: any[] = [];
  if (geojsonData) {
    try {
      const parsed = JSON.parse(geojsonData);
      if (parsed.type === "FeatureCollection" && Array.isArray(parsed.features)) {
        features = parsed.features;
      } else if (parsed.type === "Feature") {
        features = [parsed];
      }
    } catch {
      return { created: 0, updated: 0, archived: 0, skippedMissingId: 0, total: 0 };
    }
  }

  let created = 0;
  let updated = 0;
  const processedFeatureRefs: string[] = [];

  for (let i = 0; i < features.length; i++) {
    const feature = features[i];
    const featureRef = extractFeatureId(feature, i);
    const label = extractLabel(feature, assetType, i);
    const { geometryType, lat, lng } = resolveGeometry(feature);
    processedFeatureRefs.push(featureRef);

    const [existing] = await db.select().from(assets).where(
      and(
        eq(assets.communityId, communityId),
        eq(assets.mapLayerId, mapLayerId),
        eq(assets.featureRef, featureRef),
      )
    );

    if (existing) {
      await db.update(assets)
        .set({
          label: label,
          geometryType: geometryType,
          latitude: lat,
          longitude: lng,
          isArchived: false,
          archivedAt: null,
          sourceUpdatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(assets.id, existing.id));
      updated++;
    } else {
      await db.insert(assets).values({
        communityId,
        assetType: assetType as Asset["assetType"],
        label,
        featureRef,
        mapLayerId,
        geometryType: geometryType,
        latitude: lat,
        longitude: lng,
        isArchived: false,
        sourceUpdatedAt: new Date(),
      });
      created++;
    }
  }

  let archived = 0;
  if (processedFeatureRefs.length > 0) {
    const toArchive = await db.select().from(assets).where(
      and(
        eq(assets.communityId, communityId),
        eq(assets.mapLayerId, mapLayerId),
        eq(assets.isArchived, false),
        notInArray(assets.featureRef, processedFeatureRefs),
        isNotNull(assets.featureRef),
      )
    );
    if (toArchive.length > 0) {
      const ids = toArchive.map(a => a.id);
      for (const id of ids) {
        await db.update(assets)
          .set({ isArchived: true, archivedAt: new Date(), updatedAt: new Date() })
          .where(eq(assets.id, id));
      }
      archived = toArchive.length;
    }
  } else {
    const toArchive = await db.select().from(assets).where(
      and(
        eq(assets.communityId, communityId),
        eq(assets.mapLayerId, mapLayerId),
        eq(assets.isArchived, false),
      )
    );
    if (toArchive.length > 0) {
      for (const a of toArchive) {
        await db.update(assets)
          .set({ isArchived: true, archivedAt: new Date(), updatedAt: new Date() })
          .where(eq(assets.id, a.id));
      }
      archived = toArchive.length;
    }
  }

  return { created, updated, archived, skippedMissingId: 0, total: features.length };
}

export function getMissingRequiredKeys(assetType: string, properties: { key: string; value: string }[]): string[] {
  const template = ASSET_TYPE_TEMPLATES[assetType];
  if (!template) return [];
  const existingKeys = new Set(properties.map(p => p.key));
  return template.requiredKeys.filter(k => !existingKeys.has(k));
}

export { extractFeatureId, extractLabel, resolveGeometry };

export interface SyncPreviewResult {
  featureCount: number;
  wouldCreateCount: number;
  wouldUpdateCount: number;
  wouldArchiveCount: number;
  wouldSkipCount: number;
  wouldCreateSamples: { featureId: string; label: string }[];
  wouldArchiveSamples: { assetId: string; label: string; featureRef: string }[];
}

export async function previewSyncFromLayer(
  communityId: string,
  mapLayerId: string,
  layerKey: string,
  subLayerKey: string,
  geojsonData: string | null,
): Promise<SyncPreviewResult> {
  const assetType = resolveAssetType(layerKey, subLayerKey);
  if (!assetType) {
    return { featureCount: 0, wouldCreateCount: 0, wouldUpdateCount: 0, wouldArchiveCount: 0, wouldSkipCount: 0, wouldCreateSamples: [], wouldArchiveSamples: [] };
  }

  let features: any[] = [];
  if (geojsonData) {
    try {
      const parsed = JSON.parse(geojsonData);
      if (parsed.type === "FeatureCollection" && Array.isArray(parsed.features)) {
        features = parsed.features;
      } else if (parsed.type === "Feature") {
        features = [parsed];
      }
    } catch {
      return { featureCount: 0, wouldCreateCount: 0, wouldUpdateCount: 0, wouldArchiveCount: 0, wouldSkipCount: 0, wouldCreateSamples: [], wouldArchiveSamples: [] };
    }
  }

  let wouldCreate = 0;
  let wouldUpdate = 0;
  let wouldSkip = 0;
  const wouldCreateSamples: { featureId: string; label: string }[] = [];
  const processedFeatureRefs: string[] = [];

  for (let i = 0; i < features.length; i++) {
    const feature = features[i];
    const featureRef = extractFeatureId(feature, i);
    const label = extractLabel(feature, assetType, i);

    if (featureRef.startsWith("auto_")) {
      wouldSkip++;
      continue;
    }

    processedFeatureRefs.push(featureRef);

    const [existing] = await db.select().from(assets).where(
      and(
        eq(assets.communityId, communityId),
        eq(assets.mapLayerId, mapLayerId),
        eq(assets.featureRef, featureRef),
      )
    );

    if (existing) {
      wouldUpdate++;
    } else {
      wouldCreate++;
      if (wouldCreateSamples.length < 10) {
        wouldCreateSamples.push({ featureId: featureRef, label });
      }
    }
  }

  let wouldArchive = 0;
  const wouldArchiveSamples: { assetId: string; label: string; featureRef: string }[] = [];

  if (processedFeatureRefs.length > 0) {
    const toArchive = await db.select().from(assets).where(
      and(
        eq(assets.communityId, communityId),
        eq(assets.mapLayerId, mapLayerId),
        eq(assets.isArchived, false),
        notInArray(assets.featureRef, processedFeatureRefs),
        isNotNull(assets.featureRef),
      )
    );
    wouldArchive = toArchive.length;
    for (const a of toArchive.slice(0, 10)) {
      wouldArchiveSamples.push({ assetId: a.id, label: a.label, featureRef: a.featureRef || "" });
    }
  } else if (features.length === 0) {
    const toArchive = await db.select().from(assets).where(
      and(
        eq(assets.communityId, communityId),
        eq(assets.mapLayerId, mapLayerId),
        eq(assets.isArchived, false),
      )
    );
    wouldArchive = toArchive.length;
    for (const a of toArchive.slice(0, 10)) {
      wouldArchiveSamples.push({ assetId: a.id, label: a.label, featureRef: a.featureRef || "" });
    }
  }

  return {
    featureCount: features.length,
    wouldCreateCount: wouldCreate,
    wouldUpdateCount: wouldUpdate,
    wouldArchiveCount: wouldArchive,
    wouldSkipCount: wouldSkip,
    wouldCreateSamples,
    wouldArchiveSamples,
  };
}

export interface UnlinkedFeature {
  featureId: string;
  label: string;
  geometryType: string | null;
  lat: number | null;
  lng: number | null;
  reason: string;
}

export function getUnlinkedFeatures(
  geojsonData: string | null,
  existingAssets: { featureRef: string | null; isArchived: boolean }[],
): UnlinkedFeature[] {
  if (!geojsonData) return [];

  let features: any[] = [];
  try {
    const parsed = JSON.parse(geojsonData);
    if (parsed.type === "FeatureCollection" && Array.isArray(parsed.features)) {
      features = parsed.features;
    } else if (parsed.type === "Feature") {
      features = [parsed];
    }
  } catch {
    return [];
  }

  const activeRefs = new Set(
    existingAssets.filter(a => !a.isArchived && a.featureRef).map(a => a.featureRef!)
  );
  const archivedRefs = new Set(
    existingAssets.filter(a => a.isArchived && a.featureRef).map(a => a.featureRef!)
  );

  const unlinked: UnlinkedFeature[] = [];

  for (let i = 0; i < features.length; i++) {
    const feature = features[i];
    const featureId = extractFeatureId(feature, i);

    if (featureId.startsWith("auto_")) {
      const { geometryType, lat, lng } = resolveGeometry(feature);
      const props = feature.properties || {};
      const label = props.name || props.label || props.title || `Feature #${i}`;
      unlinked.push({ featureId, label: String(label), geometryType, lat, lng, reason: "invalid_id" });
      continue;
    }

    if (activeRefs.has(featureId)) continue;

    const { geometryType, lat, lng } = resolveGeometry(feature);
    const props = feature.properties || {};
    const label = props.name || props.label || props.title || featureId;

    if (archivedRefs.has(featureId)) {
      unlinked.push({ featureId, label: String(label), geometryType, lat, lng, reason: "archived_asset_exists" });
    } else {
      unlinked.push({ featureId, label: String(label), geometryType, lat, lng, reason: "missing_asset" });
    }
  }

  return unlinked;
}

export interface CollisionReport {
  duplicateFeatureIds: { featureId: string; count: number }[];
  multiAssetFeatureIds: { featureRef: string; assetIds: string[] }[];
}

export function getGeoJsonCollisions(
  geojsonData: string | null,
  existingAssets: { id: string; featureRef: string | null }[],
): CollisionReport {
  const duplicateFeatureIds: { featureId: string; count: number }[] = [];
  const multiAssetFeatureIds: { featureRef: string; assetIds: string[] }[] = [];

  if (geojsonData) {
    let features: any[] = [];
    try {
      const parsed = JSON.parse(geojsonData);
      if (parsed.type === "FeatureCollection" && Array.isArray(parsed.features)) {
        features = parsed.features;
      }
    } catch {}

    const idCounts = new Map<string, number>();
    for (let i = 0; i < features.length; i++) {
      const feature = features[i];
      const fId = extractFeatureId(feature, i);
      if (!fId.startsWith("auto_")) {
        idCounts.set(fId, (idCounts.get(fId) || 0) + 1);
      }
    }
    for (const [id, count] of idCounts) {
      if (count > 1) {
        duplicateFeatureIds.push({ featureId: id, count });
      }
    }
  }

  const refMap = new Map<string, string[]>();
  for (const a of existingAssets) {
    if (a.featureRef) {
      if (!refMap.has(a.featureRef)) refMap.set(a.featureRef, []);
      refMap.get(a.featureRef)!.push(a.id);
    }
  }
  for (const [ref, ids] of refMap) {
    if (ids.length > 1) {
      multiAssetFeatureIds.push({ featureRef: ref, assetIds: ids });
    }
  }

  return { duplicateFeatureIds, multiAssetFeatureIds };
}

export interface IrrigationSyncResult {
  controllersCreated: number;
  controllersUpdated: number;
  zonesCreated: number;
  zonesUpdated: number;
  propertiesSet: number;
}

export async function syncIrrigationAssets(
  communityId: string,
  controllerMapLayerId: string,
  zoneMapLayerId: string,
  controllers: Array<{
    name: string;
    featureRef: string;
    lat: number | null;
    lng: number | null;
    controllerKey: string;
    controllerColor: string;
    zones: Array<{
      name: string;
      featureRef: string;
      lat: number | null;
      lng: number | null;
      controllerFeatureRef: string;
      controllerLabel: string;
      zoneNumber: number | null;
      zoneType: string | null;
      zoneLabelShort: string | null;
    }>;
  }>,
): Promise<IrrigationSyncResult> {
  let controllersCreated = 0;
  let controllersUpdated = 0;
  let zonesCreated = 0;
  let zonesUpdated = 0;
  let propertiesSet = 0;

  const controllerFeatureRefs: string[] = [];
  const zoneFeatureRefs: string[] = [];

  for (const ctrl of controllers) {
    controllerFeatureRefs.push(ctrl.featureRef);

    const [existing] = await db.select().from(assets).where(
      and(
        eq(assets.communityId, communityId),
        eq(assets.mapLayerId, controllerMapLayerId),
        eq(assets.featureRef, ctrl.featureRef),
      )
    );

    let assetId: string;

    if (existing) {
      await db.update(assets)
        .set({
          label: ctrl.name,
          geometryType: "point",
          latitude: ctrl.lat,
          longitude: ctrl.lng,
          isArchived: false,
          archivedAt: null,
          sourceUpdatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(assets.id, existing.id));
      assetId = existing.id;
      controllersUpdated++;
    } else {
      const [inserted] = await db.insert(assets).values({
        communityId,
        assetType: "controller" as Asset["assetType"],
        label: ctrl.name,
        featureRef: ctrl.featureRef,
        mapLayerId: controllerMapLayerId,
        geometryType: "point",
        latitude: ctrl.lat,
        longitude: ctrl.lng,
        isArchived: false,
        sourceUpdatedAt: new Date(),
      }).returning();
      assetId = inserted.id;
      controllersCreated++;
    }

    const controllerProps: Record<string, string> = {
      controllerKey: ctrl.controllerKey,
      controllerColor: ctrl.controllerColor,
    };

    for (const [key, value] of Object.entries(controllerProps)) {
      if (value) {
        await db.insert(assetProperties)
          .values({ assetId, key, value })
          .onConflictDoUpdate({
            target: [assetProperties.assetId, assetProperties.key],
            set: { value, updatedAt: new Date() },
          });
        propertiesSet++;
      }
    }

    for (const zone of ctrl.zones) {
      zoneFeatureRefs.push(zone.featureRef);

      const [existingZone] = await db.select().from(assets).where(
        and(
          eq(assets.communityId, communityId),
          eq(assets.mapLayerId, zoneMapLayerId),
          eq(assets.featureRef, zone.featureRef),
        )
      );

      let zoneAssetId: string;

      if (existingZone) {
        await db.update(assets)
          .set({
            label: zone.name,
            geometryType: "point",
            latitude: zone.lat,
            longitude: zone.lng,
            isArchived: false,
            archivedAt: null,
            sourceUpdatedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(assets.id, existingZone.id));
        zoneAssetId = existingZone.id;
        zonesUpdated++;
      } else {
        const [insertedZone] = await db.insert(assets).values({
          communityId,
          assetType: "zone" as Asset["assetType"],
          label: zone.name,
          featureRef: zone.featureRef,
          mapLayerId: zoneMapLayerId,
          geometryType: "point",
          latitude: zone.lat,
          longitude: zone.lng,
          isArchived: false,
          sourceUpdatedAt: new Date(),
        }).returning();
        zoneAssetId = insertedZone.id;
        zonesCreated++;
      }

      const zoneProps: Record<string, string | null> = {
        controllerFeatureRef: zone.controllerFeatureRef,
        controllerLabel: zone.controllerLabel,
        zoneNumber: zone.zoneNumber != null ? String(zone.zoneNumber) : null,
        zoneType: zone.zoneType,
        zoneLabelShort: zone.zoneLabelShort,
      };

      for (const [key, value] of Object.entries(zoneProps)) {
        if (value != null) {
          await db.insert(assetProperties)
            .values({ assetId: zoneAssetId, key, value })
            .onConflictDoUpdate({
              target: [assetProperties.assetId, assetProperties.key],
              set: { value, updatedAt: new Date() },
            });
          propertiesSet++;
        }
      }
    }
  }

  if (controllerFeatureRefs.length > 0) {
    const toArchive = await db.select().from(assets).where(
      and(
        eq(assets.communityId, communityId),
        eq(assets.mapLayerId, controllerMapLayerId),
        eq(assets.isArchived, false),
        notInArray(assets.featureRef, controllerFeatureRefs),
        isNotNull(assets.featureRef),
      )
    );
    for (const a of toArchive) {
      await db.update(assets)
        .set({ isArchived: true, archivedAt: new Date(), updatedAt: new Date() })
        .where(eq(assets.id, a.id));
    }
  }

  if (zoneFeatureRefs.length > 0) {
    const toArchive = await db.select().from(assets).where(
      and(
        eq(assets.communityId, communityId),
        eq(assets.mapLayerId, zoneMapLayerId),
        eq(assets.isArchived, false),
        notInArray(assets.featureRef, zoneFeatureRefs),
        isNotNull(assets.featureRef),
      )
    );
    for (const a of toArchive) {
      await db.update(assets)
        .set({ isArchived: true, archivedAt: new Date(), updatedAt: new Date() })
        .where(eq(assets.id, a.id));
    }
  }

  return { controllersCreated, controllersUpdated, zonesCreated, zonesUpdated, propertiesSet };
}
