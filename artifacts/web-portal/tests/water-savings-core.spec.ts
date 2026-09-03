import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function extractFunction(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Missing ${name}`);
  const brace = source.indexOf('{', start);
  let depth = 0;
  for (let index = brace; index < source.length; index++) {
    if (source[index] === '{') depth++;
    if (source[index] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Unclosed ${name}`);
}

function extractConstant(source: string, name: string): string {
  const match = source.match(new RegExp(`const ${name} = [^;]+;`));
  if (!match) throw new Error(`Missing ${name}`);
  return match[0];
}

test('portfolio economics stay in parity with the unchanged admin planner', () => {
  const adminSource = readFileSync('public/admin/pages/xeriscape-planner.js', 'utf8');
  const constants = [
    'DEFAULT_COST_PER_SF',
    'DEFAULT_REBATE_PER_SF',
    'DEFAULT_GALLONS_PER_SF_YEAR',
    'DEFAULT_WATER_RATE_PER_KGAL',
    'DEFAULT_MAINTENANCE_PER_SF_YEAR',
    'ASSET_LIFE_YEARS',
  ].map((name) => extractConstant(adminSource, name)).join('\n');
  const adminCompute = new Function(
    `${constants}
${extractFunction(adminSource, 'numberOrFallback')}
${extractFunction(adminSource, 'normaliseAssumptions')}
${extractFunction(adminSource, 'computeOutputsForSquareFootage')}
return computeOutputsForSquareFootage;`,
  )() as (sqFt: number, assumptions: object, count: number) => Record<string, number>;

  const sandbox = { window: {} as Record<string, unknown>, console };
  vm.runInNewContext(readFileSync('public/common/xeriscape-core.js', 'utf8'), sandbox);
  const core = sandbox.window.VRTXeriscapeCore as {
    computeOutputsForSquareFootage: typeof adminCompute;
  };
  const admin = adminCompute(28_700, {}, 1);
  const portfolio = core.computeOutputsForSquareFootage(28_700, {}, 1);

  for (const key of [
    'annualGallonsAvoided',
    'estimatedAnnualSavings',
    'netConversionCost',
    'estimatedPaybackYears',
    'costPer1000GalAvoided',
  ]) {
    expect(portfolio[key]).toBeCloseTo(admin[key], 10);
  }
  expect(portfolio.annualGallonsAvoided).toBe(947_100);
  expect(portfolio.estimatedAnnualSavings).toBeCloseTo(11_962.16, 2);
  expect(portfolio.netConversionCost).toBe(143_500);
  expect(portfolio.estimatedPaybackYears).toBeCloseTo(12.0, 1);
  expect(portfolio.costPer1000GalAvoided).toBeCloseTo(7.58, 2);
});

test('only one portfolio solver exists and protected map/admin files remain independent', () => {
  const core = readFileSync('public/common/xeriscape-core.js', 'utf8');
  const summary = readFileSync('public/portfolio/pages/water-savings.js', 'utf8');
  const detail = readFileSync('public/portfolio/pages/water-savings-location.js', 'utf8');
  expect((core.match(/function solve/g) || []).length).toBe(1);
  expect(summary).not.toMatch(/function solve/);
  expect(detail).not.toMatch(/function solve/);
  expect(detail).toContain('setFeatureColors');
  expect(detail).not.toContain('L.map(');
});

test('budget limits automatic selection while pinned areas remain authoritative', () => {
  const sandbox = { window: {} as Record<string, unknown>, console };
  vm.runInNewContext(readFileSync('public/common/xeriscape-core.js', 'utf8'), sandbox);
  const core = sandbox.window.VRTXeriscapeCore as any;
  const features = [
    { id: 'a', properties: { id: 'a', area_sqft: 1000 } },
    { id: 'b', properties: { id: 'b', area_sqft: 500 } },
  ];
  const assumptions = core.normaliseAssumptions({});
  const limited = core.solveScenario(features, { targetPct: 100, annualBudget: 2600, assumptions, pins: {} });
  expect(limited.selectedIds).toEqual(['b']);
  expect(limited.budgetLimited).toBe(true);
  const pinned = core.solveScenario(features, { targetPct: 100, annualBudget: 0, assumptions, pins: { a: 'in' } });
  expect(pinned.selectedIds).toContain('a');
  expect(pinned.displayStatuses.a).toBe('pinned-in');
  expect(pinned.displayStatuses.b).toBe('available');
});

test('status-aware pin cycle moves automatic, pinned-in, and pinned-out areas through three states', () => {
  const sandbox = { window: {} as Record<string, unknown>, console };
  vm.runInNewContext(readFileSync('public/common/xeriscape-core.js', 'utf8'), sandbox);
  vm.runInNewContext(readFileSync('public/common/water-scenario-store.js', 'utf8'), sandbox);
  const store = (sandbox.window as any).VRTWaterScenario;

  store.reset();
  store.cyclePin('available', 'available');
  expect(store.get().pins.available).toBe('in');
  store.cyclePin('available', 'pinned-in');
  expect(store.get().pins.available).toBe('out');
  store.cyclePin('available', 'pinned-out');
  expect(store.get().pins.available).toBeUndefined();

  store.cyclePin('selected', 'in-plan');
  expect(store.get().pins.selected).toBe('out');
  store.cyclePin('selected', 'pinned-out');
  expect(store.get().pins.selected).toBeUndefined();
});

test('tier presets set cost and rebate together and expose modified scenarios without changing shape', () => {
  const sandbox = { window: {} as Record<string, unknown>, console };
  vm.runInNewContext(readFileSync('public/common/xeriscape-core.js', 'utf8'), sandbox);
  vm.runInNewContext(readFileSync('public/common/water-scenario-store.js', 'utf8'), sandbox);
  const store = (sandbox.window as any).VRTWaterScenario;

  store.reset();
  expect(store.get().tier).toBe('rock');
  expect(store.get().assumptions.costPerSf).toBe(6);
  expect(store.get().assumptions.rebatePerSf).toBe(1);

  store.setTier('colorado');
  expect(store.get().tier).toBe('colorado');
  expect(store.get().assumptions.costPerSf).toBe(10);
  expect(store.get().assumptions.rebatePerSf).toBe(3.25);

  store.setAssumptions({ ...store.get().assumptions, costPerSf: 11 });
  expect(store.get().tier).toBe('colorado');
  expect(store.get().assumptions.costPerSf).toBe(11);
  expect(store.get()).not.toHaveProperty('tierModified');
});