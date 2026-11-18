import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import express from "express";
import { transformSync } from "esbuild";

// Run the actual app.ts middleware over HTTP without importing auth/database
// startup. Fail explicitly if its verified placement changes.
const source = readFileSync(new URL("./app.ts", import.meta.url), "utf8");
const start = source.indexOf("app.use((req: Request, res: Response, next: NextFunction) => {");
const end = source.indexOf("\napp.use(\n  express.json(", start);
assert.ok(start >= 0 && end > start, "Verified app.ts CORS middleware boundary missing");
const middleware = transformSync(source.slice(start, end), { loader: "ts" }).code;

// Release gate (owner-controlled; do not publish from this test):
// Deployment metadata and live /web/login + /portal-static/portal-api.js
// confirmed https://vrt-sync-mobile.replit.app uses same-origin /api requests.
// No extra ALLOWED_ORIGINS is currently required for the portal.
// After an authorized publish, sign in to the web portals and Expo web preview,
// load role-appropriate data and log out; inspect browser requests for CORS
// errors and verify exact Origin/credential headers on cross-origin requests.
// If a separate custom frontend is introduced, authorize its full origin via
// ALLOWED_ORIGINS before publishing. No production login is performed here.
describe("CORS origin allow-list", { concurrency: false }, () => {
  const keys = [
    "NODE_ENV", "REPLIT_DEV_DOMAIN", "REPLIT_EXPO_DEV_DOMAIN",
    "REPLIT_DOMAINS", "ALLOWED_ORIGINS",
  ] as const;
  let saved: Record<string, string | undefined>;
  let server: Server;
  let base: string;

  before(async () => {
    const app = express();
    new Function("app", middleware)(app);
    // Echoing verifies disallowed/no-Origin requests still reach the next
    // handler with credentials and payload intact (native clients need no CORS).
    app.use(express.json());
    app.use((req, res) => {
      res.json({ method: req.method, authorization: req.header("authorization"), body: req.body });
    });
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    base = `http://127.0.0.1:${address.port}`;
  });
  beforeEach(() => {
    saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    for (const key of keys) delete process.env[key];
  });
  afterEach(() => {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });
  after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((err) => err ? reject(err) : resolve()),
    );
  });

  async function request(origin?: string, method = "GET") {
    return fetch(`${base}/cors-probe`, {
      method,
      headers: origin ? { Origin: origin } : {},
    });
  }
  function allowed(res: Response, origin: string) {
    assert.equal(res.headers.get("access-control-allow-origin"), origin);
    assert.equal(res.headers.get("access-control-allow-credentials"), "true");
    assert.equal(res.headers.get("access-control-allow-methods"), "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    assert.equal(res.headers.get("access-control-allow-headers"), "Content-Type, Authorization");
  }
  function denied(res: Response) {
    res.headers.forEach((_value, name) => {
      assert.ok(!name.startsWith("access-control-"), `Unexpected CORS header: ${name}`);
    });
  }

  it("rejects unrelated Replit tenants and localhost in production without blocking handlers", async () => {
    process.env.NODE_ENV = "production";
    for (const origin of [
      "https://someone-else.replit.app", "https://someone-else.replit.dev",
      "https://someone-else.janeway.replit.dev", "https://someone-else.expo.janeway.replit.dev",
      "http://localhost:5173", "http://127.0.0.1:5173", "https://unrelated.example", "null",
    ]) {
      const res = await request(origin);
      assert.equal(res.status, 200);
      denied(res);
      assert.deepEqual(await res.json(), { method: "GET" });
    }
  });

  it("accepts exact entries from every configured domain/origin setting in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.REPLIT_DEV_DOMAIN = "own.replit.dev";
    process.env.REPLIT_EXPO_DEV_DOMAIN = "own.expo.janeway.replit.dev";
    process.env.REPLIT_DOMAINS = "own.replit.app, portal.example.com, ,";
    process.env.ALLOWED_ORIGINS = " https://app.vrtsync.com, https://other.example:8443, ,";
    for (const origin of [
      "https://own.replit.dev", "https://own.expo.janeway.replit.dev",
      "https://own.replit.app", "https://portal.example.com",
      "https://app.vrtsync.com", "https://other.example:8443",
    ]) {
      const res = await request(origin);
      assert.equal(res.status, 200);
      allowed(res, origin);
      await res.json();
    }
    for (const origin of [
      "https://sub.app.vrtsync.com", "https://app.vrtsync.com.evil.example",
      "http://app.vrtsync.com", "https://app.vrtsync.com:8443",
      "https://other.example", "https://own.replit.app.evil.example",
    ]) {
      const res = await request(origin);
      denied(res);
      await res.json();
    }
  });

  it("retains Replit previews and localhost with NODE_ENV unset or development", async () => {
    for (const env of [undefined, "development"]) {
      if (env === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = env;
      for (const origin of [
        "https://preview.replit.dev", "https://preview.replit.app",
        "https://preview.janeway.replit.dev", "https://preview.expo.janeway.replit.dev",
        "http://localhost:5173", "http://127.0.0.1:5173",
      ]) {
        const res = await request(origin);
        allowed(res, origin);
        await res.json();
      }
      const res = await request("https://unrelated.example");
      denied(res);
      await res.json();
    }
  });

  it("keeps OPTIONS at 200 with unchanged headers only for allowed origins", async () => {
    process.env.NODE_ENV = "production";
    process.env.ALLOWED_ORIGINS = "https://app.vrtsync.com";
    for (const origin of ["https://app.vrtsync.com", "https://someone-else.replit.app", undefined]) {
      const res = await request(origin, "OPTIONS");
      assert.equal(res.status, 200);
      assert.equal(await res.text(), "OK");
      if (origin === "https://app.vrtsync.com") allowed(res, origin);
      else denied(res);
    }
  });

  it("preserves native requests without Origin, including credentials and legacy JSON fields", async () => {
    process.env.NODE_ENV = "production";
    const body = { ordinaryField: "value", legacyUnknownField: { preserved: true } };
    const res = await fetch(`${base}/cors-probe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer native-test-token" },
      body: JSON.stringify(body),
    });
    assert.equal(res.status, 200);
    denied(res);
    assert.deepEqual(await res.json(), { method: "POST", authorization: "Bearer native-test-token", body });
  });
});
