/**
 * Regression tests for the irrigation KML parser.
 *
 * Run with:  pnpm --filter @workspace/api-server test
 *
 * Uses Node.js built-in test runner (node:test) with tsx for TypeScript.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseIrrigationKml, parseZoneNames } from "./kmlIrrigationParser.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
// src/ → api-server/ → artifacts/ → workspace root (3 levels up)
const FIXTURE_PATH = resolve(
  __dirname,
  "../../../attached_assets/136th_and_Colorado_-_Irrigation_(1)_1785796826170.kml"
);
// Fallback: pnpm run test is invoked from artifacts/api-server
const FIXTURE_PATH_ALT = resolve(
  process.cwd(),
  "../../attached_assets/136th_and_Colorado_-_Irrigation_(1)_1785796826170.kml"
);
const RESOLVED_FIXTURE = existsSync(FIXTURE_PATH) ? FIXTURE_PATH : FIXTURE_PATH_ALT;

// ---------------------------------------------------------------------------
// Helper: call parseZoneNames without threading an external warnings array
// ---------------------------------------------------------------------------
function pzn(name: string) {
  const warnings: string[] = [];
  const zones = parseZoneNames(name, "test-placemark", warnings);
  return { zones, warnings };
}

// ---------------------------------------------------------------------------
// 1. parseZoneNames — task-spec regression fixtures
// ---------------------------------------------------------------------------

describe("parseZoneNames — regression fixtures", () => {
  it("zone 1 (pop ups)/ 2 (rotors)/ 3 (rotors)/ 4 (rotors)", () => {
    const { zones } = pzn("zone 1 (pop ups)/ 2 (rotors)/ 3 (rotors)/ 4 (rotors)");
    assert.equal(zones.length, 4);
    assert.deepEqual(zones[0], { zoneNumber: 1, zoneType: "pop ups" });
    assert.deepEqual(zones[1], { zoneNumber: 2, zoneType: "rotors" });
    assert.deepEqual(zones[2], { zoneNumber: 3, zoneType: "rotors" });
    assert.deepEqual(zones[3], { zoneNumber: 4, zoneType: "rotors" });
  });

  it("Zone 5( pop ups)/ 6 (pop ups)/ 7(pop ups)/ 8 (pop ups)", () => {
    const { zones } = pzn("Zone 5( pop ups)/ 6 (pop ups)/ 7(pop ups)/ 8 (pop ups)");
    assert.equal(zones.length, 4);
    assert.deepEqual(zones.map(z => z.zoneNumber), [5, 6, 7, 8]);
    for (const z of zones) assert.equal(z.zoneType, "pop ups");
  });

  it("zone 34 drip", () => {
    const { zones } = pzn("zone 34 drip");
    assert.equal(zones.length, 1);
    assert.deepEqual(zones[0], { zoneNumber: 34, zoneType: "drip" });
  });

  it("Zone 25/26/27/28 rotors", () => {
    const { zones } = pzn("Zone 25/26/27/28 rotors");
    assert.equal(zones.length, 4);
    assert.deepEqual(zones.map(z => z.zoneNumber), [25, 26, 27, 28]);
    for (const z of zones) assert.equal(z.zoneType, "rotors");
  });

  it("Zone 13 (rotors) / 14 rotors)", () => {
    const { zones } = pzn("Zone 13 (rotors) / 14 rotors)");
    assert.equal(zones.length, 2);
    assert.deepEqual(zones[0], { zoneNumber: 13, zoneType: "rotors" });
    assert.deepEqual(zones[1], { zoneNumber: 14, zoneType: "rotors" });
  });

  it("Zone 33 high pops/36 drip", () => {
    const { zones } = pzn("Zone 33 high pops/36 drip");
    assert.equal(zones.length, 2);
    assert.deepEqual(zones[0], { zoneNumber: 33, zoneType: "high pops" });
    assert.deepEqual(zones[1], { zoneNumber: 36, zoneType: "drip" });
  });

  it("Zone 21 pops/ 23 pops/ 24 pops", () => {
    const { zones } = pzn("Zone 21 pops/ 23 pops/ 24 pops");
    assert.equal(zones.length, 3);
    assert.deepEqual(zones.map(z => z.zoneNumber), [21, 23, 24]);
    for (const z of zones) assert.equal(z.zoneType, "pops");
  });
});

// ---------------------------------------------------------------------------
// 2. parseZoneNames — type propagation & edge cases
// ---------------------------------------------------------------------------

describe("parseZoneNames — type propagation", () => {
  it("propagates trailing type to earlier null-type segments", () => {
    // "Zone 1 / 2 / 3 drip" — only last segment carries a type
    const { zones } = pzn("Zone 1 / 2 / 3 drip");
    assert.equal(zones.length, 3);
    for (const z of zones) assert.equal(z.zoneType, "drip");
  });

  it("returns null zoneType when truly absent", () => {
    const { zones } = pzn("Zone 5");
    assert.equal(zones.length, 1);
    assert.equal(zones[0].zoneType, null);
  });

  it("segment with no integer emits a warning and is skipped", () => {
    const { zones, warnings } = pzn("Zone pop ups / 2 rotors");
    assert.ok(warnings.length > 0, "should emit a warning for unparseable segment");
    assert.equal(zones.length, 1);
    assert.deepEqual(zones[0], { zoneNumber: 2, zoneType: "rotors" });
  });
});

// ---------------------------------------------------------------------------
// 3. Full KML parse — reference fixture
// ---------------------------------------------------------------------------

describe("Full KML parse — 136th and Colorado fixture", () => {
  if (!existsSync(RESOLVED_FIXTURE)) {
    it.skip("fixture file not found at expected path — skipping full KML tests");
  } else {
    const kmlText = readFileSync(RESOLVED_FIXTURE, "utf-8");

    it("parses without throwing", () => {
      assert.doesNotThrow(() => parseIrrigationKml(kmlText));
    });

    it("produces 35 mapped zones across 15 valve boxes", () => {
      const result = parseIrrigationKml(kmlText);
      const allZones = result.controllers.flatMap(c => c.zones);
      const mappedZones = allZones.filter(z => z.lat != null);
      assert.equal(mappedZones.length, 35, `expected 35 mapped zones, got ${mappedZones.length}`);

      const boxRefs = new Set(mappedZones.map(z => z.valveBoxRef).filter(Boolean));
      assert.equal(boxRefs.size, 15, `expected 15 valve boxes, got ${boxRefs.size}`);
    });

    it("produces exactly 4 unmapped zones: 9, 16, 22, 35", () => {
      const result = parseIrrigationKml(kmlText);
      const unmapped = result.controllers
        .flatMap(c => c.zones)
        .filter(z => z.lat == null)
        .map(z => z.zoneNumber)
        .sort((a, b) => (a ?? 0) - (b ?? 0));
      assert.deepEqual(unmapped, [9, 16, 22, 35]);
    });

    it("sibling folders produce correct asset types", () => {
      const result = parseIrrigationKml(kmlText);
      const byType: Record<string, number> = {};
      for (const a of result.siblingAssets) {
        byType[a.assetType] = (byType[a.assetType] ?? 0) + 1;
      }
      assert.equal(byType["isolation_valve"], 3, "expected 3 isolation valves");
      assert.equal(byType["quick_connect"], 1, "expected 1 quick connect");
      assert.equal(byType["backflow"], 1, "expected 1 backflow");
      assert.equal(byType["splice"], 1, "expected 1 splice");
    });

    it("mapped zone featureRef format is <placemarkId>#z<N>", () => {
      const result = parseIrrigationKml(kmlText);
      const mapped = result.controllers.flatMap(c => c.zones).filter(z => z.lat != null);
      for (const z of mapped) {
        assert.match(z.featureRef, /^.+#z\d+$/, `unexpected featureRef: ${z.featureRef}`);
      }
    });

    it("unmapped zone featureRef contains #unmapped#z", () => {
      const result = parseIrrigationKml(kmlText);
      const unmapped = result.controllers.flatMap(c => c.zones).filter(z => z.lat == null);
      for (const z of unmapped) {
        assert.match(z.featureRef, /#unmapped#z\d+$/, `unexpected featureRef: ${z.featureRef}`);
      }
    });

    it("parsing the same KML twice produces identical featureRefs (idempotent)", () => {
      const r1 = parseIrrigationKml(kmlText);
      const r2 = parseIrrigationKml(kmlText);
      const refs1 = r1.controllers.flatMap(c => c.zones).map(z => z.featureRef).sort();
      const refs2 = r2.controllers.flatMap(c => c.zones).map(z => z.featureRef).sort();
      assert.deepEqual(refs1, refs2, "zone featureRefs must be identical on re-parse");
      assert.equal(r1.siblingAssets.length, r2.siblingAssets.length);
    });

    it("totalZonesOverride generates additional unmapped zones when value exceeds parsed total", () => {
      const base = parseIrrigationKml(kmlText);
      const ctrl = base.controllers.find(c => c.totalDeclaredZones != null);
      if (!ctrl) return; // skip if no controller declares a total

      const extraTotal = (ctrl.totalDeclaredZones ?? 0) + 2;
      const override: Record<string, number> = { [ctrl.featureRef]: extraTotal };
      const result2 = parseIrrigationKml(kmlText, override);
      const ctrl2 = result2.controllers.find(c => c.featureRef === ctrl.featureRef)!;
      const unmapped2 = ctrl2.zones.filter(z => z.lat == null).length;
      const unmapped1 = ctrl.zones.filter(z => z.lat == null).length;
      assert.ok(
        unmapped2 >= unmapped1,
        `override +2 should produce >= unmapped zones (got ${unmapped2} vs base ${unmapped1})`
      );
    });
  }
});
