# Unassigned HOA security completion report

## Scope

API-only security changes, including the approved retained-membership extension.
No schema, migration, production-data, web-portal or mobile changes. The only
authentication-file change is the requested explanatory comment; synchronization
of session fields is unchanged. Removal still unlinks the community, clears the
assignment and revokes sessions without deleting or deactivating the account.
Removal's existing push-token behavior is unchanged.

- `isUnassignedHoa` covers both HOA roles and null/empty assignments. It is
  centrally exported by the existing `export * from "./actor"` barrel.
- The shared membership denial runs before cache or storage access, including
  when a previously assigned actor or another actor from the same request has a
  cached grant. No membership data is deleted.
- Task lists, contacts, portal-user decisions, invoices, reports and search use
  their specified first-check denials. Community listing returns HTTP 200 `[]`.
- HOA-admin portal and status target checks deny unassigned targets. Assigned-HOA
  and other-role behavior, PM ordering, self-status protection, validation,
  session revocation and push handling retain their existing rules.
- Note deletion is awaited and requires admin, or authorship plus the existing
  current asset-community membership rule. The route keeps note-not-found and
  wrong-asset 404s first, and user-not-found before the new asset lookup. A missing
  asset returns 404 `"Asset not found"`; an unauthorized author gets the existing
  403 `"Access denied"`.
- HOA-request, portfolio and invoice policies no longer consume session scope.
  Routes no longer pass it, log it diagnostically, or describe the dead fallback.
  Portfolio work orders already use the shared resolver, so need no route edit.
- The new source guard scans **all** route and policy TypeScript files, including
  the four infrastructure files excluded by the older role guard. Auth is outside
  those directories. The older role guard and its exact allowlist are unchanged.

## Verification

| Check | Baseline | Final |
| --- | --- | --- |
| `pnpm run typecheck:libs` | pass | pass |
| `pnpm --filter @workspace/api-server typecheck` | pass | pass |
| `pnpm --filter @workspace/api-server test` | 1,676 passed, 49 suites | 1,834 passed, 51 suites |
| Failed / skipped / cancelled tests | 0 / 0 / 0 | 0 / 0 / 0 |

158 tests were added. The full suite includes the existing community-access and
account-manager suites; those files and their expectations are unchanged.
`git diff --check` passes.

The API workflow was restarted after implementation. Build succeeded, startup
reported zero applied migrations and the server listening on port 8080.
An unauthenticated proxied `/api/ping` request returned the existing HTTP 401
`{"message":"Not authenticated"}`, confirming protected routing is responsive.
The public proxied `/api/healthz` returned HTTP 200 `{"status":"ok"}`; the
preview capture also confirmed that response.

### Negative-test evidence

Before production-policy edits, the focused policy/live-permission/source-guard
run with new tests and the original expectations produced **1,502 tests: 1,393
passed, 109 failed**. Failures included:

- Both HOA roles, null and empty assignments: task-list/page-data/no-query access,
  contact creation/change, user-list decisions, portal-role/target checks, empty
  community-list plans, invoice reads/lists, reports, scoped/unscoped search.
- Retained membership grants for attachments, assets, map/offline data,
  dashboards and asset writes; actor- and request-cached grants.
- Former non-HOA note-author permission, unassigned HOA note authors with retained
  membership, and the portfolio `/me` stale-session resolver.
- Real isolated HTTP handlers: removal then the same active account signing in
  again and reading task page-data; unassigned-admin edit, status and removal;
  offline downloads with leftover membership; note deletion; contact creation.
- Source guard detection of the existing route/policy session reads.

After the authorized expectation updates but still before production fixes,
the same focused run produced **1,502 tests: 1,276 passed, 226 failed**. This
additionally demonstrated the HOA-request, portfolio and invoice fallback
regressions. This count includes old-signature adaptation failures and is not
claimed to represent 226 independent security gaps.

The temporary file `src/policy/s1-session-guard-probe.ts` contained
`req.session.organizationId` without importing or executing it. Running
`node --import tsx/esm --test src/routeGuards.test.ts` failed exactly the live-scope
scan: **23 tests, 22 passed, 1 failed**, naming the probe file and forbidden read.
The file was deleted; the final full suite passed with the probe absent.
Optional chaining and quoted bracket reads also have detector tests.

All HTTP security tests used isolated in-memory users, sessions and storage with
real production handlers, policies, login and revocation SQL logic. No production
accounts or assignments were created or changed. No browser run or live
authenticated production check is claimed.

