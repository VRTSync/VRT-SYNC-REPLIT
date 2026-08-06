/**
 * portfolio-refresh.spec.ts
 *
 * Verifies the portfolio portal no longer auto re-renders on a timer, and that
 * the replacement patterns work:
 *   • no timed re-render (dashboard fetch count stays flat as time passes)
 *   • "updated Xm ago" label keeps ticking
 *   • manual Refresh button re-fetches and resets the label
 *   • visibilitychange → visible re-fetches only when data is > 5 min stale
 *   • interaction guard (focused input) discards the visibility refresh
 *     (no deferred retry — the next visibilitychange re-evaluates)
 *
 * All API calls are intercepted via page.route(); page.clock drives time.
 */

import { test, expect, type Page } from '@playwright/test';

const USER = { user: { id: 'u1', username: 'ca', displayName: 'Client Admin', role: 'client_admin' } };

const PORTFOLIO_ME = {
  organization: { id: 'org1', name: 'Acme Properties' },
  branches: [],
  groups: [{ id: 'g1', name: 'North' }],
};

const DASHBOARD = {
  totals: { branches: 1, servicesYtd: 3, openItems: 0, photoProofPct: 100 },
  openWorkOrders: 0,
  thisWeek: { start: '2026-08-03', end: '2026-08-09', days: [], stats: { total: 0, done: 0, flagged: 0 } },
  byGroup: [{ groupId: 'g1', name: 'North', branches: 1, services: 3, openItems: 0, photoProofPct: 100 }],
};

const BRANCHES = [
  { id: 'b1', code: 'N01', name: 'North Branch', groupId: 'g1', servicesYtd: 3, lastServiceAt: '2026-08-01' },
];

const WORK_ORDERS = { pipeline: { awaitingApproval: 0 }, open: [], closed: [], cancelled: [] };

async function mockApis(page: Page, counters: { dashboard: number }) {
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: USER }));
  await page.route('**/api/portfolio/me', (r) => r.fulfill({ json: PORTFOLIO_ME }));
  await page.route('**/api/portfolio/dashboard*', (r) => {
    counters.dashboard++;
    return r.fulfill({ json: DASHBOARD });
  });
  await page.route('**/api/portfolio/branches*', (r) => r.fulfill({ json: BRANCHES }));
  await page.route('**/api/portfolio/work-orders*', (r) => r.fulfill({ json: WORK_ORDERS }));
}

async function openDashboard(page: Page, counters: { dashboard: number }) {
  await page.clock.install({ time: new Date('2026-08-05T12:00:00') });
  await mockApis(page, counters);
  // The server gates the shell behind a session; serve the template directly.
  const fs = await import('fs');
  const shell = fs.readFileSync('templates/portfolio-shell.html', 'utf-8');
  await page.route('**/web/portfolio/dashboard', (r) =>
    r.fulfill({ contentType: 'text/html', body: shell }),
  );
  await page.goto('/web/portfolio/dashboard');
  await expect(page.locator('#pf-refresh-label')).toHaveText('updated just now');
  expect(counters.dashboard).toBe(1);
}

