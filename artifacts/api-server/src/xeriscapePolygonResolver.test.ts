import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Asset, MapLayer } from "@workspace/db";
import { resolveXeriscapePolygons } from "./xeriscapePolygonResolver.js";

function asset(overrides: Partial<Asset> & Pick<Asset, "id" | "communityId" | "label">): Asset {
  return {
    assetType: "bluegrass_area",
    featureRef: null,
    mapLayerId: null,
    geometryType: "polygon",
    latitude: null,
    longitude: null,
    isArchived: false,
    archivedAt: null,
    sourceUpdatedAt: null,
    tags: [],
    createdBy: null,
    updatedBy: null,
    version: 1,
    capturedAccuracyM: null,
    capturedSampleCount: null,
    capturedAt: null,
    capturedDeviceModel: null,
    capturedUnderCanopy: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

function layer(id: string, communityId: string, features: unknown[]): MapLayer {
  return {
    id,
    communityId,
    layerKey: "community",
    subLayerKey: "bluegrass_area",
    displayName: "Bluegrass",
    sourceFormat: "geojson",
    geojsonData: JSON.stringify({ type: "FeatureCollection", features }),
    color: null,
    strokeColor: null,
    strokeWeight: null,
    fillOpacity: null,
    isEnabled: true,
    version: 1,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

const polygon = {
  type: "Polygon",
  coordinates: [[[-105, 40], [-105, 40.001], [-104.999, 40], [-105, 40]]],
};

describe("resolveXeriscapePolygons", () => {
  it("resolves identifier, name, and point fallbacks and reconciles communities", () => {
    const result = resolveXeriscapePolygons({
      communities: [
        { id: "c1", name: "North" },
        { id: "c2", name: "South" },
      ],
      assets: [
        asset({ id: "a1", communityId: "c1", label: "ID match", mapLayerId: "l1", featureRef: "feature-1" }),
        asset({ id: "a2", communityId: "c1", label: "Name match", mapLayerId: "l1", featureRef: "missing" }),
        asset({ id: "a3", communityId: "c1", label: "Point", mapLayerId: "l1", featureRef: "missing-point", latitude: 40, longitude: -105 }),
        asset({ id: "a4", communityId: "c1", label: "Unmapped" }),
        asset({ id: "a5", communityId: "c1", label: "Archived", isArchived: true, mapLayerId: "l1", featureRef: "feature-1" }),
        asset({ id: "a6", communityId: "c2", label: "Property ref", mapLayerId: "l2", featureRef: "feature-2" }),
      ],
      properties: [
        { assetId: "a1", key: "sqFt", value: "1200.5" },
        { assetId: "a2", key: "sqFt", value: "not-a-number" },
        { assetId: "a3", key: "sqFt", value: "0" },
      ],
      layers: [
        layer("l1", "c1", [
          { type: "Feature", id: "feature-1", geometry: polygon, properties: {} },
          { type: "Feature", geometry: polygon, properties: { name: "Name match" } },
        ]),
        layer("l2", "c2", [
          { type: "Feature", geometry: polygon, properties: { featureRef: "feature-2" } },
        ]),
      ],
    });

    assert.equal(result.assetsFound, 5, "archived assets are excluded");
    assert.equal(result.featuresResolved, 4);
    assert.equal(result.sqFtResolved, 1200.5);
    assert.deepEqual(result.unresolved.map((entry) => entry.assetId), ["a4"]);
    assert.equal(result.unresolved[0].communityName, "North");

    const byId = new Map(result.features.map((feature) => [feature.id, feature]));
    assert.equal(byId.get("a1")?.properties.areaStatus, "valid");
    assert.equal(byId.get("a1")?.properties.isRankable, true);
    assert.equal(byId.get("a2")?.properties.areaStatus, "invalid");
    assert.equal(byId.get("a2")?.properties.isRankable, false);
    assert.equal(byId.get("a3")?.geometry && (byId.get("a3")!.geometry as any).type, "Point");
    assert.equal(byId.get("a3")?.properties.areaStatus, "zero");
    assert.equal(byId.get("a6")?.properties.areaStatus, "missing");
    assert.equal(byId.get("a6")?.properties.communityName, "South");

    assert.deepEqual(result.byCommunity, [
      {
        communityId: "c1",
        communityName: "North",
        assetsFound: 4,
        featuresResolved: 3,
        sqFtResolved: 1200.5,
        unresolvedCount: 1,
      },
      {
        communityId: "c2",
        communityName: "South",
        assetsFound: 1,
        featuresResolved: 1,
        sqFtResolved: 0,
        unresolvedCount: 0,
      },
    ]);
  });

  it("reports invalid layer data instead of silently dropping an asset", () => {
    const badLayer = layer("bad", "c1", []);
    badLayer.geojsonData = "{not-json";
    const result = resolveXeriscapePolygons({
      communities: [{ id: "c1", name: "North" }],
      assets: [asset({ id: "a1", communityId: "c1", label: "Broken", mapLayerId: "bad", featureRef: "feature-1" })],
      properties: [],
      layers: [badLayer],
    });

    assert.equal(result.featuresResolved, 0);
    assert.equal(result.unresolved.length, 1);
    assert.equal(result.unresolved[0].reason, "invalid_map_layer");
  });

  it("retains the existing community feature payload when portfolio metadata is stripped", () => {
    const result = resolveXeriscapePolygons({
      communities: [{ id: "c1", name: "North" }],
      assets: [asset({ id: "a1", communityId: "c1", label: "Turf", mapLayerId: "l1", featureRef: "feature-1" })],
      properties: [{ assetId: "a1", key: "sqFt", value: "42" }],
      layers: [layer("l1", "c1", [{ type: "Feature", id: "feature-1", geometry: polygon, properties: {} }])],
    });

    const feature = result.features[0];
    assert.deepEqual({
      type: "Feature",
      id: feature.id,
      geometry: feature.geometry,
      properties: {
        id: feature.properties.id,
        name: feature.properties.name,
        area_sqft: feature.properties.area_sqft,
        featureRef: feature.properties.featureRef,
      },
    }, {
      type: "Feature",
      id: "a1",
      geometry: polygon,
      properties: {
        id: "a1",
        name: "Turf",
        area_sqft: 42,
        featureRef: "feature-1",
      },
    });
  });
});