## Every changed existing expectation

The following is the complete inventory of changed expected values. Parameterized
rows describe **every expansion** of the specified inputs, not just an example.
New tests are not changes to existing assertions. Call-signature/await adaptations
with unchanged expected results are listed separately below.

### `src/policy.test.ts`

| Existing assertion / exact affected inputs | Old expected value | New expected value | Security reason |
| --- | --- | --- | --- |
| User matrix: unassigned-null and unassigned-empty HOA admins; `userListAccess` query null/empty | `community_required` | `other_community` | Required unassigned-first denial precedes query handling. |
| Same two rows: `portalUserListAccess` community equal to the actor's null/empty assignment | `ok` | `other_community` | Null/empty equality cannot grant scope. |
| Same two rows: `portalTargetAccess`, matching null/empty target assignment, both portal/status contexts, target role `hoa_member` | `ok` | `not_in_community` | An unassigned admin cannot manage an unassigned member. |
| Same target rows/contexts, each of the other seven target roles | `hoa_member_only` | `not_in_community` | Scope denial must precede target-role validation. |
| Same two actor rows: `portalRoleAssignAccess`, role `hoa_member`, each of the four community-loop iterations | `ok` | `hoa_role_only` | Unassigned actors cannot assign portal roles. |
| Same two actor rows: `portalCreateAccess`, target role `hoa_member`, matching null/empty community | `ok` | `other_community` | Unassigned actors cannot create portal users. |
| Same two actor rows: `portalCreateAccess`, each other seven enumerated roles, all four community inputs | `hoa_role_only` | `other_community` | Required first scope check precedes role validation. |
| Same two actor rows: invalid/missing create roles `undefined`, null, empty string, `"invalid"`, `[]`, `{}` | `hoa_role_only` | `other_community` | Same first-check ordering. Role-assignment invalid-role expectations themselves did not change. |
| Membership short-circuit test: unassigned HOA admin, null target assignment, member target | `ok` | `not_in_community` | Close null-equality management grant. |
| Same short-circuit test, target role `hoa_admin` | `hoa_member_only` | `not_in_community` | Scope denial precedes target-role validation. |
| Search matrix: both HOA roles, query undefined/empty (which also sets actor assignment null/empty) | `{kind:"memberships_non_commercial"}` | `not_member` | Unassigned actors cannot search through memberships. Assigned search rows unchanged. |
| Community-list matrix: both HOA roles, assignment null/empty | `{kind:"memberships_non_commercial"}` | `{kind:"none"}` | Do not expose leftover memberships. Role-dashboard assertions unchanged. |
| File-attachment matrix: `"HOA unassigned member"` with retained membership | `true` | `false` | Approved shared-membership extension denies retained-row grants. Assigned HOA membership behavior unchanged. |
| Contact matrix: unassigned HOA admin/member; create in member and outside communities | `ok` | `other_community` | No contact creation scope without assignment. |
| Same contact rows/communities: change | `ok` | `denied` | No editing/deleting contacts without assignment. Write gates and move-policy expectations unchanged. |
| Task compatibility test: both unassigned HOA roles, page-data for other community | `true` | `false` | Close page-data bypass. |
| Same task test: both roles, omitted community | `true` | `false` | Required denial before no-query shortcut. Assigned-role controls unchanged. |
| HOA-request resolver: current null, stale `"session"` | `"session"` | null | Session cannot restore removed assignment. |
| Same resolver: current empty string, stale `"session"` | `"session"` | `""` | Return actor assignment with nullish semantics; route still returns existing no-community 400. |
| Portfolio resolver: client current organization null, session `"session"`, query `"ignored"` | `{orgId:"session"}` | `{orgId:null,status:403,error:"No organization assigned to this account"}` | Current record is authoritative. |
| Portfolio `/me`: current organization null, session `"session"` | `"session"` | null | Same stale-scope removal. |
| Invoice list `"HOA without assignment or query"` | `{kind:"community_required"}` | `{kind:"denied"}` | Unassigned-first denial, including without query. |
| Invoice list `"HOA without assignment member"` | `{kind:"community",communityId:member}` | `{kind:"denied"}` | Leftover membership cannot grant access. |
| Invoice list `"HOA without assignment nonmember"` | `{kind:"not_member"}` | `{kind:"denied"}` | Required explicit first denial. Route remains existing 403 Access denied. |
| Invoice list `"client session org"` and `"client empty user org falls back"` | `{kind:"organization",orgId:"org"}` | `{kind:"no_organization"}` | No session-only organization. |
| Invoice list `"client session org branch"` | `{kind:"community",communityId:member}` | `{kind:"no_organization"}` | A selected branch cannot restore missing organization scope. |
| Invoice read `"HOA unassigned member"` | `ok` | `denied` | Retained membership cannot override removed HOA assignment. |
| Invoice read `"client session org"` / `"client empty org falls back"` | `ok` | `no_organization` | No session-only organization. |
| Invoice read `"client foreign session org"` | `denied` | `no_organization` | Missing live organization is resolved before community ownership. |
| Report `"HOA unassigned missing query"` | `community_required` | `not_member` | Required first unassigned denial. |
| Report `"HOA unassigned member"` | `{communityId:member}` | `not_member` | No retained-membership report access. |

