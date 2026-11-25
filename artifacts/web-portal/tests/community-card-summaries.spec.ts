import { test, expect, type Page } from '@playwright/test';

async function harness(page: Page, failure = '') {
  await page.goto('/web/login');
  await page.evaluate(failure => {
    document.body.innerHTML = '<main></main>';
    const w = window as any;
    w.calls = [];
    w.communities = [
      { id: 'one', name: 'North', description: 'Gardens', organizationId: 'org', createdAt: '2026-01-01' },
      { id: 'two', name: 'South', description: '', createdAt: '2026-01-01' },
    ];
    w.AdminRouter = {
      register: (_name: string, fn: unknown) => { w.render = fn; },
      navigate: (...args: unknown[]) => w.calls.push(['navigate', ...args]),
    };
    w.AdminState = { refreshCommunities: async () => w.calls.push(['refresh']) };
    w.AdminAPI = {
      showToast: (...args: unknown[]) => w.calls.push(['toast', ...args]),
      apiFetch: async (url: string, options: any) => {
        w.calls.push(['api', url, options]);
        if (url === failure) throw new Error('Fixture failure');
        if (url === '/api/admin/community-summaries' && w.failSummary) throw new Error('Fixture failure');
        if (options) {
          if (options.method === 'POST') w.communities.push({ id: 'new', ...options.body, createdAt: '2026-01-01' });
          else Object.assign(w.communities.find((c: any) => url.endsWith('/' + c.id)), options.body);
          return {};
        }
        if (url === '/api/communities') return w.communities;
        if (url === '/api/admin/organizations') return [{ id: 'org', name: 'Organization' }];
        if (url === '/api/admin/community-summaries') return {
          two: { activeAssetsCount: 0, tasksCount: 0, mapLayersCount: 0, membersCount: 0 },
          one: { activeAssetsCount: 7, tasksCount: 3, mapLayersCount: 2, membersCount: 0 },
        };
        throw new Error('Unexpected API: ' + url);
      },
    };
  }, failure);
  await page.addScriptTag({ url: '/common-static/utils.js' });
  await page.addScriptTag({ url: '/admin-static/pages/communities.js' });
  await page.evaluate(() => (window as any).render(document.querySelector('main')));
}

test('cards merge summaries by id with three requests and preserve filtering and View navigation', async ({ page }) => {
  await harness(page);
  const card = page.locator('[data-id="one"].community-card');
  await expect(card).toContainText('7 assets');
  await expect(card).toContainText('3 tasks');
  await expect(card).toContainText('2 layers');
  await expect(card).toContainText('0 members');
  await expect(card.locator('.community-org-chip')).toHaveText('Organization');
  await expect(page.locator('[data-id="two"].community-card')).toContainText('0 assets');
  expect(await page.evaluate(() => (window as any).calls.filter((c: any) => c[0] === 'api').map((c: any) => c[1]))).toEqual([
    '/api/communities', '/api/admin/organizations', '/api/admin/community-summaries',
  ]);
  await page.locator('#communities-search').fill('gardens');
  await expect(page.locator('.community-card')).toHaveCount(1);
  await page.locator('#communities-search').fill('missing');
  await expect(page.locator('.empty-state')).toContainText('No communities match');
  await page.locator('#communities-search').fill('');
  await card.locator('.community-card-arrow').click();
  expect(await page.evaluate(() => (window as any).calls.at(-1))).toEqual([
    'navigate', 'community-detail', true, { id: 'one', tab: 'overview' },
  ]);
});

test('create and edit controls save and reload once without navigating', async ({ page }) => {
  await harness(page);
  await page.locator('[data-id="one"].edit-btn').click();
  await expect(page.locator('.modal h2')).toHaveText('Edit Community');
  await expect(page.locator('#modal-name')).toHaveValue('North');
  await page.locator('#modal-name').fill('Updated');
  await page.locator('.save-btn').click();
  await expect(page.locator('.modal')).toHaveCount(0);
  await expect(page.locator('[data-id="one"].community-card h3')).toHaveText('Updated');
  await page.locator('#add-community-btn').click();
  await page.locator('#modal-name').fill('Created');
  await page.locator('.save-btn').click();
  await expect(page.locator('[data-id="new"].community-card')).toContainText('Created');
  const calls = await page.evaluate(() => (window as any).calls);
  expect(calls.filter((c: any) => c[0] === 'navigate')).toHaveLength(0);
  expect(calls.filter((c: any) => c[1] === '/api/admin/community-summaries')).toHaveLength(3);
  expect(calls.filter((c: any) => c[2]?.method === 'PATCH')[0][2].body).toEqual({ name: 'Updated', description: 'Gardens' });
  expect(calls.filter((c: any) => c[2]?.method === 'POST')[0][2].body).toEqual({ name: 'Created', description: null });
});

test('failed summaries render zero counts on every card and clear previous successful counts', async ({ page }) => {
  await harness(page);
  await page.evaluate(async () => {
    (window as any).failSummary = true;
  });
  await page.locator('[data-id="one"].edit-btn').click();
  await page.locator('.save-btn').click();
  await expect(page.locator('.modal')).toHaveCount(0);
  for (const label of ['Assets', 'Tasks', 'Layers', 'Members']) {
    await expect(page.locator(`[title="${label}"]`)).toHaveText([`0 ${label.toLowerCase()}`, `0 ${label.toLowerCase()}`]);
  }
  await expect(page.locator('.community-card')).toHaveCount(2);
});

test('organization failure keeps cards; community failure retains the existing toast', async ({ page }) => {
  await harness(page, '/api/admin/organizations');
  await expect(page.locator('.community-card')).toHaveCount(2);
  await expect(page.locator('.community-org-chip')).toHaveCount(0);
  await harness(page, '/api/communities');
  expect(await page.evaluate(() => (window as any).calls.at(-1))).toEqual(['toast', 'Failed to load communities', 'error']);
});
