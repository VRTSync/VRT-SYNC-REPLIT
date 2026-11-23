import assert from "node:assert/strict";
import { before, beforeEach, afterEach, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { readRouteFixtureSource, taskFixtureImports } from "./testUtils/routeFixtureSource";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type { Server } from "node:http";
import express from "express";
import { build } from "esbuild";

// Execute the real route bodies, auth middleware, object service and ACL code.
// Only GCS and database/storage I/O are in-memory fixtures. No real file policies,
// accounts, database rows, or environment secrets are read or written.
const routes = readRouteFixtureSource();
function between(start: string, end: string) {
  const from = routes.indexOf(start);
  const to = routes.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Verified route boundary missing: ${start}`);
  return routes.slice(from, to);
}
const handlers = [
  between('app.get("/public-objects/', 'app.post("/api/objects/upload",'),
  between('app.post("/api/objects/upload",', 'app.post("/api/objects/confirm",'),
  between('app.post("/api/objects/confirm",', 'app.get("/api/communities",'),
  between('app.post("/api/tasks/:id/attachments",', 'app.get("/api/task-completions/:id/attachments",'),
  between('app.post("/api/assets/:id/attachments",', 'app.get("/api/assets/:id/attachments",'),
  between('app.post("/api/portfolio/work-orders/:taskId/photos",', '// ── Admin: Organization provisioning'),
  between('app.get("/api/drive/files/:id/download",', '/* ─── Contacts'),
].join("\n");
const driveHelpers = between("async function requireDriveAccess(", 'app.get("/api/drive",');
const require = createRequire(import.meta.url);
type Policy = { owner: string; visibility: "public" | "private"; aclRules?: any[] };
type StoredFile = { type?: string; policy?: Policy; bytes: Buffer; writes: number };

describe("file ownership and safe serving (isolated HTTP regressions)", () => {
  let bundle: string;
  let api: any;
  let files: Map<string, StoredFile>;
  let users: Record<string, any>;
  let attachments: any[];
  let server: Server;
  let base: string;
  let updates: any[];

  before(async () => {
    const built = await build({
      stdin: {
        contents: `
          ${taskFixtureImports}
          import { registerAuthRoutes, loadCurrentUser, requireAuth, requireAdminOrMapCreator,
            requireClientOrAdmin, isHoaRole } from "./auth";
          import { ObjectStorageService, ObjectForbiddenError, ObjectNotFoundError,
            objectStorageClient, parseUploadURL } from "./objectStorage";
          import { ObjectPermission, buildCommunityAclPolicy, getObjectAclPolicy } from "./objectAcl";
          import * as storage from "./storage";
          export { ObjectStorageService, ObjectForbiddenError, objectStorageClient };
          const resolvePortfolioOrg = () => ({ orgId: "org" });
          const isUniqueViolation = () => false;
          ${driveHelpers}
          export function setup(app: any) { app.use(loadCurrentUser); registerAuthRoutes(app); ${handlers} }
        `,
        resolveDir: fileURLToPath(new URL(".", import.meta.url)),
        loader: "ts",
      },
      bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
      define: { "process.env.PRIVATE_OBJECT_DIR": '"/fixture/private"' },
      plugins: [{
        name: "isolated-file-access-io",
        setup(builder) {
          builder.onResolve({ filter: /^(?:\.\/|\.\.\/)storage$/ }, () => ({ path: "storage", namespace: "fixture" }));
          builder.onResolve({ filter: /^\.\/db$/ }, () => ({ path: "db", namespace: "fixture" }));
          builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
            contents: path === "storage" ? "module.exports = __storage;"
              : "export const db = __db; export const pool = undefined;",
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
    files = new Map();
    attachments = [];
    updates = [];
    users = {
      a: { id: "a", role: "admin", displayName: "A" },
      b: { id: "b", role: "contractor" },
      member: { id: "member", role: "contractor" },
      hoa: { id: "hoa", role: "hoa_admin", hoaCommunityId: "community" },
      hoaMember: { id: "hoaMember", role: "hoa_member", hoaCommunityId: "community" },
      mapper: { id: "mapper", role: "map_creator" },
      client: { id: "client", role: "client_admin", organizationId: "org" },
    };
    const task = { id: "task", communityId: "community", assignedTo: "member", origin: "client", acknowledgedAt: null };
    const persist = async (data: any) => {
      const row = { id: String(attachments.length + 1), ...data };
      attachments.push(row);
      return row;
    };
    const storage = {
      getUserById: async (id: string) => users[id],
      isUserMemberOfCommunity: async (id: string, communityId: string) =>
        ["member", "mapper", "client"].includes(id) && communityId === "community",
      canUserAccessTask: async (id: string) => ({ allowed: id !== "b" }),
      getTaskById: async () => task,
      getCompletionById: async () => ({ id: "completion", taskId: "task" }),
      getCommunityById: async () => ({ id: "community", organizationId: "org" }),
      getAssetById: async () => ({ id: "asset", communityId: "community" }),
      getAttachmentByIdempotencyKey: async (id: string, key: string) =>
        attachments.find(a => a.taskCompletionId === id && a.idempotencyKey === key),
      getAttachmentByTaskIdAndIdempotencyKey: async (id: string, key: string) =>
        attachments.find(a => a.taskId === id && a.idempotencyKey === key),
      getAssetAttachmentByIdempotencyKey: async (id: string, key: string) =>
        attachments.find(a => a.assetId === id && a.idempotencyKey === key),
      createAttachment: persist,
      addAssetAttachment: persist,
      getAttachmentsByTaskId: async (id: string) => attachments.filter(a => a.taskId === id),
      getDriveFile: async (id: string) => ({
        communityId: "community", fileRef: `/objects/uploads/${id}`, name: "Contract & invoice.pdf",
      }),
    };
    const db = {
      update: () => ({
        set: (data: any) => ({
          where: () => ({ returning: async () => { updates.push(data); return [{ ...users.a, ...data }]; } }),
        }),
      }),
    };
    const module = { exports: {} as any };
    new Function("require", "module", "exports", "__storage", "__db", bundle)(
      require, module, module.exports, storage, db,
    );
    api = module.exports;
    api.objectStorageClient.bucket = () => ({
      file: (name: string) => ({
        name,
        exists: async () => [files.has(name)],
        delete: async () => { files.delete(name); },
        getMetadata: async () => {
          const file = files.get(name);
          assert.ok(file, `missing fixture: ${name}`);
          return [{
            contentType: file.type, size: String(file.bytes.length),
            metadata: file.policy ? { "custom:aclPolicy": JSON.stringify(file.policy) } : {},
          }];
        },
        setMetadata: async (metadata: any) => {
          const file = files.get(name)!;
          file.policy = JSON.parse(metadata.metadata["custom:aclPolicy"]);
          file.writes++;
        },
        createReadStream: () => Readable.from(files.get(name)!.bytes),
      }),
    });
    api.ObjectStorageService.prototype.getPrivateObjectDir = () => "/fixture/private";
    api.ObjectStorageService.prototype.getPublicObjectSearchPaths = () => ["/fixture/private"];
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.session = { userId: req.headers["x-fixture-user"] || "a" };
      req.log = { error: () => {} };
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
  });

  function upload(type?: string, policy?: Policy) {
    const id = randomUUID();
    const file: StoredFile = { type, policy, bytes: Buffer.from("fixture file bytes"), writes: 0 };
    files.set(`private/uploads/${id}`, file);
    files.set(`private/${id}`, file);
    return {
      id, file, path: `/objects/uploads/${id}`,
      url: `https://storage.googleapis.com/fixture/private/uploads/${id}?signature=fixture`,
    };
  }
  async function request(path: string, body?: unknown, user = "a", method = "POST") {
    return fetch(`${base}${path}`, {
      method: body === undefined ? "GET" : method,
      headers: { "Content-Type": "application/json", "x-fixture-user": user },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  it("retains upload URL success and failure bodies without real signing I/O", async () => {
    const original = api.ObjectStorageService.prototype.getObjectEntityUploadURL;
    try {
      api.ObjectStorageService.prototype.getObjectEntityUploadURL = async () => "https://example.invalid/fixture-upload";
      const success = await request("/api/objects/upload", {});
      assert.equal(success.status, 200);
      assert.deepEqual(await success.json(), { uploadURL: "https://example.invalid/fixture-upload" });
      api.ObjectStorageService.prototype.getObjectEntityUploadURL = async () => { throw Error("signing failed"); };
      const failed = await request("/api/objects/upload", {});
      assert.equal(failed.status, 500);
      assert.deepEqual(await failed.json(), { error: "Failed to generate upload URL" });
    } finally {
      api.ObjectStorageService.prototype.getObjectEntityUploadURL = original;
    }
  });

  it("retains cleanup validation and deletes only unshared caller-owned objects", async () => {
    for (const objectPaths of [undefined, [], "not-an-array"]) {
      const response = await request("/api/objects", { objectPaths }, "a", "DELETE");
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: "objectPaths[] is required" });
    }
    const tooMany = await request("/api/objects", { objectPaths: Array(21).fill("/objects/unused") }, "a", "DELETE");
    assert.equal(tooMany.status, 400);
    assert.deepEqual(await tooMany.json(), { error: "Too many objectPaths; max 20 per call" });
    const own = upload("image/jpeg", { owner: "a", visibility: "private" });
    const emptyRules = upload("image/jpeg", { owner: "a", visibility: "private", aclRules: [] });
    const foreign = upload("image/jpeg", { owner: "b", visibility: "private" });
    const shared = upload("image/jpeg", { owner: "a", visibility: "private",
      aclRules: [{ group: { type: "community_member", id: "community" }, permission: "read" }] });
    const noAcl = upload("image/jpeg");
    const response = await request("/api/objects", {
      objectPaths: [own.path, emptyRules.path, foreign.path, shared.path, noAcl.path, "/objects/missing", "/bad", 12],
    }, "a", "DELETE");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { results: [
      { key: own.path, deleted: true }, { key: emptyRules.path, deleted: true },
      { key: foreign.path, deleted: false }, { key: shared.path, deleted: false },
      { key: noAcl.path, deleted: false }, { key: "/objects/missing", deleted: true },
      { key: "/bad", deleted: false }, { key: "12", deleted: false },
    ] });
    assert.equal(files.has(`private/uploads/${own.id}`), false);
    assert.equal(files.has(`private/uploads/${emptyRules.id}`), false);
    for (const item of [foreign, shared, noAcl]) assert.equal(files.has(`private/uploads/${item.id}`), true);
  });

  it("forbids B confirming A's file without changing the policy", async () => {
    const item = upload("image/jpeg", { owner: "a", visibility: "private" });
    const res = await request("/api/objects/confirm", { uploadURL: item.url }, "b");
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: "You do not own this file" });
    assert.deepEqual(item.file.policy, { owner: "a", visibility: "private" });
    assert.equal(item.file.writes, 0);
  });

  it("claims a fresh file, forces caller ownership, and allows repeat stamps", async () => {
    const item = upload("image/jpeg");
    const service = new api.ObjectStorageService();
    assert.equal(await service.claimObjectForCaller(item.url, "a", { owner: "b", visibility: "private" }), item.path);
    assert.equal(item.file.policy?.owner, "a");
    await service.claimObjectForCaller(item.path, "a", { owner: "b", visibility: "private" });
    assert.equal(item.file.writes, 2);
    await assert.rejects(service.claimObjectForCaller(item.path, "b", { owner: "b", visibility: "public" }), api.ObjectForbiddenError);
    assert.equal(item.file.writes, 2);
  });

  it("confirms and attaches mobile/portal task uploads, preserving retries and legacy extra fields", async () => {
    for (const user of ["a", "member", "hoa"]) {
      const item = upload("image/jpeg");
      const confirm = await request("/api/objects/confirm", {
        uploadURL: item.url, communityId: "community", owner: "b", legacyExtra: true,
      }, user);
      assert.equal(confirm.status, 200);
      assert.deepEqual(await confirm.json(), { objectPath: item.path });
      const body = { uploadURL: item.url, idempotencyKey: item.id, legacyExtra: true };
      const attach = await request("/api/tasks/task/attachments", body, user);
      assert.equal(attach.status, 201);
      assert.equal((await attach.json()).fileRef, item.path);
      assert.equal(item.file.policy?.owner, user);
      assert.equal(item.file.writes, 2);
      assert.equal((await request("/api/tasks/task/attachments", body, user)).status, 200);
      assert.equal(item.file.writes, 2);
    }
  });

  it("denies inaccessible community confirmation before writing; admits admin, members and matching HOA roles", async () => {
    for (const user of ["b", "mapper", "hoa", "hoaMember"]) {
      const item = upload("image/jpeg");
      const res = await request("/api/objects/confirm", { uploadURL: item.url, communityId: "other" }, user);
      assert.equal(res.status, 403);
      assert.equal(item.file.writes, 0);
    }
    for (const user of ["a", "member", "hoa", "hoaMember"]) {
      const item = upload("image/jpeg");
      const res = await request("/api/objects/confirm", { uploadURL: item.url, communityId: "community" }, user);
      assert.equal(res.status, 200);
      assert.equal(item.file.policy?.aclRules?.[0].group.id, "community");
    }
  });

  for (const kind of ["task", "completion", "asset", "work-order"]) {
    it(`keeps ${kind} attachment stamping and idempotency; blocks another owner's file`, async () => {
      const user = kind === "work-order" ? "client" : "a";
      const path = kind === "task" ? "/api/tasks/task/attachments"
        : kind === "completion" ? "/api/task-completions/completion/attachments"
        : kind === "asset" ? "/api/assets/asset/attachments"
        : "/api/portfolio/work-orders/task/photos";
      const body = (item: ReturnType<typeof upload>) => kind === "completion"
        ? { fileRef: item.path, url: item.path, idempotencyKey: item.id }
        : kind === "work-order" ? { objectKeys: [item.path] }
        : { uploadURL: item.url, idempotencyKey: item.id, capturedAt: "2026-01-01T00:00:00Z" };
      const item = upload("image/jpeg");
      const confirm = await request("/api/objects/confirm", { uploadURL: item.url }, user);
      assert.equal(confirm.status, 200);
      const res = await request(path, body(item), user);
      assert.equal(res.status, kind === "work-order" ? 200 : 201);
      assert.equal(item.file.policy?.owner, user);
      assert.equal(item.file.policy?.aclRules?.[0].group.id, "community");
      assert.equal(item.file.writes, 2);
      assert.equal(attachments.length, 1);
      assert.equal((await request(path, body(item), user)).status, 200);
      assert.equal(attachments.length, 1);

      const foreign = upload("image/jpeg", { owner: "b", visibility: "private" });
      const denied = await request(path, body(foreign), user);
      assert.equal(denied.status, 403);
      assert.deepEqual(await denied.json(), { error: "You do not own this file" });
      assert.equal(foreign.file.writes, 0);
      assert.equal(foreign.file.policy?.owner, "b");
      assert.equal(attachments.length, 1);
    });
  }

  it("lets work-order photos claim a fresh file without prior confirmation", async () => {
    const item = upload("image/jpeg");
    const res = await request("/api/portfolio/work-orders/task/photos", { objectKeys: [item.path] }, "client");
    assert.equal(res.status, 200);
    assert.equal(item.file.policy?.owner, "client");
    assert.equal(attachments.length, 1);
  });

  it("accepts the mobile offline-completion attachment payload without a separate confirm", async () => {
    const item = upload("image/jpeg");
    const body = {
      taskCompletionId: "completion", uploadURL: item.url,
      idempotencyKey: item.id, legacyExtra: "ignored",
    };
    const res = await request("/api/tasks/task/attachments", body, "member");
    assert.equal(res.status, 201);
    const saved = await res.json();
    assert.equal(saved.taskCompletionId, "completion");
    assert.equal(saved.taskId, null);
    assert.equal(saved.fileRef, item.path);
    assert.equal(saved.legacyExtra, undefined);
    assert.equal(item.file.policy?.owner, "member");
    assert.equal((await request("/api/tasks/task/attachments", body, "member")).status, 200);
    assert.equal(attachments.length, 1);
  });

  it("preserves invalid upload URL and missing-upload responses for task and asset attachments", async () => {
    for (const path of ["/api/tasks/task/attachments", "/api/assets/asset/attachments"]) {
      const invalid = await request(path, { uploadURL: "https://example.com/photo", idempotencyKey: randomUUID() });
      assert.equal(invalid.status, 400);
      assert.equal((await invalid.json()).code, "INVALID_UPLOAD_URL");
      const missing = upload("image/jpeg");
      files.delete(`private/uploads/${missing.id}`);
      const res = await request(path, { uploadURL: missing.url, idempotencyKey: missing.id });
      assert.equal(res.status, 422);
      assert.deepEqual(await res.json(), { error: "Upload not received", code: "UPLOAD_NOT_RECEIVED" });
    }
    assert.equal(attachments.length, 0);
  });

  it("forbids an avatar using another owner's raster file without publishing or updating the account", async () => {
    const item = upload("image/png", { owner: "a", visibility: "private" });
    const res = await request("/api/auth/me", { avatarUrl: item.url }, "b", "PATCH");
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { message: "You do not own this file" });
    assert.deepEqual(item.file.policy, { owner: "a", visibility: "private" });
    assert.equal(item.file.writes, 0);
    assert.deepEqual(updates, []);
  });

  it("rejects HTML, SVG, PDF, HEIC and missing metadata as avatars before publishing", async () => {
    for (const type of ["text/html", "image/svg+xml", "application/pdf", "image/heic", undefined]) {
      const item = upload(type);
      const res = await request("/api/auth/me", { avatarUrl: item.url }, "a", "PATCH");
      assert.equal(res.status, 400);
      assert.deepEqual(await res.json(), { message: "Avatar must be an image" });
      assert.equal(item.file.writes, 0);
    }
    assert.deepEqual(updates, []);
  });

  it("publishes supported raster avatars, displays them, and preserves repeats and removal", async () => {
    for (const type of ["image/jpeg", "image/png", "image/webp", "image/gif"]) {
      const item = upload(type);
      for (let n = 0; n < 2; n++) {
        const res = await request("/api/auth/me", { avatarUrl: item.url, legacyExtra: true }, "a", "PATCH");
        assert.equal(res.status, 200);
        assert.equal((await res.json()).avatarUrl, item.path);
      }
      assert.deepEqual(item.file.policy, { owner: "a", visibility: "public" });
      const displayed = await request(item.path, undefined, "b");
      assert.equal(displayed.status, 200);
      assert.equal(displayed.headers.get("content-type"), type);
      assert.deepEqual(Buffer.from(await displayed.arrayBuffer()), item.file.bytes);
    }
    assert.equal((await request("/api/auth/me", { avatarUrl: null }, "a", "PATCH")).status, 200);
    assert.equal(updates.at(-1).avatarUrl, null);
    assert.equal((await request("/api/auth/me", { avatarUrl: "https://example.com/avatar.png" }, "a", "PATCH")).status, 400);
  });

  for (const type of [
    "text/html", "text/html; charset=utf-8", "image/svg+xml", "IMAGE/SVG+XML; charset=UTF-8",
    "text/plain", "application/javascript", "application/zip", undefined,
  ]) {
    it(`downloads ${type ?? "missing MIME"} safely on both object routes`, async () => {
      const item = upload(type, { owner: "a", visibility: "private" });
      for (const path of [item.path, `/public-objects/${item.id}`]) {
        const res = await request(path, undefined);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get("content-type"), "application/octet-stream");
        assert.equal(res.headers.get("content-disposition"), "attachment");
        assert.equal(res.headers.get("x-content-type-options"), "nosniff");
        assert.deepEqual(Buffer.from(await res.arrayBuffer()), item.file.bytes);
      }
    });
  }

  for (const type of [
    "image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif",
    "application/pdf", "IMAGE/JPEG; fixture=value", "application/pdf; fixture=value",
  ]) {
    it(`displays ${type} inline with nosniff and unchanged bytes`, async () => {
      const item = upload(type, { owner: "a", visibility: "public" });
      for (const path of [item.path, `/public-objects/${item.id}`]) {
        const res = await request(path, undefined);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get("content-type"), type);
        assert.equal(res.headers.get("content-disposition"), null);
        assert.equal(res.headers.get("x-content-type-options"), "nosniff");
        assert.match(res.headers.get("cache-control")!, /^public,/);
        assert.deepEqual(Buffer.from(await res.arrayBuffer()), item.file.bytes);
      }
    });
  }

  it("retains private reading rules and preserves drive filenames for safe and unsafe MIME types", async () => {
    for (const type of ["application/pdf", "text/html"]) {
      const item = upload(type, { owner: "a", visibility: "private" });
      assert.equal((await request(item.path, undefined, "b")).status, 401);
      const res = await request(`/api/drive/files/${item.id}/download`, undefined);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-disposition"), 'attachment; filename="Contract%20%26%20invoice.pdf"');
      assert.equal(res.headers.get("content-type"), type === "text/html" ? "application/octet-stream" : type);
      assert.equal(res.headers.get("x-content-type-options"), "nosniff");
      assert.match(res.headers.get("cache-control")!, /^private,/);
    }
  });

  it("retains the unrestricted backfill entry point without invoking the script", async () => {
    const item = upload("image/jpeg", { owner: "a", visibility: "private" });
    const service = new api.ObjectStorageService();
    await service.trySetObjectEntityAclPolicy(item.path, { owner: "b", visibility: "private" });
    assert.equal(item.file.policy?.owner, "b");
    const backfill = readFileSync(new URL("./scripts/backfill-acl.ts", import.meta.url), "utf8");
    assert.match(backfill, /objectStorageService\.trySetObjectEntityAclPolicy\(row\.fileRef, policy\)/);
    assert.doesNotMatch(routes, /trySetObjectEntityAclPolicy/);
    assert.doesNotMatch(readFileSync(new URL("./auth.ts", import.meta.url), "utf8"), /trySetObjectEntityAclPolicy/);
    assert.doesNotMatch(readFileSync(new URL("./exportGenerator.ts", import.meta.url), "utf8"), /downloadObject|claimObjectForCaller/);
  });
});
