import assert from "node:assert/strict";
import { before, beforeEach, after, afterEach, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { readRouteFixtureSource, taskFixtureImports } from "./testUtils/routeFixtureSource";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import express from "express";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const source = readRouteFixtureSource();
function between(start: string, end: string) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Missing verified boundary: ${start}`);
  return source.slice(from, to);
}
const handlers = [
  between('app.get("/api/dashboard",', 'app.get("/api/admin/migrations",'),
  between('app.get("/api/tasks/:id/link",', 'app.get("/api/map-layers",'),
  between('app.get("/api/search",', "// ── Asset Types catalogue"),
  between('app.post("/api/tasks/bulk/assign",', "// Task Schedules CRUD"),
  between('app.post("/api/hoa/requests",', 'app.get("/api/notification-preferences",'),
  between('app.post("/api/invoices",', 'app.delete("/api/invoices/:id",'),
  between('app.post("/api/contracts",', 'app.delete("/api/contracts/:id",'),
].join("\n");
const migration = readFileSync(new URL("../../../lib/db/migrations/0023_contractor_company_on_work.sql", import.meta.url), "utf8")
  .replaceAll("--> statement-breakpoint", "");
const assignmentError = "Assignee must be a contractor with a company in this community";

describe("contractor work isolation (production handlers and rollback-only PostgreSQL)", () => {
  let pool: pg.Pool, client: pg.PoolClient, server: Server, api: any, bundle: string, base: string;
  let a: string, b: string, x: any, y: any, admin: any, crew: any, other: any, colleague: any, pm: any, hoa: any;
  let noCompany: any, nonMember: any, inactive: any, task: any, unassigned: any, notifications: any[];

  before(async () => {
    assert.notEqual(process.env.NODE_ENV, "production", "Refusing production database tests");
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const built = await build({
      stdin: {
        contents: `
          ${taskFixtureImports}
          import * as storage from "./storage";
          import { commitImport } from "./contractImporter";
          import { requireAuth, requireAdmin, loadCurrentUser, isHoaRole } from "./auth";
          import { insertTaskSchema, updateTaskManagerSchema, updateTaskFieldSchema, completeTaskSchema,
            createHoaRequestSchema, insertInvoiceSchema, updateInvoiceSchema,
            insertContractSchema, updateContractSchema } from "@workspace/db";
          import multer from "multer";
          const upload = multer({ storage: multer.memoryStorage() });
          const notifyTaskAssigned = async (...args: any[]) => __notifications.push(["assigned", ...args]);
          const notifyTaskCompleted = async (...args: any[]) => __notifications.push(["completed", ...args]);
          const notifyRequestAcknowledged = async (...args: any[]) => __notifications.push(["acknowledged", ...args]);
          const notifyHoaRequestSubmitted = async (...args: any[]) => __notifications.push(["hoa", ...args]);
          class ObjectForbiddenError extends Error {}
          class ObjectNotFoundError extends Error {}
          class ObjectStorageService {
            async claimObjectForCaller() { return "/objects/fixture-photo"; }
            normalizeObjectEntityPath(p: string) { return p; }
            async getObjectEntityFile() { return {}; }
          }
          const buildCommunityAclPolicy = () => ({});
          const parseUploadURL = () => ({valid: true});
          const isUniqueViolation = () => false;
          export { storage, commitImport };
          export function setup(app: any) { app.use(loadCurrentUser); ${handlers} }
        `, resolveDir: fileURLToPath(new URL(".", import.meta.url)), loader: "ts",
      },
      bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
      plugins: [{
        name: "contractor-fixture-db",
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
    let savepoint = 0;
    // Both outer production transactions and nested importer rows are savepoints.
    database.transaction = (async (callback: (tx: any) => Promise<any>) => {
      const name = `isolation_${++savepoint}`;
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
    notifications = [];
    const module = { exports: {} as any };
    new Function("require", "module", "exports", "__db", "__pool", "__notifications", bundle)(
      require, module, module.exports, database, { query: (...args: any[]) => (client.query as any)(...args) }, notifications,
    );
    api = module.exports;
    a = (await api.storage.createCommunity({ name: "Isolation A" })).id;
    b = (await api.storage.createCommunity({ name: "Isolation B" })).id;
    x = await api.storage.createCompany(`Contractor X ${randomUUID()}`, "contractor");
    y = await api.storage.createCompany(`Contractor Y ${randomUUID()}`, "contractor");
    admin = await user("admin");
    crew = await user("contractor", { companyId: x.id });
    colleague = await user("contractor", { companyId: x.id });
    other = await user("contractor", { companyId: y.id });
    pm = await user("property_manager");
    hoa = await user("hoa_admin", { hoaCommunityId: a });
    noCompany = await user("contractor");
    nonMember = await user("contractor", { companyId: x.id });
    inactive = await user("contractor", { companyId: x.id, isActive: false });
    await api.storage.addCommunityMembers(a, [crew.id, colleague.id, other.id, pm.id, hoa.id, noCompany.id, inactive.id, admin.id]);
    task = await api.storage.createTask({ communityId: a, title: "Isolation priced task", assignedTo: crew.id,
      createdBy: admin.id, dueDate: new Date(Date.now() + 86400000) });
    await client.query("UPDATE tasks SET estimate_cents=5000 WHERE id=$1", [task.id]);
    task = await api.storage.getTaskById(task.id);
    unassigned = await api.storage.createTask({ communityId: a, title: "Isolation unassigned task", createdBy: admin.id });
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.session = { userId: req.headers["x-user"] };
      req.log = { error() {}, info() {}, warn() {} };
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
    return api.storage.createUser({ username: `isolation-${randomUUID()}`, password: "not-a-login",
      displayName: "Isolation fixture", role, ...extra });
  }
  async function request(method: string, path: string, body?: any, actor = admin) {
    const form = body instanceof FormData;
    const result = await fetch(base + path, { method,
      headers: { "x-user": actor.id, ...(form ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: form ? body : JSON.stringify(body) }) });
    return { status: result.status, body: await result.json() };
  }
  function csv(assignedTo?: string, rowAssignee?: string) {
    const form = new FormData();
    form.set("communityId", a); form.set("mode", "commit");
    if (assignedTo) form.set("assignedTo", assignedTo);
    form.set("file", new Blob([rowAssignee ? `Title,Description,assignedTo\nCSV task,Fixture,${rowAssignee}` : "Title,Description\nCSV task,Fixture"]), "tasks.csv");
    return form;
  }
  function contractBody(contractorUserId = crew.id, communityId = a) {
    return { communityId, contractorUserId, contractType: "Fixture", startDate: "2000-01-01", endDate: "2100-01-01" };
  }
  function allObjects(value: any): any[] {
    if (!value || typeof value !== "object") return [];
    return [value, ...Object.values(value).flatMap(allObjects)];
  }

  it("denies other companies, same-company colleagues and unassigned tasks on every task resource", async () => {
    const completion = await api.storage.createTaskCompletion({ taskId: task.id, completedBy: crew.id, employeeSignOffName: "Fixture" });
    for (const actor of [other, colleague]) {
      assert.deepEqual((await request("GET", `/api/tasks?communityId=${a}`, undefined, actor)).body, []);
      for (const suffix of ["", "/detail", "/completions", "/task-attachments", "/link"]) {
        assert.equal((await request("GET", `/api/tasks/${task.id}${suffix}`, undefined, actor)).status, 403);
      }
      for (const [method, path, body] of [
        ["PUT", `/api/tasks/${task.id}`, { version: task.version, status: "in_progress" }],
        ["POST", `/api/tasks/${task.id}/complete`, { version: task.version, employeeSignOffName: "Crew" }],
        ["POST", `/api/tasks/${task.id}/attachments`, { uploadURL: "fixture", idempotencyKey: randomUUID() }],
        ["GET", `/api/task-completions/${completion.id}/attachments`, undefined],
        ["POST", `/api/task-completions/${completion.id}/attachments`, { fileRef: "fixture", url: "fixture", idempotencyKey: randomUUID() }],
      ] as const) assert.equal((await request(method, path, body, actor)).status, 403);
    }
    for (const suffix of ["", "/detail", "/completions", "/task-attachments", "/link"]) {
      assert.equal((await request("GET", `/api/tasks/${unassigned.id}${suffix}`, undefined, crew)).status, 403);
    }
    assert.equal((await request("POST", `/api/tasks/${unassigned.id}/complete`, { version: 1, employeeSignOffName: "Crew" }, crew)).status, 403);
    assert.equal((await request("PUT", `/api/tasks/${unassigned.id}`, { version: 1, status: "in_progress" }, crew)).status, 403);
  });

  it("filters every list, dashboard and search and redacts nested task estimates without altering stored prices", async () => {
    const paths = [`/api/tasks?communityId=${a}`, `/api/tasks/${task.id}`, `/api/tasks/${task.id}/detail`,
      `/api/tasks/page-data?communityId=${a}`, `/api/dashboard?communityId=${a}`, `/api/dashboard/role?communityId=${a}`];
    for (const path of paths) {
      const result = await request("GET", path, undefined, crew);
      assert.equal(result.status, 200, path);
      const records = allObjects(result.body);
      assert.ok(!records.some(o => o.id === unassigned.id), path);
      const found = records.filter(o => o.id === task.id && "status" in o);
      assert.ok(found.length, path);
      for (const row of found) assert.equal(row.estimateCents, null, path);
    }
    const search = await request("GET", `/api/search?q=Isolation&types=task&communityId=${a}`, undefined, crew);
    assert.equal(search.status, 200);
    assert.deepEqual(search.body.map((r: any) => r.id), [task.id]);
    assert.equal(search.body[0].estimateCents, null);
    for (const actor of [admin, pm, hoa]) {
      const list = await request("GET", `/api/tasks?communityId=${a}`, undefined, actor);
      assert.ok(list.body.some((t: any) => t.id === unassigned.id));
      assert.equal(list.body.find((t: any) => t.id === task.id).estimateCents, 5000);
      const detail = await request("GET", `/api/tasks/${task.id}/detail`, undefined, actor);
      assert.equal(detail.body.task.estimateCents, 5000);
      for (const path of [`/api/tasks/page-data?communityId=${a}`, `/api/dashboard?communityId=${a}`, `/api/dashboard/role?communityId=${a}`]) {
        assert.equal((await request("GET", path, undefined, actor)).status, 200);
      }
    }
    assert.equal((await api.storage.getTaskById(task.id)).estimateCents, 5000);
  });

  it("cuts off assigned work and attachments immediately after membership removal, including no-community lists", async () => {
    const completion = await api.storage.createTaskCompletion({ taskId: task.id, completedBy: crew.id, employeeSignOffName: "Crew" });
    await api.storage.removeCommunityMember(a, crew.id);
    assert.deepEqual(await api.storage.getTasksForUser(crew.id), []);
    assert.deepEqual((await request("GET", "/api/tasks", undefined, crew)).body, []);
    for (const path of [`/api/tasks/${task.id}`, `/api/tasks/${task.id}/detail`,
      `/api/tasks/${task.id}/completions`, `/api/tasks/${task.id}/task-attachments`, `/api/tasks/${task.id}/link`,
      `/api/task-completions/${completion.id}/attachments`, `/api/tasks?communityId=${a}`,
      `/api/tasks/page-data?communityId=${a}`, `/api/dashboard?communityId=${a}`,
      `/api/dashboard/role?communityId=${a}`, `/api/search?q=Isolation&communityId=${a}`]) {
      assert.equal((await request("GET", path, undefined, crew)).status, 403, path);
    }
    assert.equal((await request("POST", `/api/tasks/${task.id}/complete`, {version: 1, employeeSignOffName: "Crew"}, crew)).status, 403);
    assert.equal((await request("PUT", `/api/tasks/${task.id}`, {version: 1, status: "in_progress"}, crew)).status, 403);
    assert.equal((await request("POST", `/api/tasks/${task.id}/attachments`, {}, crew)).status, 403);
    assert.equal((await request("POST", `/api/task-completions/${completion.id}/attachments`, {}, crew)).status, 403);
  });

  it("validates all five assignment entry points against inactive, companyless, nonmember and noncontractor users", async () => {
    for (const assignee of [noCompany, nonMember, admin, inactive, {id: "missing"}]) {
      for (const [method, path, body, actor] of [
        ["POST", "/api/tasks", { communityId: a, title: "Invalid", assignedTo: assignee.id }, admin],
        ["PUT", `/api/tasks/${task.id}`, { version: task.version, assignedTo: assignee.id }, pm],
        ["POST", "/api/tasks/bulk/assign", { taskIds: [task.id], assignedTo: assignee.id }, admin],
        ["POST", "/api/tasks/import-csv", csv(assignee.id), admin],
        ["POST", "/api/hoa/requests", { title: "Invalid", description: "Fixture", priority: "General", assignedTo: assignee.id }, hoa],
      ] as const) {
        const result = await request(method, path, body, actor);
        assert.deepEqual(result, { status: 400, body: { error: assignmentError } }, path);
      }
      assert.deepEqual(await request("POST", "/api/tasks/import-csv", csv(undefined, assignee.id)),
        {status: 400, body: {error: assignmentError}});
    }
    assert.equal((await api.storage.getTaskById(task.id)).assignedTo, crew.id);
  });

  it("rejects cross-company reassignment, allows explicit manager transfer and clears incompatible crew atomically", async () => {
    const rejected = await request("PUT", `/api/tasks/${task.id}`, { version: 1, assignedTo: other.id });
    assert.deepEqual(rejected, { status: 400, body: { error: "Assignee works for a different contractor" } });
    const bulk = await request("POST", "/api/tasks/bulk/assign", { taskIds: [unassigned.id, task.id], assignedTo: other.id });
    assert.equal(bulk.status, 400);
    assert.equal((await api.storage.getTaskById(unassigned.id)).assignedTo, null);
    const transferred = await request("PUT", `/api/tasks/${task.id}`, { version: 1, assignedTo: other.id, contractorCompanyId: y.id }, pm);
    assert.equal(transferred.status, 200);
    assert.equal(transferred.body.assignedTo, other.id);
    assert.equal(transferred.body.contractorCompanyId, y.id);
    const cleared = await request("PUT", `/api/tasks/${task.id}`, { version: 2, contractorCompanyId: x.id });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.assignedTo, null);
    assert.equal(cleared.body.contractorCompanyId, x.id);
    assert.equal((await request("PUT", `/api/tasks/${task.id}`, { version: 1, contractorCompanyId: y.id })).status, 409);
    const assigned = await request("POST", "/api/tasks/bulk/assign", { taskIds: [unassigned.id], assignedTo: crew.id });
    assert.equal(assigned.status, 200);
    assert.equal((await api.storage.getTaskById(unassigned.id)).contractorCompanyId, x.id);
    const adopted = await request("PUT", `/api/tasks/${unassigned.id}`, { version: 2, contractorCompanyId: y.id, assignedTo: other.id }, pm);
    assert.equal(adopted.status, 200);
    assert.equal(adopted.body.assignedTo, other.id);
  });

  it("uses one resolver across ordinary, HOA, CSV, instance-key and direct importer task creation", async () => {
    await api.storage.createContract(contractBody());
    const ordinary = await request("POST", "/api/tasks", { communityId: a, title: "Default", unknownMobileField: true });
    assert.equal(ordinary.status, 201);
    assert.equal(ordinary.body.contractorCompanyId, x.id);
    const hoaResult = await request("POST", "/api/hoa/requests", { title: "HOA", description: "Fixture", priority: "General", extra: true }, hoa);
    assert.equal(hoaResult.status, 201);
    assert.equal(hoaResult.body.contractorCompanyId, x.id);
    assert.equal(notifications.filter(n => n[0] === "hoa").length, 1);
    const generated = await api.storage.createTaskWithInstanceKey({ communityId: a, title: "Generated", createdBy: admin.id, scheduleInstanceKey: randomUUID() });
    assert.equal(generated.contractorCompanyId, x.id);
    const imported = await request("POST", "/api/tasks/import-csv", csv());
    assert.equal(imported.status, 200);
    assert.equal((await api.storage.getTaskById(imported.body.created[0].id)).contractorCompanyId, x.id);
    const fingerprint = randomUUID();
    const importResult = await api.commitImport([{ action: "create", title: "Direct import", priority: "medium",
      windowStart: "2026-01-01", windowEnd: "2026-12-31", fingerprint }], null, a, admin.id, "medium");
    assert.equal(importResult.createdCount, 1);
    assert.equal((await client.query("SELECT contractor_company_id FROM tasks WHERE import_fingerprint=$1", [fingerprint])).rows[0].contractor_company_id, x.id);
    const explicit = await request("POST", "/api/tasks", { communityId: a, title: "Explicit", contractorCompanyId: y.id });
    assert.equal(explicit.body.contractorCompanyId, y.id);
    const assigned = await request("POST", "/api/tasks", { communityId: a, title: "Assignee first", assignedTo: other.id, contractorCompanyId: x.id });
    assert.equal(assigned.body.contractorCompanyId, y.id);
    const csvAssigned = await request("POST", "/api/tasks/import-csv", csv(undefined, other.id));
    assert.equal(csvAssigned.body.createdCount, 1);
    assert.equal((await api.storage.getTaskById(csvAssigned.body.created[0].id)).contractorCompanyId, y.id);
    const hoaAssigned = await request("POST", "/api/hoa/requests", {
      title: "Assigned HOA", description: "Fixture", priority: "General", assignedTo: other.id,
    }, hoa);
    assert.equal(hoaAssigned.status, 201); assert.equal(hoaAssigned.body.contractorCompanyId, y.id);
    await api.storage.createContract(contractBody(other.id));
    assert.equal(await api.storage.resolveTaskContractorCompany(a), null);
    assert.equal(await api.storage.resolveTaskContractorCompany(b), null);
    await assert.rejects(api.storage.resolveTaskContractorCompany(a, noCompany.id), { message: "Assignee must be a contractor with a company" });
    await assert.rejects(api.storage.resolveTaskContractorCompany(a, admin.id), { message: "Assignee must be a contractor with a company" });
  });

  it("keeps importer partial success with nested savepoints and rolls back schedule and task writes on an outer failure", async () => {
    await api.storage.createContract(contractBody());
    const preview = (title: string, action = "create") => ({ action, title, priority: "medium", fingerprint: randomUUID(),
      windowStart: "2026-01-01", windowEnd: "2026-12-31" });
    const result = await api.commitImport([preview("Good"), { ...preview("Bad"), priority: "invalid_enum" }, preview("Good after error")],
      { action: "create", dayOfWeek: 1, seasonStart: null, seasonEnd: null }, a, admin.id, "medium");
    assert.equal(result.createdCount, 2); assert.equal(result.errorCount, 1);
    assert.equal((await client.query("SELECT count(*) FROM service_schedules WHERE id=$1", [result.scheduleResult.id])).rows[0].count, "1");
    await assert.rejects(api.commitImport([null], { action: "create", dayOfWeek: 2, seasonStart: null, seasonEnd: null }, a, admin.id, "medium"));
    assert.equal((await client.query("SELECT count(*) FROM service_schedules WHERE community_id=$1", [a])).rows[0].count, "1");
  });

  it("rejects inactive and management companies on task and invoice writes without granting crew company control", async () => {
    const management = await api.storage.createCompany(`Management ${randomUUID()}`, "management_company");
    await api.storage.updateCompany(y.id, { isActive: false });
    for (const id of [management.id, y.id, "missing"]) {
      for (const [method, path, body] of [
        ["POST", "/api/tasks", { communityId: a, title: "Bad company", contractorCompanyId: id }],
        ["PUT", `/api/tasks/${task.id}`, { version: task.version, contractorCompanyId: id }],
        ["POST", "/api/invoices", { communityId: a, contractor: "Fixture", completionDate: "2026-11-01", serviceType: "Fixture", cost: 1, contractorCompanyId: id }],
      ] as const) assert.equal((await request(method, path, body)).status, 400);
    }
    const result = await request("PUT", `/api/tasks/${task.id}`, {version: 1, status: "in_progress", contractorCompanyId: y.id}, crew);
    assert.equal(result.status, 200);
    assert.equal(result.body.contractorCompanyId, x.id);
    assert.equal(result.body.estimateCents, null);
  });

  it("derives contract ownership on create and update and preserves the active string-ID notification API", async () => {
    assert.deepEqual(await request("POST", "/api/contracts", contractBody(noCompany.id)),
      { status: 400, body: { error: "Contractor must have a company" } });
    const created = await request("POST", "/api/contracts", { ...contractBody(), contractorCompanyId: y.id, extra: true });
    assert.equal(created.status, 201); assert.equal(created.body.contractorCompanyId, x.id);
    assert.equal((await api.storage.getContracts(a))[0].contractorCompanyId, x.id);
    let ids = await api.storage.getActiveContractorUserIdsForCommunity(a);
    assert.deepEqual(ids, [crew.id]);
    const updated = await request("PUT", `/api/contracts/${created.body.id}`, { contractorUserId: other.id });
    assert.equal(updated.status, 200); assert.equal(updated.body.contractorCompanyId, y.id);
    assert.equal((await request("PUT", `/api/contracts/${created.body.id}`, {contractorUserId: noCompany.id})).status, 400);
    await api.storage.createContract(contractBody(other.id));
    ids = await api.storage.getActiveContractorUserIdsForCommunity(a);
    assert.deepEqual(ids, [other.id]); // distinct, even with two contracts
    await client.query("UPDATE contracts SET end_date='2000-01-01' WHERE community_id=$1", [a]);
    assert.deepEqual(await api.storage.getActiveContractorUserIdsForCommunity(a), []);
    await client.query("UPDATE contracts SET end_date='2100-01-01', start_date='2099-01-01' WHERE community_id=$1", [a]);
    assert.deepEqual(await api.storage.getActiveContractorUserIdsForCommunity(a), []);
    await client.query("UPDATE contracts SET start_date='2000-01-01', is_active=false WHERE community_id=$1", [a]);
    assert.deepEqual(await api.storage.getActiveContractorUserIdsForCommunity(a), []);
    await client.query("UPDATE contracts SET is_active=true WHERE community_id=$1", [a]);
    await client.query("UPDATE users SET is_active=false WHERE id=$1", [other.id]);
    assert.deepEqual(await api.storage.getActiveContractorUserIdsForCommunity(a), []);
    await client.query("UPDATE users SET is_active=true,role='admin' WHERE id=$1", [other.id]);
    assert.deepEqual(await api.storage.getActiveContractorUserIdsForCommunity(a), []);
  });

  it("links normalized invoice names on create, validates updates and preserves free text and existing links", async () => {
    // Free the well-known normalized name if already seeded; this test owns its
    // company fixture and rolls this change back without depending on seed data.
    await client.query("UPDATE companies SET normalized_name=$1 WHERE normalized_name='high plains property maintenance'", [`away-${randomUUID()}`]);
    const company = await api.storage.createCompany("High Plains Property Maintenance", "contractor");
    const body = { communityId: a, contractor: "High Plains Property Maintenance, LLC", completionDate: "2026-11-01", serviceType: "Fixture", cost: 50, extra: true };
    const created = await request("POST", "/api/invoices", body);
    assert.equal(created.status, 201); assert.equal(created.body.contractorCompanyId, company.id);
    assert.equal(created.body.contractor, body.contractor);
    const updated = await request("PUT", `/api/invoices/${created.body.id}`, { contractorCompanyId: y.id, contractor: "Text stays independent" });
    assert.equal(updated.status, 200); assert.equal(updated.body.contractorCompanyId, y.id);
    const textOnly = await request("PUT", `/api/invoices/${created.body.id}`, { contractor: "Unmatched text" });
    assert.equal(textOnly.body.contractorCompanyId, y.id);
    const unmatched = await request("POST", "/api/invoices", { ...body, contractor: "No matching company" });
    assert.equal(unmatched.body.contractorCompanyId, null);
    const explicit = await request("POST", "/api/invoices", { ...body, contractorCompanyId: x.id });
    assert.equal(explicit.body.contractorCompanyId, x.id);
    assert.equal((await request("PUT", `/api/invoices/${created.body.id}`, {contractorCompanyId: "missing"})).status, 400);
    for (const actor of [crew, other]) {
      assert.equal((await request("POST", "/api/invoices", body, actor)).status, 403);
      assert.equal((await request("POST", "/api/contracts", contractBody(), actor)).status, 403);
    }
  });

  it("preserves crew lifecycle, photo attachment, offline completion, conflict redaction and task-completion binding", async () => {
    await client.query("UPDATE tasks SET origin='HOA',status='submitted' WHERE id=$1", [task.id]);
    let version = 1;
    for (const status of ["acknowledged", "in_progress"]) {
      const result = await request("PUT", `/api/tasks/${task.id}`, {version, status, contractorCompanyId: y.id, extraInstalledField: true}, crew);
      assert.equal(result.status, 200); assert.equal(result.body.estimateCents, null); version = result.body.version;
    }
    const photo = await request("POST", `/api/tasks/${task.id}/attachments`, { uploadURL: "fixture", idempotencyKey: randomUUID() }, crew);
    assert.equal(photo.status, 201);
    assert.equal((await request("GET", `/api/tasks/${task.id}/task-attachments`, undefined, crew)).body.length, 1);
    const completionConflict = await request("POST", `/api/tasks/${task.id}/complete`, {version: 1, employeeSignOffName: "Crew"}, crew);
    assert.equal(completionConflict.status, 409); assert.equal(completionConflict.body.latestTask.estimateCents, null);
    const completed = await request("POST", `/api/tasks/${task.id}/complete`, {
      version, employeeSignOffName: "Offline crew", notes: "Queued offline", timeSpentMinutes: 30, unknown: true,
    }, crew);
    assert.equal(completed.status, 200); assert.equal(completed.body.task.estimateCents, null);
    assert.equal(completed.body.completion.notes, "Queued offline");
    const attachment = await request("POST", `/api/task-completions/${completed.body.completion.id}/attachments`, {
      fileRef: "fixture", url: "fixture", idempotencyKey: randomUUID(),
    }, crew);
    assert.equal(attachment.status, 201);
    const conflict = await request("PUT", `/api/tasks/${task.id}`, {version: 1}, crew);
    assert.equal(conflict.status, 409); assert.equal(conflict.body.latestTask.estimateCents, null);
    const foreignCompletion = await api.storage.createTaskCompletion({ taskId: unassigned.id, completedBy: admin.id, employeeSignOffName: "Admin" });
    assert.equal((await request("POST", `/api/tasks/${task.id}/attachments`, {
      taskCompletionId: foreignCompletion.id, uploadURL: "fixture", idempotencyKey: randomUUID(),
    }, crew)).status, 403);
    assert.equal((await api.storage.getTaskById(task.id)).estimateCents, 5000);
    assert.equal(notifications.filter(n => n[0] === "acknowledged").length, 1);
    assert.equal(notifications.filter(n => n[0] === "completed").length, 1);
    const page = await request("GET", `/api/tasks/page-data?communityId=${a}`, undefined, crew);
    const recent = page.body.recentCompletions.find((row: any) => row.id === task.id);
    assert.ok(recent); assert.equal(recent.estimateCents, null);
  });

  it("rolls back completion status when its second-table insert fails", async () => {
    await assert.rejects(api.storage.completeTaskAtomically(task.id, 1, { completedBy: "missing", employeeSignOffName: "Crew" }));
    assert.equal((await api.storage.getTaskById(task.id)).status, "pending");
    assert.deepEqual(await api.storage.getTaskCompletions(task.id), []);
  });

  it("runs an empty migration twice and backfills null-only ownership with all seven counts", async () => {
    const schema = `isolation_migration_${randomUUID().replaceAll("-", "")}`;
    await client.query(`CREATE SCHEMA "${schema}"; SET LOCAL search_path TO "${schema}";
      CREATE TABLE companies(id varchar PRIMARY KEY, normalized_name text, kind text);
      CREATE TABLE users(id varchar PRIMARY KEY, role text, company_id varchar);
      CREATE TABLE contracts(id varchar PRIMARY KEY, community_id varchar, contractor_user_id varchar, is_active boolean);
      CREATE TABLE tasks(id varchar PRIMARY KEY, community_id varchar, assigned_to varchar);
      CREATE TABLE invoices(id varchar PRIMARY KEY, contractor text);`);
    const isolated = migration.replaceAll('"public"', `"${schema}"`);
    const notices: string[] = [];
    const listener = (notice: {message?: string}) => { if (notice.message?.startsWith("F2a counts:")) notices.push(notice.message); };
    client.on("notice", listener);
    try {
      const zero = "F2a counts: contracts labeled=0, contracts left null=0, tasks labeled from assignee=0, tasks labeled from contracts=0, tasks left null=0, invoices labeled=0, invoices left null=0";
      await client.query(isolated); assert.equal(notices.at(-1), zero);
      await client.query(isolated); assert.equal(notices.at(-1), zero);
      await client.query(`INSERT INTO companies VALUES ('x','high plains property maintenance','contractor'),('y','a and b','contractor'),('m','management','management_company');
        INSERT INTO users VALUES ('crew','contractor','x'),('other','contractor','y'),('admin','admin','x'),('none','contractor',null);
        INSERT INTO contracts(id,community_id,contractor_user_id,is_active) VALUES
          ('single','a','crew',true),('same','a','crew',true),('mixed-x','b','crew',true),('mixed-y','b','other',true),
          ('inactive','a','other',false),('unknown','c','none',true);
        INSERT INTO tasks(id,community_id,assigned_to) VALUES ('assigned','b','crew'),('single','a',null),('mixed','b',null),('none','c',null),('admin','a','admin');
        INSERT INTO tasks(id,community_id,assigned_to,contractor_company_id) VALUES ('preserved','a','crew','y');
        INSERT INTO invoices(id,contractor) VALUES ('match','High Plains Property Maintenance, LLC'),('ampersand',' A & B, Inc. '),('unmatched','No match'),('management','Management');
        INSERT INTO invoices(id,contractor,contractor_company_id) VALUES ('preserved','High Plains Property Maintenance, LLC','y');`);
      await client.query(isolated);
      assert.equal(notices.at(-1), "F2a counts: contracts labeled=5, contracts left null=1, tasks labeled from assignee=1, tasks labeled from contracts=1, tasks left null=3, invoices labeled=2, invoices left null=2");
      const rows = (await client.query("SELECT id,contractor_company_id FROM tasks ORDER BY id")).rows;
      assert.equal(rows.find(r => r.id === "assigned").contractor_company_id, "x");
      assert.equal(rows.find(r => r.id === "single").contractor_company_id, "x");
      assert.equal(rows.find(r => r.id === "mixed").contractor_company_id, null);
      assert.equal(rows.find(r => r.id === "preserved").contractor_company_id, "y");
      await client.query("UPDATE users SET company_id='y' WHERE id='crew'");
      await client.query(isolated);
      assert.equal(notices.at(-1), "F2a counts: contracts labeled=0, contracts left null=1, tasks labeled from assignee=0, tasks labeled from contracts=0, tasks left null=3, invoices labeled=0, invoices left null=2");
      assert.equal((await client.query("SELECT contractor_company_id FROM invoices WHERE id='preserved'")).rows[0].contractor_company_id, "y");
      assert.equal((await client.query("SELECT contractor_company_id FROM contracts WHERE id='single'")).rows[0].contractor_company_id, "x");
      for (const table of ["tasks", "contracts", "invoices"]) {
        assert.ok((await client.query("SELECT indexname FROM pg_indexes WHERE schemaname=$1 AND tablename=$2", [schema, table])).rows.some(r => r.indexname === `${table}_contractor_company_id_idx`));
      }
      const restrictions = await client.query(`SELECT conrelid::regclass::text AS table_name,confdeltype
        FROM pg_constraint WHERE connamespace=$1::regnamespace AND conname LIKE '%contractor_company_id_companies_id_fk'`, [schema]);
      assert.equal(restrictions.rows.length, 3);
      assert.ok(restrictions.rows.every(r => r.confdeltype === "r"));
      await client.query("SAVEPOINT restricted_delete");
      await assert.rejects(client.query("DELETE FROM companies WHERE id='x'"), (error: any) => error.code === "23503");
      await client.query("ROLLBACK TO SAVEPOINT restricted_delete; RELEASE SAVEPOINT restricted_delete");
    } finally { client.removeListener("notice", listener); }
  });
});
