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
      `,
      resolveDir: fileURLToPath(new URL("..", import.meta.url)), loader: "ts",
    },
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{
      name: "policy-fixture-io",
      setup(builder) {
        builder.onResolve({ filter: /^\.\.\/(?:storage|auth|objectStorage|pushNotifications)$/ }, args => ({
          path: args.path.slice(3), namespace: "policy-fixture",
        }));
        builder.onLoad({ filter: /.*/, namespace: "policy-fixture" }, ({ path }) => ({
          contents: path === "storage" ? "module.exports = fixture.storage;"
            : path === "auth" ? `
              export const requireAuth = (req,res,next) => next();
              export const requireAdmin = requireAuth;
            ` : path === "objectStorage" ? `
              export class ObjectStorageService {}
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
    typeof import("../routes/tasks") & typeof import("../routes/handler");
  return { api, calls, storage };
}
