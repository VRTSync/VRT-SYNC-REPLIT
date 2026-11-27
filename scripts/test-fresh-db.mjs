import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../lib/db/package.json", import.meta.url));
const { Client } = require("pg");
const root = fileURLToPath(new URL("../", import.meta.url));
const namePattern = /^vrtsync_test_[a-f0-9]{32}$/;

// No DATABASE_URL fallback: callers must explicitly authorize a throwaway server.
const rawUrl = process.env.FRESH_DB_ADMIN_URL;
if (!rawUrl || process.env.NODE_ENV === "production" || process.argv.length > 2) {
  console.error("Use FRESH_DB_ADMIN_URL in a non-production environment; no URL arguments are accepted.");
  process.exit(1);
}

let adminUrl;
try {
  adminUrl = new URL(rawUrl);
  if (!["postgres:", "postgresql:"].includes(adminUrl.protocol) ||
      !adminUrl.hostname || !adminUrl.pathname.slice(1) || adminUrl.hash) throw new Error();
  // Connection query parameters can otherwise override the randomly chosen database.
  const allowed = new Set(["sslmode", "sslcert", "sslkey", "sslrootcert", "sslpassword", "channel_binding"]);
  for (const key of adminUrl.searchParams.keys()) if (!allowed.has(key)) throw new Error();
} catch {
  console.error("Invalid admin PostgreSQL URL; use an explicit database and only TLS query parameters.");
  process.exit(1);
}

const database = `vrtsync_test_${randomBytes(16).toString("hex")}`;
const targetUrl = new URL(adminUrl);
targetUrl.pathname = `/${database}`;
const admin = new Client({ connectionString: rawUrl, connectionTimeoutMillis: 10000 });
let connected = false;
let created = false;
let databaseOid;
let child;
let interrupted = 0;
let status = 1;
let killTimer;

function interrupt(signal) {
  interrupted ||= signal === "SIGINT" ? 130 : signal === "SIGHUP" ? 129 : 143;
  if (child?.pid) {
    try { process.kill(-child.pid, "SIGTERM"); } catch { /* already exited */ }
    killTimer ??= setTimeout(() => {
      try { process.kill(-child.pid, "SIGKILL"); } catch { /* already exited */ }
    }, 5000);
  }
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => interrupt(signal));

// Redact even if a child error includes its database URL. Never log driver errors.
const secrets = [rawUrl, targetUrl.href, adminUrl.password,
  decodeURIComponent(adminUrl.password)].filter(Boolean);
function output(stream, destination) {
  let pending = "";
  stream.setEncoding("utf8");
  const write = (line) => {
    for (const secret of secrets) line = line.split(secret).join("[redacted]");
    destination.write(line.replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, "[redacted PostgreSQL URL]"));
  };
  stream.on("data", (chunk) => {
    pending += chunk;
    let end;
    while ((end = pending.indexOf("\n")) !== -1) {
      write(pending.slice(0, end + 1));
      pending = pending.slice(end + 1);
    }
  });
  stream.on("end", () => { if (pending) write(pending); });
}

async function run(args) {
  if (interrupted) return interrupted;
  // Inherit no alternative DB credentials or admin URL into migration/test children.
  const env = { ...process.env, DATABASE_URL: targetUrl.href, NODE_ENV: "test" };
  for (const key of Object.keys(env)) {
    if (key.startsWith("PG") || key === "FRESH_DB_ADMIN_URL") delete env[key];
  }
  return new Promise((resolve) => {
    child = spawn("pnpm", args, { cwd: root, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    output(child.stdout, process.stdout);
    output(child.stderr, process.stderr);
    child.on("error", () => { console.error("Unable to start pnpm."); });
    child.on("close", (code) => {
      clearTimeout(killTimer);
      killTimer = undefined;
      child = undefined;
      resolve(interrupted || code || (code === 0 ? 0 : 1));
    });
  });
}

try {
  if (!namePattern.test(database) || database === decodeURIComponent(adminUrl.pathname.slice(1))) {
    throw new Error("guard");
  }
  await admin.connect();
  connected = true;
  // Confirm the connection really reached the requested admin DB before any DDL.
  const actual = (await admin.query("SELECT current_database() AS name")).rows[0].name;
  if (actual !== decodeURIComponent(adminUrl.pathname.slice(1)) || actual === database) throw new Error("guard");
  if (interrupted) throw new Error("interrupted");
  await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`);
  created = true;
  // A successful CREATE is the only path that permits cleanup. Never claim an existing DB.
  databaseOid = (await admin.query("SELECT oid FROM pg_database WHERE datname=$1", [database])).rows[0]?.oid;
  if (!databaseOid) throw new Error("identity");
  console.log(`Created isolated database ${database}`);
  status = await run(["--filter", "@workspace/db", "run", "migrate:up"]);
  if (status === 0) status = await run(["--filter", "@workspace/api-server", "test"]);
} catch (error) {
  // PostgreSQL codes are safe; error messages can contain passwords or URLs.
  const code = /^[A-Z0-9]{5}$/.test(error?.code ?? "") ? ` (${error.code})` : "";
  console.error(`Fresh-database setup/run failed${code}. Check connectivity and CREATE DATABASE permission.`);
  status = interrupted || 1;
} finally {
  if (created) {
    try {
      if (!namePattern.test(database)) throw new Error("guard");
      const row = (await admin.query("SELECT oid FROM pg_database WHERE datname=$1", [database])).rows[0];
      if (!databaseOid || row?.oid !== databaseOid) throw new Error("identity");
      // Block reconnects, then terminate ONLY connections to this invocation's database.
      await admin.query(`ALTER DATABASE "${database}" ALLOW_CONNECTIONS false`);
      await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datid=$1 AND datname=$2", [databaseOid, database]);
      await admin.query(`DROP DATABASE "${database}"`);
      console.log(`Removed isolated database ${database}`);
    } catch {
      console.error(`CLEANUP FAILED for ${database}; an administrator must remove this disposable database.`);
      // Preserve an earlier failure code; cleanup failure can never make a run successful.
      if (status === 0) status = 1;
    }
  }
  if (connected) await admin.end().catch(() => {});
}
process.exitCode = interrupted || status;
