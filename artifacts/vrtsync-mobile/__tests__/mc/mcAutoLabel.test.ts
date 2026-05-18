import { generateAutoLabel, indexToControllerKey } from '@/lib/mcAutoLabel';

describe('indexToControllerKey', () => {
  it('maps 0 → A', () => expect(indexToControllerKey(0)).toBe('A'));
  it('maps 25 → Z', () => expect(indexToControllerKey(25)).toBe('Z'));
  it('maps 26 → AA', () => expect(indexToControllerKey(26)).toBe('AA'));
  it('maps 27 → AB', () => expect(indexToControllerKey(27)).toBe('AB'));
  it('maps 51 → AZ', () => expect(indexToControllerKey(51)).toBe('AZ'));
  it('maps 52 → BA', () => expect(indexToControllerKey(52)).toBe('BA'));
});

describe('generateAutoLabel — controller', () => {
  it('returns Controller A when no controllers exist', () => {
    expect(generateAutoLabel({ assetType: 'controller', existingLabels: [] })).toBe('Controller A');
  });

  it('returns Controller B when Controller A already exists', () => {
    expect(
      generateAutoLabel({ assetType: 'controller', existingLabels: ['Controller A'] })
    ).toBe('Controller B');
  });

  it('returns Controller AA after A–Z are all used', () => {
    const existing = Array.from({ length: 26 }, (_, i) =>
      `Controller ${String.fromCharCode(65 + i)}`
    );
    expect(generateAutoLabel({ assetType: 'controller', existingLabels: existing })).toBe(
      'Controller AA'
    );
  });

  it('fills gaps — skips used keys and picks the first free one', () => {
    expect(
      generateAutoLabel({
        assetType: 'controller',
        existingLabels: ['Controller A', 'Controller C'],
      })
    ).toBe('Controller B');
  });

  it('ignores non-controller labels mixed in', () => {
    expect(
      generateAutoLabel({
        assetType: 'controller',
        existingLabels: ['Tree 1', 'Pet Station 2', 'Controller A'],
      })
    ).toBe('Controller B');
  });

  it('is case-insensitive when reading existing labels', () => {
    expect(
      generateAutoLabel({
        assetType: 'controller',
        existingLabels: ['controller a'],
      })
    ).toBe('Controller B');
  });
});

describe('generateAutoLabel — tree', () => {
  it('returns Tree 1 when no trees exist', () => {
    expect(generateAutoLabel({ assetType: 'tree', existingLabels: [] })).toBe('Tree 1');
  });

  it('returns Tree 2 when Tree 1 already exists', () => {
    expect(
      generateAutoLabel({ assetType: 'tree', existingLabels: ['Tree 1'] })
    ).toBe('Tree 2');
  });

  it('fills numeric gaps', () => {
    expect(
      generateAutoLabel({ assetType: 'tree', existingLabels: ['Tree 1', 'Tree 3'] })
    ).toBe('Tree 2');
  });

  it('ignores non-numeric suffixes', () => {
    expect(
      generateAutoLabel({ assetType: 'tree', existingLabels: ['Tree One', 'Tree 1'] })
    ).toBe('Tree 2');
  });
});

describe('generateAutoLabel — pet_station (ASSET_FIELD_TEMPLATES displayName)', () => {
  it('returns Pet Station 1 when none exist', () => {
    expect(generateAutoLabel({ assetType: 'pet_station', existingLabels: [] })).toBe(
      'Pet Station 1'
    );
  });

  it('increments correctly', () => {
    expect(
      generateAutoLabel({
        assetType: 'pet_station',
        existingLabels: ['Pet Station 1', 'Pet Station 2'],
      })
    ).toBe('Pet Station 3');
  });
});

describe('generateAutoLabel — native_area (displayName is Native Grass, not Native Area)', () => {
  it('uses the displayName from ASSET_FIELD_TEMPLATES ("Native Grass")', () => {
    expect(generateAutoLabel({ assetType: 'native_area', existingLabels: [] })).toBe(
      'Native Grass 1'
    );
  });

  it('increments using the correct prefix', () => {
    expect(
      generateAutoLabel({
        assetType: 'native_area',
        existingLabels: ['Native Grass 1'],
      })
    ).toBe('Native Grass 2');
  });

  it('does not match old "Native Area" prefix labels', () => {
    expect(
      generateAutoLabel({
        assetType: 'native_area',
        existingLabels: ['Native Area 1', 'Native Area 2'],
      })
    ).toBe('Native Grass 1');
  });
});

describe('generateAutoLabel — unknown type (title-case fallback)', () => {
  it('title-cases the raw key for an unknown type', () => {
    expect(generateAutoLabel({ assetType: 'quick_connect', existingLabels: [] })).toBe(
      'Quick Connect 1'
    );
  });

  it('increments the title-cased label correctly', () => {
    expect(
      generateAutoLabel({
        assetType: 'quick_connect',
        existingLabels: ['Quick Connect 1'],
      })
    ).toBe('Quick Connect 2');
  });

  it('handles a single-word unknown type', () => {
    expect(generateAutoLabel({ assetType: 'widget', existingLabels: [] })).toBe('Widget 1');
  });
});

describe('generateAutoLabel — general gap-filling', () => {
  it('fills the first gap in a non-sequential list', () => {
    expect(
      generateAutoLabel({
        assetType: 'backflow',
        existingLabels: ['Backflow 1', 'Backflow 3', 'Backflow 4'],
      })
    ).toBe('Backflow 2');
  });

  it('appends after the highest number when no gaps exist', () => {
    expect(
      generateAutoLabel({
        assetType: 'backflow',
        existingLabels: ['Backflow 1', 'Backflow 2', 'Backflow 3'],
      })
    ).toBe('Backflow 4');
  });
});
