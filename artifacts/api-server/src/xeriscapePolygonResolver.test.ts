import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Asset, MapLayer } from "@workspace/db";
import { computeEffectiveWidthFt, resolveXeriscapePolygons } from "./xeriscapePolygonResolver.js";

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

function rectangleAtLatitude(latitude: number, widthFt: number, lengthFt: number) {
  const latitudeFeetPerDegree = 364_000;
  const longitudeFeetPerDegree = 364_000 * Math.cos(latitude * Math.PI / 180);
  const dLat = lengthFt / latitudeFeetPerDegree;
  const dLon = widthFt / longitudeFeetPerDegree;
  return {
    type: "Polygon",
    coordinates: [[
      [-105, latitude],
      [-105 + dLon, latitude],
      [-105 + dLon, latitude + dLat],
      [-105, latitude + dLat],
      [-105, latitude],
    ]],
  };
}

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

  it("prefers a useful matched feature label over the canonical asset label", () => {
    const result = resolveXeriscapePolygons({
      communities: [{ id: "c1", name: "North" }],
      assets: [asset({ id: "a1", communityId: "c1", label: "Imported name", mapLayerId: "l1", featureRef: "feature-1" })],
      properties: [{ assetId: "a1", key: "sqFt", value: "100" }],
      layers: [layer("l1", "c1", [
        { type: "Feature", id: "feature-1", geometry: polygon, properties: { name: "North Turf" } },
      ])],
    });

    assert.equal(result.features[0].properties.name, "North Turf");
  });

  it("ignores the imported placeholder and generates stable location fallbacks", () => {
    const result = resolveXeriscapePolygons({
      communities: [{ id: "c1", name: "North" }],
      assets: [
        asset({ id: "a2", communityId: "c1", label: "Untitled polygon", mapLayerId: "l1", featureRef: "b" }),
        asset({ id: "a1", communityId: "c1", label: " ", mapLayerId: "l1", featureRef: "a" }),
      ],
      properties: [],
      layers: [layer("l1", "c1", [
        { type: "Feature", id: "a", geometry: polygon, properties: { name: "Untitled polygon" } },
        { type: "Feature", id: "b", geometry: polygon, properties: { label: "Untitled polygon" } },
      ])],
    });

    const names = new Map(result.features.map((feature) => [feature.id, feature.properties.name]));
    assert.equal(names.get("a1"), "Area 1");
    assert.equal(names.get("a2"), "Area 2");
  });

  it("derives latitude-aware effective width from polygon area and perimeter", () => {
    const geometry = rectangleAtLatitude(40, 20, 100);
    const width = computeEffectiveWidthFt(geometry, 2_000);
    assert.ok(width !== null);
    assert.ok(Math.abs(width - (2 * 2_000 / 240)) < 0.2);

    const equatorGeometry = rectangleAtLatitude(0, 20, 100);
    const sameShapeAtSixty = {
      ...equatorGeometry,
      coordinates: equatorGeometry.coordinates.map((ring) =>
        ring.map(([longitude, latitude]) => [longitude, latitude + 60])),
    };
    const equatorWidth = computeEffectiveWidthFt(equatorGeometry, 2_000);
    const highLatitudeWidth = computeEffectiveWidthFt(sameShapeAtSixty, 2_000);
    assert.ok(equatorWidth !== null && highLatitudeWidth !== null);
    assert.ok(highLatitudeWidth > equatorWidth, "longitude distances shrink at higher latitudes");
  });

  it("includes multipolygon exteriors and interior rings in perimeter", () => {
    const first = rectangleAtLatitude(40, 20, 100).coordinates[0];
    const second = rectangleAtLatitude(40.001, 10, 50).coordinates[0];
    const withoutHole = computeEffectiveWidthFt({
      type: "MultiPolygon",
      coordinates: [[first], [second]],
    }, 2_500);
    const withHole = computeEffectiveWidthFt({
      type: "MultiPolygon",
      coordinates: [[first, second], [second]],
    }, 2_500);
    assert.ok(withoutHole !== null && withHole !== null);
    assert.ok(withHole < withoutHole, "an interior ring contributes to total perimeter");
  });

  it("returns null for points, malformed coordinates, and zero perimeter", () => {
    assert.equal(computeEffectiveWidthFt({ type: "Point", coordinates: [-105, 40] }, 100), null);
    assert.equal(computeEffectiveWidthFt({ type: "Polygon", coordinates: [[[null, 40], [-105, 40], [-105, 41]]] }, 100), null);
    assert.equal(computeEffectiveWidthFt({ type: "Polygon", coordinates: [[[-105, 40], [-104, 40], [-105, 41]]] }, 100), null);
    assert.equal(computeEffectiveWidthFt({ type: "Polygon", coordinates: [[[-105, 40], [-104, 40], [-105, 41], [-105.1, 40]]] }, 100), null);
    assert.equal(computeEffectiveWidthFt({ type: "Polygon", coordinates: [[[181, 40], [-104, 40], [-105, 41], [181, 40]]] }, 100), null);
    assert.equal(computeEffectiveWidthFt({ type: "Polygon", coordinates: [[[-105, 91], [-104, 40], [-105, 41], [-105, 91]]] }, 100), null);
    assert.equal(computeEffectiveWidthFt({ type: "Polygon", coordinates: [[[-105, 40], [-105, 40], [-105, 40]]] }, 100), null);
    assert.equal(computeEffectiveWidthFt(polygon, 0), null);
  });

  it("adds a nullable effective width without changing resolution totals", () => {
    const result = resolveXeriscapePolygons({
      communities: [{ id: "c1", name: "North" }],
      assets: [
        asset({ id: "polygon", communityId: "c1", label: "Polygon", mapLayerId: "l1", featureRef: "polygon" }),
        asset({ id: "point", communityId: "c1", label: "Point", latitude: 40, longitude: -105 }),
      ],
      properties: [
        { assetId: "polygon", key: "sqFt", value: "2000" },
        { assetId: "point", key: "sqFt", value: "50" },
      ],
      layers: [layer("l1", "c1", [{ type: "Feature", id: "polygon", geometry: rectangleAtLatitude(40, 20, 100), properties: {} }])],
    });
    const byId = new Map(result.features.map((feature) => [feature.id, feature]));
    assert.ok(Number.isFinite(byId.get("polygon")?.properties.effectiveWidthFt));
    assert.equal(byId.get("point")?.properties.effectiveWidthFt, null);
    assert.equal(result.featuresResolved, 2);
    assert.equal(result.sqFtResolved, 2050);
  });
});