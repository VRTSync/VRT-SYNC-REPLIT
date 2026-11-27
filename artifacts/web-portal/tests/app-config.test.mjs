import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
async function load(relative) {
  const { outputFiles } = await build({
    entryPoints: [fileURLToPath(new URL("../app/src/" + relative, import.meta.url))],
    write: false, bundle: true, platform: "node", format: "cjs", packages: "external",
  });
  const module = { exports: {} };
  new Function("module", "exports", "require", outputFiles[0].text)(module, module.exports, require);
  return module.exports;
}

test("each role has exactly the approved ordered sidebar labels and legacy destinations", async () => {
  const { navFor } = await load("nav.ts");
  const expected = {
    property_manager: ["Dashboard", "Tasks", "Map", "Invoices", "Documents", "Reports", "Users", "Contacts"],
    hoa_admin: ["Dashboard", "Tasks", "Requests", "Map", "Invoices", "Documents", "Reports", "Users", "Contacts"],
    hoa_member: ["Dashboard", "Requests", "Map", "Invoices", "Documents", "Reports", "Contacts"],
    contractor_manager: ["Dashboard", "Tasks", "Map", "Service Schedule"],
    contractor: ["Dashboard", "My Tasks", "Map", "Service Schedule"],
    admin: ["Dashboard", "Communities", "Client Organizations", "Users", "Contacts", "Contracts", "Invoices", "Reports",
      "Templates", "Asset Types", "Xeriscape Planner", "Import Tasks", "Data Import", "Exports", "Task Auto-Generate", "Mowing & Service Days"],
  };
  for (const [role, labels] of Object.entries(expected)) {
    const items = navFor(role).flatMap(g => g.items);
    assert.deepEqual(items.map(i => i.label), labels);
    assert.equal(items[0].app, true);
    assert.equal(items[0].href, "/");
    assert.ok(items.slice(1).every(i => !i.app && i.href.startsWith("/web/")));
  }
  const admin = navFor("admin");
  assert.deepEqual(admin.map(g => g.heading), ["Overview", "Communities", "People", "Contracts and billing", "Setup", "Data", "Scheduling (retiring)"]);
  assert.equal(admin[5].items[0].href, "/web/admin/imports/contract-tasks");
  assert.equal(admin[5].items[1].href, "/web/admin/imports/seed");
});

test("only working approved plus actions exist", async () => {
  const { plusActionsFor } = await load("nav.ts");
  assert.deepEqual(plusActionsFor("admin").map(a => [a.label, a.href]), [
    ["Create user", "/web/admin/users?action=create_user"],
    ["New community", "/web/admin/communities?action=new_community"],
  ]);
  assert.deepEqual(plusActionsFor("property_manager").map(a => a.href), ["/web/pm/tasks?action=create_task"]);
  assert.deepEqual(plusActionsFor("hoa_admin").map(a => a.href), ["/web/hoa/requests?action=create_request"]);
  for (const role of ["hoa_member", "contractor", "contractor_manager"]) assert.deepEqual(plusActionsFor(role), []);
});

test("shared community storage survives browser storage denial", async () => {
  const { communityKey, storageGet, storageSet, storageRemove } = await load("storage.ts");
  assert.equal(communityKey("fixture-user"), "vrtsync_community_fixture-user");
  globalThis.window = { get localStorage() { throw new Error("Storage blocked"); } };
  try {
    assert.equal(storageGet("k"), null);
    assert.equal(storageSet("k", "v"), false);
    assert.doesNotThrow(() => storageRemove("k"));
  } finally { delete globalThis.window; }
});
