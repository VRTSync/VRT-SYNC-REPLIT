import { test, expect, type Page } from '@playwright/test';

// Real scripts and the real login response CSP; fixture APIs do not require
// production data or mutate an installed catalogue.
async function harness(page: Page, portal = false) {
  await page.goto('/web/login');
  await page.evaluate(() => {
    document.body.innerHTML = '<main id="page-content"></main>';
    const w = window as any;
    w.calls = [];
    w.pages = {};
    w.AdminRouter = w.PortalRouter = {
      register: (name: string, fn: unknown) => { w.pages[name] = fn; },
      navigate: (...args: unknown[]) => w.calls.push(['navigate', ...args]),
      refresh: () => w.calls.push(['refresh']),
    };
    w.AdminState = { getCommunities: () => [{ id: 'c1', name: 'North & South' }] };
    w.PortalState = { getCommunityContext: () => ({
      role: 'hoa_admin', activeCommunity: { id: 'c1', name: 'North & South' },
    }) };
    w.AdminAPI = {
      showToast: () => {},
      apiFetch: async (url: string, options: any) => {
        w.calls.push(['api', url, options]);
        if (url.startsWith('/api/users')) return [{ id: 'u1', displayName: 'Crew & Co' }];
        if (url.startsWith('/api/asset-types')) {
          if (options?.method === 'PATCH') return { isActive: true };
          if (options?.method === 'DELETE') return {};
          return [{ key: 'test_type', label: 'Test Type', layerKey: 'snow', subLayerKey: 'test', isActive: true }];
        }
        if (url.startsWith('/api/invoices')) return [{
          id: 'i1', communityId: 'c1', contractor: 'Crew', completionDate: '2026-11-01', serviceType: 'Mowing', cost: 50,
        }];
        return [];
      },
    };
    w.PortalAPI = { apiFetch: async () => { throw new Error('Fixture retry'); } };
  });
  await page.addScriptTag({ url: '/common-static/utils.js' });
  if (portal) await page.addScriptTag({ url: '/portal-static/portal-modules.js' });
}

test('login reset panel opens, closes, and ignores clicks inside the panel', async ({ page }) => {
  await page.goto('/web/login');
  await page.locator('#fpOpen').click();
  await expect(page.locator('#fpBackdrop')).toBeVisible();
  await page.locator('#fpModal h3').click();
  await expect(page.locator('#fpBackdrop')).toBeVisible();
  await page.locator('#fpClose').click();
  await expect(page.locator('#fpBackdrop')).toBeHidden();
  await page.locator('#fpOpen').click();
  await page.locator('#fpBackdrop').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('#fpBackdrop')).toBeHidden();
  await page.locator('#fpOpen').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#fpBackdrop')).toBeHidden();
});

test('admin invoice and contract helpers initialize before populated filters render', async ({ page }) => {
  await harness(page);
  for (const route of ['invoices', 'contracts']) {
    await page.addScriptTag({ url: `/admin-static/pages/${route}.js` });
    await page.evaluate(async route => (window as any).pages[route](document.querySelector('main')), route);
    await expect(page.locator('h1')).toHaveText(route === 'invoices' ? 'Invoices' : 'Contracts');
  }
  await page.evaluate(() => (window as any).pages.invoices(document.querySelector('main')));
  await expect(page.locator('#invoices-tbody')).toContainText('Crew');
  await page.locator('#inv-community-filter').selectOption('c1');
  await expect.poll(() => page.evaluate(() => (window as any).calls.at(-1)[1])).toBe('/api/invoices?communityId=c1');
});

