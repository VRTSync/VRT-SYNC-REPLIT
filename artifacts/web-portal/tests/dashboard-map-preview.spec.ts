/**
 * dashboard-map-preview.spec.ts
 *
 * Task 489 — Portfolio map preview on the dashboard.
 *
 * Verifies:
 *  • the bottom of the dashboard is a two-column row: Location Snapshot table
 *    plus a Portfolio Map panel with a "N locations" hint
 *  • pins go through the shared renderer path (addLayers cmd) with the same
 *    navy/amber colour treatment the Portfolio Map page uses, directTap set
 *  • interaction is disabled: a setInteractive(false) cmd is dispatched
 *  • viewport is fitted exactly once (fitBounds) to mapped locations only —
 *    branches without coordinates are absent from the pin payload
 *  • a compact legend lists each group with its mapped count
 *  • pin tap → branch-detail route; background map tap → map route
 *  • zero-mapped org → empty-state panel, no iframe, no console error
 *
 * All API calls and /leaflet-map.html are intercepted so the test is
 * deterministic — no DB, no session, no Mapbox token.
 */

import { test, expect, type Page } from '@playwright/test';

const USER = { user: { id: 'u1', username: 'ca', displayName: 'Client Admin', role: 'client_admin' } };

const PORTFOLIO_ME = {
  organization: { id: 'org1', name: 'Acme Properties' },
  branches: [],
  groups: [
    { id: 'g1', name: 'North' },
    { id: 'g2', name: 'South' },
  ],
};

const DASHBOARD = {
  totals: { branches: 3, assetsMapped: 10, servicesLogged: 12, photoProofPct: 90 },
  openWorkOrders: { total: 1, awaitingApproval: 0 },
  thisWeek: { weekStart: '2026-08-03', weekEnd: '2026-08-09', scheduled: 0, completed: 0, needsAttention: 0, days: [] },
  byGroup: [
    { groupId: 'g1', name: 'North', branches: 2, services: 8, openItems: 1, photoProofPct: 90 },
    { groupId: 'g2', name: 'South', branches: 1, services: 4, openItems: 0, photoProofPct: 100 },
  ],
};

// b3 has NO coordinates → must not be pinned; b2 has an open WO → amber
const BRANCHES = [
  { id: 'b1', code: 'N01', name: 'North Branch', city: 'Denver', groupIds: ['g1'], servicesYtd: 5, lastServiceAt: '2026-08-01', openWorkOrders: 0, lat: 39.7, lng: -104.9 },
  { id: 'b2', code: 'N02', name: 'North Annex',  city: 'Boulder', groupIds: ['g1'], servicesYtd: 3, lastServiceAt: '2026-08-01', openWorkOrders: 2, lat: 40.0, lng: -105.2 },
  { id: 'b3', code: 'S01', name: 'South Branch', city: 'Pueblo',  groupIds: ['g2'], servicesYtd: 4, lastServiceAt: '2026-07-20', openWorkOrders: 0, lat: null, lng: null },
];

/** Mock iframe: records cmds on the PARENT page (survives everything) and
 *  posts mapReady. Exposes triggers for assetTap/mapTap. */
const MOCK_LEAFLET_IFRAME = `<!DOCTYPE html><html><body><script>
  window.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'cmd') {
      parent._pageCmds = parent._pageCmds || [];
      parent._pageCmds.push({ fn: e.data.fn, args: e.data.args });
    }
  });
  window._tapAsset = function (ref) {
    parent.postMessage({ type: 'viewAssetDetail', data: { featureRef: ref } }, '*');
  };
  window._tapMap = function () {
    parent.postMessage({ type: 'mapTap', data: {} }, '*');
  };
  parent.postMessage({ type: 'mapReady' }, '*');
</script></body></html>`;

async function mockApis(page: Page, branches: unknown[]) {
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: USER }));
  await page.route('**/api/portfolio/me', (r) => r.fulfill({ json: PORTFOLIO_ME }));
  await page.route('**/api/portfolio/dashboard*', (r) => r.fulfill({ json: DASHBOARD }));
  await page.route('**/api/portfolio/branches*', (r) => r.fulfill({ json: branches }));
  await page.route('**/api/portfolio/work-orders*', (r) =>
    r.fulfill({ json: { pipeline: { awaitingApproval: 0 }, open: [], closed: [], cancelled: [] } }),
  );
  await page.route('**/leaflet-map.html', (r) =>
    r.fulfill({ contentType: 'text/html; charset=utf-8', body: MOCK_LEAFLET_IFRAME }),
  );
}

