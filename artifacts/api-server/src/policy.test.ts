import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Request } from "express";
import type { Actor, TaskEditLevel } from "./policy";
import { policyFixture } from "./testUtils/policyFixture";
import { userRoleEnum } from "@workspace/db";

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

describe("S1 unassigned HOA security", () => {
  for (const role of ["hoa_admin", "hoa_member"] as const) for (const assignment of [null, ""]) {
    const person = () => actor(role, { hoaCommunityId: assignment });
    const decisions: [string, (api: any, who: Actor) => unknown, unknown][] = [
      ["task list", (p, a) => p.canListTasks(a, "member-community", "list"), false],
      ["task page-data", (p, a) => p.canListTasks(a, "member-community", "page-data"), false],
      ["task without query", (p, a) => p.canListTasks(a), false],
      ["contact list", (p, a) => p.contactListPlan(a), "denied"],
      ["contact create", (p, a) => p.contactCreateAccess(a, "member-community"), "other_community"],
      ["contact change", (p, a) => p.contactChangeAccess(a, { communityId: "member-community" }), "denied"],
      ["user list", (p, a) => p.userListAccess(a), "other_community"],
      ["portal list", (p, a) => p.portalUserListAccess(a, "member-community"), "other_community"],
      ["portal create", (p, a) => p.portalCreateAccess(a, "hoa_member", "member-community"), "other_community"],
      ["portal role", (p, a) => p.portalRoleAssignAccess(a, "hoa_member"), "hoa_role_only"],
      ...(["portal", "status"] as const).map(context => [
        `portal target ${context}`, (p: any, a: Actor) => p.portalTargetAccess(a,
          { role: "hoa_member", hoaCommunityId: assignment }, context), "not_in_community",
      ] as [string, (api: any, who: Actor) => unknown, unknown]),
      ["community list", (p, a) => p.communityListPlan(a), { kind: "none" }],
      ["invoice list", (p, a) => p.invoiceListPlan(a, { communityId: "member-community" }), { kind: "denied" }],
      ["invoice read", (p, a) => p.invoiceReadAccess(a, { communityId: "member-community" }, {}), "denied"],
      ["report", (p, a) => p.reportCommunity(a, "member-community"), "not_member"],
      ["report without query", (p, a) => p.reportCommunity(a), "not_member"],
      ["search", (p, a) => p.searchScope(a, "member-community"), "not_member"],
      ["search without query", (p, a) => p.searchScope(a), "not_member"],
      ["retained membership", (p, a) => p.isCommunityMember(a, "member-community"), false],
      ["file attachment", (p, a) => p.canAttachFileToCommunity(a, "member-community"), false],
      ["asset access", (p, a) => p.canUseCommunityAssets(a, "member-community"), false],
      ["map/offline access", (p, a) => p.canUseCommunityMapData(a, "member-community"), false],
      ["dashboard access", (p, a) => p.dashboardAccess(a, "member-community"), false],
      ["asset write", (p, a) => p.assetWriteAccess(a, { id: "member-community" }), "not_member"],
      ["general community", (p, a) => p.canAccessCommunity(a, "member-community"), false],
      ["task read", (p, a) => p.canReadTask(a, { communityId: "member-community", assignedTo: a.id }), false],
      ["HOA portal", (p, a) => p.hoaPortalCommunity(a), null],
      ["role dashboard", (p, a) => p.roleDashboardCommunity(a, "member-community"), "hoa_unassigned"],
    ];
    for (const [name, decision, expected] of decisions) {
      it(`${role} assignment=${JSON.stringify(assignment)} denies ${name} without storage I/O`, async () => {
        const { api, calls } = await policyFixture();
        assert.deepEqual(await decision(api, person()), expected);
        assert.deepEqual(calls, []);
      });
    }
    it(`${role} assignment=${JSON.stringify(assignment)} cannot reuse an actor or request cached grant`, async () => {
      const { api, calls } = await policyFixture();
      const req = { currentUser: actor(role, { hoaCommunityId: "member-community" }) } as Request;
      const original = api.actorFrom(req);
      assert.equal(await api.isCommunityMember(original, "member-community"), true);
      original.hoaCommunityId = assignment;
      assert.equal(await api.isCommunityMember(original, "member-community"), false);
      req.currentUser!.hoaCommunityId = assignment;
      assert.equal(await api.isCommunityMember(api.actorFrom(req), "member-community"), false);
      assert.equal(calls.length, 1);
    });
  }
  for (const role of ["hoa_admin", "hoa_member", "property_manager", "contractor", "contractor_manager", "map_creator", "client_admin", "admin"] as const) {
    it(`shared membership preserves assigned/non-HOA ${role} behavior and cache`, async () => {
      const { api, calls } = await policyFixture();
      const person = actor(role, { hoaCommunityId: role.startsWith("hoa_") ? "assigned" : null });
      assert.equal(await api.isCommunityMember(person, "member-community"), true);
      assert.equal(await api.isCommunityMember(person, "member-community"), true);
      assert.equal(await api.isCommunityMember(person, "other-community"), false);
      assert.equal(calls.length, 2);
    });
  }
  for (const [name, role, author, member, expected] of [
    ["admin", "admin", "other", false, true],
    ["current author", "contractor", "actor", true, true],
    ["former author", "contractor", "actor", false, false],
    ["non-author member", "contractor", "other", true, false],
    ["unassigned HOA author with leftover row", "hoa_member", "actor", true, false],
  ] as const) {
    it(`note deletion: ${name}`, async () => {
      const { api } = await policyFixture({ isUserMemberOfCommunity: async () => member });
      assert.equal(await api.canDeleteAssetNote(actor(role), { createdBy: author }, "member-community"), expected);
    });
  }
  for (const current of [null, ""]) {
    it(`portfolio /me rejects stale session organization with current=${JSON.stringify(current)}`, async () => {
      const { api } = await policyFixture();
      assert.equal(api.clientPortfolioOrg({ currentUser: actor("client_admin", { organizationId: current }),
        session: { organizationId: "stale" } } as Request), current);
    });
  }
});

