# Portal controls and helper initialization verification

## Scope

Only web-portal source, tests and this report changed. No API, database schema,
mobile, permissions, routes, visual styles or CSP configuration changed.
Browser verification uses temporary development-only test fixtures, cleaned up
after the role checks. Production publishing is not performed from this fork.

## Baseline and complete inline-handler inventory

Both original admin render functions were executed from the pre-change Git
source with nonempty community fixtures. Each threw:
`ReferenceError: Cannot access 'esc' before initialization`.
Both aliases now initialize at the start of the render function.

Raw source scan of all tracked public files, templates and server.ts found
**27 inline attributes in seven files** (not the initial rough tally of 28):

| File | Attributes | Replacement |
| --- | ---: | --- |
| src/server.ts | 3 click | Forgot-password open, close and backdrop listeners in the existing permitted script block |
| public/admin/pages/asset-types.js | 3 click | Edit, Deactivate, Reactivate: delegated tbody click, data-type-action/data-key |
| public/portal/pages/dashboard.js | 13 click + 2 keydown | View-all/tasks/requests links; service-day card; both water-report states; generated attention rows; new-request guard; map links; community switch; generated map-layer rows; manage-schedule link |
| public/portal/portal-modules.js | 3 click | Module View all, generated quick links/action attributes, Open full map |
| public/portal/pages/tasks.js | 1 click | Retry |
| public/portal/pages/requests.js | 1 click | Retry |
| public/portal/pages/invoices.js | 1 click | Retry |
| templates | 0 | No change needed |

The broader search also found JS comparisons involving `onSuccess` and
`oneTimePerBranch`; these are not HTML handler attributes. Script assignments
such as `element.onclick = function...` elsewhere are permitted CSP listeners,
not HTML attributes, and were left unchanged.

All 62 public scripts were checked for block-scoped helper initialization
diagnostics. All 30 shared-helper aliases were also checked for earlier calls,
including callbacks embedded in initial templates. No further confirmed
helper-initialization defects were found.

## Behavior retained

- Portal controls use one shell-lifetime delegated dispatcher, not new listeners
  on sync or page rerenders. Action attributes are namespaced to avoid existing
  task-row data-action handlers. The asset-type tbody listener survives its
  table rerenders and is discarded with the page.
- Report links retain `navigate('reports', true, {report: 'water-usage'})` and
  stop propagation before ancestor card listeners.
- Role-button Enter and Space activation calls preventDefault. Native buttons
  retain native keyboard click behavior (no duplicate synthetic activation).
- Task detail and new-request globals retain their typeof function guards.
- Login backdrop closes only on the backdrop itself, not modal contents.
  Escape closing is unchanged.
- Deactivate retains its exact confirmation text and cancel behavior.
  Reactivate had **no confirmation in the original source** and remains so.
- Quick-link callers were searched: the only current caller supplies routes.
  The unused arbitrary JavaScript-string action fallback is now declarative
  named actions handled by the same dispatcher; no eval or Function was added.

## Automated checks

- `pnpm --filter @workspace/web-portal typecheck`: passed.
- `pnpm --filter @workspace/web-portal exec playwright test`: **58 passed**,
  comprising **50 existing tests**, **seven new interaction tests**, and
  **one source-scan guard**. Installed Chromium was selected with
  PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH because the default downloaded browser
  was absent. Initial browser launches failed before running assertions;
  rerunning with the installed executable passed.
- After approval of the missing request helper, the final targeted run
  (`playwright test portal-controls.spec.ts no-inline-handlers.spec.ts`) passed
  **all nine tests**: eight interaction tests and the source-scan guard. This
  includes the real helper → Requests route → existing form integration.
  The 50 existing portfolio/map tests were not rerun for that helper-only change.
- `tests/no-inline-handlers.spec.ts`: recursively scans every public/template
  file plus server.ts. No allowlist.
- Negative check: temporarily added public/common/b1-negative-probe.html with
  an onclick attribute. The guard failed with the exact file and line.
  The probe was deleted before the passing suite.
- New interaction tests exercise login close semantics; populated invoice and
  contract filter rendering; invoice filter URL; asset-type cancel/confirm and
  reactivation; navigation parameters; propagation; guarded request opening;
  Enter/Space cancellation; repeated rerenders; all three retry buttons.
- `git diff --check`: passed.
- Optional test-source TypeScript check is not a configured package validation:
  tsconfig.test.json lacks DOM types and has existing fixture typing errors in
  group-colors and water-savings-navigation. With DOM types supplied, neither
  new spec has diagnostics. Those pre-existing test configuration issues were
  not changed in this slice.

## Actual CSP response comparison

Captured the preview `/web/login` HTTP 200 response before edits and again after
the rebuilt portal workflow restarted. Header values were **byte-for-byte
identical**, using a diff of the actual response header lines:

```text
default-src 'self';base-uri 'self';font-src 'self' https://fonts.gstatic.com;form-action 'self';frame-ancestors 'self';img-src 'self' data: https:;object-src 'none';script-src 'self' 'unsafe-inline' https://unpkg.com;script-src-attr 'none';style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com;upgrade-insecure-requests;connect-src 'self'
```