/** Simulate the tab becoming hidden/visible. */
async function setVisibility(page: Page, state: 'hidden' | 'visible') {
  await page.evaluate((s) => {
    Object.defineProperty(document, 'visibilityState', { value: s, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

test('no timed re-render; label ticks; manual Refresh re-fetches', async ({ page }) => {
  const counters = { dashboard: 0 };
  await openDashboard(page, counters);

  // Refresh button injected next to the label
  const btn = page.locator('#pf-refresh-btn');
  await expect(btn).toBeVisible();

  // Advance 3 minutes — nothing re-renders, label keeps ticking
  await page.clock.runFor(3 * 60 * 1000);
  expect(counters.dashboard).toBe(1);
  await expect(page.locator('#pf-refresh-label')).toHaveText('updated 3m ago');

  // Manual refresh → one re-fetch, label resets
  await btn.click();
  await expect(page.locator('#pf-refresh-label')).toHaveText('updated just now');
  expect(counters.dashboard).toBe(2);

  // Fresh button is re-injected and enabled after the re-render
  await expect(page.locator('#pf-refresh-btn')).toBeEnabled();
});

test('visibility refresh: only when stale, discarded while input focused', async ({ page }) => {
  const counters = { dashboard: 0 };
  await openDashboard(page, counters);

  // Away and back within 1 minute → no refresh
  await setVisibility(page, 'hidden');
  await page.clock.runFor(30 * 1000);
  await setVisibility(page, 'visible');
  await page.waitForTimeout(50);
  expect(counters.dashboard).toBe(1);

  // Away 6+ minutes → one refresh on return
  await setVisibility(page, 'hidden');
  await page.clock.runFor(6 * 60 * 1000);
  await setVisibility(page, 'visible');
  await expect(page.locator('#pf-refresh-label')).toHaveText('updated just now');
  expect(counters.dashboard).toBe(2);

  // Away 6+ minutes but an input inside the page has focus → discarded
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.id = 'guard-input';
    document.getElementById('page-content')!.appendChild(input);
    input.focus();
  });
  await setVisibility(page, 'hidden');
  await page.clock.runFor(6 * 60 * 1000);
  await setVisibility(page, 'visible');
  await page.waitForTimeout(50);
  expect(counters.dashboard).toBe(2); // guarded — no refresh

  // Blur the input and wait well past the 30 s tick — the refresh was
  // DISCARDED, not queued: nothing fires, the label keeps aging.
  await page.evaluate(() => {
    (document.getElementById('guard-input') as HTMLInputElement).blur();
  });
  await page.clock.runFor(2 * 60 * 1000);
  expect(counters.dashboard).toBe(2);
  await expect(page.locator('#pf-refresh-label')).not.toHaveText('updated just now');

  // A fresh visibilitychange → visible re-evaluates from scratch → refreshes
  await setVisibility(page, 'hidden');
  await page.clock.runFor(1000);
  await setVisibility(page, 'visible');
  await expect(page.locator('#pf-refresh-label')).toHaveText('updated just now');
  expect(counters.dashboard).toBe(3);
});

test('label + Refresh button injected on routes that do not render their own label', async ({ page }) => {
  const counters = { dashboard: 0 };
  await openDashboard(page, counters);

  // Branches page renders a .ctx header without #pf-refresh-label
  await page.evaluate(() => (window as any).PortfolioRouter.navigate('branches', true, {}));
  await expect(page.locator('.ctx .bname').first()).toBeVisible().catch(() => {});
  await expect(page.locator('#pf-refresh-label')).toBeVisible();
  await expect(page.locator('#pf-refresh-btn')).toBeVisible();

  // Work Orders page too
  await page.evaluate(() => (window as any).PortfolioRouter.navigate('work-orders', true, {}));
  await expect(page.locator('#pf-refresh-label')).toBeVisible();
  await expect(page.locator('#pf-refresh-btn')).toBeVisible();

  // Navigating back and forth leaves exactly one label and one button
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => (window as any).PortfolioRouter.navigate('branches', true, {}));
    await page.evaluate(() => (window as any).PortfolioRouter.navigate('work-orders', true, {}));
  }
  await expect(page.locator('#pf-refresh-label')).toHaveCount(1);
  await expect(page.locator('#pf-refresh-btn')).toHaveCount(1);
});

test('open Submit Request modal and open dropdowns block the visibility refresh', async ({ page }) => {
  const counters = { dashboard: 0 };
  const woCalls: string[] = [];
  await openDashboard(page, counters);

  await page.route('**/api/portfolio/work-orders*', (r) => {
    woCalls.push(r.request().url());
    return r.fulfill({ json: WORK_ORDERS });
  });
  await page.evaluate(() => (window as any).PortfolioRouter.navigate('work-orders', true, {}));
  await expect(page.locator('#wo-open-modal')).toBeVisible();
  const woCallsAfterLoad = woCalls.length;

  // Open the real Submit Request modal and type into it. (The overlay's
  // inline style has a duplicate `display` declaration that leaves it open
  // on first render — pre-existing quirk; handle both states.)
  if (!(await page.locator('#wo-modal-overlay').isVisible())) {
    await page.locator('#wo-open-modal').click();
  }
  await expect(page.locator('#wo-modal-overlay')).toBeVisible();
  const anyInput = page.locator('#wo-modal-overlay input[type="text"], #wo-modal-overlay textarea').first();
  await anyInput.fill('Sprinkler head broken near entrance');

  // Leave the tab 6+ minutes with the modal open → no refresh, input intact
  await setVisibility(page, 'hidden');
  await page.clock.runFor(6 * 60 * 1000);
  await setVisibility(page, 'visible');
  await page.waitForTimeout(50);
  await expect(page.locator('#wo-modal-overlay')).toBeVisible();
  await expect(anyInput).toHaveValue('Sprinkler head broken near entrance');
  expect(woCalls.length).toBe(woCallsAfterLoad);

  // Close the modal → nothing was queued; the 30 s tick only updates the label
  await page.locator('#wo-modal-cancel').click();
  await page.clock.runFor(31 * 1000);
  expect(woCalls.length).toBe(woCallsAfterLoad);

  // A fresh visibilitychange → visible now refreshes (stale, no guard)
  await setVisibility(page, 'hidden');
  await page.clock.runFor(1000);
  await setVisibility(page, 'visible');
  await expect(page.locator('#pf-refresh-label')).toHaveText('updated just now');
  expect(woCalls.length).toBeGreaterThan(woCallsAfterLoad);

  // Branch-selector dropdown (.bsel-menu.open) and work-order detail overlay
  // (.wo-detail-overlay.visible) also block the visibility refresh
  for (const cls of [['bsel-menu', 'open'], ['wo-detail-overlay', 'visible']] as const) {
    // Each re-render recreates the quirky always-open modal overlay; close it
    // so it doesn't act as a guard itself.
    await page.evaluate(() => {
      const o = document.getElementById('wo-modal-overlay');
      if (o) o.style.display = 'none';
    });
    await page.evaluate(([base, mod]) => {
      const el = document.createElement('div');
      el.className = base + ' ' + mod;
      el.id = 'guard-el';
      document.getElementById('page-content')!.appendChild(el);
    }, cls);
    const before = woCalls.length;
    await setVisibility(page, 'hidden');
    await page.clock.runFor(6 * 60 * 1000);
    await setVisibility(page, 'visible');
    await page.waitForTimeout(50);
    expect(woCalls.length).toBe(before); // guarded — discarded, not queued
    await page.evaluate(() => document.getElementById('guard-el')!.remove());
    await page.clock.runFor(31 * 1000);
    expect(woCalls.length).toBe(before); // no deferred retry on the tick

    // Re-trigger via a fresh visibilitychange so the next loop iteration
    // starts from a just-refreshed state.
    await setVisibility(page, 'hidden');
    await page.clock.runFor(1000);
    await setVisibility(page, 'visible');
    await expect(page.locator('#pf-refresh-label')).toHaveText('updated just now');
    expect(woCalls.length).toBeGreaterThan(before);
  }
});
