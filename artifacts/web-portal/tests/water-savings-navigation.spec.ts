import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const shell = readFileSync('templates/portfolio-shell.html', 'utf8');
const mapFrame = `<!doctype html><html><body><script>
window.commands=[];
addEventListener('message',function(event){var msg=event.data;if(msg&&msg.type==='cmd')window.commands.push(msg);});
window.tap=function(id){parent.postMessage({type:'viewAssetDetail',data:{featureRef:id,featureId:id}},'*')};
setTimeout(function(){parent.postMessage({type:'mapReady'},'*')},20);
</script></body></html>`;

const summary = {
  communities: [
    { id: 'c1', code: 'N01', name: 'North', city: 'Denver', turf: { sqFtResolved: 1000 } },
    { id: 'c2', code: 'S01', name: 'South', city: 'Aurora', turf: { sqFtResolved: 500 } },
  ],
  totals: { assetsFound: 2, featuresResolved: 2, sqFtResolved: 1500, unresolvedCount: 0 },
};
const polygons = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', id: 'p1', geometry: { type: 'Polygon', coordinates: [[[-105,40],[-105,40.01],[-104.99,40],[-105,40]]] }, properties: { id: 'p1', name: 'North Lawn', area_sqft: 1000, communityId: 'c1', communityName: 'North', isRankable: true } },
    { type: 'Feature', id: 'p2', geometry: { type: 'Polygon', coordinates: [[[-105,39.9],[-105,39.91],[-104.99,39.9],[-105,39.9]]] }, properties: { id: 'p2', name: 'South Lawn', area_sqft: 500, communityId: 'c2', communityName: 'South', isRankable: true } },
  ],
  byCommunity: [],
  unresolved: [],
  assetsFound: 2,
  featuresResolved: 2,
  sqFtResolved: 1500,
};

async function setup(page: Page) {
  let savedScenarios: any[] = [];
  await page.route('**/web/portfolio/**', route => route.fulfill({ contentType: 'text/html', body: shell }));
  await page.route('**/leaflet-map.html', route => route.fulfill({ contentType: 'text/html', body: mapFrame }));
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: { id: 'u1', role: 'client_admin', displayName: 'Client Admin' } } }));
  await page.route('**/api/portfolio/me', route => route.fulfill({ json: { organization: { id: 'o1', name: 'Acme' }, branches: summary.communities, groups: [], groupSets: [] } }));
  await page.route('**/api/portfolio/work-orders**', route => route.fulfill({ json: { pipeline: { awaitingApproval: 0 }, open: [], closed: [], cancelled: [] } }));
  await page.route('**/api/portfolio/water-savings**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/scenarios')) {
      if (request.method() === 'POST') {
        const body = request.postDataJSON();
        const record = { id: 's1', ...body, assumptionsJson: body.assumptions, pinsJson: body.pins };
        savedScenarios = [record];
        return route.fulfill({ status: 201, json: record });
      }
      return route.fulfill({ json: savedScenarios });
    }
    if (path.includes('/scenarios/')) return route.fulfill({ json: [] });
    if (path.endsWith('/polygons')) return route.fulfill({ json: polygons });
    return route.fulfill({ json: summary });
  });
}