async function openDashboard(page: Page, branches: unknown[]) {
  await mockApis(page, branches);
  const fs = await import('fs');
  const shell = fs.readFileSync('templates/portfolio-shell.html', 'utf-8');
  await page.route('**/web/portfolio/**', (r) =>
    r.fulfill({ contentType: 'text/html', body: shell }),
  );
  await page.goto('/web/portfolio/dashboard');
  await expect(page.locator('.dash-bottom')).toBeVisible();
}

type Cmd = { fn: string; args: unknown[] };
async function cmds(page: Page): Promise<Cmd[]> {
  return page.evaluate(() => (window as unknown as { _pageCmds?: Cmd[] })._pageCmds ?? []);
}

test('map panel renders via shared renderer: pins, colours, fit-once, non-interactive, legend', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await openDashboard(page, BRANCHES);

  // Two-column bottom row: snapshot panel + map panel
  await expect(page.locator('.dash-bottom .panel.p-navy h2')).toHaveText('Location Snapshot');
  await expect(page.locator('#dash-map-panel .panel-head h2')).toHaveText('Portfolio Map');
  // Hint counts mapped locations only (2 of 3 have coordinates)
  await expect(page.locator('#dash-map-panel .hint')).toHaveText('2 locations');

  // Wait for pin push
  await expect.poll(async () => (await cmds(page)).filter((c) => c.fn === 'addLayers').length).toBe(1);
  const all = await cmds(page);

  // Interaction disabled explicitly
  const si = all.filter((c) => c.fn === 'setInteractive');
  expect(si.length).toBe(1);
  expect(si[0].args[0]).toBe(false);

  // Shared pin layer: 2 mapped pins, navy/amber colour map, directTap on
  const layer = (all.find((c) => c.fn === 'addLayers')!.args[0] as any[])[0];
  expect(layer.geojson.features.map((f: any) => f.id).sort()).toEqual(['b1', 'b2']);
  expect(layer.controllerColorMap).toEqual({ b1: '#0C1D31', b2: '#f59e0b' });
  expect(layer.directTap).toBe(true);

  // Fit exactly once, to the two mapped points
  const fits = all.filter((c) => c.fn === 'fitBounds');
  expect(fits.length).toBe(1);
  expect(fits[0].args[0]).toEqual([[39.7, -104.9], [40.0, -105.2]]);

  // Legend: group names with mapped counts + open-work-order key
  const legend = page.locator('#dash-map-legend');
  await expect(legend).toContainText('North');
  await expect(legend).toContainText('Open work order');
  await expect(legend).not.toContainText('South'); // its only branch is unmapped

  expect(errors).toEqual([]);
});

test('pin tap navigates to branch detail; background tap opens Portfolio Map', async ({ page }) => {
  await openDashboard(page, BRANCHES);
  await expect.poll(async () => (await cmds(page)).filter((c) => c.fn === 'addLayers').length).toBe(1);

  const iframe = page.frameLocator('#dash-map-iframe');
  // Pin tap → branch-detail
  await iframe.locator('body').evaluate(() => (window as any)._tapAsset('b2'));
  await expect(page).toHaveURL(/branch-detail/);

  // Back to dashboard, background tap → map route
  await page.goto('/web/portfolio/dashboard');
  await expect.poll(async () => (await cmds(page)).filter((c) => c.fn === 'addLayers').length).toBeGreaterThan(0);
  await page.frameLocator('#dash-map-iframe').locator('body').evaluate(() => (window as any)._tapMap());
  await expect(page).toHaveURL(/\/web\/portfolio\/map/);
});

test('org with zero mapped locations shows empty-state panel, no iframe, no errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  const unmappedOnly = BRANCHES.map((b) => ({ ...b, lat: null, lng: null }));
  await openDashboard(page, unmappedOnly);

  await expect(page.locator('#dash-map-panel .hint')).toHaveText('0 locations');
  await expect(page.locator('#dash-map-panel .pf-empty')).toBeVisible();
  await expect(page.locator('#dash-map-iframe')).toHaveCount(0);
  expect(errors).toEqual([]);
});
