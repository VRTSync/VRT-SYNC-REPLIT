/**
 * Water Savings portfolio summary. Both this page and the location planner use
 * VRTWaterScenario and VRTXeriscapeCore; neither owns a second calculation path.
 */
(function () {
  'use strict';

  var esc = (window.VRTUtils && window.VRTUtils.esc) || function (value) { return value == null ? '' : String(value); };
  var store = window.VRTWaterScenario;
  var core = window.VRTXeriscapeCore;
  var unsubscribe = null;
  var summary = null;
  var polygons = null;
  var scenarios = [];
  var TIER_PRESETS = {
    rock: {
      name: 'Rock & mulch',
      costPerSf: 6,
      rebatePerSf: 1,
      description: 'lowest cost per gallon · limited curb appeal, no ESG story'
    },
    colorado: {
      name: 'ColoradoScape',
      costPerSf: 10,
      rebatePerSf: 3.25,
      description: 'pollinator habitat · appropriate at a branch frontage'
    }
  };

  function orgSuffix() {
    var state = window.PortfolioState;
    return state && state.organizationId
      ? '?organizationId=' + encodeURIComponent(state.organizationId)
      : '';
  }

  function apiFetch(path, options) {
    return fetch(path, Object.assign({ credentials: 'same-origin' }, options || {})).then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.status === 204 ? null : response.json();
    });
  }

  function money(value) {
    return '$' + Math.round(Number(value || 0)).toLocaleString();
  }

  function preciseMoney(value) {
    return Number.isFinite(Number(value)) ? '$' + Number(value).toFixed(2) : '—';
  }

  function number(value) {
    return Math.round(Number(value || 0)).toLocaleString();
  }

  function percent(value) {
    return Number(value || 0).toFixed(1) + '%';
  }

  function compactGallons(value) {
    var gallons = Number(value || 0);
    if (gallons >= 1000000) return (gallons / 1000000).toFixed(2).replace(/\.?0+$/, '') + 'M';
    if (gallons >= 1000) return (gallons / 1000).toFixed(1).replace(/\.?0+$/, '') + 'K';
    return number(gallons);
  }

  function years(value) {
    return value == null ? '—' : Number(value).toFixed(1) + ' yrs';
  }

  function tierIsModified(tier, assumptions) {
    var preset = TIER_PRESETS[tier] || TIER_PRESETS.rock;
    return Number(assumptions.costPerSf) !== preset.costPerSf
      || Number(assumptions.rebatePerSf) !== preset.rebatePerSf;
  }

  function comparisonText(outputs, waterRate) {
    var waterPrice = 'Water price ' + preciseMoney(waterRate) + ' / 1,000 gal · ';
    if (outputs.costPer1000GalAvoided == null) return waterPrice + 'No avoided gallons to compare';
    var difference = Number(waterRate) - Number(outputs.costPer1000GalAvoided);
    if (difference > 0) return waterPrice + preciseMoney(difference) + ' cheaper than buying it';
    if (difference < 0) return waterPrice + preciseMoney(Math.abs(difference)) + ' above the water price';
    return waterPrice + 'At the water price';
  }

  function plural(count, singular, pluralWord) {
    return count + ' ' + (count === 1 ? singular : (pluralWord || singular + 's'));
  }

  function attainmentMessage(solution, rows, targetPct) {
    var reduction = solution.totalSqFt > 0 ? solution.selectedSqFt / solution.totalSqFt * 100 : 0;
    var selectedAreas = solution.selectedIds.length;
    var affectedLocations = rows.filter(function (row) { return row.outputs.totalSquareFootage > 0; }).length;
    var areasLabel = plural(selectedAreas, 'area');
    var locationsLabel = plural(affectedLocations, 'location');
    if (solution.selectedSqFt >= solution.targetSqFt) {
      return 'Target met — ' + percent(reduction) + ' reduction from ' + areasLabel + ' across ' + locationsLabel;
    }
    return 'Falls short — ' + percent(reduction) + ' reduction of the ' + number(targetPct) + '% target from ' + areasLabel + ' across ' + locationsLabel;
  }

  function features() {
    return polygons && Array.isArray(polygons.features) ? polygons.features : [];
  }

  function selectedFeatures(solution) {
    var selected = solution.statuses;
    return features().filter(function (feature) {
      return selected[String(feature.properties.id || feature.id)] === 'in-plan';
    });
  }

  function locationRows(solution, state) {
    var byCommunity = {};
    features().forEach(function (feature) {
      var communityId = feature.properties.communityId;
      if (!byCommunity[communityId]) byCommunity[communityId] = [];
      byCommunity[communityId].push(feature);
    });
    return (summary.communities || []).map(function (community) {
      var all = byCommunity[community.id] || [];
      var included = all.filter(function (feature) {
        return solution.statuses[String(feature.properties.id || feature.id)] === 'in-plan';
      });
      var totals = core.computeGroupOutputs(
        included.map(function (feature) { return String(feature.properties.id || feature.id); }),
        state.assumptions,
        all
      );
      var turfSqFt = all.reduce(function (sum, feature) {
        return sum + (Number(feature.properties.area_sqft) || 0);
      }, 0);
      return { community: community, features: all, included: included, outputs: totals, turfSqFt: turfSqFt };
    });
  }

  function render(container, state) {
    if (!summary || !polygons) return;
    var solution = core.solveScenario(features(), state);
    var portfolioOutputs = core.computeGroupOutputs(
      selectedFeatures(solution).map(function (feature) { return String(feature.properties.id || feature.id); }),
      state.assumptions,
      features()
    );
    var rows = locationRows(solution, state);
    var scenarioOptions = '<option value="">Unsaved scenario</option>' + scenarios.map(function (scenario) {
      return '<option value="' + esc(scenario.id) + '"' + (scenario.id === state.id ? ' selected' : '') + '>'
        + esc(scenario.name) + '</option>';
    }).join('');

    var tiles = rows.map(function (row) {
      var share = row.turfSqFt > 0 ? Math.round(row.outputs.totalSquareFootage / row.turfSqFt * 100) : 0;
      return '<button class="ws-location-tile" data-community-id="' + esc(row.community.id) + '">'
        + '<span class="ws-location-code">' + esc(row.community.code || 'Location') + '</span>'
        + '<strong>' + esc(row.community.name) + '</strong>'
        + '<span>' + number(row.turfSqFt) + ' ft² mapped turf</span>'
        + '<span class="ws-tile-meter"><i style="width:' + share + '%"></i></span>'
        + '<span>' + share + '% in current plan · ' + number(row.outputs.annualGallonsAvoided) + ' gal/yr</span>'
        + '</button>';
    }).join('') || '<div class="pf-empty">No locations are assigned to this organization.</div>';

    var overview = rows.filter(function (row) { return row.turfSqFt > 0; }).map(function (row) {
      var share = row.turfSqFt > 0 ? Math.round(row.outputs.totalSquareFootage / row.turfSqFt * 100) : 0;
      return '<button class="ws-overview-block" data-community-id="' + esc(row.community.id) + '"'
        + ' aria-label="' + esc(row.community.name + ': ' + share + '% in current plan') + '"'
        + ' data-turf-sqft="' + esc(row.turfSqFt) + '" data-plan-share="' + esc(share) + '"'
        + ' style="flex-grow:' + Math.max(row.turfSqFt, 1) + '">'
        + '<span>' + esc(row.community.code || row.community.name) + '</span>'
        + '<i style="height:' + share + '%"></i>'
        + '<b>' + share + '%</b>'
        + '</button>';
    }).join('') || '<div class="pf-empty">Mapped turf will appear here when available.</div>';

    var tableRows = rows.map(function (row) {
      return '<tr class="clickable" data-community-id="' + esc(row.community.id) + '">'
        + '<td class="bcode">' + esc(row.community.code || '—') + '</td>'
        + '<td><strong>' + esc(row.community.name) + '</strong></td>'
        + '<td class="num">' + number(row.turfSqFt) + '</td>'
        + '<td class="num">' + number(row.outputs.totalSquareFootage) + '</td>'
        + '<td class="num">' + number(row.outputs.annualGallonsAvoided) + '</td>'
        + '<td class="num">' + money(row.outputs.netConversionCost) + '</td>'
        + '<td class="num">' + (row.outputs.estimatedPaybackYears == null ? '—' : row.outputs.estimatedPaybackYears.toFixed(1) + ' yrs') + '</td>'
        + '</tr>';
    }).join('');

    var a = state.assumptions;
    var payback = years(portfolioOutputs.estimatedPaybackYears);
    var tierCards = Object.keys(TIER_PRESETS).map(function (tier) {
      var preset = TIER_PRESETS[tier];
      var selected = state.tier === tier;
      var modified = selected && tierIsModified(tier, a);
      return '<button type="button" class="ws-tier-card' + (selected ? ' selected' : '') + (modified ? ' modified' : '') + '"'
        + ' data-tier="' + tier + '" aria-pressed="' + (selected ? 'true' : 'false') + '">'
        + '<span class="ws-tier-card-top"><strong>' + preset.name + '</strong>'
        + '<span class="ws-tier-status">' + (modified ? 'Modified' : selected ? 'Selected' : 'Select') + '</span></span>'
        + '<span class="ws-tier-price">' + preciseMoney(preset.costPerSf) + ' / ft²</span>'
        + '<span class="ws-tier-rebate">' + preciseMoney(preset.rebatePerSf) + ' / ft² rebate</span>'
        + '<span class="ws-tier-description">' + preset.description + '</span>'
        + '</button>';
    }).join('');
    container.innerHTML = '<div class="ws-page">'
      + '<div class="ctx ws-title-row"><div><h1>Water Savings Planner</h1><span class="sub">Portfolio summary</span></div>'
      + '<div class="ws-save-state ' + esc(state.persistence) + '">' + esc(state.persistence === 'saving' ? 'Saving…' : state.persistence === 'saved' ? 'Saved' : state.persistence === 'dirty' ? 'Unsaved changes' : '') + '</div></div>'
      + '<div class="ws-kpis">'
        + '<div class="ws-kpi teal" data-kpi="gallons-avoided"><span>Gallons avoided</span><strong>' + compactGallons(portfolioOutputs.annualGallonsAvoided) + '</strong><small>' + number(portfolioOutputs.annualGallonsAvoided) + ' gallons per year</small></div>'
        + '<div class="ws-kpi hero" data-kpi="cost-per-1000"><span>Cost per 1,000 gal avoided</span><strong>' + preciseMoney(portfolioOutputs.costPer1000GalAvoided) + '</strong><small>' + comparisonText(portfolioOutputs, a.waterRatePerKGal) + '</small></div>'
        + '<div class="ws-kpi green" data-kpi="annual-savings"><span>Annual savings</span><strong>' + money(portfolioOutputs.estimatedAnnualSavings) + '/yr</strong><small>water + maintenance</small></div>'
        + '<div class="ws-kpi amber" data-kpi="net-capital-cost"><span>Net capital cost</span><strong>' + money(portfolioOutputs.netConversionCost) + '</strong><small>after ' + money(portfolioOutputs.rebateAmount) + ' rebate</small></div>'
        + '<div class="ws-kpi quiet" data-kpi="payback"><span>Payback</span><strong>' + payback + '</strong><small>simple, undiscounted</small></div>'
      + '</div>'
      + '<section class="panel ws-target-panel p-teal"><div class="panel-head"><h2>Portfolio target</h2><span class="hint">Tune the reduction goal for this plan</span></div><div class="ws-target-body">'
        + '<div class="ws-target-value"><strong id="ws-target-label">' + number(state.targetPct) + '%</strong><span>annual turf conversion target</span></div>'
        + '<div class="ws-target-slider"><label for="ws-target">Target percentage</label><input id="ws-target" type="range" min="0" max="100" step="1" value="' + esc(state.targetPct) + '" aria-describedby="ws-attainment"></div>'
        + '<p id="ws-attainment" class="ws-attainment ' + (solution.selectedSqFt >= solution.targetSqFt ? 'met' : 'short') + '">' + attainmentMessage(solution, rows, state.targetPct) + '</p>'
      + '</div></section>'
      + '<section class="panel ws-tier-panel p-amber"><div class="panel-head"><h2>Conversion tier</h2><span class="hint">Choose the finish and rebate together</span></div><div class="ws-tier-cards">' + tierCards + '</div></section>'
      + '<div class="ws-summary-grid">'
        + '<section class="panel ws-scenario-panel"><div class="panel-head"><h2>Scenario controls</h2></div><div class="ws-panel-body">'
          + '<label>Saved scenario<select id="ws-scenario-select">' + scenarioOptions + '</select></label>'
          + '<label>Scenario name<input id="ws-name" value="' + esc(state.name) + '" maxlength="120"></label>'
          + '<label>Annual budget<input id="ws-budget" type="number" min="0" step="1000" placeholder="No budget limit" value="' + esc(state.annualBudget == null ? '' : state.annualBudget) + '"></label>'
          + '<div class="ws-button-row"><button class="ws-primary" id="ws-save">Save scenario</button><button id="ws-new">New scenario</button><button id="ws-clear">Clear overrides</button></div>'
        + '</div></section>'
        + '<section class="panel ws-assumptions"><div class="panel-head"><h2>Shared savings assumptions</h2></div><div class="ws-panel-body ws-assumption-grid">'
          + '<label>Conversion cost / ft²<input data-assumption="costPerSf" type="number" min="0" step=".01" value="' + esc(a.costPerSf) + '"></label>'
          + '<label>Rebate / ft²<input data-assumption="rebatePerSf" type="number" min="0" step=".01" value="' + esc(a.rebatePerSf) + '"></label>'
          + '<label>Gallons saved / ft² / yr<input data-assumption="gallonsPerSfYear" type="number" min="0" step=".1" value="' + esc(a.gallonsPerSfYear) + '"></label>'
          + '<label>Water rate / 1,000 gal<input data-assumption="waterRatePerKGal" type="number" min="0" step=".01" value="' + esc(a.waterRatePerKGal) + '"></label>'
          + '<label>Maintenance saved / ft² / yr<input data-assumption="maintenancePerSfYear" type="number" min="0" step=".01" value="' + esc(a.maintenancePerSfYear) + '"></label>'
          + '<p>These assumptions apply to every location in this scenario.</p>'
          + '<p class="ws-honesty"><strong>Modelled, not metered.</strong> Gallons avoided are estimated from mapped area × gallons saved per ft² per year; load water invoices to calibrate against actual consumption per branch.</p>'
        + '</div></section>'
      + '</div>'
      + '<section class="panel"><div class="panel-head"><h2>Portfolio overview</h2><span class="hint">Block size = mapped turf · fill = share in plan</span></div><div class="ws-overview">' + overview + '</div></section>'
      + '<section><div class="ws-section-head"><h2>Locations</h2><span>Select a tile to inspect mapped areas</span></div><div class="ws-location-tiles">' + tiles + '</div></section>'
      + '<section class="panel ws-table-panel"><div class="panel-head"><h2>Location rollup</h2></div><div class="pa-table-scroll"><table><thead><tr><th>Code</th><th>Location</th><th class="num">Mapped turf ft²</th><th class="num">In plan ft²</th><th class="num">Gallons / yr</th><th class="num">Net cost</th><th class="num">Payback</th></tr></thead><tbody>' + tableRows + '</tbody></table></div></section>'
      + '</div>';
    wire(container, state);
  }

  function wire(container, state) {
    container.querySelectorAll('[data-community-id]').forEach(function (element) {
      element.addEventListener('click', function () {
        PortfolioRouter.navigate('water-savings-location', true, { id: element.getAttribute('data-community-id') });
      });
    });
    container.querySelector('#ws-target').addEventListener('input', function (event) { store.setTarget(event.target.value); });
    container.querySelector('#ws-target').addEventListener('change', function (event) { store.setTarget(event.target.value); });
    container.querySelectorAll('[data-tier]').forEach(function (card) {
      card.addEventListener('click', function () { store.setTier(card.getAttribute('data-tier')); });
    });
    container.querySelector('#ws-budget').addEventListener('change', function (event) { store.setBudget(event.target.value); });
    container.querySelector('#ws-name').addEventListener('change', function (event) { store.setName(event.target.value); });
    container.querySelectorAll('[data-assumption]').forEach(function (input) {
      input.addEventListener('change', function () {
        var assumptions = Object.assign({}, state.assumptions);
        assumptions[input.getAttribute('data-assumption')] = Number(input.value);
        store.setAssumptions(assumptions);
      });
    });
    container.querySelector('#ws-scenario-select').addEventListener('change', function (event) {
      var selected = scenarios.find(function (scenario) { return scenario.id === event.target.value; });
      if (selected) store.hydrate(selected);
    });
    container.querySelector('#ws-new').addEventListener('click', function () { store.reset(); });
    container.querySelector('#ws-clear').addEventListener('click', function () { store.clearPins(); });
    container.querySelector('#ws-save').addEventListener('click', function () {
      store.save(orgSuffix()).then(function () {
        return apiFetch('/api/portfolio/water-savings/scenarios' + orgSuffix());
      }).then(function (items) {
        scenarios = items || [];
        render(container, store.get());
      }).catch(function () {
        render(container, store.get());
      });
    });
  }

  function renderRoute(container) {
    if (unsubscribe) unsubscribe();
    container.innerHTML = '<div class="pf-spinner">Loading Water Savings Planner…</div>';
    var cached = store.getPolygonCache(300000);
    Promise.all([
      apiFetch('/api/portfolio/water-savings' + orgSuffix()),
      cached ? Promise.resolve(cached) : apiFetch('/api/portfolio/water-savings/polygons' + orgSuffix()).then(store.setPolygonCache),
      apiFetch('/api/portfolio/water-savings/scenarios' + orgSuffix())
    ]).then(function (results) {
      if (PortfolioRouter.getCurrentRoute() !== 'water-savings') return;
      summary = results[0];
      polygons = results[1];
      scenarios = results[2] || [];
      unsubscribe = store.subscribe(function (state) { render(container, state); });
      window._portfolioMapCleanup = function () {
        if (unsubscribe) unsubscribe();
        unsubscribe = null;
        window._portfolioMapCleanup = null;
      };
      render(container, store.get());
    }).catch(function (err) {
      if (PortfolioRouter.getCurrentRoute() !== 'water-savings') return;
      console.error('[portfolio/water-savings]', err);
      container.innerHTML = '<div class="pf-empty">Failed to load Water Savings Planner. Please refresh.</div>';
    });
  }

  PortfolioRouter.register('water-savings', renderRoute);
})();