test('summary and location share state, preserve history, and keep parent nav active', async ({ page }) => {
  await setup(page);
  await page.goto('/web/portfolio/water-savings');
  await expect(page.getByRole('heading', { name: 'Water Savings Planner' })).toBeVisible();
  await expect(page.locator('.ws-location-tile')).toHaveCount(2);

  await page.locator('#ws-target').evaluate((input: HTMLInputElement) => {
    input.value = '0';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.locator('.ws-location-tile[data-community-id="c1"]').click();
  await expect(page).toHaveURL(/water-savings-location\/c1/);
  await expect(page.locator('.side-nav [data-route="water-savings"]')).toHaveClass(/active/);
  await expect(page.locator('.wsl-rail')).toHaveCSS('width', '320px');
  const mapCommands = await page.frameLocator('#wsl-map').locator('body').evaluate(() => (window as any).commands);
  expect(mapCommands.some((command: any) => command.fn === 'fitBounds')).toBe(true);
  const addLayers = mapCommands.find((command: any) => command.fn === 'addLayers');
  expect(addLayers.args[0][0].directTap).toBe(true);

  const before = await page.locator('#wsl-metrics').textContent();
  await page.frameLocator('#wsl-map').locator('body').evaluate(() => (window as any).tap('p1'));
  await expect.poll(() => page.evaluate(() => (window as any).VRTWaterScenario.get().pins.p1)).toBe('in');
  const after = await page.locator('#wsl-metrics').textContent();
  expect(after).not.toBe(before);

  await page.locator('.wsl-back').click();
  await expect(page).toHaveURL(/\/water-savings$/);
  expect(await page.evaluate(() => (window as any).VRTWaterScenario.get().targetPct)).toBe(0);
  expect(await page.evaluate(() => (window as any).VRTWaterScenario.get().pins.p1)).toBe('in');

  await page.goBack();
  await expect(page).toHaveURL(/water-savings-location\/c1/);
  await expect(page.locator('.side-nav [data-route="water-savings"]')).toHaveClass(/active/);
});

test('list and map share the three-state cycle and expose override counts', async ({ page }) => {
  await setup(page);
  await page.goto('/web/portfolio/water-savings');
  await page.locator('#ws-target').evaluate((input: HTMLInputElement) => {
    input.value = '0';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.locator('.ws-location-tile[data-community-id="c1"]').click();
  await expect(page.locator('.wsl-area-row')).toHaveCount(1);
  await expect(page.locator('.wsl-legend')).toContainText('Pinned in');
  await expect(page.locator('.wsl-legend')).toContainText('Solver-selected');
  await expect(page.locator('.wsl-legend')).toContainText('Available');
  await expect(page.locator('.wsl-legend')).toContainText('Pinned out');

  const initialMetrics = await page.locator('#wsl-metrics').textContent();
  await page.locator('[data-area-id="p1"]').click();
  await expect(page.locator('[data-area-id="p1"]')).toHaveClass(/pinned-in/);
  await expect(page.locator('[data-area-id="p1"]')).toContainText('Pinned in');
  await expect(page.locator('#wsl-override-counts')).toContainText('1 pinned in');
  expect(await page.locator('#wsl-metrics').textContent()).not.toBe(initialMetrics);
  await expect.poll(() => page.frameLocator('#wsl-map').locator('body').evaluate(() => {
    const updates = (window as any).commands.filter((command: any) => command.fn === 'updateLayerColorMap');
    return updates.at(-1)?.args[1]?.p1;
  })).toBe('#10b981');

  await page.frameLocator('#wsl-map').locator('body').evaluate(() => (window as any).tap('p1'));
  await expect(page.locator('[data-area-id="p1"]')).toHaveClass(/pinned-out/);
  await expect(page.locator('[data-area-id="p1"]')).toContainText('Pinned out');
  await expect(page.locator('#wsl-override-counts')).toContainText('1 excluded');
  await expect.poll(() => page.frameLocator('#wsl-map').locator('body').evaluate(() => {
    const updates = (window as any).commands.filter((command: any) => command.fn === 'updateLayerColorMap');
    return updates.at(-1)?.args[1]?.p1;
  })).toBe('#64748b');

  await page.frameLocator('#wsl-map').locator('body').evaluate(() => (window as any).tap('p1'));
  await expect(page.locator('[data-area-id="p1"]')).toHaveClass(/available/);
  await expect(page.locator('[data-area-id="p1"]')).toContainText('Available');
  await expect(page.locator('#wsl-override-counts')).toContainText('0 pinned in');
  await expect(page.locator('#wsl-override-counts')).toContainText('0 excluded');
  expect(await page.evaluate(() => (window as any).VRTWaterScenario.get().pins.p1)).toBeUndefined();
  await expect.poll(() => page.frameLocator('#wsl-map').locator('body').evaluate(() => {
    const updates = (window as any).commands.filter((command: any) => command.fn === 'updateLayerColorMap');
    return updates.at(-1)?.args[1]?.p1;
  })).toBe('#7eb8e0');
});

test('target changes preserve both override directions and saved scenarios reload them', async ({ page }) => {
  await setup(page);
  await page.goto('/web/portfolio/water-savings');
  await page.locator('#ws-target').evaluate((input: HTMLInputElement) => {
    input.value = '0';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.locator('.ws-location-tile[data-community-id="c1"]').click();

  await page.locator('[data-area-id="p1"]').click();
  await page.locator('.wsl-back').click();
  await expect(page).toHaveURL(/\/water-savings$/);
  await page.locator('#ws-target').evaluate((input: HTMLInputElement) => {
    input.value = '100';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.locator('.ws-location-tile[data-community-id="c1"]').click();
  await expect(page.locator('[data-area-id="p1"]')).toHaveClass(/pinned-in/);

  await page.locator('[data-area-id="p1"]').click();
  await expect(page.locator('[data-area-id="p1"]')).toHaveClass(/pinned-out/);
  await page.locator('.wsl-back').click();
  await page.locator('#ws-target').evaluate((input: HTMLInputElement) => {
    input.value = '0';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.locator('.ws-location-tile[data-community-id="c2"]').click();
  await page.locator('[data-area-id="p2"]').click();
  await expect(page.locator('[data-area-id="p2"]')).toHaveClass(/pinned-in/);
  await page.locator('.wsl-back').click();
  await page.locator('#ws-save').click();
  await expect(page.locator('.ws-save-state')).toHaveClass(/saved/);
  await expect(page.locator('#ws-scenario-select')).toHaveValue('s1');

  await page.locator('#ws-new').click();
  expect(await page.evaluate(() => (window as any).VRTWaterScenario.get().pins)).toEqual({});
  await page.locator('#ws-scenario-select').selectOption('s1');
  await expect.poll(() => page.evaluate(() => (window as any).VRTWaterScenario.get().pins.p1)).toBe('out');
  expect(await page.evaluate(() => (window as any).VRTWaterScenario.get().pins.p2)).toBe('in');
  await page.locator('.ws-location-tile[data-community-id="c1"]').click();
  await expect(page.locator('[data-area-id="p1"]')).toHaveClass(/pinned-out/);

  await page.locator('#wsl-clear').click();
  await expect(page.locator('#wsl-override-counts')).toContainText('0 pinned in');
  await expect(page.locator('#wsl-override-counts')).toContainText('0 excluded');
  expect(await page.evaluate(() => (window as any).VRTWaterScenario.get().pins)).toEqual({ p2: 'in' });
  await page.locator('#wsl-location-select').selectOption('c2');
  await expect(page.locator('[data-area-id="p2"]')).toHaveClass(/pinned-in/);
  await page.locator('#wsl-clear').click();
  expect(await page.evaluate(() => (window as any).VRTWaterScenario.get().pins)).toEqual({});
  const targetAfterReload = await page.evaluate(() => (window as any).VRTWaterScenario.get().targetPct);
  expect(targetAfterReload).toBe(0);
});

test('summary leads with cost effectiveness, live assumptions, tiers, attainment, and proportional overview', async ({ page }) => {
  await setup(page);
  await page.goto('/web/portfolio/water-savings');

  const labels = await page.locator('.ws-kpi').evaluateAll((cards) =>
    cards.map((card) => card.querySelector('span')?.textContent?.trim()),
  );
  expect(labels).toEqual([
    'Gallons avoided',
    'Cost per 1,000 gal avoided',
    'Annual savings',
    'Net capital cost',
    'Payback',
  ]);
  await expect(page.locator('[data-kpi="cost-per-1000"]')).toHaveClass(/hero/);
  await expect(page.locator('[data-kpi="payback"]')).toHaveClass(/quiet/);
  await expect(page.locator('#ws-attainment')).toContainText('Target met');
  await expect(page.locator('#ws-attainment')).toContainText('1 area across 1 location');
  await expect(page.locator('.ws-honesty')).toContainText('Modelled, not metered');
  await expect(page.locator('.ws-honesty')).toContainText('load water invoices to calibrate against actual consumption per branch');

  const initialComparison = await page.locator('[data-kpi="cost-per-1000"] small').textContent();
  await page.locator('[data-assumption="waterRatePerKGal"]').fill('12.08');
  await page.locator('[data-assumption="waterRatePerKGal"]').press('Tab');
  await expect(page.locator('[data-kpi="cost-per-1000"] small')).not.toHaveText(initialComparison || '');
  await expect(page.locator('[data-kpi="cost-per-1000"] small')).toContainText('cheaper than buying it');

  await page.locator('.ws-tier-card[data-tier="colorado"]').click();
  await expect(page.locator('.ws-tier-card[data-tier="colorado"]')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => (window as any).VRTWaterScenario.get().assumptions)).toMatchObject({
    costPerSf: 10,
    rebatePerSf: 3.25,
  });
  await page.locator('[data-assumption="costPerSf"]').fill('11');
  await page.locator('[data-assumption="costPerSf"]').press('Tab');
  await expect(page.locator('.ws-tier-card[data-tier="colorado"]')).toHaveClass(/modified/);

  const initialShares = await page.locator('.ws-overview-block').evaluateAll((blocks) =>
    blocks.map((block) => ({
      grow: (block as HTMLElement).style.flexGrow,
      share: block.getAttribute('data-plan-share'),
    })),
  );
  expect(initialShares).toEqual([
    { grow: '1000', share: '100' },
    { grow: '500', share: '0' },
  ]);

  await page.locator('#ws-target').fill('100');
  await page.locator('#ws-target').press('Tab');
  await expect(page.locator('#ws-attainment')).toContainText('2 areas across 2 locations');
  await expect(page.locator('#ws-attainment')).toContainText('100.0% reduction');
  await expect(page.locator('.ws-overview-block[data-community-id="c1"]')).toHaveAttribute('data-plan-share', '100');
  await expect(page.locator('.ws-overview-block[data-community-id="c2"]')).toHaveAttribute('data-plan-share', '100');
});