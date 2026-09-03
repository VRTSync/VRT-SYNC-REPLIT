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

  function computeOutputsForSquareFootage(totalSquareFootage, assumptions, polygonCount) {
    const a = normaliseAssumptions(assumptions);
    const costPerSf = a.costPerSf;
    const gallonsPerSfYear = a.gallonsPerSfYear;
    const waterRatePerKGal = a.waterRatePerKGal;
    const maintenancePerSfYear = a.maintenancePerSfYear;
    const rebatePerSf = a.rebatePerSf;

    const annualGallonsAvoided = totalSquareFootage * gallonsPerSfYear;
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

  function computeGroupOutputs(polygonIds, assumptions, allFeatures) {
    const features = (allFeatures || []).filter(f => polygonIds.includes(f.properties?.id));
    const totalSquareFootage = features.reduce((sum, f) => {
      const area = Number(f.properties?.area_sqft);
      return Number.isFinite(area) && area > 0 ? sum + area : sum;
    }, 0);
    const polygonCount = features.length;
    return computeOutputsForSquareFootage(totalSquareFootage, assumptions, polygonCount);
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
      .map(f => ({ name: f.properties?.name || f.properties?.id, sqft: f.properties?.area_sqft || 0 }))
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
    if (status === 'in-plan') return '#f59e0b'; // amber
    if (status === 'excluded') return '#64748b'; // gray/slate
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

    usable.forEach(function (feature) {
      var id = String(feature.properties.id || feature.id);
      if (pins[id] === 'in') {
        selected[id] = true;
        selectedSqFt += Number(feature.properties.area_sqft);
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
        return Number(b.properties.area_sqft) - Number(a.properties.area_sqft);
      })
      .forEach(function (feature) {
        if (selectedSqFt >= targetSqFt) return;
        var area = Number(feature.properties.area_sqft);
        if (annualBudget !== null && (selectedSqFt + area) * netCostPerSqFt > annualBudget) return;
        var id = String(feature.properties.id || feature.id);
        selected[id] = true;
        selectedSqFt += area;
      });

    var statuses = {};
    usable.forEach(function (feature) {
      var id = String(feature.properties.id || feature.id);
      statuses[id] = excluded[id] ? 'excluded' : (selected[id] ? 'in-plan' : 'available');
    });
    return {
      statuses: statuses,
      selectedIds: Object.keys(selected),
      totalSqFt: totalSqFt,
      targetSqFt: targetSqFt,
      selectedSqFt: selectedSqFt,
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
    normaliseAssumptions,
    derivedSavingsPerSf,
    computeOutputsForSquareFootage,
    computeGroupOutputs,
    buildGroupSummary,
    getPolygonColor,
    solveScenario
  };
})();
