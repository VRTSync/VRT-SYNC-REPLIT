/**
 * layer-tab-maps.spec.ts
 *
 * Confirms two fixes introduced in Task 438:
 *
 *  1. Layer-tab maps render geometry (not a blank basemap) after the iframe is
 *     relocated.  The fix — calling invalidateSize before loading the tab — must
 *     be present; this test asserts that invalidateSize is dispatched on every
 *     tab switch.
 *
 *  2. Geometry is drawn in the admin-configured colour, not a hard-coded portal
 *     accent.  The API returns layer.color; the fix uses that value when building
 *     addLayers payloads.  This test asserts the recorded addLayers call carries
 *     the colour from the fixture, not any fallback.
 *
 * Strategy
 * ────────
 * • The real branch-detail.js is loaded from the running dev server so the test
 *   exercises the production code path without modification.
 * • All API calls and /leaflet-map.html are intercepted via page.route() so the
 *   test is fully deterministic — no database, no session, no Mapbox token.
 * • Command tracking is done at TWO levels:
 *   - Parent frame (_pageCmds): tracks all postMessages sent by branch-detail.js
 *     to the iframe's contentWindow.  Survives iframe reloads/reparenting because
 *     it lives in the parent page that never navigates.
 *   - Iframe frame (receivedCmds): only used for the initial Summary tab where the
 *     iframe has not yet been moved.
 * • Tab-switching correctness is also verified through DOM state (iframe slot,
 *   tab active class) which is independent of iframe reload behaviour.
 */

import { test, expect, type Page, type Frame } from '@playwright/test';

// ── Fixture data ─────────────────────────────────────────────────────────────

/** Admin-configured hex colours — deliberately non-accent values. */
const TREES_COLOR = '#c0392b'; // brick-red — matches no portal accent
const IRRIG_COLOR = '#27ae60'; // forest-green — matches no portal accent

/** Minimal GeoJSON polygon used as the community boundary outline. */
const OUTLINE_GEOJSON = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-87.62, 41.84], [-87.60, 41.84],
          [-87.60, 41.86], [-87.62, 41.86],
          [-87.62, 41.84],
        ]],
      },
      properties: {},
    },
  ],
};

/** Minimal GeoJSON point — one service-layer asset. */
const SERVICE_GEOJSON = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-87.61, 41.85] },
      properties: { label: 'Asset 1', featureId: 'a1' },
    },
  ],
};

/**
 * Branch with an outline layer, an irrigation layer and a trees layer.
 * Both service layers carry admin-configured `color` values so we can
 * assert they flow through unchanged.
 */
const BRANCH_DATA = {
  branch: {
    id: 'test-branch',
    name: 'Willow Creek HOA',
    code: 'WC01',
    address: '1 Willow Blvd',
    city: 'Chicago',
    groupIds: [],
  },
  layers: [
    { id: 'layer-outline', type: 'outline',    name: 'Community Boundary', assetCount: 0, hasGeometry: true, color: null        },
    { id: 'layer-irrig',   type: 'irrigation', name: 'Irrigation',         assetCount: 5, hasGeometry: true, color: IRRIG_COLOR },
    { id: 'layer-trees',   type: 'trees',      name: 'Trees',              assetCount: 3, hasGeometry: true, color: TREES_COLOR },
  ],
  recentServices: [],
  openWorkOrders: [],
  inventory:      [],
};

// ── Mock iframe ───────────────────────────────────────────────────────────────

/**
 * Minimal Leaflet iframe replacement.
 * Records every `cmd` postMessage in window.receivedCmds and signals readiness.
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
setTimeout(function () {
  window.parent.postMessage({ type: 'mapReady' }, '*');
}, 40);
</script>
</body></html>`;

// ── Test harness HTML ─────────────────────────────────────────────────────────

/**
 * Test harness HTML.
 *
 * Adds a parent-page level command interceptor (_pageCmds) that captures every
 * postMessage sent by branch-detail.js to the iframe's contentWindow.  This
 * survives iframe reloads/reparenting because it lives in the parent page that
 * never navigates.  The interceptor wraps iframe.contentWindow.postMessage via
 * the HTMLIFrameElement.prototype contentWindow getter.
 */