test('asset type row actions survive rerenders and retain the deactivation confirmation', async ({ page }) => {
  await harness(page);
  await page.addScriptTag({ url: '/admin-static/pages/asset-types.js' });
  await page.evaluate(() => (window as any).pages['asset-types'](document.querySelector('main')));
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.locator('#modal-title')).toHaveText('Edit: test_type');
  await page.locator('#modal-cancel').click();
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Deactivate', exact: true }).click();
  expect(await page.evaluate(() => (window as any).calls.filter((c: any) => c[2]?.method === 'DELETE').length)).toBe(0);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Deactivate', exact: true }).click();
  await page.locator('#status-filter').selectOption('all');
  await page.getByRole('button', { name: 'Reactivate', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Deactivate', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).calls.filter((c: any) => c[2]?.method === 'DELETE').length)).toBe(1);
  expect(await page.evaluate(() => (window as any).calls.filter((c: any) => c[2]?.method === 'PATCH').length)).toBe(1);
});

test('dashboard delegation preserves params, propagation, guards, keyboard and rerenders', async ({ page }) => {
  await harness(page, true);
  await page.addScriptTag({ url: '/portal-static/pages/dashboard.js' });
  await page.evaluate(() => {
    const w = window as any;
    w.draw = () => {
      document.querySelector('main')!.innerHTML =
        w._renderServiceDayWidget([], [], {}) +
        w._renderWaterUsageWidget([]) +
        w._renderAttentionRequired([{ id: "task'1", reason: 'Overdue', label: 'Late', color: 'red' }], {}) +
        w.PortalModules.quickLinksModule({ title: 'Links', links: [{ label: 'Map', route: 'map' }, { label: 'Disabled' }] }) +
        '<button data-portal-action="new-request">New request</button>';
      document.querySelector('.cc-widget--water')!.addEventListener('click', () => w.calls.push(['parent']));
    };
    w.draw();
    w.openTaskDetail = (id: string) => w.calls.push(['task', id]);
  });
  await page.locator('.cc-widget--service').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Space');
  await page.locator('.cc-attn-row').focus();
  await page.keyboard.press('Space');
  await page.getByRole('button', { name: 'View Report' }).click();
  await page.evaluate(() => { delete (window as any).openNewRequestForm; });
  await page.getByRole('button', { name: 'New request' }).click(); // missing global is guarded
  await page.evaluate(() => { (window as any).openNewRequestForm = () => (window as any).calls.push(['new']); });
  await page.getByRole('button', { name: 'New request' }).click();
  await page.evaluate(() => { for (let i = 0; i < 10; i++) (window as any).draw(); });
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Disabled' })).toBeDisabled();
  expect(await page.evaluate(() => (window as any).calls)).toEqual([
    ['navigate', 'service-schedule', true, {}], ['navigate', 'service-schedule', true, {}],
    ['task', "task'1"], ['navigate', 'reports', true, { report: 'water-usage' }],
    ['new'], ['navigate', 'map', true, {}],
  ]);
  // Keyboard role buttons must cancel the browser's Space scroll default.
  expect(await page.locator('.cc-attn-row').evaluate(el => !el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })))).toBe(true);
});

test('dashboard request action opens the existing Requests form through its real helper', async ({ page }) => {
  await harness(page, true);
  await page.addScriptTag({ url: '/portal-static/pages/requests.js' });
  await page.evaluate(() => {
    const w = window as any;
    w.PortalAPI.apiFetch = async () => [];
    w.PortalRouter.navigate = (...args: unknown[]) => {
      w.calls.push(['navigate', ...args]);
      w.pages.requests(document.querySelector('main'));
    };
    document.querySelector('main')!.innerHTML =
      '<button data-portal-action="new-request">New request</button>';
  });
  await page.getByRole('button', { name: 'New request' }).click();
  await expect(page.locator('#req-form-overlay')).toBeVisible();
  expect(await page.evaluate(() => (window as any).calls)).toEqual([['navigate', 'requests', true, {}]]);
  expect(await page.evaluate(() => (window as any)._pendingOpenNewRequest)).toBe(false);
  await page.locator('#req-cancel').click();
  await expect(page.locator('#req-form-overlay')).toBeHidden();
});

for (const route of ['tasks', 'requests', 'invoices']) {
  test(`${route} retry delegates exactly once after repeated renders`, async ({ page }) => {
    await harness(page, true);
    await page.addScriptTag({ url: `/portal-static/pages/${route}.js` });
    await page.evaluate(async route => {
      for (let i = 0; i < 3; i++) await (window as any).pages[route](document.querySelector('main'));
    }, route);
    await page.getByRole('button', { name: 'Retry' }).click();
    expect(await page.evaluate(() => (window as any).calls)).toEqual([['refresh']]);
  });
}
