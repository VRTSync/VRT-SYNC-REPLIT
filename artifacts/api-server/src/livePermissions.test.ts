import assert from "node:assert/strict";
import { before, beforeEach, afterEach, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { readRouteFixtureSource, taskFixtureImports } from "./testUtils/routeFixtureSource";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import express from "express";
import session from "express-session";
import bcrypt from "bcryptjs";
import { build } from "esbuild";

// Run production auth, management handlers and revocation SQL with isolated I/O.
// No real accounts, tokens, secrets or database records are touched.
const require = createRequire(import.meta.url);
const source = readRouteFixtureSource();
const portalSource = readFileSync(new URL("../../web-portal/src/server.ts", import.meta.url), "utf8");
function between(text: string, start: string, end: string) {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Missing verified boundary: ${start}`);
  return text.slice(from, to);
}
const management = between(source, 'app.put("/api/users/:id/role",', 'app.post("/api/admin/users",') +
  between(source, 'app.patch("/api/admin/users/:id",', 'app.get("/api/users/:id/communities",') +
  between(source, 'app.put("/api/users/:id/status",', '/* ── Community-scoped user list') +
  between(source, 'app.put("/api/portal/users/:id",', 'app.get("/api/ping",');
const portalHelpers = between(portalSource, "async function getUserRole(", "// ── Routes");
const pushSource = readFileSync(new URL("./pushNotifications.ts", import.meta.url), "utf8");
const sendPush = between(pushSource, "type PushPayload", "export async function processReceiptsForPendingTickets");
const mobileRoutes = between(source, 'app.post("/api/push-tokens",', 'app.delete("/api/push-tokens",') +
  between(source, 'app.get("/api/communities/:communityId/offline-pack",', 'app.post("/api/offline-packs",') +
  between(source, 'app.post("/api/tasks/:id/complete",', 'app.post("/api/tasks/:id/attachments",');
const hoaRequest = between(source, 'app.post("/api/hoa/requests",', 'app.get("/api/notification-preferences",');

describe("live permissions and session revocation (isolated HTTP)", () => {
  let bundle: string;
  let api: any;
  let server: Server;
  let base: string;
  let store: session.MemoryStore;
  let users: Map<string, any>;
  let tokens: Map<string, string[]>;
  let sqlCalls: any[];
  let lookupError: boolean;
  let password: string;
  let deliveries: any[];
  let completions: any[];

  before(async () => {
    password = await bcrypt.hash("old-password", 4);
    const built = await build({
      stdin: {
        contents: `
          ${taskFixtureImports}
          import * as auth from "./auth";
          import * as realStorage from "./storage";
          import bcrypt from "bcryptjs";
          import { userRoleEnum, registerPushTokenSchema, completeTaskSchema, createHoaRequestSchema } from "@workspace/db";
          const { requireAuth, requireAdmin, isHoaRole, isContractorSide } = auth;
          const storage = { ...fixture.storage,
            toTaskView: realStorage.toTaskView,
            toTaskResponse: realStorage.toTaskResponse,
            revokeUserSessions: realStorage.revokeUserSessions,
            removeAllPushTokens: realStorage.removeAllPushTokens };
          const checkHoaLimits = async () => null;
          const pool = fixture.pool;
          const fetch = fixture.fetch;
          const PUSH_TOKEN_RATE_LIMIT_MS = 86400000;
          const pushTokenLastReg = new Map();
          const notifyTaskCompleted = async () => {};
          ${sendPush}
          ${portalHelpers}
          export function setup(app) {
            // The portal is a separate service; it does not run the API loader.
            app.get("/web/hoa/dashboard", requireRole(["hoa_admin","hoa_member"]), (req,res) => res.send("HOA"));
            app.use(auth.loadCurrentUser);
            auth.registerAuthRoutes(app);
            ${management}
            ${mobileRoutes}
            ${hoaRequest}
            app.get("/objects/test", requireAuth, (req, res) => res.json({ ok: true }));
            app.get("/scope", auth.enforceHoaScoping, (req, res) => res.json({ ok: true }));
            app.get("/org", auth.enforceOrgScoping, requireAuth, (req, res) => res.json({ ok: true }));
            for (const name of ["requireAuth","requireAdmin","requireClient","requireAdminOrMapCreator","requireClientOrAdmin"])
              app.get("/guard/"+name, auth[name], (req,res) => res.json({ok:true}));
          }
        `,
        resolveDir: fileURLToPath(new URL(".", import.meta.url)),
        loader: "ts",
      },
      bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
      plugins: [{
        name: "isolated-account-io",
        setup(builder) {
          builder.onResolve({ filter: /^\/.*\/storage\.ts$/ }, (args) => ({ path: args.path, namespace: "file" }));
          builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({
            path: fileURLToPath(new URL("../../../lib/db/src/schema/schema.ts", import.meta.url)),
          }));
          builder.onResolve({ filter: /^(?:\.\/|\.\.\/)db$/ }, () => ({ path: "db", namespace: "fixture-db" }));
          builder.onLoad({ filter: /.*/, namespace: "fixture-db" }, () => ({
            contents: "export const db = fixture.db; export const pool = fixture.pool;", loader: "js",
          }));
          // Auth/policy use fixture user I/O; revocation and token deletion remain real.
          builder.onResolve({ filter: /^(?:\.\/|\.\.\/)storage$/ }, (args) =>
            args.importer.endsWith("/auth.ts") || /\/policy\/(?:actor|community)\.ts$/.test(args.importer)
              ? { path: "storage", namespace: "fixture-storage" } : undefined);
          builder.onLoad({ filter: /.*/, namespace: "fixture-storage" }, () => ({
            contents: `
              export const getUserById = (...a) => fixture.storage.getUserById(...a);
              export const getUserByUsername = (...a) => fixture.storage.getUserByUsername(...a);
              export const getCommunities = async () => [];
              export const getCommunityById = (...a) => fixture.storage.getCommunityById(...a);
              export const isUserMemberOfCommunity = (...a) => fixture.storage.isUserMemberOfCommunity(...a);
              export const getUserCommunities = async () => [];
              export const createUser = async () => { throw Error("not used"); };
              export const removePushTokenByDevice = (...a) => fixture.storage.removePushTokenByDevice(...a);
              export { revokeUserSessions } from ${JSON.stringify(fileURLToPath(new URL("./storage.ts", import.meta.url)))};
            `, loader: "js",
          }));
        },
      }],
    });
    bundle = built.outputFiles[0].text;
  });

  beforeEach(async () => {
    users = new Map();
    tokens = new Map();
    sqlCalls = [];
    lookupError = false;
    deliveries = [];
    completions = [];
    store = new session.MemoryStore();
    for (const [id, role] of [["admin", "admin"], ["pm", "property_manager"], ["target", "hoa_member"]]) {
      users.set(id, { id, username: id, role, password, isActive: true, hoaCommunityId: "old", organizationId: null });
    }
    const update = async (id: string, data: any) => {
      const user = users.get(id);
      if (!user) return null;
      Object.assign(user, data);
      return { ...user };
    };
    const fixture = {
      storage: {
        registerPushToken: async (id: string, token: string) => {
          tokens.set(id, [...(tokens.get(id) ?? []), token]);
          return { userId: id, token };
        },
        getTokensForUser: async (id: string) => (tokens.get(id) ?? []).map((token) => ({ token })),
        insertPushTickets: async () => {},
        getLatestOfflinePack: async (communityId: string) => ({ id: "pack", communityId, packVersion: 1 }),
        getTaskById: async () => ({ id: "task", communityId: "old", assignedTo: "target", version: 1 }),
        updateTask: async (_id: string, _version: number, data: any) => ({ id: "task", ...data }),
        createTaskCompletion: async (data: any) => { completions.push(data); return data; },
        completeTaskAtomically: async (taskId: string, version: number, data: any) => {
          const completion = { taskId, ...data };
          completions.push(completion);
          return { task: { id: taskId, status: "completed", version: version + 1 }, completion };
        },
        getUserById: async (id: string) => {
          if (lookupError) throw Error("lookup unavailable");
          const user = users.get(id);
          return user && { ...user };
        },
        getUserByUsername: async (name: string) => [...users.values()].find((u) => u.username === name),
        getCommunityById: async (id: string) => ({ id, organizationId: id }),
        updateUserRole: (id: string, role: string, hoaCommunityId: string | null) => update(id, { role, hoaCommunityId }),
        updateUserStatus: (id: string, isActive: boolean) => update(id, { isActive }),
        updateUserProfile: update,
        deleteUser: async (id: string) => users.delete(id),
        isUserMemberOfCommunity: async () => true,
        removeCommunityMember: async () => {},
        removePushTokenByDevice: async (id: string) => tokens.delete(id),
      },
      fetch: async (url: string, options: any) => {
        assert.equal(url, "https://exp.host/--/api/v2/push/send");
        deliveries.push(JSON.parse(options.body));
        return { ok: true, json: async () => ({ data: [{ status: "ok", id: "ticket" }] }) };
      },
      pool: {
        query: async (sql: string, params: string[]) => {
          sqlCalls.push([sql, params]);
          if (sql.startsWith("SELECT role")) {
            const user = users.get(params[0]);
            return { rows: user ? [{ role: user.role, is_active: user.isActive }] : [] };
          }
          assert.equal(sql, "DELETE FROM user_sessions WHERE sess->>'userId' = $1" + (params.length === 2 ? " AND sid <> $2" : ""));
          const sessions = await new Promise<any>((resolve, reject) => store.all((err, rows) => err ? reject(err) : resolve(rows)));
          for (const [sid, saved] of Object.entries(sessions) as any) {
            if (saved.userId === params[0] && sid !== params[1]) {
              await new Promise<void>((resolve, reject) => store.destroy(sid, (err) => err ? reject(err) : resolve()));
            }
          }
          return { rows: [] };
        },
      },
      db: {
        update: () => ({ set: (data: any) => ({ where: (condition: any) => ({
          returning: async () => {
            const id = condition.queryChunks.find((v: any) => typeof v?.value === "string").value;
            return [await update(id, data)];
          },
        }) }) }),
        delete: () => ({ where: async (condition: any) => {
          const id = condition.queryChunks.find((v: any) => typeof v?.value === "string").value;
          tokens.delete(id);
        } }),
      },
    };
    const module = { exports: {} as any };
    new Function("require", "module", "exports", "fixture", bundle)(require, module, module.exports, fixture);
    api = module.exports;
    const app = express();
    app.use(express.json());
    app.use(session({ secret: "isolated-live-permissions", store, resave: false, saveUninitialized: false }));
    api.setup(app);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    base = `http://127.0.0.1:${address.port}`;
  });
  afterEach(async () => {
    server?.closeAllConnections();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  function request(path: string, cookie?: string, method = "GET", body?: any) {
    return fetch(base + path, {
      method, redirect: "manual", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  async function login(id = "target") {
    const res = await request("/api/auth/login", undefined, "POST", { username: id, password: "old-password", legacyExtra: true });
    assert.equal(res.status, 200);
    const cookie = res.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    return cookie;
  }
  async function sessionCount(id = "target") {
    const saved = await new Promise<any>((resolve) => store.all((_err, rows) => resolve(rows)));
    return Object.values(saved).filter((s: any) => s.userId === id).length;
  }

  it("rejects inactive login only after verifying the password", async () => {
    users.get("target").isActive = false;
    for (const [name, pass, status, message] of [
      ["target", "old-password", 403, "This account has been deactivated"],
      ["target", "wrong-password", 401, "Invalid credentials"],
      ["missing", "old-password", 401, "Invalid credentials"],
    ] as const) {
      const res = await request("/api/auth/login", undefined, "POST", { username: name, password: pass });
      assert.equal(res.status, status);
      assert.deepEqual(await res.json(), { message });
    }
    assert.equal(await sessionCount(), 0);
  });
  for (const route of ["/api/users/target/status", "/api/portal/users/target"]) {
    it(`deactivation through ${route} revokes all sessions and push tokens`, async () => {
      const cookie = await login();
      await login();
      tokens.set("target", ["push-token"]);
      const actor = await login(route.includes("/portal/") ? "pm" : "admin");
      assert.equal((await request(route, actor, "PUT", { isActive: false, extra: true })).status, 200);
      assert.equal(await sessionCount(), 0);
      assert.equal(tokens.has("target"), false);
      assert.equal((await request("/api/auth/me", cookie)).status, 401);
    });
  }
  it("rejects direct database deactivation/deletion on the next request, including objects and auth", async () => {
    for (const path of ["/api/auth/me", "/objects/test"]) {
      users.get("target").isActive = true;
      const cookie = await login();
      users.get("target").isActive = false;
      assert.equal((await request(path, cookie)).status, 401);
      assert.equal(await sessionCount(), 0);
    }
    users.get("target").isActive = true;
    const cookie = await login();
    users.delete("target");
    assert.equal((await request("/objects/test", cookie)).status, 401);
    assert.equal(await sessionCount(), 0);
  });
  for (const route of ["/api/users/target/role", "/api/portal/users/target"]) {
    it(`role change through ${route} rejects existing sessions`, async () => {
      const cookie = await login();
      const actor = await login(route.includes("/portal/") ? "pm" : "admin");
      assert.equal((await request(route, actor, "PUT", { role: "hoa_admin", hoaCommunityId: "old" })).status, 200);
      assert.equal(await sessionCount(), 0);
      assert.equal((await request("/api/auth/me", cookie)).status, 401);
    });
  }
  it("uses live HOA community, role and organization instead of session snapshots", async () => {
    const cookie = await login();
    users.get("target").hoaCommunityId = "new";
    assert.equal((await request("/scope?communityId=old", cookie)).status, 403);
    assert.equal((await request("/scope?communityId=new", cookie)).status, 200);
    const me = await (await request("/api/auth/me", cookie)).json();
    assert.equal(me.defaultCommunityId, "new");
    users.get("target").role = "client_admin";
    users.get("target").organizationId = "new-org";
    assert.equal((await request("/org?organizationId=old-org", cookie)).status, 403);
    assert.equal((await request("/org?organizationId=new-org", cookie)).status, 200);
    assert.equal((await request("/scope?communityId=anything", cookie)).status, 200);
    users.get("target").organizationId = null;
    const denied = await request("/org?organizationId=new-org", cookie);
    assert.equal(denied.status, 403);
    assert.deepEqual(await denied.json(), { message: "Access denied: client user has no organization" });
    const saved = await new Promise<any>((resolve) => store.all((_err, rows) => resolve(Object.values(rows ?? {}))));
    assert.equal(saved[0].organizationId, undefined);
  });
  it("own-password change keeps the current device, revokes others, and leaves unrelated sessions alone", async () => {
    const current = await login();
    const other = await login();
    const admin = await login("admin");
    const res = await request("/api/auth/me", current, "PATCH", { currentPassword: "old-password", newPassword: "new-password", extra: true });
    assert.equal(res.status, 200);
    assert.equal(await sessionCount(), 1);
    assert.equal((await request("/api/auth/me", current)).status, 200);
    assert.equal((await request("/api/auth/me", other)).status, 401);
    assert.equal((await request("/api/auth/me", admin)).status, 200);
    assert.equal(await bcrypt.compare("new-password", users.get("target").password), true);
    assert.equal(sqlCalls.filter(([sql]) => sql.includes("sid <> $2")).length, 1);
  });
  it("clearing an HOA assignment in the database denies request creation despite the existing login cookie", async () => {
    users.get("target").role = "hoa_admin";
    const cookie = await login();
    users.get("target").hoaCommunityId = null;
    const response = await request("/api/hoa/requests", cookie, "POST", {
      title: "Must not create in the former community", communityId: "old",
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "No HOA community associated with this user" });
    assert.equal((await request("/api/auth/me", cookie)).status, 200);
    const saved = await new Promise<any>((resolve) => store.all((_err, rows) => resolve(Object.values(rows ?? {}))));
    assert.equal(saved[0].hoaCommunityId, undefined);
    assert.equal(completions.length, 0);
  });
  it("admin password reset revokes every device but profile-only edits do not", async () => {
    const cookie = await login();
    const admin = await login("admin");
    assert.equal((await request("/api/admin/users/target", admin, "PATCH", { displayName: "Renamed" })).status, 200);
    assert.equal(await sessionCount(), 1);
    assert.equal((await request("/api/admin/users/target", admin, "PATCH", { newPassword: "new-password" })).status, 200);
    assert.equal((await request("/api/auth/me", cookie)).status, 401);
    assert.equal(await sessionCount(), 0);
  });
  it("community removal revokes sessions without deleting the account or its push tokens", async () => {
    const cookie = await login();
    const pm = await login("pm");
    tokens.set("target", ["push-token"]);
    assert.equal((await request("/api/portal/users/target", pm, "DELETE")).status, 200);
    assert.equal(users.get("target").hoaCommunityId, null);
    assert.equal((await request("/api/auth/me", cookie)).status, 401);
    assert.equal(await sessionCount(), 0);
    assert.equal(tokens.has("target"), true);
  });
  it("account deletion revokes sessions and deletes push tokens", async () => {
    const cookie = await login();
    const admin = await login("admin");
    tokens.set("target", ["push-token"]);
    assert.equal((await request("/api/admin/users/target", admin, "DELETE")).status, 200);
    assert.equal(users.has("target"), false);
    assert.equal(await sessionCount(), 0);
    assert.equal(tokens.has("target"), false);
    assert.equal((await request("/api/auth/me", cookie)).status, 401);
  });
  it("fails closed on lookup errors, and inactive web users redirect to login", async () => {
    const cookie = await login();
    lookupError = true;
    const res = await request("/objects/test", cookie);
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { message: "Internal error" });
    lookupError = false;
    assert.equal((await request("/web/hoa/dashboard", cookie)).status, 200);
    users.get("target").isActive = false;
    const web = await request("/web/hoa/dashboard", cookie);
    assert.equal(web.status, 302);
    assert.equal(web.headers.get("location"), "/web/login");
  });
  it("preserves all five guard role rules and exact unauthorized/forbidden responses", async () => {
    const rules: Record<string, [string[], string]> = {
      requireAuth: [["admin","property_manager","contractor","hoa_admin","hoa_member","map_creator","client_admin"], ""],
      requireAdmin: [["admin"], "Admin access required"],
      requireClient: [["client_admin"], "Client access required"],
      requireAdminOrMapCreator: [["admin","map_creator"], "Admin or map creator access required"],
      requireClientOrAdmin: [["admin","client_admin"], "Client admin or admin access required"],
    };
    const cookie = await login();
    for (const [guard, [roles, message]] of Object.entries(rules)) {
      const anonymous = await request("/guard/" + guard);
      assert.equal(anonymous.status, 401);
      assert.deepEqual(await anonymous.json(), { message: "Not authenticated" });
      for (const role of rules.requireAuth[0]) {
        users.get("target").role = role;
        const res = await request("/guard/" + guard, cookie);
        assert.equal(res.status, roles.includes(role) ? 200 : 403, `${guard}: ${role}`);
        if (res.status === 403) assert.deepEqual(await res.json(), { message });
      }
    }
  });
  it("active mobile/web session cookies still authenticate me and logout removes only the device token", async () => {
    const cookie = await login();
    tokens.set("target", ["push-token"]);
    const res = await request("/api/auth/me", cookie);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).user.password, undefined);
    assert.equal(tokens.has("target"), true);
    assert.equal((await request("/api/auth/logout", cookie, "POST", { deviceId: "device", legacy: true })).status, 200);
    assert.equal((await request("/api/auth/me", cookie)).status, 401);
    assert.equal(tokens.has("target"), false);
  });
  it("active users can register and receive push notifications and authenticate offline downloads and queued completions", async () => {
    users.get("target").role = "contractor";
    const cookie = await login();
    const registration = await request("/api/push-tokens", cookie, "POST", {
      token: "ExponentPushToken[isolated-device]", platform: "ios", deviceId: "device", legacy: true,
    });
    assert.equal(registration.status, 201);
    await api.sendPushToUser("target", { title: "Test", body: "Active user" });
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0][0].to, "ExponentPushToken[isolated-device]");
    const pack = await request("/api/communities/old/offline-pack", cookie);
    assert.equal(pack.status, 200);
    assert.equal((await pack.json()).id, "pack");
    const complete = await request("/api/tasks/task/complete", cookie, "POST", {
      version: 1, employeeSignOffName: "Test crew", notes: "Queued offline", legacyExtra: true,
    });
    assert.equal(complete.status, 200);
    assert.equal(completions[0].completedBy, "target");
    assert.equal(completions[0].legacyExtra, undefined);
    users.get("target").isActive = false;
    assert.equal((await request("/api/communities/old/offline-pack", cookie)).status, 401);
    assert.equal((await request("/api/tasks/task/complete", cookie, "POST", { version: 1 })).status, 401);
  });
});

it("registers live-user middleware exactly once immediately after sessions and before routes", () => {
  const app = readFileSync(new URL("./app.ts", import.meta.url), "utf8");
  assert.match(app, /setupSession\(app\);\s*app\.use\(loadCurrentUser\);/);
  assert.equal(app.match(/app\.use\(loadCurrentUser\)/g)?.length, 1);
});
