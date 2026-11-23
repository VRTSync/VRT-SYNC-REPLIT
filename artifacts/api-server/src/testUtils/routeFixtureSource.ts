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
  for (const [file, register, expected] of [
    ["communities", "registerCommunityRoutes", 10],
    ["dashboard", "registerDashboardRoutes", 2],
    ["search", "registerSearchRoutes", 3],
    ["hoa", "registerHoaRoutes", 4],
    ["portfolioWorkOrders", "registerPortfolioWorkOrderRoutes", 9],
    ["portfolio", "registerPortfolioRoutes", 25],
    ["assets", "registerAssetRoutes", 16],
    ["mapLayers", "registerMapLayerRoutes", 17],
    ["assetTypes", "registerAssetTypeRoutes", 4],
    ["offlinePacks", "registerOfflinePackRoutes", 7],
    ["invoices", "registerInvoiceRoutes", 5],
    ["reports", "registerReportRoutes", 3],
    ["contracts", "registerContractRoutes", 5],
    ["objects", "registerObjectRoutes", 5],
    ["drive", "registerDriveRoutes", 8],
    ["contacts", "registerContactRoutes", 4],
  ] as const) {
    const module = readFileSync(new URL(`../routes/${file}.ts`, import.meta.url), "utf8");
    const count = [...module.matchAll(/^  app\.(?:get|post|patch|put|delete)\("[^\n]*\n[\s\S]*?^  \}\)\);/gm)].length;
    if (count !== expected) throw new Error(`${file} fixture expected exactly ${expected} production handlers`);
    const signature = `export function ${register}(app: Express): void {\n`;
    const start = module.indexOf(signature);
    const call = `  ${register}(app);`;
    if (start < 0 || !module.endsWith("}\n") || source.split(call).length !== 2) {
      throw new Error(`Missing or ambiguous ${file} fixture boundary`);
    }
    source = source.replace(call, module.slice(start + signature.length, -2).trimEnd());
  }
  // Restore module handlers first: the task link fixture boundary lives in the
  // map-layer module now, but must retain its original position in this view.
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
