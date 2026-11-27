# R1 React shell verification

## Scope

The new React frame is served at `/app`, alongside—not instead of—the existing `/web` portal. No login cutover, API/database/mobile changes, or changes to the existing shared CSS are included.

Both initially private Claude references were supplied as readable HTML uploads:

- `R1-shell-mockup_1795798308279.html`
- `R1-texture-reference-dashboard-mockup_1795798369203.html`

The written R1 navigation table takes precedence over later-slice content in those mockups.

### Approved integration differences

- The registered staff community route is `/web/admin/community/<communityId>`, not `/web/admin/community-detail/<communityId>`. Staff task search results and notifications use its existing `/tasks` tab and task modal.
- The staff portal has no Documents page. The user approved an explicit “Documents are not available in the staff portal.” notification-panel message, rather than a broken link or silent Home fallback.

## Commands and results

Run from the workspace root:

| Command | Result |
| --- | --- |
| `pnpm install` | Passed. New Node dependencies use catalog/workspace versions. Existing unrelated mobile peer warnings remain. |
| `pnpm run typecheck:libs` | Passed, including the new shared roles package. |
| `pnpm --filter @workspace/roles test` | Passed: 2 tests. Role-value sets, lengths and duplicates checked without changing either list's order. |
| `pnpm --filter @workspace/web-portal run typecheck` | Passed: server and app TypeScript configurations. |
| `NODE_ENV=production pnpm --filter @workspace/web-portal run build` | Passed. Bundled server plus `dist/app/index.html` and content-hashed JS/CSS. The build actually imports source TypeScript from `@workspace/roles` using the catalog `tsx` loader. |
| `pnpm --filter @workspace/web-portal run test:server` | Passed: 11 tests, including actual guard/route source with isolated session/database I/O, six role guards, current active-user checks, client/mobile behavior, SPA fallback/cache behavior, exact role nav/plus config, storage denial, legacy label-script ordering and existing static-version tests. |
| `pnpm --filter @workspace/api-server test` | Passed unchanged: 1,839 tests, 52 suites; no failures or skipped tests. |
| `git diff --check` | Passed. |
| `node --check` on the changed vanilla-browser scripts | Passed. |
| Source comparison of Users options, shared CSS and stamped role-label URLs | Passed: all 13 pre-existing option values retained, both shared stylesheets byte-identical, shared labels stamped in all five shells. |

Production Vite builds warn that `/portal-static/brand/topo-*.png` are runtime URLs; these are intentionally served by Express and both returned HTTP 200 through the proxy. Both palette PNGs are 1014×772, use six quantized alpha levels, and are 97,007 bytes each (under 100 KB). Only the images, not the one-off Pillow script/tooling, are retained.

## Running-service checks

The portal workflow was restarted after the full implementation batch and came up cleanly. Through the shared proxy:

- Signed-out `/app` and `/app/some/deep/link`: HTTP 302 to `/web/login`, `Cache-Control: no-store`.
- `/web/login`, `/leaflet-map.html`, `/pin-picker.html`, both texture images: HTTP 200.
- `/app/assets/<hashed>.js`: HTTP 200, JavaScript, `Cache-Control: public, max-age=31536000, immutable`.
- Existing versioned `/portal-static/portal.js?v=...`: HTTP 200, immutable yearly cache, gzip compression and `Vary: Accept-Encoding`.
- Existing Helmet CSP and read-only session-store configuration are unchanged.
- Artifact routing was updated through schema validation to include `/app`; the existing startup health check remains `/web/login`.

## Browser acceptance

One authenticated acceptance pass, continued in the same browser tester to finish initially unchecked cases, used unique isolated development fixtures. Named production communities were not required. No application code or API assertions were changed by the tester. All fixture users, memberships, organizations, companies, communities, tasks, notifications and sessions were deleted in foreign-key order, and zero remaining rows were verified.

Passed:

- All six role-specific sidebars, group order, labels and permitted plus actions. No SyncHub, new Schedule or real dashboard was introduced.
- Signed-out and inactive/deactivated sessions, client portfolio redirect, Map Creator notice and external-script logout.
- Exact Home placeholder, in-frame unknown-route page and Home navigation.
- Community defaults, saved choice/reload, transfer to legacy Tasks, fixed HOA label and searchable list with more than six choices.
- All four plus actions opened the existing forms. Async staff form rendering was respected. Both PM form and selected-task links removed their handled parameter while retaining `keep=1`.
- Staff and crew task search opened the matching community and task. Task notifications marked read and opened staff community-task modals. An inaccessible task showed an explicit error without navigating.
- Two-character search threshold, 250 ms debounce, no-results state, eight-result cap, keyboard Enter/Escape, and delayed previous-query/previous-community responses being discarded.
- Notification unread counts, focus refresh and read-all, PM invoice/document destinations, Board Member Documents destination, and approved staff Documents unavailable message.
- Profile menu keyboard focus return, Enter/Space opening, successful profile logout ending the session (`/api/auth/me` returned 401).
- Delayed `/api/auth/me` displayed the empty loading frame; forced HTTP 500 displayed the prescribed error and Reload; restoring the endpoint and reloading recovered.
- 390px and 820px drawer behavior: overlay/Escape/link closure, focus return, Tab and Shift+Tab trapping, inert main area, no horizontal overflow, avatar-only small-screen profile, long names and community search. Reduced-motion sidebar/overlay transitions were `none`/`0s`.
- Zero observed CSP events on `/app` across all role checks.

Legacy smoke checks passed with expected page content and no error text on:

- Staff: dashboard, communities, users, invoices, contracts, reports and the community Tasks tab.
- HOA admin: dashboard, tasks, requests, map, invoices, documents and users.
- Contractor: dashboard, tasks, map and the existing service-schedule route.
- Client: portfolio dashboard and water-savings; `/app` still redirected to the portfolio dashboard.

### Limitations and unchanged baseline findings

- The existing search API restricts non-staff task search to assigned tasks in cases where a property manager can otherwise see those tasks in the legacy Tasks list. A PM's unassigned community task therefore returned no search result. R1 calls the existing API unchanged; broadening search/authorization was expressly out of scope. Staff, crew and an assigned PM task exercised working search destinations. A separate follow-up was proposed for the API behavior.
- The existing contractor Service Schedule route renders its pre-existing Coming Soon placeholder; R1 links it without building a new page.
- Legacy pages emitted existing CSP inline-handler warnings in map/pin-picker and some HOA Users/contractor interactions. `/app` itself had zero CSP events. No policy changes were made.
- Existing legacy-only issues observed: the login password-field DOM warning, long-name profile clipping, Users table horizontal overflow, Board Member legacy top-bar plus button, and an out-of-sync migration status. These were not changed by R1.
- Legacy regression checks were smoke checks, not exhaustive testing of every operation in every legacy page. Exact Users option preservation, label generation/order and stylesheet preservation were also checked directly in source.
- Loading/error states were exercised in the browser; after the pass, the small-screen loading branch was tightened to keep the top bar completely empty until user data arrives. That narrow conditional and the dashboard-map parity addition were confirmed by TypeScript/build/server checks rather than repeating the authenticated browser pass.
- No production publishing or production-data mutation was performed.
