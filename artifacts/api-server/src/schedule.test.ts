import assert from "node:assert/strict";
import { before, beforeEach, afterEach, after, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import express from "express";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { build } from "esbuild";
import { uteCreekSchedule } from "./testUtils/scheduleFixture";

const require = createRequire(import.meta.url);
const migration = readFileSync(new URL("../../../lib/db/migrations/0027_contract_schedule.sql", import.meta.url), "utf8");
const root = fileURLToPath(new URL(".", import.meta.url));
const plain = (v: any) => JSON.parse(JSON.stringify(v));
const service = (name = "Clean-up", startDate = "2026-11-01", endDate = "2026-11-30") => ({
  name, category: "landscape", kind: "counted", sortOrder: 0, windows: [{ startDate, endDate }],
});
const payload = (services: any[] = [service()], rates: any[] = []) => ({ services, rates });

describe("SC1 contract schedules (real routes, isolated PostgreSQL fixtures)", () => {
  let pool: pg.Pool, client: pg.PoolClient, api: any, bundle: string, server: Server, base: string;
  let community: string, elsewhere: string, company: any, otherCompany: any, management: any;
  let admin: any, crew: any, manager: any, colleague: any, foreign: any, outsider: any, hoa: any, board: any, pm: any, mc: any, commercial: any;
  let contract: any, queries: string[], claimCalls: any[], objects: Map<string, { owner?: string; missing?: boolean; fail?: boolean }>;

  function moduleFor(database: any, connectionPool: any) {
    const module = { exports: {} as any };
    new Function("require", "module", "exports", "__db", "__pool", "__claims", "__objects", bundle)(
      require, module, module.exports, database, connectionPool, claimCalls, objects,
    );
    return module.exports;
  }
  async function start(target = api) {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.session = { userId: req.headers["x-user"], destroy: (cb: any) => cb() };
      next();
    });
    target.setup(app);
    const s = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => s.on("listening", resolve));
    return { server: s, base: `http://127.0.0.1:${(s.address() as any).port}` };
  }
  async function request(path: string, user: any = admin, method = "GET", body?: any, endpoint = base) {
    const response = await fetch(endpoint + path, {
      method, headers: { ...(user ? { "x-user": user.id } : {}), "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: response.status === 204 ? null : await response.json() as any };
  }
  const schedulePath = () => `/api/contracts/${contract.id}/schedule`;
  const communityPath = (on = "2026-11-26") => `/api/communities/${community}/schedule?on=${on}`;
  async function save(body = payload()) {
    const result = await request(schedulePath(), admin, "PUT", body);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body.contracts[0];
  }
  async function complete(windowId: string, user = crew, completedOn = "2026-11-18") {
    return request(`/api/schedule/windows/${windowId}/complete`, user, "POST", { completedOn, note: "Fixture", extra: "stripped" });
  }
  async function undo(id: string, user = crew) { return request(`/api/schedule/completions/${id}/undo`, user, "POST", {}); }
  function upload(owner = crew, flags = {}) {
    // Read the runtime prefix without printing it, just as the production validator does.
    const url = `https://storage.googleapis.com${process.env.PRIVATE_OBJECT_DIR}/uploads/${randomUUID()}`;
    objects.set(url, { owner: owner.id, ...flags });
    return url;
  }
  async function photo(id: string, user = crew, key: string = randomUUID(), url = upload(user)) {
    return request(`/api/schedule/completions/${id}/photos`, user, "POST", { uploadURL: url, idempotencyKey: key, extra: true });
  }
  async function makeUser(role: string, extra = {}) {
    return api.storage.createUser({ username: randomUUID(), password: "fixture-only", displayName: role, role, ...extra });
  }
  before(async () => {
    assert.notEqual(process.env.NODE_ENV, "production", "Refusing production database fixtures");
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    // Idempotence on the development schema; all actual fixtures roll back.
    await pool.query(migration);
    await pool.query(migration);
    const built = await build({
      stdin: {
        contents: `
          import { registerScheduleRoutes } from "./routes/schedule";
          import { registerContractRoutes } from "./routes/contracts";
          import { loadCurrentUser, enforceHoaScoping, enforceOrgScoping } from "./auth";
          import { ObjectStorageService, ObjectForbiddenError, ObjectNotFoundError } from "./objectStorage";
          ObjectStorageService.prototype.claimObjectForCaller = async function(url, caller, acl) {
            __claims.push({url, caller, acl});
            const object = __objects.get(url);
            if (!object || object.missing) throw new ObjectNotFoundError();
            if (object.owner && object.owner !== caller) throw new ObjectForbiddenError();
            if (object.fail) throw new Error("Fixture storage failure");
            return "/objects/uploads/" + url.split("/").pop();
          };
          export * as storage from "./storage";
          export * as policy from "./policy";
          export * as dates from "./scheduleDates";
          export * as schema from "@workspace/db";
          export function setup(app) {
            app.use(loadCurrentUser);
            app.use(enforceHoaScoping);
            app.use(enforceOrgScoping);
            registerContractRoutes(app);
            registerScheduleRoutes(app);
          }
        `, resolveDir: root, loader: "ts",
      },
      bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
      plugins: [{
        name: "schedule-isolated-db",
        setup(builder) {
          builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({
            path: fileURLToPath(new URL("../../../lib/db/src/schema/schema.ts", import.meta.url)),
          }));
          builder.onResolve({ filter: /^\.\.?\/db$/ }, () => ({ path: "db", namespace: "fixture" }));
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
    queries = []; claimCalls = []; objects = new Map();
    const database = drizzle(client, { logger: { logQuery(sql) { queries.push(sql); } } });
    let seq = 0;
    // Raw BEGIN does not inform Drizzle about nesting. Explicit savepoints
    // protect these fixtures even when production storage opens transactions.
    database.transaction = (async (fn: any) => {
      const name = `sc1_${++seq}`;
      await client.query(`SAVEPOINT ${name}`);
      try {
        const result = await fn(database);
        await client.query(`RELEASE SAVEPOINT ${name}`);
        return result;
      } catch (error) {
        await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
        await client.query(`RELEASE SAVEPOINT ${name}`);
        throw error;
      }
    }) as any;
    api = moduleFor(database, { query: (...args: any[]) => (client.query as any)(...args) });
    community = (await api.storage.createCommunity({ name: "Schedule fixture" })).id;
    elsewhere = (await api.storage.createCommunity({ name: "Elsewhere fixture" })).id;
    company = await api.storage.createCompany(`High Plains ${randomUUID()}`, "contractor");
    otherCompany = await api.storage.createCompany(`Other ${randomUUID()}`, "contractor");
    management = await api.storage.createCompany(`Management ${randomUUID()}`, "management_company");
    admin = await makeUser("admin");
    crew = await makeUser("contractor", { companyId: company.id });
    colleague = await makeUser("contractor", { companyId: company.id });
    manager = await makeUser("contractor_manager", { companyId: company.id });
    foreign = await makeUser("contractor", { companyId: otherCompany.id });
    outsider = await makeUser("contractor", { companyId: company.id });
    hoa = await makeUser("hoa_admin", { hoaCommunityId: community });
    board = await makeUser("hoa_member", { hoaCommunityId: community });
    pm = await makeUser("property_manager");
    mc = await makeUser("map_creator");
    const org = (await client.query("INSERT INTO organizations(name) VALUES ('Schedule org') RETURNING id")).rows[0].id;
    await client.query("UPDATE communities SET organization_id=$1 WHERE id=$2", [org, community]);
    commercial = await makeUser("client_admin", { organizationId: org });
    for (const u of [crew, colleague, manager, foreign, pm, hoa, board]) await api.storage.addCommunityMember(community, u.id);
    contract = await api.storage.createContract({
      communityId: community, contractorCompanyId: company.id, contractType: "Landscape Maintenance Contract",
      startDate: "2026-11-01", endDate: "2027-10-31", pdfObjectKey: "/objects/fixture.pdf",
    });
    ({ server, base } = await start());
  });
  afterEach(async () => {
    if (server) await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    await client.query("ROLLBACK");
    client.release();
  });
  after(async () => { await pool?.end(); });

  it("runs the migration twice and makes only the contract holder nullable", async () => {
    const columns = await client.query(`SELECT is_nullable FROM information_schema.columns WHERE table_name='contracts' AND column_name='contractor_user_id'`);
    assert.equal(columns.rows[0].is_nullable, "YES");
    assert.equal(contract.contractorUserId, null);
    assert.ok(!/user_sessions|session_pkey|INSERT INTO/i.test(migration));
    const tables = await client.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN
      ('contract_services','contract_service_windows','contract_service_completions','contract_completion_photos','contract_rates')`);
    assert.equal(tables.rowCount, 5);
    const constraints = await client.query(`SELECT confdeltype FROM pg_constraint WHERE conrelid='contract_service_completions'::regclass AND confrelid='contract_service_windows'::regclass`);
    assert.equal(constraints.rows[0].confdeltype, "r");
  });

  it("supports company-only, legacy crew, and account-manager contract callers, rejecting bad holders", async () => {
    const body = { communityId: community, contractType: "Legacy", startDate: "2026-11-01", endDate: "2027-10-31", extra: "ignored" };
    for (const holder of [
      { contractorCompanyId: company.id }, { contractorUserId: crew.id }, { contractorUserId: manager.id },
      { contractorUserId: crew.id, contractorCompanyId: company.id },
    ]) {
      const result = await request("/api/contracts", admin, "POST", { ...body, ...holder });
      assert.equal(result.status, 201, JSON.stringify(result.body));
      assert.equal(result.body.contractorCompanyId, company.id);
    }
    const inactive = await api.storage.createCompany(`Inactive ${randomUUID()}`, "contractor");
    await client.query("UPDATE companies SET is_active=false WHERE id=$1", [inactive.id]);
    for (const holder of [
      {}, { contractorCompanyId: management.id }, { contractorCompanyId: inactive.id }, { contractorCompanyId: randomUUID() },
      { contractorUserId: crew.id, contractorCompanyId: otherCompany.id }, { contractorUserId: pm.id },
    ]) assert.equal((await request("/api/contracts", admin, "POST", { ...body, ...holder })).status, 400);
  });

  it("reconciles effective holders on partial updates and preserves legacy reads and deletes", async () => {
    const path = `/api/contracts/${contract.id}`;
    assert.equal((await request(path, admin, "PUT", { contractType: "Renamed" })).status, 200);
    assert.equal((await request(path, admin, "PUT", { contractorCompanyId: otherCompany.id })).body.contractorCompanyId, otherCompany.id);
    const changed = await request(path, admin, "PUT", { contractorUserId: crew.id });
    assert.equal(changed.status, 200); assert.equal(changed.body.contractorCompanyId, company.id);
    assert.equal((await request(path, admin, "PUT", { contractorCompanyId: otherCompany.id })).status, 400);
    assert.equal((await request(path, admin, "PUT", { contractorUserId: manager.id })).status, 200);
    assert.equal((await request(path, pm)).status, 200);
    assert.equal((await request(`/api/contracts?communityId=${community}`, pm)).status, 200);
    assert.equal((await request(path, crew)).status, 403);
    assert.equal((await request(path, admin, "DELETE")).status, 204);
    assert.equal((await request(path)).status, 404);
  });

  it("round-trips the exact Ute Creek counts, prices, fields and deterministic ordering", async () => {
    const input = uteCreekSchedule();
    // Submit backwards; sort_order and dates, not arrival order, control display.
    input.services.reverse();
    input.services.forEach(s => s.windows.reverse());
    const saved = await save({ ...input, unknown: 1 } as any);
    assert.equal(saved.services.length, 15);
    assert.equal(saved.services.reduce((n: number, s: any) => n + s.windows.length, 0), 19);
    assert.equal(saved.summary.countedTotal, 18);
    assert.equal(saved.rates.length, 14);
    assert.equal(saved.title, "Landscape Maintenance Contract");
    assert.equal(saved.hasPdf, true);
    assert.equal(saved.services[0].name, "Weekly turf service");
    assert.equal(saved.services[2].windows[0].startDate, "2026-11-01");
    assert.equal(saved.services[2].windows[1].seq, 2);
    assert.deepEqual(saved.rates.at(-1), { label: "Late payment finance charge", amountCents: 0,
      unit: "percent", note: "1.5% per month on payments past due 15 days" });
    assert.deepEqual((await request(schedulePath())).body.contracts[0], saved);
  });

  it("round-trips all three on-request services without adding counted windows", async () => {
    const names = ["Fall aeration", "Crabgrass control", "Winter watering for trees and shrubs"];
    const saved = await save(payload(names.map(name => ({ ...service(name), kind: "on_request", windows: [] }))));
    assert.equal(saved.services.length, 3);
    assert.equal(saved.summary.countedTotal, 0);
    assert.ok(saved.services.every((s: any) => s.windows.length === 0));
  });

  it("enforces valid dates, contract-end and the exact 92-day early boundary atomically", async () => {
    const good = await save(payload([service("Winterization", "2026-08-01", "2026-12-31")]));
    assert.equal(api.dates.dayNumber("2026-11-01") - api.dates.dayNumber("2026-08-01"), 92);
    assert.equal((await save(payload([service("Winterization", "2026-10-01", "2026-12-31")]))).services.length, 1);
    const before = (await request(schedulePath())).body;
    for (const [start, end, message] of [
      ["2026-10-01", "2027-11-30", "outside the contract year"],
      ["2026-07-31", "2026-12-31", "outside the allowed"],
      ["2026-07-01", "2026-12-31", "outside the allowed"],
      ["2027-11-01", "2027-11-02", "outside the contract year"],
      ["2027-02-01", "2027-02-30", "Invalid calendar date"],
      ["2027-05-01", "2027-04-30", "starts after"],
      ["2026-08-01", "2026-10-31", "outside the contract year"],
    ]) {
      const result = await request(schedulePath(), admin, "PUT", payload([service("Winterization", start, end)]));
      assert.equal(result.status, 400, JSON.stringify(result.body));
      assert.match(result.body.error, new RegExp(message));
      assert.match(result.body.error, /Winterization/);
      assert.deepEqual((await request(schedulePath())).body, before);
    }
    assert.equal(good.services[0].windows[0].startDate, "2026-08-01");
    for (const date of ["2027-02-29", "2026-11-31", "2026-1-01", "0000-01-01"]) {
      assert.equal((await request(communityPath(date))).status, 400);
    }
    assert.equal(api.schema.scheduleDateSchema.safeParse("2028-02-29").success, true);
  });

  it("refuses every invalid kind/window count and enforces field limits without writes", async () => {
    for (const s of [
      { ...service(), windows: [] },
      { ...service(), windows: Array.from({ length: 13 }, () => service().windows[0]) },
      { ...service(), kind: "repeating", windows: [service().windows[0], service().windows[0]] },
      { ...service(), kind: "as_needed", windows: [service().windows[0], service().windows[0]] },
      { ...service(), kind: "on_request" },
      { ...service(), description: "x".repeat(501) }, { ...service(), includedText: "x".repeat(61) },
      { ...service(), cadenceText: "x".repeat(161) }, { ...service(), name: "x".repeat(121) },
      { ...service(), category: "invalid" }, { ...service(), sortOrder: 0.5 },
    ]) assert.equal((await request(schedulePath(), admin, "PUT", payload([s]))).status, 400);
    for (const rate of [
      { label: "Bad", amountCents: -1, sortOrder: 0 }, { label: "", amountCents: 1, sortOrder: 0 },
      { label: "Bad", amountCents: 1, unit: "x".repeat(41), sortOrder: 0 },
      { label: "Bad", amountCents: 1, note: "x".repeat(201), sortOrder: 0 },
    ]) assert.equal((await request(schedulePath(), admin, "PUT", payload([service()], [rate]))).status, 400);
    assert.equal((await request(schedulePath())).body.contracts[0].services.length, 0);
    assert.equal((await save(payload([{ ...service(), kind: "repeating" }]))).services.length, 1);
    assert.equal((await save(payload([{ ...service(), kind: "as_needed", windows: [] }]))).services.length, 1);
  });

  it("uses selected dates for selection/state but the real Denver date for permissions", async () => {
    const saved = await save(payload([
      service("Open"), service("Upcoming", "2026-12-01", "2027-01-30"),
      service("Overdue", "2026-10-01", "2026-11-01"),
      { ...service("Seasonal"), kind: "repeating" },
    ]));
    let view = (await request(communityPath())).body;
    assert.equal(view.today, api.dates.todayInDenver());
    assert.deepEqual(view.contracts[0].summary, { countedTotal: 3, done: 0, open: 1, overdue: 1,
      nextWindow: { serviceName: "Upcoming", startDate: "2026-12-01" } });
    assert.equal(view.contracts[0].services.find((s: any) => s.name === "Seasonal").windows[0].state, "in_season");
    assert.equal((await request(communityPath("2028-01-01"))).body.contracts.length, 0);
    const window = saved.services.find((s: any) => s.name === "Open").windows[0];
    const done = await complete(window.id);
    assert.equal(done.status, 200, JSON.stringify(done.body));
    view = (await request(communityPath("2026-11-26"), crew)).body;
    const shown = view.contracts[0].services.find((s: any) => s.name === "Open").windows[0];
    assert.equal(shown.state, "done"); assert.equal(shown.completion.completedOn, "2026-11-18");
    assert.equal(shown.completion.completedBy.name, "contractor");
    await client.query("UPDATE contract_service_completions SET created_at=now()-interval '16 days' WHERE id=$1", [done.body.completion.id]);
    const past = (await request(communityPath("2026-11-01"), crew)).body;
    assert.equal(past.contracts[0].services.find((s: any) => s.name === "Open").windows[0].completion.canUndo, false);
    assert.equal((await undo(done.body.completion.id)).status, 403);
  });

  it("uses the Denver calendar across UTC midnight, DST and leap-day boundaries", () => {
    assert.equal(api.dates.todayInDenver(new Date("2026-11-27T06:59:59Z")), "2026-11-26");
    assert.equal(api.dates.todayInDenver(new Date("2026-11-27T07:00:00Z")), "2026-11-27");
    assert.equal(api.dates.todayInDenver(new Date("2027-07-01T05:59:59Z")), "2027-06-30");
    assert.equal(api.dates.todayInDenver(new Date("2027-07-01T06:00:00Z")), "2027-07-01");
    for (const kind of ["counted", "repeating", "as_needed"]) {
      const w = { startDate: "2027-03-01", endDate: "2027-03-31", kind };
      assert.equal(api.dates.windowState(w, null, "2027-02-28"), "upcoming");
      assert.equal(api.dates.windowState(w, null, "2027-03-01"), kind === "counted" ? "open" : "in_season");
      assert.equal(api.dates.windowState(w, null, "2027-03-31"), kind === "counted" ? "open" : "in_season");
      assert.equal(api.dates.windowState(w, null, "2027-04-01"), kind === "counted" ? "overdue" : "past");
      assert.equal(api.dates.windowState(w, { undoneAt: new Date() }, "2027-04-01"), kind === "counted" ? "overdue" : "past");
    }
  });

  it("enforces all reader roles, current access, company isolation and rates redaction", async () => {
    await save();
    const second = await api.storage.createContract({ communityId: community, contractorCompanyId: otherCompany.id,
      contractType: "Other snow", startDate: contract.startDate, endDate: contract.endDate });
    for (const u of [crew, manager, foreign]) {
      const r = await request(communityPath(), u);
      assert.equal(r.status, 200);
      assert.equal(r.body.contracts.length, 1);
      assert.equal(r.body.contracts[0].company.id, u.companyId);
      assert.equal(Object.hasOwn(r.body.contracts[0], "rates"), u.id !== crew.id && u.id !== foreign.id);
    }
    for (const u of [admin, pm, hoa, board, commercial]) {
      const r = await request(communityPath(), u);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.contracts.length, 2);
      assert.ok(r.body.contracts.every((c: any) => Object.hasOwn(c, "rates")));
    }
    assert.equal((await request(`/api/contracts/${second.id}/schedule`, crew)).status, 404);
    assert.equal((await request(`/api/contracts/${randomUUID()}/schedule`)).status, 404);
    assert.equal((await request(communityPath(), mc)).status, 403);
    assert.equal((await request(schedulePath(), mc)).status, 403);
    assert.equal((await request(communityPath(), outsider)).status, 403);
    assert.equal((await request(communityPath(), null)).status, 401);
    await client.query("UPDATE users SET hoa_community_id=NULL WHERE id=ANY($1::varchar[])", [[hoa.id, board.id]]);
    for (const u of [hoa, board]) assert.equal((await request(communityPath(), u)).status, 403);
    await client.query("DELETE FROM community_members WHERE user_id=$1", [crew.id]);
    assert.equal((await request(communityPath(), crew)).status, 403);
    await client.query("UPDATE users SET company_id=NULL WHERE id=$1", [manager.id]);
    assert.deepEqual((await request(communityPath(), manager)).body.contracts, []);
    await client.query("UPDATE contracts SET is_active=false WHERE id=$1", [contract.id]);
    assert.equal((await request(schedulePath(), admin)).status, 200);
  });

  it("only staff and current company members can complete; policy revalidates stale actors", async () => {
    const saved = await save();
    const id = saved.services[0].windows[0].id;
    for (const u of [foreign, outsider, hoa, board, pm, commercial, mc]) {
      assert.equal((await complete(id, u)).status, 403);
      assert.equal((await request(schedulePath(), u, "PUT", payload())).status, 403);
    }
    const stale = api.policy.actorFromUser(crew);
    await client.query("UPDATE users SET company_id=$1 WHERE id=$2", [otherCompany.id, crew.id]);
    await assert.rejects(api.storage.completeWindow(id, { completedOn: "2026-11-18" }, stale), /Access denied/);
    assert.equal((await complete(id)).status, 403);
    await client.query("UPDATE users SET company_id=$1 WHERE id=$2", [company.id, crew.id]);
    assert.equal((await complete(id, manager)).status, 200);
    const c = (await client.query("SELECT id FROM contract_service_completions WHERE window_id=$1", [id])).rows[0];
    assert.equal((await undo(c.id, admin)).status, 200);
    assert.equal((await complete(id, admin)).status, 200);
  });

  it("refuses early/future/non-counted/invalid completions and returns the live completion on duplicates", async () => {
    const saved = await save(payload([service(), { ...service("Turf"), kind: "repeating" }]));
    const id = saved.services.find((s: any) => s.name === "Clean-up").windows[0].id;
    assert.equal((await complete(id, crew, "2026-10-31")).body.error, "This window opens 2026-11-01.");
    assert.equal((await complete(id, crew, "9999-01-01")).body.error, "The date can't be in the future.");
    assert.equal((await complete(id, crew, "2026-02-30")).status, 400);
    const turf = saved.services.find((s: any) => s.name === "Turf").windows[0].id;
    assert.equal((await complete(turf)).body.error, "Only counted services are marked done.");
    assert.equal((await request(`/api/schedule/windows/${id}/complete`, crew, "POST", {
      completedOn: "2026-11-18", note: "x".repeat(1001),
    })).status, 400);
    const done = await complete(id);
    const duplicate = await complete(id);
    assert.equal(duplicate.status, 409); assert.deepEqual(duplicate.body.completion, done.body.completion);
    assert.equal((await client.query("SELECT count(*)::int n FROM contract_service_completions WHERE window_id=$1 AND undone_at IS NULL", [id])).rows[0].n, 1);
  });

  it("retains undo history, permits recompletion, and enforces the inclusive 14-day and current eligibility rules", async () => {
    const saved = await save();
    const id = saved.services[0].windows[0].id;
    let done = await complete(id);
    assert.equal((await undo(done.body.completion.id, colleague)).status, 403);
    assert.equal((await undo(done.body.completion.id, foreign)).status, 403);
    const today = api.dates.todayInDenver();
    const day14 = new Date(`${today}T12:00:00Z`); day14.setUTCDate(day14.getUTCDate() - 14);
    await client.query("UPDATE contract_service_completions SET created_at=$1 WHERE id=$2", [day14, done.body.completion.id]);
    assert.equal((await undo(done.body.completion.id)).status, 200);
    assert.equal((await undo(done.body.completion.id)).status, 409);
    const history = (await client.query("SELECT undone_at,undone_by FROM contract_service_completions WHERE id=$1", [done.body.completion.id])).rows[0];
    assert.ok(history.undone_at); assert.equal(history.undone_by, crew.id);
    done = await complete(id);
    assert.equal(done.status, 200);
    await client.query("UPDATE contract_service_completions SET created_at=now()-interval '15 days' WHERE id=$1", [done.body.completion.id]);
    assert.equal((await undo(done.body.completion.id)).status, 403);
    await client.query("DELETE FROM community_members WHERE user_id=$1", [manager.id]);
    assert.equal((await undo(done.body.completion.id, manager)).status, 403);
    await api.storage.addCommunityMember(community, manager.id);
    assert.equal((await undo(done.body.completion.id, manager)).status, 200);
    done = await complete(id);
    await client.query("UPDATE contract_service_completions SET created_at=now()-interval '100 days' WHERE id=$1", [done.body.completion.id]);
    assert.equal((await undo(done.body.completion.id, admin)).status, 200);
    done = await complete(id);
    await client.query("DELETE FROM community_members WHERE user_id=$1", [crew.id]);
    assert.equal((await undo(done.body.completion.id)).status, 403);
  });

  it("rejects foreign and cross-service window IDs, duplicate IDs, and rolls back everything", async () => {
    const first = await save(payload([service("A"), service("B")]));
    const before = (await request(schedulePath())).body;
    const a = first.services[0], b = first.services[1];
    const foreignContract = await api.storage.createContract({ communityId: elsewhere, contractorCompanyId: company.id,
      contractType: "Foreign", startDate: contract.startDate, endDate: contract.endDate });
    const foreignSaved = (await api.storage.replaceContractSchedule(foreignContract.id, payload() as any, api.policy.actorFromUser(admin))).contracts[0];
    const bodyService = (s: any) => ({ ...service(s.name), id: s.id, windows: s.windows.map((w: any) => ({ id: w.id, startDate: w.startDate, endDate: w.endDate })) });
    for (const input of [
      payload([{ ...bodyService(a), id: foreignSaved.services[0].id }]),
      payload([{ ...bodyService(a), windows: [{ ...a.windows[0], id: b.windows[0].id }] }]),
      payload([{ ...bodyService(a), windows: [foreignSaved.services[0].windows[0]] }]),
      payload([bodyService(a), bodyService(a)]),
      payload([{ ...bodyService(a), windows: [a.windows[0], a.windows[0]] }]),
    ]) {
      const r = await request(schedulePath(), admin, "PUT", input);
      assert.equal(r.status, 400, JSON.stringify(r.body)); assert.match(r.body.error, /A/);
      assert.deepEqual((await request(schedulePath())).body, before);
    }
  });

  it("blocks live-window removal including parent omission, then archives undone history and resequences survivors", async () => {
    const saved = await save(payload([{ ...service("Kept"), windows: [
      service().windows[0], { startDate: "2027-03-01", endDate: "2027-03-31" },
    ] }, service("History-free")], [{ label: "Old rate", amountCents: 100, sortOrder: 0 }]));
    const s = saved.services.find((s: any) => s.name === "Kept"), w = s.windows[0];
    const done = await complete(w.id);
    const p = await photo(done.body.completion.id);
    assert.equal(p.status, 201);
    const before = (await request(schedulePath())).body;
    for (const body of [payload([]), payload([{ ...service("Changed"), id: s.id, windows: [s.windows[1]] }])]) {
      const result = await request(schedulePath(), admin, "PUT", body);
      assert.equal(result.status, 409);
      assert.match(result.body.error, /Kept window .* is marked done; undo it before removing the window\./);
      assert.deepEqual((await request(schedulePath())).body, before);
    }
    assert.equal((await undo(done.body.completion.id)).status, 200);
    const replaced = await save(payload([{ ...service("Kept"), id: s.id, windows: [s.windows[1]] }]));
    assert.equal(replaced.services.length, 1); assert.equal(replaced.services[0].windows[0].seq, 1);
    assert.ok((await client.query("SELECT archived_at FROM contract_service_windows WHERE id=$1", [w.id])).rows[0].archived_at);
    assert.equal((await request(`/api/schedule/completions/${done.body.completion.id}/photos`, hoa)).body.length, 1);
    assert.equal((await complete(w.id)).status, 404);
    await save(payload([]));
    assert.ok((await client.query("SELECT archived_at FROM contract_services WHERE id=$1", [s.id])).rows[0].archived_at);
    assert.equal((await client.query("SELECT count(*)::int n FROM contract_service_completions WHERE id=$1", [done.body.completion.id])).rows[0].n, 1);
    // Restrictive references also protect the retained history on contract deletion.
    await assert.rejects(api.storage.deleteContract(contract.id));
  });

  it("archives whole omitted parents with undone history but physically removes history-free items", async () => {
    const saved = await save();
    const s = saved.services[0];
    const done = await complete(s.windows[0].id);
    await undo(done.body.completion.id);
    await save(payload([]));
    assert.ok((await client.query("SELECT archived_at FROM contract_services WHERE id=$1", [s.id])).rows[0].archived_at);
    assert.ok((await client.query("SELECT archived_at FROM contract_service_windows WHERE id=$1", [s.windows[0].id])).rows[0].archived_at);
    const newSaved = await save();
    await save(payload([]));
    assert.equal((await client.query("SELECT id FROM contract_services WHERE id=$1", [newSaved.services[0].id])).rowCount, 0);
  });

  it("reorders surviving window IDs without uniqueness conflicts and strips unknown fields recursively", async () => {
    const saved = await save(payload([{ ...service(), windows: [
      service().windows[0], { startDate: "2027-03-01", endDate: "2027-03-31" },
    ] }]));
    const s = saved.services[0], [first, second] = s.windows;
    const reordered = await save(payload([{ ...service(), id: s.id, extra: "ignored", windows: [
      { ...second, startDate: "2026-11-01", endDate: "2026-11-30", extra: true },
      { ...first, startDate: "2027-03-01", endDate: "2027-03-31", extra: true },
    ] } as any], [{ label: "New", amountCents: 123, sortOrder: 0, extra: true }]));
    assert.deepEqual(reordered.services[0].windows.map((w: any) => [w.id, w.seq]), [[second.id, 1], [first.id, 2]]);
    assert.equal(reordered.rates.length, 1);
    assert.equal(Object.hasOwn(reordered.services[0], "extra"), false);
  });

  it("validates and claims photos with ownership and community ACL, idempotency, limits, and reader isolation", async () => {
    const saved = await save();
    const done = await complete(saved.services[0].windows[0].id);
    const id = done.body.completion.id;
    assert.equal((await photo(id, crew, "bad", "https://evil.example/image")).status, 400);
    assert.equal((await photo(id, crew, "foreign-owner", upload(colleague))).status, 403);
    assert.equal((await photo(id, crew, "missing", upload(crew, { missing: true }))).status, 422);
    const url = upload(), key = randomUUID();
    const p = await photo(id, crew, key, url);
    assert.equal(p.status, 201, JSON.stringify(p.body));
    const calls = claimCalls.length;
    assert.deepEqual((await photo(id, crew, key, url)).body, p.body);
    assert.equal(claimCalls.length, calls);
    assert.equal(claimCalls.at(-1).caller, crew.id);
    assert.equal(claimCalls.at(-1).acl.owner, crew.id);
    assert.equal(claimCalls.at(-1).acl.aclRules[0].group.id, community);
    for (const u of [foreign, outsider, hoa, board, pm, mc, commercial]) {
      assert.equal((await photo(id, u, key, url)).status, 403);
    }
    for (let n = 1; n < 10; n++) assert.equal((await photo(id)).status, 201);
    assert.equal((await photo(id)).status, 400);
    assert.equal((await photo(id, crew, key, url)).status, 200);
    for (const u of [admin, crew, manager, hoa, board, pm, commercial]) {
      const list = await request(`/api/schedule/completions/${id}/photos`, u);
      assert.equal(list.status, 200); assert.equal(list.body.length, 10);
      assert.deepEqual(Object.keys(list.body[0]).sort(), ["id", "url"]);
      assert.match(list.body[0].url, /^\/objects\/uploads\//);
    }
    assert.equal((await request(`/api/schedule/completions/${id}/photos`, foreign)).status, 404);
    assert.equal((await request(`/api/schedule/completions/${id}/photos`, mc)).status, 403);
    await client.query("UPDATE users SET hoa_community_id=NULL WHERE id=$1", [hoa.id]);
    assert.equal((await request(`/api/schedule/completions/${id}/photos`, hoa)).status, 403);
    assert.equal((await request(schedulePath(), crew)).body.contracts[0].services[0].windows[0].completion.photoCount, 10);
    await client.query("DELETE FROM community_members WHERE user_id=$1", [crew.id]);
    assert.equal((await photo(id, crew, key, url)).status, 403);
  });

  it("does not write a photo row when external storage fails", async () => {
    const saved = await save(), done = await complete(saved.services[0].windows[0].id);
    const result = await photo(done.body.completion.id, crew, "failed", upload(crew, { fail: true }));
    assert.equal(result.status, 500);
    assert.equal((await client.query("SELECT id FROM contract_completion_photos WHERE completion_id=$1", [done.body.completion.id])).rowCount, 0);
  });

  it("loads data in exactly three batched statements for one or many services, with policy overhead measured separately", async () => {
    for (const body of [payload(), uteCreekSchedule()]) {
      const saved = await save(body as any);
      const target = saved.services.find((s: any) => s.name === "Clean-up" || s.name === "Clean-ups");
      await complete(target.windows[0].id);
      queries.length = 0;
      await api.storage.getCommunitySchedule(community, "2026-11-26", api.policy.actorFromUser(admin));
      assert.equal(queries.length, 3, queries.join("\n\n"));
      assert.match(queries[0], /contracts/); assert.match(queries[1], /contract_service_completions/);
      assert.match(queries[1], /users/); assert.match(queries[1], /photo_count/); assert.match(queries[2], /contract_rates/);
      queries.length = 0;
      const http = await request(communityPath(), crew);
      assert.equal(http.status, 200);
      const data = queries.filter(q => /from "(contracts|contract_services|contract_rates)"/.test(q));
      assert.equal(data.length, 3);
      // loadCurrentUser: 1; cached membership policy lookup: 1.
      assert.equal(queries.length - data.length, 2, queries.join("\n\n"));
      const completion = http.body.contracts[0].services.find((s: any) => s.id === target.id).windows[0].completion;
      assert.equal(completion.completedBy.id, crew.id);
      await undo(completion.id, admin);
    }
  });

  it("serializes concurrent completion, undo, replace and photo limits on independent database connections", async () => {
    // Real races need committed fixtures visible to multiple connections.
    // UUID-owned resources below are cleaned explicitly, never by broad deletes.
    const raceApi = moduleFor(drizzle(pool), pool);
    const communityId = (await raceApi.storage.createCommunity({ name: `Race ${randomUUID()}` })).id;
    let userId: string | undefined, companyId: string | undefined, cId: string | undefined;
    const running = await start(raceApi);
    try {
      const co = await raceApi.storage.createCompany(`Race ${randomUUID()}`, "contractor"); companyId = co.id;
      const u = await raceApi.storage.createUser({ username: randomUUID(), password: "fixture", displayName: "Race admin", role: "admin" }); userId = u.id;
      const c = await raceApi.storage.createContract({ communityId, contractorCompanyId: co.id, contractType: "Race",
        startDate: "2026-11-01", endDate: "2027-10-31" }); cId = c.id;
      const actor = raceApi.policy.actorFromUser(u);
      const s = (await raceApi.storage.replaceContractSchedule(c.id, payload(), actor)).contracts[0].services[0];
      const completePath = `/api/schedule/windows/${s.windows[0].id}/complete`;
      const done = await Promise.all(Array.from({ length: 5 }, () => request(completePath, u, "POST", { completedOn: "2026-11-18" }, running.base)));
      assert.equal(done.filter(r => r.status === 200).length, 1);
      assert.equal(done.filter(r => r.status === 409).length, 4);
      const completionId = done.find(r => r.status === 200)!.body.completion.id;
      const photoPath = `/api/schedule/completions/${completionId}/photos`;
      const sameUrl = upload(u);
      const duplicates = await Promise.all(Array.from({ length: 3 }, () => request(photoPath, u, "POST",
        { uploadURL: sameUrl, idempotencyKey: "same" }, running.base)));
      assert.deepEqual(duplicates.map(r => r.status).sort(), [200, 200, 201]);
      const uploads = await Promise.all(Array.from({ length: 14 }, () => request(photoPath, u, "POST",
        { uploadURL: upload(u), idempotencyKey: randomUUID() }, running.base)));
      assert.equal(uploads.filter(r => r.status === 201).length, 9);
      assert.equal(uploads.filter(r => r.status === 400).length, 5);
      const blockedReplace = await request(`/api/contracts/${c.id}/schedule`, u, "PUT", payload([]), running.base);
      assert.equal(blockedReplace.status, 409);
      const undone = await Promise.all(Array.from({ length: 3 }, () => request(`/api/schedule/completions/${completionId}/undo`, u, "POST", {}, running.base)));
      assert.deepEqual(undone.map(r => r.status).sort(), [200, 409, 409]);
      // Either serialization is valid: completion wins -> replace 409, or
      // replace wins -> completion 404. No deleted live history may survive.
      const raced = await Promise.all([
        request(completePath, u, "POST", { completedOn: "2026-11-18" }, running.base),
        request(`/api/contracts/${c.id}/schedule`, u, "PUT", payload([]), running.base),
      ]);
      assert.ok((raced[0].status === 200 && raced[1].status === 409) || (raced[0].status === 404 && raced[1].status === 200),
        JSON.stringify(raced));
      const count = await pool.query(`SELECT count(*)::int n FROM contract_service_completions WHERE window_id=$1 AND undone_at IS NULL`, [s.windows[0].id]);
      assert.equal(count.rows[0].n, raced[0].status === 200 ? 1 : 0);
    } finally {
      await new Promise<void>(resolve => running.server.close(() => resolve()));
      if (cId) {
        await pool.query(`DELETE FROM contract_service_completions WHERE window_id IN
          (SELECT w.id FROM contract_service_windows w JOIN contract_services s ON s.id=w.service_id WHERE s.contract_id=$1)`, [cId]);
      }
      await pool.query("DELETE FROM communities WHERE id=$1", [communityId]);
      if (userId) await pool.query("DELETE FROM users WHERE id=$1", [userId]);
      if (companyId) await pool.query("DELETE FROM companies WHERE id=$1", [companyId]);
    }
  });
});
