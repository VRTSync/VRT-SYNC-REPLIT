import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function loadGroupColors() {
  const sandbox = { window: {} as Record<string, unknown> };
  vm.runInNewContext(readFileSync('public/common/group-colors.js', 'utf8'), sandbox);
  return sandbox.window.VRTGroupColors as {
    GROUP_PALETTE: string[];
    resolveGroupColor: (group: { color?: string | null }, fallbackIndex: number) => string;
    hexToRgba: (hex: string, alpha: number) => string;
    getStableFallbackIndexes: (groups: Array<{ id: string; sortOrder?: number }>) => Record<string, number>;
  };
}

test('colourless groups keep the same fallback across API and set orderings', () => {
  const colors = loadGroupColors();
  const canonical = [
    { id: 'group-z', sortOrder: 2 },
    { id: 'group-b', sortOrder: 1 },
    { id: 'group-a', sortOrder: 1 },
    { id: 'group-x' },
    { id: 'group-y' },
    { id: 'group-c' },
    { id: 'group-d' },
  ];
  const reordered = [
    canonical[6], canonical[3], canonical[0], canonical[2],
    canonical[5], canonical[1], canonical[4],
  ];

  const first = colors.getStableFallbackIndexes(canonical);
  const second = colors.getStableFallbackIndexes(reordered);
  expect(first).toEqual(second);
  expect(first['group-c']).toBe(3);
  expect(first['group-x']).toBe(5);
  expect(first['group-y']).toBe(6);
  expect(colors.resolveGroupColor(canonical[3], first['group-x'])).toBe('#8b5cf6');
  expect(colors.resolveGroupColor(canonical[4], first['group-y'])).toBe('#06b6d4');
});

test('shared colour conversion is neutral for invalid input', () => {
  const colors = loadGroupColors();
  expect(colors.hexToRgba('#25C1AC', 0.12)).toBe('rgba(37,193,172,0.12)');
  expect(colors.hexToRgba('not-a-colour', 0.12)).toBe('rgba(148,163,184,0.12)');
});

test('every portfolio group surface uses shared stable fallback metadata', () => {
  const page = (name: string) => readFileSync(`public/portfolio/pages/${name}.js`, 'utf8');
  const dashboard = page('dashboard');
  const branches = page('branches');
  const branchDetail = page('branch-detail');
  const groups = page('groups');
  const analytics = page('analytics');
  const map = page('map');

  for (const source of [dashboard, branches, branchDetail, groups, analytics, map]) {
    expect(source).toContain('getStableFallbackIndexes');
  }
  expect(analytics).toContain('fallbackIndexes[g.id]');
  expect(map).toContain('fallbackIndexes[g.id]');
  expect([dashboard, branches, branchDetail, groups, analytics, map].join('\n')).not.toContain('groupColorClass');
});

test('group-set API payload preserves the canonical saved sort order', () => {
  const storage = readFileSync('../api-server/src/storage.ts', 'utf8');
  expect(storage).toContain('sortOrder: r.sort_order');
  expect(storage).toContain('sortOrder: g.sortOrder');
});