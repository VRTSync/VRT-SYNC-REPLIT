import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'fs';

const USER = { user: { id: 'u1', username: 'client', displayName: 'Client Admin', role: 'client_admin' } };
const ADMIN = { user: { id: 'a1', username: 'admin', displayName: 'Admin', role: 'admin' } };

const PORTFOLIO = {
  organization: { id: 'org1', name: 'Acme Properties' },
  branches: [
    { id: 'b1', code: 'N01', name: 'North Branch', groupIds: ['g1'] },
    { id: 'b2', code: 'S01', name: 'South Branch', groupIds: ['g2'] },
  ],
  groups: [
    { id: 'g1', name: 'North', color: '#2563eb', branchIds: ['b1'] },
    { id: 'g2', name: 'South', color: '#16a34a', branchIds: ['b2'] },
  ],
  groupSets: [],
};

const BRANCHES = [
  { id: 'b1', code: 'N01', name: 'North Branch', city: 'Denver', groupIds: ['g1'], assetCount: 1, irrigationZones: 1, trees: 0, servicesYtd: 2, openWorkOrders: 1 },
  { id: 'b2', code: 'S01', name: 'South Branch', city: 'Pueblo', groupIds: ['g2'], assetCount: 2, irrigationZones: 0, trees: 2, servicesYtd: 3, openWorkOrders: 0 },
];

const DASHBOARD = {
  totals: { branches: 2, assetsMapped: 3, servicesLogged: 5, photoProofPct: null },
  openWorkOrders: { total: 1, awaitingApproval: 1, scheduled: 0 },
  thisWeek: { weekStart: '2026-08-31', weekEnd: '2026-09-06', scheduled: 0, completed: 0, needsAttention: 0, days: [] },
  byGroup: [
    { groupId: 'g1', name: 'North', branches: 1, services: 2, openItems: 1, spendYtdCents: 123456 },
    { groupId: 'g2', name: 'South', branches: 1, services: 3, openItems: 0, spendYtdCents: 5000 },
  ],
};

const WORK_ORDERS = {
  pipeline: { flaggedByHp: 1, awaitingApproval: 1, scheduled: 2, completed30d: 0 },
  open: [
    { id: 'wo1', ref: 'WO-1', communityId: 'b1', groupIds: ['g1'], branchName: 'North Branch', branchCode: 'N01', title: 'North leak', status: 'pending', origin: 'client', source: 'Acme request', estimateCents: 10000, approvedAt: null, declinedAt: null, photoCount: 0 },
    { id: 'wo2', ref: 'WO-2', communityId: 'b2', groupIds: ['g2'], branchName: 'South Branch', branchCode: 'S01', title: 'South repair', status: 'in_progress', origin: null, source: 'Contractor report', estimateCents: null, approvedAt: null, declinedAt: null, photoCount: 0 },
  ],
  closed: [],
  cancelled: [],
};

async function mockPortal(page: Page, role: 'client' | 'admin' = 'client') {
  await page.route('**/api/auth/me', route => route.fulfill({ json: role === 'admin' ? ADMIN : USER }));
  await page.route('**/api/portfolio/me', route => route.fulfill({ json: PORTFOLIO }));
  await page.route('**/api/admin/organizations/org1/portfolio', route => route.fulfill({ json: PORTFOLIO }));
  await page.route('**/api/portfolio/dashboard*', route => route.fulfill({ json: DASHBOARD }));
  await page.route('**/api/portfolio/branches*', route => route.fulfill({ json: BRANCHES }));
  await page.route('**/api/portfolio/work-orders*', route => route.fulfill({ json: WORK_ORDERS }));
  await page.route('**/api/portfolio/map*', route => route.fulfill({ json: { branches: [], layers: [] } }));
  const shell = readFileSync('templates/portfolio-shell.html', 'utf8');
  await page.route('**/web/portfolio/**', route => route.fulfill({ contentType: 'text/html', body: shell }));
}

test('group cards show reconciled spend and expose separate accessible destinations', async ({ page }) => {
  await mockPortal(page);
  await page.goto('/web/portfolio/dashboard');

  const north = page.locator('[data-group-card="g1"]');
  await expect(north).toContainText('$1,235');
  await expect(north).toHaveAttribute('role', 'link');
  await expect(north.locator('[data-group-work-orders="g1"]')).toHaveCount(1);
  await expect(page.locator('[data-group-card="g2"] [data-group-work-orders]')).toHaveCount(0);

  await north.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/web\/portfolio\/branches\?group=g1$/);
  await expect(page.locator('.group-filter-notice')).toContainText('North');
  await expect(page.locator('tbody tr.clickable')).toHaveCount(1);

  await page.goBack();
  await expect(page).toHaveURL(/\/web\/portfolio\/dashboard$/);
  await page.locator('[data-group-work-orders="g1"]').click();
  await expect(page).toHaveURL(/\/web\/portfolio\/work-orders\?group=g1$/);
});

test('direct group links preserve admin preview context and invalid groups fail open', async ({ page }) => {
  await mockPortal(page, 'admin');
  await page.goto('/web/portfolio/branches?org=org1&group=g1');

  await expect(page.locator('.group-filter-notice')).toContainText('North');
  await expect(page.locator('tbody tr.clickable')).toHaveCount(1);
  await page.locator('[data-clear-group]').click();
  await expect(page).toHaveURL('/web/portfolio/branches?org=org1');
  await expect(page.locator('tbody tr.clickable')).toHaveCount(2);

  await page.goto('/web/portfolio/branches?org=org1&group=foreign');
  await expect(page.locator('.group-filter-notice')).toContainText('unavailable');
  await expect(page.locator('tbody tr.clickable')).toHaveCount(2);
});

test('work-order group scope combines with status and search, then clears independently', async ({ page }) => {
  await mockPortal(page);
  await page.goto('/web/portfolio/work-orders?group=g1');

  await expect(page.locator('.group-filter-notice')).toContainText('North');
  await expect(page.locator('tbody tr[data-task-id="wo1"]')).toBeVisible();
  await expect(page.locator('tbody tr[data-task-id="wo2"]')).toHaveCount(0);

  await page.locator('[data-filter="awaiting"]').click();
  await page.locator('#wo-search').fill('North');
  await page.locator('[data-clear-group]').click();

  await expect(page.locator('[data-filter="awaiting"]')).toHaveClass(/on/);
  await expect(page.locator('#wo-search')).toHaveValue('North');
  await expect(page).toHaveURL('/web/portfolio/work-orders');
});