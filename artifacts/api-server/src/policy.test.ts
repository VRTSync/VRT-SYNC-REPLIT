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

describe("asset permission compatibility", () => {
  const roles = ["admin", "property_manager", "contractor", "contractor_manager",
    "map_creator", "hoa_admin", "client_admin"] as const;
  for (const role of roles) for (const member of [true, false]) {
    it(`${role} ${member ? "member" : "non-member"} uses the plain asset membership rule`, async () => {
      const { api } = await policyFixture();
      const community = member ? "member-community" : "other-community";
      const person = actor(role, { hoaCommunityId: community });
      assert.equal(await api.canUseCommunityAssets(person, community), role === "admin" || member);
    });
  }

  for (const [role, author, expected] of [
    ["admin", "other", true], ["contractor", "actor", true], ["contractor", "other", false],
  ] as const) it(`checks note deletion for ${role} with author ${author}`, async () => {
    const { api } = await policyFixture();
    assert.equal(api.canDeleteAssetNote(actor(role), { createdBy: author }), expected);
  });

  it("scopes history only for account managers and selects only the map-creator pin path", async () => {
    const { api } = await policyFixture();
    assert.equal(api.assetHistoryCompanyScope(actor("contractor_manager")), "actor");
    assert.equal(api.assetHistoryCompanyScope(actor("admin")), undefined);
    for (const role of roles) {
      assert.equal(api.usesMapCreatorPinPath(actor(role)), role === "map_creator");
      assert.equal(api.canCreateAdminAsset(actor(role)), role === "admin");
    }
  });

  for (const [role, member, locked, expected] of [
    ["admin", false, true, "ok"], ["map_creator", true, false, "ok"],
    ["map_creator", true, true, "locked"], ["map_creator", false, true, "not_member"],
    ["property_manager", true, true, "ok"], ["contractor", false, false, "not_member"],
  ] as const) it(`checks ${role} writes with membership=${member} and lock=${locked}`, async () => {
    const { api } = await policyFixture();
    assert.equal(await api.assetWriteAccess(actor(role), {
      id: member ? "member-community" : "other-community", isMapCreatorLocked: locked,
    }), expected);
  });

  for (const [role, member, locked, expected] of [
    ["admin", false, true, "ok"], ["admin", false, false, "ok"],
    ["map_creator", true, true, "ok"], ["map_creator", false, true, "not_member"],
    ["map_creator", true, false, "unlock_admin_only"], ["map_creator", false, false, "unlock_admin_only"],
  ] as const) it(`checks ${role} lock changes with membership=${member} and locked=${locked}`, async () => {
    const { api, calls } = await policyFixture();
    assert.equal(await api.mapCreatorLockAccess(actor(role), member ? "member-community" : "other-community", locked), expected);
    assert.equal(calls.length, role === "map_creator" && locked ? 1 : 0);
  });
});

describe("HOA permission compatibility", () => {
  const cases: {
    name: string; role: Actor["role"]; hoa?: string | null;
    member?: boolean; assigned?: boolean; company?: string;
    expected: [string | null, boolean, boolean];
  }[] = [
    { name: "HOA admin with community", role: "hoa_admin", hoa: "member-community", member: true, expected: ["member-community", true, true] },
    { name: "HOA admin without community", role: "hoa_admin", member: true, expected: [null, false, true] },
    { name: "HOA member in community", role: "hoa_member", hoa: "member-community", member: true, expected: ["member-community", true, false] },
    { name: "HOA member outside community", role: "hoa_member", hoa: "elsewhere", member: true, expected: ["elsewhere", false, false] },
    { name: "admin", role: "admin", expected: [null, true, false] },
    { name: "PM member", role: "property_manager", member: true, expected: [null, true, false] },
    { name: "PM non-member", role: "property_manager", expected: [null, false, false] },
    { name: "contractor assigned", role: "contractor", member: true, assigned: true, expected: [null, true, false] },
    { name: "contractor unassigned", role: "contractor", member: true, expected: [null, false, false] },
    { name: "manager same company", role: "contractor_manager", member: true, company: "company", expected: [null, true, false] },
    { name: "manager other company", role: "contractor_manager", member: true, company: "other", expected: [null, false, false] },
    { name: "client admin member", role: "client_admin", member: true, expected: [null, true, false] },
    { name: "client admin organization only", role: "client_admin", expected: [null, false, false] },
  ];
  for (const row of cases) it(row.name, async () => {
    const { api } = await policyFixture();
    const person = actor(row.role, { hoaCommunityId: row.hoa ?? null, companyId: row.company ?? null });
    const task = {
      communityId: row.member ? "member-community" : "other-community",
      assignedTo: row.assigned ? person.id : "someone-else",
      contractorCompanyId: "company",
    };
    assert.deepEqual([
      api.hoaPortalCommunity(person),
      await api.canReadHoaRequest(person, task),
      api.canCreateHoaRequest(person),
    ], row.expected);
  });

  it("preserves user-first logical-OR session fallback for request submission", async () => {
    const { api } = await policyFixture();
    const cases: [string | null, string | undefined, string | null][] = [
      ["current", "session", "current"], [null, "session", "session"], [null, undefined, null],
      ["", "session", "session"], [null, "", null],
    ];
    for (const [current, session, expected] of cases) {
      assert.equal(api.hoaRequestCommunity(actor("hoa_admin", { hoaCommunityId: current }), session), expected);
    }
  });
});

