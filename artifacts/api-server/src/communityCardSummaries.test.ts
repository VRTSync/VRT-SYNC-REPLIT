import assert from "node:assert/strict";
import { before, beforeEach, after, afterEach, describe, it } from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import express from "express";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { build } from "esbuild";

const require = createRequire(import.meta.url);

describe("community card summaries preserve displayed counts with bounded reads", () => {
  let pool: pg.Pool, client: pg.PoolClient, bundle: string, api: any, server: Server, base: string;
  let ids: string[], admin: any, queries: string[];

  before(async () => {
    assert.notEqual(process.env.NODE_ENV, "production", "Never run fixtures against production");
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const result = await build({
      stdin: {
        contents: `export * as storage from "./storage";
          export { registerAdminOverviewRoutes } from "./routes/adminOverview";`,
        resolveDir: fileURLToPath(new URL(".", import.meta.url)), loader: "ts",
      },
      bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
      plugins: [{
        name: "community-card-fixture",
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
    bundle = result.outputFiles[0].text;
  });

  beforeEach(async () => {
    client = await pool.connect();
    await client.query("BEGIN");
    queries = [];
    const module = { exports: {} as any };
    new Function("require", "module", "exports", "__db", "__pool", bundle)(
      require, module, module.exports,
      drizzle(client, { logger: { logQuery(query) { queries.push(query); } } }),
      { query: (...args: any[]) => (client.query as any)(...args) },
    );
    api = module.exports;
    ids = [];
    for (let i = 0; i < 3; i++) ids.push((await api.storage.createCommunity({ name: randomUUID() })).id);
    admin = await api.storage.createUser({
      username: randomUUID(), password: "fixture", displayName: "Fixture", role: "admin",
    });
    const member = await api.storage.createUser({
      username: randomUUID(), password: "fixture", displayName: "Member", role: "hoa_member",
    });
    for (let i = 0; i < 2; i++) {
      await api.storage.addCommunityMember(ids[i], admin.id);
      if (i === 0) await api.storage.addCommunityMember(ids[i], member.id);
      for (let n = 0; n <= i; n++) {
        await api.storage.createAsset({ communityId: ids[i], assetType: "fixture", label: "Active" });
        await client.query("INSERT INTO tasks(community_id,title,created_by,status) VALUES($1,'Fixture',$2,$3)",
          [ids[i], admin.id, n === 0 ? "completed" : "pending"]);
        await api.storage.createMapLayer({
          communityId: ids[i], layerKey: "fixture", subLayerKey: `layer-${n}`, displayName: "Fixture",
        });
      }
      await client.query("INSERT INTO assets(community_id,asset_type,label,is_archived) VALUES($1,'fixture','Archived',true)", [ids[i]]);
    }
    const app = express();
    app.use((req, _res, next) => {
      const role = req.headers["x-role"];
      req.currentUser = role ? { ...admin, role } as any : undefined;
      req.log = { error() {} } as any;
      next();
    });
    api.registerAdminOverviewRoutes(app);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    base = `http://127.0.0.1:${address.port}`;
    queries = [];
  });
  afterEach(async () => {
    server?.closeAllConnections();
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    await client?.query("ROLLBACK");
    client?.release();
  });
  after(async () => { await pool?.end(); });

  async function request(role?: string, suffix = "") {
    const response = await fetch(base + "/api/admin/community-summaries" + suffix, {
      headers: role ? { "x-role": role } : {},
    });
    return { status: response.status, body: await response.json() as any };
  }

  it("directly matches legacy card fields, including approved zero members despite real memberships", async () => {
    const { status, body } = await request("admin");
    assert.equal(status, 200);
    for (const [i, id] of ids.entries()) {
      const old = await api.storage.getAdminSummary(id);
      assert.equal(Object.hasOwn(old, "membersCount"), false, "Legacy omission must remain unchanged");
      assert.deepEqual(body[id], {
        activeAssetsCount: old.activeAssetsCount,
        tasksCount: old.tasksCount,
        mapLayersCount: old.mapLayersCount,
        membersCount: old.membersCount ?? 0,
      });
      assert.deepEqual(body[id], {
        activeAssetsCount: i < 2 ? i + 1 : 0,
        tasksCount: i < 2 ? i + 1 : 0,
        mapLayersCount: i < 2 ? i + 1 : 0, membersCount: 0,
      });
    }
  });

  it("uses exactly four queries independent of community count and ignores query parameters", async () => {
    const first = await request("admin");
    assert.equal(queries.length, 4);
    assert.equal(queries.filter(query => /group by/i.test(query)).length, 3);
    assert.ok(queries.every(query => !query.includes("community_members")));
    for (let n = 0; n < 20; n++) await api.storage.createCommunity({ name: randomUUID() });
    queries = [];
    const more = await request("admin", "?communityId=nonexistent&bypass=true");
    assert.equal(more.status, 200);
    assert.equal(queries.length, 4);
    assert.equal(Object.keys(more.body).length, Object.keys(first.body).length + 20);
    for (const id of ids) assert.deepEqual(more.body[id], first.body[id]);
  });

  it("uses the real requireAdmin responses and does not query storage for unauthorized callers", async () => {
    assert.deepEqual(await request(), { status: 401, body: { message: "Not authenticated" } });
    for (const role of ["property_manager", "contractor", "contractor_manager", "map_creator", "hoa_admin", "hoa_member", "client_admin"]) {
      assert.deepEqual(await request(role), { status: 403, body: { message: "Admin access required" } });
    }
    assert.equal(queries.length, 0);
  });

  it("returns the standard explicit failure response when the grouped read fails", async () => {
    await client.query("SAVEPOINT failure");
    await client.query("ALTER TABLE map_layers RENAME TO fixture_hidden_layers");
    assert.deepEqual(await request("admin"), {
      status: 500, body: { error: "Failed to fetch community summaries" },
    });
    await client.query("ROLLBACK TO SAVEPOINT failure");
  });
});
