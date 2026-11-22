import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Request } from "express";
import type { Actor, TaskEditLevel } from "./policy";
import { policyFixture } from "./testUtils/policyFixture";

type MatrixRow = {
  name: string;
  role: Actor["role"];
  member?: boolean;
  assigned?: boolean;
  company?: string | null;
  taskCompany?: string | null;
  hoaCommunity?: string | null;
  expected: [boolean, boolean, TaskEditLevel, boolean, boolean, boolean];
};
const rows: MatrixRow[] = [
  { name: "admin", role: "admin", expected: [true, true, "manager", true, true, true] },
  { name: "PM member", role: "property_manager", member: true, expected: [true, true, "manager", false, false, false] },
  { name: "PM non-member", role: "property_manager", expected: [false, false, null, false, false, false] },
  { name: "PM assigned non-member", role: "property_manager", assigned: true, expected: [true, false, "manager", false, false, false] },
  { name: "contractor assigned member", role: "contractor", assigned: true, member: true, company: "company", expected: [true, false, "field", true, false, false] },
  { name: "contractor unassigned member", role: "contractor", member: true, expected: [false, false, null, false, false, false] },
  { name: "contractor assigned non-member", role: "contractor", assigned: true, expected: [false, false, null, false, false, false] },
  // Crew read access historically depends on assignment + membership, not company.
  { name: "contractor assigned other company", role: "contractor", assigned: true, member: true, company: "other", expected: [true, false, "field", true, false, false] },
  { name: "manager same company member", role: "contractor_manager", member: true, company: "company", expected: [true, true, "manager_fixed_company", true, false, true] },
  { name: "manager other company member", role: "contractor_manager", member: true, company: "other", expected: [false, true, null, false, false, true] },
  { name: "manager no company", role: "contractor_manager", member: true, expected: [false, false, null, false, false, true] },
  { name: "manager non-member", role: "contractor_manager", company: "company", expected: [false, false, null, false, false, true] },
  { name: "HOA admin own community", role: "hoa_admin", hoaCommunity: "other-community", expected: [true, false, null, false, false, false] },
  { name: "HOA admin other community", role: "hoa_admin", hoaCommunity: "elsewhere", member: true, expected: [false, false, null, false, false, false] },
  { name: "HOA member own community", role: "hoa_member", hoaCommunity: "member-community", member: true, expected: [true, false, null, false, false, false] },
  { name: "HOA member other community", role: "hoa_member", hoaCommunity: "elsewhere", member: true, expected: [false, false, null, false, false, false] },
  { name: "map creator member", role: "map_creator", member: true, expected: [true, false, null, false, false, false] },
  { name: "map creator non-member", role: "map_creator", expected: [false, false, null, false, false, false] },
  { name: "client admin member", role: "client_admin", member: true, expected: [true, false, null, false, false, false] },
  { name: "client admin organization only", role: "client_admin", expected: [false, false, null, false, false, false] },
  { name: "client admin assigned", role: "client_admin", assigned: true, expected: [true, false, null, false, false, false] },
];

function actor(role: Actor["role"], extra: Partial<Actor> = {}): Actor {
  return { id: "actor", role, companyId: null, hoaCommunityId: null, organizationId: "org", ...extra };
}