describe("portfolio permission compatibility", () => {
  it("preserves explicit admin selection and nullish client session fallback", async () => {
    const { api } = await policyFixture();
    const cases: [Actor["role"], string | null, string | undefined, string | undefined, object][] = [
      ["admin", "ignored", "session", "selected", { orgId: "selected" }],
      ["admin", "ignored", "session", undefined, { orgId: null, status: 400, error: "organizationId query param is required for admin" }],
      ["client_admin", "current", "session", "ignored", { orgId: "current" }],
      ["client_admin", null, "session", "ignored", { orgId: "session" }],
      ["client_admin", null, undefined, undefined, { orgId: null, status: 403, error: "No organization assigned to this account" }],
      ["client_admin", "", "session", undefined, { orgId: null, status: 403, error: "No organization assigned to this account" }],
    ];
    for (const [role, current, session, query, expected] of cases) {
      assert.deepEqual(api.resolvePortfolioOrg({
        currentUser: actor(role, { organizationId: current }),
        session: { organizationId: session }, query: { organizationId: query },
      } as unknown as Request), expected);
    }
  });

  it("requires an existing community with an exactly matching organization", async () => {
    const { api } = await policyFixture();
    for (const [community, expected] of [
      [{ organizationId: "org" }, true], [{ organizationId: "other" }, false],
      [{ organizationId: null }, false], [undefined, false], [null, false],
    ] as const) {
      assert.equal(api.orgOwnsCommunity("org", community), expected);
    }
  });
});

describe("commercial portfolio ownership policies", () => {
  for (const [name, current, session, expected] of [
    ["current user organization", "current", "session", "current"],
    ["session fallback", null, "session", "session"],
    ["no organization", null, undefined, null],
    ["empty user organization does not fall back", "", "session", ""],
  ] as const) {
    it(`resolves /me with ${name}`, async () => {
      const { api } = await policyFixture();
      assert.equal(api.clientPortfolioOrg({
        currentUser: actor("client_admin", { organizationId: current }),
        session: { organizationId: session },
      } as unknown as Request), expected);
    });
  }

  for (const kind of ["group", "group set"] as const) {
    for (const [name, id, expected] of [
      ["own record", "own", true],
      ["another organization's record", "foreign", false],
      ["unknown record", "unknown", false],
    ] as const) {
      it(`checks ${kind} ownership for ${name}`, async () => {
        const lookups: string[] = [];
        const lookup = async (orgId: string) => {
          lookups.push(orgId);
          return orgId === "org" ? [{ id: "own" }] : [{ id: "foreign" }];
        };
        const { api } = await policyFixture({
          listBranchGroups: lookup,
          getGroupSets: lookup,
        });
        const owns = kind === "group" ? api.orgOwnsGroup : api.orgOwnsGroupSet;
        assert.equal(await owns("org", id), expected);
        assert.deepEqual(lookups, ["org"]);
      });
    }
  }

  for (const [name, ids, expected, expectedLookups] of [
    ["empty list", [], true, []],
    ["all own locations", ["own-1", "own-2"], true, ["org"]],
    ["a location from another organization", ["own-1", "foreign"], false, ["org"]],
    ["an unknown location", ["own-1", "unknown"], false, ["org"]],
    ["repeated own location", ["own-1", "own-1"], true, ["org"]],
  ] as [string, string[], boolean, string[]][]) {
    it(`checks location ownership for ${name}`, async () => {
      const lookups: string[] = [];
      const { api } = await policyFixture({
        getCommunityIdsForOrganization: async (orgId: string) => {
          lookups.push(orgId);
          return orgId === "org" ? ["own-1", "own-2"] : ["foreign"];
        },
      });
      assert.equal(await api.orgOwnsCommunities("org", ids), expected);
      assert.deepEqual(lookups, expectedLookups);
    });
  }
});

describe("map and offline permission compatibility", () => {
  const roles = ["admin", "property_manager", "contractor", "contractor_manager",
    "map_creator", "hoa_admin", "hoa_member", "client_admin"] as const;
  for (const role of roles) for (const member of [true, false]) {
    it(`${role} ${member ? "member" : "non-member"} map data matches asset access`, async () => {
      const { api } = await policyFixture();
      const communityId = member ? "member-community" : "other-community";
      const person = actor(role, { hoaCommunityId: communityId });
      assert.equal(await api.canUseCommunityMapData(person, communityId), role === "admin" || member);
      assert.equal(await api.canUseCommunityMapData(person, communityId),
        await api.canUseCommunityAssets(person, communityId));
    });
  }
  for (const role of roles) {
    it(`limits inactive types and full search visibility for ${role}`, async () => {
      const { api } = await policyFixture();
      assert.equal(api.canSeeInactiveAssetTypes(actor(role)), role === "admin");
      assert.equal(api.seesFullSearchIndex(actor(role)), role === "admin");
    });
  }
  it("retains broader HOA summary access without granting layer payloads or offline packs", async () => {
    const { api } = await policyFixture();
    const person = actor("hoa_admin", { hoaCommunityId: "other-community" });
    assert.equal(await api.canAccessCommunity(person, "other-community"), true);
    assert.equal(await api.canUseCommunityMapData(person, "other-community"), false);
  });
});
