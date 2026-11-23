import assert from "node:assert/strict";
import { describe, it } from "node:test";
import express from "express";
import { policyFixture } from "./testUtils/policyFixture";

// Exercise the actual extracted handlers and policies with isolated I/O.
// Guard identities/order are checked structurally; the existing auth suites
// exercise the real middleware. No account, token or database row is changed.
const roles = ["admin", "property_manager", "contractor", "contractor_manager",
  "map_creator", "hoa_admin", "hoa_member", "client_admin"] as const;
const users = Object.fromEntries(roles.map(role => [role, {
  id: role, role, companyId: null, hoaCommunityId: "member", organizationId: "org",
}]));
const visit = {
  serviceDate: "2026-11-22", completedAt: "2026-11-22T12:00:00.000Z",
  employeeSignOffName: "Crew fixture", notes: "Offline fixture",
};
const token = { token: "ExponentPushToken[fixture]", deviceId: "device", platform: "ios" };
const denial = { status: 403, body: { error: "You do not have access to this community" } };

async function withHandlers(overrides: Record<string, any>, check: (
  request: (user: string, path: string, method?: string, body?: unknown) => Promise<{ status: number; body: any }>,
  calls: any[][],
  api: Awaited<ReturnType<typeof policyFixture>>["api"],
) => Promise<void>) {
  const calls: any[][] = [];
  const record = (name: string, result: any) => async (...args: any[]) => {
    calls.push([name, ...args]);
    return typeof result === "function" ? result(...args) : result;
  };
  const { api } = await policyFixture({
    getUserById: record("user", (id: string) => users[id]),
    isUserMemberOfCommunity: record("member", (_id: string, community: string) => community === "member"),
    getCommunityById: record("community", (id: string) => ({ id, organizationId: "org" })),
    getServiceScheduleById: record("schedule", (id: string) => id === "missing" ? undefined : { id, communityId: id }),
    getServiceSchedulesByCommunity: record("schedules", (id: string) => [{ id }]),
    createServiceSchedule: record("create", (data: any) => ({ id: "schedule", ...data })),
    updateServiceSchedule: record("update", (id: string, data: any) => id === "missing" ? undefined : { id, ...data }),
    deleteServiceSchedule: record("delete", (id: string) => id !== "missing"),
    getServiceVisits: record("visits", [{ id: "visit" }]),
    getServiceVisitsByCommunity: record("communityVisits", [{ id: "visit" }]),
    upsertServiceVisit: record("log", (data: any) => ({ id: "visit", ...data })),
    getUserNotificationPreferences: record("preferences", { taskAssigned: false }),
    setUserNotificationPreferences: record("savePreferences", undefined),
    getNotificationsForUser: record("notifications", [{ id: "notification" }]),
    getUnreadNotificationCount: record("unread", 3),
    markAllNotificationsRead: record("readAll", undefined),
    markNotificationRead: record("read", (id: string, user: string) =>
      id === "own" && user === "contractor" ? { id, readAt: "now" } : undefined),
    registerPushToken: record("registerToken", (userId: string, token: string, platform: string, deviceId: string) =>
      ({ userId, token, platform, deviceId })),
    removePushTokenByDevice: record("removeDevice", undefined),
    removePushToken: record("removeToken", undefined),
    sendDueReminders: record("due", undefined),
    ...overrides,
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const id = req.headers["x-user"] as string;
    req.currentUser = users[id] as any;
    req.session = { userId: id } as any;
    req.log = { error() {} } as any;
    next();
  });
  api.registerServiceScheduleRoutes(app);
  api.registerNotificationRoutes(app);
  api.registerPushRoutes(app);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    await check(async (user, path, method = "GET", body) => {
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
        method, headers: { "x-user": user, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() };
    }, calls, api);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

describe("extracted service, notification and push handler compatibility", () => {
  it("retains service viewing and visit filters for every role, including member account managers", async () => {
    await withHandlers({}, async (request, calls) => {
      for (const role of roles) {
        assert.deepEqual(await request(role, "/api/communities/member/service-schedules"),
          { status: 200, body: [{ id: "member" }] });
        assert.deepEqual(await request(role, "/api/service-schedules/member/visits?from=start&to=end"),
          { status: 200, body: [{ id: "visit" }] });
        assert.deepEqual(await request(role, "/api/communities/member/service-visits?from=start&to=end"),
          { status: 200, body: [{ id: "visit" }] });
      }
      assert.deepEqual(calls.filter(([name]) => ["visits", "communityVisits"].includes(name)),
        roles.flatMap(() => [
          ["visits", "member", { from: "start", to: "end" }],
          ["communityVisits", "member", { from: "start", to: "end" }],
        ]));
    });
  });

  it("retains admin schedule create/edit/delete bodies, defaults, validation and missing-record responses", async () => {
    await withHandlers({}, async (request, calls) => {
      assert.deepEqual(await request("admin", "/api/communities/member/service-schedules", "POST",
        { dayOfWeek: 2, communityId: "forged", extra: true }),
      { status: 201, body: { id: "schedule", communityId: "member", dayOfWeek: 2, serviceType: "mowing_visit", isActive: true } });
      assert.deepEqual(await request("admin", "/api/service-schedules/member", "PATCH",
        { dayOfWeek: 4, communityId: "forged", serviceType: "snow_clearing", extra: true }),
      { status: 200, body: { id: "member", dayOfWeek: 4 } });
      assert.deepEqual(calls.filter(([name]) => name === "update"), [["update", "member", { dayOfWeek: 4 }]]);
      assert.deepEqual(await request("admin", "/api/service-schedules/member", "DELETE"),
        { status: 200, body: { success: true } });
      for (const method of ["PATCH", "DELETE"]) {
        assert.deepEqual(await request("admin", "/api/service-schedules/missing", method, {}),
          { status: 404, body: { error: "Service schedule not found" } });
      }
      for (const [method, path] of [
        ["POST", "/api/communities/member/service-schedules"], ["PATCH", "/api/service-schedules/missing"],
      ]) {
        calls.length = 0;
        const response = await request("admin", path, method, { dayOfWeek: 9 });
        assert.equal(response.status, 400);
        assert.equal(response.body.error, "Invalid data");
        assert.ok(response.body.details.fieldErrors.dayOfWeek);
        assert.deepEqual(calls, []);
      }
    });
  });

  it("retains log validation, missing schedule and role-before-membership order, including PM and manager denial", async () => {
    await withHandlers({}, async (request, calls) => {
      assert.equal((await request("contractor_manager", "/api/service-schedules/missing/log", "POST", {})).status, 400);
      assert.deepEqual(calls, []);
      assert.deepEqual(await request("contractor_manager", "/api/service-schedules/missing/log", "POST", visit),
        { status: 404, body: { error: "Service schedule not found" } });
      assert.deepEqual(calls, [["schedule", "missing"]]);
      for (const role of roles.filter(role => role !== "admin" && role !== "contractor")) {
        calls.length = 0;
        assert.deepEqual(await request(role, "/api/service-schedules/member/log", "POST", visit), denial);
        assert.deepEqual(calls, [["schedule", "member"]]);
      }
      calls.length = 0;
      assert.deepEqual(await request("contractor", "/api/service-schedules/outside/log", "POST", visit), denial);
      assert.deepEqual(calls, [["schedule", "outside"], ["member", "contractor", "outside"]]);
      for (const [role, community] of [["admin", "outside"], ["contractor", "member"]]) {
        const response = await request(role, `/api/service-schedules/${community}/log`, "POST", {
          ...visit, completedBy: "forged", communityId: "forged", scheduleId: "forged", status: "skipped", skipReason: "legacy", extra: true,
        });
        assert.deepEqual(response, { status: 201, body: {
          id: "visit", scheduleId: community, communityId: community, completedBy: role, ...visit,
        } });
      }
      assert.deepEqual((calls as any[][]).filter(([name]) => name === "log"), [
        ["log", { scheduleId: "outside", communityId: "outside", completedBy: "admin", ...visit, completedAt: new Date(visit.completedAt) }],
        ["log", { scheduleId: "member", communityId: "member", completedBy: "contractor", ...visit, completedAt: new Date(visit.completedAt) }],
      ]);
      const response = await request("contractor", "/api/service-schedules/member/log", "POST", { serviceDate: "legacy" });
      assert.equal(response.status, 201);
      assert.equal(response.body.employeeSignOffName, "");
      assert.equal(response.body.notes, null);
      assert.ok(Number.isFinite(Date.parse(response.body.completedAt)));
    });
  });

  it("keeps notification preferences caller-owned and defaults every nonboolean value to true", async () => {
    await withHandlers({}, async (request, calls) => {
      for (const role of roles) {
        calls.length = 0;
        assert.deepEqual(await request(role, "/api/notification-preferences?userId=other"),
          { status: 200, body: { taskAssigned: false } });
        const prefs = { taskAssigned: false, dueReminders: false, syncFailure: true, taskCompleted: true,
          requestSubmitted: true, requestCompleted: true, requestStatusUpdates: true };
        assert.deepEqual(await request(role, "/api/notification-preferences", "PUT", {
          taskAssigned: false, dueReminders: false, syncFailure: null, taskCompleted: 0,
          requestSubmitted: "false", requestCompleted: [], userId: "other",
        }), { status: 200, body: prefs });
        assert.deepEqual(calls, [["preferences", role], ["savePreferences", role, prefs]]);
      }
    });
  });

  it("keeps notification paging quirks, unread counts and missing-user responses", async () => {
    await withHandlers({}, async (request, calls) => {
      for (const [query, limit, offset] of [
        ["", 50, 0], ["?limit=500&offset=12", 100, 12], ["?limit=0&offset=bad", 50, 0],
        ["?limit=-2&offset=-3", -2, -3], ["?limit=4extra&offset=2extra", 4, 2],
      ] as const) {
        calls.length = 0;
        assert.deepEqual(await request("contractor", `/api/notifications${query}`),
          { status: 200, body: [{ id: "notification" }] });
        assert.deepEqual(calls, [["user", "contractor"], ["notifications", "contractor", limit, offset]]);
      }
      calls.length = 0;
      assert.deepEqual(await request("hoa_member", "/api/notifications/unread-count?userId=other"),
        { status: 200, body: { count: 3 } });
      assert.deepEqual(calls, [["user", "hoa_member"], ["unread", "hoa_member"]]);
      for (const path of ["/api/notifications", "/api/notifications/unread-count"]) {
        calls.length = 0;
        assert.deepEqual(await request("missing", path), { status: 401, body: { error: "Not authenticated" } });
        assert.deepEqual(calls, [["user", "missing"]]);
      }
    });
  });

  it("scopes mark-one and mark-all operations to the session caller, not posted ownership", async () => {
    await withHandlers({}, async (request, calls) => {
      assert.deepEqual(await request("contractor", "/api/notifications/own/read", "PUT", { userId: "other" }),
        { status: 200, body: { id: "own", readAt: "now" } });
      for (const [user, id] of [["contractor", "foreign"], ["hoa_member", "own"]]) {
        assert.deepEqual(await request(user, `/api/notifications/${id}/read`, "PUT", {}),
          { status: 404, body: { error: "Notification not found" } });
      }
      assert.deepEqual(await request("contractor", "/api/notifications/read-all", "PUT", { userId: "other" }),
        { status: 200, body: { success: true } });
      assert.deepEqual(calls, [
        ["read", "own", "contractor"], ["read", "foreign", "contractor"], ["read", "own", "hoa_member"],
        ["readAll", "contractor"],
      ]);
    });
  });

  it("preserves push input handling, caller ownership, the device-keyed 24-hour throttle and changed tokens", async () => {
    await withHandlers({}, async (request, calls, api) => {
      assert.equal(api.PUSH_TOKEN_RATE_LIMIT_MS, 86_400_000);
      const invalid = await request("contractor", "/api/push-tokens", "POST", {});
      assert.equal(invalid.status, 400);
      assert.equal(invalid.body.error, "Invalid input");
      assert.ok(invalid.body.details.fieldErrors.token);
      assert.deepEqual(calls, []);
      assert.deepEqual(await request("contractor", "/api/push-tokens", "POST", { ...token, userId: "forged", extra: true }),
        { status: 201, body: { ...token, userId: "contractor" } });
      const saved = api.pushTokenLastReg.get(token.deviceId)!;
      // Preserve the existing device-only key even across callers.
      assert.deepEqual(await request("hoa_member", "/api/push-tokens", "POST", token),
        { status: 200, body: { rateLimited: true } });
      assert.deepEqual(calls, [["registerToken", "contractor", token.token, "ios", "device"]]);
      const changed = { ...token, token: "ExponentPushToken[changed]" };
      assert.deepEqual(await request("hoa_member", "/api/push-tokens", "POST", changed),
        { status: 201, body: { ...changed, userId: "hoa_member" } });
      api.pushTokenLastReg.set(token.deviceId, { ts: saved.ts - api.PUSH_TOKEN_RATE_LIMIT_MS, token: changed.token });
      assert.equal((await request("hoa_member", "/api/push-tokens", "POST", changed)).status, 201);
      assert.equal(calls.length, 3);
    });
  });

  it("retains device-first token removal, first matching throttle cleanup, re-registration and due reminders", async () => {
    await withHandlers({}, async (request, calls, api) => {
      await request("contractor", "/api/push-tokens", "POST", token);
      calls.length = 0;
      assert.deepEqual(await request("contractor", "/api/push-tokens", "DELETE",
        { deviceId: "device", token: "ignored", userId: "forged" }),
      { status: 200, body: { message: "Push token removed" } });
      assert.equal(api.pushTokenLastReg.has("device"), false);
      assert.deepEqual(calls, [["removeDevice", "contractor", "device"]]);
      assert.equal((await request("contractor", "/api/push-tokens", "POST", token)).status, 201);
      api.pushTokenLastReg.set("second", { ts: Date.now(), token: token.token });
      calls.length = 0;
      assert.deepEqual(await request("contractor", "/api/push-tokens", "DELETE", { token: token.token }),
        { status: 200, body: { message: "Push token removed" } });
      assert.equal(api.pushTokenLastReg.has("device"), false);
      assert.equal(api.pushTokenLastReg.has("second"), true);
      assert.deepEqual(calls, [["removeToken", "contractor", token.token]]);
      assert.deepEqual(await request("contractor", "/api/push-tokens", "DELETE", {}),
        { status: 400, body: { error: "token or deviceId is required" } });
      assert.deepEqual(await request("admin", "/api/push/due-reminders", "POST", {}),
        { status: 200, body: { message: "Due reminders sent" } });
      assert.deepEqual(calls.at(-1), ["due"]);
    });
  });

  it("retains every one of the 16 route-specific 500 bodies", async () => {
    const fail = async () => { throw Error("Expected isolated I/O failure"); };
    await withHandlers(Object.fromEntries([
      "getServiceSchedulesByCommunity", "createServiceSchedule", "updateServiceSchedule", "deleteServiceSchedule",
      "getServiceScheduleById", "getServiceVisitsByCommunity", "getUserNotificationPreferences",
      "setUserNotificationPreferences", "getUserById", "markAllNotificationsRead", "markNotificationRead",
      "registerPushToken", "removePushTokenByDevice", "sendDueReminders",
    ].map(name => [name, fail])), async request => {
      for (const [method, path, body, error] of [
        ["GET", "/api/communities/member/service-schedules", undefined, "Failed to get service schedules"],
        ["POST", "/api/communities/member/service-schedules", { dayOfWeek: 1 }, "Failed to create service schedule"],
        ["PATCH", "/api/service-schedules/member", {}, "Failed to update service schedule"],
        ["DELETE", "/api/service-schedules/member", undefined, "Failed to delete service schedule"],
        ["GET", "/api/service-schedules/member/visits", undefined, "Failed to get service visits"],
        ["GET", "/api/communities/member/service-visits", undefined, "Failed to get service visits"],
        ["POST", "/api/service-schedules/member/log", visit, "Failed to log service visit"],
        ["GET", "/api/notification-preferences", undefined, "Failed to fetch notification preferences"],
        ["PUT", "/api/notification-preferences", {}, "Failed to save notification preferences"],
        ["GET", "/api/notifications", undefined, "Failed to fetch notifications"],
        ["GET", "/api/notifications/unread-count", undefined, "Failed to get unread count"],
        ["PUT", "/api/notifications/read-all", {}, "Failed to mark all read"],
        ["PUT", "/api/notifications/own/read", {}, "Failed to mark notification read"],
        ["POST", "/api/push-tokens", token, "Failed to register push token"],
        ["DELETE", "/api/push-tokens", { deviceId: "device" }, "Failed to remove push token"],
        ["POST", "/api/push/due-reminders", {}, "Failed to send due reminders"],
      ] as const) assert.deepEqual(await request("admin", path, method, body), { status: 500, body: { error } });
    });
  });
});
