const EXPECTED_GEOMETRY: Record<string, string[]> = {
  backflow: ["Point"],
  controller: ["Point"],
  zone: ["Polygon", "MultiPolygon"],
  master_valve: ["Point"],
  flow_meter: ["Point"],
  qc_iso_valve: ["Point"],
  tree: ["Point"],
  pet_station: ["Point"],
  landscape_bed: ["Polygon", "MultiPolygon"],
  bluegrass_area: ["Polygon", "MultiPolygon"],
  native_area: ["Polygon", "MultiPolygon"],
  snow_area: ["Polygon", "MultiPolygon"],
  plow: ["Polygon", "MultiPolygon", "LineString", "MultiLineString"],
  atv: ["Polygon", "MultiPolygon", "LineString", "MultiLineString"],
  hand_shovel: ["Polygon", "MultiPolygon", "Point"],
  ice_melt: ["Point"],
  slicer: ["Polygon", "MultiPolygon", "LineString", "MultiLineString"],
  storage_area: ["Polygon", "MultiPolygon", "Point"],
};

export interface ValidationResult {
  featureCount: number;
  geometryCounts: { points: number; lines: number; polygons: number; other: number };
  missingIdCount: number;
  missingIdSamples: { index: number; properties: Record<string, any> }[];
  duplicateIdCount: number;
  duplicateIdSamples: { featureId: string; count: number }[];
  invalidGeometryCount: number;
  invalidGeometrySamples: { index: number; featureId: string | null; issue: string }[];
  warnings: string[];
  errors: string[];
  valid: boolean;
}

function extractFeatureIdRaw(feature: any): string | null {
  if (feature.id != null && String(feature.id).trim() !== "") return String(feature.id).trim();
  if (feature.properties?.featureId && String(feature.properties.featureId).trim() !== "") return String(feature.properties.featureId).trim();
  if (feature.properties?.id && String(feature.properties.id).trim() !== "") return String(feature.properties.id).trim();
  return null;
}

export function validateLayerGeoJSON(
  geojson: any,
  options: { layerKey: string; subLayerKey: string }
): ValidationResult {
  const result: ValidationResult = {
    featureCount: 0,
    geometryCounts: { points: 0, lines: 0, polygons: 0, other: 0 },
    missingIdCount: 0,
    missingIdSamples: [],
    duplicateIdCount: 0,
    duplicateIdSamples: [],
    invalidGeometryCount: 0,
    invalidGeometrySamples: [],
    warnings: [],
    errors: [],
    valid: true,
  };

  if (!geojson || typeof geojson !== "object") {
    result.errors.push("GeoJSON data is null or not an object");
    result.valid = false;
    return result;
  }

  let features: any[] = [];
  if (geojson.type === "FeatureCollection" && Array.isArray(geojson.features)) {
    features = geojson.features;
  } else if (geojson.type === "Feature") {
    features = [geojson];
  } else {
    result.errors.push(`Invalid GeoJSON type "${geojson.type}". Expected FeatureCollection or Feature.`);
    result.valid = false;
    return result;
  }

  result.featureCount = features.length;
  if (features.length === 0) {
    result.warnings.push("GeoJSON contains no features");
    return result;
  }

  const compositeKey = `${options.layerKey}/${options.subLayerKey}`;
  const assetType = options.subLayerKey;
  const expectedGeomTypes = EXPECTED_GEOMETRY[assetType] || null;

  const idCounts = new Map<string, number>();

  for (let i = 0; i < features.length; i++) {
    const feature = features[i];
    const featureId = extractFeatureIdRaw(feature);

    if (!featureId) {
      result.missingIdCount++;
      if (result.missingIdSamples.length < 10) {
        result.missingIdSamples.push({
          index: i,
          properties: feature.properties ? Object.fromEntries(
            Object.entries(feature.properties).slice(0, 5)
          ) : {},
        });
      }
    } else {
      idCounts.set(featureId, (idCounts.get(featureId) || 0) + 1);
    }

    const geom = feature.geometry;
    if (!geom || !geom.type) {
      result.invalidGeometryCount++;
      if (result.invalidGeometrySamples.length < 10) {
        result.invalidGeometrySamples.push({
          index: i,
          featureId,
          issue: "Missing geometry",
        });
      }
      result.geometryCounts.other++;
    } else {
      const gType = geom.type;
      if (gType === "Point") result.geometryCounts.points++;
      else if (gType === "LineString" || gType === "MultiLineString") result.geometryCounts.lines++;
      else if (gType === "Polygon" || gType === "MultiPolygon") result.geometryCounts.polygons++;
      else {
        result.geometryCounts.other++;
        result.invalidGeometryCount++;
        if (result.invalidGeometrySamples.length < 10) {
          result.invalidGeometrySamples.push({
            index: i,
            featureId,
            issue: `Unknown geometry type "${gType}"`,
          });
        }
      }

      if (!geom.coordinates || (Array.isArray(geom.coordinates) && geom.coordinates.length === 0)) {
        result.invalidGeometryCount++;
        if (result.invalidGeometrySamples.length < 10) {
          result.invalidGeometrySamples.push({
            index: i,
            featureId,
            issue: "Empty coordinates",
          });
        }
      }

      if (expectedGeomTypes && !expectedGeomTypes.includes(gType)) {
        result.warnings.push(
          `Feature ${featureId || `#${i}`}: geometry "${gType}" is unexpected for ${assetType} (expected ${expectedGeomTypes.join("/")})`
        );
        if (result.warnings.length > 20) {
          result.warnings.length = 20;
          if (!result.warnings.includes("(additional geometry warnings truncated)")) {
            result.warnings.push("(additional geometry warnings truncated)");
          }
        }
      }
    }
  }

  for (const [id, count] of idCounts) {
    if (count > 1) {
      result.duplicateIdCount++;
      if (result.duplicateIdSamples.length < 10) {
        result.duplicateIdSamples.push({ featureId: id, count });
      }
    }
  }

  if (result.missingIdCount > 0) {
    result.errors.push(`${result.missingIdCount} feature(s) have no stable ID (feature.id, properties.featureId, or properties.id)`);
    result.valid = false;
  }

  if (result.duplicateIdCount > 0) {
    result.errors.push(`${result.duplicateIdCount} duplicate feature ID(s) found`);
    result.valid = false;
  }

  if (result.invalidGeometryCount > 0) {
    result.warnings.push(`${result.invalidGeometryCount} feature(s) have invalid or missing geometry`);
  }

  return result;
}
