/**
 * branch-outline.spec.ts
 *
 * Confirms that the community boundary (setCommunityOutline) remains visible
 * every time the user switches tabs on the branch detail page.
 *
 * Strategy
 * ────────
 * • The real branch-detail.js is loaded from the running dev server.
 * • All API calls and the Leaflet iframe are intercepted via page.route() so
 *   the test is fully deterministic — no database, no session, no Mapbox token.
 * • The mock iframe records every postMessage it receives from the parent page
 *   in window.receivedCmds.  After each tab click we evaluate that array inside
 *   the iframe frame and assert that the setCommunityOutline count has grown.
 */

import { test, expect, type Page, type FrameLocator } from '@playwright/test';

// ── Fixture data ─────────────────────────────────────────────────────────────

/** Minimal GeoJSON polygon — represents the community boundary outline. */
const OUTLINE_GEOJSON = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-87.62, 41.84],
            [-87.60, 41.84],
            [-87.60, 41.86],
            [-87.62, 41.86],
            [-87.62, 41.84],
          ],
        ],
      },
      properties: {},
    },
  ],
};

/** Minimal GeoJSON point — represents a service layer asset. */
const SERVICE_GEOJSON = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-87.61, 41.85] },
      properties: { label: 'Valve 1', featureId: 'v1' },
    },
  ],
};

/** Branch detail response: 1 outline layer + 1 irrigation service layer. */
const BRANCH_WITH_OUTLINE = {
  branch: {
    id: 'test-branch',
    name: 'Elm Grove HOA',
    code: 'EG01',
    address: '1 Elm Plaza',
    city: 'Chicago',
    groupIds: [],
  },
  layers: [
    { id: 'layer-outline', type: 'outline', name: 'Community Boundary', assetCount: 0 },
    { id: 'layer-irrig',   type: 'irrigation', name: 'Irrigation',       assetCount: 8 },
  ],
  recentServices:  [],
  openWorkOrders:  [],
  inventory:       [],
};

