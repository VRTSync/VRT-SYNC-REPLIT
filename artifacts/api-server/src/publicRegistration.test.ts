import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import express from "express";
import session from "express-session";
import bcrypt from "bcryptjs";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { build } from "esbuild";
import * as schema from "../../../lib/db/src/schema/schema";
import { readRouteFixtureSource, taskFixtureImports } from "./testUtils/routeFixtureSource";

// Exercise the real handlers, storage, schemas, bcrypt, sessions and limiter.
// Only the database connection is replaced with a transaction-scoped connection.
// Every fixture/account/membership is rolled back; never run against production.
// Separate release follow-up: after an owner-authorized publish, an authorized
// owner must review privileged accounts with the supplied read-only query.
// That query is not included in this slice's snapshot; obtain the original
// before the review. Keep account details private. Do not deactivate unfamiliar
// accounts automatically; deactivation enforcement belongs to a later slice.
const sourceDir = fileURLToPath(new URL(".", import.meta.url));
const routes = readRouteFixtureSource();
function sourceBetween(start: string, end: string) {
  const from = routes.indexOf(start);
  const to = routes.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Verified route/helper boundary missing: ${start}`);
  return routes.slice(from, to);
}
const helper = sourceBetween("async function checkHoaLimits(", "export async function registerRoutes(");
const admin = sourceBetween('app.post("/api/admin/users",', 'app.patch("/api/admin/users/:id",');
const portal = sourceBetween('app.post("/api/portal/users",', 'app.put("/api/portal/users/:id",');
const require = createRequire(import.meta.url);

describe("public registration and managed-account regressions (transactional PostgreSQL)", {
  skip: !process.env.DATABASE_URL ? "DATABASE_URL unavailable; database acceptance tests not run" : false,
}, () => {
  let pool: pg.Pool;
  let client: pg.PoolClient;
  let server: Server;
  let base: string;
  let communityId: string;
  let organizationId: string;
  let bundle: string;
  let auth: any;
  let createUser: any;
  let store: session.MemoryStore;

  before(async () => {
    assert.notEqual(process.env.NODE_ENV, "production", "Refusing production database tests");
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const built = await build({
      stdin: {
        contents: `
          ${taskFixtureImports}
          import { registerAuthRoutes, loadCurrentUser, requireAdmin, requireAuth, isHoaRole, isClientRole, isContractorSide } from "./auth";
          import * as storage from "./storage";
          import bcrypt from "bcryptjs";
          import { userRoleEnum } from "@workspace/db";
          ${helper}
          export { storage };
          export function setup(app: any) {
            app.use(loadCurrentUser);
            registerAuthRoutes(app);
            ${admin}
            ${portal}
          }
        `,
        resolveDir: sourceDir,
        loader: "ts",
      },
      bundle: true,
      write: false,
      platform: "node",
      format: "cjs",
      packages: "external",
      plugins: [{
        name: "transaction-only-db",
        setup(builder) {
          builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({
            path: fileURLToPath(new URL("../../../lib/db/src/schema/schema.ts", import.meta.url)),
          }));
          builder.onResolve({ filter: /^\.\/db$/ }, () => ({ path: "db", namespace: "transaction" }));
          builder.onLoad({ filter: /.*/, namespace: "transaction" }, () => ({
            contents: "export const db = __testDb; export const pool = undefined;",
            loader: "js",
          }));
        },
      }],
    });
    bundle = built.outputFiles[0].text;
  });

  beforeEach(async () => {
    client = await pool.connect();
    await client.query("BEGIN");
    const testDb = drizzle(client);
    // Company/user creation now uses an explicit transaction. Keep nested
    // production transactions inside this fixture's outer rollback.
    let savepoint = 0;
    testDb.transaction = (async (callback: (tx: any) => Promise<any>) => {
      const name = `registration_test_${++savepoint}`;
      await client.query(`SAVEPOINT ${name}`);
      try {
        const result = await callback(testDb);
        await client.query(`RELEASE SAVEPOINT ${name}`);
        return result;
      } catch (error) {
        await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
        throw error;
      }
    }) as typeof testDb.transaction;
    const organization = await client.query(
      "INSERT INTO organizations (name) VALUES ('Registration test org') RETURNING id",
    );
    organizationId = organization.rows[0].id;
    const community = await client.query(
      "INSERT INTO communities (name, organization_id) VALUES ('Registration test community', $1) RETURNING id",
      [organizationId],
    );
    communityId = community.rows[0].id;
    const module = { exports: {} as any };
    new Function("require", "module", "exports", "__testDb", bundle)(
      require, module, module.exports, testDb,
    );
    auth = module.exports;
    createUser = async (role: string, extra = {}) => auth.storage.createUser({
      username: `s01-${randomUUID()}`,
      displayName: "Registration test",
      password: await bcrypt.hash("test-password", 10),
      role,
      ...extra,
    });
    const app = express();
    app.use(express.json());
    store = new session.MemoryStore();
    app.use(session({
      secret: "isolated-registration-test-session",
      store,
      resave: false,
      saveUninitialized: false,
    }));
    auth.setup(app);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    base = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    }
    if (client) {
      await client.query("ROLLBACK");
      client.release();
    }
  });
  after(async () => { await pool?.end(); });

  async function request(path: string, body?: unknown, cookie?: string) {
    return fetch(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  function registration(extra: Record<string, unknown> = {}): {
    username: string; password: string; displayName: string;
  } & Record<string, unknown> {
    return { username: `s01-${randomUUID()}`, password: "test-password", displayName: "New contractor", ...extra };
  }
  async function login(user: any) {
    const res = await request("/api/auth/login", { username: user.username, password: "test-password" });
    assert.equal(res.status, 200);
    const cookie = res.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    return cookie;
  }

  it("ignores every requested privileged role and returns a contractor with HTTP 201", async () => {
    for (const role of schema.userRoleEnum.enumValues) {
      const res = await request("/api/auth/register", registration({ role }));
      assert.equal(res.status, 201);
      const user = await res.json();
      assert.equal(user.role, "contractor");
      assert.equal(user.hoaCommunityId, null);
      assert.equal(user.organizationId, null);
      assert.equal(user.password, undefined);
    }
  });

  it("strips a real community/org, membership payloads and unknown fields without rejecting old clients", async () => {
    const input = registration({
      role: "admin", hoaCommunityId: communityId, organizationId,
      communityId, communityIds: [communityId],
      community_members: [{ communityId }], unknownField: { legacy: true },
      id: randomUUID(), isActive: false,
    });
    const res = await request("/api/auth/register", input);
    assert.equal(res.status, 201);
    const user = await res.json();
    const persisted = await client.query(
      "SELECT role, hoa_community_id, organization_id, password, is_active FROM users WHERE id = $1",
      [user.id],
    );
    assert.equal(persisted.rows[0].role, "contractor");
    assert.equal(persisted.rows[0].hoa_community_id, null);
    assert.equal(persisted.rows[0].organization_id, null);
    assert.equal(persisted.rows[0].is_active, true);
    assert.equal(await bcrypt.compare(input.password, persisted.rows[0].password), true);
    const memberships = await client.query("SELECT id FROM community_members WHERE user_id = $1", [user.id]);
    assert.deepEqual(memberships.rows, []);
    const cookie = res.headers.get("set-cookie")?.split(";")[0];
    const me = await request("/api/auth/me", undefined, cookie);
    assert.equal(me.status, 200);
    const bootstrap = await me.json();
    assert.deepEqual(bootstrap.communities, []);
    assert.equal(bootstrap.defaultCommunityId, null);
    assert.equal(bootstrap.user.id, user.id);
    const sessions = await new Promise<any[]>((resolve, reject) =>
      store.all((err, rows) => err ? reject(err) : resolve(Object.values(rows ?? {}))),
    );
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].hoaCommunityId, undefined);
    assert.equal(sessions[0].organizationId, undefined);
  });

  it("accepts only the three ordinary fields, signs in, and retains duplicate/invalid-input responses", async () => {
    const body = registration();
    const res = await request("/api/auth/register", body);
    assert.equal(res.status, 201);
    const user = await res.json();
    const cookie = res.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    const me = await request("/api/auth/me", undefined, cookie);
    assert.equal(me.status, 200);
    assert.equal((await me.json()).user.id, user.id);
    const duplicate = await request("/api/auth/register", body);
    assert.equal(duplicate.status, 409);
    assert.deepEqual(await duplicate.json(), { message: "Username already taken" });
    const invalid = await request("/api/auth/register", { username: body.username });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).message, "Invalid input");
  });

  it("preserves login, me, scoped sessions, fixation prevention and logout for every existing role", async () => {
    for (const role of schema.userRoleEnum.enumValues) {
      const scoped = role.startsWith("hoa_") ? { hoaCommunityId: communityId }
        : role === "client_admin" ? { organizationId } : {};
      const user = await createUser(role, scoped);
      const cookie = await login(user);
      const me = await request("/api/auth/me", undefined, cookie);
      assert.equal(me.status, 200);
      const bootstrap = await me.json();
      assert.equal(bootstrap.user.role, role);
      assert.equal(bootstrap.user.password, undefined);
      if (role.startsWith("hoa_")) {
        assert.equal(bootstrap.defaultCommunityId, communityId);
        assert.equal(bootstrap.communities[0].id, communityId);
      }
      const sessions = await new Promise<any[]>((resolve, reject) =>
        store.all((err, rows) => err ? reject(err) : resolve(Object.values(rows ?? {}))),
      );
      const saved = sessions.find((s) => s.userId === user.id);
      assert.equal(saved.hoaCommunityId, scoped.hoaCommunityId);
      assert.equal(saved.organizationId, scoped.organizationId);
      const signup = await request("/api/auth/register", registration({ role: "admin", hoaCommunityId: communityId }), cookie);
      assert.equal(signup.status, 201);
      const newCookie = signup.headers.get("set-cookie")?.split(";")[0];
      assert.ok(newCookie);
      assert.notEqual(newCookie, cookie);
      assert.equal((await request("/api/auth/me", undefined, cookie)).status, 401);
      const logout = await request("/api/auth/logout", {}, newCookie);
      assert.deepEqual(await logout.json(), { message: "Logged out" });
      assert.equal((await request("/api/auth/me", undefined, newCookie)).status, 401);
    }
    const invalid = await request("/api/auth/login", { username: "missing-s01-user", password: "invalid" });
    assert.equal(invalid.status, 401);
    assert.deepEqual(await invalid.json(), { message: "Invalid credentials" });
  });

  it("preserves the register rate limit of 60 requests and its exact 429 response", async () => {
    for (let n = 0; n < 60; n++) {
      assert.equal((await request("/api/auth/register", {})).status, 400);
    }
    const blocked = await request("/api/auth/register", registration());
    assert.equal(blocked.status, 429);
    assert.deepEqual(await blocked.json(), { message: "Too many requests. Try again later." });
    assert.ok(blocked.headers.get("retry-after"));
  });

  it("keeps admin creation for all roles, HOA memberships, org assignment, limits and duplicates", async () => {
    const cookie = await login(await createUser("admin"));
    const company = await auth.storage.createCompany(`Registration contractor ${randomUUID()}`, "contractor");
    for (const role of schema.userRoleEnum.enumValues) {
      const body = registration({
        role, ...(role.startsWith("hoa_") ? { hoaCommunityId: communityId } : {}),
        ...(role === "client_admin" ? { organizationId } : {}),
        ...(role === "contractor_manager" ? { companyId: company.id } : {}),
      });
      const res = await request("/api/admin/users", body, cookie);
      assert.equal(res.status, 201, `admin creates ${role}`);
      const user = await res.json();
      assert.equal(user.role, role);
      assert.equal(user.password, undefined);
      assert.equal(user.hoaCommunityId, body.hoaCommunityId ?? null);
      assert.equal(user.organizationId, body.organizationId ?? null);
      const members = await client.query("SELECT community_id FROM community_members WHERE user_id = $1", [user.id]);
      assert.equal(members.rowCount, role.startsWith("hoa_") ? 1 : 0);
      const duplicate = await request("/api/admin/users", body, cookie);
      // Existing HOA-admin limit is checked before username duplication.
      assert.equal(duplicate.status, role === "hoa_admin" ? 400 : 409);
    }
    const limit = await request("/api/admin/users", registration({ role: "hoa_admin", hoaCommunityId: communityId }), cookie);
    assert.equal(limit.status, 400);
    assert.deepEqual(await limit.json(), { error: "This community already has an HOA Admin (limit: 1)" });
    for (let n = 0; n < 3; n++) {
      assert.equal((await request("/api/admin/users", registration({ role: "hoa_member", hoaCommunityId: communityId }), cookie)).status, 201);
    }
    assert.equal((await request("/api/admin/users", registration({ role: "hoa_member", hoaCommunityId: communityId }), cookie)).status, 400);
    assert.equal((await request("/api/admin/users", registration())).status, 401);
    const contractorCookie = await login(await createUser("contractor"));
    assert.equal((await request("/api/admin/users", registration(), contractorCookie)).status, 403);
  });

  it("keeps PM and HOA-admin portal creation, memberships, role/scope restrictions and duplicates", async () => {
    const pm = await createUser("property_manager");
    await auth.storage.addCommunityMembers(communityId, [pm.id]);
    const pmCookie = await login(pm);
    for (const role of ["hoa_admin", "hoa_member"]) {
      const body = registration({ role, communityId });
      const res = await request("/api/portal/users", body, pmCookie);
      assert.equal(res.status, 201);
      const user = await res.json();
      assert.equal(user.role, role);
      assert.equal(user.hoaCommunityId, communityId);
      const membership = await client.query("SELECT community_id FROM community_members WHERE user_id = $1", [user.id]);
      assert.deepEqual(membership.rows, [{ community_id: communityId }]);
      assert.equal((await request("/api/portal/users", body, pmCookie)).status, 409);
      if (role === "hoa_admin") {
        const hoaCookie = await login({ ...user, password: body.password });
        assert.equal((await request("/api/portal/users", registration({ role: "hoa_member", communityId }), hoaCookie)).status, 201);
        assert.equal((await request("/api/portal/users", registration({ role: "hoa_admin", communityId }), hoaCookie)).status, 403);
        assert.equal((await request("/api/portal/users", registration({ role: "hoa_member", communityId: randomUUID() }), hoaCookie)).status, 403);
      }
    }
    for (const role of ["contractor", "admin", "property_manager", "map_creator", "client_admin"]) {
      assert.equal((await request("/api/portal/users", registration({ role, communityId }), pmCookie)).status, 403);
    }
    assert.equal((await request("/api/portal/users", registration({ role: "hoa_member", communityId: randomUUID() }), pmCookie)).status, 403);
    assert.equal((await request("/api/portal/users", registration({ role: "hoa_member", communityId }))).status, 401);
  });
});

describe("public schema compatibility", () => {
  it("strips even malformed privileged fields while preserving the managed insertion schema", () => {
    const fields = { username: "legacy-client", password: "password", displayName: "Legacy client" };
    assert.deepEqual(schema.publicRegisterSchema.parse({
      ...fields, role: { invalid: true }, hoaCommunityId: 123, organizationId: ["org"], extra: true,
    }), fields);
    assert.equal(schema.insertUserSchema.parse({ ...fields, role: "admin", hoaCommunityId: "community" }).role, "admin");
  });
});