describe("service schedule permission compatibility", () => {
  const cases: {
    name: string; person: Actor; member?: boolean; community?: string; view: boolean; log: boolean;
  }[] = [
    { name: "admin without membership", person: actor("admin"), view: true, log: true },
    { name: "contractor member", person: actor("contractor"), member: true, view: true, log: true },
    { name: "contractor nonmember", person: actor("contractor"), view: false, log: false },
    { name: "account manager member", person: actor("contractor_manager", { companyId: "company" }), member: true, view: true, log: false },
    { name: "account manager nonmember", person: actor("contractor_manager", { companyId: "company" }), view: false, log: false },
    { name: "PM member", person: actor("property_manager"), member: true, view: true, log: false },
    { name: "PM nonmember", person: actor("property_manager"), view: false, log: false },
    { name: "map creator without membership", person: actor("map_creator"), view: true, log: false },
    { name: "HOA admin assigned without membership", person: actor("hoa_admin", { hoaCommunityId: "community" }), view: true, log: false },
    { name: "HOA member assigned without membership", person: actor("hoa_member", { hoaCommunityId: "community" }), view: true, log: false },
    { name: "HOA admin foreign despite membership", person: actor("hoa_admin", { hoaCommunityId: "elsewhere" }), member: true, view: false, log: false },
    { name: "HOA member foreign despite membership", person: actor("hoa_member", { hoaCommunityId: "elsewhere" }), member: true, view: false, log: false },
    { name: "HOA admin unassigned despite membership", person: actor("hoa_admin"), member: true, view: false, log: false },
    { name: "HOA member unassigned despite membership", person: actor("hoa_member"), member: true, view: false, log: false },
    { name: "client admin organization branch without membership", person: actor("client_admin"), view: true, log: false },
    { name: "client admin foreign organization despite membership", person: actor("client_admin", { organizationId: "foreign" }), member: true, view: false, log: false },
    { name: "client admin unassigned despite membership", person: actor("client_admin", { organizationId: null }), member: true, view: false, log: false },
    { name: "client admin noncommercial branch", person: actor("client_admin"), community: "noncommercial", view: false, log: false },
    { name: "client admin missing branch", person: actor("client_admin"), community: "missing", view: false, log: false },
  ];
  for (const row of cases) {
    for (const decision of ["view", "log"] as const) {
      it(`${row.name}: ${decision}`, async () => {
        const { api } = await policyFixture({
          isUserMemberOfCommunity: async (id: string, community: string) =>
            id === row.person.id && community === "community" && !!row.member,
          getCommunityById: async (id: string) => id === "missing" ? undefined :
            { id, organizationId: id === "community" ? "org" : null },
        });
        const check = decision === "view" ? api.canViewServiceSchedules : api.canLogServiceVisit;
        assert.equal(await check({ ...row.person }, row.community ?? "community"), row[decision]);
      });
    }
  }
  it("checks the logging role before any community I/O", async () => {
    const { api, calls } = await policyFixture({
      isUserMemberOfCommunity: async () => { throw Error("membership unavailable"); },
      getCommunityById: async () => { throw Error("community unavailable"); },
    });
    for (const role of ["contractor_manager", "property_manager", "map_creator", "hoa_admin", "hoa_member", "client_admin"] as const) {
      assert.equal(await api.canLogServiceVisit(actor(role), "community"), false);
    }
    assert.equal(await api.canLogServiceVisit(actor("admin"), "community"), true);
    assert.deepEqual(calls, []);
    await assert.rejects(api.canLogServiceVisit(actor("contractor"), "community"), /membership unavailable/);
    await assert.rejects(api.canViewServiceSchedules(actor("client_admin"), "community"), /community unavailable/);
  });
});

