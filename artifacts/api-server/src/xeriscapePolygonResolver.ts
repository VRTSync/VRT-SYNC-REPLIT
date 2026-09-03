import type { Asset, Community, MapLayer } from "@workspace/db";

export type XeriscapePolygonCommunity = Pick<Community, "id" | "name">;

export type XeriscapePolygonFeatureProperties = {
  id: string;
  name: string;
  area_sqft: number;
  featureRef: string | null;
  communityId: string;
  communityName: string;
  areaStatus: "valid" | "missing" | "invalid" | "zero";
  isRankable: boolean;
};

export type XeriscapePolygonFeature = {
  type: "Feature";
  id: string;
  geometry: unknown;
  properties: XeriscapePolygonFeatureProperties;
};

export type XeriscapePolygonUnresolvedAsset = {
  assetId: string;
  name: string;
  communityId: string;
  communityName: string;
  featureRef: string | null;
  reason: "missing_map_layer" | "invalid_map_layer" | "feature_not_found";
};

export type XeriscapePolygonCommunitySummary = {
  communityId: string;
  communityName: string;
  assetsFound: number;
  featuresResolved: number;
  sqFtResolved: number;
  unresolvedCount: number;
};

export type XeriscapePolygonResolution = {
  type: "FeatureCollection";
  features: XeriscapePolygonFeature[];
  assetsFound: number;
  featuresResolved: number;
  sqFtResolved: number;
  unresolved: XeriscapePolygonUnresolvedAsset[];
  byCommunity: XeriscapePolygonCommunitySummary[];
};

type IndexedLayer = Map<string, any>;

const PLACEHOLDER_LABEL = "untitled polygon";

function cleanLabel(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const label = String(value).trim();
  if (!label || label.toLowerCase() === PLACEHOLDER_LABEL) return null;
  return label;
}

function getFeatureLabel(feature: any): string | null {
  const props = feature?.properties;
  return cleanLabel(props?.label) ?? cleanLabel(props?.name) ?? cleanLabel(props?.title);
}

function indexLayer(layer: MapLayer): { index: IndexedLayer; error?: "invalid_map_layer" } {
  if (!layer.geojsonData) return { index: new Map(), error: "invalid_map_layer" };

  try {
    const parsed = JSON.parse(layer.geojsonData);
    const features = parsed?.features || (parsed?.type === "Feature" ? [parsed] : []);
    if (!Array.isArray(features)) return { index: new Map(), error: "invalid_map_layer" };

    const index: IndexedLayer = new Map();
    for (const feature of features) {
      if (!feature || typeof feature !== "object") continue;

      const candidates = [
        feature.id,
        feature.properties?.featureId,
        feature.properties?.id,
        feature.properties?.featureRef,
      ];
      for (const candidate of candidates) {
        if (candidate !== undefined && candidate !== null && candidate !== "") {
          const key = String(candidate);
          if (!index.has(key)) index.set(key, feature);
        }
      }

      const name = getFeatureLabel(feature);
      if (name) {
        const key = `__name__${name}`;
        if (!index.has(key)) index.set(key, feature);
      }
    }
    return { index };
  } catch {
    return { index: new Map(), error: "invalid_map_layer" };
  }
}

function parseArea(value: string | undefined): {
  areaSqft: number;
  areaStatus: XeriscapePolygonFeatureProperties["areaStatus"];
  isRankable: boolean;
} {
  if (value === undefined || value.trim() === "") {
    return { areaSqft: 0, areaStatus: "missing", isRankable: false };
  }

  const trimmed = value.trim();
  if (!/^[+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed)) {
    return { areaSqft: 0, areaStatus: "invalid", isRankable: false };
  }

  const areaSqft = Number(trimmed);
  if (!Number.isFinite(areaSqft)) {
    return { areaSqft: 0, areaStatus: "invalid", isRankable: false };
  }
  if (areaSqft === 0) {
    return { areaSqft, areaStatus: "zero", isRankable: false };
  }
  if (areaSqft < 0) {
    return { areaSqft, areaStatus: "invalid", isRankable: false };
  }
  return { areaSqft, areaStatus: "valid", isRankable: true };
}

function isUsablePoint(asset: Asset): boolean {
  return (
    asset.latitude !== null &&
    asset.latitude !== undefined &&
    asset.longitude !== null &&
    asset.longitude !== undefined &&
    Number.isFinite(asset.latitude) &&
    Number.isFinite(asset.longitude)
  );
}

