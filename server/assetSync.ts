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
    optionalKeys: ["installDate", "seasonalAdjustment"],
  },
  zone: {
    requiredKeys: ["zoneNumber", "runTime"],
    optionalKeys: ["controllerRef"],
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
  "trees/tree": "tree",
  "community/pet_station": "pet_station",
  "community/landscape_bed": "landscape_bed",
  "community/bluegrass_area": "bluegrass_area",
  "community/native_area": "native_area",
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
    return { created: 0, updated: 0, archived: 0, total: 0 };
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
      return { created: 0, updated: 0, archived: 0, total: 0 };
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

  return { created, updated, archived, total: features.length };
}

export function getMissingRequiredKeys(assetType: string, properties: { key: string; value: string }[]): string[] {
  const template = ASSET_TYPE_TEMPLATES[assetType];
  if (!template) return [];
  const existingKeys = new Set(properties.map(p => p.key));
  return template.requiredKeys.filter(k => !existingKeys.has(k));
}
