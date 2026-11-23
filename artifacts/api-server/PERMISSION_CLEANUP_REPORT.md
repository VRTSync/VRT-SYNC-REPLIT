# Permission cleanup verification

## Scope and approval

Only `artifacts/api-server` was edited. No permission rules, route names,
middleware, input handling, check order, statuses, error messages, response bodies,
database schema, migrations, dependencies, mobile code or web code were changed.

The user explicitly approved a narrow exception before implementation:
replace obsolete structural assertions requiring the deleted wrapper/constants
with absence checks; adapt two additional extraction setups discovered in the
current code; and expose the real central community policy under the existing
community-test fixture API. Every existing behavioral assertion and expected
response stayed unchanged. All other per-area structural checks stayed unchanged.

## Usage audit and deletions

| Component | Finding and action |
| --- | --- |
| `routes/routes.ts`: `userCanAccessCommunity` | Only production occurrence was its declaration; no route callers. Deleted the wrapper and its now-unused central-policy import. |
| `routes/invoices.ts`: `invoiceReadRoles`, `invoiceMutateRoles` | Each occurred once in production, solely as a declaration. Deleted both. |
| `routes/drive.ts`: `driveMutateRoles`, `driveReadRoles` | Each occurred once in production, solely as a declaration. Deleted both and the now-inapplicable fixture-boundary comment. |
| `routes/reports.ts`: `reportReadRoles` | Already absent; no deletion or file edit. Existing absence assertion preserved. |
| `nextControllerKey` | Already absent from API implementation; no deletion or file edit. Existing absence assertions preserved. |
| `storage.canUserAccessTask` | Implementation and internal call in `canManagerReadTaskObject` retained exactly, including policy delegation, query order and return shape. Added only the storage-internal comment directing routes to `policy.canReadTask`. Existing mocks retained. |

## Every harness/boundary change

Paths below are relative to `src/`.

1. `accountManager.test.ts`: start boundary `const invoiceReadRoles =` changed to
   `app.get("/api/invoices",`. End boundary `app.post("/api/contracts",` unchanged.
   Same invoice/report/contract handlers are selected; only dead declarations are
   omitted.
2. `communityAccess.test.ts`: removed extraction from
   `async function userCanAccessCommunity(` through `  registerAuthRoutes(app);`
   and removed its bundle interpolation. The wrapper no longer exists. The
   fixture now exports the same test API as a direct call to
   `policy.canAccessCommunity(policy.actorFromUser(user), communityId)`, so
   existing helper assertions exercise production policy without recreating a
   production wrapper.
3. `communityAccess.test.ts`: start boundary `const driveMutateRoles =` changed to
   `async function requireDriveAccess(`. End boundary
   `app.post("/api/drive/folders",` unchanged. Same drive helpers and GET handler.
4. `companies.test.ts`: removed unused community-wrapper extraction and bundle
   interpolation. This unlisted dependency was found in the audit and included
   in the approved exception; handlers use central policy already.
5. `fileAccess.test.ts`: start boundary `const driveMutateRoles =` changed to
   `async function requireDriveAccess(`. End boundary `app.get("/api/drive",`
   unchanged. Same live helpers. This additional extraction dependency was
   included in the approved exception.
6. `testUtils/routeFixtureSource.ts`: unchanged. Its existing registration-based
   reconstruction works after these deletions; no synthetic dead boundaries added.

No fixture data, storage mocks, bundling settings, production handlers or
behavioral assertions were changed.

### Approved structural-assertion changes

In `routeStructure.test.ts` only:

- Wrapper implementation-presence assertion became a wrapper-absence assertion.
- Drive function-signature assertion no longer requires the removed declarations;
  both constant occurrence expectations changed from one to zero.
- Invoice function-signature assertion no longer requires the removed
  declarations; both constant occurrence expectations changed from one to zero.
- Renamed the two constant-related test descriptions accordingly.

All neighboring policy-call counts, route inventories, registration ordering,
middleware checks, response checks and report-helper absence checks remain intact.
`policy.test.ts` is unchanged.

## Central policy documentation

`src/policy/index.ts` documents all 14 areas: actor, community, tasks, hoa,
portfolio, assets, maps, billing, files, drive, contacts, communities, users and
schedules. Routes must import the central module and make permission decisions
only through it, not individual policy files.

## Route guard

`src/routeGuards.test.ts` recursively discovers TypeScript route files. Currently
it scans 32 of 36 files, excluding only `handler.ts`, `upload.ts`, `errors.ts` and
`userRules.ts`. Newly added route files are included automatically.