const HARNESS_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Layer-Tab Maps Harness</title></head>
<body>
<div id="page-content"></div>
<script>
/* ── Parent-level command capture ────────────────────────────────────────
 * Intercept every postMessage sent to the Leaflet iframe so we can verify
 * commands (invalidateSize, addLayers, showLayerIds, etc.) even when the
 * iframe reloads or is moved between DOM slots.
 */
window._pageCmds = [];

(function () {
  var origDescriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
  if (!origDescriptor) return;
  Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
    get: function () {
      var cw = origDescriptor.get.call(this);
      if (cw && !cw._vrt_patched) {
        try {
          var origPM = cw.postMessage.bind(cw);
          cw.postMessage = function (msg, target) {
            var parsed = msg;
            if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed); } catch (_) {} }
            if (parsed && parsed.type === 'cmd') {
              window._pageCmds.push({ fn: parsed.fn, args: JSON.parse(JSON.stringify(parsed.args || [])) });
            }
            return origPM(msg, target);
          };
          cw._vrt_patched = true;
        } catch (_) {}
      }
      return cw;
    },
    configurable: true,
  });
})();

/* ── Minimal stubs ──────────────────────────────────────────────────────── */
window.PortfolioRouter = {
  _pages: {},
  register: function (name, fn) { this._pages[name] = fn; },
  navigate:  function () {}
};
window.PortfolioState = {
  branches: [{ id: 'test-branch', name: 'Willow Creek HOA', code: 'WC01', city: 'Chicago' }],
  groups:   []
};
</script>
<script src="/common-static/map-render.js"></script>
<script src="/portfolio-static/pages/branch-detail.js"></script>
<script>
(function () {
  var fn = window.PortfolioRouter._pages['branch-detail'];
  if (fn) fn(document.getElementById('page-content'), { id: 'test-branch' });
})();
</script>
</body>
</html>`;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Register harness + mock-iframe routes. */
async function setupCommonRoutes(page: Page): Promise<void> {
  await page.route('**/test/layer-tab-maps-harness', (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: HARNESS_HTML }),
  );
  await page.route('**/leaflet-map.html', (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: MOCK_LEAFLET_IFRAME }),
  );
}

/** Register all GeoJSON routes for BRANCH_DATA. */
async function setupGeoRoutes(page: Page): Promise<void> {
  await page.route('**/api/portfolio/branches/test-branch', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(BRANCH_DATA) }),
  );
  await page.route('**/layers/layer-outline/geojson', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(OUTLINE_GEOJSON) }),
  );
  await page.route('**/layers/layer-irrig/geojson', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(SERVICE_GEOJSON) }),
  );
  await page.route('**/layers/layer-trees/geojson', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(SERVICE_GEOJSON) }),
  );
}

/**
 * Count commands with the given fn name in the PARENT page's _pageCmds array.
 * These are collected regardless of iframe reload/reparent behaviour.
 */
async function parentCmdCount(page: Page, fn: string): Promise<number> {
  return page.evaluate(
    (_fn) =>
      ((window as unknown as { _pageCmds: { fn: string }[] })._pageCmds ?? [])
        .filter((c) => c.fn === _fn).length,
    fn,
  );
}

/**
 * Return all addLayers payloads collected in _pageCmds on the parent page.
 * Each addLayers call passes args[0] = array of layer descriptors.
 */
async function getPageAddedLayers(page: Page): Promise<{ id: string; color: string }[]> {
  return page.evaluate(() => {
    type Cmd = { fn: string; args: unknown[] };
    const cmds = (window as unknown as { _pageCmds: Cmd[] })._pageCmds ?? [];
    const layers: { id: string; color: string }[] = [];
    cmds.forEach((c) => {
      if (c.fn === 'addLayers' && Array.isArray(c.args?.[0])) {
        (c.args[0] as { id: string; color: string }[]).forEach((l) => layers.push(l));
      }
    });
    return layers;
  });
}

/**
 * Return the id of the element that currently contains the shared iframe.
 * Returns null if the iframe is not found or has no parent with an id.
 */
async function iframeSlotId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const iframe = document.querySelector('iframe.branch-map-iframe') as HTMLIFrameElement | null;
    if (!iframe) return null;
    const parent = iframe.parentElement;
    return parent ? (parent.id || null) : null;
  });
}

// ── Standard load sequence shared by all tests ───────────────────────────────

async function loadAndWaitForSummary(page: Page): Promise<void> {
  await page.goto('/test/layer-tab-maps-harness');
  await page.waitForSelector('#branch-tab-bar');
  await expect(page.locator('iframe.branch-map-iframe')).toBeVisible({ timeout: 10_000 });

  // Wait for mapReady + initial Summary tab geometry to be pushed
  await expect
    .poll(() => parentCmdCount(page, 'addLayers'), { timeout: 10_000 })
    .toBeGreaterThan(0);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Layer-tab maps and admin colour rendering', () => {

  test('Summary tab shows geometry on initial load — dispatch and receipt verified', async ({ page }) => {
    await setupCommonRoutes(page);
    await setupGeoRoutes(page);
    await loadAndWaitForSummary(page);

    // ── Dispatch level (parent _pageCmds) ────────────────────────────────
    // Confirms branch-detail.js sent the commands to the iframe bridge.
    await expect
      .poll(() => parentCmdCount(page, 'addLayers'), {
        timeout: 10_000,
        message: 'Expected addLayers to be dispatched during the Summary tab initial load',
      })
      .toBeGreaterThan(0);

    await expect
      .poll(() => parentCmdCount(page, 'showLayerIds'), {
        timeout: 10_000,
        message: 'Expected showLayerIds to be dispatched during the Summary tab initial load',
      })
      .toBeGreaterThan(0);

    // ── Bridge receipt level (iframe receivedCmds) ───────────────────────
    // Confirms the iframe actually received the commands (not just dispatched).
    // This is safe before any tab switch because the iframe has not been
    // reparented yet and its JS state is intact.
    const iframe = page.frameLocator('iframe.branch-map-iframe');

    await expect
      .poll(
        () =>
          iframe.locator('body').evaluate(
            () =>
              ((window as unknown as { receivedCmds: { fn: string }[] }).receivedCmds ?? []).filter(
                (c) => c.fn === 'addLayers',
              ).length,
          ),
        {
          timeout: 8_000,
          message: 'Expected iframe to have received addLayers (bridge receipt check)',
        },
      )
      .toBeGreaterThan(0);

    // ── Admin colour verified at receipt level ───────────────────────────
    // Confirms the colour flowing into the iframe is the admin-configured value,
    // not a fallback accent — checks the data the map bridge actually rendered.
    const receivedLayers = await iframe.locator('body').evaluate(() => {
      type Cmd = { fn: string; args: unknown[] };
      const cmds = (window as unknown as { receivedCmds: Cmd[] }).receivedCmds ?? [];
      const layers: { id: string; color: string }[] = [];
      cmds.forEach((c) => {
        if (c.fn === 'addLayers' && Array.isArray(c.args?.[0])) {
          (c.args[0] as { id: string; color: string }[]).forEach((l) => layers.push(l));
        }
      });
      return layers;
    });

    // At least the irrigation layer must have been received
    const irrigReceived = receivedLayers.find((l) => l.id === 'layer-irrig');
    expect(irrigReceived, 'layer-irrig must appear in the iframe-received addLayers').toBeDefined();
    expect(
      irrigReceived?.color,
      `Irrigation layer colour received by iframe should be admin value ${IRRIG_COLOR}`,
    ).toBe(IRRIG_COLOR);
  });

  test('Clicking a layer tab sends invalidateSize (blank-basemap fix) and renders geometry', async ({ page }) => {
    await setupCommonRoutes(page);
    await setupGeoRoutes(page);
    await loadAndWaitForSummary(page);

    const invalidateBefore = await parentCmdCount(page, 'invalidateSize');
    const showBefore = await parentCmdCount(page, 'showLayerIds');

    // Click the Trees tab (tab-idx 2: Summary=0, Irrigation=1, Trees=2)
    await page.click('#branch-tab-bar [data-tab-idx="2"]');

    // invalidateSize must be dispatched on every tab switch so Leaflet
    // recalculates its container dimensions after the iframe is relocated.
    await expect
      .poll(() => parentCmdCount(page, 'invalidateSize'), {
        timeout: 8_000,
        message: 'Expected invalidateSize after clicking a layer tab (blank-basemap fix)',
      })
      .toBeGreaterThan(invalidateBefore);

    // showLayerIds must also be dispatched — geometry is visible, not a blank map
    await expect
      .poll(() => parentCmdCount(page, 'showLayerIds'), {
        timeout: 8_000,
        message: 'Expected showLayerIds after clicking the Trees layer tab',
      })
      .toBeGreaterThan(showBefore);

    // The iframe must remain in the stable slot — the iframe-stability fix
    // keeps a single iframe in #bmap-stable across tab switches.
    const slot = await iframeSlotId(page);
    expect(slot, 'Iframe must stay in the stable map slot after clicking Trees tab').toBe('bmap-stable');

    // The Trees tab must have the active class
    const treesTabActive = await page.locator('#branch-tab-bar [data-tab-idx="2"]').evaluate((el) =>
      el.classList.contains('on'),
    );
    expect(treesTabActive, 'Trees tab must have class "on" after being clicked').toBe(true);
  });

  test('Switching back to Summary after a layer tab still renders the map', async ({ page }) => {
    await setupCommonRoutes(page);
    await setupGeoRoutes(page);
    await loadAndWaitForSummary(page);

    // Switch to Irrigation tab
    await page.click('#branch-tab-bar [data-tab-idx="1"]');

    await expect
      .poll(() => parentCmdCount(page, 'invalidateSize'), {
        timeout: 8_000,
        message: 'Expected invalidateSize after switching to the Irrigation tab',
      })
      .toBeGreaterThan(0);

    const showAfterIrrig = await parentCmdCount(page, 'showLayerIds');

    // Switch back to Summary
    await page.click('#branch-tab-bar [data-tab-idx="0"]');

    // showLayerIds must fire again for the Summary tab
    await expect
      .poll(() => parentCmdCount(page, 'showLayerIds'), {
        timeout: 8_000,
        message: 'Expected showLayerIds when returning to Summary tab',
      })
      .toBeGreaterThan(showAfterIrrig);

    // The iframe must remain in the stable slot (never reparented)
    const slot = await iframeSlotId(page);
    expect(slot, 'Iframe must stay in the stable map slot').toBe('bmap-stable');

    // The Summary tab must have the active class
    const summaryTabActive = await page.locator('#branch-tab-bar [data-tab-idx="0"]').evaluate((el) =>
      el.classList.contains('on'),
    );
    expect(summaryTabActive, 'Summary tab must have class "on" after switching back').toBe(true);
  });

  test('addLayers uses admin-configured colour, not a hardcoded portal accent', async ({ page }) => {
    await setupCommonRoutes(page);
    await setupGeoRoutes(page);
    await loadAndWaitForSummary(page);

    // Wait for the Summary tab to have pushed both service layers
    await expect
      .poll(() => parentCmdCount(page, 'addLayers'), { timeout: 10_000 })
      .toBeGreaterThan(0);

    // Navigate to Trees tab so its layer is fetched and pushed if not already
    await page.click('#branch-tab-bar [data-tab-idx="2"]');
    await expect
      .poll(() => parentCmdCount(page, 'invalidateSize'), { timeout: 8_000 })
      .toBeGreaterThan(0);

    // Allow time for any async GeoJSON fetch and addLayers call to settle
    await page.waitForTimeout(1_000);

    const addedLayers = await getPageAddedLayers(page);

    // Every service layer with geometry must have been pushed at some point
    expect(addedLayers.length, 'At least the irrigation and trees layers must be in addLayers').toBeGreaterThanOrEqual(2);

    // Find each layer by id and assert its colour matches the admin-configured value
    const irrigLayer = addedLayers.find((l) => l.id === 'layer-irrig');
    const treesLayer = addedLayers.find((l) => l.id === 'layer-trees');

    expect(irrigLayer, 'layer-irrig must be present in addLayers').toBeDefined();
    expect(
      irrigLayer?.color,
      `Irrigation layer colour should be the admin value ${IRRIG_COLOR}, not a portal accent`,
    ).toBe(IRRIG_COLOR);

    expect(treesLayer, 'layer-trees must be present in addLayers').toBeDefined();
    expect(
      treesLayer?.color,
      `Trees layer colour should be the admin value ${TREES_COLOR}, not a portal accent`,
    ).toBe(TREES_COLOR);
  });

  test('late ready after a tab click restores the tab instead of resetting to Summary', async ({ page }) => {
    await setupCommonRoutes(page);

    // Branch data arrives immediately, but GeoJSON is delayed so the
    // renderer's 'ready' fires well AFTER the user has clicked a tab.
    await page.route('**/api/portfolio/branches/test-branch', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(BRANCH_DATA) }),
    );
    const delayed = (body: unknown) => async (route: import('@playwright/test').Route) => {
      await new Promise((r) => setTimeout(r, 1_200));
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    };
    await page.route('**/layers/layer-outline/geojson', delayed(OUTLINE_GEOJSON));
    await page.route('**/layers/layer-irrig/geojson', delayed(SERVICE_GEOJSON));
    await page.route('**/layers/layer-trees/geojson', delayed(SERVICE_GEOJSON));

    await page.goto('/test/layer-tab-maps-harness');
    await page.waitForSelector('#branch-tab-bar');

    // User clicks the Trees tab BEFORE the map data has loaded
    await page.click('#branch-tab-bar [data-tab-idx="2"]');
    await expect(page.locator('#branch-tab-bar [data-tab-idx="2"]')).toHaveClass(/on/);

    // Wait for the (late) ready — addLayers is only dispatched after it
    await expect
      .poll(() => parentCmdCount(page, 'addLayers'), { timeout: 15_000 })
      .toBeGreaterThan(0);
    await page.waitForTimeout(500); // let the ready handler settle

    // The late ready must NOT have reset the page back to Summary
    await expect(page.locator('#branch-tab-bar [data-tab-idx="2"]')).toHaveClass(/on/);
    const summaryOn = await page.locator('#branch-tab-bar [data-tab-idx="0"]').evaluate(
      (el) => el.classList.contains('on'),
    );
    expect(summaryOn, 'Summary tab must not be re-activated by a late ready').toBe(false);

    // The Trees sub-layer overlay must be populated (restored, not cleared)
    const overlayRows = await page.locator('#bmap-sublayer-overlay input[type="checkbox"]').count();
    expect(overlayRows, 'Sub-layer overlay must show the Trees layers after late ready').toBeGreaterThan(0);
  });

  test('sub-layer toggle fires exactly once and never refits the viewport', async ({ page }) => {
    await setupCommonRoutes(page);
    await setupGeoRoutes(page);
    await loadAndWaitForSummary(page);

    // Go to the Irrigation tab (idx 1) so the sub-layer overlay renders
    await page.click('#branch-tab-bar [data-tab-idx="1"]');
    await expect(page.locator('#bmap-sublayer-overlay input[type="checkbox"]').first())
      .toBeVisible({ timeout: 8_000 });
    await page.waitForTimeout(300); // let the tab-switch commands settle

    const fitCount = () =>
      page.evaluate(
        () => ((window as unknown as { _pageCmds: { fn: string }[] })._pageCmds ?? [])
          .filter((c) => c.fn === 'fitBounds' || c.fn === 'fitToOutline').length,
      );
    const fitsBefore = await fitCount();
    const showBefore = await parentCmdCount(page, 'showLayerIds');

    // Toggle one sub-layer checkbox
    await page.locator('#bmap-sublayer-overlay input[type="checkbox"]').first().click();
    await page.waitForTimeout(500);

    // Exactly ONE showLayerIds — a duplicated listener would dispatch two
    const showAfter = await parentCmdCount(page, 'showLayerIds');
    expect(showAfter - showBefore, 'Sub-layer toggle must dispatch exactly one showLayerIds').toBe(1);

    // No refit — the user's viewport must be preserved
    const fitsAfter = await fitCount();
    expect(fitsAfter - fitsBefore, 'Sub-layer toggle must not refit the viewport').toBe(0);
  });
});