### `src/routeStructure.test.ts`

| Existing assertion / exact affected inputs | Old expected value | New expected value | Security reason |
| --- | --- | --- | --- |
| Status/portal test: unassigned actor activating unassigned target through `/api/users/noCommunity/status` and `/api/portal/users/noCommunity` | HTTP 200 (each) | HTTP 403 (each) | Close null-equality management grant. |
| Community picker: `"unassigned"` | HTTP 200 `[communities[0]]` | HTTP 200 `[]` | Explicit none plan; no leftover-membership list. |
| Unassigned contact POST | HTTP 201 populated contact | HTTP 403 `{error:"Cannot create contacts for other communities"}` | Close unassigned create grant. |
| Unassigned contact PUT name | HTTP 200 `{name:"Renamed"}` | HTTP 403 `{error:"Access denied"}` | Close unassigned edit grant. |
| Unassigned contact DELETE | HTTP 204 null | HTTP 403 `{error:"Access denied"}` | Close unassigned delete grant. |
| Unassigned contact PUT moving to outside | HTTP 403 `"Cannot move contacts to another community"` | HTTP 403 `"Access denied"` | New required contact-change denial happens before existing move check. Assigned HOA move denial and `contactMoveAccess` itself are unchanged. |
| Source assertion: number of invoice route `sessionOrganizationId: req.session.organizationId` inputs | 2 | 0 | Remove both dead scope inputs, not weaken the guard. |
| Session-only client invoice list, unfiltered | body `{orgId:"session"}` (HTTP 200) | HTTP 403 `{error:"Access denied: no organization"}` | Removed live organization cannot be restored by session. Assertion now checks status too. |
| Session-only client invoice list, selected branch | body `{communityId:"selected"}` (HTTP 200) | HTTP 403 `{error:"Access denied: no organization"}` | Same; query cannot restore scope. Assertion now checks status too. |
| Session-only client existing invoice, session `"org"` | HTTP 200 invoice | HTTP 403 `{error:"Access denied: no organization"}` | Remove session-only detail grant. |
| Same detail, session `"foreign"` | HTTP 403 `{error:"Access denied"}` | HTTP 403 `{error:"Access denied: no organization"}` | Live organization absence precedes ownership. Existing missing-invoice 404 is unchanged. |

No other existing expected values were changed. Existing note admin/member/
non-author tests now await the async result and supply a member community while
retaining their original booleans. Existing invoice/HOA resolver fixtures
deliberately retain stale extra arguments (via test-only casts) to demonstrate
they are ignored; production signatures no longer accept them.

## Coverage and remaining limits

The unassigned matrix covers both roles with null and empty assignment, the
specified explicit denials, and existing safe community/task/HOA-dashboard rules.
Assigned HOA and all non-HOA roles retain membership/cache controls. Existing
assigned-HOA policy/route matrices continue to cover contact, portal-user, task,
invoice, report and drive behavior. Existing account-manager, PM and commercial
regressions passed unchanged.

HTTP tests confirm removed accounts stay active, prior sessions are revoked, the
same member can log in again but receives task/contact denials, and unassigned
admins cannot edit/remove/change status of unassigned members. They also verify
retained-row offline denials, empty community lists, note-delete 404 ordering,
former non-HOA author denial, and authorized admin/current-member note deletion.

This fork has not been merged or published. No published URL/status or live
account behavior was checked. After merge, offer the user the publish action,
never publish automatically. Once the user publishes, follow the deployment
guidance to obtain the actual published URL/status and perform read-only
verification using available approved admin/assigned-HOA access. Do not create,
remove, deactivate, or reassign production accounts to manufacture tests. If
appropriate live access is unavailable, report that limitation explicitly.