describe("user and company permission compatibility", () => {
  const roles = ["admin", "property_manager", "contractor", "contractor_manager",
    "map_creator", "hoa_admin", "hoa_member", "client_admin"] as const;
  const unrestricted = roles.map(() => "ok");
  const pmAssignments = ["pm_role_only", "pm_role_only", "pm_role_only", "pm_role_only",
    "pm_role_only", "ok", "ok", "pm_role_only"];
  const hoaAssignments = ["hoa_role_only", "hoa_role_only", "hoa_role_only", "hoa_role_only",
    "hoa_role_only", "hoa_role_only", "ok", "hoa_role_only"];
  // Community columns: member, outside, null, empty string.
  // Missing/empty list queries are tested separately from portal list policy.
  const table: {
    name: string; person: Actor; member?: boolean; status: boolean; portal: boolean;
    contractors: string[]; users: string[]; portalList: string[];
    targets: string[]; memberTargetsOnly?: boolean; assign: string[]; createScope: string[];
  }[] = [
    { name: "admin", person: actor("admin"), status: true, portal: false,
      contractors: ["ok_community", "ok_community", "ok_all", "ok_all"],
      users: ["all", "all", "all", "all"],
      portalList: Array(4).fill("not_authorized"), targets: Array(4).fill("ok"),
      assign: unrestricted, createScope: Array(4).fill("ok") },
    { name: "PM member", person: actor("property_manager"), member: true, status: true, portal: true,
      contractors: ["ok_community", "not_member", "community_required", "community_required"],
      users: ["community", "not_member", "community_required", "community_required"],
      portalList: ["ok", "not_member", "not_member", "not_member"],
      targets: ["ok", "not_in_community", "no_community", "no_community"],
      assign: pmAssignments, createScope: ["ok", "not_member", "not_member", "not_member"] },
    { name: "PM non-member", person: actor("property_manager"), status: true, portal: true,
      contractors: ["not_member", "not_member", "community_required", "community_required"],
      users: ["not_member", "not_member", "community_required", "community_required"],
      portalList: Array(4).fill("not_member"),
      targets: ["not_in_community", "not_in_community", "no_community", "no_community"],
      assign: pmAssignments, createScope: Array(4).fill("not_member") },
    { name: "HOA admin matching", person: actor("hoa_admin", { hoaCommunityId: "member-community" }),
      status: true, portal: true, contractors: Array(4).fill("denied"),
      users: ["community", "other_community", "community_required", "community_required"],
      portalList: ["ok", "other_community", "other_community", "other_community"],
      targets: ["ok", "not_in_community", "not_in_community", "not_in_community"], memberTargetsOnly: true,
      assign: hoaAssignments, createScope: ["ok", "other_community", "other_community", "other_community"] },
    { name: "HOA admin other community", person: actor("hoa_admin", { hoaCommunityId: "outside" }),
      status: true, portal: true, contractors: Array(4).fill("denied"),
      users: ["other_community", "community", "community_required", "community_required"],
      portalList: ["other_community", "ok", "other_community", "other_community"],
      targets: ["not_in_community", "ok", "not_in_community", "not_in_community"], memberTargetsOnly: true,
      assign: hoaAssignments, createScope: ["other_community", "ok", "other_community", "other_community"] },
    { name: "HOA admin unassigned null", person: actor("hoa_admin"),
      status: true, portal: true, contractors: Array(4).fill("denied"),
      users: Array(4).fill("other_community"),
      portalList: Array(4).fill("other_community"),
      targets: Array(4).fill("not_in_community"), memberTargetsOnly: true,
      assign: Array(8).fill("hoa_role_only"), createScope: Array(4).fill("other_community") },
    { name: "HOA admin unassigned empty", person: actor("hoa_admin", { hoaCommunityId: "" }),
      status: true, portal: true, contractors: Array(4).fill("denied"),
      users: Array(4).fill("other_community"),
      portalList: Array(4).fill("other_community"),
      targets: Array(4).fill("not_in_community"), memberTargetsOnly: true,
      assign: Array(8).fill("hoa_role_only"), createScope: Array(4).fill("other_community") },
    ...(["hoa_member", "contractor", "contractor_manager", "map_creator", "client_admin"] as const).map(role => ({
      name: role, person: actor(role, { hoaCommunityId: "member-community" }), member: true,
      status: false, portal: false, contractors: Array(4).fill("denied"),
      users: Array(4).fill("not_authorized"), portalList: Array(4).fill("not_authorized"),
      targets: Array(4).fill("ok"), assign: unrestricted, createScope: Array(4).fill("ok"),
    })),
  ];
  it("explicitly enumerates every assignable role", () => {
    assert.deepEqual([...roles].sort(), [...userRoleEnum.enumValues].sort());
  });
  for (const row of table) {
    const fixture = () => policyFixture({
      isUserMemberOfCommunity: async (_id: string, community: string) =>
        Boolean(row.member && community === "member-community"),
    });
    it(`${row.name}: separate status and portal gates`, async () => {
      const { api } = await fixture();
      assert.equal(api.canManageUserStatus(row.person), row.status);
      assert.equal(api.canManagePortalUsers(row.person), row.portal);
    });
    for (const [i, community] of ["member-community", "outside", null, ""].entries()) {
      it(`${row.name}: contractor, user and portal lists, community=${community}`, async () => {
        const { api } = await fixture();
        const query = community ?? undefined;
        assert.equal(await api.contractorListAccess({ ...row.person }, query), row.contractors[i]);
        assert.equal(await api.userListAccess({ ...row.person }, query), row.users[i]);
        // The route validates required community input before this policy.
        assert.equal(await api.portalUserListAccess({ ...row.person }, community as string), row.portalList[i]);
      });
      for (const targetRole of roles) {
        it(`${row.name}: target=${targetRole}, community=${community}`, async () => {
          const { api } = await fixture();
          const expected = row.targets[i] === "ok" && row.memberTargetsOnly && targetRole !== "hoa_member"
            ? "hoa_member_only" : row.targets[i];
          for (const context of ["portal", "status"] as const) {
            assert.equal(await api.portalTargetAccess({ ...row.person },
              { role: targetRole, hoaCommunityId: community }, context), expected);
          }
        });
      }
      for (const [r, role] of roles.entries()) {
        it(`${row.name}: create/assign=${role}, community=${community}`, async () => {
          const { api } = await fixture();
          assert.equal(api.portalRoleAssignAccess(row.person, role), row.assign[r]);
          assert.equal(await api.portalCreateAccess({ ...row.person }, role, community as string),
            row.name.startsWith("HOA admin unassigned") ? "other_community" :
              row.assign[r] === "ok" ? row.createScope[i] : row.assign[r]);
        });
      }
    }
    it(`${row.name}: invalid and missing assignment roles preserve gate ordering`, async () => {
      const { api } = await fixture();
      for (const role of [undefined, null, "", "invalid", [], {}]) {
        const expected = row.assign[0];
        assert.equal(api.portalRoleAssignAccess(row.person, role), expected);
        assert.equal(await api.portalCreateAccess({ ...row.person }, role, "outside"),
          row.name.startsWith("HOA admin unassigned") ? "other_community" : expected);
      }
    });
  }
  it("preserves membership short-circuits and the status-specific unassigned lookup", async () => {
    const { api, calls } = await policyFixture();
    const pm = () => actor("property_manager");
    const target = { role: "hoa_member", hoaCommunityId: null };
    assert.equal(await api.portalTargetAccess(pm(), target), "no_community");
    assert.deepEqual(calls, []);
    assert.equal(await api.portalTargetAccess(pm(), target, "status"), "no_community");
    assert.deepEqual(calls, [["actor", ""]]);
    calls.length = 0;
    assert.equal(await api.portalCreateAccess(pm(), "admin", "outside"), "pm_role_only");
    assert.equal(await api.contractorListAccess(actor("contractor"), "member-community"), "denied");
    assert.equal(await api.userListAccess(pm()), "community_required");
    assert.equal(await api.portalTargetAccess(actor("hoa_admin"), target), "not_in_community");
    assert.equal(await api.portalTargetAccess(actor("hoa_admin"), { ...target, role: "hoa_admin" }), "not_in_community");
    assert.deepEqual(calls, []);
  });
  it("preserves membership failures before status denial but after portal's no-community denial", async () => {
    const { api } = await policyFixture({
      isUserMemberOfCommunity: async () => { throw Error("membership unavailable"); },
    });
    const target = { role: "hoa_member", hoaCommunityId: null };
    assert.equal(await api.portalTargetAccess(actor("property_manager"), target), "no_community");
    await assert.rejects(api.portalTargetAccess(actor("property_manager"), target, "status"), /membership unavailable/);
  });
});

