import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import path from "node:path";

const appDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: appDir,
  base: "/app/",
  plugins: [react()],
  build: {
    outDir: path.resolve(appDir, "../dist/app"),
    emptyOutDir: true,
  },
  server: {
    fs: { allow: [path.resolve(appDir, "..")] },
  },
});
