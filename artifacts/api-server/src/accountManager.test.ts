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

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("./routes/routes.ts", import.meta.url), "utf8");
function between(start: string, end: string) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Missing verified boundary: ${start}`);
  return source.slice(from, to);
}
const handlers = [
  between('app.get("/objects/{*objectPath}",', 'app.post("/api/objects/upload",'),
  between('app.get("/api/communities/:id/crew",', 'app.get("/api/communities/:id/controllers",'),
  between('app.get("/api/dashboard",', 'app.get("/api/admin/migrations",'),
  between('app.get("/api/tasks/:id/link",', 'app.get("/api/map-layers",'),
  between('app.put("/api/users/:id/role",', 'app.get("/api/assets",'),
  between('app.get("/api/assets/:id/history",', 'app.get("/api/assets/:id/attachments",'),
  between('app.get("/api/search",', "// ── Asset Types catalogue"),
  between('app.get("/api/communities/:communityId/offline-pack-data",', "// Task Templates CRUD"),
  between('app.post("/api/tasks/bulk/assign",', "// CSV Task Import"),
  between("const invoiceReadRoles =", 'app.post("/api/contracts",'),
  between('app.post("/api/contracts",', 'app.delete("/api/contracts/:id",'),
].join("\n");
const companyValidation = between("async function companySelectionError(", "function companyUniqueConflict(");
const migration = readFileSync(new URL("../../../lib/db/migrations/0024_contractor_manager_role.sql", import.meta.url), "utf8");

describe("account managers (real handlers and isolated PostgreSQL fixtures)", () => {
  let pool: pg.Pool, client: pg.PoolClient, server: Server, api: any, bundle: string, base: string;
  let a: string, b: string, c: string, x: any, y: any, management: any, manager: any, admin: any;
  let crew: any, colleague: any, other: any, inactive: any, outsider: any, pm: any, hoa: any, commercial: any;
  let task: any, unassigned: any, foreign: any, outside: any, noOwner: any;
  before(async () => {
    assert.notEqual(process.env.NODE_ENV, "production", "Refusing production database tests");
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    // Each query is committed separately, before any manager fixture is inserted.
    await pool.query(migration);
    await pool.query(migration);
    const built = await build({
      stdin: {
        contents: `
          import * as storage from "./storage";
          import { requireAuth, requireAdmin, requireAdminOrMapCreator, loadCurrentUser, enforceHoaScoping, enforceOrgScoping,
            isHoaRole, isClientRole, isMapCreatorRole, isContractorSide } from "./auth";
          import { insertTaskSchema, updateTaskManagerSchema, updateTaskFieldSchema, completeTaskSchema,
            insertInvoiceSchema, updateInvoiceSchema, insertContractSchema, updateContractSchema,
            userRoleEnum } from "@workspace/db";
          import bcrypt from "bcryptjs";
          const checkHoaLimits = async () => null;
          const notifyTaskAssigned = async () => {};
          const notifyTaskCompleted = async () => {};
          const notifyRequestAcknowledged = async () => {};
          class ObjectForbiddenError extends Error {}
          class ObjectNotFoundError extends Error {}
          class ObjectStorageService {
            async claimObjectForCaller() { return "/objects/fixture-photo"; }
            normalizeObjectEntityPath(p: string) { return p; }
            async getObjectEntityFile() { return {}; }
            async canAccessObjectEntity() { return true; }
            downloadObject(_file: any, res: any) { res.json({ downloaded: true }); }
          }
          const ObjectPermission = { READ: "read" };
          const buildCommunityAclPolicy = () => ({});
          const parseUploadURL = () => ({ valid: true });
          const getAssetTypeCache = async () => [];
          ${companyValidation}
          export { storage };
          export function setup(app: any) {
            app.use(loadCurrentUser); app.use(enforceHoaScoping); app.use(enforceOrgScoping);
            ${handlers}
          }
        `, resolveDir: fileURLToPath(new URL(".", import.meta.url)), loader: "ts",
      },
      bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
      plugins: [{
        name: "account-manager-fixture-db",
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
    database.transaction = (async (callback: (tx: any) => Promise<any>) => {
      const name = `manager_${++savepoint}`;
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
    new Function("require", "module", "exports", "__db", "__pool", bundle)(
      require, module, module.exports, database, { query: (...args: any[]) => (client.query as any)(...args) },
    );
    api = module.exports;
    a = (await api.storage.createCommunity({ name: "Manager A" })).id;
    b = (await api.storage.createCommunity({ name: "Manager B" })).id;
    c = (await api.storage.createCommunity({ name: "Manager C" })).id;
    x = await api.storage.createCompany(`Manager X ${randomUUID()}`, "contractor");
    y = await api.storage.createCompany(`Manager Y ${randomUUID()}`, "contractor");
    management = await api.storage.createCompany(`Management ${randomUUID()}`, "management_company");
    admin = await user("admin");
    manager = await user("contractor_manager", { companyId: x.id });
    crew = await user("contractor", { companyId: x.id });
    colleague = await user("contractor", { companyId: x.id });
    other = await user("contractor", { companyId: y.id });
    inactive = await user("contractor", { companyId: x.id, isActive: false });
    outsider = await user("contractor", { companyId: x.id });
    pm = await user("property_manager");
    hoa = await user("hoa_admin", { hoaCommunityId: a });
    const org = await api.storage.createOrganization({ name: "Manager org" });
    commercial = await user("client_admin", { organizationId: org.id });
    await api.storage.addCommunityMembers(a, [manager.id, crew.id, colleague.id, other.id, inactive.id, pm.id, hoa.id]);
    await api.storage.addCommunityMembers(c, [manager.id]);
    task = await makeTask(a, x.id, crew.id);
    unassigned = await makeTask(a, x.id);
    foreign = await makeTask(a, y.id, other.id);
    outside = await makeTask(b, x.id);
    noOwner = await makeTask(a);
    await client.query("UPDATE tasks SET estimate_cents=5000 WHERE id=$1", [task.id]);
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.session = { userId: req.headers["x-user"], destroy(cb: any) { cb(); } };
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
    return api.storage.createUser({ username: `manager-${randomUUID()}`, password: "not-a-login",
      displayName: "Manager fixture", role, ...extra });
  }
  async function makeTask(communityId: string, contractorCompanyId?: string, assignedTo?: string) {
    return api.storage.createTask({ communityId, contractorCompanyId, assignedTo,
      title: `Manager task ${randomUUID()}`, createdBy: admin.id, dueDate: new Date(Date.now() + 86400000) });
  }
  async function request(method: string, path: string, body?: any, actor = manager) {
    const result = await fetch(base + path, { method,
      headers: { "x-user": actor.id, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: result.status, body: result.status === 204 ? null : await result.json() };
  }
  function records(value: any): any[] {
    return !value || typeof value !== "object" ? [] : [value, ...Object.values(value).flatMap(records)];
  }
  function invoiceBody(extra = {}) {
    return { communityId: a, contractor: "Untrusted name", completionDate: "2026-11-01", serviceType: "Fixture", cost: 50, ...extra };
  }
  async function invoice(companyId = x.id, communityId = a, status = "draft") {
    return api.storage.createInvoice(invoiceBody({ contractorCompanyId: companyId, communityId, status }));
  }
  const collectionPaths = (id: string) => [`/api/tasks?communityId=${id}`, `/api/tasks/page-data?communityId=${id}`,
    `/api/dashboard?communityId=${id}`, `/api/dashboard/role?communityId=${id}`, `/api/search?q=Manager&types=task&communityId=${id}`];

  it("runs the enum-only migration twice and keeps metadata limited to the role", async () => {
    assert.equal(migration.trim(), `ALTER TYPE "user_role" ADD VALUE IF NOT EXISTS 'contractor_manager';`);
    await client.query(migration); await client.query(migration);
    const result = await client.query("SELECT enumlabel FROM pg_enum JOIN pg_type ON pg_type.oid=enumtypid WHERE typname='user_role'");
    assert.equal(result.rows.filter(r => r.enumlabel === "contractor_manager").length, 1);
    const previous = JSON.parse(readFileSync(new URL("../../../lib/db/migrations/meta/0023_snapshot.json", import.meta.url), "utf8"));
    const next = JSON.parse(readFileSync(new URL("../../../lib/db/migrations/meta/0024_snapshot.json", import.meta.url), "utf8"));
    assert.equal(next.prevId, previous.id);
    assert.deepEqual(next.tables, previous.tables);
    next.enums["public.user_role"].values = next.enums["public.user_role"].values.filter((v: string) => v !== "contractor_manager");
    assert.deepEqual(next.enums, previous.enums);
  });
  it("requires a contractor-kind company when creating an account manager", async () => {
    const body = { username: `created-${randomUUID()}`, password: "fixture-password", role: "contractor_manager" };
    for (const companyId of [undefined, null, ""]) {
      assert.deepEqual(await request("POST", "/api/admin/users", { ...body, companyId }, admin),
        { status: 400, body: { error: "Account managers must have a contractor company" } });
    }
    assert.deepEqual(await request("POST", "/api/admin/users", { ...body, companyId: management.id }, admin),
      { status: 400, body: { error: "Company type does not match the user's role" } });
    const created = await request("POST", "/api/admin/users", { ...body, companyId: x.id, installedExtra: true }, admin);
    assert.equal(created.status, 201); assert.equal(created.body.companyId, x.id);
  });
  it("preserves company and community rows across both contractor role transitions", async () => {
    const memberships = await api.storage.getUserCommunities(crew.id);
    for (const role of ["contractor_manager", "contractor"]) {
      const result = await request("PUT", `/api/users/${crew.id}/role`, { role }, admin);
      assert.equal(result.status, 200); assert.equal(result.body.companyId, x.id);
      assert.deepEqual(await api.storage.getUserCommunities(crew.id), memberships);
    }
    assert.equal((await request("PUT", `/api/users/${pm.id}/role`, { role: "contractor_manager" }, admin)).status, 400);
    assert.equal((await request("PATCH", `/api/admin/users/${manager.id}`, { companyId: null }, admin)).status, 400);
  });
  it("shows assigned and unassigned company work across all lists, dashboards and search", async () => {
    for (const path of collectionPaths(a)) {
      const result = await request("GET", path);
      assert.equal(result.status, 200, path);
      const ids = records(result.body).map(r => r.id);
      assert.ok(ids.includes(task.id), path); assert.ok(ids.includes(unassigned.id), path);
      for (const denied of [foreign, outside, noOwner]) assert.ok(!ids.includes(denied.id), path);
    }
    assert.equal((await request("GET", `/api/tasks/${foreign.id}`)).status, 403);
    const more = await makeTask(c, x.id);
    const all = await request("GET", "/api/tasks");
    assert.ok(all.body.some((t: any) => t.id === more.id));
  });
  it("refuses company work outside current community membership", async () => {
    for (const path of [...collectionPaths(b), `/api/tasks/${outside.id}`]) {
      assert.equal((await request("GET", path)).status, 403, path);
    }
    assert.ok(!(await api.storage.getTasksForUser(manager.id)).some((t: any) => t.id === outside.id));
  });
  it("returns manager estimates without changing crew redaction", async () => {
    for (const path of [`/api/tasks/${task.id}`, `/api/tasks/${task.id}/detail`, `/api/tasks?communityId=${a}`]) {
      for (const [actor, price] of [[manager, 5000], [crew, null]]) {
        const result = await request("GET", path, undefined, actor);
        const row = records(result.body).find(r => r.id === task.id && "status" in r);
        assert.equal(row.estimateCents, price);
      }
    }
    assert.equal((await api.storage.getTaskById(task.id)).estimateCents, 5000);
  });
  it("forces task creation ownership and strips unknown fields", async () => {
    const result = await request("POST", "/api/tasks", { communityId: a, title: "Own task",
      contractorCompanyId: y.id, status: "completed", estimateCents: 999, installedExtra: true });
    assert.equal(result.status, 201); assert.equal(result.body.contractorCompanyId, x.id);
    assert.equal(result.body.status, "pending"); assert.equal(result.body.estimateCents, null);
    assert.equal((await request("POST", "/api/tasks", { communityId: b, title: "Outside" })).status, 403);
  });
  it("assigns only active same-company crew in the task community on create and edit", async () => {
    const companyless = await user("contractor");
    await api.storage.addCommunityMembers(a, [companyless.id]);
    for (const assignee of [other, outsider, inactive, companyless, pm, manager, { id: "missing" }]) {
      assert.equal((await request("POST", "/api/tasks", { communityId: a, title: "Bad crew", assignedTo: assignee.id })).status, 400);
      assert.equal((await request("PUT", `/api/tasks/${task.id}`, { version: 1, assignedTo: assignee.id })).status, 400);
    }
    const created = await request("POST", "/api/tasks", { communityId: a, title: "Crew task", assignedTo: crew.id });
    assert.equal(created.status, 201); assert.equal(created.body.contractorCompanyId, x.id);
    const edited = await request("PUT", `/api/tasks/${task.id}`, { version: 1, assignedTo: colleague.id });
    assert.equal(edited.status, 200); assert.equal(edited.body.assignedTo, colleague.id);
  });
  it("ignores task company tampering while enforcing completion and version rules", async () => {
    const result = await request("PUT", `/api/tasks/${task.id}`, { version: 1, contractorCompanyId: y.id,
      title: "Edited by manager", installedExtra: true });
    assert.equal(result.status, 200); assert.equal(result.body.contractorCompanyId, x.id);
    assert.equal((await request("PUT", `/api/tasks/${task.id}`, { version: 2, status: "completed" })).status, 400);
    assert.equal((await request("PUT", `/api/tasks/${task.id}`, { version: 1, title: "Conflict" })).status, 409);
    assert.equal((await request("PUT", `/api/tasks/${foreign.id}`, { version: 1, title: "Forbidden" })).status, 403);
  });
  it("completes unassigned company tasks atomically and preserves HOA lifecycle", async () => {
    const completed = await request("POST", `/api/tasks/${unassigned.id}/complete`, {
      version: 1, employeeSignOffName: "Account manager", notes: "Office completion", extra: true });
    assert.equal(completed.status, 200); assert.equal(completed.body.task.status, "completed");
    assert.equal(completed.body.completion.completedBy, manager.id);
    await assert.rejects(api.storage.completeTaskAtomically(task.id, 1, { completedBy: "missing", employeeSignOffName: "Fixture" }));
    assert.equal((await api.storage.getTaskById(task.id)).status, "pending");
    await client.query("UPDATE tasks SET origin='HOA', status='submitted' WHERE id=$1", [task.id]);
    assert.equal((await request("POST", `/api/tasks/${task.id}/complete`, { version: 1, employeeSignOffName: "Manager" })).status, 400);
    assert.equal((await request("PUT", `/api/tasks/${task.id}`, { version: 1, status: "acknowledged" })).status, 200);
    assert.equal((await request("POST", `/api/tasks/${task.id}/complete`, { version: 2, employeeSignOffName: "Manager" })).status, 200);
    assert.equal((await request("POST", `/api/tasks/${foreign.id}/complete`, { version: 1, employeeSignOffName: "Manager" })).status, 403);
  });
  it("rejects mixed-company, nonmember and missing-task bulk requests without partial changes", async () => {
    for (const denied of [foreign, outside, { id: "missing" }]) {
      const result = await request("POST", "/api/tasks/bulk/assign", { taskIds: [unassigned.id, denied.id], assignedTo: crew.id });
      assert.equal(result.status, 403);
      assert.equal((await api.storage.getTaskById(unassigned.id)).assignedTo, null);
    }
    for (const assignee of [other, outsider, inactive]) {
      assert.equal((await request("POST", "/api/tasks/bulk/assign", {
        taskIds: [task.id, unassigned.id], assignedTo: assignee.id })).status, 400);
      assert.equal((await api.storage.getTaskById(unassigned.id)).assignedTo, null);
    }
    assert.equal((await request("POST", "/api/tasks/bulk/assign", {
      taskIds: [task.id, unassigned.id], assignedTo: colleague.id })).status, 200);
    assert.equal((await api.storage.getTaskById(unassigned.id)).assignedTo, colleague.id);
  });
  it("returns only id and displayName for active company crew and enforces endpoint roles", async () => {
    const result = await request("GET", `/api/communities/${a}/crew?companyId=${y.id}`);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.map((u: any) => u.id).sort(), [crew.id, colleague.id].sort());
    result.body.forEach((u: any) => assert.deepEqual(Object.keys(u).sort(), ["displayName", "id"]));
    assert.equal((await request("GET", `/api/communities/${b}/crew`)).status, 403);
    for (const actor of [crew, hoa, pm, commercial]) {
      assert.equal((await request("GET", `/api/communities/${a}/crew`, undefined, actor)).status, 403);
    }
    assert.deepEqual((await request("GET", `/api/communities/${a}/crew?companyId=${y.id}`, undefined, admin)).body,
      [{ id: other.id, displayName: other.displayName }]);
    assert.equal((await request("GET", `/api/communities/${a}/crew`, undefined, admin)).status, 400);
  });
  it("creates, lists across memberships, edits and submits only company invoices", async () => {
    const created = await request("POST", "/api/invoices", invoiceBody({ contractorCompanyId: y.id, extra: true }));
    assert.equal(created.status, 201); assert.equal(created.body.contractorCompanyId, x.id);
    assert.equal(created.body.contractor, x.name);
    const ownC = await invoice(x.id, c), ownB = await invoice(x.id, b), wrong = await invoice(y.id);
    const listed = await request("GET", "/api/invoices");
    assert.deepEqual(listed.body.map((i: any) => i.id).sort(), [created.body.id, ownC.id].sort());
    assert.equal((await request("GET", `/api/invoices?communityId=${a}`)).body.length, 1);
    for (const row of [ownB, wrong]) {
      assert.equal((await request("GET", `/api/invoices/${row.id}`)).status, 403);
      assert.equal((await request("PUT", `/api/invoices/${row.id}`, { notes: "Forbidden" })).status, 403);
      assert.equal((await request("DELETE", `/api/invoices/${row.id}`)).status, 403);
    }
    assert.equal((await request("POST", "/api/invoices", invoiceBody({ communityId: b }))).status, 403);
    const edited = await request("PUT", `/api/invoices/${created.body.id}`, { status: "submitted", notes: "Sent", extra: true });
    assert.equal(edited.status, 200); assert.equal(edited.body.status, "submitted");
    assert.equal((await request("GET", `/api/invoices/${created.body.id}`)).body.notes, "Sent");
  });
  it("prevents invoice scope and status tampering and permits only draft deletion", async () => {
    const row = await invoice();
    const tampered = await request("PUT", `/api/invoices/${row.id}`, { communityId: b, contractorCompanyId: y.id, cost: 12 });
    assert.equal(tampered.status, 200); assert.equal(tampered.body.communityId, a);
    assert.equal(tampered.body.contractorCompanyId, x.id);
    for (const method of ["POST", "PUT"]) {
      const result = await request(method, method === "POST" ? "/api/invoices" : `/api/invoices/${row.id}`,
        method === "POST" ? invoiceBody({ status: "approved" }) : { status: "approved" });
      assert.deepEqual(result, { status: 403, body: { error: "Only VRTSync staff can approve invoices" } });
    }
    for (const status of ["paid", "void", null]) {
      assert.equal((await request("POST", "/api/invoices", invoiceBody({ status }))).status, 400);
    }
    assert.equal((await request("POST", "/api/invoices", invoiceBody({ status: "submitted" }))).status, 201);
    for (const status of ["submitted", "paid", "void", "draft"]) {
      assert.equal((await request("PUT", `/api/invoices/${row.id}`, { status })).status, 200);
      if (status !== "draft") assert.equal((await request("DELETE", `/api/invoices/${row.id}`)).status, 403);
    }
    assert.equal((await request("PUT", `/api/invoices/${row.id}`, { status: null })).status, 400);
    assert.equal((await request("DELETE", `/api/invoices/${row.id}`)).status, 204);
  });
  it("retains attachment-layer/community validation for manager invoices", async () => {
    const layer = await api.storage.createMapLayer({ communityId: b, layerKey: "trees", subLayerKey: "tree", displayName: "Wrong community" });
    const row = await invoice();
    for (const [method, path, body] of [
      ["POST", "/api/invoices", invoiceBody({ attachmentLayerId: layer.id })],
      ["PUT", `/api/invoices/${row.id}`, { communityId: b, attachmentLayerId: layer.id }],
    ] as const) assert.deepEqual(await request(method, path, body),
      { status: 400, body: { error: "Attachment layer does not belong to the selected community" } });
  });
  it("denies all user, company and membership administration, contracts and monthly reports", async () => {
    for (const [method, path, body] of [
      ["POST", "/api/admin/users", { username: "forbidden", password: "forbidden" }],
      ["PATCH", `/api/admin/users/${crew.id}`, { companyId: y.id }],
      ["DELETE", `/api/admin/users/${crew.id}`, undefined],
      ["PUT", `/api/users/${crew.id}/role`, { role: "admin" }],
      ["POST", `/api/communities/${a}/members`, { userId: outsider.id }],
      ["DELETE", `/api/communities/${a}/members/${crew.id}`, undefined],
      ["DELETE", `/api/communities/${a}/companies/${x.id}`, undefined],
      ["GET", `/api/contracts?communityId=${a}`, undefined],
      ["GET", "/api/contracts/missing", undefined],
      ["POST", "/api/contracts", {}],
      ["PUT", "/api/contracts/missing", {}],
      ["GET", `/api/reports/invoices/monthly?communityId=${a}&month=2026-11`, undefined],
    ] as const) assert.equal((await request(method, path, body)).status, 403, path);
  });
  it("scopes task links, details, completions and both attachment APIs to company work", async () => {
    for (const row of [task, foreign, outside]) {
      const completion = await api.storage.createTaskCompletion({ taskId: row.id, completedBy: admin.id, employeeSignOffName: "Fixture" });
      const expected = row.id === task.id ? 200 : 403;
      for (const suffix of ["", "/detail", "/completions", "/task-attachments", "/link"]) {
        assert.equal((await request("GET", `/api/tasks/${row.id}${suffix}`)).status, expected);
      }
      assert.equal((await request("GET", `/api/task-completions/${completion.id}/attachments`)).status, expected);
      assert.equal((await request("POST", `/api/tasks/${row.id}/attachments`, {
        uploadURL: "fixture", idempotencyKey: randomUUID() })).status, expected === 200 ? 201 : 403);
      assert.equal((await request("POST", `/api/task-completions/${completion.id}/attachments`, {
        fileRef: "fixture", url: "fixture", idempotencyKey: randomUUID() })).status, expected === 200 ? 201 : 403);
    }
    const foreignCompletion = await api.storage.createTaskCompletion({ taskId: foreign.id, completedBy: admin.id, employeeSignOffName: "Fixture" });
    assert.equal((await request("POST", `/api/tasks/${task.id}/attachments`, {
      taskCompletionId: foreignCompletion.id, uploadURL: "fixture", idempotencyKey: randomUUID() })).status, 403);
  });
  it("filters asset history, offline search, snapshots and recent completions by current company scope", async () => {
    const asset = await api.storage.createAsset({ communityId: a, assetType: "tree", label: "Manager fixture" });
    for (const row of [task, unassigned, foreign]) {
      await api.storage.setTaskLink(row.id, { linkType: "asset", assetId: asset.id });
      await api.storage.completeTaskAtomically(row.id, 1, { completedBy: admin.id, employeeSignOffName: "Fixture" });
    }
    await api.storage.createOfflinePack({ communityId: a });
    for (const path of [`/api/assets/${asset.id}/history`, `/api/communities/${a}/offline-pack-data`,
      `/api/tasks/page-data?communityId=${a}`, `/api/dashboard/role?communityId=${a}`]) {
      const result = await request("GET", path);
      assert.equal(result.status, 200, path);
      const ids = records(result.body).map(r => r.id);
      assert.ok(ids.includes(task.id), path); assert.ok(ids.includes(unassigned.id), path);
      assert.ok(!ids.includes(foreign.id), path);
    }
    await api.storage.removeCommunityMember(a, manager.id);
    assert.deepEqual(await api.storage.getAssetWorkHistory(asset.id, manager.id), []);
    assert.deepEqual((await api.storage.generateSearchIndex(a, manager.id, false)).tasks, []);
  });
  it("checks task scope before a community-wide object ACL can grant attachment bytes", async () => {
    for (const [row, expected] of [[task, 200], [foreign, 403], [outside, 403]]) {
      const fileRef = `/objects/${randomUUID()}`;
      await api.storage.createAttachment({ taskId: row.id, fileRef, url: fileRef, uploadedBy: admin.id, idempotencyKey: randomUUID() });
      assert.equal((await request("GET", fileRef)).status, expected);
    }
  });
  it("cuts off every task and invoice path immediately after membership removal", async () => {
    const row = await invoice();
    const completion = await api.storage.createTaskCompletion({ taskId: task.id, completedBy: crew.id, employeeSignOffName: "Fixture" });
    await api.storage.removeCommunityMember(a, manager.id);
    for (const path of [...collectionPaths(a), `/api/tasks/${task.id}`, `/api/tasks/${task.id}/detail`,
      `/api/tasks/${task.id}/task-attachments`, `/api/tasks/${task.id}/completions`, `/api/tasks/${task.id}/link`,
      `/api/task-completions/${completion.id}/attachments`, `/api/invoices/${row.id}`, `/api/communities/${a}/crew`]) {
      assert.equal((await request("GET", path)).status, 403, path);
    }
    assert.deepEqual((await request("GET", "/api/tasks")).body, []);
    assert.deepEqual((await request("GET", "/api/invoices")).body, []);
    assert.equal((await request("PUT", `/api/invoices/${row.id}`, { notes: "Removed" })).status, 403);
    assert.equal((await request("DELETE", `/api/invoices/${row.id}`)).status, 403);
    assert.equal((await request("POST", `/api/tasks/${task.id}/complete`, { version: 1, employeeSignOffName: "Removed" })).status, 403);
  });
  it("fails closed for a manager with no company on reads, task writes, crew and invoices", async () => {
    const row = await invoice();
    await client.query("UPDATE users SET company_id=NULL WHERE id=$1", [manager.id]);
    for (const path of collectionPaths(a)) {
      const result = await request("GET", path);
      assert.equal(result.status, 200);
      assert.ok(!records(result.body).some(r => [task.id, foreign.id, noOwner.id].includes(r.id)));
    }
    assert.equal((await request("GET", `/api/tasks/${task.id}`)).status, 403);
    assert.deepEqual((await request("GET", "/api/invoices")).body, []);
    for (const [method, path, body] of [
      ["POST", "/api/tasks", { communityId: a, title: "No company" }],
      ["POST", "/api/tasks/bulk/assign", { taskIds: [task.id], assignedTo: crew.id }],
      ["GET", `/api/communities/${a}/crew`, undefined],
      ["POST", "/api/invoices", invoiceBody()],
      ["GET", `/api/invoices/${row.id}`, undefined],
      ["PUT", `/api/invoices/${row.id}`, { notes: "No company" }],
      ["DELETE", `/api/invoices/${row.id}`, undefined],
    ] as const) assert.equal((await request(method, path, body)).status, 403);
  });
  it("retains mobile crew-tab fallback without modifying the mobile app", () => {
    const layout = readFileSync(new URL("../../vrtsync-mobile/app/_layout.tsx", import.meta.url), "utf8");
    const expression = /const correctStack = ([^;]+);/.exec(layout)?.[1];
    assert.ok(expression, "Expected mobile stack selection must be present");
    const select = new Function("isHoa", "isMapCreator", `return ${expression}`);
    assert.equal(select(false, false), "(tabs)");
    assert.equal(select(true, false), "(hoa-tabs)");
    assert.equal(select(false, true), "(mc-tabs)");
  });
  it("preserves crew, admin, PM, HOA and commercial boundaries and admin invoice operations", async () => {
    for (const actor of [admin, pm, hoa]) {
      const result = await request("GET", `/api/tasks?communityId=${a}`, undefined, actor);
      assert.ok(result.body.some((t: any) => t.id === foreign.id));
      assert.equal((await request("GET", `/api/tasks/${task.id}/detail`, undefined, actor)).body.task.estimateCents, 5000);
    }
    const crewTasks = await request("GET", `/api/tasks?communityId=${a}`, undefined, crew);
    assert.deepEqual(crewTasks.body.map((t: any) => t.id), [task.id]);
    const created = await request("POST", "/api/invoices", invoiceBody({ status: "approved", contractorCompanyId: y.id }), admin);
    assert.equal(created.status, 201); assert.equal(created.body.contractorCompanyId, y.id);
    assert.equal((await request("PUT", `/api/invoices/${created.body.id}`, { status: "paid" }, admin)).status, 200);
    for (const actor of [pm, hoa]) assert.equal((await request("GET", `/api/invoices?communityId=${a}`, undefined, actor)).status, 200);
    assert.equal((await request("GET", `/api/invoices/${created.body.id}`, undefined, crew)).status, 403);
    assert.equal((await request("GET", `/api/invoices/${created.body.id}`, undefined, commercial)).status, 403);
    assert.equal((await request("GET", "/api/invoices", undefined, commercial)).status, 200);
    assert.equal((await request("DELETE", `/api/invoices/${created.body.id}`, undefined, admin)).status, 204);
    assert.equal((await request("GET", `/api/contracts?communityId=${a}`, undefined, pm)).status, 200);
  });
});