/** Branch detail response with NO outline layer — only a service layer. */
const BRANCH_NO_OUTLINE = {
  ...BRANCH_WITH_OUTLINE,
  layers: [
    { id: 'layer-irrig', type: 'irrigation', name: 'Irrigation', assetCount: 4 },
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Inline HTML served as a mock replacement for leaflet-map.html.
 *
 * Records every `cmd` postMessage from the parent page in window.receivedCmds.
 * Fires mapReady back to the parent after a short delay so branch-detail.js
 * flushes its pending command queue and begins loading geometry.
 */
const MOCK_LEAFLET_IFRAME = `<!DOCTYPE html>
<html><body>
<script>
window.receivedCmds = [];
window.addEventListener('message', function (e) {
  var msg = e.data;
  if (typeof msg === 'string') { try { msg = JSON.parse(msg); } catch (_) { return; } }
  if (msg && msg.type === 'cmd') {
    window.receivedCmds.push({ fn: msg.fn, args: msg.args });
  }
});
// Signal readiness so branch-detail.js flushes pending commands and starts
// loading GeoJSON for the initial Summary tab.
setTimeout(function () {
  window.parent.postMessage({ type: 'mapReady' }, '*');
}, 40);
</script>
</body></html>`;

/**
 * Test harness HTML page.
 *
 * Sets up the minimal global environment that branch-detail.js expects, then
 * immediately invokes its registered render function with a test branch id.
 * The script tag loads the REAL branch-detail.js from the dev server so the
 * test exercises the production code path without modifications.
 */
const HARNESS_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Branch Detail Test Harness</title></head>
<body>
<div id="page-content"></div>

<script>
/* Minimal PortfolioRouter stub */
window.PortfolioRouter = {
  _pages: {},
  register: function (name, fn) { this._pages[name] = fn; },
  navigate:  function () {}
};
/* PortfolioState: the selector block iterates state.branches */
window.PortfolioState = {
  branches: [{ id: 'test-branch', name: 'Elm Grove HOA', code: 'EG01', city: 'Chicago' }],
  groups:   []
};
/* VRTUtils.esc is optional — branch-detail.js falls back gracefully */
</script>

<!-- Load the real production script under test -->
<script src="/portfolio-static/pages/branch-detail.js"></script>

<script>
/* Kick off the page render once the script above has registered itself.
   By the time this inline script runs (blocking parse order), branch-detail.js
   has already called PortfolioRouter.register(), and #page-content is in the DOM. */
(function () {
  var fn = window.PortfolioRouter._pages['branch-detail'];
  if (fn) fn(document.getElementById('page-content'), { id: 'test-branch' });
})();
</script>
</body>
</html>`;

/** Returns the count of setCommunityOutline calls recorded in the iframe. */
async function outlineCallCount(iframeLocator: FrameLocator): Promise<number> {
  return iframeLocator
    .locator('body')
    .evaluate(
      () =>
        ((window as unknown as { receivedCmds: { fn: string }[] }).receivedCmds ?? []).filter(
          (c) => c.fn === 'setCommunityOutline',
        ).length,
    );
}

/**
 * Register all common route intercepts that every test needs:
 *  - The harness HTML at a stable path
 *  - The mock Leaflet iframe
 */
async function setupCommonRoutes(page: Page): Promise<void> {
  await page.route('**/test/branch-detail-harness', (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: HARNESS_HTML }),
  );
  await page.route('**/leaflet-map.html', (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: MOCK_LEAFLET_IFRAME }),
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Community boundary outline — branch detail tab switching', () => {

  test('setCommunityOutline is sent on load and after every tab switch', async ({ page }) => {
    await setupCommonRoutes(page);

    // Mock API: branch with outline + one service layer
    await page.route('**/api/portfolio/branches/test-branch', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(BRANCH_WITH_OUTLINE) }),
    );
    await page.route('**/api/portfolio/branches/test-branch/layers/layer-outline/geojson', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(OUTLINE_GEOJSON) }),
    );
    await page.route('**/api/portfolio/branches/test-branch/layers/layer-irrig/geojson', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(SERVICE_GEOJSON) }),
    );

    await page.goto('/test/branch-detail-harness');

    // Tab bar must appear before we interact
    await page.waitForSelector('#branch-tab-bar');

    // The shared iframe is mounted synchronously; wait for it to be visible
    await expect(page.locator('iframe.branch-map-iframe')).toBeVisible({ timeout: 10_000 });

    const iframe = page.frameLocator('iframe.branch-map-iframe');

    // ── 1. Initial load: Summary tab ──────────────────────────────────────
    // After mapReady fires (≈40 ms), branch-detail.js fetches GeoJSON for
    // all layers and then calls _pushOutline() → setCommunityOutline.
    await expect
      .poll(() => outlineCallCount(iframe), {
        timeout: 10_000,
        message: 'Expected setCommunityOutline to be sent on the initial Summary tab load',
      })
      .toBeGreaterThan(0);

    const afterSummaryLoad = await outlineCallCount(iframe);

    // ── 2. Switch to the Irrigation (service layer) tab ───────────────────
    await page.click('[data-tab-idx="1"]');

    await expect
      .poll(() => outlineCallCount(iframe), {
        timeout: 8_000,
        message: 'Expected setCommunityOutline after switching to the Irrigation tab',
      })
      .toBeGreaterThan(afterSummaryLoad);

    const afterLayerTab = await outlineCallCount(iframe);

    // ── 3. Switch back to Summary ─────────────────────────────────────────
    await page.click('[data-tab-idx="0"]');

    await expect
      .poll(() => outlineCallCount(iframe), {
        timeout: 8_000,
        message: 'Expected setCommunityOutline after switching back to Summary',
      })
      .toBeGreaterThan(afterLayerTab);
  });

  test('no outline layer: tab switches complete without JS errors and never send setCommunityOutline', async ({ page }) => {
    await setupCommonRoutes(page);

    // Mock API: branch WITHOUT an outline layer
    await page.route('**/api/portfolio/branches/test-branch', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(BRANCH_NO_OUTLINE) }),
    );
    await page.route('**/api/portfolio/branches/test-branch/layers/layer-irrig/geojson', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(SERVICE_GEOJSON) }),
    );

    const jsErrors: string[] = [];
    page.on('pageerror', (err) => jsErrors.push(err.message));

    await page.goto('/test/branch-detail-harness');
    await page.waitForSelector('#branch-tab-bar');
    await expect(page.locator('iframe.branch-map-iframe')).toBeVisible({ timeout: 10_000 });

    // Wait for mapReady + initial load to settle
    const iframe = page.frameLocator('iframe.branch-map-iframe');
    await expect
      .poll(() => outlineCallCount(iframe), { timeout: 6_000 })
      // 0 is the expected value — poll just lets async fetch settle
      .toBe(0);

    // Switch to Irrigation tab
    await page.click('[data-tab-idx="1"]');
    // Brief settle period; nothing async depends on outline here
    await page.waitForTimeout(1_500);

    // Switch back to Summary
    await page.click('[data-tab-idx="0"]');
    await page.waitForTimeout(1_000);

    // No JavaScript errors should have occurred
    expect(jsErrors, 'No JS errors expected when outline layer is absent').toHaveLength(0);

    // setCommunityOutline must never have been dispatched
    expect(
      await outlineCallCount(iframe),
      'setCommunityOutline must not be sent when there is no outline layer',
    ).toBe(0);
  });
});
