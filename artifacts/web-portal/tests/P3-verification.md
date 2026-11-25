# Community card summary consolidation verification

Verified in the task workspace on November 24, 2026. No publishing was performed.

## Approved contract

The card reads exactly `activeAssetsCount`, `tasksCount`, `mapLayersCount`, and
`membersCount`. The old summary omits `membersCount`; the user explicitly chose
**Preserve displayed zeros** before implementation.

The new endpoint returns those four fields, keyed by community ID. It deliberately
returns `membersCount: 0`, even for communities with memberships, and does not
query memberships. Active assets exclude archived assets; task and layer counts
include all rows in the community, matching the existing summary.

The old summary route and `getAdminSummary` were left unchanged. Only the new
route's inventory entry and the fixture's expected handler count changed in the
structural inventory. Permission rules and the route-wide guard were not changed.

## Results

| Check | Result |
| --- | --- |
| API typecheck | Passed |
| Portal typecheck | Passed |
| Full API suite | **1,676 passed**, 49 suites, 0 failed/skipped |
| Full portal Playwright suite | **68 passed**, 0 failed/skipped |
| Portal Node server tests | **3 passed**, 0 failed/skipped |
| New endpoint database queries | **4**, unchanged after adding 20 communities |
| Communities page loader API calls | **3**, including one grouped summary request |
| API and portal workflows | Restarted once; built and served successfully |
| Preview screenshot | Login rendered normally; no application console errors |

The API initially failed typecheck because generated database declarations were
stale after earlier map-layer work. `pnpm exec tsc -b lib/db` refreshed generated
declarations; no database source, schema, migration, or package configuration
changed.

Commands:

```sh
pnpm exec tsc -b lib/db
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/web-portal typecheck
pnpm --filter @workspace/api-server test
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/repl/tools/bin/chromium \
  pnpm --filter @workspace/web-portal test
pnpm --filter @workspace/web-portal test:server
```

## Regression evidence

- Four new API fixture tests exercise the real storage, PostgreSQL grouped
  queries, route wrapper, and `requireAdmin`. Fixtures are rolled back.
- Counts are directly compared with `getAdminSummary` for communities with
  different data and an empty community; archived assets and different task
  statuses are covered. Memberships exist, but the expected displayed count
  explicitly remains zero.
- Unauthorized requests return the existing 401/403 responses without executing
  summary queries. Query parameters cannot change authorization or scope.
- A failed grouped query returns an explicit 500 response.
- Four new browser specs exercise the real page script against fixture APIs.
  They verify merging by ID, three loader calls, zero fallbacks after a failed
  reload, organization-label fallback, search and empty search results,
  create/edit saving and reloading, and View navigation.
- The browser fixture uses the served login document and current CSP; no CSP
  policy was relaxed. It does not establish a real authenticated admin session.

## Not verified in this workspace

Production all-card rendering under **1.5 seconds**, production request count,
and before/after number comparisons for **every production community** require
merging and user-triggered publishing, followed by authorized browser access.
The brief's **4.3 seconds / 30 calls** are historical measurements, not results
measured here.

The three-call assertion is for the Communities page loader. Admin shell
authentication and its initial community-list fetch are outside that assertion;
a cold full-page navigation may include those additional requests. Verify both
in-app navigation and cold loading when measuring the published page.

After user-triggered publishing, obtain the published URL using deployment
guidance, measure from navigation to all populated cards, record request scope
and timing, and compare each community's three actual counts with the unchanged
summary. Member counts must remain zero under the approved contract.
