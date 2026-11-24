import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm, utimes, rename, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { build } from "esbuild";
import { computeStaticVersion } from "../static-version.mjs";

const artifact = fileURLToPath(new URL("../", import.meta.url));

test("content hash is deterministic across order, roots and mtimes; all file types affect it", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "portal-assets-"));
  try {
    for (const dir of ["a", "b"]) await mkdir(path.join(root, dir, "nested"), { recursive: true });
    await writeFile(path.join(root, "a/app.js"), "same script");
    await writeFile(path.join(root, "a/nested/data.json"), '{"same":true}');
    await writeFile(path.join(root, "b/nested/data.json"), '{"same":true}');
    await writeFile(path.join(root, "b/app.js"), "same script");
    const first = await computeStaticVersion(path.join(root, "a"));
    assert.match(first, /^[0-9a-f]{16}$/);
    await utimes(path.join(root, "b/app.js"), new Date(0), new Date(0));
    assert.equal(first, await computeStaticVersion(path.join(root, "b")));
    await writeFile(path.join(root, "b/nested/data.json"), '{"same":false}');
    assert.notEqual(first, await computeStaticVersion(path.join(root, "b")));
    await writeFile(path.join(root, "b/nested/data.json"), '{"same":true}');
    await writeFile(path.join(root, "b/image.png"), Buffer.from([1, 2, 3]));
    assert.notEqual(first, await computeStaticVersion(path.join(root, "b")));
    await rm(path.join(root, "b/image.png"));
    assert.equal(first, await computeStaticVersion(path.join(root, "b")));
    await rename(path.join(root, "b/app.js"), path.join(root, "b/renamed.js"));
    assert.notEqual(first, await computeStaticVersion(path.join(root, "b")));
  } finally { await rm(root, { recursive: true, force: true }); }
});

async function startedVersion() {
  const child = spawn(process.execPath, ["dist/server.mjs"], {
    cwd: artifact,
    env: { ...process.env, NODE_ENV: "production", PORT: "0", SESSION_SECRET: "isolated-build-test-only" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const closed = once(child, "close");
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Built server did not start")), 15000);
      child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Built server exited: ${code}`)); });
      child.once("error", (err) => { clearTimeout(timer); reject(err); });
      child.stdout.on("data", (chunk) => {
        output += chunk.toString();
        const match = output.match(/"staticVersion":"([0-9a-f]{16})"/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
      // Drain stderr without displaying inherited environment or configuration.
      child.stderr.resume();
    });
  } finally {
    child.kill("SIGTERM");
    await closed;
  }
}

test("two production starts of the actual build share the hash of the shipped assets", async () => {
  const expected = await computeStaticVersion(path.join(artifact, "dist/public"));
  assert.equal(await startedVersion(), expected);
  assert.equal(await startedVersion(), expected);
});

test("rebuilt version changes with content; missing build version fails except in development", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "portal-version-"));
  try {
    const publicRoot = path.join(root, "public");
    await mkdir(publicRoot);
    const source = await readFile(path.join(artifact, "src/staticAssets.ts"), "utf8");
    async function compiledVersion(version, env = "production") {
      const compiled = await build({
        stdin: { contents: source, resolveDir: artifact, loader: "ts" },
        bundle: true, platform: "node", format: "esm", write: false,
        packages: "external", define: version ? { __STATIC_VERSION__: JSON.stringify(version) } : {},
      });
      // Import the compiled helper from the artifact so external packages resolve.
      const output = path.join(artifact, `dist/version-test-${process.pid}.mjs`);
      await writeFile(output, compiled.outputFiles[0].contents);
      try {
        const child = spawn(process.execPath, ["--input-type=module", "-e",
          `import { getStaticVersion } from ${JSON.stringify(output)}; process.stdout.write(getStaticVersion());`], {
          cwd: artifact, env: { ...process.env, NODE_ENV: env }, stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        child.stdout.on("data", (chunk) => { stdout += chunk; });
        child.stderr.resume();
        const [code] = await once(child, "close");
        return { code, stdout };
      } finally { await rm(output, { force: true }); }
    }
    await writeFile(path.join(publicRoot, "app.js"), "first");
    const first = await computeStaticVersion(publicRoot);
    assert.deepEqual(await compiledVersion(first), { code: 0, stdout: first });
    await writeFile(path.join(publicRoot, "app.js"), "changed");
    const second = await computeStaticVersion(publicRoot);
    assert.notEqual(first, second);
    assert.deepEqual(await compiledVersion(second), { code: 0, stdout: second });
    assert.equal((await compiledVersion(undefined)).code, 1);
    const dev = await compiledVersion(undefined, "development");
    assert.equal(dev.code, 0);
    assert.match(dev.stdout, /^[0-9a-z]+$/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
