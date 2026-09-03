import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import type { Task } from "@workspace/db";
import {
  notifyPortfolioWorkOrderSubmitted,
  type PortfolioNotificationDependencies,
} from "./pushNotifications.js";

const task = {
  id: "12345678-aaaa-bbbb-cccc-dddddddddddd",
  communityId: "location-1",
  title: "Repair irrigation controller",
} as Task;

function dependencies(overrides: Partial<PortfolioNotificationDependencies> = {}) {
  const notifications: Array<Record<string, unknown>> = [];
  const pushes: Array<{ userId: string; payload: Record<string, unknown> }> = [];
  const base: PortfolioNotificationDependencies = {
    getCommunityById: async () => ({ name: "North Campus" } as Awaited<ReturnType<PortfolioNotificationDependencies["getCommunityById"]>>),
    getActiveContractorUserIdsForCommunity: async () => ["contractor-1"],
    getClientUsersByOrg: async () => [],
    getUserNotificationPreferences: async () => ({
      taskAssigned: true,
      dueReminders: true,
      syncFailure: true,
      taskCompleted: true,
      requestSubmitted: true,
      requestCompleted: true,
      requestStatusUpdates: true,
    }),
    createNotification: async (data) => {
      notifications.push(data);
      return data as Awaited<ReturnType<PortfolioNotificationDependencies["createNotification"]>>;
    },
    sendPushToUser: async (userId, payload) => {
      pushes.push({ userId, payload: payload as unknown as Record<string, unknown> });
    },
  };
  return {
    dependencies: { ...base, ...overrides },
    notifications,
    pushes,
  };
}

describe("portfolio work-order notifications", () => {
  it("notifies every distinct contractor once and links the actionable reference to the task", async () => {
    const test = dependencies({
      // Represents multiple active contracts, including two for the same contractor.
      getActiveContractorUserIdsForCommunity: async () => [
        "contractor-1",
        "contractor-1",
        "contractor-2",
      ],
    });

    await notifyPortfolioWorkOrderSubmitted(task, "org-1", test.dependencies);

    assert.deepEqual(test.notifications.map((notification) => notification.recipientUserId).sort(), [
      "contractor-1",
      "contractor-2",
    ]);
    assert.equal(test.notifications.length, 2);
    assert.equal(test.pushes.length, 2);
    for (const notification of test.notifications) {
      assert.equal(notification.type, "WORK_ORDER_SUBMITTED");
      assert.equal(notification.relatedTaskId, task.id);
      assert.match(String(notification.body), /North Campus/);
      assert.match(String(notification.body), /WO-12345678/);
    }
  });

  it("does not create a row or push when request-submitted notifications are disabled", async () => {
    const test = dependencies({
      getUserNotificationPreferences: async () => ({
        taskAssigned: true,
        dueReminders: true,
        syncFailure: true,
        taskCompleted: true,
        requestSubmitted: false,
        requestCompleted: true,
        requestStatusUpdates: true,
      }),
    });

    await notifyPortfolioWorkOrderSubmitted(task, "org-1", test.dependencies);

    assert.equal(test.notifications.length, 0);
    assert.equal(test.pushes.length, 0);
  });

  it("routes an uncontracted location to active organization client admins", async () => {
    const test = dependencies({
      getActiveContractorUserIdsForCommunity: async () => [],
      getClientUsersByOrg: async () => [
        { id: "admin-active", username: "active-admin", isActive: true } as any,
        { id: "admin-inactive", username: "inactive-admin", isActive: false } as any,
      ],
    });
    const warnings: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args);

    try {
      await notifyPortfolioWorkOrderSubmitted(task, "org-1", test.dependencies);
    } finally {
      console.warn = originalWarn;
    }

    assert.deepEqual(test.notifications.map((notification) => notification.recipientUserId), ["admin-active"]);
    assert.deepEqual(test.pushes.map((push) => push.userId), ["admin-active"]);
    assert.match(String(test.notifications[0].title), /routing/i);
    assert.match(String(test.notifications[0].body), /needs contractor routing/);
    assert.ok(warnings.some((warning) => warning.join(" ").includes("North Campus")));
    assert.ok(warnings.some((warning) => warning.join(" ").includes("active-admin")));
  });

  it("contains delivery failures so callers can keep the persisted work order successful", async () => {
    const test = dependencies({
      createNotification: async () => {
        throw new Error("notification database unavailable");
      },
      sendPushToUser: async () => {
        throw new Error("push service unavailable");
      },
    });
    const originalError = console.error;
    console.error = () => {};

    try {
      await assert.doesNotReject(
        notifyPortfolioWorkOrderSubmitted(task, "org-1", test.dependencies),
      );
    } finally {
      console.error = originalError;
    }
  });
});

describe("portfolio work-order route notification contract", () => {
  const routes = readFileSync(new URL("./routes/routes.ts", import.meta.url), "utf8");
  const routeStart = routes.indexOf('app.post("/api/portfolio/work-orders"');
  const routeEnd = routes.indexOf('app.post("/api/portfolio/work-orders/:taskId/approve"');
  const route = routes.slice(routeStart, routeEnd);

  it("starts notification delivery only after attachment persistence", () => {
    assert.ok(routeStart >= 0);
    assert.ok(routeEnd > routeStart);
    assert.ok(route.indexOf("await storage.createAttachment") < route.indexOf("notifyPortfolioWorkOrderSubmitted"));
  });

  it("keeps the existing HOA submission notifier separate", () => {
    assert.match(routes, /notifyHoaRequestSubmitted\(task\)\.catch/);
  });
});

describe("active portfolio contractor lookup contract", () => {
  const storage = readFileSync(new URL("./storage.ts", import.meta.url), "utf8");
  const lookupStart = storage.indexOf("export async function getActiveContractorUserIdsForCommunity");
  const lookupEnd = storage.indexOf("export async function updateUserProfile", lookupStart);
  const lookup = storage.slice(lookupStart, lookupEnd);

  it("excludes expired contracts after their inclusive end date", () => {
    assert.match(lookup, /gte\(contracts\.endDate, sql`CURRENT_DATE`\)/);
  });

  it("excludes contracts whose start date has not arrived", () => {
    assert.match(lookup, /lte\(contracts\.startDate, sql`CURRENT_DATE`\)/);
  });

  it("excludes inactive and non-contractor user accounts", () => {
    assert.match(lookup, /\.innerJoin\(users, eq\(contracts\.contractorUserId, users\.id\)\)/);
    assert.match(lookup, /eq\(users\.role, "contractor"\)/);
    assert.match(lookup, /eq\(users\.isActive, true\)/);
  });
});