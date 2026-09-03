/**
 * Authoritative browser implementation for the portfolio Water Savings tool.
 * The admin Xeriscape Planner intentionally retains a duplicate pending a
 * later consolidation; parity tests must fail if either economics copy drifts.
 */
(function () {
  'use strict';

  const DEFAULT_COST_PER_SF = 6.00;
  const DEFAULT_REBATE_PER_SF = 1.00;
  const DEFAULT_GALLONS_PER_SF_YEAR = 33;
  const DEFAULT_WATER_RATE_PER_KGAL = 9.60;
  const DEFAULT_MAINTENANCE_PER_SF_YEAR = 0.10;
  const ASSET_LIFE_YEARS = 20;

  // FB02 Polygon 2 measures 25.5 ft, just 0.5 ft above the 25-ft boundary.
  // Keep this boundary deliberate if the confirmed source measurement changes.
  const WIDTH_BAND_RATIOS = Object.freeze({
    TREE_LAWN_ISLAND: 50 / 33,
    VERGE: 44 / 33,
    SMALL_PANEL: 38 / 33,
    OPEN_LAWN: 1.0,
  });
  const WIDTH_BANDS = Object.freeze([
    Object.freeze({ key: 'tree-lawn-island', label: 'Tree lawn / island', range: 'Under 10 ft', maxWidthFt: 10, ratio: WIDTH_BAND_RATIOS.TREE_LAWN_ISLAND }),
    Object.freeze({ key: 'verge', label: 'Verge', range: '10–15 ft', maxWidthFt: 15, ratio: WIDTH_BAND_RATIOS.VERGE }),
    Object.freeze({ key: 'small-panel', label: 'Small panel', range: '15–25 ft', maxWidthFt: 25, ratio: WIDTH_BAND_RATIOS.SMALL_PANEL }),
    Object.freeze({ key: 'open-lawn', label: 'Open lawn', range: 'Over 25 ft', maxWidthFt: Infinity, ratio: WIDTH_BAND_RATIOS.OPEN_LAWN }),
  ]);

  function numberOrFallback(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : fallback;
  }

  function normaliseAssumptions(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    const hasNewSavingsShape = [
      'gallonsPerSfYear',
      'waterRatePerKGal',
      'maintenancePerSfYear',
      'rebatePerSf',
    ].some(key => raw[key] !== undefined);

    if (!hasNewSavingsShape && raw.savingsPerSf !== undefined) {
      const legacySavings = numberOrFallback(raw.savingsPerSf, 0);
      return {
        costPerSf: numberOrFallback(raw.costPerSf, DEFAULT_COST_PER_SF),
        gallonsPerSfYear: DEFAULT_GALLONS_PER_SF_YEAR,
        waterRatePerKGal: legacySavings / (DEFAULT_GALLONS_PER_SF_YEAR / 1000),
        maintenancePerSfYear: 0,
        rebatePerSf: 0,
      };
    }

    return {
      costPerSf: numberOrFallback(raw.costPerSf, DEFAULT_COST_PER_SF),
      gallonsPerSfYear: numberOrFallback(raw.gallonsPerSfYear, DEFAULT_GALLONS_PER_SF_YEAR),
      waterRatePerKGal: numberOrFallback(raw.waterRatePerKGal, DEFAULT_WATER_RATE_PER_KGAL),
      maintenancePerSfYear: numberOrFallback(raw.maintenancePerSfYear, DEFAULT_MAINTENANCE_PER_SF_YEAR),
      rebatePerSf: numberOrFallback(raw.rebatePerSf, DEFAULT_REBATE_PER_SF),
    };
  }

  function derivedSavingsPerSf(assumptions) {
    const a = normaliseAssumptions(assumptions);
    return (a.gallonsPerSfYear / 1000) * a.waterRatePerKGal + a.maintenancePerSfYear;
  }

  function widthBandForEffectiveWidth(effectiveWidthFt) {
    if (effectiveWidthFt === null || effectiveWidthFt === undefined || effectiveWidthFt === '') {
      return WIDTH_BANDS[3];
    }
    const width = Number(effectiveWidthFt);
    if (!Number.isFinite(width) || width <= 0) return WIDTH_BANDS[3];
    if (width < 10) return WIDTH_BANDS[0];
    if (width <= 15) return WIDTH_BANDS[1];
    if (width <= 25) return WIDTH_BANDS[2];
    return WIDTH_BANDS[3];
  }

  function getFeatureGallonsPerSfYear(feature, assumptions) {
    const a = normaliseAssumptions(assumptions);
    const width = feature && feature.properties
      ? feature.properties.effectiveWidthFt
      : null;
    return a.gallonsPerSfYear * widthBandForEffectiveWidth(width).ratio;
  }

  function getFeatureWidthBand(feature) {
    return widthBandForEffectiveWidth(feature && feature.properties
      ? feature.properties.effectiveWidthFt
      : null);
  }

  function computeOutputsFromTotals(totalSquareFootage, annualGallonsAvoided, assumptions, polygonCount) {
    const a = normaliseAssumptions(assumptions);
    const costPerSf = a.costPerSf;
    const waterRatePerKGal = a.waterRatePerKGal;
    const maintenancePerSfYear = a.maintenancePerSfYear;
    const rebatePerSf = a.rebatePerSf;

    const annualWaterSavings = (annualGallonsAvoided / 1000) * waterRatePerKGal;
    const annualMaintenanceSavings = totalSquareFootage * maintenancePerSfYear;
    const estimatedAnnualSavings = annualWaterSavings + annualMaintenanceSavings;

    const grossConversionCost = totalSquareFootage * costPerSf;
    const rebateAmount = totalSquareFootage * rebatePerSf;
    const netConversionCost = Math.max(grossConversionCost - rebateAmount, 0);
    const estimatedPaybackYears = estimatedAnnualSavings > 0
      ? netConversionCost / estimatedAnnualSavings
      : null;
    const costPer1000GalAvoided = annualGallonsAvoided > 0
      ? netConversionCost / (annualGallonsAvoided * ASSET_LIFE_YEARS / 1000)
      : null;

    return {
      polygonCount: polygonCount || 0,
      totalSquareFootage,
      annualGallonsAvoided,
      annualWaterSavings,
      annualMaintenanceSavings,
      estimatedAnnualSavings,
      grossConversionCost,
      estimatedConversionCost: grossConversionCost,
      rebateAmount,
      netConversionCost,
      estimatedPaybackYears,
      costPer1000GalAvoided,
    };
  }

  function computeOutputsForSquareFootage(totalSquareFootage, assumptions, polygonCount) {
    const a = normaliseAssumptions(assumptions);
    return computeOutputsFromTotals(
      totalSquareFootage,
      totalSquareFootage * a.gallonsPerSfYear,
      a,
      polygonCount,
    );
  }

  function computeOutputsForFeatures(features, assumptions, polygonCount) {
    const usable = (features || []).filter(function (feature) {
      const area = Number(feature && feature.properties && feature.properties.area_sqft);
      return Number.isFinite(area) && area > 0;
    });
    const totalSquareFootage = usable.reduce(function (sum, feature) {
      return sum + Number(feature.properties.area_sqft);
    }, 0);
    const annualGallonsAvoided = usable.reduce(function (sum, feature) {
      return sum + Number(feature.properties.area_sqft) * getFeatureGallonsPerSfYear(feature, assumptions);
    }, 0);
    return computeOutputsFromTotals(
      totalSquareFootage,
      annualGallonsAvoided,
      assumptions,
      polygonCount === undefined ? usable.length : polygonCount,
    );
  }

  function computeGroupOutputs(polygonIds, assumptions, allFeatures) {
    const features = (allFeatures || []).filter(f => polygonIds.includes(f.properties?.id));
    return computeOutputsForFeatures(features, assumptions);
  }

  function buildGroupSummary(group, polygonFeatures, assumptions, opts) {
    opts = opts || {};
    assumptions = normaliseAssumptions(assumptions);
    const propertyName = opts.propertyName !== undefined ? opts.propertyName : 'Community';
    
    // Polyfill formatDate for core
    function formatDate(d) {
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    }
    const generatedDate = opts.generatedDate !== undefined ? opts.generatedDate : formatDate(new Date());

    const pbStr = group.estimatedPaybackYears === null
      ? '—'
      : group.estimatedPaybackYears < 1
        ? '< 1 yr'
        : group.estimatedPaybackYears.toFixed(1) + ' yrs';

    const polygonDetails = (polygonFeatures || [])
      .filter(f => (group.polygonIds || []).includes(f.properties?.id))
      .map(f => ({
        name: f.properties?.name || f.properties?.id,
        sqft: f.properties?.area_sqft || 0,
        effectiveWidthFt: f.properties?.effectiveWidthFt ?? null,
        widthBand: getFeatureWidthBand(f),
        gallonsPerSfYear: getFeatureGallonsPerSfYear(f, assumptions),
      }))
      .sort((a, b) => b.sqft - a.sqft);

    return {
      propertyName,
      groupName: group.name || 'Scenario',
      generatedDate,
      polygonCount: group.polygonCount,
      totalSquareFootage: group.totalSquareFootage,
      assumptions,
      derivedAnnualSavingsPerSf: derivedSavingsPerSf(assumptions),
      costPerSf: assumptions.costPerSf,
      rebatePerSf: assumptions.rebatePerSf,
      gallonsPerSfYear: assumptions.gallonsPerSfYear,
      waterRatePerKGal: assumptions.waterRatePerKGal,
      maintenancePerSfYear: assumptions.maintenancePerSfYear,
      annualGallonsAvoided: group.annualGallonsAvoided,
      annualWaterSavings: group.annualWaterSavings,
      annualMaintenanceSavings: group.annualMaintenanceSavings,
      estimatedAnnualSavings: group.estimatedAnnualSavings,
      grossConversionCost: group.grossConversionCost,
      estimatedConversionCost: group.estimatedConversionCost,
      rebateAmount: group.rebateAmount,
      netConversionCost: group.netConversionCost,
      costPer1000GalAvoided: group.costPer1000GalAvoided,
      assetLifeYears: ASSET_LIFE_YEARS,
      estimatedPaybackYears: group.estimatedPaybackYears,
      paybackStr: pbStr,
      polygonDetails,
      polygonIds: group.polygonIds || [],
    };
  }

  function getPolygonColor(status) {
    if (status === 'pinned-in') return '#10b981'; // green
    if (status === 'in-plan') return '#f59e0b'; // amber
    if (status === 'pinned-out' || status === 'excluded') return '#64748b'; // gray/slate
    return '#7eb8e0'; // blue (available)
  }

  function solveScenario(features, scenario) {
    var usable = (features || []).filter(function (feature) {
      var area = Number(feature && feature.properties && feature.properties.area_sqft);
      return Number.isFinite(area) && area > 0;
    });
    var pins = (scenario && scenario.pins) || {};
    var targetPct = Math.max(0, Math.min(100, Number((scenario && scenario.targetPct) || 0)));
    var totalSqFt = usable.reduce(function (sum, feature) {
      return sum + Number(feature.properties.area_sqft);
    }, 0);
    var targetSqFt = totalSqFt * targetPct / 100;
    var annualBudget = scenario && scenario.annualBudget != null
      ? Math.max(0, Number(scenario.annualBudget))
      : null;
    var assumptions = normaliseAssumptions((scenario && scenario.assumptions) || {});
    var netCostPerSqFt = Math.max(0, assumptions.costPerSf - assumptions.rebatePerSf);
    var selected = {};
    var excluded = {};
    var selectedSqFt = 0;
    var selectedAnnualGallons = 0;
    var selectedNetCost = 0;
    var totalAnnualGallons = usable.reduce(function (sum, feature) {
      return sum + Number(feature.properties.area_sqft) * getFeatureGallonsPerSfYear(feature, assumptions);
    }, 0);

    usable.forEach(function (feature) {
      var id = String(feature.properties.id || feature.id);
      if (pins[id] === 'in') {
        selected[id] = true;
        var pinnedArea = Number(feature.properties.area_sqft);
        selectedSqFt += pinnedArea;
        selectedAnnualGallons += pinnedArea * getFeatureGallonsPerSfYear(feature, assumptions);
        selectedNetCost += pinnedArea * netCostPerSqFt;
      } else if (pins[id] === 'out') {
        excluded[id] = true;
      }
    });

    usable
      .filter(function (feature) {
        var id = String(feature.properties.id || feature.id);
        return !selected[id] && !excluded[id];
      })
      .sort(function (a, b) {
        var aCost = computeOutputsForFeatures([a], assumptions, 1).costPer1000GalAvoided;
        var bCost = computeOutputsForFeatures([b], assumptions, 1).costPer1000GalAvoided;
        return Number(aCost) - Number(bCost)
          || Number(b.properties.area_sqft) - Number(a.properties.area_sqft);
      })
      .forEach(function (feature) {
        if (selectedSqFt >= targetSqFt) return;
        var area = Number(feature.properties.area_sqft);
        var annualGallons = area * getFeatureGallonsPerSfYear(feature, assumptions);
        var featureNetCost = area * netCostPerSqFt;
        if (annualBudget !== null && selectedNetCost + featureNetCost > annualBudget) return;
        var id = String(feature.properties.id || feature.id);
        selected[id] = true;
        selectedSqFt += area;
        selectedAnnualGallons += annualGallons;
        selectedNetCost += featureNetCost;
      });

    var statuses = {};
    var displayStatuses = {};
    usable.forEach(function (feature) {
      var id = String(feature.properties.id || feature.id);
      statuses[id] = excluded[id] ? 'excluded' : (selected[id] ? 'in-plan' : 'available');
      displayStatuses[id] = pins[id] === 'in'
        ? 'pinned-in'
        : pins[id] === 'out'
          ? 'pinned-out'
          : statuses[id];
    });
    return {
      statuses: statuses,
      displayStatuses: displayStatuses,
      selectedIds: Object.keys(selected),
      totalSqFt: totalSqFt,
      targetSqFt: targetSqFt,
      selectedSqFt: selectedSqFt,
      totalAnnualGallons: totalAnnualGallons,
      selectedAnnualGallons: selectedAnnualGallons,
      selectedNetCost: selectedNetCost,
      budgetLimited: annualBudget !== null && selectedSqFt < targetSqFt,
      attainmentPct: targetSqFt > 0 ? selectedSqFt / targetSqFt * 100 : 100
    };
  }

  window.VRTXeriscapeCore = {
    DEFAULT_COST_PER_SF,
    DEFAULT_REBATE_PER_SF,
    DEFAULT_GALLONS_PER_SF_YEAR,
    DEFAULT_WATER_RATE_PER_KGAL,
    DEFAULT_MAINTENANCE_PER_SF_YEAR,
    ASSET_LIFE_YEARS,
    WIDTH_BAND_RATIOS,
    WIDTH_BANDS,
    normaliseAssumptions,
    derivedSavingsPerSf,
    widthBandForEffectiveWidth,
    getFeatureWidthBand,
    getFeatureGallonsPerSfYear,
    computeOutputsForSquareFootage,
    computeOutputsForFeatures,
    computeGroupOutputs,
    buildGroupSummary,
    getPolygonColor,
    solveScenario
  };
})();