It rejects the required direct role comparisons, role-list checks, four role
predicates, membership/legacy helpers and direct policy-submodule imports, with
whitespace-tolerant patterns and either import quote style. It also tracks the
documented view-model comparisons and quality viewer argument. Errors identify
the file, line, forbidden construct and central-policy convention.

Each allowlist entry is a file-specific, exact whole line, including indentation.
Only that line is masked. Missing, changed, duplicated or missing-file entries
fail. Adding a forbidden expression to an allowlisted line invalidates the exact
match; adding one elsewhere in that file is not exempted. Nonempty reasons are
required.

### Complete allowlist

The text below omits indentation for readability; the test stores exact
indentation as well.

| File in `src/routes/` | Exact text excluding indentation | Reason |
| --- | --- | --- |
| `tasks.ts` | `if (vmRole === "contractor") {` | Selects already-authorized view-model response collections. |
| `tasks.ts` | `} else if (vmRole === "hoa_member") {` | Selects already-authorized HOA view-model response collections. |
| `assets.ts` | `communityId, userId: reqUser.id, role: reqUser.role,` | Quality-response viewer argument passed after the policy gate. |
| `users.ts` | `allUsers = allUsers.filter(u => u.role === roleFilter);` | Requested-role response filtering after the policy grants the all-users view. |
| `users.ts` | `const effectiveCompanyId = companyId === undefined && isContractorSide(targetUser?.role \|\| "") && isContractorSide(role)` | Validates the target account's company across role transitions, not caller access. |
| `users.ts` | `if (isClientRole(role) && !organizationId) {` | Requires an organization for a new client target account. |
| `users.ts` | `if (!isClientRole(role) && organizationId) {` | Rejects an organization for a non-client target account. |
| `users.ts` | `organizationId: isClientRole(role) ? organizationId : undefined,` | Shapes the target account's organization field. |

The target-account exceptions preserve the validation uses already explicitly
documented by the existing user/company structural tests. They do not exempt
caller-authorization predicates or entire files.

### Negative control

Temporarily inserted into the real `routes/routes.ts` ping handler:

```ts
if (_req.currentUser?.role === "admin") { /* temporary guard probe */ }
```

Running `node --import tsx/esm --test src/routeGuards.test.ts` from the API
directory failed as required: 17 tests, 16 passed, 1 failed. Diagnostic:

```text
Route permission guard failed:
routes.ts:57: direct role comparison: .role === — use the central policy module
```

The temporary line was removed before final verification and is not part of the
delivered changes. The new suite also independently tests all listed forbidden
constructs, central imports and stale/changed/duplicated/misplaced exceptions.

## Verification results

| Check | Result |
| --- | --- |
| Baseline `pnpm --filter @workspace/api-server test` | 1,628 tests, 46 suites, all passed; zero failures, skips, cancellations or todos. |
| Final `pnpm --filter @workspace/api-server test` | 1,645 tests, 47 suites, all passed; zero failures, skips, cancellations or todos. |
| Added guard coverage | 17 tests in one new suite; all existing tests retained. |
| `pnpm run typecheck:libs` | Passed. |
| `pnpm --filter @workspace/api-server run typecheck` | Passed, after libs. |
| `git diff --check` | Passed. |
| API managed workflow restart | Built and listened on port 8080; startup reported zero migrations applied. |
| Development proxy `GET /api/healthz` | HTTP 200, `{"status":"ok"}`. |
| Unauthenticated development `GET /api/ping` | HTTP 401, `{"message":"Not authenticated"}`; screenshot confirmed the same response. This is not a signed-in journey check. |

## Merge, user publication and production verification

This branch has not been published. Publication must remain a user action after
merge, shipping the complete batch from F3e onward. Do not publish the fork.

Post-publication click-throughs have **not been performed**. They are gated on
merge, the user's publication of the combined batch, and access to the required
role accounts and mobile/offline setup. Role-account access has not been
established in this task; no production test results are claimed.

After those prerequisites are met, check and record actual results or explicit
access/setup blockers for each journey:

- Admin: tasks, map, invoices, users, organizations.
- PM: tasks, contacts, drive.
- HOA admin: dashboard, requests, portal users.
- Account manager: invoices, crew.
- Mobile crew supervisor: assigned tasks, offline pack, log a service visit.
- Commercial client: portfolio, work orders.

Development HTTP tests and the unauthenticated screenshot do not substitute for
these production checks.