describe("permission engine role matrix", () => {
  for (const row of rows) it(row.name, async () => {
    const { api } = await policyFixture();
    const person = actor(row.role, { companyId: row.company ?? null, hoaCommunityId: row.hoaCommunity ?? null });
    const task = {
      communityId: row.member ? "member-community" : "other-community",
      assignedTo: row.assigned ? person.id : "someone-else",
      contractorCompanyId: row.taskCompany ?? "company",
    };
    assert.deepEqual([
      await api.canReadTask(person, task),
      await api.canCreateTask(person, task.communityId),
      await api.taskEditLevel(person, task),
      await api.canCompleteTask(person, task),
      api.canDeleteTask(person),
      api.canBulkAssign(person),
    ], row.expected);
    assert.equal(api.canEditTaskLink(person), row.role === "admin");
    assert.equal(api.canImportTasks(person), row.role === "admin");
  });

  it("preserves general community access, distinct from task read access", async () => {
    const { api } = await policyFixture();
    const cases: [Actor, string, boolean][] = [
      [actor("admin"), "other-community", true],
      [actor("map_creator"), "other-community", true],
      [actor("hoa_admin", { hoaCommunityId: "member-community" }), "member-community", true],
      [actor("hoa_admin", { hoaCommunityId: "elsewhere" }), "member-community", false],
      [actor("hoa_member", { hoaCommunityId: null }), "member-community", false],
      [actor("client_admin"), "other-community", true],
      [actor("client_admin", { organizationId: "different-org" }), "member-community", false],
      [actor("client_admin", { organizationId: null }), "member-community", false],
      [actor("property_manager"), "member-community", true],
      [actor("contractor"), "other-community", false],
      [actor("contractor_manager", { companyId: "company" }), "member-community", true],
    ];
    for (const [person, community, expected] of cases) {
      assert.equal(await api.canAccessCommunity(person, community), expected);
    }
  });

  it("preserves the list/page-data difference for HOA accounts with no assignment", async () => {
    const { api } = await policyFixture();
    for (const role of ["hoa_admin", "hoa_member"] as const) {
      const person = actor(role);
      assert.equal(await api.canListTasks(person, "other-community"), false);
      assert.equal(await api.canListTasks(person, "other-community", "page-data"), true);
      assert.equal(await api.canListTasks(person), true);
      const assigned = actor(role, { hoaCommunityId: "elsewhere" });
      assert.equal(await api.canListTasks(assigned, "other-community"), true);
      assert.equal(api.taskListScope(assigned, "list").hoaCommunityId, "elsewhere");
    }
    assert.equal(await api.canListTasks(actor("admin"), "other-community"), true);
    assert.equal(await api.canListTasks(actor("property_manager"), "other-community"), false);
    assert.equal(await api.canListTasks(actor("contractor_manager"), "member-community"), true);
  });

  it("caches concurrent membership checks once per request and community, never across requests", async () => {
    const { api, calls } = await policyFixture();
    const req = { currentUser: actor("property_manager") } as Request;
    const task = { communityId: "member-community", assignedTo: null, contractorCompanyId: null };
    await Promise.all([
      api.canAccessCommunity(api.actorFrom(req), task.communityId),
      api.canReadTask(api.actorFrom(req), task),
      api.canCreateTask(api.actorFrom(req), task.communityId),
      api.taskEditLevel(api.actorFrom(req), task),
      api.canListTasks(api.actorFrom(req), task.communityId),
    ]);
    assert.deepEqual(calls, [["actor", "member-community"]]);
    await api.canListTasks(api.actorFrom(req), "other-community");
    await api.canReadTask(api.actorFrom({ currentUser: actor("property_manager") } as Request), task);
    assert.deepEqual(calls, [
      ["actor", "member-community"], ["actor", "other-community"], ["actor", "member-community"],
    ]);
    req.currentUser = actor("property_manager", { id: "different-user" }) as Request["currentUser"];
    await api.canReadTask(api.actorFrom(req), task);
    assert.deepEqual(calls.at(-1), ["different-user", "member-community"]);
  });

  it("constructs actors from live users and exposes typed denial errors", async () => {
    const { api } = await policyFixture();
    assert.throws(() => api.actorFrom({} as Request), api.UnauthenticatedError);
    assert.throws(() => api.assertCan(false, "Existing message"), { name: "Error", message: "Existing message" });
    assert.doesNotThrow(() => api.assertCan(true, "unused"));
    const currentUser = actor("contractor_manager", { companyId: "company" });
    assert.deepEqual(api.actorFrom({ currentUser } as Request), currentUser);
    assert.notEqual(api.actorFrom({ currentUser } as Request), currentUser);
  });
});