No unsafe-inline or unsafe-hashes was added anywhere. The pre-existing
script-src allowance permits the login listener script; script-src-attr remains
`'none'`. Login uses that **existing permitted script mechanism**, not a new
common-static script.

## Signed-in browser verification

The browser pass uses real development login/session/API responses, not mocked
authentication. Temporary test records are separate from existing user data.

- Login: reset panel opens, inner clicks do not close, X/backdrop/Escape close.
- Admin: real login and logout; invoices show six existing development records
  plus one temporary invoice during the run; filter selects exactly that
  invoice, clearing restores the list, and reload works. Contracts renders with
  all filters (development has no contracts). Asset-type edit cancel/save,
  deactivate cancel/confirm, inactive filtering and reactivation pass.
- No inline-handler CSP violations on the login or affected admin pages.
- Login visual snapshot shows the existing design intact.

Further results from the same browser pass:

- PM: real login with two assigned fixture communities; map-layer role-button
  Enter and Space navigate to `/web/pm/map` with defaultPrevented=true.
  Dashboard/Tasks navigation cycles do not duplicate manual-refresh listeners.
  Water Usage report opens from Reports. Service Day/Water Usage/Attention
  widgets are not present on the PM dashboard in this version.
- HOA: real login; Requests-page New Request opens the actual form; X and Cancel
  close it without submitting. An injected Requests GET failure shows Retry;
  one click issues one recovery GET and restores the list.
- The initial signed-in check found a **missing component**:
  `window.openNewRequestForm` was not defined anywhere in the portal, so the
  dashboard's guarded handler remained a no-op. Work stopped and this was
  reported as required by the brief. The user explicitly approved connecting
  the existing form. The helper now sets `_pendingOpenNewRequest` and navigates
  to `requests`, exactly like the existing topbar action; the Requests page
  consumes the flag and opens its existing form. The typeof guard is retained.
- Contractor: real login; assigned-community dashboard renders. Portfolio:
  client-admin login and empty portfolio dashboard render.
- Admin read-only smoke: Communities, Organizations, Users, Import Tasks and
  Data Import load; community Overview, Assets and Map Layers tabs load.
  Community Tasks/Members/Offline Packs were not verified because the browser
  operation reached its time limit.
- All temporary fixture users, sessions, communities, organization, memberships,
  invoice, task, map layer and catalogue row were cleaned up and checked for
  leftovers. Existing records were not changed.

Console findings must not be described as a clean five-role CSP pass:

- Admin: no inline-handler violations observed (the extra smoke navigation did
  not systematically tally all console messages).
- PM: four inline-handler violations, all in the map iframe. The tester traced
  their origin to the development-preview injected devtools script.
- HOA: six inline-handler violations; contractor: one. Their origins were not
  individually traced, so preview-script attribution is not confirmed.
- Portfolio: zero.
- There are zero matching inline attributes in the scanned application sources;
  this does not prove every runtime iframe/injected-script warning is harmless.
  No CSP relaxation or out-of-scope preview tooling changes were attempted.
- Unrelated favicon 502 responses and a login password-input advisory were also
  observed and left unchanged.

Final focused real-browser confirmation after the approved fix:

- Real HOA-admin sign-in → dashboard → one New Request click navigates to
  `/web/hoa/requests`, opens `#req-form-overlay`, focuses the visible form state,
  enables Submit, and consumes the pending-open flag. Cancel closes the form
  without creating a request. All final temporary user/community/session fixtures
  were removed and checked for leftovers.
- The location-picker iframe recorded a script-src-attr violation. Its only
  inline-handler element was an `onerror` attribute injected onto the
  development-preview devtools script, posting `script.onerror: Failed to load`.
  The app-generated pin-picker and Leaflet documents contain no such attributes.
  This confirms an environmental source for that warning, matching the PM map.
- Top-frame HOA documents contained no runtime HTML handler attributes and
  captured no top-frame policy violations; a page-level console warning was
  still not individually attributable. The earlier HOA dashboard-map and
  contractor warnings remain untraced; do not report them as definitively clean.
- The final HTTP 200 CSP response also matches the original response baseline
  preserved in this report exactly. The temporary raw baseline file did not
  survive the environment pause, so the final follow-up comparison used that
  recorded header rather than claiming to re-read the lost file.

The approved missing-handler bug is fixed and verified. Remaining limitations
are the explicitly listed unverified extra admin tabs, incomplete attribution
of earlier preview-injected warnings, and post-publish production verification.

## Post-merge publishing and production verification

Deployment metadata returned the current published URL:
https://vrt-sync-mobile.replit.app

This URL was obtained from deployment metadata, not inferred from development
environment variables. No changed production pages, production invoice count
or post-publish behavior has been verified. The historical invoice count of 143
is not an assertion or application value.

After this change is merged, the user must publish the main app. Then, when
authenticated access is available, verify login reset controls, admin invoice
list/filter and Contracts, asset-type row actions, PM/HOA dashboard controls and
retries, and console CSP errors across admin/PM/HOA/contractor/portfolio.
Compare published response headers against the unchanged policy above.