describe("community, dashboard and search permission compatibility", () => {
  const roles = [
    { role: "admin", list: "all", joins: false, usernames: true, companies: true, admin: true },
    { role: "property_manager", list: "memberships_non_commercial", joins: false, usernames: false, companies: true, admin: false },
    { role: "contractor", list: "memberships_non_commercial", joins: false, usernames: false, companies: false, admin: false },
    { role: "contractor_manager", list: "memberships_non_commercial", joins: false, usernames: false, companies: false, admin: false },
    { role: "map_creator", list: "all", joins: true, usernames: false, companies: false, admin: false },
    { role: "hoa_admin", list: "hoa", joins: false, usernames: false, companies: false, admin: false },
    { role: "hoa_member", list: "hoa", joins: false, usernames: false, companies: false, admin: false },
    { role: "client_admin", list: "memberships_non_commercial", joins: false, usernames: false, companies: false, admin: false },
  ] as const;
  for (const row of roles) {
    it(`list, creation and response-shaping decisions for ${row.role}`, async () => {
      const { api, calls } = await policyFixture();
      const person = actor(row.role, { hoaCommunityId: "assigned" });
      assert.deepEqual(api.communityListPlan(person),
        row.list === "hoa" ? { kind: "hoa", communityId: "assigned" } : { kind: row.list });
      assert.equal(api.joinsCreatedCommunity(person), row.joins);
      assert.equal(api.seesMemberUsernames(person), row.usernames);
      assert.equal(api.seesMemberCompanies(person), row.companies);
      assert.equal(api.isAdminView(person), row.admin);
      assert.deepEqual(calls, []);
    });
    for (const member of [true, false]) {
      it(`plain dashboard and controller membership for ${row.role}, member=${member}`, async () => {
        const { api } = await policyFixture();
        const communityId = member ? "member-community" : "other-community";
        const person = actor(row.role, { hoaCommunityId: communityId });
        assert.equal(await api.dashboardAccess(person, communityId), row.admin || member);
        assert.equal(await api.canUseCommunityAssets(person, communityId), row.admin || member);
      });
    }
    for (const [query, member] of [
      [undefined, false], ["", false], ["member-community", true], ["other-community", false],
    ] as const) {
      it(`role dashboard ${row.role} with query=${query}`, async () => {
        const { api, calls } = await policyFixture();
        const person = actor(row.role, { hoaCommunityId: "assigned" });
        const hoa = row.list === "hoa";
        const expected = hoa ? { communityId: "assigned" } : !query ? "community_required" :
          row.admin || member ? { communityId: query } : "not_member";
        assert.deepEqual(await api.roleDashboardCommunity(person, query), expected);
        assert.equal(calls.length, hoa || row.admin || !query ? 0 : 1);
      });
    }
    for (const [query, commercial, expected] of [
      [undefined, false, row.list === "hoa" ? "not_member" : row.admin ? { kind: "all" } : { kind: "memberships_non_commercial" }],
      ["", false, row.list === "hoa" ? "not_member" : row.admin ? { kind: "all" } : { kind: "memberships_non_commercial" }],
      ["member-community", false, { kind: "one", communityId: "member-community" }],
      ["member-community", true, row.admin ? { kind: "one", communityId: "member-community" } : "not_member"],
      ["other-community", false, row.admin ? { kind: "one", communityId: "other-community" } : "not_member"],
    ] as const) {
      it(`search ${row.role}, query=${query}, commercial=${commercial}`, async () => {
        const lookups: string[] = [];
        const { api, calls } = await policyFixture({
          getCommunityById: async (id: string) => {
            lookups.push(id);
            return { id, organizationId: commercial ? "org" : null };
          },
        });
        assert.deepEqual(await api.searchScope(actor(row.role, { hoaCommunityId: query ?? null }), query), expected);
        assert.equal(calls.length, !query || row.admin ? 0 : 1);
        assert.deepEqual(lookups, query === "member-community" && !row.admin ? [query] : []);
      });
    }
  }
  for (const role of ["hoa_admin", "hoa_member"] as const) {
    for (const assignment of [null, ""] as const) {
      it(`${role} without assignment lists nothing and cannot use the role dashboard`, async () => {
        const { api, calls } = await policyFixture();
        const person = actor(role, { hoaCommunityId: assignment });
        assert.deepEqual(api.communityListPlan(person), { kind: "none" });
        for (const query of [undefined, "member-community", "outside"]) {
          assert.equal(await api.roleDashboardCommunity(person, query), "hoa_unassigned");
        }
        assert.deepEqual(calls, []);
      });
    }
  }
  const crewCases: [string, Actor, string, unknown, unknown, number][] = [
    ["admin selected company", actor("admin"), "other-community", "selected", { companyId: "selected" }, 0],
    ["admin missing company despite own company", actor("admin", { companyId: "own" }), "other-community", undefined, "company_required", 0],
    ["admin empty company", actor("admin"), "member-community", "", "company_required", 0],
    ["admin array company", actor("admin"), "member-community", ["selected"], "company_required", 0],
    ["admin object company", actor("admin"), "member-community", { id: "selected" }, "company_required", 0],
    ["manager company member ignores query", actor("contractor_manager", { companyId: "own" }), "member-community", "foreign", { companyId: "own" }, 1],
    ["manager company member without query", actor("contractor_manager", { companyId: "own" }), "member-community", undefined, { companyId: "own" }, 1],
    ["manager company nonmember", actor("contractor_manager", { companyId: "own" }), "other-community", "own", "denied", 1],
    ["manager without company member", actor("contractor_manager"), "member-community", "selected", "denied", 0],
    ["manager without company nonmember", actor("contractor_manager"), "other-community", undefined, "denied", 0],
    ["manager empty company", actor("contractor_manager", { companyId: "" }), "member-community", "selected", "denied", 0],
    ...(["property_manager", "contractor", "map_creator", "hoa_admin", "hoa_member", "client_admin"] as const)
      .map(role => [role, actor(role, { companyId: "own" }), "member-community", "selected", "denied", 0] as
        [string, Actor, string, unknown, unknown, number]),
  ];
  for (const [name, person, community, query, expected, checks] of crewCases) {
    it(`crew access: ${name}`, async () => {
      const { api, calls } = await policyFixture();
      assert.deepEqual(await api.crewAccess(person, community, query), expected);
      assert.equal(calls.length, checks);
    });
  }
  it("preserves search membership-before-community lookup and missing-community behavior", async () => {
    const calls: string[] = [];
    const { api } = await policyFixture({
      isUserMemberOfCommunity: async (_id: string, community: string) => {
        calls.push(`membership:${community}`);
        return community === "member-community";
      },
      getCommunityById: async (community: string) => { calls.push(`community:${community}`); return undefined; },
    });
    assert.equal(await api.searchScope(actor("property_manager"), "outside"), "not_member");
    assert.deepEqual(calls, ["membership:outside"]);
    calls.length = 0;
    assert.deepEqual(await api.searchScope(actor("property_manager"), "member-community"),
      { kind: "one", communityId: "member-community" });
    assert.deepEqual(calls, ["membership:member-community", "community:member-community"]);
  });
});

