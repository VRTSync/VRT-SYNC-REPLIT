import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const runner = fileURLToPath(new URL("./test-fresh-db.mjs", import.meta.url));

// Separate-process pg and pnpm doubles: these safety tests cannot reach a server.
// The end-to-end acceptance run uses the real runner/driver/migrator/API suite.
async function check(mode, overrides = {}, signal) {
  const dir = await mkdtemp(path.join(tmpdir(), "fresh-db-runner-"));
  const log = path.join(dir, "events.jsonl");
  await writeFile(path.join(dir, "pg.cjs"), `
    const fs = require("node:fs"), Module = require("node:module");
    const log = event => fs.appendFileSync(process.env.LOG, JSON.stringify(event)+"\\n");
    let reads = 0;
    class Client {
      async connect() { log({connect:true}); }
      async end() { log({end:true}); }
      async query(sql,params) {
        log({sql,params});
        if(sql.startsWith("SELECT current_database")) return {rows:[{name:"admin_db"}]};
        if(sql.startsWith("CREATE DATABASE") && process.env.MODE === "create-fail")
          throw Object.assign(new Error("never print driver details"),{code:"42501"});
        if(sql.startsWith("SELECT oid")) return {rows:[{oid: process.env.MODE === "oid-mismatch" && ++reads > 1 ? 43 : 42}]};
        if(sql.startsWith("DROP DATABASE") && process.env.MODE.startsWith("cleanup-fail")) throw Error("failed");
        return {rows:[]};
      }
    }
    const original=Module._load;
    Module._load=function(name,...args) { return name==="pg" ? {Client} : original.call(this,name,...args); };
  `);
  await writeFile(path.join(dir, "pnpm"), `#!${process.execPath}
    const fs=require("node:fs");
    fs.appendFileSync(process.env.LOG, JSON.stringify({args:process.argv.slice(2),url:process.env.DATABASE_URL,
      admin:process.env.FRESH_DB_ADMIN_URL,pg:process.env.PGPASSWORD})+"\\n");
    const migration=process.argv.includes("migrate:up");
    console.log("child "+process.env.DATABASE_URL);
    if(process.env.MODE==="interrupt" && !migration) { console.log("READY_FOR_SIGNAL"); setInterval(()=>{},1000); }
    else process.exit(process.env.MODE==="migrate-fail" && migration ? 23 :
      ["test-fail","cleanup-fail-test"].includes(process.env.MODE) && !migration ? 37 : 0);
  `, { mode: 0o700 });
  try {
    const env = {
      PATH: `${dir}:${process.env.PATH}`, NODE_OPTIONS: `--require=${dir}/pg.cjs`,
      FRESH_DB_ADMIN_URL: "postgresql://test_user:synthetic-password@invalid.example/admin_db",
      DATABASE_URL: "postgresql://test_user:synthetic-password@invalid.example/development",
      PGPASSWORD: "must-not-reach-child", MODE: mode, LOG: log, ...overrides,
    };
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [runner], { env, stdio: ["ignore", "pipe", "pipe"] });
      let output = "", sent = false;
      const timer = setTimeout(() => { child.kill("SIGKILL"); reject(Error("runner timeout")); }, 15000);
      const collect = chunk => {
        output += chunk;
        if (signal && !sent && output.includes("READY_FOR_SIGNAL")) { sent = true; child.kill(signal); }
      };
      child.stdout.on("data", collect);
      child.stderr.on("data", collect);
      child.once("error", reject);
      child.once("close", code => { clearTimeout(timer); resolve({ code, output }); });
    });
    const events = await readFile(log, "utf8").then(s => s.trim().split("\n").map(JSON.parse)).catch(() => []);
    assert.ok(!result.output.includes("synthetic-password"));
    assert.ok(!result.output.includes("postgresql://"));
    return { ...result, events };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("creates only a random database, runs exactly migration then API suite and drops that database", async () => {
  const result = await check("success");
  assert.equal(result.code, 0);
  const sql = result.events.filter(e => e.sql).map(e => e.sql);
  const name = /^CREATE DATABASE "(vrtsync_test_[a-f0-9]{32})" TEMPLATE template0$/.exec(sql.find(s => s.startsWith("CREATE DATABASE")))?.[1];
  assert.ok(name);
  assert.ok(sql.includes(`ALTER DATABASE "${name}" ALLOW_CONNECTIONS false`));
  assert.ok(sql.includes(`DROP DATABASE "${name}"`));
  assert.deepEqual(result.events.find(e => e.sql?.startsWith("SELECT pg_terminate_backend")).params, [42, name]);
  const commands = result.events.filter(e => e.args);
  assert.deepEqual(commands.map(e => e.args), [
    ["--filter", "@workspace/db", "run", "migrate:up"], ["--filter", "@workspace/api-server", "test"],
  ]);
  for (const command of commands) {
    assert.equal(new URL(command.url).pathname, `/${name}`);
    assert.equal(command.admin, undefined);
    assert.equal(command.pg, undefined);
  }
});
for (const [mode, code, commands] of [["migrate-fail", 23, 1], ["test-fail", 37, 2]]) {
  test(`preserves ${mode} exit status and still cleans up`, async () => {
    const result = await check(mode);
    assert.equal(result.code, code);
    assert.equal(result.events.filter(e => e.args).length, commands);
    assert.equal(result.events.filter(e => e.sql?.startsWith("DROP DATABASE")).length, 1);
  });
}
test("CREATE DATABASE denial never runs tests or cleans up an unowned database", async () => {
  const result = await check("create-fail");
  assert.equal(result.code, 1);
  assert.match(result.output, /42501/);
  assert.ok(!result.events.some(e => e.args || /^(ALTER|DROP)|pg_terminate_backend/.test(e.sql ?? "")));
});
for (const [mode, code] of [["cleanup-fail", 1], ["cleanup-fail-test", 37]]) {
  test(`reports ${mode} without masking a failure`, async () => {
    const result = await check(mode);
    assert.equal(result.code, code);
    assert.match(result.output, /CLEANUP FAILED/);
  });
}
test("OID mismatch blocks termination and drop", async () => {
  const result = await check("oid-mismatch");
  assert.equal(result.code, 1);
  assert.match(result.output, /CLEANUP FAILED/);
  assert.ok(!result.events.some(e => /^(ALTER|DROP)|pg_terminate_backend/.test(e.sql ?? "")));
});
for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]]) {
  test(`${signal} stops the test child and removes only the created database`, async () => {
    const result = await check("interrupt", {}, signal);
    assert.equal(result.code, code);
    assert.equal(result.events.filter(e => e.sql?.startsWith("DROP DATABASE")).length, 1);
  });
}
for (const [label, overrides] of [
  ["missing explicit admin URL", { FRESH_DB_ADMIN_URL: "" }],
  ["production mode", { NODE_ENV: "production" }],
  ["query database override", { FRESH_DB_ADMIN_URL: "postgresql://invalid.example/admin_db?database=shared" }],
]) {
  test(`rejects ${label} before connecting`, async () => {
    const result = await check("success", overrides);
    assert.notEqual(result.code, 0);
    assert.deepEqual(result.events, []);
  });
}
