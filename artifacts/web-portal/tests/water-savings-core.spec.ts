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

test('portfolio explicit-input economics stay in parity with the unchanged admin planner', () => {
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

test('width bands scale proportionally from the live open-lawn baseline', () => {
  const sandbox = { window: {} as Record<string, unknown>, console };
  vm.runInNewContext(readFileSync('public/common/xeriscape-core.js', 'utf8'), sandbox);
  const core = sandbox.window.VRTXeriscapeCore as any;
  const feature = (width: number | null, area = 1000) => ({
    id: String(width),
    properties: { id: String(width), area_sqft: area, effectiveWidthFt: width },
  });

  expect(core.WIDTH_BAND_RATIOS.OPEN_LAWN).toBe(1);
  expect(core.getFeatureGallonsPerSfYear(feature(5), { gallonsPerSfYear: 40 })).toBeCloseTo(60.606, 3);
  expect(core.getFeatureGallonsPerSfYear(feature(12), { gallonsPerSfYear: 40 })).toBeCloseTo(53.333, 3);
  expect(core.getFeatureGallonsPerSfYear(feature(20), { gallonsPerSfYear: 40 })).toBeCloseTo(46.061, 3);
  expect(core.getFeatureGallonsPerSfYear(feature(30), { gallonsPerSfYear: 40 })).toBe(40);
  expect(core.getFeatureGallonsPerSfYear(feature(null), { gallonsPerSfYear: 40 })).toBe(40);
  expect(core.widthBandForEffectiveWidth(25).key).toBe('small-panel');
  expect(core.widthBandForEffectiveWidth(25.01).key).toBe('open-lawn');
});

test('confirmed bands produce exactly four cost steps and invert area-first ordering', () => {
  const sandbox = { window: {} as Record<string, unknown>, console };
  vm.runInNewContext(readFileSync('public/common/xeriscape-core.js', 'utf8'), sandbox);
  const core = sandbox.window.VRTXeriscapeCore as any;
  const features = [
    { id: 'strip', properties: { id: 'strip', area_sqft: 454, effectiveWidthFt: 5.3 } },
    { id: 'verge', properties: { id: 'verge', area_sqft: 900, effectiveWidthFt: 12 } },
    { id: 'panel', properties: { id: 'panel', area_sqft: 1200, effectiveWidthFt: 20 } },
    { id: 'colfax', properties: { id: 'colfax', area_sqft: 42_102, effectiveWidthFt: 60.7 } },
  ];
  const costs = features.map((item) =>
    core.computeOutputsForFeatures([item], {}, 1).costPer1000GalAvoided,
  );
  expect(costs.map((cost: number) => Number(cost.toFixed(2)))).toEqual([5, 5.68, 6.58, 7.58]);

  const solution = core.solveScenario(features, { targetPct: 1, pins: {}, assumptions: {} });
  expect(solution.selectedIds).toEqual(['strip']);
  expect(solution.selectedAnnualGallons).toBe(22_700);
  expect(solution.totalAnnualGallons).toBeGreaterThan(42_102 * 33);
});

test('confirmed portfolio distribution and totals retain four deliberate classes', () => {
  const sandbox = { window: {} as Record<string, unknown>, console };
  vm.runInNewContext(readFileSync('public/common/xeriscape-core.js', 'utf8'), sandbox);
  const core = sandbox.window.VRTXeriscapeCore as any;
  const groups = [
    { count: 26, width: 2.7, totalArea: 20_000 },
    { count: 10, width: 12, totalArea: 15_000 },
    { count: 10, width: 20, totalArea: 8_842 },
    { count: 9, width: 69.2, totalArea: 149_906 },
  ];
  const features = groups.flatMap((group, groupIndex) =>
    Array.from({ length: group.count }, (_, index) => ({
      id: `${groupIndex}-${index}`,
      properties: {
        id: `${groupIndex}-${index}`,
        area_sqft: group.totalArea / group.count,
        effectiveWidthFt: group.width,
      },
    })),
  );
  const distribution = features.reduce((counts: Record<string, number>, item) => {
    const key = core.getFeatureWidthBand(item).key;
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  expect(distribution).toEqual({
    'tree-lawn-island': 26,
    verge: 10,
    'small-panel': 10,
    'open-lawn': 9,
  });
  expect(Math.min(...features.map((item) => item.properties.effectiveWidthFt))).toBe(2.7);
  expect(Math.max(...features.map((item) => item.properties.effectiveWidthFt))).toBe(69.2);

  const outputs = core.computeOutputsForFeatures(features, {});
  expect(outputs.totalSquareFootage).toBeCloseTo(193_748, 6);
  expect(outputs.annualGallonsAvoided).toBeCloseTo(6_942_894, 6);
  expect(193_748 * 33).toBe(6_393_684);
  expect((outputs.annualGallonsAvoided / 6_393_684 - 1) * 100).toBeCloseTo(8.6, 1);
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