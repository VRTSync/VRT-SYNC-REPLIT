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
    assert.match(main, /app\.use\("\/api", enforceHoaScoping\);\s*app\.use\("\/api", enforceOrgScoping\);\s*registerObjectRoutes\(app\);\s*app\.get\("\/api\/communities"/);
    assert.match(main, /registerContractRoutes\(app\);\s*registerDriveRoutes\(app\);\s*registerContactRoutes\(app\);\s*registerPortfolioRoutes\(app\);/);
  });
  it("retains drive constants solely as fixture boundaries, never as decisions", () => {
    const drive = readFileSync(new URL("./routes/drive.ts", import.meta.url), "utf8");
    assert.match(drive, /export function registerDriveRoutes\(app: Express\): void \{\n  const driveMutateRoles = \['admin', 'property_manager', 'hoa_admin'\];\n  const driveReadRoles = \['admin', 'property_manager', 'hoa_admin', 'hoa_member'\];/);
    for (const constant of ["driveMutateRoles", "driveReadRoles"]) {
      assert.equal(drive.split(constant).length - 1, 1);
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
    assert.match(main, /app\.get\("\/api\/communities\/:communityId\/assets\/completeness"/);
    assert.match(main, /app\.get\("\/api\/communities\/:communityId\/assets\/incomplete"/);
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
    assert.ok(main.indexOf("registerOfflinePackRoutes(app);") < main.indexOf("// Task Templates CRUD"));
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
  it("retains only the required unused invoice role boundaries", () => {
    const invoices = readFileSync(new URL("./routes/invoices.ts", import.meta.url), "utf8");
    assert.match(invoices, /export function registerInvoiceRoutes\(app: Express\): void \{\n  const invoiceReadRoles = \['admin', 'property_manager', 'hoa_admin', 'hoa_member'\];\n  const invoiceMutateRoles = \['admin'\];/);
    assert.equal((invoices.match(/invoiceReadRoles/g) ?? []).length, 1);
    assert.equal((invoices.match(/invoiceMutateRoles/g) ?? []).length, 1);
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
