import assert from "node:assert/strict";
import { before, beforeEach, after, afterEach, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { Server } from "node:http";
import express from "express";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const migration = readFileSync(new URL("../../../lib/db/migrations/0025_performance_indexes.sql", import.meta.url), "utf8");
const geo = (n: number) => JSON.stringify({ type: "FeatureCollection", features: Array.from({ length: n }, (_, i) => ({
  type: "Feature", id: `feature-${i}`, properties: { name: `Feature ${i}` },
  geometry: { type: "Point", coordinates: [-105, 40] },
})) });

describe("P2 result equivalence and bounded database queries", () => {
  let pool: pg.Pool, client: pg.PoolClient, bundle: string, api: any, server: Server, base: string;
  let community: string, otherCommunity: string, layers: any[], fixtureAssets: any[], admin: any, manager: any;
  let typeA: string, typeB: string, company: string, foreignCompany: string;
  let queries: { sql: string; params: unknown[] }[];
  const notices: string[] = [];
  const plain = (value: any) => JSON.parse(JSON.stringify(value));

  before(async () => {
    assert.notEqual(process.env.NODE_ENV, "production", "Never run fixtures against production");
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    // Same dev-side migration convention as the other PostgreSQL fixture suites.
    await pool.query(migration);
    const built = await build({
      stdin: {
        contents: `
          export * as storage from "./storage";
          export * as old from "./testUtils/performanceBaseline";
          export { invalidateAssetTypeCache } from "./assetTypeCache";
          export { registerSearchRoutes } from "./routes/search";
          export { registerMapLayerRoutes } from "./routes/mapLayers";
          export { registerAdminOverviewRoutes } from "./routes/adminOverview";
          export { registerAssetRoutes } from "./routes/assets";
        `,
        resolveDir: fileURLToPath(new URL(".", import.meta.url)), loader: "ts",
      },
      bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
      plugins: [{
        name: "performance-fixture",
        setup(builder) {
          builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({
            path: fileURLToPath(new URL("../../../lib/db/src/schema/schema.ts", import.meta.url)),
          }));
          builder.onResolve({ filter: /^\.\.?\/db$/ }, () => ({ path: "db", namespace: "fixture" }));
          builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents: "export const db = __db; export const pool = __pool;", loader: "js",
          }));
        },
      }],
    });
    bundle = built.outputFiles[0].text;
  });
  beforeEach(async () => {
    client = await pool.connect();
    client.on("notice", notice => { if (notice.message?.startsWith("P2 counts:")) notices.push(notice.message); });
    await client.query("BEGIN");
    queries = [];
    const database = drizzle(client, { logger: {
      logQuery(sql, params) { queries.push({ sql, params }); },
    } });
    const module = { exports: {} as any };
    new Function("require", "module", "exports", "__db", "__pool", bundle)(
      require, module, module.exports, database, {
        query: (...args: any[]) => (client.query as any)(...args),
      },
    );
    api = module.exports;
    community = (await api.storage.createCommunity({ name: `P2 ${randomUUID()}` })).id;
    otherCommunity = (await api.storage.createCommunity({ name: `P2 other ${randomUUID()}` })).id;
    typeA = `p2-${randomUUID()}`; typeB = `p2-${randomUUID()}`;
    await client.query(`INSERT INTO asset_types (key,label,layer_key,sub_layer_key,required_keys,is_active)
      VALUES ($1::text,'A',$1::text,'a','["second","first"]',true), ($2::text,'B',$2::text,'b','["third"]',false)`, [typeA, typeB]);
    api.invalidateAssetTypeCache();
    admin = await api.storage.createUser({ username: randomUUID(), password: "fixture", displayName: "Admin", role: "admin" });
    const companies = await client.query(`INSERT INTO companies(name,normalized_name,kind)
      VALUES ($1,$1,'contractor'),($2,$2,'contractor') RETURNING id`, [randomUUID(), randomUUID()]);
    [company, foreignCompany] = companies.rows.map(row => row.id);
    manager = await api.storage.createUser({ username: randomUUID(), password: "fixture", displayName: "Manager",
      role: "contractor_manager", companyId: company });
    await api.storage.addCommunityMember(community, manager.id);
    layers = [];
    for (const [key, name] of [["a", "Z layer"], ["b", "A layer"]]) {
      layers.push(await api.storage.createMapLayer({ communityId: community, layerKey: typeA,
        subLayerKey: key, displayName: name, geojsonData: geo(2) }));
    }
    fixtureAssets = [];
    for (const [label, type, archived] of [
      ["Zulu missing", typeA, false], ["Alpha complete", typeA, false],
      ["Beta inactive type", typeB, false], ["Archived", typeA, true],
    ] as const) {
      const asset = await api.storage.createAsset({ communityId: community, assetType: type,
        label, mapLayerId: layers[0].id });
      if (archived) await api.storage.updateAssetArchived(asset.id, true);
      fixtureAssets.push(asset);
    }
    await api.storage.upsertAssetProperties(fixtureAssets[1].id, [
      { key: "second", value: "" }, { key: "first", value: "yes" },
    ]);
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.session = { userId: admin.id } as any;
      req.currentUser = admin;
      req.log = { error() {} } as any;
      next();
    });
    api.registerSearchRoutes(app);
    api.registerMapLayerRoutes(app);
    api.registerAdminOverviewRoutes(app);
    api.registerAssetRoutes(app);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    base = `http://127.0.0.1:${address.port}`;
    await api.storage.getMissingRequiredKeysForAssets([]); // warm catalogue for query assertions
    queries = [];
  });
  afterEach(async () => {
    server?.closeAllConnections();
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    await client?.query("ROLLBACK");
    client?.removeAllListeners("notice");
    client?.release();
  });
  after(async () => { await pool?.end(); });

  async function request(path: string, method = "GET", body?: unknown) {
    const response = await fetch(base + path, {
      method, headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json() as any;
    assert.ok(response.ok, `${response.status}: ${JSON.stringify(result)}`);
    return result;
  }
  async function measured<T>(callback: () => Promise<T>, count: number) {
    queries = [];
    const result = await callback();
    assert.equal(queries.length, count, queries.map(query => query.sql).join("\n"));
    return result;
  }
  async function completion(assetId: string, owner: string, offset = 0, targetCommunity = community) {
    const task = (await client.query(`INSERT INTO tasks(community_id,title,created_by,contractor_company_id)
      VALUES ($1,'History fixture',$2,$3) RETURNING id`, [targetCommunity, admin.id, owner])).rows[0];
    await client.query("INSERT INTO task_links(task_id,asset_id,link_type) VALUES($1,$2,'asset')", [task.id, assetId]);
    const done = (await client.query(`INSERT INTO task_completions(task_id,completed_by,notes,completed_at)
      VALUES($1,$2,'Work',now() - ($3 * interval '1 hour')) RETURNING id`, [task.id, admin.id, offset])).rows[0];
    await client.query(`INSERT INTO attachments(task_completion_id,file_ref,url,uploaded_by,idempotency_key)
      VALUES($1,'fixture','/objects/fixture',$2,$3)`, [done.id, admin.id, randomUUID()]);
    return task.id;
  }

  it("batches full property rows, handles empty/duplicate IDs, and bounds 2,001 IDs", async () => {
    assert.equal((await measured(() => api.storage.getAssetPropertiesForAssets([]), 0) as Map<any, any>).size, 0);
    const ids = [fixtureAssets[1].id, fixtureAssets[1].id, ...Array.from({ length: 2000 }, () => randomUUID())];
    const result: any = await measured(() => api.storage.getAssetPropertiesForAssets(ids), 3);
    assert.deepEqual(result.get(fixtureAssets[1].id), await api.old.getAssetProperties(fixtureAssets[1].id));
    const propertyQueries = queries.filter(query => query.sql.includes('from "asset_properties"')).slice(0, 3);
    assert.deepEqual(propertyQueries.map(query => query.params.length), [1000, 1000, 1]);
  });

  it("retains incomplete asset order, missing-key order, filters and unknown types", async () => {
    const expected = await api.old.getIncompleteAssets(community);
    assert.deepEqual(expected.map((row: any) => [row.label, row.missingRequiredKeys]),
      [["Beta inactive type", ["third"]], ["Zulu missing", ["second", "first"]]]);
    assert.deepEqual(await measured(() => api.storage.getIncompleteAssets(community), 2), expected);
    api.invalidateAssetTypeCache();
    assert.deepEqual(await measured(() => api.storage.getIncompleteAssets(community), 3), expected);
    for (const args of [[typeA], [undefined, layers[1].id], [undefined, layers[0].id, "first"], [undefined, undefined, "absent"]]) {
      assert.deepEqual(await api.storage.getIncompleteAssets(community, ...args),
        await api.old.getIncompleteAssets(community, ...args));
    }
    const missing = await api.storage.getMissingRequiredKeysForAssets([{ ...fixtureAssets[0], assetType: "unknown" }]);
    assert.deepEqual(missing.get(fixtureAssets[0].id), []);
    assert.deepEqual(await measured(() => api.storage.getIncompleteAssets(otherCommunity), 1), []);
  });

  it("preserves the completeness route including type filtering and missing-key order", async () => {
    for (const type of [undefined, typeA]) {
      const all = await api.old.getAssetsByCommunitySorted(community, type, true);
      const active = all.filter((asset: any) => !asset.isArchived);
      const missingRequiredAssets = [];
      for (const asset of active) {
        const incomplete = (await api.old.getIncompleteAssets(community, type)).find((row: any) => row.id === asset.id);
        if (incomplete) missingRequiredAssets.push({ id: asset.id, label: asset.label,
          assetType: asset.assetType, missingKeys: incomplete.missingRequiredKeys });
      }
      assert.deepEqual(await measured(() => request(`/api/communities/${community}/assets/completeness${type ? `?type=${type}` : ""}`), 2), {
        total: all.length, active: active.length, archived: all.length - active.length,
        missingRequired: missingRequiredAssets.length, missingRequiredAssets,
      });
    }
  });

  it("matches both admin summaries, layer order and zero-filled empty layers", async () => {
    for (const id of [community, undefined]) {
      const expected = await api.old.getAdminSummary(id);
      const actual = await measured(() => api.storage.getAdminSummary(id), id ? 11 : 7);
      assert.deepEqual(actual, expected);
      assert.deepEqual(await request(`/api/admin/summary${id ? `?communityId=${id}` : ""}`), plain(expected));
      if (id) assert.deepEqual(actual.layerStats.find((row: any) => row.layerId === layers[1].id),
        { layerId: layers[1].id, activeAssets: 0, archivedAssets: 0 });
    }
    // The old implementation counts all assets attached to the chosen layer,
    // including a legacy cross-community reference. Do not silently fix policy.
    await api.storage.createAsset({ communityId: otherCommunity, assetType: typeA, label: "Cross reference", mapLayerId: layers[0].id });
    assert.deepEqual(await api.storage.getAdminSummary(community), await api.old.getAdminSummary(community));
    await client.query("UPDATE assets SET map_layer_id=$1 WHERE id=$2", [layers[1].id, fixtureAssets[2].id]);
    assert.deepEqual(await api.storage.getAdminSummary(community), await api.old.getAdminSummary(community));
  });

  it("matches layer summaries with cached, zero, NULL and malformed feature counts", async () => {
    const expected = await api.old.getMapLayerSummary(layers[0].id, community);
    assert.deepEqual(expected, { activeAssetCount: 3, archivedAssetCount: 1, incompleteAssetCount: 2 });
    assert.deepEqual(await measured(() => api.storage.getMapLayerSummary(layers[0].id, community), 2), expected);
    for (const [data, cached, count] of [[geo(2), 2, 2], [geo(2), null, 2], [geo(0), 0, 0],
      ["bad json", null, 0], ['{"features":{}}', null, 0], ["null", null, 0]] as const) {
      await client.query("UPDATE map_layers SET geojson_data=$1,feature_count=$2 WHERE id=$3", [data, cached, layers[0].id]);
      const metadata = await api.storage.getMapLayerSummaryMetadata(layers[0].id);
      assert.equal(metadata.geojsonData, cached == null ? data : null);
      assert.deepEqual(await measured(() => request(`/api/map-layers/${layers[0].id}/summary`), 3),
        { featureCount: count, sourceFormat: "geojson", ...expected });
    }
    assert.deepEqual(await api.storage.getMapLayerSummary(layers[1].id, community),
      { activeAssetCount: 0, archivedAssetCount: 0, incompleteAssetCount: 0 });
  });

  it("keeps scoped offline history, duplicate links, dates, photos and per-asset limits identical", async () => {
    const taskId = await completion(fixtureAssets[0].id, company, 1);
    await completion(fixtureAssets[0].id, company, 2);
    await completion(fixtureAssets[0].id, foreignCompany, 0);
    await completion(fixtureAssets[3].id, company, 3);
    await completion(fixtureAssets[0].id, company, 4, otherCommunity);
    await client.query(`INSERT INTO task_links(task_id,asset_id,link_type) VALUES($1,$2,'asset'),($1,$2,'asset'),($1,$3,'asset')`,
      [taskId, fixtureAssets[0].id, fixtureAssets[1].id]);
    for (const viewer of [undefined, manager.id]) {
      for (const limit of [5, 1, 0, -1]) {
        const expected = await api.old.generateWorkHistorySnapshot(community, limit, viewer);
        const actual = await measured(() => api.storage.generateWorkHistorySnapshot(community, limit, viewer), 3);
        assert.deepEqual(actual, expected);
        assert.equal(fixtureAssets[2].id in actual, false);
      }
      assert.deepEqual(await api.storage.getAssetWorkHistory(fixtureAssets[0].id, viewer),
        await api.old.getAssetWorkHistory(fixtureAssets[0].id, viewer));
    }
    await client.query("UPDATE users SET company_id=$1 WHERE id=$2", [foreignCompany, manager.id]);
    assert.deepEqual(await api.storage.generateWorkHistorySnapshot(community, 5, manager.id),
      await api.old.generateWorkHistorySnapshot(community, 5, manager.id));
    await client.query("DELETE FROM community_members WHERE user_id=$1", [manager.id]);
    assert.deepEqual(await api.storage.generateWorkHistorySnapshot(community, 5, manager.id), {});
    assert.deepEqual(await measured(() => api.storage.generateWorkHistorySnapshot(otherCommunity + "-missing"), 1), {});
    assert.equal((await measured(() => api.storage.getAssetWorkHistoryForAssets([]), 0) as Map<any, any>).size, 0);
  });

  it("bounds large property reads and keeps all hotspot query counts independent of asset count", async () => {
    await client.query(`INSERT INTO assets(id,community_id,asset_type,label,map_layer_id)
      SELECT 'p2-' || gen_random_uuid(),$1,$2,'Bulk ' || n,$3 FROM generate_series(1,1001) n`,
    [community, typeA, layers[0].id]);
    assert.deepEqual(await measured(() => api.storage.getIncompleteAssets(community), 3), await api.old.getIncompleteAssets(community));
    assert.deepEqual(await measured(() => api.storage.getMapLayerSummary(layers[0].id, community), 3),
      await api.old.getMapLayerSummary(layers[0].id, community));
    await measured(() => request(`/api/communities/${community}/assets/completeness`), 3);
    assert.deepEqual(await measured(() => api.storage.getAdminSummary(community), 11), await api.old.getAdminSummary(community));
    assert.deepEqual(await measured(() => api.storage.generateWorkHistorySnapshot(community), 3), {});
    const propertyQueries = queries.filter(query => query.sql.includes('from "asset_properties"'));
    assert.ok(propertyQueries.every(query => query.params.length <= 1000));
  });

  it("bounds history task/completion/attachment IDs above 1,000 without losing entries", async () => {
    await client.query(`INSERT INTO tasks(id,community_id,title,created_by,contractor_company_id)
      SELECT 'p2-task-' || n || '-' || $1,$2,'Bulk',$3,$4 FROM generate_series(1,1001) n`,
    [community, community, admin.id, company]);
    await client.query(`INSERT INTO task_links(task_id,asset_id,link_type)
      SELECT id,$2,'asset' FROM tasks WHERE community_id=$1`, [community, fixtureAssets[0].id]);
    await client.query(`INSERT INTO task_completions(task_id,completed_by,completed_at)
      SELECT id,$2,now() - (row_number() over () * interval '1 minute') FROM tasks WHERE community_id=$1`, [community, admin.id]);
    const expected = await api.old.generateWorkHistorySnapshot(community, 1001, manager.id);
    const actual = await measured(() => api.storage.generateWorkHistorySnapshot(community, 1001, manager.id), 4);
    assert.deepEqual(actual, expected);
    assert.equal(actual[fixtureAssets[0].id].length, 1001);
    assert.ok(queries.every(query => query.params.length <= 1001)); // one manager binding + up to 1,000 task IDs
  });

  it("backfills only valid feature arrays, preserves existing counts and reruns safely", async () => {
    const data = [geo(0), geo(3), "{broken", '{"features":null}', '{"features":{}}', "null", null, geo(1)];
    // Temporary shadow tables isolate migration fixtures without changing real data.
    await client.query("CREATE TEMP TABLE map_layers(id text PRIMARY KEY,geojson_data text,feature_count integer)");
    for (let i = 0; i < data.length; i++) await client.query("INSERT INTO map_layers VALUES($1,$2,$3)",
      [String(i), data[i], i === 7 ? 9 : null]);
    await client.query(migration);
    assert.deepEqual((await client.query("SELECT feature_count FROM map_layers ORDER BY id")).rows.map(row => row.feature_count),
      [0, 3, null, null, null, null, null, 9]);
    assert.equal(notices.at(-1), "P2 counts: layers backfilled=2, layers left null=5");
    await client.query(migration);
    assert.equal(notices.at(-1), "P2 counts: layers backfilled=0, layers left null=5");
    const indexes = await client.query(`SELECT indexname FROM pg_indexes WHERE schemaname='public'
      AND indexname=ANY($1::text[])`, [["assets_map_layer_idx", "community_members_user_idx", "task_links_task_idx",
      "task_links_asset_idx", "task_completions_task_idx"]]);
    assert.equal(indexes.rows.length, 5);
  });

  it("records only the five indexes and nullable column in migration metadata", () => {
    const previous = JSON.parse(readFileSync(new URL("../../../lib/db/migrations/meta/0024_snapshot.json", import.meta.url), "utf8"));
    const next = JSON.parse(readFileSync(new URL("../../../lib/db/migrations/meta/0025_snapshot.json", import.meta.url), "utf8"));
    assert.equal(next.prevId, previous.id);
    for (const [table, name] of [["assets", "assets_map_layer_idx"], ["community_members", "community_members_user_idx"],
      ["task_links", "task_links_task_idx"], ["task_links", "task_links_asset_idx"], ["task_completions", "task_completions_task_idx"]]) {
      assert.ok(next.tables[`public.${table}`].indexes[name]);
      delete next.tables[`public.${table}`].indexes[name];
    }
    assert.deepEqual(next.tables["public.map_layers"].columns.feature_count,
      { name: "feature_count", type: "integer", primaryKey: false, notNull: false });
    delete next.tables["public.map_layers"].columns.feature_count;
    assert.deepEqual(next.tables, previous.tables);
    assert.deepEqual(next.enums, previous.enums);
    const journal = JSON.parse(readFileSync(new URL("../../../lib/db/migrations/meta/_journal.json", import.meta.url), "utf8"));
    assert.equal(journal.entries.filter((entry: any) => entry.idx === 25).length, 1);
    assert.equal(journal.entries.at(-1).tag, "0025_performance_indexes");
  });

  it("updates cached counts on direct creates/edits and keeps caches out of existing responses", async () => {
    for (const [data, count] of [[geo(3), 3], ["bad", null], ['{"features":{}}', null], [geo(0), 0]] as const) {
      const updated = await api.storage.updateMapLayer(layers[0].id, (await api.storage.getMapLayerById(layers[0].id)).version,
        { geojsonData: data });
      assert.equal("featureCount" in updated, false);
      assert.equal((await api.storage.getMapLayerSummaryMetadata(updated.id)).featureCount, count);
      await api.storage.updateMapLayer(updated.id, updated.version, { displayName: "Changed" });
      assert.equal((await api.storage.getMapLayerSummaryMetadata(updated.id)).featureCount, count);
    }
    assert.equal((await api.storage.getMapLayerSummaryMetadata(layers[1].id)).featureCount, 2);
    assert.equal(await api.storage.updateMapLayer(layers[0].id, 0, { geojsonData: geo(100) }), null);
    assert.ok((await request(`/api/map-layers?communityId=${community}`)).every((layer: any) => !("featureCount" in layer)));
  });

  it("caches create, upload, explicit replace, key replace, merge and patch writes; delete still works", async () => {
    const create = await request("/api/map-layers", "POST", { communityId: community, layerKey: "outline",
      subLayerKey: "community_boundary", displayName: "Outline", geojsonData: geo(1) });
    assert.equal((await api.storage.getMapLayerSummaryMetadata(create.id)).featureCount, 1);
    const patch = await request(`/api/map-layers/${create.id}`, "PATCH", { version: create.version, geojsonData: geo(2) });
    assert.equal((await api.storage.getMapLayerSummaryMetadata(create.id)).featureCount, 2);
    const upload = { communityId: community, layerKey: "outline", subLayerKey: "community_boundary",
      displayName: "Outline", geojsonData: geo(3) };
    const explicit = await request("/api/map-layers/upload", "POST", { ...upload, layerId: create.id, version: patch.version });
    assert.equal((await api.storage.getMapLayerSummaryMetadata(create.id)).featureCount, 3);
    const replace = await request("/api/map-layers/upload", "POST", { ...upload, mode: "replace", version: explicit.version, geojsonData: geo(1) });
    assert.equal((await api.storage.getMapLayerSummaryMetadata(create.id)).featureCount, 1);
    const merge = await request("/api/map-layers/upload", "POST", { ...upload, mode: "merge", version: replace.version });
    assert.equal((await api.storage.getMapLayerSummaryMetadata(create.id)).featureCount, 3);
    assert.equal(merge.featureCount, 3);
    assert.deepEqual(await request(`/api/map-layers/${create.id}`, "DELETE"), { success: true });
    const inserted = await request("/api/map-layers/upload", "POST", upload);
    assert.equal((await api.storage.getMapLayerSummaryMetadata(inserted.id)).featureCount, 3);
  });

  it("caches irrigation upload inserts and replacements for controllers and zones", async () => {
    const kml = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>
      <Folder><name>Controller A</name><Placemark><name>Controller A</name><Point><coordinates>-105,40,0</coordinates></Point></Placemark>
      <Placemark><name>Zone 1 rotors</name><Point><coordinates>-105.001,40.001,0</coordinates></Point></Placemark></Folder>
      </Document></kml>`;
    for (let run = 0; run < 2; run++) {
      const form = new FormData();
      form.set("communityId", community);
      form.set("file", new Blob([kml], { type: "application/vnd.google-earth.kml+xml" }), "irrigation.kml");
      const response = await fetch(base + "/api/map-layers/upload-irrigation", { method: "POST", body: form });
      const body = await response.json() as any;
      assert.equal(response.status, 200, JSON.stringify(body));
      for (const id of [body.controllerLayerId, body.zoneLayerId]) {
        const layer = await api.storage.getMapLayerById(id);
        const metadata = await api.storage.getMapLayerSummaryMetadata(id);
        assert.equal(metadata.featureCount, JSON.parse(layer.geojsonData).features.length);
      }
    }
  });

  it("updates feature counts for the map-creator pin create and append paths", async () => {
    await client.query("UPDATE users SET role='map_creator' WHERE id=$1", [admin.id]);
    admin = { ...admin, role: "map_creator" };
    await api.storage.addCommunityMember(community, admin.id);
    // The pin route must create its own layer, then append to that same layer.
    await api.storage.deleteMapLayer(layers[0].id);
    for (let n = 1; n <= 2; n++) {
      const result = await request("/api/assets", "POST", { communityId: community, assetType: typeA,
        label: `Pin ${n}`, latitude: 40, longitude: -105 });
      assert.equal(result.isNewLayer, n === 1);
      assert.equal((await api.storage.getMapLayerSummaryMetadata(result.layerId)).featureCount, n);
      assert.equal("featureCount" in result.layer, false);
    }
  });
});

it("writes P2 migration notices to the API logger without printing unrelated notices", async () => {
  const built = await build({
    entryPoints: [fileURLToPath(new URL("./db.ts", import.meta.url))],
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{
      name: "notice-logging",
      setup(builder) {
        builder.onResolve({ filter: /^(pg|drizzle-orm\/node-postgres|@workspace\/db|\.\/lib\/logger)$/ }, args => ({
          path: args.path, namespace: "notice",
        }));
        builder.onLoad({ filter: /.*/, namespace: "notice" }, ({ path }) => ({
          contents: path === "pg"
            ? 'import { EventEmitter } from "node:events"; export default { Pool: class extends EventEmitter {} };'
            : path === "drizzle-orm/node-postgres" ? "export const drizzle = () => ({});"
              : path === "./lib/logger" ? "export const logger = { info: value => __logs.push(value) };"
                : "export {};",
          loader: "js",
        }));
      },
    }],
  });
  const logs: string[] = [];
  const module = { exports: {} as any };
  new Function("require", "module", "exports", "__logs", built.outputFiles[0].text)(require, module, module.exports, logs);
  const connection = new EventEmitter();
  module.exports.pool.emit("connect", connection);
  connection.emit("notice", { message: "P2 counts: layers backfilled=2, layers left null=5" });
  connection.emit("notice", { message: "column already exists, skipping" });
  assert.deepEqual(logs, ["P2 counts: layers backfilled=2, layers left null=5"]);
});
