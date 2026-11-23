import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";
import express from "express";
import { policyFixture } from "./testUtils/policyFixture";
import { readRouteFixtureSource } from "./testUtils/routeFixtureSource";

const main = readFileSync(new URL("./routes/routes.ts", import.meta.url), "utf8");
const tasks = readFileSync(new URL("./routes/tasks.ts", import.meta.url), "utf8");
const inventory = [
  "get /api/tasks/page-data", "get /api/tasks", "get /api/tasks/:id", "get /api/tasks/:id/detail",
  "post /api/tasks", "put /api/tasks/:id", "delete /api/tasks/:id", "post /api/tasks/:id/complete",
  "post /api/tasks/:id/attachments", "post /api/task-completions/:id/attachments",
  "get /api/task-completions/:id/attachments", "get /api/tasks/:id/completions",
  "get /api/tasks/:id/task-attachments", "put /api/tasks/:id/link", "get /api/tasks/:id/link",
  "post /api/tasks/bulk/assign", "post /api/tasks/import-csv",
];

describe("admin-only route extraction", () => {
  const modules = [
    { file: "adminOverview", register: "registerAdminOverviewRoutes", inventory: [
      "get /api/admin/migrations", "get /api/admin/summary",
      "get /api/admin/dashboard", "get /api/admin/completed-tasks",
    ], comments: [] },
    { file: "xeriscape", register: "registerXeriscapeRoutes", inventory: [
      "get /api/admin/xeriscape/records", "post /api/admin/xeriscape/records",
      "put /api/admin/xeriscape/records/:id", "post /api/admin/xeriscape/records/:id/duplicate",
      "delete /api/admin/xeriscape/records/:id",
      "get /api/admin/xeriscape/community/:communityId/polygons",
      "get /api/admin/xeriscape/records/:recordId/packets",
      "post /api/admin/xeriscape/records/:recordId/packets",
      "put /api/admin/xeriscape/records/:recordId/packets/:packetId",
    ], comments: [
      "// ── Xeriscape Planning Records", "// ── Xeriscape Community Polygons",
      "// ── Xeriscape Packet CRUD",
    ] },
    { file: "taskTemplates", register: "registerTaskTemplateRoutes", inventory: [
      "get /api/task-templates", "post /api/task-templates", "patch /api/task-templates/:id",
      "delete /api/task-templates/:id", "post /api/task-templates/:id/preview",
      "post /api/task-templates/:id/generate",
    ], comments: ["// Task Templates CRUD", "// CSV Task Import"] },
    { file: "taskSchedules", register: "registerTaskScheduleRoutes", inventory: [
      "get /api/task-schedules", "post /api/task-schedules", "patch /api/task-schedules/:id",
      "delete /api/task-schedules/:id", "get /api/task-schedules/:id/runs",
      "post /api/task-schedules/run-now",
    ], comments: ["// Task Schedules CRUD"] },
    { file: "exports", register: "registerExportRoutes", inventory: [
      "post /api/exports/proof-of-work", "get /api/exports", "get /api/exports/:id",
      "get /api/exports/:id/download/pdf", "get /api/exports/:id/download/zip",
    ], comments: ["// ── Export endpoints ──"] },
    { file: "imports", register: "registerImportRoutes", inventory: [
      "post /api/admin/import/master-bill/parse", "post /api/admin/import/master-bill/preview",
      "post /api/admin/import/master-bill/commit", "post /api/admin/import/seasonal/parse",
      "post /api/admin/import/seasonal/preview", "post /api/admin/import/seasonal/commit",
      "get /api/admin/import/batches", "delete /api/admin/import/batches/:id",
      "post /api/admin/import/contract-tasks/parse", "post /api/admin/import/contract-tasks/preview",
      "post /api/admin/import/contract-tasks/commit",
    ], comments: [
      "// ── Master Bill import routes", "// ── Seasonal import routes",
      "// ── Import batch history", "// ── Contract-tasks import routes (unchanged)",
    ] },
    { file: "organizations", register: "registerOrganizationRoutes", inventory: [
      "post /api/admin/organizations", "get /api/admin/organizations",
      "get /api/admin/organizations/:id", "patch /api/admin/organizations/:id",
      "delete /api/admin/organizations/:id", "get /api/admin/organizations/:id/portfolio",
      "get /api/admin/organizations/:id/branches", "post /api/admin/organizations/:id/branches",
      "delete /api/admin/branches/:communityId", "patch /api/admin/branches/:communityId",
      "get /api/admin/organizations/:id/groups", "post /api/admin/organizations/:id/groups",
      "patch /api/admin/groups/:groupId", "delete /api/admin/groups/:groupId",
      "put /api/admin/groups/:groupId/members", "get /api/admin/organizations/:id/group-sets",
      "post /api/admin/organizations/:id/group-sets", "patch /api/admin/group-sets/:setId",
      "delete /api/admin/group-sets/:setId", "get /api/admin/organizations/:id/users",
    ], comments: [
      "// ── Admin: Organization provisioning routes", "// ── Admin: Branch (community) routes",
      "// ── Admin: Branch group routes", "// ── Admin: Branch group set routes",
      "// ── Admin: Organization users",
    ] },
  ];
  const registrations = (source: string) =>
    [...source.matchAll(/app\.(get|post|patch|put|delete)\("([^"]+)"/g)]
      .map(([, method, path]) => `${method} ${path}`);
  const allRegistrations = readdirSync(new URL("./routes/", import.meta.url))
    .filter(file => file.endsWith(".ts"))
    .flatMap(file => registrations(readFileSync(new URL(`./routes/${file}`, import.meta.url), "utf8")));
  const fixture = readRouteFixtureSource();
  for (const module of modules) {
    const source = readFileSync(new URL(`./routes/${module.file}.ts`, import.meta.url), "utf8");
    it(`preserves ${module.file} inventory, order, admin guards, wrappers and catches`, () => {
      assert.deepEqual(registrations(source), module.inventory);
      for (const path of module.inventory) {
        assert.equal(allRegistrations.filter(found => found === path).length, 1, path);
      }
      assert.equal(main.split(`${module.register}(app);`).length - 1, 1);
      assert.match(main, new RegExp(`import \\{ ${module.register} \\} from "\\./${module.file}";`));
      assert.equal((source.match(/route\(async /g) ?? []).length, module.inventory.length);
      assert.equal((source.match(/^    try \{/gm) ?? []).length, module.inventory.length);
      assert.equal((source.match(/^    \} catch \(error(?:: any)?\) \{/gm) ?? []).length,
        module.inventory.length);
      const lines = source.split("\n").filter(line => /^  app\./.test(line));
      for (const line of lines) {
        assert.match(line, /", requireAdmin, (?:upload\.single\("file"\), )?route\(async /);
      }
      assert.doesNotMatch(source,
        /\.role\b|\brole\s*[!=]==?|(?:isUserMemberOfCommunity|userCanAccessCommunity|canUserAccessTask)\s*\(/);
    });
    it(`restores ${module.file} routes and comments in the fixture view`, () => {
      const harness = readFileSync(new URL("./testUtils/routeFixtureSource.ts", import.meta.url), "utf8");
      assert.ok(harness.includes(`["${module.file}", "${module.register}", ${module.inventory.length}]`));
      assert.deepEqual(registrations(fixture).filter(path => module.inventory.includes(path)), module.inventory);
      let previous = -1;
      for (const comment of module.comments) {
        assert.equal(source.split(comment).length - 1, 1, comment);
        assert.equal(fixture.split(comment).length - 1, 1, comment);
        const position = fixture.indexOf(comment);
        assert.ok(position > previous, comment);
        previous = position;
      }
    });
  }
  it("leaves ping as the only direct HTTP handler in main", () => {
    assert.deepEqual(registrations(main), ["get /api/ping"]);
    assert.deepEqual([...main.matchAll(/app\.use\("([^"]+)", (\w+)\);/g)]
      .map(([, path, middleware]) => [path, middleware]),
    [["/api", "enforceHoaScoping"], ["/api", "enforceOrgScoping"]]);
    assert.doesNotMatch(main, /requireAdmin|upload|storage|adminDashboardCache|nextControllerKey/);
    assert.doesNotMatch(main, /userCanAccessCommunity/);
    assert.match(main, /const httpServer = createServer\(app\);\s*return httpServer;/);
  });
  it("retains the complete middleware and registration order", () => {
    assert.deepEqual([...main.matchAll(/^  (register\w+Routes)\(app\);|^  app\.(use|get)\("([^"]+)"/gm)]
      .map(([, register, method, path]) => register ?? `${method} ${path}`), [
      "registerAuthRoutes", "use /api", "use /api", "registerObjectRoutes",
      "registerCommunityRoutes", "registerDashboardRoutes", "registerTaskRoutes",
      "registerAdminOverviewRoutes", "registerXeriscapeRoutes", "registerCompanyRoutes",
      "registerUserRoutes", "get /api/ping", "registerPushRoutes", "registerAssetRoutes",
      "registerMapLayerRoutes", "registerSearchRoutes", "registerAssetTypeRoutes",
      "registerOfflinePackRoutes", "registerTaskTemplateRoutes", "registerTaskScheduleRoutes",
      "registerExportRoutes", "registerServiceScheduleRoutes", "registerImportRoutes",
      "registerHoaRoutes", "registerNotificationRoutes", "registerInvoiceRoutes",
      "registerReportRoutes", "registerContractRoutes", "registerDriveRoutes",
      "registerContactRoutes", "registerPortfolioRoutes", "registerPortfolioWorkOrderRoutes",
      "registerOrganizationRoutes",
    ]);
  });
  it("retains the task insertion and extraction boundaries", () => {
    const between = (start: string, end: string) => {
      const from = fixture.indexOf(start), to = fixture.indexOf(end, from + start.length);
      assert.ok(from >= 0 && to > from, start);
      return fixture.slice(from, to);
    };
    assert.deepEqual(registrations(between("// Task Templates CRUD", '  app.post("/api/tasks/bulk/assign",')),
      modules[2].inventory);
    assert.deepEqual(registrations(between('  app.post("/api/tasks/bulk/assign",', "// CSV Task Import")),
      ["post /api/tasks/bulk/assign"]);
    assert.deepEqual(registrations(between("// CSV Task Import", "// Task Schedules CRUD")),
      ["post /api/tasks/import-csv"]);
    assert.deepEqual(registrations(between("// Task Schedules CRUD", "// ── Export endpoints ──")),
      modules[3].inventory);
    assert.ok(between('app.get("/api/communities/:communityId/offline-pack-data",', "// Task Templates CRUD"));
    assert.ok(between('app.get("/api/service-schedules/:scheduleId/visits",', "// ── Master Bill import routes"));
  });
  it("keeps the three parse uploads after requireAdmin and before their handlers", () => {
    const source = readFileSync(new URL("./routes/imports.ts", import.meta.url), "utf8");
    assert.deepEqual([...source.matchAll(/^  app\.post\("([^"]+)", requireAdmin, upload\.single\("file"\), route\(async /gm)]
      .map(([, path]) => path), [
      "/api/admin/import/master-bill/parse", "/api/admin/import/seasonal/parse",
      "/api/admin/import/contract-tasks/parse",
    ]);
    assert.equal((source.match(/upload\.single\(/g) ?? []).length, 3);
  });
  it("keeps the existing dashboard cache owned only by the overview module", () => {
    const source = readFileSync(new URL("./routes/adminOverview.ts", import.meta.url), "utf8");
    assert.match(source, /^let adminDashboardCache:/m);
    assert.match(source, /adminDashboardCache = \{ data, expiresAt: now \+ 60_000 \};/);
    for (const module of modules.slice(1)) {
      assert.doesNotMatch(readFileSync(new URL(`./routes/${module.file}.ts`, import.meta.url), "utf8"),
        /adminDashboardCache/);
    }
  });
});

describe("service schedule, notification and push route structure", () => {
  const modules = [
    { file: "serviceSchedules", register: "registerServiceScheduleRoutes", inventory: [
      ["get /api/communities/:communityId/service-schedules", "requireAuth"],
      ["post /api/communities/:communityId/service-schedules", "requireAdmin"],
      ["patch /api/service-schedules/:id", "requireAdmin"],
      ["delete /api/service-schedules/:id", "requireAdmin"],
      ["get /api/service-schedules/:scheduleId/visits", "requireAuth"],
      ["get /api/communities/:communityId/service-visits", "requireAuth"],
      ["post /api/service-schedules/:scheduleId/log", "requireAuth"],
    ] },
    { file: "notifications", register: "registerNotificationRoutes", inventory: [
      ["get /api/notification-preferences", "requireAuth"],
      ["put /api/notification-preferences", "requireAuth"],
      ["get /api/notifications", "requireAuth"],
      ["get /api/notifications/unread-count", "requireAuth"],
      ["put /api/notifications/read-all", "requireAuth"],
      ["put /api/notifications/:id/read", "requireAuth"],
    ] },
    { file: "push", register: "registerPushRoutes", inventory: [
      ["post /api/push-tokens", "requireAuth"],
      ["delete /api/push-tokens", "requireAuth"],
      ["post /api/push/due-reminders", "requireAdmin"],
    ] },
  ];
  const registrations = (source: string) => [...source.matchAll(/app\.(get|post|patch|put|delete)\("([^"]+)"/g)]
    .map(([, method, path]) => `${method} ${path}`);
  const allRegistrations = readdirSync(new URL("./routes/", import.meta.url))
    .filter(file => file.endsWith(".ts"))
    .flatMap(file => registrations(readFileSync(new URL(`./routes/${file}`, import.meta.url), "utf8")));
  for (const module of modules) {
    const source = readFileSync(new URL(`./routes/${module.file}.ts`, import.meta.url), "utf8");
    it(`preserves ${module.file} inventory, order, guards, wrappers and catches`, () => {
      const expected = module.inventory.map(([path]) => path);
      assert.deepEqual(registrations(source), expected);
      for (const path of expected) assert.equal(allRegistrations.filter(found => found === path).length, 1, path);
      assert.equal(main.split(`${module.register}(app);`).length - 1, 1);
      assert.equal((source.match(/route\(async /g) ?? []).length, expected.length);
      assert.equal((source.match(/^    try \{/gm) ?? []).length, expected.length);
      assert.equal((source.match(/^    \} catch \(error\) \{/gm) ?? []).length, expected.length);
      source.split("\n").filter(line => /^  app\./.test(line)).forEach((line, i) => {
        assert.ok(line.includes(`", ${module.inventory[i][1]}, route(async `), line);
      });
    });
    it(`keeps caller role and community decisions out of ${module.file}`, () => {
      assert.doesNotMatch(source, /\.role\b|\brole\s*[!=]==?|\.includes\([^)]*\brole\b/);
      assert.doesNotMatch(source, /userCanAccessCommunity\s*\(|canAccessCommunity\s*\(|isUserMemberOfCommunity\s*\(/);
      assert.doesNotMatch(source, /from ["']\.\.\/policy\//);
    });
  }
  it("keeps ping in main immediately before push and preserves the other original registration positions", () => {
    assert.doesNotMatch(main, /app\.\w+\(["'][^"']*(?:\/service-schedules|\/service-visits|\/api\/notification|\/api\/push-tokens|\/api\/push\/)/);
    assert.equal(registrations(main).filter(path => path === "get /api/ping").length, 1);
    assert.match(main, /app\.get\("\/api\/ping", [\s\S]*?res\.json\(\{ ok: true, ts: Date\.now\(\) \}\);\s*\}\);\s*registerPushRoutes\(app\);\s*registerAssetRoutes\(app\);/);
    assert.match(main, /registerServiceScheduleRoutes\(app\);\s*registerImportRoutes\(app\);/);
    const download = main.indexOf("  registerExportRoutes(app);");
    assert.ok(download >= 0 && download < main.indexOf("  registerServiceScheduleRoutes(app);"));
    assert.match(main, /registerHoaRoutes\(app\);\s*registerNotificationRoutes\(app\);\s*registerInvoiceRoutes\(app\);/);
  });
  it("reconstructs 7/6/3 handlers and preserves service and HOA extraction boundaries", () => {
    const harness = readFileSync(new URL("./testUtils/routeFixtureSource.ts", import.meta.url), "utf8");
    const fixture = readRouteFixtureSource();
    const between = (start: string, end: string) => {
      const from = fixture.indexOf(start), to = fixture.indexOf(end, from + start.length);
      assert.ok(from >= 0 && to > from, start);
      return registrations(fixture.slice(from, to));
    };
    for (const module of modules) {
      assert.ok(harness.includes(`["${module.file}", "${module.register}", ${module.inventory.length}]`));
    }
    assert.deepEqual(between('app.get("/api/communities/:communityId/service-schedules",', "// ── Master Bill import routes"),
      modules[0].inventory.map(([path]) => path));
    assert.deepEqual(between('app.get("/api/communities/:communityId/service-schedules",',
      'app.post("/api/communities/:communityId/service-schedules",'), [modules[0].inventory[0][0]]);
    assert.deepEqual(between('app.get("/api/service-schedules/:scheduleId/visits",', "// ── Master Bill import routes"),
      modules[0].inventory.slice(4).map(([path]) => path));
    assert.deepEqual(between('app.post("/api/hoa/requests",', 'app.get("/api/notification-preferences",'),
      ["post /api/hoa/requests"]);
    assert.deepEqual(between('app.get("/api/notification-preferences",', 'app.get("/api/invoices",'),
      modules[1].inventory.map(([path]) => path));
    assert.deepEqual(between('app.post("/api/push-tokens",', 'app.get("/api/communities/:communityId/assets",'),
      modules[2].inventory.map(([path]) => path));
    assert.deepEqual(between('app.post("/api/push-tokens",', 'app.delete("/api/push-tokens",'),
      [modules[2].inventory[0][0]]);
  });
  it("owns push throttle state in one module and preserves the main module re-export", () => {
    const push = readFileSync(new URL("./routes/push.ts", import.meta.url), "utf8");
    assert.match(main, /export \{ PUSH_TOKEN_RATE_LIMIT_MS, pushTokenLastReg \} from "\.\/push";/);
    assert.doesNotMatch(main, /(?:const|let) (?:PUSH_TOKEN_RATE_LIMIT_MS|pushTokenLastReg)\b/);
    assert.match(push, /export const PUSH_TOKEN_RATE_LIMIT_MS = 86_400_000;/);
    assert.match(push, /export const pushTokenLastReg = new Map/);
    const schedules = readFileSync(new URL("./routes/serviceSchedules.ts", import.meta.url), "utf8");
    assert.equal((schedules.match(/policy\.canViewServiceSchedules\(/g) ?? []).length, 3);
    assert.equal((schedules.match(/policy\.canLogServiceVisit\(/g) ?? []).length, 1);
    assert.match(schedules, /policy\.actorFromUser\(req\.currentUser!\)/);
  });
});

describe("user and company route structure", () => {
  const modules = [
    { file: "companies", register: "registerCompanyRoutes", inventory: [
      ["get /api/contractors", "requireAuth"],
      ["get /api/admin/companies", "requireAdmin"],
      ["post /api/admin/companies", "requireAdmin"],
      ["patch /api/admin/companies/:id", "requireAdmin"],
    ] },
    { file: "users", register: "registerUserRoutes", inventory: [
      ["get /api/users", "requireAuth"],
      ["put /api/users/:id/role", "requireAdmin"],
      ["post /api/admin/users", "requireAdmin"],
      ["patch /api/admin/users/:id", "requireAdmin"],
      ["delete /api/admin/users/:id", "requireAdmin"],
      ["get /api/users/:id/communities", "requireAdmin"],
      ["put /api/users/:id/status", "requireAuth"],
      ["get /api/portal/users", "requireAuth"],
      ["post /api/portal/users", "requireAuth"],
      ["put /api/portal/users/:id", "requireAuth"],
      ["delete /api/portal/users/:id", "requireAuth"],
    ] },
  ];
  const registrations = (source: string) => [...source.matchAll(/app\.(get|post|patch|put|delete)\("([^"]+)"/g)]
    .map(([, method, path]) => `${method} ${path}`);
  const allRegistrations = readdirSync(new URL("./routes/", import.meta.url))
    .filter(file => file.endsWith(".ts"))
    .flatMap(file => registrations(readFileSync(new URL(`./routes/${file}`, import.meta.url), "utf8")));
  for (const module of modules) {
    const source = readFileSync(new URL(`./routes/${module.file}.ts`, import.meta.url), "utf8");
    it(`preserves ${module.file} inventory, order, middleware, wrappers and catches`, () => {
      const expected = module.inventory.map(([path]) => path);
      assert.deepEqual(registrations(source), expected);
      for (const path of expected) assert.equal(allRegistrations.filter(found => found === path).length, 1, path);
      assert.equal(main.split(`${module.register}(app);`).length - 1, 1);
      assert.equal((source.match(/route\(async /g) ?? []).length, expected.length);
      assert.equal((source.match(/^    try \{/gm) ?? []).length, expected.length);
      assert.equal((source.match(/^    \} catch \(error\) \{/gm) ?? []).length, expected.length);
      source.split("\n").filter(line => /^  app\./.test(line)).forEach((line, i) => {
        assert.ok(line.includes(`", ${module.inventory[i][1]}, route(async `), line);
      });
    });
    it(`keeps ${module.file} caller and target-access decisions in policy`, () => {
      assert.doesNotMatch(source, /actor\.role\s*[!=]==?|\.includes\(actor\.role\)/);
      assert.doesNotMatch(source, /isHoaRole\s*\(|isUserMemberOfCommunity\s*\(/);
      assert.doesNotMatch(source, /targetUser\.role\s*[!=]==?/);
      assert.match(source, /import \* as policy from "\.\.\/policy"/);
      assert.doesNotMatch(source, /from ["']\.\.\/policy\//);
    });
  }
  it("removes moved paths and helpers from main and preserves the original register position", () => {
    assert.doesNotMatch(main, /app\.\w+\(["']\/api\/(?:users|admin\/users|portal\/users|admin\/companies|contractors)(?:[/"'])/);
    assert.doesNotMatch(main, /function (?:checkHoaLimits|companySelectionError|companyUniqueConflict)\(/);
    assert.match(main, /registerCompanyRoutes\(app\);\s*registerUserRoutes\(app\);\s*app\.get\("\/api\/ping"/);
    assert.ok(main.indexOf("  registerXeriscapeRoutes(app);") >= 0);
    assert.ok(main.indexOf("  registerXeriscapeRoutes(app);") <
      main.indexOf("  registerCompanyRoutes(app);"));
    assert.doesNotMatch(main, /function nextControllerKey\(/);
    assert.match(readFileSync(new URL("./routes/companies.ts", import.meta.url), "utf8"),
      /\/\/ Company management is intentionally staff-only, independent of community access\./);
  });
  it("reconstructs all 15 routes and unchanged helper/handler extraction boundaries", () => {
    const fixture = readRouteFixtureSource();
    const harness = readFileSync(new URL("./testUtils/routeFixtureSource.ts", import.meta.url), "utf8");
    assert.ok(harness.includes('["companies", "registerCompanyRoutes", 4]'));
    assert.ok(harness.includes('["users", "registerUserRoutes", 11]'));
    const start = fixture.indexOf('app.get("/api/contractors",');
    const end = fixture.indexOf('app.get("/api/ping",', start);
    assert.ok(start >= 0 && end > start);
    assert.deepEqual(registrations(fixture.slice(start, end)), modules.flatMap(module => module.inventory.map(([path]) => path)));
    const between = (from: string, to: string) => {
      const a = fixture.indexOf(from), b = fixture.indexOf(to, a + from.length);
      assert.ok(a >= 0 && b > a, from);
      return fixture.slice(a, b);
    };
    assert.match(between("async function companySelectionError(", "function companyUniqueConflict("),
      /Account managers must have a contractor company/);
    assert.match(between("async function checkHoaLimits(", "export async function registerRoutes("),
      /function companyUniqueConflict\(/);
    assert.ok(between('app.put("/api/users/:id/role",', 'app.get("/api/assets",'));
    assert.ok(between('app.get("/api/admin/companies",', 'app.delete("/api/admin/users/:id",'));
    assert.ok(between('app.put("/api/users/:id/status",', '/* ── Community-scoped user list'));
    assert.ok(between('app.put("/api/portal/users/:id",', 'app.get("/api/ping",'));
  });
  it("retains role expressions only for target validation and response filtering", () => {
    const source = readFileSync(new URL("./routes/users.ts", import.meta.url), "utf8");
    assert.deepEqual(source.match(/\b\w+\.role\b/g), [
      "query.role", "u.role", "existing.role", "targetUser.role",
    ]);
    assert.match(source, /targetHasHoaRole\(role\)/);
    assert.match(source, /isClientRole\(role\)/);
    assert.match(source, /isContractorSide\(targetUser\?\.role \|\| ""\)/);
    assert.match(source, /companyId === undefined && role !== "contractor_manager"/);
    assert.match(source, /validRoles\.includes\(role/);
    assert.match(source, /validPortalRoles\.includes\(role\)/);
  });
});

describe("user and company handler response compatibility", () => {
  const roles = ["admin", "property_manager", "contractor", "contractor_manager",
    "map_creator", "hoa_admin", "hoa_member", "client_admin"] as const;
  const users: Record<string, any> = Object.fromEntries(roles.map(role => [role, {
    id: role, role, hoaCommunityId: "member", companyId: null, organizationId: null,
  }]));
  users.unassigned = { id: "unassigned", role: "hoa_admin", hoaCommunityId: null };
  users.target = { id: "target", role: "hoa_member", hoaCommunityId: "member", password: "hidden" };
  users.other = { id: "other", role: "hoa_admin", hoaCommunityId: "outside" };
  users.board = { id: "board", role: "hoa_admin", hoaCommunityId: "member" };
  users.noCommunity = { id: "noCommunity", role: "hoa_member", hoaCommunityId: null };
  async function withHandlers(overrides: Record<string, any>, check: (
    request: (user: string, path: string, method?: string, body?: unknown) =>
      Promise<{ status: number; body: any }>,
    calls: any[][],
  ) => Promise<void>) {
    const calls: any[][] = [];
    const { api } = await policyFixture({
      getUserById: async (id: string) => { calls.push(["lookup", id]); return users[id]; },
      isUserMemberOfCommunity: async (_id: string, community: string) => {
        calls.push(["membership", community]); return community === "member";
      },
      getAllContractors: async () => [users.target],
      getContractorsForCommunity: async () => [users.target],
      getAllUsers: async () => [users.target, users.board],
      getUsersByCommunity: async () => [users.target],
      updateUserStatus: async (id: string, isActive: boolean) => {
        calls.push(["status", id, isActive]); return { ...users[id], isActive };
      },
      updateUserRole: async (...args: any[]) => { calls.push(["role", ...args]); return users[args[0]]; },
      revokeUserSessions: async (id: string) => { calls.push(["revoke", id]); },
      removeAllPushTokens: async (id: string) => { calls.push(["tokens", id]); },
      removeCommunityMember: async (...args: any[]) => { calls.push(["unlink", ...args]); },
      ...overrides,
    });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.session = { userId: req.headers["x-user"] } as any;
      req.log = { error() {} } as any;
      next();
    });
    api.registerCompanyRoutes(app);
    api.registerUserRoutes(app);
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
      }, calls);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  }
  it("preserves missing-actor messages, list errors and password redaction", async () => {
    await withHandlers({}, async request => {
      assert.deepEqual(await request("missing", "/api/contractors"),
        { status: 401, body: { error: "User not found" } });
      for (const [method, path] of [
        ["GET", "/api/users"], ["PUT", "/api/users/target/status"], ["GET", "/api/portal/users"],
        ["POST", "/api/portal/users"], ["PUT", "/api/portal/users/target"], ["DELETE", "/api/portal/users/target"],
      ]) assert.deepEqual(await request("missing", path, method, method === "GET" ? undefined : {}),
        { status: 401, body: { error: "Not authenticated" } });
      assert.deepEqual(await request("property_manager", "/api/contractors"),
        { status: 400, body: { error: "communityId is required" } });
      assert.deepEqual(await request("property_manager", "/api/contractors?communityId=outside"),
        { status: 403, body: { error: "You are not a member of this community" } });
      assert.deepEqual(await request("contractor_manager", "/api/contractors"),
        { status: 403, body: { error: "Access denied" } });
      assert.deepEqual(await request("property_manager", "/api/users"),
        { status: 400, body: { error: "communityId is required for this role" } });
      assert.deepEqual(await request("property_manager", "/api/users?communityId=outside"),
        { status: 403, body: { error: "Not a member of this community" } });
      assert.deepEqual(await request("hoa_admin", "/api/users?communityId=outside"),
        { status: 403, body: { error: "Access denied" } });
      assert.deepEqual(await request("admin", "/api/portal/users"),
        { status: 400, body: { error: "communityId is required" } });
      assert.deepEqual(await request("admin", "/api/portal/users?communityId=member"),
        { status: 403, body: { error: "Not authorized" } });
      assert.deepEqual(await request("admin", "/api/users?role=hoa_member"),
        { status: 200, body: [{ id: "target", role: "hoa_member", hoaCommunityId: "member" }] });
      for (const [person, path] of [
        ["admin", "/api/contractors"], ["property_manager", "/api/contractors?communityId=member"],
        ["property_manager", "/api/users?communityId=member"], ["hoa_admin", "/api/portal/users?communityId=member"],
      ]) assert.deepEqual(await request(person, path),
        { status: 200, body: [{ id: "target", role: "hoa_member", hoaCommunityId: "member" }] });
    });
  });
  it("preserves caller, missing-target, self, target-scope and boolean-validation order", async () => {
    await withHandlers({}, async (request, calls) => {
      for (const role of roles.filter(role => !["admin", "property_manager", "hoa_admin"].includes(role))) {
        calls.length = 0;
        assert.deepEqual(await request(role, "/api/users/missing/status", "PUT", {}),
          { status: 403, body: { error: "Not authorized" } });
        assert.deepEqual(calls, [["lookup", role]]);
      }
      assert.deepEqual(await request("admin", "/api/users/missing/status", "PUT", {}),
        { status: 404, body: { error: "User not found" } });
      for (const role of ["admin", "property_manager", "hoa_admin"]) assert.deepEqual(
        await request(role, `/api/users/${role}/status`, "PUT", {}),
        { status: 400, body: { error: "Cannot change your own status" } });
      assert.deepEqual(await request("hoa_admin", "/api/users/other/status", "PUT", {}),
        { status: 403, body: { error: "User is not in your community" } });
      assert.deepEqual(await request("hoa_admin", "/api/users/board/status", "PUT", {}),
        { status: 403, body: { error: "HOA Admins can only manage HOA Members" } });
      assert.deepEqual(await request("property_manager", "/api/users/noCommunity/status", "PUT", {}),
        { status: 403, body: { error: "User is not in your community" } });
      assert.deepEqual(await request("admin", "/api/users/target/status", "PUT", {}),
        { status: 400, body: { error: "isActive (boolean) is required" } });
      for (const [method, suffix, noCommunity, memberOnly, self] of [
        ["PUT", "edit", "User has no community assignment", "HOA Admins can only edit HOA Members", "Cannot edit yourself"],
        ["DELETE", "remove", "User has no community", "HOA Admins can only remove HOA Members", "Cannot remove yourself"],
      ]) {
        assert.ok(suffix);
        assert.deepEqual(await request("hoa_admin", "/api/portal/users/hoa_admin", method, {}),
          { status: 400, body: { error: self } });
        assert.deepEqual(await request("hoa_admin", "/api/portal/users/other", method, {}),
          { status: 403, body: { error: "User is not in your community" } });
        assert.deepEqual(await request("hoa_admin", "/api/portal/users/board", method, {}),
          { status: 403, body: { error: memberOnly } });
        assert.deepEqual(await request("property_manager", "/api/portal/users/noCommunity", method, {}),
          { status: 403, body: { error: noCommunity } });
      }
    });
  });
  it("retains portal create/assignment errors before username checks or writes", async () => {
    await withHandlers({ getUserByUsername: async () => { throw Error("must not reach username lookup"); } }, async request => {
      const input = { username: "new", password: "password", communityId: "outside", role: "admin" };
      assert.deepEqual(await request("admin", "/api/portal/users", "POST", {}),
        { status: 403, body: { error: "Not authorized" } });
      assert.deepEqual(await request("hoa_admin", "/api/portal/users", "POST", {}),
        { status: 400, body: { error: "username, password, and communityId are required" } });
      assert.deepEqual(await request("hoa_admin", "/api/portal/users", "POST", { ...input, password: "x" }),
        { status: 400, body: { error: "Password must be at least 6 characters" } });
      for (const [role, message] of [
        ["hoa_admin", "HOA Admins can only create HOA Member users"],
        ["property_manager", "Property Managers can only create HOA Admin or HOA Member users"],
      ]) assert.deepEqual(await request(role, "/api/portal/users", "POST", input),
        { status: 403, body: { error: message } });
      assert.deepEqual(await request("hoa_admin", "/api/portal/users", "POST", { ...input, role: "hoa_member" }),
        { status: 403, body: { error: "Access denied" } });
      assert.deepEqual(await request("property_manager", "/api/portal/users", "POST", { ...input, role: "hoa_member" }),
        { status: 403, body: { error: "Not a member of this community" } });
      for (const [person, message] of [
        ["hoa_admin", "HOA Admins can only assign HOA Member role"],
        ["property_manager", "Property Managers can only assign HOA Admin or HOA Member roles"],
      ]) assert.deepEqual(await request(person, "/api/portal/users/target", "PUT", { role: "admin", isActive: false }),
        { status: 403, body: { error: message } });
    });
  });
  it("keeps deactivation revocation, activation and community unlinking distinct", async () => {
    await withHandlers({}, async (request, calls) => {
      for (const [person, path] of [
        ["admin", "/api/users/target/status"], ["property_manager", "/api/portal/users/target"],
      ]) {
        calls.length = 0;
        assert.equal((await request(person, path, "PUT", { isActive: false })).status, 200);
        assert.deepEqual(calls.filter(([name]) => ["status", "revoke", "tokens"].includes(name)),
          [["status", "target", false], ["revoke", "target"], ["tokens", "target"]]);
        calls.length = 0;
        assert.equal((await request(person, path, "PUT", { isActive: true })).status, 200);
        assert.deepEqual(calls.filter(([name]) => ["status", "revoke", "tokens"].includes(name)),
          [["status", "target", true]]);
      }
      calls.length = 0;
      assert.deepEqual(await request("property_manager", "/api/portal/users/target", "DELETE"),
        { status: 200, body: { message: "User removed from community" } });
      assert.deepEqual(calls.filter(([name]) => !["lookup", "membership"].includes(name)),
        [["unlink", "member", "target"], ["role", "target", "hoa_member", null], ["revoke", "target"]]);
      assert.equal(users.target.hoaCommunityId, "member", "fixture records were not mutated");
      assert.equal((await request("unassigned", "/api/users/noCommunity/status", "PUT", { isActive: true })).status, 200);
      assert.equal((await request("unassigned", "/api/portal/users/noCommunity", "PUT", { isActive: true })).status, 200);
    });
  });
  it("keeps the status route's failing membership lookup and portal short-circuit responses", async () => {
    await withHandlers({ isUserMemberOfCommunity: async () => { throw Error("Expected lookup failure"); } }, async request => {
      assert.deepEqual(await request("property_manager", "/api/users/noCommunity/status", "PUT", {}),
        { status: 500, body: { error: "Failed to update user status" } });
      assert.deepEqual(await request("property_manager", "/api/portal/users/noCommunity", "PUT", {}),
        { status: 403, body: { error: "User has no community assignment" } });
      assert.deepEqual(await request("property_manager", "/api/portal/users/noCommunity", "DELETE"),
        { status: 403, body: { error: "User has no community" } });
    });
  });
  it("retains all 15 route-specific 500 responses", async () => {
    const fail = async () => { throw Error("Expected fixture failure"); };
    await withHandlers({
      getUserById: fail, listCompanies: fail, findSimilarCompanies: fail, getUserCommunitiesList: fail,
      getUserByUsername: fail, getHoaUserCountByCommunity: fail,
    }, async request => {
      for (const [method, path, body, message] of [
        ["GET", "/api/contractors", undefined, "Failed to fetch contractors"],
        ["GET", "/api/admin/companies", undefined, "Failed to fetch companies"],
        ["POST", "/api/admin/companies", { name: "Valid", kind: "contractor" }, "Failed to create company"],
        ["PATCH", "/api/admin/companies/id", { name: "Valid" }, "Failed to update company"],
        ["GET", "/api/users", undefined, "Failed to fetch users"],
        ["PUT", "/api/users/id/role", { role: "contractor" }, "Failed to update role"],
        ["POST", "/api/admin/users", { username: "new", password: "password" }, "Failed to create user"],
        ["PATCH", "/api/admin/users/id", { displayName: "New" }, "Failed to update user"],
        ["DELETE", "/api/admin/users/id", undefined, "Failed to delete user"],
        ["GET", "/api/users/id/communities", undefined, "Failed to fetch user communities"],
        ["PUT", "/api/users/id/status", {}, "Failed to update user status"],
        ["GET", "/api/portal/users?communityId=member", undefined, "Failed to fetch users"],
        ["POST", "/api/portal/users", {}, "Failed to create user"],
        ["PUT", "/api/portal/users/id", {}, "Failed to edit user"],
        ["DELETE", "/api/portal/users/id", undefined, "Failed to remove user from community"],
      ] as const) assert.deepEqual(await request("admin", path, method, body), { status: 500, body: { error: message } });
    });
  });
});

describe("community, dashboard and search route structure", () => {
  const modules = [
    { file: "communities", register: "registerCommunityRoutes", inventory: [
      ["get /api/communities", "requireAuth"],
      ["post /api/communities", "requireAdminOrMapCreator"],
      ["patch /api/communities/:id", "requireAdmin"],
      ["get /api/communities/:id/bounds", "requireAuth"],
      ["get /api/communities/:id/crew", "requireAuth"],
      ["get /api/communities/:id/members", "requireAuth"],
      ["post /api/communities/:id/members", "requireAdmin"],
      ["delete /api/communities/:id/members/:userId", "requireAdmin"],
      ["delete /api/communities/:id/companies/:companyId", "requireAdmin"],
      ["get /api/communities/:id/controllers", "requireAuth"],
    ] },
    { file: "dashboard", register: "registerDashboardRoutes", inventory: [
      ["get /api/dashboard", "requireAuth"], ["get /api/dashboard/role", "requireAuth"],
    ] },
    { file: "search", register: "registerSearchRoutes", inventory: [
      ["get /api/communities/:communityId/assets/completeness", "requireAdmin"],
      ["get /api/communities/:communityId/assets/incomplete", "requireAdmin"],
      ["get /api/search", "requireAuth"],
    ] },
  ];
  const registrations = (source: string) => [...source.matchAll(/app\.(get|post|patch|put|delete)\("([^"]+)"/g)]
    .map(([, method, path]) => `${method} ${path}`);
  const allRegistrations = readdirSync(new URL("./routes/", import.meta.url))
    .filter(file => file.endsWith(".ts"))
    .flatMap(file => registrations(readFileSync(new URL(`./routes/${file}`, import.meta.url), "utf8")));
  for (const module of modules) {
    const source = readFileSync(new URL(`./routes/${module.file}.ts`, import.meta.url), "utf8");
    it(`retains the exact ${module.file} inventory, order, guards and wrappers`, () => {
      const expected = module.inventory.map(([path]) => path);
      assert.deepEqual(registrations(source), expected);
      for (const path of expected) assert.equal(allRegistrations.filter(found => found === path).length, 1, path);
      assert.equal(main.split(`${module.register}(app);`).length - 1, 1);
      assert.equal((source.match(/route\(async /g) ?? []).length, expected.length);
      assert.equal((source.match(/^    try \{/gm) ?? []).length, expected.length);
      assert.equal((source.match(/^    \} catch \(error\) \{/gm) ?? []).length, expected.length);
      const declarations = source.split("\n").filter(line => /^  app\./.test(line));
      declarations.forEach((line, i) => {
        assert.ok(line.includes(`", ${module.inventory[i][1]}, route(async `), line);
      });
    });
    it(`keeps all ${module.file} permission decisions in policy`, () => {
      assert.doesNotMatch(source, /\.role\s*[!=]==?|\.includes\([^)]*\brole\b/);
      assert.doesNotMatch(source, /isHoaRole\s*\(|isMapCreatorRole\s*\(|isUserMemberOfCommunity\s*\(|userCanAccessCommunity\s*\(/);
      assert.match(source, /import \* as policy from "\.\.\/policy"/);
      assert.doesNotMatch(source, /from ["']\.\.\/policy\//);
    });
  }
  it("preserves register positions and leaves no community paths in main", () => {
    assert.match(main, /registerObjectRoutes\(app\);\s*registerCommunityRoutes\(app\);\s*registerDashboardRoutes\(app\);\s*registerTaskRoutes\(app\);/);
    assert.match(main, /registerMapLayerRoutes\(app\);\s*registerSearchRoutes\(app\);\s*\/\/ ── Asset Types catalogue/);
    assert.doesNotMatch(main, /app\.\w+\(["']\/api\/(?:dashboard|search)/);
    // Approved F3j exception: service routes now live in serviceSchedules.ts.
    assert.deepEqual(registrations(main).filter(path => /^\w+ \/api\/communities(?:\/|$)/.test(path)), []);
  });
  it("reconstructs 10/2/3 handlers with the original cross-module fixture boundaries", () => {
    const harness = readFileSync(new URL("./testUtils/routeFixtureSource.ts", import.meta.url), "utf8");
    for (const [file, register, count] of [
      ["communities", "registerCommunityRoutes", 10], ["dashboard", "registerDashboardRoutes", 2],
      ["search", "registerSearchRoutes", 3],
    ] as const) assert.ok(harness.includes(`["${file}", "${register}", ${count}]`));
    const fixture = readRouteFixtureSource();
    const between = (start: string, end: string) => {
      const from = fixture.indexOf(start), to = fixture.indexOf(end, from + start.length);
      assert.ok(from >= 0 && to > from, start);
      return fixture.slice(from, to);
    };
    assert.deepEqual(registrations(between('app.get("/api/map-layers/:id/summary",',
      'app.get("/api/communities/:communityId/assets/completeness",')), ["get /api/map-layers/:id/summary"]);
    assert.deepEqual(registrations(between('app.get("/api/communities/:id/crew",',
      'app.get("/api/communities/:id/controllers",')), modules[0].inventory.slice(4, 9).map(([path]) => path));
    assert.deepEqual(registrations(between('app.get("/api/dashboard",',
      'app.get("/api/admin/migrations",')).slice(0, 2), modules[1].inventory.map(([path]) => path));
    assert.deepEqual(registrations(between('app.get("/api/search",', "// ── Asset Types catalogue")), ["get /api/search"]);
    assert.ok(between('app.post("/api/objects/confirm",', 'app.get("/api/communities",'));
  });
  it("retains every other user lookup, the list actor exception and the two non-decision role values", () => {
    const communities = readFileSync(new URL("./routes/communities.ts", import.meta.url), "utf8");
    const dashboard = readFileSync(new URL("./routes/dashboard.ts", import.meta.url), "utf8");
    const search = readFileSync(new URL("./routes/search.ts", import.meta.url), "utf8");
    assert.equal((communities.match(/storage\.getUserById\(/g) ?? []).length, 1);
    assert.equal((dashboard.match(/storage\.getUserById\(/g) ?? []).length, 2);
    assert.equal((search.match(/storage\.getUserById\(/g) ?? []).length, 1);
    assert.match(communities, /policy\.communityListPlan\(policy\.actorFromUser\(req\.currentUser!\)\)/);
    assert.deepEqual(communities.match(/\b\w+\.role\b/g), ["user.role"]);
    assert.match(communities, /role: m\.user\.role/);
    assert.deepEqual(dashboard.match(/\b\w+\.role\b/g), ["user.role"]);
    assert.match(dashboard, /storage\.getDashboardDataForRole\(user\.role, user\.id, communityId\)/);
    assert.doesNotMatch(search, /\.role\b/);
  });
});

describe("community, dashboard and search handler response compatibility", () => {
  const roles = ["admin", "property_manager", "contractor", "contractor_manager",
    "map_creator", "hoa_admin", "hoa_member", "client_admin"] as const;
  const users: Record<string, any> = Object.fromEntries(roles.map(role => [role, {
    id: role, role, companyId: role === "contractor_manager" ? "own-company" : null,
    hoaCommunityId: role === "hoa_admin" || role === "hoa_member" ? "member" : null,
    organizationId: role === "client_admin" ? "org" : null,
  }]));
  users.unassigned = { id: "unassigned", role: "hoa_admin", hoaCommunityId: null };
  const communities = [{ id: "member", organizationId: null }, { id: "branch", organizationId: "org" }];
  async function withHandlers(overrides: Record<string, any>, check: (
    request: (user: string, path: string, method?: string, body?: unknown) =>
      Promise<{ status: number; body: any }>,
  ) => Promise<void>) {
    const { api } = await policyFixture({
      getUserById: async (id: string) => users[id],
      getCommunities: async () => communities,
      getCommunityById: async (id: string) => communities.find(community => community.id === id),
      getUserCommunities: async () => communities.map(community => ({ community })),
      isUserMemberOfCommunity: async (_id: string, community: string) => ["member", "branch"].includes(community),
      getDashboardData: async (...args: any[]) => ({ args }),
      getDashboardDataForRole: async (...args: any[]) => ({ args }),
      searchAll: async (...args: any[]) => ({ args }),
      ...overrides,
    });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const id = req.headers["x-user"] as string;
      req.currentUser = users[id];
      req.session = { userId: id } as any;
      req.log = { error() {} } as any;
      next();
    });
    api.registerCommunityRoutes(app);
    api.registerDashboardRoutes(app);
    api.registerSearchRoutes(app);
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
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  }

  it("preserves every role's community picker and uses only the approved live list actor", async () => {
    await withHandlers({
      getUserById: async () => { throw Error("The list must not re-fetch its actor"); },
    }, async request => {
      for (const role of roles) {
        assert.deepEqual(await request(role, "/api/communities"), {
          status: 200, body: role === "admin" || role === "map_creator" ? communities : [communities[0]],
        });
      }
      assert.deepEqual(await request("unassigned", "/api/communities"), { status: 200, body: [communities[0]] });
    });
    await withHandlers({ getCommunityById: async () => undefined }, async request => {
      assert.deepEqual(await request("hoa_admin", "/api/communities"), { status: 200, body: [] });
    });
  });

  it("retains create/rename inputs and adds only map creators as new members", async () => {
    const calls: any[][] = [];
    await withHandlers({
      createCommunity: async (data: any) => { calls.push(["create", data]); return { id: "created", ...data }; },
      addCommunityMember: async (...args: any[]) => { calls.push(["join", ...args]); },
      updateCommunity: async (id: string, data: any) => id === "missing" ? undefined : { id, ...data },
    }, async request => {
      const invalid = await request("admin", "/api/communities", "POST", {});
      assert.equal(invalid.status, 400);
      assert.equal(invalid.body.error, "Invalid input");
      assert.ok(invalid.body.details);
      assert.deepEqual(calls, []);
      for (const role of ["admin", "map_creator"]) {
        assert.deepEqual(await request(role, "/api/communities", "POST", { name: "New", description: "Desc", ignored: true }),
          { status: 201, body: { id: "created", name: "New", description: "Desc" } });
      }
      assert.deepEqual(calls, [
        ["create", { name: "New", description: "Desc" }],
        ["create", { name: "New", description: "Desc" }], ["join", "created", "map_creator"],
      ]);
      assert.deepEqual(await request("admin", "/api/communities/member", "PATCH", { name: "Renamed", description: null, ignored: true }),
        { status: 200, body: { id: "member", name: "Renamed", description: null } });
      assert.deepEqual(await request("admin", "/api/communities/missing", "PATCH", { name: "Renamed" }),
        { status: 404, body: { error: "Community not found" } });
    });
  });

  it("retains member-field visibility for every role", async () => {
    await withHandlers({
      getCommunityById: async (id: string) => ({ id, organizationId: "org" }),
      getCommunityMembers: async () => [{
        id: "membership", userId: "crew", joinedAt: "date", companyName: "Company",
        user: { displayName: "Crew", username: "private", role: "contractor" },
      }],
    }, async request => {
      for (const role of roles) assert.deepEqual(await request(role, "/api/communities/member/members"), {
        status: 200, body: [{
          id: "membership", userId: "crew", displayName: "Crew", role: "contractor", joinedAt: "date",
          ...(role === "admin" ? { username: "private" } : {}),
          ...(role === "admin" || role === "property_manager" ? { companyName: "Company" } : {}),
        }],
      });
    });
  });

  it("retains membership administration responses, company checks and input precedence", async () => {
    const calls: any[][] = [];
    await withHandlers({
      getCompanyById: async (id: string) => id === "missing" ? undefined : { id, isActive: id !== "inactive" },
      getCompanyUserIds: async (id: string) => id === "empty" ? [] : ["company-user"],
      addCommunityMembers: async (...args: any[]) => { calls.push(["add", ...args]); return { added: 1, skipped: 0 }; },
      removeCommunityMember: async (...args: any[]) => { calls.push(["remove", ...args]); },
      removeCompanyCommunityMembers: async (...args: any[]) => { calls.push(["remove-company", ...args]); return { removed: 1 }; },
    }, async request => {
      const path = "/api/communities/member/members";
      for (const [body, ids] of [
        [{ userId: "single" }, ["single"]],
        [{ userIds: ["list"], userId: "ignored" }, ["list"]],
        [{ companyId: "active", userIds: ["ignored"] }, ["company-user"]],
      ] as const) {
        assert.deepEqual(await request("admin", path, "POST", body), { status: 201, body: { added: 1, skipped: 0 } });
        assert.deepEqual(calls.at(-1), ["add", "member", ids]);
      }
      assert.deepEqual(await request("admin", path, "POST", {}), { status: 400, body: { error: "userId or userIds[] is required" } });
      for (const companyId of ["missing", null, 42]) assert.deepEqual(
        await request("admin", path, "POST", { companyId }), { status: 404, body: { error: "Company not found" } });
      assert.deepEqual(await request("admin", path, "POST", { companyId: "inactive" }),
        { status: 400, body: { error: "Company not found" } });
      assert.deepEqual(await request("admin", path, "POST", { companyId: "empty" }), { status: 201, body: { added: 0, skipped: 0 } });
      assert.deepEqual(await request("admin", path + "/crew", "DELETE"), { status: 200, body: { message: "Member removed" } });
      assert.deepEqual(calls.at(-1), ["remove", "member", "crew"]);
      assert.deepEqual(await request("admin", "/api/communities/member/companies/missing", "DELETE"),
        { status: 404, body: { error: "Company not found" } });
      assert.deepEqual(await request("admin", "/api/communities/member/companies/active", "DELETE"), { status: 200, body: { removed: 1 } });
      assert.deepEqual(calls.at(-1), ["remove-company", "member", "active"]);
    });
  });

  it("retains crew role/company restrictions and validation responses", async () => {
    await withHandlers({ getCompanyCrew: async (...args: any[]) => args }, async request => {
      assert.deepEqual(await request("admin", "/api/communities/outside/crew?companyId=selected"),
        { status: 200, body: ["outside", "selected"] });
      assert.deepEqual(await request("admin", "/api/communities/member/crew"),
        { status: 400, body: { error: "companyId is required" } });
      assert.deepEqual(await request("admin", "/api/communities/member/crew?companyId=a&companyId=b"),
        { status: 400, body: { error: "companyId is required" } });
      assert.deepEqual(await request("contractor_manager", "/api/communities/member/crew?companyId=foreign"),
        { status: 200, body: ["member", "own-company"] });
      assert.deepEqual(await request("contractor_manager", "/api/communities/outside/crew"),
        { status: 403, body: { error: "Access denied" } });
      for (const role of roles.filter(role => role !== "admin" && role !== "contractor_manager")) {
        assert.deepEqual(await request(role, "/api/communities/member/crew?companyId=own-company"),
          { status: 403, body: { error: "Access denied" } });
      }
    });
  });

  it("retains dashboard flags, role arguments, HOA query ignoring and unassigned denial", async () => {
    await withHandlers({}, async request => {
      for (const role of roles) {
        assert.deepEqual(await request(role, "/api/dashboard?communityId=member"),
          { status: 200, body: { args: [role, "member", role === "admin"] } });
        assert.deepEqual(await request(role, "/api/dashboard"),
          { status: 400, body: { error: "communityId is required" } });
        assert.deepEqual(await request(role, "/api/dashboard?communityId=outside"), role === "admin" ?
          { status: 200, body: { args: [role, "outside", true] } } :
          { status: 403, body: { error: "You are not a member of this community" } });
        const hoa = role === "hoa_admin" || role === "hoa_member";
        assert.deepEqual(await request(role, "/api/dashboard/role?communityId=member"),
          { status: 200, body: { args: [role, role, "member"] } });
        assert.deepEqual(await request(role, "/api/dashboard/role"), hoa ?
          { status: 200, body: { args: [role, role, "member"] } } :
          { status: 400, body: { error: "communityId is required" } });
        assert.deepEqual(await request(role, "/api/dashboard/role?communityId=outside"),
          hoa || role === "admin" ? { status: 200, body: { args: [role, role, hoa ? "member" : "outside"] } } :
            { status: 403, body: { error: "You are not a member of this community" } });
      }
      for (const query of ["", "?communityId=member"]) assert.deepEqual(await request("unassigned", "/api/dashboard/role" + query),
        { status: 403, body: { error: "HOA user is not assigned to a community" } });
    });
  });

  it("retains search trimming, type parsing, role flags and commercial-branch exclusions", async () => {
    await withHandlers({}, async request => {
      for (const role of roles) {
        assert.deepEqual(await request(role, "/api/search?q=%20find%20&types=task,%20asset%20,,"),
          { status: 200, body: { args: ["find", role === "admin" ? ["member", "branch"] : ["member"],
            ["task", "asset"], role, role === "admin"] } });
        assert.deepEqual(await request(role, "/api/search?q=find&communityId=member"),
          { status: 200, body: { args: ["find", ["member"], [], role, role === "admin"] } });
        for (const community of ["branch", "outside"]) {
          assert.deepEqual(await request(role, `/api/search?q=find&communityId=${community}`), role === "admin" ?
            { status: 200, body: { args: ["find", [community], [], role, true] } } :
            { status: 403, body: { error: "Not a member of this community" } });
        }
      }
    });
  });

  it("keeps empty-search short-circuiting and all four historical missing-user 401 responses", async () => {
    const lookups: string[] = [];
    await withHandlers({ getUserById: async (id: string) => { lookups.push(id); return undefined; } }, async request => {
      assert.deepEqual(await request("missing", "/api/search?q=%20"), { status: 200, body: [] });
      assert.deepEqual(lookups, []);
      for (const path of ["/api/dashboard", "/api/dashboard/role", "/api/search?q=find", "/api/communities/member/controllers"]) {
        assert.deepEqual(await request("missing", path), { status: 401, body: { error: "User not found" } });
      }
      assert.deepEqual(lookups, ["missing", "missing", "missing", "missing"]);
    });
  });

  it("retains completeness counts, required-field calculation and incomplete query arguments", async () => {
    const propertyReads: string[] = [];
    await withHandlers({
      assetTypeRows: async () => [{ key: "tree", requiredKeys: ["species", "size"] }],
      getAssetsByCommunitySorted: async (...args: any[]) => {
        assert.deepEqual(args, ["member", "tree", true]);
        return [
          { id: "complete", label: "Complete", assetType: "tree", isArchived: false },
          { id: "incomplete", label: "Incomplete", assetType: "tree", isArchived: false },
          { id: "archived", assetType: "tree", isArchived: true },
        ];
      },
      getAssetProperties: async (id: string) => {
        propertyReads.push(id);
        return id === "complete" ? [{ key: "species" }, { key: "size" }] : [{ key: "species" }];
      },
      getIncompleteAssets: async (...args: any[]) => args,
    }, async request => {
      assert.deepEqual(await request("admin", "/api/communities/member/assets/completeness?type=tree"), {
        status: 200, body: { total: 3, active: 2, archived: 1, missingRequired: 1,
          missingRequiredAssets: [{ id: "incomplete", label: "Incomplete", assetType: "tree", missingKeys: ["size"] }] },
      });
      assert.deepEqual(propertyReads, ["complete", "incomplete"]);
      assert.deepEqual(await request("admin", "/api/communities/member/assets/incomplete?assetType=tree&mapLayerId=layer&missingKey=size"),
        { status: 200, body: ["member", "tree", "layer", "size"] });
    });
  });

  it("retains controller membership checks and controller/zone response shaping", async () => {
    await withHandlers({
      getAssetsByCommunitySorted: async (_id: string, type: string) => type === "controller" ? [
        { id: "archived", isArchived: true }, { id: "controller", label: "Control", featureRef: "ref", latitude: 1, longitude: 2 },
      ] : [
        { id: "zone", label: "Zone", featureRef: "zone-ref", latitude: 3, longitude: 4 },
        { id: "archived-zone", isArchived: true },
      ],
      getAssetPropertiesBulk: async () => [
        { assetId: "controller", key: "controllerKey", value: "A" },
        { assetId: "zone", key: "controllerFeatureRef", value: "ref" },
        { assetId: "zone", key: "zoneNumber", value: "2" },
      ],
    }, async request => {
      assert.deepEqual(await request("admin", "/api/communities/outside/controllers"), {
        status: 200, body: [{
          id: "controller", label: "Control", featureRef: "ref", controllerKey: "A", controllerColor: "#999999",
          latitude: 1, longitude: 2, zoneCount: 1, zones: [{
            id: "zone", label: "Zone", featureRef: "zone-ref", zoneNumber: 2, zoneType: null, zoneLabelShort: null,
            zoneColor: null, valveBoxRef: null, valveBoxLabel: null, latitude: 3, longitude: 4,
          }],
        }],
      });
      for (const role of roles.filter(role => role !== "admin")) assert.deepEqual(
        await request(role, "/api/communities/outside/controllers"),
        { status: 403, body: { error: "You are not a member of this community" } });
    });
  });

  it("retains each moved handler's historical 500 body", async () => {
    const fail = async () => { throw Error("Expected fixture failure"); };
    await withHandlers({
      getCommunities: fail, createCommunity: fail, updateCommunity: fail, getCommunityBounds: fail,
      getCompanyCrew: fail, getCommunityMembers: fail, addCommunityMembers: fail, removeCommunityMember: fail,
      getCompanyById: fail, getAssetsByCommunitySorted: fail, getDashboardData: fail,
      getDashboardDataForRole: fail, getIncompleteAssets: fail, searchAll: fail,
    }, async request => {
      for (const [method, path, body, message] of [
        ["GET", "/api/communities", undefined, "Failed to fetch communities"],
        ["POST", "/api/communities", { name: "New" }, "Failed to create community"],
        ["PATCH", "/api/communities/member", {}, "Failed to update community"],
        ["GET", "/api/communities/member/bounds", undefined, "Failed to compute community bounds"],
        ["GET", "/api/communities/member/crew?companyId=company", undefined, "Failed to fetch crew"],
        ["GET", "/api/communities/member/members", undefined, "Failed to fetch members"],
        ["POST", "/api/communities/member/members", { userId: "crew" }, "Failed to add member"],
        ["DELETE", "/api/communities/member/members/crew", undefined, "Failed to remove member"],
        ["DELETE", "/api/communities/member/companies/company", undefined, "Failed to remove company members"],
        ["GET", "/api/communities/member/controllers", undefined, "Failed to fetch controllers"],
        ["GET", "/api/dashboard?communityId=member", undefined, "Failed to fetch dashboard data"],
        ["GET", "/api/dashboard/role?communityId=member", undefined, "Failed to fetch dashboard data"],
        ["GET", "/api/communities/member/assets/completeness", undefined, "Failed to fetch asset completeness"],
        ["GET", "/api/communities/member/assets/incomplete", undefined, "Failed to fetch incomplete assets"],
        ["GET", "/api/search?q=find&communityId=member", undefined, "Search failed"],
      ] as const) assert.deepEqual(await request("admin", path, method, body), { status: 500, body: { error: message } });
    });
  });
});

describe("object, drive and contact route structure", () => {
  const modules = [
    { file: "objects", register: "registerObjectRoutes", inventory: [
      "get /public-objects/{*filePath}", "get /objects/{*objectPath}",
      "post /api/objects/upload", "delete /api/objects", "post /api/objects/confirm",
    ] },
    { file: "drive", register: "registerDriveRoutes", inventory: [
      "get /api/drive", "post /api/drive/folders", "patch /api/drive/folders/:id",
      "delete /api/drive/folders/:id", "post /api/drive/files", "patch /api/drive/files/:id",
      "delete /api/drive/files/:id", "get /api/drive/files/:id/download",
    ] },
    { file: "contacts", register: "registerContactRoutes", inventory: [
      "get /api/contacts", "post /api/contacts", "put /api/contacts/:id", "delete /api/contacts/:id",
    ] },
  ];
  for (const module of modules) {
    const source = readFileSync(new URL(`./routes/${module.file}.ts`, import.meta.url), "utf8");
    it(`keeps the ${module.file} inventory, middleware, wrappers and registration order`, () => {
      assert.deepEqual([...source.matchAll(/app\.(get|post|patch|put|delete)\("([^"]+)"/g)]
        .map(([, method, path]) => `${method} ${path}`), module.inventory);
      assert.equal(main.split(`${module.register}(app);`).length - 1, 1);
      assert.equal((source.match(/route\(async /g) ?? []).length, module.inventory.length);
      assert.equal((source.match(/^    try \{/gm) ?? []).length, module.inventory.length);
      const declarations = source.split("\n").filter(line => /^  app\./.test(line));
      declarations.forEach((line, i) => {
        if (module.file === "objects" && i === 0) {
          assert.match(line, /", route\(async /);
          assert.doesNotMatch(line, /requireAuth/);
        } else {
          assert.match(line, /", requireAuth, route\(async /);
        }
      });
    });
    it(`keeps ${module.file} role and community decisions in central policy`, () => {
      assert.doesNotMatch(source, /\.role\s*[!=]==?|\.includes\([^)]*\.role/);
      assert.doesNotMatch(source, /isHoaRole\s*\(|isUserMemberOfCommunity\s*\(|userCanAccessCommunity\s*\(/);
      assert.match(source, /import \* as policy from "\.\.\/policy"/);
      assert.doesNotMatch(source, /from ["']\.\.\/policy\//);
    });
  }
  it("removes all moved paths from main and retains their exact registration positions", () => {
    assert.doesNotMatch(main, /app\.\w+\(["']\/(?:objects|public-objects|api\/(?:objects|drive|contacts))/);
    assert.match(main, /app\.use\("\/api", enforceHoaScoping\);\s*app\.use\("\/api", enforceOrgScoping\);\s*registerObjectRoutes\(app\);\s*registerCommunityRoutes\(app\);/);
    assert.match(main, /registerContractRoutes\(app\);\s*registerDriveRoutes\(app\);\s*registerContactRoutes\(app\);\s*registerPortfolioRoutes\(app\);/);
  });
  it("removes unused drive constants while retaining policy decisions", () => {
    const drive = readFileSync(new URL("./routes/drive.ts", import.meta.url), "utf8");
    assert.match(drive, /export function registerDriveRoutes\(app: Express\): void \{/);
    for (const constant of ["driveMutateRoles", "driveReadRoles"]) {
      assert.equal(drive.split(constant).length - 1, 0);
    }
    assert.equal((drive.match(/requireDriveAccess\(req, res, policy.canReadDrive\)/g) ?? []).length, 2);
    assert.equal((drive.match(/requireDriveAccess\(req, res, policy.canChangeDrive\)/g) ?? []).length, 6);
    assert.match(drive, /policy\.canUseCommunityDrive\(policy\.actorFromUser\(user\), communityId\)/);
  });
  it("keeps task-attachment scope before object lookup and ACL enforcement", () => {
    const objects = readFileSync(new URL("./routes/objects.ts", import.meta.url), "utf8");
    const start = objects.indexOf('app.get("/objects/');
    const end = objects.indexOf('app.post("/api/objects/upload"');
    const read = objects.slice(start, end);
    const order = ["policy.needsManagerTaskObjectCheck(", "storage.canManagerReadTaskObject(",
      "objectStorageService.getObjectEntityFile(", "objectStorageService.canAccessObjectEntity(",
      "objectStorageService.downloadObject("];
    order.forEach((expression, i) => {
      assert.ok(read.includes(expression));
      if (i) assert.ok(read.indexOf(order[i - 1]) < read.indexOf(expression));
    });
  });
  it("reconstructs exactly 5/8/4 production handlers for existing fixture consumers", () => {
    const source = readFileSync(new URL("./testUtils/routeFixtureSource.ts", import.meta.url), "utf8");
    assert.match(source, /\["objects", "registerObjectRoutes", 5\]/);
    assert.match(source, /\["drive", "registerDriveRoutes", 8\]/);
    assert.match(source, /\["contacts", "registerContactRoutes", 4\]/);
  });
});

describe("drive and contact handler response compatibility", () => {
  const users: Record<string, any> = {
    admin: { id: "admin", role: "admin" },
    pm: { id: "pm", role: "property_manager" },
    hoa: { id: "hoa", role: "hoa_admin", hoaCommunityId: "member-community" },
    unassigned: { id: "unassigned", role: "hoa_admin" },
    reader: { id: "reader", role: "hoa_member", hoaCommunityId: "member-community" },
    crew: { id: "crew", role: "contractor" },
  };
  async function withHandlers(overrides: Record<string, any>, check: (
    request: (user: string, path: string, method?: string, body?: unknown) =>
      Promise<{ status: number; body: any }>,
  ) => Promise<void>) {
    const { api } = await policyFixture({
      getUserById: async (id: string) => users[id],
      getDriveFolder: async (id: string) => id === "missing" ? undefined : { id, communityId: "member-community" },
      getDriveFile: async (id: string) => id === "missing" ? undefined :
        { id, communityId: "member-community", fileRef: "/objects/file", name: "Report.pdf" },
      getContactById: async (id: string) => id === "missing" ? undefined : { id, communityId: "member-community" },
      ...overrides,
    });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.session = { userId: req.headers["x-user"] } as any;
      req.log = { error() {} } as any;
      next();
    });
    api.registerDriveRoutes(app);
    api.registerContactRoutes(app);
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
        return { status: response.status, body: response.status === 204 ? null : await response.json() };
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  }

  it("retains missing-user bodies and drive read/write differences before validation and lookups", async () => {
    await withHandlers({}, async request => {
      for (const [method, path] of [
        ["GET", "/api/drive"], ["POST", "/api/drive/folders"],
        ["PATCH", "/api/drive/folders/missing"], ["DELETE", "/api/drive/folders/missing"],
        ["POST", "/api/drive/files"], ["PATCH", "/api/drive/files/missing"],
        ["DELETE", "/api/drive/files/missing"], ["GET", "/api/drive/files/missing/download"],
      ]) {
        assert.deepEqual(await request("missing-user", path, method, method === "GET" ? undefined : {}),
          { status: 403, body: { error: "Access denied" } });
        assert.deepEqual(await request("crew", path, method, method === "GET" ? undefined : {}),
          { status: 403, body: { error: "Access denied" } });
        if (method !== "GET") assert.deepEqual(await request("reader", path, method, {}),
          { status: 403, body: { error: "Access denied" } });
      }
      for (const [method, path] of [
        ["GET", "/api/contacts"], ["POST", "/api/contacts"],
        ["PUT", "/api/contacts/missing"], ["DELETE", "/api/contacts/missing"],
      ]) {
        assert.deepEqual(await request("missing-user", path, method, method === "GET" ? undefined : {}),
          { status: 401, body: { error: "User not found" } });
      }
      assert.deepEqual(await request("reader", "/api/drive"), { status: 400, body: { error: "communityId is required" } });
      assert.deepEqual(await request("reader", "/api/drive/files/missing/download"),
        { status: 404, body: { error: "File not found" } });
    });
  });

  it("keeps drive folder community checks before parent validation, but file parent checks before access", async () => {
    const calls: string[] = [];
    await withHandlers({
      isUserMemberOfCommunity: async () => { calls.push("membership"); return false; },
      getDriveFolder: async () => { calls.push("folder"); return { communityId: "foreign" }; },
    }, async request => {
      assert.deepEqual(await request("pm", "/api/drive/folders", "POST", {
        communityId: "outside", parentId: "foreign", name: "Folder",
      }), { status: 403, body: { error: "Access denied" } });
      assert.deepEqual(calls, ["membership"]);
      calls.length = 0;
      assert.deepEqual(await request("pm", "/api/drive/files", "POST", {
        communityId: "outside", folderId: "foreign", name: "File", fileRef: "/objects/file",
      }), { status: 400, body: { error: "Folder not found or belongs to a different community" } });
      assert.deepEqual(calls, ["folder"]);
      calls.length = 0;
      assert.deepEqual(await request("pm", "/api/drive/files", "POST", {
        communityId: "outside", folderId: "foreign", name: "File", fileRef: "https://invalid",
      }), { status: 400, body: { error: "Invalid file reference" } });
      assert.deepEqual(calls, []);
      assert.deepEqual(await request("admin", "/api/drive/folders", "POST", {
        communityId: "member-community", parentId: "foreign", name: "Folder",
      }), { status: 400, body: { error: "Parent folder not found or belongs to a different community" } });
    });
  });

  it("preserves drive 404s before access, access before rename validation, and delete failure responses", async () => {
    await withHandlers({
      getDriveFolder: async (id: string) => id === "missing" ? undefined : { id, communityId: "outside" },
      getDriveFile: async (id: string) => id === "missing" ? undefined : { id, communityId: "outside" },
      deleteDriveFolder: async () => { throw Error("FOLDER_NOT_EMPTY"); },
    }, async request => {
      for (const resource of ["folders", "files"]) {
        for (const method of ["PATCH", "DELETE"]) {
          assert.deepEqual(await request("pm", `/api/drive/${resource}/missing`, method, {}),
            { status: 404, body: { error: resource === "folders" ? "Folder not found" : "File not found" } });
          assert.deepEqual(await request("pm", `/api/drive/${resource}/existing`, method, {}),
            { status: 403, body: { error: "Access denied" } });
        }
      }
      assert.deepEqual(await request("admin", "/api/drive/folders/existing", "DELETE"),
        { status: 409, body: { error: "Cannot delete a folder that contains files or subfolders. Please remove its contents first." } });
    });
  });

  it("retains successful drive browse, create, rename, delete and download behavior", async () => {
    const calls: any[][] = [];
    const record = (name: string) => async (...args: any[]) => { calls.push([name, ...args]); return args[1] ?? args[0]; };
    await withHandlers({
      getDriveFolders: async () => [{ id: "folder" }], getDriveFiles: async () => [{ id: "file" }],
      createDriveFolder: record("createFolder"), updateDriveFolder: record("updateFolder"),
      deleteDriveFolder: record("deleteFolder"), createDriveFile: record("createFile"),
      updateDriveFile: record("updateFile"), deleteObject: record("deleteObject"),
      deleteDriveFile: record("deleteFile"), getObjectEntityFile: record("object"),
      downloadObject: async (_object: any, res: any) => res.json({ downloaded: true }),
    }, async request => {
      for (const user of ["admin", "pm", "hoa", "reader"]) {
        assert.deepEqual(await request(user, "/api/drive?communityId=member-community"),
          { status: 200, body: { folders: [{ id: "folder" }], files: [{ id: "file" }] } });
      }
      for (const user of ["admin", "pm", "hoa"]) {
        const folder = await request(user, "/api/drive/folders", "POST", { communityId: "member-community", name: "Folder", extra: true });
        assert.deepEqual(folder, { status: 201, body: { communityId: "member-community", name: "Folder", createdBy: user } });
        const file = await request(user, "/api/drive/files", "POST", { communityId: "member-community", name: "File", fileRef: "/objects/file", extra: true });
        assert.deepEqual(file, { status: 201, body: { communityId: "member-community", name: "File", fileRef: "/objects/file", uploadedBy: user } });
        for (const resource of ["folders", "files"]) {
          assert.deepEqual(await request(user, `/api/drive/${resource}/existing`, "PATCH", { name: "Renamed", extra: true }),
            { status: 200, body: { name: "Renamed" } });
          assert.deepEqual(await request(user, `/api/drive/${resource}/existing`, "DELETE"), { status: 204, body: null });
        }
      }
      assert.deepEqual(await request("reader", "/api/drive/files/existing/download"), { status: 200, body: { downloaded: true } });
      const deletions = calls.filter(([name]) => name === "deleteObject" || name === "deleteFile");
      assert.deepEqual(deletions, Array.from({ length: 3 }, () => [["deleteObject", "/objects/file"], ["deleteFile", "existing"]]).flat());
    });
  });

  it("dispatches contact lists including all PM communities, HOA query ignoring and unassigned denial", async () => {
    await withHandlers({
      getContacts: async (communityId: string | undefined) => ({ communityId: communityId ?? "all" }),
      getUserCommunitiesList: async () => [{ id: "member-community" }, { id: "second" }],
      getContactsForCommunities: async (ids: string[]) => ids,
    }, async request => {
      assert.deepEqual(await request("admin", "/api/contacts"), { status: 200, body: { communityId: "all" } });
      assert.deepEqual((await request("admin", "/api/contacts?communityId=outside")).body, { communityId: "outside" });
      assert.deepEqual((await request("pm", "/api/contacts")).body, ["member-community", "second"]);
      assert.deepEqual((await request("pm", "/api/contacts?communityId=member-community")).body, { communityId: "member-community" });
      assert.deepEqual(await request("pm", "/api/contacts?communityId=outside"),
        { status: 403, body: { error: "Not a member of this community" } });
      for (const user of ["hoa", "reader"]) assert.deepEqual((await request(user, "/api/contacts?communityId=ignored")).body,
        { communityId: "member-community" });
      for (const user of ["unassigned", "crew"]) assert.deepEqual(await request(user, "/api/contacts"),
        { status: 403, body: { error: "Access denied" } });
    });
    await withHandlers({ getUserCommunitiesList: async () => [] }, async request => {
      assert.deepEqual(await request("pm", "/api/contacts"), { status: 200, body: [] });
    });
  });

  it("keeps contact write gates, existence checks, membership checks and validation ordering", async () => {
    await withHandlers({
      getContactById: async (id: string) => id === "missing" ? undefined : { id, communityId: "outside" },
    }, async request => {
      for (const user of ["reader", "crew"]) for (const [method, path] of [
        ["POST", "/api/contacts"], ["PUT", "/api/contacts/missing"], ["DELETE", "/api/contacts/missing"],
      ]) assert.deepEqual(await request(user, path, method, {}), { status: 403, body: { error: "Access denied" } });
      for (const user of ["pm", "hoa"]) {
        for (const method of ["PUT", "DELETE"]) {
          assert.deepEqual(await request(user, "/api/contacts/missing", method, {}),
            { status: 404, body: { error: "Contact not found" } });
          assert.deepEqual(await request(user, "/api/contacts/existing", method, {}),
            { status: 403, body: { error: user === "pm" ? "Not a member of this community" : "Access denied" } });
        }
        const invalid = await request(user, "/api/contacts", "POST", {});
        assert.equal(invalid.status, 400);
        assert.equal(invalid.body.error, "Invalid input");
        assert.ok(invalid.body.details);
      }
      assert.deepEqual(await request("pm", "/api/contacts", "POST", { name: "Contact", communityId: "outside" }),
        { status: 403, body: { error: "Not a member of this community" } });
      assert.deepEqual(await request("hoa", "/api/contacts", "POST", { name: "Contact", communityId: "outside" }),
        { status: 403, body: { error: "Cannot create contacts for other communities" } });
    });
  });

  it("preserves unassigned HOA-admin writes and prohibits every HOA-admin move", async () => {
    await withHandlers({
      createContact: async (data: any) => data, updateContact: async (_id: string, data: any) => data,
      deleteContact: async () => {},
    }, async request => {
      for (const user of ["admin", "pm", "hoa", "unassigned"]) {
        const communityId = user === "unassigned" ? "outside" : "member-community";
        assert.deepEqual(await request(user, "/api/contacts", "POST", { communityId, name: "Contact", extra: true }), {
          status: 201, body: { communityId, name: "Contact", title: null, company: null, phone: null, email: null, contactType: "Other", notes: null },
        });
        assert.deepEqual(await request(user, "/api/contacts/existing", "PUT", { name: "Renamed", extra: true }),
          { status: 200, body: { name: "Renamed" } });
        assert.deepEqual(await request(user, "/api/contacts/existing", "DELETE"), { status: 204, body: null });
      }
      for (const user of ["hoa", "unassigned"]) assert.deepEqual(
        await request(user, "/api/contacts/existing", "PUT", { communityId: "outside" }),
        { status: 403, body: { error: "Cannot move contacts to another community" } });
      assert.deepEqual(await request("pm", "/api/contacts/existing", "PUT", { communityId: "outside" }),
        { status: 403, body: { error: "Not a member of the target community" } });
      assert.deepEqual(await request("admin", "/api/contacts/existing", "PUT", { communityId: "outside" }),
        { status: 200, body: { communityId: "outside" } });
      assert.deepEqual(await request("pm", "/api/contacts/existing", "PUT", { communityId: "member-community" }),
        { status: 200, body: { communityId: "member-community" } });
    });
    await withHandlers({
      isUserMemberOfCommunity: async () => true, updateContact: async (_id: string, data: any) => data,
    }, async request => {
      assert.deepEqual(await request("pm", "/api/contacts/existing", "PUT", { communityId: "second-member-community" }),
        { status: 200, body: { communityId: "second-member-community" } });
    });
  });
});

describe("asset route structure", () => {
  const assets = readFileSync(new URL("./routes/assets.ts", import.meta.url), "utf8");
  const assetInventory = [
    "get /api/communities/:communityId/assets", "get /api/assets/by-feature",
    "post /api/assets/bulk/properties", "get /api/assets/:id",
    "get /api/assets/:id/history", "get /api/assets/:id/notes",
    "post /api/assets/:id/notes", "delete /api/assets/:assetId/notes/:noteId",
    "patch /api/communities/:id/map-creator-lock", "get /api/assets", "post /api/assets",
    "post /api/assets/:id/attachments", "get /api/assets/:id/attachments",
    "delete /api/assets/:id/attachments/:attachmentId", "patch /api/assets/:id",
    "put /api/assets/:id/properties",
  ];
  it("registers all 16 paths only in the asset module, in original order", () => {
    const registrations = (source: string) => [...source.matchAll(/app\.(get|post|patch|put|delete)\("([^"]+)"/g)]
      .map(([, method, path]) => `${method} ${path}`);
    assert.deepEqual(registrations(assets), assetInventory);
    assert.deepEqual(registrations(main).filter(path => assetInventory.includes(path)), []);
    assert.equal(main.split("registerAssetRoutes(app);").length - 1, 1);
    assert.equal((assets.match(/route\(async /g) ?? []).length, 16);
    assert.ok(main.indexOf("registerAssetRoutes(app);") < main.indexOf("registerMapLayerRoutes(app);"));
    const search = readFileSync(new URL("./routes/search.ts", import.meta.url), "utf8");
    assert.match(search, /app\.get\("\/api\/communities\/:communityId\/assets\/completeness"/);
    assert.match(search, /app\.get\("\/api\/communities\/:communityId\/assets\/incomplete"/);
  });
  it("keeps role and membership decisions in the policy module", () => {
    assert.doesNotMatch(assets, /\.role\s*(?:===|!==)/);
    assert.doesNotMatch(assets, /isMapCreatorRole\s*\(|isHoaRole\s*\(|isUserMemberOfCommunity\s*\(|userCanAccessCommunity\s*\(/);
    assert.deepEqual(assets.match(/(?:reqUser|user|currentUser)\.role/g), ["reqUser.role"]);
    assert.match(assets, /communityId, userId: reqUser\.id, role: reqUser\.role/);
  });
});

describe("task route structure and compatibility", () => {
  it("registers all 17 paths only in the task module, in the original order", () => {
    assert.doesNotMatch(main, /app\.\w+\(["']\/api\/(?:tasks|task-completions)/);
    assert.equal((main.match(/registerTaskRoutes\(app\)/g) ?? []).length, 1);
    assert.deepEqual([...tasks.matchAll(/app\.(get|post|put|delete)\("([^"]+)"/g)]
      .map(([, method, path]) => `${method} ${path}`), inventory);
    assert.equal((tasks.match(/route\(async /g) ?? []).length, 17);
    assert.match(tasks, /import \{ upload \} from "\.\/upload"/);
    assert.match(readFileSync(new URL("./routes/imports.ts", import.meta.url), "utf8"),
      /import \{ upload \} from "\.\/upload"/);
    assert.doesNotMatch(main, /import \{ upload \} from "\.\/upload"/);
    assert.doesNotMatch(main, /multer\(/);
  });

  it("keeps permissions in the policy module, not in task routes", () => {
    assert.doesNotMatch(tasks, /canUserAccessTask\s*\(/);
    assert.doesNotMatch(tasks, /isUserMemberOfCommunity\s*\(/);
    assert.doesNotMatch(tasks, /(?:\?\.)?\.?role\s*[!=]==?/);
    assert.doesNotMatch(tasks, /isHoaRole\s*\(|isContractorSide\s*\(/);
    assert.doesNotMatch(tasks, /\.includes\([^)]*\.role/);
    assert.doesNotMatch(tasks, /from ["']\.\.\/policy\//);
    // vmRole compares returned view models for leak diagnostics only. It never
    // grants access, scopes a query, or chooses a response body.
    assert.match(tasks, /if \(vmRole === "contractor"\)/);
    assert.match(tasks, /else if \(vmRole === "hoa_member"\)/);
  });

  it("reaches page-data before the dynamic id handler over HTTP", async () => {
    const { api } = await policyFixture();
    const app = express();
    app.use((req, _res, next) => {
      req.currentUser = { id: "actor", role: "admin" } as any;
      req.session = { userId: "actor" } as any;
      next();
    });
    api.registerTaskRoutes(app);
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    try {
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const base = `http://127.0.0.1:${address.port}`;
      const page = await fetch(`${base}/api/tasks/page-data`);
      assert.equal(page.status, 200);
      assert.deepEqual(await page.json(), { role: "admin", source: "page-data" });
      const detail = await fetch(`${base}/api/tasks/example`);
      assert.equal(detail.status, 200);
      assert.deepEqual(await detail.json(), { id: "example", communityId: "member-community", source: "task" });
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });

  it("maps typed async failures and retains each moved route's historical 500 body", async () => {
    const { api, storage } = await policyFixture({
      getUserById: async () => { throw Error("Unexpected lookup failure"); },
    });
    const app = express();
    const errors = [
      new api.UnauthenticatedError(), new api.ForbiddenError("No access"),
      new storage.WorkValidationError("Bad work"), new storage.WorkAccessError("Private work"),
      Error("Unexpected"),
    ];
    const logs: unknown[] = [];
    app.use((req, _res, next) => { req.log = { error: (...args: unknown[]) => logs.push(args) } as any; next(); });
    errors.forEach((error, index) => {
      app.get(`/error/${index}`, api.route(async () => { throw error; }));
    });
    api.registerTaskRoutes(app);
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    try {
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const base = `http://127.0.0.1:${address.port}`;
      const expected: [number, object][] = [
        [401, { message: "Not authenticated" }], [403, { error: "No access" }],
        [400, { error: "Bad work" }], [403, { error: "Private work" }], [500, { error: "Internal error" }],
      ];
      for (const [index, [status, body]] of expected.entries()) {
        const response = await fetch(`${base}/error/${index}`);
        assert.equal(response.status, status);
        assert.deepEqual(await response.json(), body);
      }
      const page = await fetch(`${base}/api/tasks/page-data`);
      assert.equal(page.status, 500);
      assert.deepEqual(await page.json(), { error: "Failed to fetch task page data" });
      assert.equal(logs.length, 2);
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});

describe("HOA and portfolio work-order route structure", () => {
  const modules = [
    {
      file: "hoa", register: "registerHoaRoutes",
      inventory: [
        "get /api/hoa/dashboard", "get /api/hoa/requests",
        "get /api/hoa/requests/:id", "post /api/hoa/requests",
      ],
    },
    {
      file: "portfolioWorkOrders", register: "registerPortfolioWorkOrderRoutes",
      inventory: [
        "get /api/portfolio/work-orders", "post /api/portfolio/work-orders",
        "post /api/portfolio/work-orders/:taskId/approve", "get /api/portfolio/work-orders/:taskId",
        "patch /api/portfolio/work-orders/:taskId", "post /api/portfolio/work-orders/:taskId/cancel",
        "post /api/portfolio/work-orders/:taskId/decline", "post /api/portfolio/work-orders/:taskId/comments",
        "post /api/portfolio/work-orders/:taskId/photos",
      ],
    },
  ];
  it("removes all moved handler registrations from the main module", () => {
    assert.doesNotMatch(main, /app\.\w+\(["']\/api\/(?:hoa\/|portfolio\/work-orders)/);
  });
  for (const module of modules) {
    const source = readFileSync(new URL(`./routes/${module.file}.ts`, import.meta.url), "utf8");
    it(`keeps the exact ${module.file} inventory, order, middleware and wrappers`, () => {
      assert.deepEqual([...source.matchAll(/app\.(get|post|patch|put|delete)\("([^"]+)"/g)]
        .map(([, method, path]) => `${method} ${path}`), module.inventory);
      assert.equal((source.match(/route\(async /g) ?? []).length, module.inventory.length);
      const middleware = module.file === "hoa" ? "requireAuth" : "requireClientOrAdmin";
      assert.equal((source.match(new RegExp(`app\\.\\w+\\("[^"]+", ${middleware}, route\\(async`, "g")) ?? []).length, module.inventory.length);
      assert.equal(main.split(`${module.register}(app);`).length - 1, 1);
    });
    it(`keeps ${module.file} authorization in the policy module`, () => {
      assert.doesNotMatch(source, /canUserAccessTask\s*\(|isHoaRole\s*\(|isClientRole\s*\(/);
      assert.doesNotMatch(source, /\.role\s*(?:===|!==)/);
      assert.doesNotMatch(source, /\.organizationId\s*!==/);
      assert.match(source, /import \* as policy from "\.\.\/policy"/);
      assert.doesNotMatch(source, /from ["']\.\.\/policy\//);
    });
  }
  it("retains registration positions relative to unchanged neighboring routes", () => {
    assert.ok(main.indexOf("registerHoaRoutes(app);") < main.indexOf("registerNotificationRoutes(app);"));
    const workOrders = main.indexOf("registerPortfolioWorkOrderRoutes(app);");
    assert.ok(main.indexOf('app.delete("/api/portfolio/group-sets/:setId",') < workOrders);
    assert.ok(workOrders < main.indexOf("registerOrganizationRoutes(app);"));
  });
});

describe("commercial portfolio route structure", () => {
  const portfolio = readFileSync(new URL("./routes/portfolio.ts", import.meta.url), "utf8");
  const inventory = [
    "get /api/portfolio/me",
    "get /api/portfolio/dashboard",
    "get /api/portfolio/branches",
    "get /api/portfolio/branches/:communityId",
    "get /api/portfolio/map",
    "get /api/portfolio/water-savings/polygons",
    "get /api/portfolio/water-savings",
    "get /api/portfolio/water-savings/communities/:communityId",
    "get /api/portfolio/water-savings/scenarios",
    "get /api/portfolio/water-savings/scenarios/:scenarioId",
    "post /api/portfolio/water-savings/scenarios",
    "patch /api/portfolio/water-savings/scenarios/:scenarioId",
    "delete /api/portfolio/water-savings/scenarios/:scenarioId",
    "get /api/portfolio/branches/:communityId/layers/:layerId/geojson",
    "get /api/portfolio/branches/:communityId/controllers",
    "get /api/portfolio/groups",
    "get /api/portfolio/analytics",
    "get /api/portfolio/group-sets",
    "post /api/portfolio/groups",
    "patch /api/portfolio/groups/:groupId",
    "delete /api/portfolio/groups/:groupId",
    "put /api/portfolio/groups/:groupId/members",
    "post /api/portfolio/group-sets",
    "patch /api/portfolio/group-sets/:setId",
    "delete /api/portfolio/group-sets/:setId",
  ];
  it("registers exactly the 25 original paths in order, outside the main module", () => {
    assert.doesNotMatch(main, /app\.\w+\(["']\/api\/portfolio\//);
    assert.deepEqual([...portfolio.matchAll(/app\.(get|post|patch|put|delete)\("([^"]+)"/g)]
      .map(([, method, path]) => `${method} ${path}`), inventory);
    assert.equal((portfolio.match(/route\(async /g) ?? []).length, 25);
    const declarations = portfolio.split("\n").filter(line => /^  app\./.test(line));
    assert.match(declarations[0], /requireClient, route\(async /);
    for (const declaration of declarations.slice(1)) {
      assert.match(declaration, /requireClientOrAdmin, route\(async /);
    }
  });

  it("registers once, directly before the unchanged work-order module", () => {
    assert.equal(main.split("registerPortfolioRoutes(app);").length - 1, 1);
    assert.match(main, /registerPortfolioRoutes\(app\);\s*registerPortfolioWorkOrderRoutes\(app\);/);
  });

  it("keeps ownership decisions and database queries outside the route module", () => {
    assert.doesNotMatch(portfolio, /\.organizationId\s*(?:!==|===)|\.role\s*(?:===|!==)/);
    assert.doesNotMatch(portfolio, /isClientRole\s*\(|listBranchGroups\s*\(|getGroupSets\s*\(|db\s*\.\s*select/);
    assert.match(portfolio, /from "\.\.\/policy"/);
    assert.doesNotMatch(portfolio, /from "\.\.\/portfolioOrgResolver"/);
    assert.equal((portfolio.match(/resolvePortfolioOrg\(req\)/g) ?? []).length, 24);
    assert.match(portfolio, /const orgId = clientPortfolioOrg\(req\);/);
  });

  it("preserves group authorization before input checks and non-empty location authorization", () => {
    const start = portfolio.indexOf('app.put("/api/portfolio/groups/:groupId/members"');
    const end = portfolio.indexOf('app.post("/api/portfolio/group-sets"', start);
    const members = portfolio.slice(start, end);
    assert.ok(members.indexOf("await orgOwnsGroup(orgId, groupId)") < members.indexOf("Array.isArray(communityIds)"));
    assert.match(members, /if \(\(communityIds as string\[\]\)\.length > 0\) \{\s*if \(!await orgOwnsCommunities\(orgId, communityIds as string\[\]\)\)/);
    assert.ok(members.indexOf("await orgOwnsCommunities(") < members.indexOf("await storage.setBranchGroupMembers("));
  });
});

describe("map layers, asset types and offline pack route structure", () => {
  const modules = [
    {
      file: "mapLayers", register: "registerMapLayerRoutes",
      inventory: [
        "get /api/map-layers", "get /api/map-layers/:id/geojson", "get /api/layer-hierarchy",
        "post /api/map-layers", "post /api/map-layers/upload-validate", "post /api/map-layers/upload",
        "post /api/map-layers/preview-irrigation", "post /api/map-layers/upload-irrigation",
        "patch /api/map-layers/:id", "delete /api/map-layers/:id", "post /api/map-layers/:id/sync-assets",
        "post /api/map-layers/:id/validate", "post /api/map-layers/:id/sync-preview",
        "get /api/map-layers/:id/unlinked-features", "post /api/map-layers/:id/create-missing-assets",
        "get /api/map-layers/:id/collisions", "get /api/map-layers/:id/summary",
      ],
    },
    {
      file: "assetTypes", register: "registerAssetTypeRoutes",
      inventory: [
        "get /api/asset-types", "post /api/asset-types",
        "patch /api/asset-types/:key", "delete /api/asset-types/:key",
      ],
    },
    {
      file: "offlinePacks", register: "registerOfflinePackRoutes",
      inventory: [
        "get /api/communities/:communityId/offline-pack", "post /api/offline-packs",
        "post /api/offline-packs/:id/download-urls", "get /api/offline-packs",
        "delete /api/offline-packs/:id", "post /api/communities/:communityId/generate-offline-pack",
        "get /api/communities/:communityId/offline-pack-data",
      ],
    },
  ];
  for (const module of modules) {
    const source = readFileSync(new URL(`./routes/${module.file}.ts`, import.meta.url), "utf8");
    it(`registers the exact ${module.file} inventory and order outside the main module`, () => {
      assert.deepEqual([...source.matchAll(/app\.(get|post|patch|put|delete)\("([^"]+)"/g)]
        .map(([, method, path]) => `${method} ${path}`), module.inventory);
      assert.equal(main.split(`${module.register}(app);`).length - 1, 1);
      assert.equal((source.match(/route\(async /g) ?? []).length, module.inventory.length);
      assert.doesNotMatch(main, /app\.\w+\(["']\/api\/(?:map-layers|layer-hierarchy|asset-types|offline-packs|communities\/:communityId\/(?:offline-pack|generate-offline-pack))/);
    });
    it(`keeps ${module.file} role and membership checks in policy`, () => {
      assert.doesNotMatch(source, /\.role\s*(?:===|!==)/);
      assert.doesNotMatch(source, /isUserMemberOfCommunity\s*\(|userCanAccessCommunity\s*\(|isHoaRole\s*\(|isMapCreatorRole\s*\(/);
      assert.match(source, /import \* as policy from "\.\.\/policy"/);
    });
  }
  it("preserves module positions, catalogue and task-template boundaries", () => {
    assert.match(main, /registerAssetRoutes\(app\);\s*registerMapLayerRoutes\(app\);/);
    assert.match(main, /\/\/ ── Asset Types catalogue \(data-driven\)[^\n]*\n\s*registerAssetTypeRoutes\(app\);\s*registerOfflinePackRoutes\(app\);/);
    assert.ok(main.indexOf("registerMapLayerRoutes(app);") < main.indexOf("registerAssetTypeRoutes(app);"));
    assert.ok(main.indexOf("registerOfflinePackRoutes(app);") < main.indexOf("registerTaskTemplateRoutes(app);"));
  });
  it("keeps upload middleware and the approved actor loading exception", () => {
    const maps = readFileSync(new URL("./routes/mapLayers.ts", import.meta.url), "utf8");
    assert.equal((maps.match(/upload\.single\("file"\)/g) ?? []).length, 3);
    assert.match(maps, /import \{ upload \} from "\.\/upload"/);
    assert.doesNotMatch(maps, /storage\.getUserById\(/);
    assert.match(maps, /policy\.canAccessCommunity\(policy\.actorFromUser\(req\.currentUser!\), layer\.communityId\)/);
  });
});

describe("billing route structure", () => {
  const modules = [
    { file: "invoices", register: "registerInvoiceRoutes", inventory: [
      "get /api/invoices", "get /api/invoices/:id", "post /api/invoices",
      "put /api/invoices/:id", "delete /api/invoices/:id",
    ] },
    { file: "reports", register: "registerReportRoutes", inventory: [
      "get /api/reports/water-usage", "get /api/reports/tree-inventory", "get /api/reports/invoices/monthly",
    ] },
    { file: "contracts", register: "registerContractRoutes", inventory: [
      "get /api/contracts", "get /api/contracts/:id", "post /api/contracts",
      "put /api/contracts/:id", "delete /api/contracts/:id",
    ] },
  ];
  for (const module of modules) {
    const source = readFileSync(new URL(`./routes/${module.file}.ts`, import.meta.url), "utf8");
    it(`keeps the exact ${module.file} inventory, middleware, wrappers and order`, () => {
      assert.deepEqual([...source.matchAll(/app\.(get|post|put|delete)\("([^"]+)"/g)]
        .map(([, method, path]) => `${method} ${path}`), module.inventory);
      assert.equal((source.match(/route\(async /g) ?? []).length, module.inventory.length);
      assert.equal((source.match(/    try \{/g) ?? []).length, module.inventory.length);
      const declarations = source.split("\n").filter(line => /^  app\./.test(line));
      declarations.forEach((line, index) => {
        const middleware = module.file === "contracts" && index >= 2 ? "requireAdmin" : "requireAuth";
        assert.match(line, new RegExp(`, ${middleware}, route\\(async `));
      });
      assert.equal(main.split(`${module.register}(app);`).length - 1, 1);
    });
    it(`keeps ${module.file} permissions exclusively in central policy`, () => {
      assert.doesNotMatch(source, /\.role\s*(?:===|!==)|\.includes\((?:user|actor)\.role\)/);
      assert.doesNotMatch(source, /isHoaRole\s*\(|isClientRole\s*\(|isUserMemberOfCommunity\s*\(/);
      assert.match(source, /import \* as policy from "\.\.\/policy"/);
      assert.doesNotMatch(source, /from ["']\.\.\/policy\//);
    });
  }
  it("registers once at the original location, with no billing handlers left in main", () => {
    assert.doesNotMatch(main, /app\.\w+\(["']\/api\/(?:invoices|reports\/|contracts)/);
    assert.match(main, /registerInvoiceRoutes\(app\);\s*registerReportRoutes\(app\);\s*registerContractRoutes\(app\);/);
    assert.ok(main.indexOf('app.put("/api/notifications/:id/read",') < main.indexOf("registerInvoiceRoutes(app);"));
    assert.ok(main.indexOf("registerContractRoutes(app);") < main.indexOf("registerDriveRoutes(app);"));
  });
  it("removes unused invoice role boundaries", () => {
    const invoices = readFileSync(new URL("./routes/invoices.ts", import.meta.url), "utf8");
    assert.match(invoices, /export function registerInvoiceRoutes\(app: Express\): void \{/);
    assert.equal((invoices.match(/invoiceReadRoles/g) ?? []).length, 0);
    assert.equal((invoices.match(/invoiceMutateRoles/g) ?? []).length, 0);
    const reports = readFileSync(new URL("./routes/reports.ts", import.meta.url), "utf8");
    assert.doesNotMatch(reports, /reportReadRoles|resolveReportCommunityId/);
  });
  it("preserves invoice denial before lookup and manager validation ordering", () => {
    const source = readFileSync(new URL("./routes/invoices.ts", import.meta.url), "utf8");
    const detail = source.slice(source.indexOf('app.get("/api/invoices/:id"'), source.indexOf('app.post("/api/invoices"'));
    assert.ok(detail.indexOf("policy.canRequestInvoice(actor)") < detail.indexOf("storage.getInvoiceById("));
    const create = source.slice(source.indexOf('app.post("/api/invoices"'), source.indexOf('app.put("/api/invoices/:id"'));
    const ordered = ["policy.managerCanCreateInvoice(", "storage.getCompanyById(", "policy.invoiceStatusRule(", "insertInvoiceSchema.safeParse("];
    ordered.forEach((expression, i) => {
      assert.ok(create.includes(expression));
      if (i) assert.ok(create.indexOf(ordered[i - 1]) < create.indexOf(expression));
    });
    assert.match(source, /updateInvoiceSchema\.omit\(\{ contractorCompanyId: true \}\)/);
    assert.equal((source.match(/sessionOrganizationId: req\.session\.organizationId/g) ?? []).length, 2);
  });
});

describe("billing handler response compatibility", () => {
  const users: Record<string, any> = {
    admin: { id: "admin", role: "admin" },
    pm: { id: "pm", role: "property_manager" },
    hoa: { id: "hoa", role: "hoa_admin", hoaCommunityId: "member-community" },
    manager: { id: "manager", role: "contractor_manager", companyId: "company" },
    crew: { id: "crew", role: "contractor" },
    client: { id: "client", role: "client_admin", organizationId: "org" },
    sessionClient: { id: "sessionClient", role: "client_admin", organizationId: null },
  };
  async function withBilling(overrides: Record<string, any>, check: (
    request: (user: string, path: string, method?: string, body?: unknown, sessionOrg?: string) =>
      Promise<{ status: number; body: any }>,
  ) => Promise<void>) {
    const { api } = await policyFixture({
      getUserById: async (id: string) => users[id],
      getInvoiceById: async () => undefined,
      ...overrides,
    });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const id = req.headers["x-user"] as string;
      req.currentUser = users[id];
      req.session = { userId: id, organizationId: req.headers["x-org"] as string | undefined } as any;
      req.log = { error() {} } as any;
      next();
    });
    api.registerInvoiceRoutes(app);
    api.registerReportRoutes(app);
    api.registerContractRoutes(app);
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    try {
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      await check(async (user, path, method = "GET", body, sessionOrg) => {
        const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
          method, headers: {
            "x-user": user, "Content-Type": "application/json",
            ...(sessionOrg === undefined ? {} : { "x-org": sessionOrg }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        return { status: response.status, body: response.status === 204 ? null : await response.json() };
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  }

  it("keeps missing-user bodies and contractor denial before missing-invoice lookup", async () => {
    let lookups = 0;
    await withBilling({ getInvoiceById: async () => { lookups++; return undefined; } }, async request => {
      for (const path of ["/api/invoices", "/api/invoices/missing", "/api/contracts", "/api/contracts/missing"]) {
        assert.deepEqual(await request("missing-user", path), { status: 401, body: { error: "User not found" } });
      }
      assert.deepEqual(await request("missing-user", "/api/reports/water-usage"), { status: 403, body: { error: "Access denied" } });
      assert.deepEqual(await request("crew", "/api/invoices/missing"), { status: 403, body: { error: "Access denied" } });
      assert.equal(lookups, 0);
      assert.deepEqual(await request("admin", "/api/invoices/missing"), { status: 404, body: { error: "Invoice not found" } });
      assert.equal(lookups, 1);
    });
  });

  it("dispatches each invoice list plan and retains the logical-OR session fallback", async () => {
    await withBilling({
      getInvoices: async (communityId: string | undefined) => ({ communityId: communityId ?? "all" }),
      getManagerInvoices: async (id: string, communityId: string | undefined) => ({ id, communityId: communityId ?? "all" }),
      getInvoicesByOrganization: async (orgId: string) => ({ orgId }),
    }, async request => {
      assert.deepEqual(await request("admin", "/api/invoices"), { status: 200, body: { communityId: "all" } });
      assert.deepEqual((await request("admin", "/api/invoices?communityId=selected")).body, { communityId: "selected" });
      assert.deepEqual((await request("hoa", "/api/invoices?communityId=ignored")).body, { communityId: "member-community" });
      assert.deepEqual((await request("manager", "/api/invoices")).body, { id: "manager", communityId: "all" });
      assert.deepEqual(await request("manager", "/api/invoices?communityId=outside"), { status: 403, body: { error: "Access denied" } });
      assert.deepEqual((await request("client", "/api/invoices", "GET", undefined, "ignored")).body, { orgId: "org" });
      assert.deepEqual((await request("sessionClient", "/api/invoices", "GET", undefined, "session")).body, { orgId: "session" });
      assert.deepEqual((await request("sessionClient", "/api/invoices?communityId=selected", "GET", undefined, "session")).body, { communityId: "selected" });
      assert.deepEqual(await request("sessionClient", "/api/invoices"), { status: 403, body: { error: "Access denied: no organization" } });
      assert.deepEqual(await request("pm", "/api/invoices"), { status: 400, body: { error: "communityId is required" } });
      assert.deepEqual((await request("pm", "/api/invoices?communityId=member-community")).body, { communityId: "member-community" });
      assert.deepEqual(await request("pm", "/api/invoices?communityId=outside"), { status: 403, body: { error: "Access denied" } });
    });
  });

  it("retains detail organization fallback and checks existence before client organization", async () => {
    const invoice = { id: "existing", communityId: "member-community", contractorCompanyId: "company" };
    await withBilling({ getInvoiceById: async (id: string) => id === "existing" ? invoice : undefined }, async request => {
      assert.deepEqual(await request("sessionClient", "/api/invoices/existing", "GET", undefined, "org"), { status: 200, body: invoice });
      assert.deepEqual(await request("sessionClient", "/api/invoices/existing"), { status: 403, body: { error: "Access denied: no organization" } });
      assert.deepEqual(await request("sessionClient", "/api/invoices/existing", "GET", undefined, "foreign"), { status: 403, body: { error: "Access denied" } });
      assert.deepEqual(await request("sessionClient", "/api/invoices/missing"), { status: 404, body: { error: "Invoice not found" } });
    });
  });

  it("keeps mutation role-gate bodies and manager company existence ahead of approval", async () => {
    await withBilling({ getCompanyById: async () => undefined }, async request => {
      for (const method of ["POST", "PUT", "DELETE"]) {
        const path = method === "POST" ? "/api/invoices" : "/api/invoices/missing";
        assert.deepEqual(await request("pm", path, method, {}), { status: 403, body: { message: "Admin access required" } });
      }
      assert.deepEqual(await request("manager", "/api/invoices", "POST", {
        communityId: "member-community", status: "approved",
      }), { status: 403, body: { error: "Access denied" } });
    });
  });

  for (const [path, expected] of [
    ["/api/reports/water-usage", []],
    ["/api/reports/tree-inventory", { groups: [], total: 0 }],
    ["/api/reports/invoices/monthly", { groups: [], total: 0 }],
  ] as const) it(`retains role, community and response handling for ${path}`, async () => {
    const queries: any[][] = [];
    await withBilling({
      reportQuery: async (...args: any[]) => { queries.push(args); return { rows: [] }; },
    }, async request => {
      const query = path + "?month=11&year=2026";
      assert.deepEqual(await request("manager", query), { status: 403, body: { error: "Access denied" } });
      assert.deepEqual(await request("admin", query), { status: 400, body: { error: "communityId is required" } });
      assert.deepEqual(await request("pm", query + "&communityId=outside"), { status: 403, body: { error: "Access denied" } });
      assert.equal(queries.length, 0);
      assert.deepEqual(await request("hoa", query + "&communityId=ignored"), { status: 200, body: expected });
      assert.ok(queries.every(([, params]) => params[0] === "member-community"));
      assert.deepEqual(await request("pm", query + "&communityId=member-community"), { status: 200, body: expected });
      assert.deepEqual(await request("admin", query + "&communityId=selected"), { status: 200, body: expected });
    });
  });

  it("retains report scope errors before month/year validation", async () => {
    await withBilling({}, async request => {
      assert.deepEqual(await request("pm", "/api/reports/invoices/monthly?communityId=outside"), {
        status: 403, body: { error: "Access denied" },
      });
      assert.deepEqual(await request("pm", "/api/reports/invoices/monthly?communityId=member-community"), {
        status: 400, body: { error: "Valid month (1-12) and year are required" },
      });
    });
  });

  it("keeps contract role/existence ordering, membership, filters and list input", async () => {
    const records = [
      { id: "active", isActive: true, startDate: "1900-01-01", endDate: "2999-01-01" },
      { id: "upcoming", isActive: true, startDate: "2998-01-01", endDate: "2999-01-01" },
      { id: "expired", isActive: true, startDate: "1900-01-01", endDate: "1901-01-01" },
      { id: "disabled", isActive: false, startDate: "1900-01-01", endDate: "2999-01-01" },
    ];
    const queries: unknown[][] = [];
    await withBilling({
      getContracts: async (...args: unknown[]) => { queries.push(args); return records; },
      getContractById: async (id: string) => id === "missing" ? undefined : { id, communityId: id },
    }, async request => {
      assert.deepEqual(await request("manager", "/api/contracts/missing"), { status: 403, body: { error: "Access denied" } });
      assert.deepEqual(await request("pm", "/api/contracts/missing"), { status: 404, body: { error: "Contract not found" } });
      assert.deepEqual(await request("pm", "/api/contracts"), { status: 400, body: { error: "communityId is required" } });
      assert.deepEqual(await request("pm", "/api/contracts/outside"), { status: 403, body: { error: "Access denied" } });
      assert.equal((await request("pm", "/api/contracts/member-community")).status, 200);
      assert.equal((await request("pm", "/api/contracts?communityId=member-community&contractorUserId=crew")).status, 200);
      assert.deepEqual(queries, [["member-community", "crew"]]);
      for (const [status, ids] of [
        ["active", ["active"]], ["upcoming", ["upcoming"]], ["expired", ["expired", "disabled"]],
      ] as const) {
        const response = await request("admin", `/api/contracts?status=${status}`);
        assert.equal(response.status, 200);
        assert.deepEqual(response.body.map((r: any) => r.id), ids);
      }
      assert.equal((await request("admin", "/api/contracts")).body.length, 4);
    });
  });

  it("retains contract assignee input validation after schema and date checks", async () => {
    const lookups: string[] = [];
    await withBilling({
      getUserById: async (id: string) => { lookups.push(id); return users[id]; },
      getContractById: async () => ({ id: "contract", startDate: "2026-01-01", endDate: "2026-12-31" }),
    }, async request => {
      const input = { communityId: "member-community", contractorUserId: "manager",
        contractType: "Fixture", startDate: "2026-01-01", endDate: "2026-12-31" };
      assert.deepEqual(await request("admin", "/api/contracts", "POST", { ...input, endDate: "2025-01-01" }), {
        status: 400, body: { error: "End date must be on or after start date" },
      });
      assert.deepEqual(lookups, []);
      for (const contractorUserId of ["manager", "admin", "missing"]) {
        assert.deepEqual(await request("admin", "/api/contracts", "POST", { ...input, contractorUserId }), {
          status: 400, body: { error: "Selected user is not a contractor" },
        });
        assert.deepEqual(await request("admin", "/api/contracts/contract", "PUT", { contractorUserId }), {
          status: 400, body: { error: "Selected user is not a contractor" },
        });
      }
    });
  });
});
