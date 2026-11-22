import { readFileSync } from "node:fs";

/**
 * Existing isolated HTTP suites select groups of production handlers by their
 * original neighboring route boundaries. Reassemble those boundaries in memory
 * after extraction; no route implementation or assertion is copied or changed.
 * Structural tests must read the actual files, not this fixture view.
 */
export function readRouteFixtureSource(): string {
  let source = readFileSync(new URL("../routes/routes.ts", import.meta.url), "utf8");
  const tasks = readFileSync(new URL("../routes/tasks.ts", import.meta.url), "utf8");
  const handlers = [...tasks.matchAll(/^  app\.(?:get|post|put|delete)\("\/api\/(?:tasks|task-completions)[^\n]*\n[\s\S]*?^  \}\)\);/gm)]
    .map(match => match[0]);
  if (handlers.length !== 17) throw new Error("Task fixture expected exactly 17 production handlers");
  const insertBefore = (boundary: string, content: string) => {
    if (!source.includes(boundary)) throw new Error(`Missing production fixture boundary: ${boundary}`);
    source = source.replace(boundary, `${content}\n\n${boundary}`);
  };
  if (!source.includes("  registerTaskRoutes(app);")) throw new Error("Missing task registration");
  source = source.replace("  registerTaskRoutes(app);", handlers.slice(0, 13).join("\n\n"));
  insertBefore('  app.get("/api/map-layers",', handlers.slice(13, 15).join("\n\n"));
  insertBefore("  // CSV Task Import", handlers[15]);
  insertBefore("  // Task Schedules CRUD", handlers[16]);
  return source;
}

export const taskFixtureImports = `
  import * as policy from "./policy";
  import { route } from "./routes/handler";
`;
