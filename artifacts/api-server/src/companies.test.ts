import assert from "node:assert/strict";
import { before, beforeEach, after, afterEach, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import express from "express";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { build } from "esbuild";
import { normalizeCompanyName } from "../../../lib/db/src/schema/schema";

// Like communityAccess.test.ts, exercise the production handlers over HTTP.
// Here storage uses real PostgreSQL, with every fixture rolled back.
const require = createRequire(import.meta.url);
const routes = readFileSync(new URL("./routes/routes.ts", import.meta.url), "utf8");
function between(start: string, end: string) {
  const from = routes.indexOf(start), to = routes.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Missing verified boundary: ${start}`);
  return routes.slice(from, to);
}
const helpers = between("async function checkHoaLimits(", "export async function registerRoutes(");
const communityHelper = between("async function userCanAccessCommunity(", "  registerAuthRoutes(app);");
const handlers = between('app.get("/api/admin/companies",', 'app.delete("/api/admin/users/:id",') +
  between('app.get("/api/communities/:id/bounds",', 'app.get("/api/communities/:id/controllers",');
const migration = readFileSync(new URL("../../../lib/db/migrations/0022_companies.sql", import.meta.url), "utf8")
  .replaceAll("--> statement-breakpoint", "");

describe("company labels (production handlers and transactional PostgreSQL)", () => {
  let pool: pg.Pool, client: pg.PoolClient, server: Server;
  let bundle: string, api: any, base: string, a: string, b: string, admin: any, crew: any, pm: any, hoa: any;
  let contractorCompany: any, managementCompany: any;

  before(async () => {
    assert.notEqual(process.env.NODE_ENV, "production", "Refusing production database tests");
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const built = await build({
      stdin: {
        contents: `
          import * as storage from "./storage";
          import { requireAdmin, requireAuth, loadCurrentUser, isHoaRole, isClientRole, registerAuthRoutes } from "./auth";
          import { normalizeCompanyName, userRoleEnum } from "@workspace/db";
          import { z } from "zod";
          import bcrypt from "bcryptjs";
          ${helpers}
          ${communityHelper}
          export {storage};
          export function setup(app: any) { app.use(loadCurrentUser); ${handlers} registerAuthRoutes(app); }
        `, resolveDir: fileURLToPath(new URL(".", import.meta.url)), loader: "ts",
      },
      bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
      plugins: [{
        name: "isolated-company-db",
        setup(builder) {
          builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({
            path: fileURLToPath(new URL("../../../lib/db/src/schema/schema.ts", import.meta.url)),
          }));
          builder.onResolve({ filter: /^\.\/db$/ }, () => ({ path: "db", namespace: "fixture" }));
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
    await client.query("BEGIN");
    const database = drizzle(client);
    // Production transactions become savepoints inside the outer test rollback.
    let savepoint = 0;
    database.transaction = (async (callback: (tx: any) => Promise<any>) => {
      const name = `company_test_${++savepoint}`;
      await client.query(`SAVEPOINT ${name}`);
      try {
        const result = await callback(database);
        await client.query(`RELEASE SAVEPOINT ${name}`);
        return result;
      } catch (error) {
        await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
        throw error;
      }
    }) as typeof database.transaction;
    const module = { exports: {} as any };
    new Function("require", "module", "exports", "__db", "__pool", bundle)(
      require, module, module.exports, database, { query: (...args: any[]) => (client.query as any)(...args) },
    );
    api = module.exports;
    a = (await client.query("INSERT INTO communities (name) VALUES ('Company test A') RETURNING id")).rows[0].id;
    b = (await client.query("INSERT INTO communities (name) VALUES ('Company test B') RETURNING id")).rows[0].id;
    contractorCompany = await api.storage.createCompany(`Company Test ${randomUUID()}`, "contractor");
    managementCompany = await api.storage.createCompany(`Management Test ${randomUUID()}`, "management_company");
    admin = await user("admin");
    crew = await user("contractor", { companyId: contractorCompany.id });
    pm = await user("property_manager", { companyId: managementCompany.id });
    hoa = await user("hoa_member", { hoaCommunityId: a });
    await api.storage.addCommunityMembers(a, [crew.id, pm.id]);
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.session = { userId: req.headers["x-user"], destroy: (cb: () => void) => cb() };
      next();
    });
    api.setup(app);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    base = `http://127.0.0.1:${address.port}`;
  });
  afterEach(async () => {
    server?.closeAllConnections();
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    if (client) { await client.query("ROLLBACK"); client.release(); }
  });
  after(async () => { await pool?.end(); });

  async function user(role: string, extra: object = {}) {
    return api.storage.createAdminUser({
      username: `company-${randomUUID()}`, displayName: "Company fixture", password: "not-a-login", role, ...extra,
    });
  }
  async function request(method: string, path: string, body?: any, actor = admin) {
    const result = await fetch(base + path, {
      method, headers: { "Content-Type": "application/json", "x-user": actor.id },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: result.status, body: await result.json() };
  }
  async function memberships(id: string) {
    return (await client.query("SELECT community_id FROM community_members WHERE user_id=$1 ORDER BY community_id", [id])).rows.map(r => r.community_id);
  }

  it("normalizes punctuation, ampersands, spacing and exactly one trailing suffix", () => {
    assert.equal(normalizeCompanyName("High Plains Property Maintenance, LLC"), "high plains property maintenance");
    assert.equal(normalizeCompanyName(" A & B, Inc. "), "a and b");
    assert.equal(normalizeCompanyName("A Company LLC"), "a company");
    assert.equal(normalizeCompanyName("  A    B  "), "a b");
    assert.equal(normalizeCompanyName("LLC"), "");
  });

  it("runs the migration on an empty schema, reports counts and is repeat-safe", async () => {
    // A temporary schema and tables cannot alter application data and vanish on rollback.
    const schema = `company_migration_${randomUUID().replaceAll("-", "")}`;
    await client.query(`CREATE SCHEMA "${schema}"; SET LOCAL search_path TO "${schema}"`);
    await client.query(`CREATE TABLE users (id varchar PRIMARY KEY, role text, hoa_community_id varchar);
      CREATE TABLE community_members (id varchar DEFAULT gen_random_uuid(), community_id varchar, user_id varchar,
        UNIQUE(community_id,user_id))`);
    const notices: string[] = [];
    const listener = (notice: { message?: string }) => { if (notice.message?.startsWith("F1a counts:")) notices.push(notice.message); };
    client.on("notice", listener);
    try {
      const isolated = migration.replaceAll('"public"', `"${schema}"`);
      await client.query(isolated);
      assert.equal((await client.query("SELECT count(*) FROM companies")).rows[0].count, "1");
      assert.match(notices.at(-1)!, /company created=1, contractor users labeled=0, HOA rows added=0, stale HOA rows removed=0, property managers without a company=0/);
      await client.query(`INSERT INTO users(id,role,hoa_community_id) VALUES
        ('crew','contractor',null),('pm','property_manager',null),
        ('hoa','hoa_member','a'),('board','hoa_admin','b'),('unassigned','hoa_member',null);
        INSERT INTO community_members(community_id,user_id) VALUES ('old','hoa'),('b','board')`);
      await client.query(isolated);
      const labeled = await client.query("SELECT u.id,c.name FROM users u LEFT JOIN companies c ON c.id=u.company_id ORDER BY u.id");
      assert.equal(labeled.rows.find(r => r.id === "crew").name, "High Plains Property Maintenance");
      assert.equal(labeled.rows.find(r => r.id === "pm").name, null);
      assert.deepEqual((await client.query("SELECT user_id,community_id FROM community_members ORDER BY user_id")).rows,
        [{ user_id: "board", community_id: "b" }, { user_id: "hoa", community_id: "a" }]);
      assert.match(notices.at(-1)!, /company created=0, contractor users labeled=1, HOA rows added=1, stale HOA rows removed=1, property managers without a company=1/);
      await client.query(isolated);
      assert.match(notices.at(-1)!, /company created=0, contractor users labeled=0, HOA rows added=0, stale HOA rows removed=0, property managers without a company=1/);
    } finally { client.removeListener("notice", listener); }
  });

  it("denies every company management endpoint to every non-admin role", async () => {
    for (const role of ["contractor", "property_manager", "hoa_admin", "hoa_member", "map_creator", "client_admin"]) {
      const actor = await user(role);
      for (const [method, path, body] of [
        ["GET", "/api/admin/companies", undefined],
        ["POST", "/api/admin/companies", { name: "Forbidden", kind: "contractor" }],
        ["PATCH", `/api/admin/companies/${contractorCompany.id}`, { isActive: false }],
      ] as const) assert.equal((await request(method, path, body, actor)).status, 403);
    }
  });

  it("rejects exact duplicates and requires explicit confirmation of similar names", async () => {
    const duplicate = await request("POST", "/api/admin/companies", { name: "High Plains Property Maintenance, LLC", kind: "contractor" });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.error, "A company with this name already exists");
    assert.ok(duplicate.body.matches.some((m: any) => m.name === "High Plains Property Maintenance"));
    const otherKind = await request("POST", "/api/admin/companies", { name: "High Plains Property Maintenance", kind: "management_company" });
    assert.equal(otherKind.status, 409);
    assert.ok(otherKind.body.matches.length);
    const body = { name: `${contractorCompany.name} West`, kind: "contractor", unknownMobileField: true };
    assert.equal((await request("POST", "/api/admin/companies", body)).status, 409);
    assert.equal((await request("POST", "/api/admin/companies", { ...body, confirmNew: true })).status, 201);
    assert.equal((await request("POST", "/api/admin/companies", { name: " ", kind: "contractor" })).status, 400);
    assert.equal((await request("PATCH", `/api/admin/companies/${contractorCompany.id}`, { name: "High Plains Property Maintenance LLC" })).status, 409);
  });

  it("lists counts, literal search, kind filters, inactive labels and renames", async () => {
    let listed = await request("GET", `/api/admin/companies?search=${encodeURIComponent(contractorCompany.name)}&kind=contractor`);
    assert.equal(listed.body[0].userCount, 1);
    assert.equal((await request("PATCH", `/api/admin/companies/${contractorCompany.id}`, { isActive: false })).status, 200);
    listed = await request("GET", `/api/admin/companies?search=${encodeURIComponent(contractorCompany.name)}`);
    assert.deepEqual(listed.body, []);
    listed = await request("GET", `/api/admin/companies?includeInactive=true&search=${encodeURIComponent(contractorCompany.name)}`);
    assert.equal(listed.body[0].isActive, false);
    const me = await request("GET", "/api/auth/me", undefined, crew);
    assert.equal(me.body.user.companyName, contractorCompany.name);
    assert.equal((await request("PATCH", `/api/admin/companies/${contractorCompany.id}`, { name: `Renamed ${randomUUID()}` })).status, 200);
    assert.deepEqual((await request("GET", `/api/admin/companies?search=unmatched%25${randomUUID()}`)).body, []);
  });

  it("validates company kind, activity and user roles while legacy admin creation remains optional", async () => {
    const body = { username: `new-${randomUUID()}`, password: "password", displayName: "New", role: "contractor" };
    assert.equal((await request("POST", "/api/admin/users", { ...body, companyId: managementCompany.id })).status, 400);
    const created = await request("POST", "/api/admin/users", { ...body, companyId: contractorCompany.id, extra: true });
    assert.equal(created.status, 201);
    assert.equal(created.body.companyId, contractorCompany.id);
    const listed = await request("GET", "/api/users");
    assert.equal(listed.body.find((u: any) => u.id === created.body.id).companyName, contractorCompany.name);
    assert.equal((await request("POST", "/api/admin/users", { ...body, username: `legacy-${randomUUID()}` })).status, 201);
    assert.equal((await request("PATCH", `/api/admin/users/${hoa.id}`, { companyId: contractorCompany.id })).status, 400);
    assert.equal((await request("POST", "/api/admin/users", { ...body, username: `hoa-${randomUUID()}`, role: "hoa_member", hoaCommunityId: a, companyId: contractorCompany.id })).status, 400);
    assert.equal((await request("PATCH", `/api/admin/users/${crew.id}`, { companyId: "missing" })).status, 400);
    await api.storage.updateCompany(contractorCompany.id, { isActive: false });
    assert.equal((await request("PATCH", `/api/admin/users/${crew.id}`, { companyId: contractorCompany.id })).status, 400);
    assert.equal((await request("PATCH", `/api/admin/users/${crew.id}`, { companyId: null })).status, 200);
    assert.equal((await api.storage.getUserById(crew.id)).companyId, null);
  });

  it("changes roles and HOA assignment atomically, clearing labels and stale membership", async () => {
    await api.storage.addCommunityMembers(b, [crew.id]);
    let result = await request("PUT", `/api/users/${crew.id}/role`, { role: "hoa_member", hoaCommunityId: a });
    assert.equal(result.status, 200);
    assert.equal(result.body.companyId, null);
    assert.deepEqual(await memberships(crew.id), [a]);
    result = await request("PUT", `/api/users/${crew.id}/role`, { role: "hoa_member", hoaCommunityId: b });
    assert.equal(result.status, 200);
    assert.deepEqual(await memberships(crew.id), [b]);
    result = await request("PUT", `/api/users/${crew.id}/role`, { role: "contractor", companyId: contractorCompany.id });
    assert.equal(result.status, 200);
    assert.deepEqual(await memberships(crew.id), []);
    // The failed FK insert must roll back both the role update and membership deletion.
    await api.storage.updateUserRole(hoa.id, "hoa_member", a);
    await assert.rejects(api.storage.updateUserRole(hoa.id, "hoa_member", "missing-community"));
    assert.equal((await api.storage.getUserById(hoa.id)).hoaCommunityId, a);
    assert.deepEqual(await memberships(hoa.id), [a]);
  });

  it("bulk assigns active staff, skips existing members and cuts off only the selected community", async () => {
    const second = await user("contractor", { companyId: contractorCompany.id });
    const inactive = await user("contractor", { companyId: contractorCompany.id, isActive: false });
    const assigned = await request("POST", `/api/communities/${a}/members`, { companyId: contractorCompany.id });
    assert.deepEqual(assigned, { status: 201, body: { added: 1, skipped: 1 } });
    assert.deepEqual(await memberships(inactive.id), []);
    await api.storage.addCommunityMembers(b, [crew.id, second.id, inactive.id]);
    await api.storage.addCommunityMembers(a, [inactive.id]);
    assert.equal((await request("GET", `/api/communities/${a}/members`, undefined, crew)).status, 200);
    const removed = await request("DELETE", `/api/communities/${a}/companies/${contractorCompany.id}`);
    assert.deepEqual(removed, { status: 200, body: { removed: 3 } });
    for (const person of [crew, second, inactive]) assert.deepEqual(await memberships(person.id), [b]);
    assert.equal((await request("GET", `/api/communities/${a}/members`, undefined, crew)).status, 403);
    assert.equal((await request("POST", `/api/communities/${a}/members`, { companyId: "missing" })).status, 404);
  });

  it("exposes community company names only to staff and PMs, and preserves username privacy", async () => {
    for (const actor of [admin, pm, crew, hoa]) {
      const result = await request("GET", `/api/communities/${a}/members`, undefined, actor);
      assert.equal(result.status, 200);
      const member = result.body.find((m: any) => m.userId === crew.id);
      assert.equal(Object.hasOwn(member, "companyName"), ["admin", "property_manager"].includes(actor.role));
      if (["admin", "property_manager"].includes(actor.role)) assert.equal(member.companyName, contractorCompany.name);
      assert.equal(Object.hasOwn(member, "username"), actor.role === "admin");
    }
    const listed = await request("GET", `/api/users?communityId=${a}`, undefined, pm);
    assert.equal(listed.status, 200);
    assert.equal(listed.body.find((u: any) => u.id === hoa.id).companyName, null);
  });
});
