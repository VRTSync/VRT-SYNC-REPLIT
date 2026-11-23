import { build } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
let bundle: Promise<string> | undefined;

/** Bundle the real policy/handlers; replace only external I/O and route guards. */
export async function policyFixture(overrides: Record<string, any> = {}) {
  bundle ??= build({
    stdin: {
      contents: `
        export * from "./policy";
        export { route } from "./routes/handler";
        export { registerTaskRoutes } from "./routes/tasks";
        export { registerInvoiceRoutes } from "./routes/invoices";
        export { registerReportRoutes } from "./routes/reports";
        export { registerContractRoutes } from "./routes/contracts";
        export { registerDriveRoutes } from "./routes/drive";
        export { registerContactRoutes } from "./routes/contacts";
        export { registerCommunityRoutes } from "./routes/communities";
        export { registerDashboardRoutes } from "./routes/dashboard";
        export { registerSearchRoutes } from "./routes/search";
        export { registerCompanyRoutes } from "./routes/companies";
        export { registerUserRoutes } from "./routes/users";
      `,
      resolveDir: fileURLToPath(new URL("..", import.meta.url)), loader: "ts",
    },
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{
      name: "policy-fixture-io",
      setup(builder) {
        builder.onResolve({ filter: /^(?:\.\/|\.\.\/)(?:storage|auth|db|objectStorage|pushNotifications)$/ }, args => ({
          path: args.path.replace(/^\.\.?\//, ""), namespace: "policy-fixture",
        }));
        builder.onLoad({ filter: /.*/, namespace: "policy-fixture" }, ({ path }) => ({
          contents: path === "storage" ? "module.exports = fixture.storage;"
            : path === "db" ? `
              export const pool = { query: (...args) => fixture.storage.reportQuery(...args) };
              export const db = { select: () => ({ from: () => fixture.storage.assetTypeRows() }) };
            `
            : path === "auth" ? `
              export const requireAuth = (req,res,next) => next();
              export const requireAdmin = requireAuth;
              export const requireAdminOrMapCreator = requireAuth;
              export const isHoaRole = role => role === "hoa_admin" || role === "hoa_member";
              export const isClientRole = role => role === "client_admin";
              export const isContractorSide = role => role === "contractor" || role === "contractor_manager";
            ` : path === "objectStorage" ? `
              export class ObjectStorageService {
                getObjectEntityFile(...args) { return fixture.storage.getObjectEntityFile(...args); }
                deleteObject(...args) { return fixture.storage.deleteObject(...args); }
                downloadObject(...args) { return fixture.storage.downloadObject(...args); }
              }
              export class ObjectNotFoundError extends Error {}
              export class ObjectForbiddenError extends Error {}
              export const parseUploadURL = () => ({ valid: true });
            ` : `
              export const notifyTaskAssigned = async () => {};
              export const notifyTaskCompleted = async () => {};
              export const notifyRequestAcknowledged = async () => {};
            `,
          loader: "js",
        }));
        builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({
          path: fileURLToPath(new URL("../../../../lib/db/src/schema/schema.ts", import.meta.url)),
        }));
      },
    }],
  }).then(result => result.outputFiles[0].text);
  const calls: string[][] = [];
  const storage = {
    isUserMemberOfCommunity: async (id: string, communityId: string) => {
      calls.push([id, communityId]);
      return communityId === "member-community";
    },
    getCommunityById: async (id: string) => ({ id, organizationId: "org" }),
    getUserById: async (id: string) => ({ id }),
    reportQuery: async (..._args: any[]) => ({ rows: [] }),
    assetTypeRows: async () => [],
    getUserCommunities: async () => [],
    getTaskPageDataForRole: async () => ({ role: "admin", source: "page-data" }),
    getTaskById: async (id: string) => ({ id, communityId: "member-community", source: "task" }),
    toTaskResponse: (value: unknown) => value,
    toTaskView: (value: unknown) => value,
    WorkAccessError: class WorkAccessError extends Error {},
    WorkValidationError: class WorkValidationError extends Error {},
    ...overrides,
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", "fixture", await bundle)(
    require, module, module.exports, { storage },
  );
  const api = module.exports as typeof import("../policy") &
    typeof import("../routes/tasks") & typeof import("../routes/handler") &
    typeof import("../routes/invoices") & typeof import("../routes/reports") &
    typeof import("../routes/contracts") & typeof import("../routes/drive") &
    typeof import("../routes/contacts") & typeof import("../routes/communities") &
    typeof import("../routes/dashboard") & typeof import("../routes/search") &
    typeof import("../routes/companies") & typeof import("../routes/users");
  return { api, calls, storage };
}
