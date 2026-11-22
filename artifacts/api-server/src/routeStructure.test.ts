import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import express from "express";
import { policyFixture } from "./testUtils/policyFixture";

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

describe("task route structure and compatibility", () => {
  it("registers all 17 paths only in the task module, in the original order", () => {
    assert.doesNotMatch(main, /app\.\w+\(["']\/api\/(?:tasks|task-completions)/);
    assert.equal((main.match(/registerTaskRoutes\(app\)/g) ?? []).length, 1);
    assert.deepEqual([...tasks.matchAll(/app\.(get|post|put|delete)\("([^"]+)"/g)]
      .map(([, method, path]) => `${method} ${path}`), inventory);
    assert.equal((tasks.match(/route\(async /g) ?? []).length, 17);
    assert.match(tasks, /import \{ upload \} from "\.\/upload"/);
    assert.match(main, /import \{ upload \} from "\.\/upload"/);
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
    assert.ok(main.indexOf("registerHoaRoutes(app);") < main.indexOf('app.get("/api/notification-preferences",'));
    const workOrders = main.indexOf("registerPortfolioWorkOrderRoutes(app);");
    assert.ok(main.indexOf('app.delete("/api/portfolio/group-sets/:setId",') < workOrders);
    assert.ok(workOrders < main.indexOf('app.post("/api/admin/organizations",'));
  });
});
