import { DOMParser } from "@xmldom/xmldom";
import { kml } from "@tmcw/togeojson";
import { createHash } from "crypto";

export function convertKmlToGeojson(kmlText: string): {
  geojson: any;
  featureCount: number;
} {
  const doc = new DOMParser().parseFromString(kmlText, "text/xml");
  const geojson = kml(doc);

  if (!geojson || geojson.type !== "FeatureCollection") {
    throw new Error("KML conversion produced invalid GeoJSON");
  }

  for (let i = 0; i < geojson.features.length; i++) {
    const feature = geojson.features[i];
    const stableId = extractStableId(feature, i);
    feature.id = stableId;
    if (!feature.properties) feature.properties = {};
    feature.properties.featureId = stableId;
  }

  return {
    geojson,
    featureCount: geojson.features.length,
  };
}

function extractStableId(feature: any, index: number): string {
  const props = feature.properties || {};

  if (props.featureId && String(props.featureId).trim()) {
    return String(props.featureId).trim();
  }
  if (feature.id != null && String(feature.id).trim()) {
    return String(feature.id).trim();
  }
  if (props.id && String(props.id).trim()) {
    return String(props.id).trim();
  }

  const name = (props.name || props.Name || "").toString().trim().toLowerCase();
  const geom = feature.geometry;
  let coordStr = "";
  let geomType = "";

  if (geom) {
    geomType = (geom.type || "").toLowerCase();
    if (geom.type === "Point" && geom.coordinates) {
      const [lng, lat] = geom.coordinates;
      coordStr = `${Number(lng).toFixed(6)},${Number(lat).toFixed(6)}`;
    } else if (geom.type === "LineString" && geom.coordinates) {
      coordStr = geom.coordinates
        .map((c: number[]) => `${Number(c[0]).toFixed(6)},${Number(c[1]).toFixed(6)}`)
        .join(";");
    } else if (geom.type === "Polygon" && geom.coordinates?.[0]) {
      coordStr = geom.coordinates[0]
        .map((c: number[]) => `${Number(c[0]).toFixed(6)},${Number(c[1]).toFixed(6)}`)
        .join(";");
    } else if (geom.coordinates) {
      coordStr = JSON.stringify(geom.coordinates);
    }
  }

  const hashInput = `${name}|${geomType}|${coordStr}`;
  const hash = createHash("sha1").update(hashInput).digest("hex").substring(0, 12);
  return `derived_${hash}`;
}

export function normalizeGeojsonFeatureIds(geojsonText: string): {
  geojson: any;
  featureCount: number;
} {
  const parsed = JSON.parse(geojsonText);

  if (parsed.type !== "FeatureCollection" || !Array.isArray(parsed.features)) {
    if (parsed.type === "Feature") {
      const fc = { type: "FeatureCollection", features: [parsed] };
      normalizeFeatures(fc.features);
      return { geojson: fc, featureCount: 1 };
    }
    throw new Error("Invalid GeoJSON: expected FeatureCollection or Feature");
  }

  normalizeFeatures(parsed.features);
  return { geojson: parsed, featureCount: parsed.features.length };
}

function normalizeFeatures(features: any[]) {
  for (let i = 0; i < features.length; i++) {
    const feature = features[i];
    if (!feature.properties) feature.properties = {};

    const stableId = extractStableId(feature, i);
    feature.id = stableId;
    feature.properties.featureId = stableId;
  }
}