export function resolveXeriscapePolygons(input: {
  communities: XeriscapePolygonCommunity[];
  assets: Asset[];
  properties: Array<{ assetId: string; key: string; value: string }>;
  layers: MapLayer[];
}): XeriscapePolygonResolution {
  const communityById = new Map(input.communities.map((community) => [community.id, community]));
  const eligibleAssets = input.assets.filter(
    (asset) =>
      asset.assetType === "bluegrass_area" &&
      !asset.isArchived &&
      communityById.has(asset.communityId),
  );
  const fallbackNames = new Map<string, string>();
  const assetsByCommunity = new Map<string, Asset[]>();
  for (const asset of eligibleAssets) {
    const communityAssets = assetsByCommunity.get(asset.communityId) ?? [];
    communityAssets.push(asset);
    assetsByCommunity.set(asset.communityId, communityAssets);
  }
  for (const communityAssets of assetsByCommunity.values()) {
    communityAssets
      .slice()
      .sort((a, b) => {
        const featureRefA = a.featureRef ?? "";
        const featureRefB = b.featureRef ?? "";
        return featureRefA.localeCompare(featureRefB) || a.id.localeCompare(b.id);
      })
      .forEach((asset, index) => fallbackNames.set(asset.id, `Area ${index + 1}`));
  }
  const propertiesByAssetId = new Map<string, Record<string, string>>();
  for (const property of input.properties) {
    const properties = propertiesByAssetId.get(property.assetId) ?? {};
    properties[property.key] = property.value;
    propertiesByAssetId.set(property.assetId, properties);
  }

  // Index each referenced layer once for the whole request, before resolving assets.
  const layerIndexes = new Map<string, IndexedLayer>();
  const layerErrors = new Map<string, "invalid_map_layer">();
  for (const layer of input.layers) {
    const indexed = indexLayer(layer);
    layerIndexes.set(layer.id, indexed.index);
    if (indexed.error) layerErrors.set(layer.id, indexed.error);
  }

  const features: XeriscapePolygonFeature[] = [];
  const unresolved: XeriscapePolygonUnresolvedAsset[] = [];
  const summaries = new Map<string, XeriscapePolygonCommunitySummary>();

  for (const community of input.communities) {
    summaries.set(community.id, {
      communityId: community.id,
      communityName: community.name,
      assetsFound: 0,
      featuresResolved: 0,
      sqFtResolved: 0,
      unresolvedCount: 0,
    });
  }

  for (const asset of eligibleAssets) {
    const community = communityById.get(asset.communityId);
    if (!community) continue;

    const summary = summaries.get(community.id)!;
    summary.assetsFound++;

    const props = propertiesByAssetId.get(asset.id) ?? {};
    const area = parseArea(props.sqFt);
    const fallbackName = cleanLabel(asset.label) ?? fallbackNames.get(asset.id) ?? `Area 1`;
    let geometry: any = null;
    let matchedFeature: any = null;
    let displayName = fallbackName;
    let unresolvedReason: XeriscapePolygonUnresolvedAsset["reason"] | null = null;

    if (asset.mapLayerId && layerIndexes.has(asset.mapLayerId)) {
      const featureIndex = layerIndexes.get(asset.mapLayerId)!;
      matchedFeature =
        (asset.featureRef && featureIndex.get(String(asset.featureRef))) ||
        featureIndex.get(`__name__${asset.label}`) ||
        null;
      displayName = getFeatureLabel(matchedFeature) ?? fallbackName;
      if (matchedFeature?.geometry) {
        geometry = matchedFeature.geometry;
      } else {
        unresolvedReason = layerErrors.has(asset.mapLayerId)
          ? "invalid_map_layer"
          : "feature_not_found";
      }
    } else if (asset.mapLayerId && layerErrors.has(asset.mapLayerId)) {
      unresolvedReason = "invalid_map_layer";
    } else {
      unresolvedReason = "missing_map_layer";
    }

    // Preserve the community planner's point fallback for assets without polygon geometry.
    if (!geometry && isUsablePoint(asset)) {
      geometry = { type: "Point", coordinates: [asset.longitude, asset.latitude] };
      unresolvedReason = null;
    }

    if (!geometry) {
      summary.unresolvedCount++;
      unresolved.push({
        assetId: asset.id,
        name: displayName,
        communityId: community.id,
        communityName: community.name,
        featureRef: asset.featureRef,
        reason: unresolvedReason ?? "feature_not_found",
      });
      continue;
    }

    summary.featuresResolved++;
    if (area.isRankable) summary.sqFtResolved += area.areaSqft;
    features.push({
      type: "Feature",
      id: asset.id,
      geometry,
      properties: {
        id: asset.id,
        name: displayName,
        area_sqft: area.areaSqft,
        featureRef: asset.featureRef,
        communityId: community.id,
        communityName: community.name,
        areaStatus: area.areaStatus,
        isRankable: area.isRankable,
      },
    });
  }

  return {
    type: "FeatureCollection",
    features,
    assetsFound: eligibleAssets.length,
    featuresResolved: features.length,
    sqFtResolved: features.reduce(
      (total, feature) => total + (feature.properties.isRankable ? feature.properties.area_sqft : 0),
      0,
    ),
    unresolved,
    byCommunity: input.communities.map((community) => summaries.get(community.id)!),
  };
}