describe("file, drive and contact permission compatibility", () => {
  const roles = ["admin", "property_manager", "contractor", "contractor_manager",
    "map_creator", "hoa_admin", "hoa_member", "client_admin"] as const;
  for (const role of roles) it(`retains file and drive role gates for ${role}`, async () => {
    const { api } = await policyFixture();
    const person = actor(role);
    assert.equal(api.needsManagerTaskObjectCheck(person), role === "contractor_manager");
    assert.equal(api.canReadDrive(person), ["admin", "property_manager", "hoa_admin", "hoa_member"].includes(role));
    assert.equal(api.canChangeDrive(person), ["admin", "property_manager", "hoa_admin"].includes(role));
    assert.equal(api.canWriteContacts(person), ["admin", "property_manager", "hoa_admin"].includes(role));
  });

  for (const [name, person, community, expected] of [
    ["admin", actor("admin"), "other-community", true],
    ["HOA admin matching without membership", actor("hoa_admin", { hoaCommunityId: "other-community" }), "other-community", true],
    ["HOA member matching without membership", actor("hoa_member", { hoaCommunityId: "other-community" }), "other-community", true],
    ["HOA admin mismatch", actor("hoa_admin", { hoaCommunityId: "elsewhere" }), "other-community", false],
    ["HOA member mismatch", actor("hoa_member", { hoaCommunityId: "elsewhere" }), "other-community", false],
    ["HOA mismatch but member", actor("hoa_admin", { hoaCommunityId: "elsewhere" }), "member-community", true],
    ["HOA unassigned member", actor("hoa_member"), "member-community", false],
    ["member", actor("contractor"), "member-community", true],
    ["nonmember", actor("contractor"), "other-community", false],
    ["organization alone", actor("client_admin"), "other-community", false],
  ] as const) it(`file attachment: ${name}`, async () => {
    const { api } = await policyFixture();
    assert.equal(await api.canAttachFileToCommunity(person, community), expected);
  });

  for (const [name, person, community, expected] of [
    ["assigned HOA without membership", actor("hoa_admin", { hoaCommunityId: "other-community" }), "other-community", true],
    ["assigned HOA member without membership", actor("hoa_member", { hoaCommunityId: "other-community" }), "other-community", true],
    ["HOA mismatch despite membership", actor("hoa_admin", { hoaCommunityId: "elsewhere" }), "member-community", false],
    ["commercial organization branch", actor("client_admin"), "other-community", true],
    ["foreign organization", actor("client_admin", { organizationId: "foreign" }), "other-community", false],
    ["PM nonmember", actor("property_manager"), "other-community", false],
    ["PM member", actor("property_manager"), "member-community", true],
  ] as const) it(`general drive community access: ${name}`, async () => {
    const { api } = await policyFixture();
    assert.equal(await api.canUseCommunityDrive(person, community), expected);
  });

  const member = "member-community", outside = "other-community";
  const ownCommunity = { kind: "community", communityId: member };
  const contactCases: {
    name: string; person: Actor; list: [unknown, unknown, unknown];
    create: [string, string]; change: [string, string]; move: [string, string];
  }[] = [
    { name: "admin", person: actor("admin"),
      list: [{ kind: "all", communityId: undefined }, { kind: "all", communityId: member }, { kind: "all", communityId: outside }],
      create: ["ok", "ok"], change: ["ok", "ok"], move: ["ok", "ok"] },
    { name: "PM member and nonmember", person: actor("property_manager"),
      list: [{ kind: "my_communities" }, { kind: "community", communityId: member }, "not_member"],
      create: ["ok", "not_member"], change: ["ok", "not_member"], move: ["ok", "not_member_target"] },
    { name: "HOA admin matching and other", person: actor("hoa_admin", { hoaCommunityId: member }),
      list: [ownCommunity, ownCommunity, ownCommunity],
      create: ["ok", "other_community"], change: ["ok", "denied"], move: ["hoa_cannot_move", "hoa_cannot_move"] },
    { name: "HOA admin without assignment", person: actor("hoa_admin"),
      list: ["denied", "denied", "denied"],
      create: ["other_community", "other_community"], change: ["denied", "denied"], move: ["hoa_cannot_move", "hoa_cannot_move"] },
    { name: "HOA member matching and other (write gate denies)", person: actor("hoa_member", { hoaCommunityId: member }),
      list: [ownCommunity, ownCommunity, ownCommunity],
      create: ["ok", "other_community"], change: ["ok", "ok"], move: ["ok", "ok"] },
    { name: "HOA member without assignment (write gate denies)", person: actor("hoa_member"),
      list: ["denied", "denied", "denied"],
      create: ["other_community", "other_community"], change: ["denied", "denied"], move: ["ok", "ok"] },
    ...(["contractor", "contractor_manager", "client_admin", "map_creator"] as const).map(role => ({
      name: `${role} (write gate denies)`, person: actor(role),
      list: ["denied", "denied", "denied"] as [unknown, unknown, unknown],
      create: ["ok", "ok"] as [string, string], change: ["ok", "ok"] as [string, string], move: ["ok", "ok"] as [string, string],
    })),
  ];
  for (const row of contactCases) {
    for (const [i, community] of [undefined, member, outside].entries()) {
      it(`contact list ${row.name}, community=${community}`, async () => {
        const { api } = await policyFixture();
        assert.deepEqual(await api.contactListPlan(row.person, community), row.list[i]);
      });
    }
    for (const [i, community] of [member, outside].entries()) {
      it(`contact create/change/move ${row.name}, community=${community}`, async () => {
        const { api } = await policyFixture();
        assert.equal(await api.contactCreateAccess(row.person, community), row.create[i]);
        assert.equal(await api.contactChangeAccess(row.person, { communityId: community }), row.change[i]);
        assert.equal(await api.contactMoveAccess(row.person, community), row.move[i]);
      });
    }
  }
  it("retains empty contact filters and short-circuits membership checks", async () => {
    const { api, calls } = await policyFixture();
    assert.deepEqual(await api.contactListPlan(actor("admin"), ""), { kind: "all", communityId: undefined });
    assert.deepEqual(await api.contactListPlan(actor("property_manager"), ""), { kind: "my_communities" });
    assert.equal(await api.canAttachFileToCommunity(actor("admin"), outside), true);
    assert.equal(await api.canAttachFileToCommunity(actor("hoa_admin", { hoaCommunityId: outside }), outside), true);
    assert.equal(await api.contactMoveAccess(actor("hoa_admin"), outside), "hoa_cannot_move");
    assert.deepEqual(calls, []);
  });
});

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

  it("denies both task surfaces for HOA accounts with no assignment", async () => {
    const { api } = await policyFixture();
    for (const role of ["hoa_admin", "hoa_member"] as const) {
      const person = actor(role);
      assert.equal(await api.canListTasks(person, "other-community"), false);
      assert.equal(await api.canListTasks(person, "other-community", "page-data"), false);
      assert.equal(await api.canListTasks(person), false);
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
    assert.equal(await api.canDeleteAssetNote(actor(role), { createdBy: author }, "member-community"), expected);
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

  it("uses only live assignment for request submission", async () => {
    const { api } = await policyFixture();
    const cases: [string | null, string | undefined, string | null][] = [
      ["current", "session", "current"], [null, "session", null], [null, undefined, null],
      ["", "session", ""], [null, "", null],
    ];
    for (const [current, session, expected] of cases) {
      assert.equal((api.hoaRequestCommunity as any)(actor("hoa_admin", { hoaCommunityId: current }), session), expected);
    }
  });
});

describe("portfolio permission compatibility", () => {
  it("preserves explicit admin selection and rejects stale client session scope", async () => {
    const { api } = await policyFixture();
    const cases: [Actor["role"], string | null, string | undefined, string | undefined, object][] = [
      ["admin", "ignored", "session", "selected", { orgId: "selected" }],
      ["admin", "ignored", "session", undefined, { orgId: null, status: 400, error: "organizationId query param is required for admin" }],
      ["client_admin", "current", "session", "ignored", { orgId: "current" }],
      ["client_admin", null, "session", "ignored", { orgId: null, status: 403, error: "No organization assigned to this account" }],
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
    ["stale session cannot restore scope", null, "session", null],
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

describe("billing permission compatibility", () => {
  const member = "member-community", outside = "other-community";
  const manager = actor("contractor_manager", { companyId: "company" });
  const client = actor("client_admin");
  const hoa = actor("hoa_admin", { hoaCommunityId: member });
  const invoice = { communityId: member, contractorCompanyId: "company", status: "draft" };
  const listCases: [string, Actor, string | undefined, string | undefined, object][] = [
    ["crew", actor("contractor"), member, undefined, { kind: "denied" }],
    ["manager all memberships", manager, undefined, undefined, { kind: "manager", communityId: undefined }],
    ["manager member", manager, member, undefined, { kind: "manager", communityId: member }],
    ["manager nonmember", manager, outside, undefined, { kind: "not_member" }],
    ["manager without company still delegates all", actor("contractor_manager"), undefined, undefined, { kind: "manager", communityId: undefined }],
    ["manager without company member", actor("contractor_manager"), member, undefined, { kind: "manager", communityId: member }],
    ["admin all", actor("admin"), undefined, undefined, { kind: "all", communityId: undefined }],
    ["admin selected", actor("admin"), outside, undefined, { kind: "all", communityId: outside }],
    ["admin empty query", actor("admin"), "", undefined, { kind: "all", communityId: undefined }],
    ["HOA assignment ignores query", hoa, outside, undefined, { kind: "community", communityId: member }],
    ["HOA assignment without query", hoa, undefined, undefined, { kind: "community", communityId: member }],
    ["HOA without assignment or query", actor("hoa_admin"), undefined, undefined, { kind: "denied" }],
    ["HOA without assignment member", actor("hoa_admin"), member, undefined, { kind: "denied" }],
    ["HOA without assignment nonmember", actor("hoa_admin"), outside, undefined, { kind: "denied" }],
    ["HOA member assignment", actor("hoa_member", { hoaCommunityId: outside }), member, undefined, { kind: "community", communityId: outside }],
    ["client user org wins", client, undefined, "other", { kind: "organization", orgId: "org" }],
    ["client user org branch", client, member, undefined, { kind: "community", communityId: member }],
    ["client session org", actor("client_admin", { organizationId: null }), undefined, "org", { kind: "no_organization" }],
    ["client session org branch", actor("client_admin", { organizationId: null }), member, "org", { kind: "no_organization" }],
    ["client empty user org falls back", actor("client_admin", { organizationId: "" }), undefined, "org", { kind: "no_organization" }],
    ["client no org", actor("client_admin", { organizationId: null }), undefined, undefined, { kind: "no_organization" }],
    ["client no org with branch", actor("client_admin", { organizationId: null }), member, undefined, { kind: "no_organization" }],
    ["client branch relies on middleware", client, outside, undefined, { kind: "community", communityId: outside }],
    ["PM without community", actor("property_manager"), undefined, undefined, { kind: "community_required" }],
    ["PM member", actor("property_manager"), member, undefined, { kind: "community", communityId: member }],
    ["PM nonmember", actor("property_manager"), outside, undefined, { kind: "not_member" }],
    ["map creator member", actor("map_creator"), member, undefined, { kind: "community", communityId: member }],
  ];
  for (const [name, person, communityId, sessionOrganizationId, expected] of listCases) {
    it(`invoice list: ${name}`, async () => {
      const { api } = await policyFixture();
      assert.deepEqual(await api.invoiceListPlan(person, { communityId, sessionOrganizationId } as any), expected);
    });
  }

  const readCases: [string, Actor, string, string | null, string | undefined, string][] = [
    ["crew member", actor("contractor"), member, "company", undefined, "denied"],
    ["crew outside", actor("contractor"), outside, "company", undefined, "denied"],
    ["manager own company member", manager, member, "company", undefined, "ok"],
    ["manager own company nonmember", manager, outside, "company", undefined, "denied"],
    ["manager foreign company member", manager, member, "foreign", undefined, "denied"],
    ["manager no company", actor("contractor_manager"), member, null, undefined, "denied"],
    ["admin member", actor("admin"), member, null, undefined, "ok"],
    ["admin outside", actor("admin"), outside, null, undefined, "ok"],
    ["HOA own", hoa, member, null, undefined, "ok"],
    ["HOA outside despite membership", actor("hoa_admin", { hoaCommunityId: outside }), member, null, undefined, "denied"],
    ["HOA unassigned member", actor("hoa_admin"), member, null, undefined, "denied"],
    ["HOA unassigned nonmember", actor("hoa_admin"), outside, null, undefined, "denied"],
    ["HOA member own", actor("hoa_member", { hoaCommunityId: member }), member, null, undefined, "ok"],
    ["HOA member outside", actor("hoa_member", { hoaCommunityId: outside }), member, null, undefined, "denied"],
    ["client user org", client, member, null, "foreign", "ok"],
    ["client foreign org", actor("client_admin", { organizationId: "foreign" }), member, null, "org", "denied"],
    ["client session org", actor("client_admin", { organizationId: null }), member, null, "org", "no_organization"],
    ["client foreign session org", actor("client_admin", { organizationId: null }), member, null, "foreign", "no_organization"],
    ["client empty org falls back", actor("client_admin", { organizationId: "" }), member, null, "org", "no_organization"],
    ["client no org", actor("client_admin", { organizationId: null }), member, null, undefined, "no_organization"],
    ["PM member", actor("property_manager"), member, null, undefined, "ok"],
    ["PM nonmember", actor("property_manager"), outside, null, undefined, "denied"],
    ["map creator member", actor("map_creator"), member, null, undefined, "ok"],
    ["map creator nonmember", actor("map_creator"), outside, null, undefined, "denied"],
  ];
  for (const [name, person, communityId, contractorCompanyId, sessionOrganizationId, expected] of readCases) {
    it(`invoice read: ${name}`, async () => {
      const { api } = await policyFixture();
      assert.equal(await (api.invoiceReadAccess as any)(person, { communityId, contractorCompanyId }, { sessionOrganizationId }), expected);
    });
  }
  for (const community of [undefined, { organizationId: null }, { organizationId: "foreign" }]) {
    it(`denies client invoice when community is ${JSON.stringify(community)}`, async () => {
      const { api } = await policyFixture({ getCommunityById: async () => community });
      assert.equal(await api.invoiceReadAccess(client, invoice), "denied");
    });
  }

  for (const role of ["contractor_manager", "admin"] as const) {
    for (const mode of ["create", "update"] as const) {
      for (const status of [undefined, "draft", "submitted", "approved", "paid", "void", null, "invalid", "", 0]) {
        it(`${role} invoice ${mode} status ${String(status)}`, async () => {
          const { api } = await policyFixture();
          const expected = role === "admin" ? "ok" : status === "approved" ? "staff_only"
            : status === undefined || status === "draft" || status === "submitted" ||
              (mode === "update" && (status === "paid" || status === "void")) ? "ok" : "invalid";
          assert.equal(api.invoiceStatusRule(actor(role), status, mode), expected);
        });
      }
    }
  }

  for (const [name, person, communityId, company, status, expected] of [
    ["admin any invoice", actor("admin"), outside, "foreign", "approved", true],
    ["manager own draft", manager, member, "company", "draft", true],
    ["manager own submitted", manager, member, "company", "submitted", false],
    ["manager foreign draft", manager, member, "foreign", "draft", false],
    ["manager nonmember draft", manager, outside, "company", "draft", false],
    ["manager companyless draft", actor("contractor_manager"), member, null, "draft", false],
  ] as const) it(`invoice delete: ${name}`, async () => {
    const { api } = await policyFixture();
    assert.equal(await api.canDeleteInvoice(person, { communityId, contractorCompanyId: company, status }), expected);
  });

  for (const role of ["admin", "property_manager", "contractor", "contractor_manager",
    "hoa_admin", "hoa_member", "client_admin", "map_creator"] as const) {
    it(`billing role gates for ${role}`, async () => {
      const { api } = await policyFixture();
      const person = actor(role);
      assert.equal(api.canRequestInvoice(person), role !== "contractor");
      assert.equal(api.canManageInvoices(person), role === "admin" || role === "contractor_manager");
      assert.equal(api.hasFixedInvoiceCompany(person), role === "contractor_manager");
      assert.equal(api.canReadReports(person), ["admin", "property_manager", "hoa_admin", "hoa_member"].includes(role));
      assert.equal(api.canReadContracts(person), role === "admin" || role === "property_manager");
      assert.equal(api.canHoldContract(person), role === "contractor");
    });
  }

  for (const [name, person, communityId, expected] of [
    ["company and membership", manager, member, true],
    ["company without membership", manager, outside, false],
    ["membership without company", actor("contractor_manager"), member, false],
  ] as const) it(`manager create/write: ${name}`, async () => {
    const { api } = await policyFixture();
    assert.equal(await api.managerCanCreateInvoice(person, communityId), expected);
    assert.equal(await api.managerCanWriteInvoice(person, { communityId, contractorCompanyId: "company" }), expected);
  });
  it("checks company before membership and status after membership", async () => {
    const { api, calls } = await policyFixture();
    assert.equal(await api.managerCanWriteInvoice(manager, { ...invoice, contractorCompanyId: "foreign" }), false);
    assert.equal(await api.managerCanCreateInvoice(actor("contractor_manager"), member), false);
    assert.deepEqual(calls, []);
    assert.equal(await api.canDeleteInvoice(manager, { ...invoice, status: "submitted" }), false);
    assert.deepEqual(calls, [["actor", member]]);
  });

  for (const [name, person, query, expected] of [
    ["admin missing query", actor("admin"), undefined, "community_required"],
    ["admin empty query", actor("admin"), "", "community_required"],
    ["admin selected", actor("admin"), outside, { communityId: outside }],
    ["HOA assigned ignores query", hoa, outside, { communityId: member }],
    ["HOA assigned no query", hoa, undefined, { communityId: member }],
    ["HOA member assigned", actor("hoa_member", { hoaCommunityId: member }), outside, { communityId: member }],
    ["HOA unassigned missing query", actor("hoa_admin"), undefined, "not_member"],
    ["HOA unassigned member", actor("hoa_admin"), member, "not_member"],
    ["HOA unassigned nonmember", actor("hoa_member"), outside, "not_member"],
    ["PM missing query", actor("property_manager"), undefined, "community_required"],
    ["PM member", actor("property_manager"), member, { communityId: member }],
    ["PM nonmember", actor("property_manager"), outside, "not_member"],
  ] as const) it(`report community: ${name}`, async () => {
    const { api } = await policyFixture();
    assert.deepEqual(await api.reportCommunity(person, query), expected);
  });

  for (const [role, communityId, expected] of [
    ["admin", undefined, "ok"], ["admin", outside, "ok"],
    ["property_manager", undefined, "community_required"], ["property_manager", "", "community_required"],
    ["property_manager", member, "ok"], ["property_manager", outside, "not_member"],
  ] as const) it(`contract community: ${role} ${String(communityId)}`, async () => {
    const { api } = await policyFixture();
    assert.equal(await api.contractCommunityAccess(actor(role), communityId), expected);
  });
});
