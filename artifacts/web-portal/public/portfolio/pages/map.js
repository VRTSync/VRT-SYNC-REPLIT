/**
 * map.js — Portfolio Map page.
 * Registered as PortfolioRouter.register('map', fn).
 *
 * Shows every branch as a Leaflet pin (navy = no open WOs, amber = has WOs).
 * Group filter chips filter visible pins.
 * Clicking a pin fires the markerSelect event → branch card rendered in portal DOM.
 *
 * Pin rendering is delegated to VRTMapRenderer via addCustomLayer/showCustomLayers
 * so that no raw addLayers/showLayerIds calls live in this file.
 */
(function () {
  'use strict';

  var esc = (window.VRTUtils && window.VRTUtils.esc) || function (v) { return v == null ? '' : String(v); };

  // ── org param helper ─────────────────────────────────────────────────────────
  function orgParam() {
    var state = window.PortfolioState;
    if (state && state.organizationId) {
      return '?organizationId=' + encodeURIComponent(state.organizationId);
    }
    return '';
  }

  function apiFetch(path) {
    return fetch(path, { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  // ── Per-render cleanup ───────────────────────────────────────────────────────
  var _renderer   = null;
  var _pinVersion = 0;

  function _teardown() {
    if (_renderer) { _renderer.destroy(); _renderer = null; }
  }

  // ── Pin rendering via shared renderer ────────────────────────────────────────
  /**
   * Send branch pins to the map via VRTMapRenderer.addCustomLayer /
   * VRTMapRenderer.showCustomLayers so no raw addLayers/showLayerIds calls
   * live in this file.
   */
  function sendBranchPins(branches) {
    if (!_renderer) return;
    if (!branches || branches.length === 0) {
      _renderer.showCustomLayers([]);
      return;
    }
    _pinVersion++;
    var layerId  = 'portfolio-branches-v' + _pinVersion;
    var colorMap = {};
    branches.forEach(function (b) {
      colorMap[b.id] = b.openWorkOrders > 0 ? '#f59e0b' : '#0C1D31';
    });
    var geojson = {
      type: 'FeatureCollection',
      features: branches.map(function (b) {
        return {
          type: 'Feature',
          id: b.id,
          geometry: { type: 'Point', coordinates: [b.lng, b.lat] },
          properties: {
            featureId: b.id,
            label: (b.code ? b.code + ' \u2014 ' : '') + b.name,
            displayName: b.name,
            assetType: 'branch',
          },
        };
      }),
    };

    _renderer.addCustomLayer({
      id:               layerId,
      layerKey:         'branch',
      subLayerKey:      'controller', // enables per-feature colouring via controllerColorMap
      displayName:      'Branches',
      color:            '#0C1D31',
      controllerColorMap: colorMap,
      geojson:          geojson,
    });
    _renderer.showCustomLayers([layerId]);
    _renderer.fit();
  }

  // ── Group chips ──────────────────────────────────────────────────────────────
  function renderGroupChips(groups, activeGroupId, onSelect) {
    var chips = '<button class="pfm-chip' + (!activeGroupId ? ' pfm-chip--active' : '') + '" data-group="">All</button>';
    groups.forEach(function (g) {
      var active = g.id === activeGroupId ? ' pfm-chip--active' : '';
      chips += '<button class="pfm-chip' + active + '" data-group="' + esc(g.id) + '">' + esc(g.name) + '</button>';
    });
    var el = document.getElementById('pfm-chips');
    if (!el) return;
    el.innerHTML = chips;
    el.querySelectorAll('.pfm-chip').forEach(function (btn) {
      btn.addEventListener('click', function () {
        onSelect(btn.getAttribute('data-group') || null);
      });
    });
  }

  // ── Branch card ──────────────────────────────────────────────────────────────
  function renderBranchCard(branch, container) {
    var existing = document.getElementById('pfm-branch-card');
    if (existing) existing.remove();

    if (!branch) return;

    var card = document.createElement('div');
    card.id = 'pfm-branch-card';
    card.className = 'pfm-branch-card';
    card.innerHTML = ''
      + '<button class="pfm-card-close" id="pfm-card-close" aria-label="Close">✕</button>'
      + '<div class="pfm-card-code">' + esc(branch.code || '') + '</div>'
      + '<div class="pfm-card-name">' + esc(branch.name) + '</div>'
      + (branch.city ? '<div class="pfm-card-city">' + esc(branch.city) + '</div>' : '')
      + '<div class="pfm-card-stats">'
        + '<div class="pfm-stat"><span class="pfm-stat-val">' + esc(branch.servicesYtd != null ? branch.servicesYtd : '—') + '</span><span class="pfm-stat-lbl">Services YTD</span></div>'
        + '<div class="pfm-stat"><span class="pfm-stat-val pfm-stat-val--amber">' + esc(branch.openWorkOrders) + '</span><span class="pfm-stat-lbl">Open WOs</span></div>'
      + '</div>'
      + '<a class="pfm-card-link" id="pfm-open-branch" data-branch-id="' + esc(branch.id) + '" href="#">Open property map →</a>';

    container.appendChild(card);

    document.getElementById('pfm-card-close').addEventListener('click', function () {
      card.remove();
    });
    document.getElementById('pfm-open-branch').addEventListener('click', function (e) {
      e.preventDefault();
      if (window.PortfolioRouter) {
        PortfolioRouter.navigate('branch-detail', true, { id: branch.id });
      }
    });
  }

  // ── Unmapped list ────────────────────────────────────────────────────────────
  function renderUnmappedList(unmapped) {
    var el = document.getElementById('pfm-unmapped');
    if (!el) return;
    if (!unmapped || unmapped.length === 0) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.innerHTML = '<div class="pfm-unmapped-title">Not yet mapped (' + unmapped.length + ')</div>'
      + '<div class="pfm-unmapped-chips">'
      + unmapped.map(function (b) {
          return '<span class="pfm-unmapped-chip" title="' + esc(b.name) + '">'
            + (b.code ? esc(b.code) + ' — ' : '') + esc(b.name)
            + '</span>';
        }).join('')
      + '</div>';
  }

  // ── Main render ──────────────────────────────────────────────────────────────
  function renderMapPage(container, mapData, groups) {
    _teardown();
    if (window._portfolioMapCleanup) { window._portfolioMapCleanup(); }

    container.innerHTML = ''
      + '<div class="pfm-page">'
        + '<div class="pfm-header">'
          + '<h1>Portfolio Map</h1>'
          + '<div class="pfm-chips" id="pfm-chips"></div>'
        + '</div>'
        + '<div class="pfm-map-wrap" id="pfm-map-wrap">'
          + '<iframe id="pf-map-iframe" src="/leaflet-map.html" class="pfm-iframe" allowfullscreen></iframe>'
          + '<button class="pfm-map-expand-btn" id="pfm-map-expand-btn" title="Expand map" aria-label="Expand map" aria-pressed="false">'
            + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'
              + '<path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/>'
            + '</svg>'
          + '</button>'
        + '</div>'
        + '<div id="pfm-unmapped" class="pfm-unmapped" style="display:none"></div>'
      + '</div>';

    var mapWrap   = document.getElementById('pfm-map-wrap');
    var expandBtn = document.getElementById('pfm-map-expand-btn');
    var iframe    = document.getElementById('pf-map-iframe');

    // Expand/collapse and satellite toggle wired after renderer is created (below)

    var allBranches = mapData.branches || [];
    var allUnmapped = mapData.unmapped || [];
    var branchById  = {};
    allBranches.forEach(function (b) { branchById[b.id] = b; });

    var activeGroupId = null;

    function getFilteredBranches() {
      if (!activeGroupId) return allBranches;
      var groupBranchIds = null;
      groups.forEach(function (g) {
        if (g.id === activeGroupId) groupBranchIds = g.branchIds || [];
      });
      if (!groupBranchIds) return allBranches;
      return allBranches.filter(function (b) { return groupBranchIds.indexOf(b.id) !== -1; });
    }

    function onGroupSelect(groupId) {
      activeGroupId = groupId || null;
      renderGroupChips(groups, activeGroupId, onGroupSelect);
      sendBranchPins(getFilteredBranches());
      var card = document.getElementById('pfm-branch-card');
      if (card) card.remove();
    }

    // Null adapter — the portfolio map page doesn't render community layers;
    // it only renders branch pins via addCustomLayer.
    var nullAdapter = {
      fetchLayers:      function () { return Promise.resolve([]); },
      fetchLayerGeojson: function () { return Promise.resolve(null); },
      fetchControllers: function () { return Promise.resolve([]); },
    };

    _renderer = window.VRTMapRenderer.create({
      iframe:    iframe,
      adapter:   nullAdapter,
      hierarchy: {},
    });

    // Wire expand button and satellite toggle using shared helpers
    if (window.VRTMapRenderer) {
      if (mapWrap && expandBtn) {
        window.VRTMapRenderer.renderExpandButton(expandBtn, mapWrap, _renderer, 'pfm-map-wrap--expanded');
      }
      if (mapWrap) {
        window.VRTMapRenderer.renderSatelliteToggle(mapWrap, _renderer);
      }
    }

    _renderer.on('ready', function () {
      // Send initial pins once the map is ready
      sendBranchPins(getFilteredBranches());
    });

    _renderer.on('assetTap', function (data) {
      var branchId = data && (data.featureRef || data.featureId || data.label);
      if (branchId) {
        var branch = branchById[branchId];
        renderBranchCard(branch || null, mapWrap || container);
      }
    });

    // Load with no communityId — community is empty so only custom layers appear
    _renderer.load(null);

    renderGroupChips(groups, activeGroupId, onGroupSelect);
    renderUnmappedList(allUnmapped);

    window._portfolioMapCleanup = function () {
      _teardown();
      window._portfolioMapCleanup = null;
    };
  }

  // ── Register ──────────────────────────────────────────────────────────────────
  function register() {
    PortfolioRouter.register('map', function (container) {
      var orgSuffix = orgParam();
      var state  = window.PortfolioState || {};
      var groups = Array.isArray(state.groups) ? state.groups : [];

      container.innerHTML = '<div class="pf-spinner">Loading map\u2026</div>';

      apiFetch('/api/portfolio/map' + orgSuffix).then(function (mapData) {
        renderMapPage(container, mapData, groups);
      }).catch(function (err) {
        console.error('[portfolio/map] fetch failed:', err);
        container.innerHTML = '<div class="pf-empty">Failed to load portfolio map. Please refresh.</div>';
      });
    });
  }

  if (window.PortfolioRouter) {
    register();
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      if (window.PortfolioRouter) register();
    });
  }
})();
