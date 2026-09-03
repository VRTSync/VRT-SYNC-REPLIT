/**
 * Water Savings location drill-down. The renderer and iframe are created once;
 * state changes update metrics and feature colors without rebuilding the map.
 */
(function () {
  'use strict';

  var esc = (window.VRTUtils && window.VRTUtils.esc) || function (value) { return value == null ? '' : String(value); };
  var store = window.VRTWaterScenario;
  var core = window.VRTXeriscapeCore;
  var renderer = null;
  var unsubscribe = null;
  var resizeObserver = null;
  var resizeTimer = null;
  var allFeatures = [];
  var locationFeatures = [];
  var communities = [];
  var communityId = null;
  var layerId = null;

  function orgSuffix() {
    var state = window.PortfolioState;
    return state && state.organizationId
      ? '?organizationId=' + encodeURIComponent(state.organizationId)
      : '';
  }

  function apiFetch(path) {
    return fetch(path, { credentials: 'same-origin' }).then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    });
  }

  function number(value) { return Math.round(Number(value || 0)).toLocaleString(); }
  function money(value) { return '$' + Math.round(Number(value || 0)).toLocaleString(); }

  function teardown() {
    if (unsubscribe) unsubscribe();
    if (resizeObserver) resizeObserver.disconnect();
    if (resizeTimer) clearTimeout(resizeTimer);
    if (renderer) renderer.destroy();
    unsubscribe = null;
    resizeObserver = null;
    resizeTimer = null;
    renderer = null;
    allFeatures = [];
    locationFeatures = [];
    communities = [];
    layerId = null;
    window._portfolioMapCleanup = null;
  }

  function currentLocation() {
    return communities.find(function (community) { return community.id === communityId; }) || null;
  }

  function updatePlanner(container, state) {
    var solution = core.solveScenario(allFeatures, state);
    var included = locationFeatures.filter(function (feature) {
      return solution.statuses[String(feature.properties.id || feature.id)] === 'in-plan';
    });
    var outputs = core.computeGroupOutputs(
      included.map(function (feature) { return String(feature.properties.id || feature.id); }),
      state.assumptions,
      locationFeatures
    );
    var totalLocationSqFt = locationFeatures.reduce(function (sum, feature) {
      return sum + (Number(feature.properties.area_sqft) || 0);
    }, 0);
    var portfolioIncluded = allFeatures.filter(function (feature) {
      return solution.statuses[String(feature.properties.id || feature.id)] === 'in-plan';
    });
    var portfolioOutputs = core.computeGroupOutputs(
      portfolioIncluded.map(function (feature) { return String(feature.properties.id || feature.id); }),
      state.assumptions,
      allFeatures
    );
    var metrics = container.querySelector('#wsl-metrics');
    if (metrics) {
      metrics.innerHTML = '<div><span>Area in plan</span><strong>' + number(outputs.totalSquareFootage) + ' ft²</strong></div>'
        + '<div><span>Gallons saved</span><strong>' + number(outputs.annualGallonsAvoided) + ' / yr</strong></div>'
        + '<div><span>Annual savings</span><strong>' + money(outputs.estimatedAnnualSavings) + '</strong></div>'
        + '<div><span>Net cost</span><strong>' + money(outputs.netConversionCost) + '</strong></div>'
        + '<div><span>Payback</span><strong>' + (outputs.estimatedPaybackYears == null ? '—' : outputs.estimatedPaybackYears.toFixed(1) + ' yrs') + '</strong></div>';
    }
    var contribution = container.querySelector('#wsl-contribution');
    if (contribution) {
      var share = portfolioOutputs.totalSquareFootage > 0
        ? outputs.totalSquareFootage / portfolioOutputs.totalSquareFootage * 100
        : 0;
      contribution.textContent = number(share) + '% of the portfolio plan · '
        + number(totalLocationSqFt) + ' ft² mapped at this location';
    }
    var areaList = container.querySelector('#wsl-area-list');
    if (areaList) {
      areaList.innerHTML = locationFeatures.map(function (feature) {
        var id = String(feature.properties.id || feature.id);
        var status = solution.statuses[id] || 'available';
        var override = state.pins[id];
        return '<button class="wsl-area-row ' + status + '" data-area-id="' + esc(id) + '">'
          + '<i style="background:' + core.getPolygonColor(status) + '"></i>'
          + '<span><strong>' + esc(feature.properties.name || 'Mapped area') + '</strong><small>'
          + number(feature.properties.area_sqft) + ' ft² · ' + (override ? 'Pinned ' + (override === 'in' ? 'in' : 'out') : status)
          + '</small></span></button>';
      }).join('') || '<div class="pf-empty">No mapped turf areas at this location.</div>';
      areaList.querySelectorAll('[data-area-id]').forEach(function (button) {
        button.addEventListener('click', function () { toggleArea(button.getAttribute('data-area-id')); });
      });
    }
    if (renderer && layerId) {
      var colorMap = {};
      locationFeatures.forEach(function (feature) {
        var id = String(feature.properties.id || feature.id);
        colorMap[id] = core.getPolygonColor(solution.statuses[id] || 'available');
      });
      renderer.setFeatureColors(layerId, colorMap, core.getPolygonColor('available'));
    }
  }

  function toggleArea(id) {
    var pin = store.get().pins[id];
    store.setPin(id, pin === 'out' ? 'in' : pin === 'in' ? null : 'out');
  }

  function renderShell(container) {
    var location = currentLocation();
    var currentIndex = communities.findIndex(function (community) { return community.id === communityId; });
    var prev = communities[(currentIndex - 1 + communities.length) % communities.length];
    var next = communities[(currentIndex + 1) % communities.length];
    var options = communities.map(function (community) {
      return '<option value="' + esc(community.id) + '"' + (community.id === communityId ? ' selected' : '') + '>'
        + esc((community.code ? community.code + ' · ' : '') + community.name) + '</option>';
    }).join('');
    container.innerHTML = '<div class="wsl-page">'
      + '<a class="wsl-back" href="/web/portfolio/water-savings' + window.location.search + '">← Back to portfolio summary</a>'
      + '<div class="wsl-header"><div><h1>' + esc(location ? location.name : 'Water Savings Planner') + '</h1><span>' + esc(location && location.code ? location.code : 'Location planner') + '</span></div>'
        + '<div class="wsl-location-nav"><button id="wsl-prev" aria-label="Previous location">‹</button><select id="wsl-location-select">' + options + '</select><button id="wsl-next" aria-label="Next location">›</button></div>'
      + '</div>'
      + '<div class="wsl-layout">'
        + '<div class="wsl-map-wrap" id="wsl-map-wrap"><iframe id="wsl-map" src="/leaflet-map.html" title="Mapped turf areas"></iframe><div class="wsl-legend"><span><i class="in-plan"></i>In plan</span><span><i class="available"></i>Available</span><span><i class="excluded"></i>Excluded</span></div></div>'
        + '<aside class="wsl-rail">'
          + '<section><h2>Selection</h2><p id="wsl-contribution"></p><button id="wsl-clear">Clear location overrides</button></section>'
          + '<section><h2>Estimated Summary</h2><div class="wsl-metrics" id="wsl-metrics"></div></section>'
          + '<section class="wsl-areas"><h2>Areas</h2><div id="wsl-area-list"></div></section>'
          + '<section class="wsl-note"><strong>Portfolio-wide assumptions</strong><p>Costs and savings use the shared scenario. Excluding an area here immediately changes the portfolio summary.</p></section>'
        + '</aside>'
      + '</div></div>';

    container.querySelector('.wsl-back').addEventListener('click', function (event) {
      event.preventDefault();
      PortfolioRouter.navigate('water-savings', true, {});
    });
    container.querySelector('#wsl-location-select').addEventListener('change', function (event) {
      PortfolioRouter.navigate('water-savings-location', true, { id: event.target.value });
    });
    container.querySelector('#wsl-prev').addEventListener('click', function () {
      if (prev) PortfolioRouter.navigate('water-savings-location', true, { id: prev.id });
    });
    container.querySelector('#wsl-next').addEventListener('click', function () {
      if (next) PortfolioRouter.navigate('water-savings-location', true, { id: next.id });
    });
    container.querySelector('#wsl-clear').addEventListener('click', function () {
      locationFeatures.forEach(function (feature) {
        store.setPin(String(feature.properties.id || feature.id), null);
      });
    });
  }

  function setupMap(container) {
    var iframe = container.querySelector('#wsl-map');
    var mapWrap = container.querySelector('#wsl-map-wrap');
    layerId = 'water-savings-turf-' + communityId;
    renderer = window.VRTMapRenderer.create({
      iframe: iframe,
      adapter: {
        fetchLayers: function () { return Promise.resolve([]); },
        fetchLayerGeojson: function () { return Promise.resolve(null); },
        fetchControllers: function () { return Promise.resolve([]); }
      },
      hierarchy: {}
    });
    renderer.on('ready', function () {
      renderer.addCustomLayer({
        id: layerId,
        layerKey: 'community',
        subLayerKey: 'bluegrass_area',
        displayName: 'Mapped turf',
        color: core.getPolygonColor('available'),
        directTap: true,
        geojson: { type: 'FeatureCollection', features: locationFeatures }
      });
      renderer.showCustomLayers([layerId]);
      var points = [];
      function collect(value) {
        if (!Array.isArray(value)) return;
        if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
          points.push(value);
          return;
        }
        value.forEach(collect);
      }
      locationFeatures.forEach(function (feature) { collect(feature.geometry && feature.geometry.coordinates); });
      if (points.length) {
        var lngs = points.map(function (point) { return point[0]; });
        var lats = points.map(function (point) { return point[1]; });
        renderer.cmdToIframe('fitBounds', [[Math.min.apply(null, lats), Math.min.apply(null, lngs)], [Math.max.apply(null, lats), Math.max.apply(null, lngs)]]);
      }
      updatePlanner(container, store.get());
    });
    renderer.on('assetTap', function (payload) {
      var id = payload && (payload.featureRef || payload.featureId);
      if (id) toggleArea(String(id));
    });
    renderer.load(null);
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () { if (renderer) renderer.invalidateSize(); }, 120);
      });
      resizeObserver.observe(mapWrap);
    }
  }

  function renderRoute(container, params) {
    teardown();
    var requestedCommunityId = params && params.id;
    communityId = requestedCommunityId;
    if (!communityId) {
      container.innerHTML = '<div class="pf-empty">No location ID specified.</div>';
      return;
    }
    container.innerHTML = '<div class="pf-spinner">Loading location planner…</div>';
    var cached = store.getPolygonCache(300000);
    Promise.all([
      apiFetch('/api/portfolio/water-savings' + orgSuffix()),
      cached ? Promise.resolve(cached) : apiFetch('/api/portfolio/water-savings/polygons' + orgSuffix()).then(store.setPolygonCache)
    ]).then(function (results) {
      if (PortfolioRouter.getCurrentRoute() !== 'water-savings-location'
          || PortfolioRouter.getParams().id !== requestedCommunityId) return;
      communities = results[0].communities || [];
      if (!communities.some(function (community) { return community.id === communityId; })) {
        throw new Error('HTTP 404');
      }
      allFeatures = results[1].features || [];
      locationFeatures = allFeatures.filter(function (feature) {
        return feature.properties.communityId === communityId;
      });
      renderShell(container);
      setupMap(container);
      unsubscribe = store.subscribe(function (state) { updatePlanner(container, state); });
      window._portfolioMapCleanup = teardown;
      updatePlanner(container, store.get());
    }).catch(function (err) {
      if (PortfolioRouter.getCurrentRoute() !== 'water-savings-location'
          || PortfolioRouter.getParams().id !== requestedCommunityId) return;
      console.error('[portfolio/water-savings-location]', err);
      container.innerHTML = '<div class="pf-empty">Location not found or unavailable.</div>';
    });
  }

  PortfolioRouter.register('water-savings-location', renderRoute);
})();