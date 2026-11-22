import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { readRouteFixtureSource, taskFixtureImports } from "./testUtils/routeFixtureSource";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import express from "express";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { build } from "esbuild";
import * as schema from "../../../lib/db/src/schema/schema";

// Use the exact production handlers and storage, isolated in a rollback-only
// transaction. Notifications are captured rather than sent to real users.
const routes = readRouteFixtureSource();
function between(start: string, end: string) {
  const from = routes.indexOf(start);
  const to = routes.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Verified route boundary missing: ${start}`);
  return routes.slice(from, to);
}
const edit = between('app.put("/api/tasks/:id",', 'app.delete("/api/tasks/:id",');
const complete = between('app.post("/api/tasks/:id/complete",', 'app.post("/api/tasks/:id/attachments",');
const require = createRequire(import.meta.url);

describe("task permissions and compatibility (transactional PostgreSQL)", {
  skip: !process.env.DATABASE_URL ? "DATABASE_URL unavailable; database acceptance tests not run" : false,
}, () => {
  let pool: pg.Pool;
  let client: pg.PoolClient;
  let server: Server;
  let base: string;
  let bundle: string;
  let storage: any;
  let communityId: string;
  let otherCommunityId: string;
  let users: Record<string, any>;
  let task: any;
  let notifications: any[];

  before(async () => {
    assert.notEqual(process.env.NODE_ENV, "production", "Refusing production database tests");
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const built = await build({
      stdin: {
        contents: `
          ${taskFixtureImports}
          import * as storage from "./storage";
          import { updateTaskManagerSchema, updateTaskFieldSchema, completeTaskSchema } from "@workspace/db";
          const requireAuth = async (req: any, res: any, next: any) => {
            if (!req.session.userId) return res.sendStatus(401);
            req.currentUser = await storage.getUserById(req.session.userId);
            next();
          };
          const notifyTaskAssigned = async (...args: any[]) => __notifications.push(["assigned", ...args]);
          const notifyRequestAcknowledged = async (...args: any[]) => __notifications.push(["acknowledged", ...args]);
          const notifyTaskCompleted = async (...args: any[]) => __notifications.push(["completed", ...args]);
          export { storage };
          export function setup(app: any) { ${edit} ${complete} }
        `,
        resolveDir: fileURLToPath(new URL(".", import.meta.url)), loader: "ts",
      },
      bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
      plugins: [{
        name: "transaction-only-db",
        setup(builder) {
          builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({
            path: fileURLToPath(new URL("../../../lib/db/src/schema/schema.ts", import.meta.url)),
          }));
          builder.onResolve({ filter: /^\.\/db$/ }, () => ({ path: "db", namespace: "transaction" }));
          builder.onLoad({ filter: /.*/, namespace: "transaction" }, () => ({
            contents: "export const db = __testDb; export const pool = undefined;", loader: "js",
          }));
        },
      }],
    });
    bundle = built.outputFiles[0].text;
  });
  beforeEach(async () => {
    client = await pool.connect();
    await client.query("BEGIN");
    notifications = [];
    const database = drizzle(client);
    let savepoint = 0;
    database.transaction = (async (callback: (tx: any) => Promise<any>) => {
      const name = `task_permission_${++savepoint}`;
      await client.query(`SAVEPOINT ${name}`);
      try {
        const result = await callback(database);
        await client.query(`RELEASE SAVEPOINT ${name}`);
        return result;
      } catch (error) {
        await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
        await client.query(`RELEASE SAVEPOINT ${name}`);
        throw error;
      }
    }) as typeof database.transaction;
    const module = { exports: {} as any };
    new Function("require", "module", "exports", "__testDb", "__notifications", bundle)(
      require, module, module.exports, database, notifications,
    );
    storage = module.exports.storage;
    communityId = (await storage.createCommunity({ name: "Task permission fixture" })).id;
    otherCommunityId = (await storage.createCommunity({ name: "Other community" })).id;
    users = {};
    const company = await storage.createCompany(`Permission fixture ${crypto.randomUUID()}`, "contractor");
    for (const role of [...schema.userRoleEnum.enumValues, "other", "outsider"]) {
      users[role] = await storage.createUser({
        username: `task-permission-${crypto.randomUUID()}`, password: "not-a-login",
        displayName: "Task fixture", role: role === "other" || role === "outsider" ? "contractor" : role,
        ...(role.startsWith("hoa_") ? { hoaCommunityId: communityId } : {}),
        ...(["contractor", "other", "outsider"].includes(role) ? { companyId: company.id } : {}),
      });
      if (role !== "outsider") await storage.addCommunityMember(communityId, users[role].id);
    }
    task = await storage.createTask({
      communityId, title: "Original", createdBy: users.admin.id, assignedTo: users.contractor.id,
    });
    await client.query("UPDATE tasks SET estimate_cents = 5000 WHERE id = $1", [task.id]);
    task = await storage.getTaskById(task.id);
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.session = { userId: req.headers["x-user"] };
      next();
    });
    module.exports.setup(app);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    base = `http://127.0.0.1:${address.port}`;
  });
  afterEach(async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (client) { await client.query("ROLLBACK"); client.release(); }
  });
  after(async () => { await pool?.end(); });

  async function request(role: string, body: unknown, completion = false) {
    const res = await fetch(`${base}/api/tasks/${task.id}${completion ? "/complete" : ""}`, {
      method: completion ? "POST" : "PUT",
      headers: { "Content-Type": "application/json", "x-user": users[role].id },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  }
  async function unchanged() {
    assert.deepEqual(await storage.getTaskById(task.id), task);
    assert.deepEqual(await storage.getTaskCompletions(task.id), []);
    assert.deepEqual(notifications, []);
  }

  it("denies all four read-only roles, including every HOA field injection, without writes", async () => {
    for (const role of ["hoa_member", "hoa_admin", "client_admin", "map_creator"]) {
      for (const fields of [
        { estimateCents: 1 }, { approvedBy: users.admin.id }, { communityId: otherCommunityId },
        { status: "acknowledged" },
      ]) {
        const res = await request(role, { ...fields, version: task.version });
        assert.deepEqual(res, { status: 403, body: { error: "You cannot edit this task" } });
        await unchanged();
      }
    }
  });

  it("strips contractor field injection while preserving acknowledge, start, pending and timestamp generation", async () => {
    for (const status of ["acknowledged", "in_progress", "pending"]) {
      const res = await request("contractor", {
        version: task.version, status, estimateCents: 1, title: "Injected", priority: "urgent",
        communityId: otherCommunityId, createdBy: users.other.id, origin: "HOA",
        approvedAt: "2000-01-01", approvedBy: users.other.id, cancelledAt: "2000-01-01",
        cancelledBy: users.other.id, cancelReason: "bad", declinedAt: "2000-01-01",
        declinedBy: users.other.id, declineReason: "bad", acknowledgedAt: "2000-01-01",
        createdAt: "2000-01-01", updatedAt: "2000-01-01", id: "injected", unknown: true,
      });
      assert.equal(res.status, 200);
      const updated = await storage.getTaskById(task.id);
      assert.deepEqual(updated, {
        ...task, status, version: task.version + 1,
        updatedAt: updated.updatedAt, acknowledgedAt: updated.acknowledgedAt,
      });
      assert.ok(updated.acknowledgedAt instanceof Date);
      assert.ok(updated.acknowledgedAt.getFullYear() > 2000);
      task = updated;
    }
  });

  it("saves the full admin editor body but drops community and protected columns; notifies assignment", async () => {
    const fields = {
      title: "Edited", description: "Details", ticketType: "Repair", priority: "high",
      assignedTo: users.other.id, startDate: "2026-01-01T12:00:00.000Z",
      dueDate: "2026-01-02T12:00:00.000Z", address: "Fixture address",
      windowStart: "2026-01-01", windowEnd: "2026-01-02",
      communityId: otherCommunityId, version: task.version, estimateCents: 1,
      approvedBy: users.admin.id, origin: "injected", assetId: "injected",
    };
    const res = await request("admin", fields);
    assert.equal(res.status, 200);
    for (const key of ["title", "description", "ticketType", "priority", "assignedTo", "address", "windowStart", "windowEnd"]) {
      assert.equal(res.body[key], fields[key as keyof typeof fields]);
    }
    assert.equal(res.body.startDate, fields.startDate);
    assert.equal(res.body.dueDate, fields.dueDate);
    assert.equal(res.body.communityId, communityId);
    assert.equal(res.body.estimateCents, 5000);
    assert.equal(res.body.approvedBy, null);
    assert.equal(res.body.origin, null);
    assert.equal(res.body.assetId, null);
    assert.deepEqual(notifications, [["assigned", task.id, "Edited", "Task permission fixture", users.other.id]]);
  });

  it("validates assignee existence, contractor role and community membership", async () => {
    for (const assignedTo of [users.outsider.id, users.hoa_member.id, "missing"]) {
      const res = await request("admin", { assignedTo, version: task.version });
      assert.deepEqual(res, { status: 400, body: { error: "Assignee must be a contractor with a company in this community" } });
      await unchanged();
    }
    assert.equal((await request("property_manager", { assignedTo: null, description: null, version: task.version })).status, 200);
  });

  it("allows manager edits but requires the completion form for every non-admin", async () => {
    for (const role of ["property_manager", "contractor"]) {
      assert.deepEqual(await request(role, { status: "completed", version: task.version }), {
        status: 400, body: { error: "Use the completion form to complete a task" },
      });
      await unchanged();
    }
    assert.equal((await request("admin", { status: "completed", version: task.version })).status, 200);
  });

  it("denies other-role completion and other-contractor edits/completion without writes", async () => {
    for (const role of ["hoa_member", "hoa_admin", "property_manager", "client_admin", "map_creator", "other"]) {
      const res = await request(role, { version: task.version, employeeSignOffName: "Crew" }, true);
      assert.deepEqual(res, { status: 403, body: { error: role === "other" ? "You do not have access to this task" : "Only the assigned contractor can complete this task" } });
      await unchanged();
    }
    assert.equal((await request("other", { status: "in_progress", version: task.version })).status, 403);
    await unchanged();
  });

  for (const role of ["admin", "contractor"]) {
    it(`allows ${role} completion with unchanged offline payload and notification`, async () => {
      const payload = {
        version: task.version, employeeSignOffName: "Crew", notes: "Offline notes",
        timeSpentMinutes: 30, materialsUsed: "Parts", followUpNeeded: "None",
      };
      const res = await request(role, payload, true);
      assert.equal(res.status, 200);
      assert.equal(res.body.task.status, "completed");
      for (const key of ["employeeSignOffName", "notes", "timeSpentMinutes", "materialsUsed", "followUpNeeded"]) {
        assert.equal(res.body.completion[key], payload[key as keyof typeof payload]);
      }
      assert.equal(res.body.completion.completedBy, users[role].id);
      assert.equal((await storage.getTaskCompletions(task.id)).length, 1);
      assert.equal(notifications[0][0], "completed");
    });
  }

  it("denies contractor edits and completion on an unassigned task", async () => {
    await client.query("UPDATE tasks SET assigned_to = NULL WHERE id = $1", [task.id]);
    const res = await request("contractor", { status: "in_progress", version: task.version });
    assert.equal(res.status, 403);
    assert.equal((await request("contractor", { version: task.version, employeeSignOffName: "Crew" }, true)).status, 403);
  });

  it("keeps HOA transitions, priority lock, acknowledgement notification and form completion", async () => {
    await client.query("UPDATE tasks SET origin = 'HOA', status = 'submitted' WHERE id = $1", [task.id]);
    task = await storage.getTaskById(task.id);
    assert.equal((await request("contractor", { status: "in_progress", version: task.version })).status, 400);
    assert.deepEqual(await request("contractor", { priority: "urgent", version: task.version }), {
      status: 403, body: { error: "Contractors cannot change priority on HOA requests" },
    });
    const ack = await request("contractor", { status: "acknowledged", version: task.version });
    assert.equal(ack.status, 200);
    assert.equal(ack.body.priority, task.priority);
    assert.ok(ack.body.acknowledgedAt);
    assert.deepEqual(notifications, [["acknowledged", task.id]]);
    const start = await request("contractor", { status: "in_progress", version: ack.body.version });
    assert.equal(start.status, 200);
    assert.equal((await request("contractor", { status: "pending", version: start.body.version })).status, 400);
    assert.equal((await request("admin", { status: "completed", version: start.body.version })).status, 400);
    assert.equal((await request("contractor", { employeeSignOffName: "Crew", version: start.body.version }, true)).status, 200);
  });

  it("keeps validation errors, version requirement, stale-write and stale-completion conflicts", async () => {
    assert.equal((await request("admin", { version: task.version, title: "" })).status, 400);
    assert.equal((await request("contractor", { version: task.version, status: "submitted" })).status, 400);
    assert.equal((await request("admin", { title: "No version" })).status, 400);
    assert.equal((await request("contractor", { version: task.version }, true)).status, 400);
    for (const completion of [false, true]) {
      const res = await request("contractor", {
        version: task.version - 1, status: "in_progress", employeeSignOffName: "Crew",
      }, completion);
      assert.equal(res.status, 409);
      assert.equal(res.body.code, "VERSION_CONFLICT");
      assert.equal(res.body.latestTask.id, task.id);
    }
    await unchanged();
  });

  it("storage independently strips protected keys and preserves internal completion and acknowledgement", async () => {
    const updated = await storage.updateTask(task.id, task.version, {
      status: "acknowledged", communityId: otherCommunityId, estimateCents: 1,
      approvedBy: users.other.id, id: "injected", version: 999,
      acknowledgedAt: new Date("2000-01-01"), updatedAt: new Date("2000-01-01"),
    });
    assert.deepEqual(updated, {
      ...task, status: "acknowledged", version: task.version + 1,
      updatedAt: updated.updatedAt, acknowledgedAt: updated.acknowledgedAt,
    });
    assert.ok(updated.acknowledgedAt.getFullYear() > 2000);
    assert.equal(await storage.updateTask(task.id, task.version, { status: "completed" }), null);
    assert.equal((await storage.updateTask(task.id, updated.version, { status: "completed" })).status, "completed");
  });
});
