import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import bcrypt from "bcryptjs";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const PgSession = connectPgSimple(session);
const migration = readFileSync(new URL("../../../lib/db/migrations/0026_user_sessions.sql", import.meta.url), "utf8")
  .replaceAll("--> statement-breakpoint", "");

// Real auth handlers, storage and PostgreSQL session stores; all synthetic rows
// live in one rolled-back transaction. No real session is read, expired or revoked.
describe("migration-owned sessions (transactional PostgreSQL and HTTP)", () => {
  let pool: pg.Pool, client: pg.PoolClient, api: any, bundle: string, user: any;
  let server: Server, base: string;
  let stores: InstanceType<typeof PgSession>[];

  before(async () => {
    assert.notEqual(process.env.NODE_ENV, "production", "Refusing production fixtures");
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const built = await build({
      stdin: {
        contents: `export { registerAuthRoutes, loadCurrentUser } from "./auth";
          export * as storage from "./storage";`,
        resolveDir: fileURLToPath(new URL(".", import.meta.url)), loader: "ts",
      },
      bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
      plugins: [{
        name: "session-transaction",
        setup(builder) {
          builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({
            path: fileURLToPath(new URL("../../../lib/db/src/schema/schema.ts", import.meta.url)),
          }));
          builder.onResolve({ filter: /^\.\/db$/ }, () => ({ path: "db", namespace: "session-fixture" }));
          builder.onLoad({ filter: /.*/, namespace: "session-fixture" }, () => ({
            contents: "export const db = fixture.db; export const pool = fixture.pool;", loader: "js",
          }));
        },
      }],
    });
    bundle = built.outputFiles[0].text;
  });
  beforeEach(async () => {
    stores = [];
    client = await pool.connect();
    await client.query("BEGIN");
    const fixture = { db: drizzle(client), pool: { query: (...args: any[]) => (client.query as any)(...args) } };
    const module = { exports: {} as any };
    new Function("require", "module", "exports", "fixture", bundle)(require, module, module.exports, fixture);
    api = module.exports;
    user = await api.storage.createUser({
      username: randomUUID(), displayName: "Session fixture", role: "contractor",
      password: await bcrypt.hash("session-test-password", 4),
    });
    function middleware() {
      const store = new PgSession({
        pool: fixture.pool as any, tableName: "user_sessions",
        createTableIfMissing: false, pruneSessionInterval: false,
      });
      stores.push(store);
      return session({
        store, secret: "synthetic-session-migration-check",
        resave: false, saveUninitialized: false,
        cookie: { secure: false, httpOnly: true, sameSite: "lax", maxAge: 30 * 24 * 60 * 60 * 1000 },
      });
    }
    const app = express();
    app.use(express.json());
    // A second store reads the same cookie/table, as the separate portal does.
    app.use("/portal-reader", middleware(), (req, res) => res.json({ userId: req.session.userId ?? null }));
    app.use(middleware(), api.loadCurrentUser);
    api.registerAuthRoutes(app);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    base = `http://127.0.0.1:${address.port}`;
  });
  afterEach(async () => {
    server?.closeAllConnections();
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    for (const store of stores) await (store as any).close();
    if (client) {
      await client.query("ROLLBACK");
      client.release();
    }
  });
  after(async () => { await pool?.end(); });

  async function request(path: string, cookie?: string, body?: unknown) {
    return fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  async function login() {
    const res = await request("/api/auth/login", undefined, {
      username: user.username, password: "session-test-password",
    });
    assert.equal(res.status, 200);
    const header = res.headers.get("set-cookie");
    assert.ok(header);
    assert.match(header, /HttpOnly/i);
    assert.match(header, /SameSite=Lax/i);
    return header.split(";")[0];
  }
  async function ownRows() {
    return (await client.query(
      "SELECT sid,sess,expire,xmin::text,ctid::text FROM user_sessions WHERE sess->>'userId'=$1 ORDER BY sid",
      [user.id],
    )).rows;
  }

  it("keeps sessions migration-owned and excluded from push without changing other snapshot tables", () => {
    const read = (name: string) => readFileSync(new URL(`../../../lib/db/${name}`, import.meta.url), "utf8");
    const previous = JSON.parse(read("migrations/meta/0025_snapshot.json"));
    const next = JSON.parse(read("migrations/meta/0026_snapshot.json"));
    assert.equal(next.prevId, previous.id);
    assert.deepEqual(next.tables, previous.tables);
    assert.equal(next.tables["public.user_sessions"], undefined);
    assert.match(read("drizzle.config.ts"), /tablesFilter:\s*\["!user_sessions"\]/);
  });

  it("preserves existing session tuples, table/constraint/index identities and cookies on rerun", async () => {
    const cookie = await login();
    const rows = await ownRows();
    const metadata = async () => (await client.query(`
      SELECT c.oid,c.relfilenode,
        (SELECT oid FROM pg_constraint WHERE conrelid=c.oid AND contype='p') AS pk_oid,
        (SELECT conname FROM pg_constraint WHERE conrelid=c.oid AND contype='p') AS pk_name,
        (SELECT json_agg(indexname ORDER BY indexname) FROM pg_indexes
          WHERE schemaname='public' AND tablename='user_sessions') AS indexes
      FROM pg_class c WHERE c.oid='public.user_sessions'::regclass`)).rows;
    const before = await metadata();
    assert.equal(before[0].pk_name, "session_pkey");
    assert.deepEqual(before[0].indexes, ["IDX_session_expire", "session_pkey"]);
    await client.query(migration);
    await client.query(migration);
    assert.deepEqual(await metadata(), before);
    assert.deepEqual(await ownRows(), rows);
    assert.equal((await request("/api/auth/me", cookie)).status, 200);
    assert.deepEqual(await (await request("/portal-reader", cookie)).json(), { userId: user.id });
  });

  it("supports two device cookies, targeted revocation and normal logout", async () => {
    const web = await login(), mobile = await login();
    assert.equal((await ownRows()).length, 2);
    const keepSid = (await ownRows())[0].sid;
    await api.storage.revokeUserSessions(user.id, keepSid);
    assert.equal((await ownRows()).length, 1);
    const statuses = await Promise.all([web, mobile].map(async cookie => (await request("/api/auth/me", cookie)).status));
    assert.deepEqual([...statuses].sort(), [200, 401]);
    const surviving = statuses[0] === 200 ? web : mobile;
    assert.equal((await request("/api/auth/logout", surviving, {})).status, 200);
    assert.equal((await ownRows()).length, 0);
    assert.equal((await request("/api/auth/me", surviving)).status, 401);
  });

  it("honors expiry and all-device revocation using only synthetic sessions", async () => {
    const expired = await login();
    await client.query("UPDATE user_sessions SET expire=now()-interval '1 second' WHERE sess->>'userId'=$1", [user.id]);
    assert.equal((await request("/api/auth/me", expired)).status, 401);
    const current = await login();
    await api.storage.revokeUserSessions(user.id);
    assert.equal((await ownRows()).length, 0);
    assert.equal((await request("/api/auth/me", current)).status, 401);
    assert.deepEqual(await (await request("/portal-reader", current)).json(), { userId: null });
  });

  it("reflects community removal without requiring session-table mutation", async () => {
    const community = await api.storage.createCommunity({ name: randomUUID() });
    await api.storage.addCommunityMember(community.id, user.id);
    const cookie = await login();
    assert.equal((await (await request("/api/auth/me", cookie)).json() as any).communities.length, 1);
    await api.storage.removeCommunityMember(community.id, user.id);
    const res = await request("/api/auth/me", cookie);
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json() as any).communities, []);
    assert.equal((await ownRows()).length, 1);
  });
});
