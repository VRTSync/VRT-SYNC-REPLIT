import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { rm, cp, mkdir, writeFile } from "node:fs/promises";
import { ROLE_LABELS } from "@workspace/roles";
import { build as viteBuild } from "vite";
import { computeStaticVersion } from "./static-version.mjs";

globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));

async function buildAll() {
  const distDir = path.resolve(artifactDir, "dist");
  await rm(distDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  const labels = `window.VRT_ROLE_LABELS = ${JSON.stringify(ROLE_LABELS)};`;
  await mkdir(path.resolve(artifactDir, "public/common"), { recursive: true });
  await writeFile(path.resolve(artifactDir, "public/common/role-labels.js"), labels);

  // Hash exactly the snapshot shipped with the bundle, not runtime/startup time.
  await cp(path.resolve(artifactDir, "templates"), path.resolve(distDir, "templates"), { recursive: true });
  await cp(path.resolve(artifactDir, "public"), path.resolve(distDir, "public"), { recursive: true });
  const staticVersion = await computeStaticVersion(path.resolve(distDir, "public"));

  await esbuild({
    define: { __STATIC_VERSION__: JSON.stringify(staticVersion) },
    entryPoints: [path.resolve(artifactDir, "src/server.ts")],
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    logLevel: "info",
    external: [
      "*.node",
      "sharp",
      "better-sqlite3",
      "sqlite3",
      "canvas",
      "bcrypt",
      "argon2",
      "fsevents",
      "bufferutil",
      "utf-8-validate",
      "pg-native",
    ],
    sourcemap: "linked",
    plugins: [esbuildPluginPino({ transports: ["pino-pretty"] })],
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
`,
    },
  });
  await viteBuild({ configFile: path.resolve(artifactDir, "app/vite.config.ts") });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
