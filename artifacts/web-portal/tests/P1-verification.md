# Compression, caching and timing verification

Verified in the task workspace on November 24, 2026. No production publish was performed.

## Results

| Check | Result |
| --- | --- |
| API `pnpm --filter @workspace/api-server run typecheck` | Passed |
| API `pnpm --filter @workspace/api-server test` | **1,657 passed**, 47 suites, 0 failed/skipped |
| Portal `pnpm --filter @workspace/web-portal run typecheck` | Passed |
| Portal `pnpm --filter @workspace/web-portal test:server` | **3 passed**, 0 failed/skipped |
| Portal Playwright specs | **64 passed**, 0 failed/skipped (59 existing + 5 new) |
| API and portal workflows | Each restarted once after implementation; both built and listened cleanly |
| Preview `/web/login` | Rendered normally; no application errors in screenshot console |

Playwright's configured fallback browser was absent in this workspace. The first attempt was blocked at browser launch (17 non-browser checks passed; 47 failed, including a new CSP assertion whose directive ordering was corrected without changing CSP). The successful full run used the existing workspace browser:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/repl/tools/bin/chromium \
  pnpm --filter @workspace/web-portal test
```

Node-only version tests are kept out of Playwright discovery and run through `test:server`. Build the portal first (the development workflow already does this).

## Automated regression evidence

- Twelve new API tests use raw HTTP bytes, avoiding transparent client decompression. They verify gzip JSON body equivalence above 1 KB, identity negotiation, default MIME/no-transform/small-body filtering, and pre-encoded gzip remaining byte-identical.
- Compressible streaming fixtures exercise the real route shapes: `/objects/*`, `/public-objects/*`, `/api/exports/:id/download/pdf`, `/api/exports/:id/download/zip`, and `/api/drive/files/:id/download`. Drive uses the same object-stream helper and therefore needs the same protection. Full and partial fixture responses retain their body, status, length, disposition and range headers without encoding. Case-insensitive matching follows Express's existing routing behavior.
- Timing tests verify success, error and OPTIONS responses, non-API exclusion, the strict `> 1000 ms` boundary, query/cookie/authorization omission, and exactly one slow line despite both finish and close events. A streaming test distinguishes time-to-headers (`Server-Timing`) from full-response duration (slow log).
- Four static-mount tests check immutable versioned responses, unchanged unversioned bodies and ETags, 304 revalidation, and unrelated query parameters remaining short-cached.
- Portal HTML tests check gzip, `no-store`, no anonymous session cookie, the exact existing CSP, and no-store map HTML.
- Hash tests check deterministic ordering, distinct build roots, timestamps not affecting versions, nested JSON changes, binary-file addition/removal, and renames.
- Two actual production-mode starts of the same built server reported the same version, `3ba7e8c4e87a41c2`, matching the hash of `dist/public`. Isolated rebuild tests prove changed content changes the compiled version. Missing version fails outside development.

The streaming fixtures prove middleware behavior, not access to real production storage. Actual stored photos, attachments, drive files and PDF/ZIP exports were not downloaded in this workspace.

## Live development headers

Through the shared proxy:

- `GET /api/healthz`: 200, `Cache-Control: no-store`, valid `Server-Timing: app;dur=9.81`, API CSP still absent.
- `GET /admin-static/router.js?v=check` with gzip accepted: 200, gzip, `Cache-Control: public, max-age=31536000, immutable`, ETag retained.
- `OPTIONS /api/healthz` with allowed development origin: 200; existing allow-origin, methods, headers and credentials unchanged; valid app timing.

No route, permission, storage, database, feature, session, CORS or CSP configuration was changed. The existing API suite and portal specs passed. The middleware intentionally adds `Vary: Accept-Encoding` and encoding-dependent transfer headers.

## Script/style/JSON audit

The current routers register and render preloaded pages; they do **not** dynamically fetch page scripts. The five shells directly include local resources, and the existing `stampHtml()` stamps all their local JS/CSS references:

| Shell | Local scripts | Local styles | Total |
| --- | ---: | ---: | ---: |
| Admin | 28 | 2 | **30** |
| HOA | 22 | 2 | 24 |
| PM | 20 | 2 | 22 |
| Contractor | 15 | 2 | 17 |
| Portfolio | 17 | 1 | 18 |

No local dynamically loaded script/style/JSON URL lacking a version was found. There are no JSON files under portal `public/`. API JSON remains no-store, not immutable.

Resources intentionally **without this build's `?v=`**:

- Dynamic `public/admin/pages/xeriscape-planner.js` loads `https://unpkg.com/leaflet@1.9.4/dist/leaflet.css` and `leaflet.js`.
- `lib/leaflet-template/src/index.ts` embeds the same Leaflet JS/CSS plus `leaflet.markercluster@1.5.3/dist/MarkerCluster.css`, `MarkerCluster.Default.css`, and `leaflet.markercluster.js`.
- The inline pin-picker HTML loads Leaflet 1.9.4 JS/CSS.
- Shells and login load Google Fonts stylesheets (`fonts.googleapis.com/css2`, Inter and/or Outfit).

These are external, package-pinned/CDN resources, not portal static mounts; their providers control caching and this change does not modify it. No claim of short CDN caching is made. Local favicon, logo and background image references also remain unversioned and retain `max-age=0` with ETags. Arbitrary unversioned local JS/CSS/JSON requests retain that same short policy. HTML is always no-store.

## Post-merge production checks — blocked pending user publishing

The deployment metadata service reports an existing public autoscale deployment at **https://vrt-sync-mobile.replit.app**. It is not this task's unpublished build. Historical transfer sizes in the attached source brief are not new measurements. No post-change production performance target or deployment logs have been verified.

After merge and user-triggered publishing:

1. Sign in as an authorized admin. With browser cache enabled, record actual encoded transfer sizes for `/api/assets` (**target <400 KB**) and Miramonte Ranch's `/api/communities/:id/assets` (**target <150 KB**). Do not infer success from test fixture compression.
2. Capture a cold admin visit, then navigate away and revisit normally (not hard reload). Verify **all 30** local scripts/styles come from memory/disk cache without revalidation requests. Save evidence using the browser's network panel or cache-aware browser protocol; `curl` cannot prove browser cache use.
3. Compare rendered admin HTML script/style versions with the build's logged hash and confirm HTML is no-store. After a later changed-public-content deployment, verify HTML points at the new hash and scripts load successfully.
4. Confirm authenticated sessions and authorized/unauthorized CORS behavior, and open representative stored task photos, asset attachments, drive downloads, proof-of-work PDFs and ZIPs. Check bytes, filenames and existing range behavior; no new range capability was implemented.
5. Confirm production CSP is unchanged and API responses carry `Server-Timing`; observe slow lines without query strings or request data.

Production results: **not measured**. Blockers: this branch has not been merged/published; an authenticated production admin browser and representative stored downloads are required. Publishing remains a user action, never an automatic step of this task.
