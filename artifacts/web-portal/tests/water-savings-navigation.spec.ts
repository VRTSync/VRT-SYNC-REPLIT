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
        return route.fulfill({ status: 201, json: { id: 's1', ...body, assumptionsJson: body.assumptions, pinsJson: body.pins } });
      }
      return route.fulfill({ json: [] });
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
    input.value = '60';
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
  await expect.poll(() => page.evaluate(() => (window as any).VRTWaterScenario.get().pins.p1)).toBe('out');
  const after = await page.locator('#wsl-metrics').textContent();
  expect(after).not.toBe(before);

  await page.locator('.wsl-back').click();
  await expect(page).toHaveURL(/\/water-savings$/);
  expect(await page.evaluate(() => (window as any).VRTWaterScenario.get().targetPct)).toBe(60);
  expect(await page.evaluate(() => (window as any).VRTWaterScenario.get().pins.p1)).toBe('out');

  await page.goBack();
  await expect(page).toHaveURL(/water-savings-location\/c1/);
  await expect(page.locator('.side-nav [data-route="water-savings"]')).toHaveClass(/active/);
});