/**
 * map.js — Portfolio Map page.
 * Registered as PortfolioRouter.register('map', fn).
 *
 * Shows every branch as a Leaflet pin (navy = no open WOs, amber = has WOs).
 * Group filter chips filter visible pins.
 * Clicking a pin fires viewAssetDetail → branch card rendered in portal DOM.
 *
 * Branch pins are sent as a GeoJSON FeatureCollection via addLayers, using
 * subLayerKey:'controller' + controllerColorMap for per-pin colour.
 * A bridge extension (e.g. setBranchPins) would be cleaner for a future slice
 * but would require modifying the shared Leaflet template.
 *
 * The branch card popup is rendered in the portal DOM (not inside the iframe).
 */
(function () {
  'use strict';

  var esc = (window.VRTUtils && window.VRTUtils.esc) || function (v) { return v == null ? '' : String(v); };

  // ── org param helper ────────────────────────────────────────────────────────
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

  // ── Iframe / postMessage bridge ─────────────────────────────────────────────
  var _iframeReady = false;
  var _pendingCmds = [];
  var _iframeEl = null;
  var _msgHandler = null;

  function getIframe() { return _iframeEl || document.getElementById('pf-map-iframe'); }

  function cmdToIframe(fn) {
    var args = Array.prototype.slice.call(arguments, 1);
    var iframe = getIframe();
    if (!iframe || !iframe.contentWindow) return;
    if (!_iframeReady) { _pendingCmds.push({ fn: fn, args: args }); return; }
    iframe.contentWindow.postMessage({ type: 'cmd', fn: fn, args: args }, '*');
  }

  function flushPending() {
    var cmds = _pendingCmds.slice();
    _pendingCmds = [];
    cmds.forEach(function (c) { cmdToIframe.apply(null, [c.fn].concat(c.args)); });
  }

  function setupIframe(onBranchPin) {
    _msgHandler = function (e) {
      if (!e.data) return;
      // Leaflet template serialises every message with JSON.stringify
      var msg;
      if (typeof e.data === 'string') {
        try { msg = JSON.parse(e.data); } catch (_) { return; }
      } else {
        msg = e.data;
      }
      // mapReady fires multiple times (retries) — only flush once
      if (msg.type === 'mapReady') {
        if (!_iframeReady) {
          _iframeReady = true;
          flushPending();
        }
      } else if (msg.type === 'markerSelect' && msg.data) {
        // Branch pin clicked (popup just opened) — msg.data.featureRef === branch.id.
        // markerSelect is emitted by the template on popupopen, before the user
        // clicks "View Details", so the portal card appears on the first tap.
        onBranchPin(msg.data.featureRef || msg.data.label);
      }
    };
    window.addEventListener('message', _msgHandler);
  }

  function teardownIframe() {
    if (_msgHandler) { window.removeEventListener('message', _msgHandler); _msgHandler = null; }
    _iframeReady = false;
    _pendingCmds = [];
    _iframeEl = null;
  }

  // ── Pin rendering ───────────────────────────────────────────────────────────
  var _pinVersion = 0;

  /**
   * Send branch pins to the iframe as a GeoJSON FeatureCollection.
   * Uses subLayerKey:'controller' + controllerColorMap for per-pin colour.
   * Navy (#0C1D31) = no open WOs; amber (#f59e0b) = has open WOs.
   */
  function sendBranchPins(branches) {
    if (!branches || branches.length === 0) return;
    _pinVersion++;
    var layerId = 'portfolio-branches-v' + _pinVersion;
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
            label: (b.code ? b.code + ' — ' : '') + b.name,
            displayName: b.name,
            assetType: 'branch',
          },
        };
      }),
    };
    // addLayers caches by id; showLayerIds hides old layers and shows new one
    cmdToIframe('addLayers', [{
      id: layerId,
      layerKey: 'branch',
      subLayerKey: 'controller', // enables controllerColorMap per-feature colouring
      displayName: 'Branches',
      color: '#0C1D31',
      controllerColorMap: colorMap,
      geojson: geojson,
    }]);
    cmdToIframe('showLayerIds', [layerId]);
    cmdToIframe('fitToContent', [], null);
  }

  // ── Group chips ─────────────────────────────────────────────────────────────
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

  // ── Branch card ─────────────────────────────────────────────────────────────
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

  // ── Unmapped list ───────────────────────────────────────────────────────────
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

  // ── Main render ─────────────────────────────────────────────────────────────
  function renderMapPage(container, mapData, groups) {
    // Clean up any existing listener
    if (window._portfolioMapCleanup) window._portfolioMapCleanup();

    container.innerHTML = ''
      + '<div class="pfm-page">'
        + '<div class="pfm-header">'
          + '<h1>Portfolio Map</h1>'
          + '<div class="pfm-chips" id="pfm-chips"></div>'
        + '</div>'
        + '<div class="pfm-map-wrap" id="pfm-map-wrap">'
          + '<iframe id="pf-map-iframe" src="/leaflet-map.html" class="pfm-iframe" allowfullscreen></iframe>'
        + '</div>'
        + '<div id="pfm-unmapped" class="pfm-unmapped" style="display:none"></div>'
      + '</div>';

    _iframeEl = document.getElementById('pf-map-iframe');

    var allBranches = mapData.branches || [];
    var allUnmapped = mapData.unmapped || [];
    var branchById = {};
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
      // Close any open branch card
      var card = document.getElementById('pfm-branch-card');
      if (card) card.remove();
    }

    function onBranchPin(branchId) {
      var branch = branchById[branchId];
      var wrap = document.getElementById('pfm-map-wrap');
      renderBranchCard(branch || null, wrap || container);
    }

    setupIframe(onBranchPin);
    // When iframe is ready, send pins
    _pendingCmds.push({ fn: 'addLayers', args: [] }); // no-op — real send happens below
    _pendingCmds.pop();
    // Queue actual pin send (will flush on mapReady)
    var filtered = getFilteredBranches();
    if (filtered.length > 0) {
      _pinVersion++;
      var layerId = 'portfolio-branches-v' + _pinVersion;
      var colorMap = {};
      filtered.forEach(function (b) { colorMap[b.id] = b.openWorkOrders > 0 ? '#f59e0b' : '#0C1D31'; });
      _pendingCmds.push({ fn: 'addLayers', args: [[{
        id: layerId,
        layerKey: 'branch',
        subLayerKey: 'controller',
        displayName: 'Branches',
        color: '#0C1D31',
        controllerColorMap: colorMap,
        geojson: {
          type: 'FeatureCollection',
          features: filtered.map(function (b) {
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
        },
      }]] });
      _pendingCmds.push({ fn: 'showLayerIds', args: [[layerId]] });
      _pendingCmds.push({ fn: 'fitToContent', args: [[], null] });
    }

    renderGroupChips(groups, activeGroupId, onGroupSelect);
    renderUnmappedList(allUnmapped);

    window._portfolioMapCleanup = function () {
      teardownIframe();
      window._portfolioMapCleanup = null;
    };
  }

  // ── Register ────────────────────────────────────────────────────────────────
  function register() {
    PortfolioRouter.register('map', function (container, params) {
      // Reset iframe state for fresh mount
      _iframeReady = false;
      _pendingCmds = [];
      _iframeEl = null;

      var orgSuffix = orgParam();
      var state = window.PortfolioState || {};
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
