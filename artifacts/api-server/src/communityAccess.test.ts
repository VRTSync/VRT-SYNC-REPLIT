import assert from "node:assert/strict";
import { before, beforeEach, afterEach, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { readRouteFixtureSource } from "./testUtils/routeFixtureSource";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import express from "express";
import { build } from "esbuild";

// Exercise the production handlers, shared helper and live-user middleware over
// HTTP with isolated storage. No accounts, sessions or database rows are changed.
const require = createRequire(import.meta.url);
const source = readRouteFixtureSource();
function between(start: string, end: string) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Missing verified route boundary: ${start}`);
  return source.slice(from, to);
}
const handlers = [
  between('app.get("/api/communities/:id/bounds",', 'app.post("/api/communities/:id/members",'),
  between('app.get("/api/map-layers/:id/summary",', 'app.get("/api/communities/:communityId/assets/completeness",'),
  between('app.get("/api/communities/:communityId/service-schedules",', 'app.post("/api/communities/:communityId/service-schedules",'),
  between('app.get("/api/service-schedules/:scheduleId/visits",', "// ── Master Bill import routes"),
  between("async function requireDriveAccess(", 'app.post("/api/drive/folders",'),
].join("\n");
const denial = { error: "You do not have access to this community" };
const visitBody = {
  serviceDate: "2026-11-16", completedAt: "2026-11-16T12:00:00.000Z",
  employeeSignOffName: "Crew fixture", notes: "Queued offline",
};
const offlineSource = readFileSync(new URL("../../vrtsync-mobile/client/contexts/OfflineContext.tsx", import.meta.url), "utf8");
const offlineStart = offlineSource.indexOf("const syncPendingServiceVisits = useCallback(");
const offlineEnd = offlineSource.indexOf("const retryServiceVisit =", offlineStart);
assert.ok(offlineStart >= 0 && offlineEnd > offlineStart, "Missing offline visit queue boundary");
const offlineSync = offlineSource.slice(offlineStart, offlineEnd);
function reads(community: string) {
  return [
    `/api/communities/${community}/bounds`,
    `/api/communities/${community}/members`,
    `/api/map-layers/${community}/summary`,
    `/api/communities/${community}/service-schedules`,
    `/api/service-schedules/${community}/visits`,
    `/api/communities/${community}/service-visits`,
  ];
}

describe("community access (isolated production-handler HTTP matrix)", () => {
  let bundle: string;
  let api: any;
  let server: Server;
  let base: string;
  let users: Record<string, any>;
  let calls: any[][];
  let visits: any[];
  let memberships: Set<string>;
  const communities: Record<string, any> = {
    a: { id: "a", organizationId: "org-a" },
    b: { id: "b", organizationId: "org-b" },
    c: { id: "c", organizationId: null },
  };

  before(async () => {
    const built = await build({
      stdin: {
        contents: `
          import * as policy from "./policy";
          import { route } from "./routes/handler";
          import { loadCurrentUser, requireAuth, enforceHoaScoping, enforceOrgScoping, isHoaRole } from "./auth";
          import * as storage from "./storage";
          import { logServiceVisitSchema } from "@workspace/db";
          // Preserve the existing test API while exercising the real central policy.
          export const userCanAccessCommunity = (user: any, communityId: string) =>
            policy.canAccessCommunity(policy.actorFromUser(user), communityId);
          export function createVisitSync(fixture: any) {
            const useCallback = (callback: any) => callback;
            const { svcSyncingRef, pendingSvcRef, setPendingServiceVisits,
              apiRequest, persistSvcQueue, queryClient } = fixture;
            ${offlineSync}
            return syncPendingServiceVisits;
          }
          export function setup(app: any) {
            app.use(loadCurrentUser);
            app.use("/api", enforceHoaScoping);
            app.use("/api", enforceOrgScoping);
            ${handlers}
          }
        `,
        resolveDir: fileURLToPath(new URL(".", import.meta.url)), loader: "ts",
      },
      bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
      plugins: [{
        name: "isolated-community-storage",
        setup(builder) {
          builder.onResolve({ filter: /^(?:\.\/|\.\.\/)storage$/ }, () => ({ path: "storage", namespace: "fixture" }));
          builder.onResolve({ filter: /^\.\/db$/ }, () => ({ path: "db", namespace: "fixture" }));
          builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
            contents: path === "storage" ? "module.exports = __storage;"
              : "export const db = undefined; export const pool = undefined;",
            loader: "js",
          }));
          builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({
            path: fileURLToPath(new URL("../../../lib/db/src/schema/schema.ts", import.meta.url)),
          }));
        },
      }],
    });
    bundle = built.outputFiles[0].text;
  });

  beforeEach(async () => {
    calls = [];
    visits = [];
    memberships = new Set();
    users = {};
    for (const role of ["admin", "map_creator", "hoa_admin", "hoa_member", "client_admin", "property_manager", "contractor"]) {
      users[role] = {
        id: role, role, isActive: true,
        hoaCommunityId: role.startsWith("hoa_") ? "a" : null,
        organizationId: role === "client_admin" ? "org-a" : null,
      };
      // Deliberately misleading memberships must not override HOA/org scope.
      if (["hoa_admin", "hoa_member", "client_admin"].includes(role)) memberships.add(`${role}:b`);
      if (["property_manager", "contractor"].includes(role)) memberships.add(`${role}:a`);
    }
    const record = (name: string, result: any) => async (...args: any[]) => {
      calls.push([name, ...args]);
      return typeof result === "function" ? result(...args) : result;
    };
    const storage = {
      getUserById: async (id: string) => users[id] && { ...users[id] },
      isUserMemberOfCommunity: record("membership", (id: string, community: string) => memberships.has(`${id}:${community}`)),
      getCommunityById: record("community", (id: string) => communities[id]),
      getMapLayerById: record("layer", (id: string) => communities[id] && ({
        id, communityId: id, sourceFormat: "geojson", geojsonData: '{"features":[{}]}',
      })),
      getMapLayerSummaryMetadata: record("layer", (id: string) => communities[id] && ({
        id, communityId: id, sourceFormat: "geojson", featureCount: null, geojsonData: '{"features":[{}]}',
      })),
      getServiceScheduleById: record("schedule", (id: string) => communities[id] && ({ id, communityId: id })),
      getCommunityBounds: record("bounds", { bounds: [[1, 2], [3, 4]] }),
      getCommunityMembers: record("members", [{
        id: "membership", userId: "crew", joinedAt: "2026-01-01",
        user: { displayName: "Assignable crew", username: "crew-login", role: "contractor" },
      }]),
      getMapLayerSummary: record("summary", { assetCount: 1 }),
      getServiceSchedulesByCommunity: record("schedules", (id: string) => [{ id, communityId: id }]),
      getServiceVisits: record("visits", (id: string) => [{ scheduleId: id }]),
      getServiceVisitsByCommunity: record("communityVisits", (id: string) => [{ communityId: id }]),
      upsertServiceVisit: async (data: any) => { visits.push(data); return { id: "visit", ...data }; },
      getDriveFolders: record("folders", [{ id: "folder" }]),
      getDriveFiles: record("files", [{ id: "file" }]),
    };
    const module = { exports: {} as any };
    new Function("require", "module", "exports", "__storage", bundle)(require, module, module.exports, storage);
    api = module.exports;
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      // Stale session assignments must not grant access.
      req.session = {
        userId: req.headers["x-user"], hoaCommunityId: "a", organizationId: "org-a",
        destroy: (callback: () => void) => callback(),
      };
      next();
    });
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
  async function request(role: string, path: string, body?: any) {
    const response = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", "x-user": role },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  }
  function noProtectedReads() {
    assert.deepEqual(calls.filter(([name]) => !["community", "membership", "layer", "schedule"].includes(name)), []);
  }

  for (const role of ["admin", "map_creator", "hoa_admin", "hoa_member", "client_admin", "property_manager", "contractor"]) {
    it(`checks all six reads for ${role} against assigned, foreign and unowned communities`, async () => {
      for (const community of ["a", "b", "c"]) {
        const allowed = ["admin", "map_creator"].includes(role) || community === "a";
        for (const path of reads(community)) {
          calls.length = 0;
          const result = await request(role, path);
          assert.equal(result.status, allowed ? 200 : 403, `${role}: ${path}`);
          if (!allowed) {
            // Existing org middleware may reject community-path requests before
            // the handler; ownership-derived routes exercise the shared error.
            if (role !== "client_admin" || !path.startsWith("/api/communities/")) assert.deepEqual(result.body, denial);
            noProtectedReads();
          }
        }
      }
    });
  }

  it("uses exact helper rules without falling back from missing HOA/org scope to membership", async () => {
    for (const role of ["hoa_admin", "hoa_member", "client_admin"]) {
      memberships.add(`${role}:a`);
      users[role].hoaCommunityId = null;
      users[role].organizationId = null;
      for (const community of ["a", "b", "c", "missing"]) {
        assert.equal(await api.userCanAccessCommunity(users[role], community), false);
      }
    }
    assert.equal(await api.userCanAccessCommunity(users.client_admin, "c"), false, "null must never equal null");
    for (const role of ["admin", "map_creator"]) {
      calls.length = 0;
      assert.equal(await api.userCanAccessCommunity(users[role], "any"), true);
      assert.deepEqual(calls, []);
    }
  });

  it("uses the live role and assignments, not old session scope", async () => {
    for (const role of ["hoa_admin", "hoa_member", "client_admin"]) {
      users[role].hoaCommunityId = "b";
      users[role].organizationId = "org-b";
      for (const path of reads("a")) assert.equal((await request(role, path)).status, 403);
      for (const path of reads("b")) assert.equal((await request(role, path)).status, 200);
      users[role].hoaCommunityId = null;
      users[role].organizationId = null;
      for (const path of reads("b")) assert.equal((await request(role, path)).status, 403);
    }
    users.admin.role = "contractor";
    assert.equal((await request("admin", reads("a")[0])).status, 403);
    memberships.delete("contractor:a");
    assert.equal((await request("contractor", reads("a")[0])).status, 403);
  });

  it("rejects every read and visit write without a live authenticated user", async () => {
    for (const inactive of [false, true]) {
      if (inactive) users.contractor.isActive = false;
      const role = inactive ? "contractor" : "missing";
      for (const path of reads("a")) assert.equal((await request(role, path)).status, 401);
      assert.equal((await request(role, "/api/service-schedules/a/log", visitBody)).status, 401);
    }
    assert.deepEqual(visits, []);
    noProtectedReads();
  });

  it("returns missing ownership resources before attempting reads or writes", async () => {
    assert.deepEqual(await request("contractor", "/api/map-layers/missing/summary"), {
      status: 404, body: { error: "Layer not found" },
    });
    for (const body of [undefined, visitBody]) {
      assert.deepEqual(await request("contractor", `/api/service-schedules/missing/${body ? "log" : "visits"}`, body), {
        status: 404, body: { error: "Service schedule not found" },
      });
    }
    assert.deepEqual(visits, []);
    noProtectedReads();
  });

  it("only exposes member usernames to admin while retaining assignable crew fields", async () => {
    for (const role of Object.keys(users)) {
      const result = await request(role, "/api/communities/a/members");
      assert.equal(result.status, 200);
      assert.deepEqual(result.body, [{
        id: "membership", userId: "crew", displayName: "Assignable crew", role: "contractor", joinedAt: "2026-01-01",
        ...(role === "admin" ? { username: "crew-login" } : {}),
        ...(["admin", "property_manager"].includes(role) ? { companyName: null } : {}),
      }]);
    }
  });

  it("denies non-crew roles and outsider contractors without creating any visit", async () => {
    for (const role of Object.keys(users)) {
      for (const community of ["a", "b"]) {
        if (role === "admin" || (role === "contractor" && community === "a")) continue;
        assert.deepEqual(await request(role, `/api/service-schedules/${community}/log`, visitBody), {
          status: 403, body: denial,
        });
        assert.deepEqual(visits, []);
      }
    }
  });

  it("preserves crew online/offline and admin payloads, stripping unknown and forged ownership fields", async () => {
    for (const [role, community] of [["contractor", "a"], ["admin", "b"]]) {
      const response = await request(role, `/api/service-schedules/${community}/log`, {
        ...visitBody, id: "injected", communityId: "c", scheduleId: "c", completedBy: "other", installedClientExtra: true,
      });
      assert.equal(response.status, 201);
      assert.deepEqual(response.body, {
        id: "visit", ...visitBody, completedBy: role, communityId: community, scheduleId: community,
      });
      assert.deepEqual(visits.at(-1), {
        ...visitBody, completedAt: new Date(visitBody.completedAt),
        completedBy: role, communityId: community, scheduleId: community,
      });
    }
    assert.equal(visits.length, 2);
    assert.equal((await request("contractor", "/api/service-schedules/a/log", {})).status, 400);
    assert.equal(visits.length, 2);
  });

  it("retains date filters and successful map/schedule/visit response shapes", async () => {
    for (const role of ["hoa_member", "hoa_admin", "property_manager", "contractor"]) {
      assert.deepEqual((await request(role, reads("a")[0])).body, { bounds: [[1, 2], [3, 4]] });
      assert.deepEqual((await request(role, reads("a")[2])).body, { featureCount: 1, sourceFormat: "geojson", assetCount: 1 });
      assert.deepEqual((await request(role, reads("a")[3])).body, [{ id: "a", communityId: "a" }]);
      for (const path of reads("a").slice(4)) {
        assert.equal((await request(role, path + "?from=2026-11-01&to=2026-11-30")).status, 200);
      }
    }
    assert.deepEqual(calls.filter(([name]) => ["visits", "communityVisits"].includes(name)), Array.from({ length: 4 }, () => [
      ["visits", "a", { from: "2026-11-01", to: "2026-11-30" }],
      ["communityVisits", "a", { from: "2026-11-01", to: "2026-11-30" }],
    ]).flat());
  });

  it("retains drive role gates and adds assigned-only HOA access without membership", async () => {
    for (const role of Object.keys(users)) {
      for (const community of ["a", "b"]) {
        const allowed = role === "admin" || (["hoa_admin", "hoa_member", "property_manager"].includes(role) && community === "a");
        calls.length = 0;
        const response = await request(role, `/api/drive?communityId=${community}`);
        assert.equal(response.status, allowed ? 200 : 403, `${role}: drive ${community}`);
        if (allowed) assert.deepEqual(response.body, { folders: [{ id: "folder" }], files: [{ id: "file" }] });
        else noProtectedReads();
      }
    }
  });

  it("syncs the real mobile offline visit queue and retains rejected visits for retry", async () => {
    for (const role of ["contractor", "hoa_member"]) {
      const queued = { id: "queued", scheduleId: "a", communityId: "a", ...visitBody, state: "queued" };
      const pendingSvcRef = { current: [queued] };
      const svcSyncingRef = { current: false };
      let persisted: any;
      const invalidated: any[] = [];
      const sync = api.createVisitSync({
        pendingSvcRef, svcSyncingRef, setPendingServiceVisits: () => {},
        persistSvcQueue: async (queue: any) => { persisted = queue; },
        queryClient: { invalidateQueries: (key: any) => invalidated.push(key) },
        apiRequest: async (method: string, path: string, body: any) => {
          assert.equal(method, "POST");
          const response = await request(role, path, body);
          if (response.status !== 201) throw new Error(`HTTP ${response.status}`);
          return response;
        },
      });
      const allowed = role === "contractor";
      assert.deepEqual(await sync(), allowed ? { synced: 1, failed: 0 } : { synced: 0, failed: 1 });
      assert.equal(svcSyncingRef.current, false);
      assert.deepEqual(pendingSvcRef.current, persisted);
      if (allowed) {
        assert.deepEqual(persisted, []);
        assert.deepEqual(invalidated, [{ queryKey: ["service-visits"] }, { queryKey: ["service-schedules"] }]);
        assert.equal(visits.length, 1);
        assert.equal(visits[0].completedBy, "contractor");
      } else {
        assert.deepEqual(persisted, [{ ...queued, state: "failed", lastError: "HTTP 403" }]);
        assert.deepEqual(invalidated, []);
        assert.equal(visits.length, 1, "rejected queue replay must create nothing");
      }
    }
  });
});
