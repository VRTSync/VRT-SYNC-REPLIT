import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

const routes = readFileSync(new URL("./routes/routes.ts", import.meta.url), "utf8");

describe("portfolio Water Savings route security contract", () => {
  it("names authentication middleware on every Water Savings route", () => {
    const declarations = routes
      .split("\n")
      .filter((line) => /app\.(?:get|post|patch|delete)\("\/api\/portfolio\/water-savings/.test(line));
    assert.ok(declarations.length >= 8);
    for (const declaration of declarations) {
      assert.match(declaration, /requireClientOrAdmin/);
    }
    assert.ok((routes.match(/resolvePortfolioOrg\(req\)/g) ?? []).length >= declarations.length);
  });

  it("uses communityId and 404s ownership failures", () => {
    assert.match(routes, /water-savings\/communities\/:communityId/);
    assert.match(routes, /req\.query\.communityId/);
    assert.match(routes, /getWaterSavingsCommunity\(resolved\.orgId, communityId\)/);
    assert.match(routes, /res\.status\(404\)\.json\(\{ error: "Location not found" \}\)/);
  });

  it("validates every persisted polygon pin against the resolved organization", () => {
    const occurrences = routes.match(/waterSavingsPinsBelongToOrg\(resolved\.orgId, parsed\.data\.pins\)/g) ?? [];
    assert.equal(occurrences.length, 2);
    assert.match(routes, /res\.status\(404\).*mapped areas were not found/);
  });
});