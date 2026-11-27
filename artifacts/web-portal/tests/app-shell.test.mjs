import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { once } from "node:events";
import express from "express";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
let server, base, source;
const roles = ["admin", "property_manager", "hoa_admin", "hoa_member", "contractor_manager", "contractor"];

before(async () => {
  source = await readFile(path.join(root, "src/server.ts"), "utf8");
  const start = source.indexOf("async function getUserRole(");
  const end = source.indexOf("// ── Routes", start);
  assert.ok(start > 0 && end > start);
  const routeStart = source.indexOf("app.get(/^\\/app");
  const routeEnd = source.indexOf('app.get("/web/login"', routeStart);
  assert.ok(routeStart > end && routeEnd > routeStart);
  const { outputFiles } = await build({
    stdin: {
      contents: `${source.slice(start, end)}
        export function setup(app) { ${source.slice(routeStart, routeEnd)} }`,
      loader: "ts", resolveDir: root,
    },
    write: false, bundle: true, platform: "node", format: "cjs",
  });
  const module = { exports: {} };
  const pool = {
    async query(sql, [userId]) {
      assert.equal(sql, "SELECT role, is_active FROM users WHERE id = $1");
      if (userId === "missing") return { rows: [] };
      return { rows: [{ role: userId === "inactive" ? "admin" : userId, is_active: userId !== "inactive" }] };
    },
  };
  new Function("module", "exports", "require", "pool", "path", "APP_ROOT", "stampHtml",
    outputFiles[0].text)(module, module.exports, require, pool, path, path.join(root, "dist/app"), x => x);
  const app = express();
  app.use((req, _res, next) => {
    req.session = { userId: req.headers["x-fixture-user"] };
    next();
  });
  app.use("/app/assets", express.static(path.join(root, "dist/app/assets"), {
    maxAge: "1y", immutable: true, fallthrough: false,
  }));
  module.exports.setup(app);
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise(resolve => server.close(resolve)));

test("signed-out, missing and inactive database users cannot load app deep links", async () => {
  for (const user of [undefined, "missing", "inactive"]) {
    for (const route of ["/app", "/app/some/deep/link"]) {
      const r = await fetch(base + route, { redirect: "manual", headers: user ? { "x-fixture-user": user } : {} });
      assert.equal(r.status, 302);
      assert.equal(r.headers.get("location"), "/web/login");
      assert.equal(r.headers.get("cache-control"), "no-store");
    }
  }
});

test("all six allowed current database roles get the built no-store SPA fallback", async () => {
  const html = await readFile(path.join(root, "dist/app/index.html"), "utf8");
  for (const role of roles) {
    const r = await fetch(base + "/app/some/deep/link", { headers: { "x-fixture-user": role } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.equal(await r.text(), html);
  }
});

test("clients keep portfolio; Map Creators get an external-script logout notice", async () => {
  const client = await fetch(base + "/app", { redirect: "manual", headers: { "x-fixture-user": "client_admin" } });
  assert.equal(client.status, 302);
  assert.equal(client.headers.get("location"), "/web/portfolio/dashboard");
  const creator = await fetch(base + "/app", { headers: { "x-fixture-user": "map_creator" } });
  assert.equal(creator.status, 200);
  assert.equal(creator.headers.get("cache-control"), "no-store");
  const html = await creator.text();
  assert.match(html, /Map Creator accounts use the VRTSync mobile app\./);
  assert.match(html, /src="\/common-static\/mobile-notice.js"/);
  assert.doesNotMatch(html, /\sonclick=|<script>/i);
});

test("hashed production assets have immutable caching, missing assets never get SPA HTML", async () => {
  const files = await readdir(path.join(root, "dist/app/assets"));
  const js = files.find(f => /^.*-[\w-]+\.js$/.test(f));
  assert.ok(js);
  const r = await fetch(base + "/app/assets/" + js);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("cache-control"), /max-age=31536000.*immutable/);
  const missing = await fetch(base + "/app/assets/missing.js");
  assert.equal(missing.status, 404);
  assert.doesNotMatch(await missing.text(), /id="root"/);
});

test("every legacy shell loads shared labels first and read-only session provisioning remains unchanged", async () => {
  for (const role of ["admin", "pm", "hoa", "contractor", "portfolio"]) {
    const html = await readFile(path.join(root, `templates/${role}-shell.html`), "utf8");
    assert.match(html.match(/<script[^>]*>/)[0], /src="\/common-static\/role-labels.js"/);
  }
  assert.match(source, /createTableIfMissing: false/);
  assert.match(source, /scriptSrc: \["'self'", "'unsafe-inline'", "https:\/\/unpkg.com"\]/);
  const labels = await readFile(path.join(root, "dist/public/common/role-labels.js"), "utf8");
  assert.ok(labels.startsWith("window.VRT_ROLE_LABELS = "));
  assert.equal(JSON.parse(labels.slice("window.VRT_ROLE_LABELS = ".length, -1)).hoa_member, "Board Member");
});
