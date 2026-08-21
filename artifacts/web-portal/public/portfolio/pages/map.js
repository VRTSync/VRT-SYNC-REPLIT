/**
 * map.js — Portfolio Map page.
 * Registered as PortfolioRouter.register('map', fn).
 *
 * Layout: left control rail (~344px) | right map (flex 1).
 *
 * Rail sections (top→bottom):
 *   1. Filter by group — multi-select checkboxes (unchecking all = show all pins)
 *   2. Show toggles — "Locations with open work" / "Serviced this week"
 *   3. Selected location card — filled on pin click; placeholder when empty
 *   4. Layer breakdown — asset totals per visible group for the filtered set
 *
 * Pin rendering still goes through VRTMapRenderer.sendBranchPins (no fork).
 * No extra network request is made beyond /api/portfolio/map.
 *
 * `servicedThisWeek` was added to /api/portfolio/map (storage.getBranchMapPoints)
 * for this feature — it checks task_completions and service_visits in the last
 * 7 days via a single batch query and avoids a separate API call.
 *
 * Group filter behaviour: unchecking all groups resets to showing all pins
 * (equivalent to "All locations" — the empty selection is treated as "no group
 * constraint").
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
  var _renderer        = null;
  var _pinVersion      = 0;
  var _resizeObserver  = null;
  var _resizeTimer     = null;

  function _teardown() {
    if (_resizeObserver) { _resizeObserver.disconnect(); _resizeObserver = null; }
    if (_resizeTimer)    { clearTimeout(_resizeTimer);   _resizeTimer    = null; }
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
    var layerId = 'portfolio-branches-v' + _pinVersion;
    // Pin building/colouring is shared with the dashboard preview — one copy only.
    window.VRTMapRenderer.sendBranchPins(_renderer, branches, layerId);
    _renderer.fit();
  }

  // ── Group rail checkboxes ────────────────────────────────────────────────────
  function renderGroupRail(groups, allBranches, activeGroupIds, onGroupToggle) {
    var el = document.getElementById('pfm-rail-groups');
    if (!el) return;

    // Compute per-group branch count
    var groupCountMap = {};
    groups.forEach(function (g) {
      var ids = g.branchIds || [];
      groupCountMap[g.id] = allBranches.filter(function (b) {
        return ids.indexOf(b.id) !== -1;
      }).length;
    });
    var totalCount = allBranches.length;

    // "All locations" total row
    var allChecked = activeGroupIds.size === 0;
    var html = '<label class="pfm-group-row pfm-group-row--all' + (allChecked ? ' pfm-group-row--checked' : '') + '">'
      + '<input type="checkbox" class="pfm-group-cb" data-group="" ' + (allChecked ? 'checked' : '') + '>'
      + '<span class="pfm-group-swatch" style="background:#0C1D31"></span>'
      + '<span class="pfm-group-name">All locations</span>'
      + '<span class="pfm-group-count">' + totalCount + '</span>'
      + '</label>';

    groups.forEach(function (g, idx) {
      var color = g.color || _groupColor(idx);
      var checked = activeGroupIds.has(g.id);
      html += '<label class="pfm-group-row' + (checked ? ' pfm-group-row--checked' : '') + '">'
        + '<input type="checkbox" class="pfm-group-cb" data-group="' + esc(g.id) + '" ' + (checked ? 'checked' : '') + '>'
        + '<span class="pfm-group-swatch" style="background:' + esc(color) + '"></span>'
        + '<span class="pfm-group-name">' + esc(g.name) + '</span>'
        + '<span class="pfm-group-count">' + (groupCountMap[g.id] || 0) + '</span>'
        + '</label>';
    });

    el.innerHTML = html;

    el.querySelectorAll('.pfm-group-cb').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var groupId = cb.getAttribute('data-group');
        onGroupToggle(groupId || null, cb.checked);
      });
    });
  }

  // Fallback colour via shared palette (window.VRTGroupColors loaded before this script)
  function _groupColor(idx) {
    var palette = window.VRTGroupColors && window.VRTGroupColors.GROUP_PALETTE;
    if (palette) return palette[idx % palette.length];
    // Ultra-safe fallback: blue
    return '#3b82f6';
  }

  // ── Show toggles ─────────────────────────────────────────────────────────────
  function renderShowToggles(filteredBranches, showOpenWork, showServicedWeek, onToggle) {
    var openCount = filteredBranches.filter(function (b) { return b.openWorkOrders > 0; }).length;
    var svcCount  = filteredBranches.filter(function (b) { return b.servicedThisWeek; }).length;

    var el = document.getElementById('pfm-rail-toggles');
    if (!el) return;

    el.innerHTML = ''
      + '<label class="pfm-toggle-row' + (showOpenWork ? ' pfm-toggle-row--on' : '') + '">'
      + '<span class="pfm-toggle-dot pfm-toggle-dot--amber"></span>'
      + '<span class="pfm-toggle-label">Locations with open work</span>'
      + '<span class="pfm-toggle-count">' + openCount + '</span>'
      + '<input type="checkbox" class="pfm-toggle-cb" data-toggle="openWork" ' + (showOpenWork ? 'checked' : '') + '>'
      + '<span class="pfm-toggle-switch' + (showOpenWork ? ' pfm-toggle-switch--on' : '') + '"></span>'
      + '</label>'
      + '<label class="pfm-toggle-row' + (showServicedWeek ? ' pfm-toggle-row--on' : '') + '">'
      + '<span class="pfm-toggle-dot pfm-toggle-dot--green"></span>'
      + '<span class="pfm-toggle-label">Serviced this week</span>'
      + '<span class="pfm-toggle-count">' + svcCount + '</span>'
      + '<input type="checkbox" class="pfm-toggle-cb" data-toggle="servicedWeek" ' + (showServicedWeek ? 'checked' : '') + '>'
      + '<span class="pfm-toggle-switch' + (showServicedWeek ? ' pfm-toggle-switch--on' : '') + '"></span>'
      + '</label>';

    el.querySelectorAll('.pfm-toggle-cb').forEach(function (cb) {
      cb.addEventListener('change', function () {
        onToggle(cb.getAttribute('data-toggle'), cb.checked);
      });
    });
  }

  // ── Selected location card (in rail) ─────────────────────────────────────────
  function renderRailCard(branch) {
    var el = document.getElementById('pfm-rail-card');
    if (!el) return;

    if (!branch) {
      el.innerHTML = '<div class="pfm-card-placeholder">'
        + '<div class="pfm-card-placeholder-icon">📍</div>'
        + '<div class="pfm-card-placeholder-text">Click a pin to see location details</div>'
        + '</div>';
      return;
    }

    // Format last service date
    var lastSvcHtml = '';
    if (branch.lastServiceAt) {
      var d = new Date(branch.lastServiceAt);
      var dateStr = isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      lastSvcHtml = '<div class="pfm-card-last-svc">'
        + '<span class="pfm-card-last-svc-lbl">Last service</span>'
        + '<span class="pfm-card-last-svc-val">' + esc(dateStr) + (branch.lastServiceLabel ? ' · ' + esc(branch.lastServiceLabel) : '') + '</span>'
        + '</div>';
    }

    el.innerHTML = ''
      + '<div class="pfm-rail-card-inner">'
      + (branch.code ? '<div class="pfm-card-code">' + esc(branch.code) + '</div>' : '')
      + '<div class="pfm-card-name">' + esc(branch.name) + '</div>'
      + (branch.address ? '<div class="pfm-card-city">' + esc(branch.address) + '</div>'
         : branch.city ? '<div class="pfm-card-city">' + esc(branch.city) + '</div>' : '')
      + '<div class="pfm-card-stats">'
        + '<div class="pfm-stat"><span class="pfm-stat-val">' + esc(branch.assetCount != null ? branch.assetCount : '—') + '</span><span class="pfm-stat-lbl">Assets</span></div>'
        + '<div class="pfm-stat"><span class="pfm-stat-val">' + esc(branch.servicesYtd != null ? branch.servicesYtd : '—') + '</span><span class="pfm-stat-lbl">Services YTD</span></div>'
        + '<div class="pfm-stat"><span class="pfm-stat-val pfm-stat-val--amber">' + esc(branch.openWorkOrders) + '</span><span class="pfm-stat-lbl">Open WOs</span></div>'
      + '</div>'
      + lastSvcHtml
      + '<button class="pfm-card-link" id="pfm-open-branch" data-branch-id="' + esc(branch.id) + '">Open property map →</button>'
      + '</div>';

    document.getElementById('pfm-open-branch').addEventListener('click', function () {
      if (window.PortfolioRouter) {
        PortfolioRouter.navigate('branch-detail', true, { id: branch.id });
      }
    });
  }

  // ── Layer breakdown ───────────────────────────────────────────────────────────
  /**
   * Sums `branch.layerCounts` (asset totals per map-layer category: Landscape,
   * Irrigation, Snow, Trees) across the currently filtered set. layerCounts is
   * populated server-side from the assets table so the colours and names are
   * authoritative — no group-membership proxy is used here.
   */
  function renderLayerBreakdown(filteredBranches, groups, activeGroupIds) {
    var el = document.getElementById('pfm-rail-breakdown');
    if (!el) return;

    // Heading scope label
    var scopeLabel = 'All locations';
    if (activeGroupIds.size === 1) {
      activeGroupIds.forEach(function (gId) {
        groups.forEach(function (g) { if (g.id === gId) scopeLabel = g.name; });
      });
    } else if (activeGroupIds.size > 1) {
      scopeLabel = activeGroupIds.size + ' groups';
    }

    el.querySelector('.pfm-breakdown-heading').textContent = 'Layer breakdown · ' + scopeLabel;

    var rowsEl = el.querySelector('.pfm-breakdown-rows');
    if (!rowsEl) return;

    if (filteredBranches.length === 0) {
      rowsEl.innerHTML = '<div class="pfm-breakdown-empty">No locations in filter</div>';
      return;
    }

    // Accumulate layer totals across all filtered branches.
    // Each branch carries a layerCounts array: [{ key, name, count, color }].
    var layerTotals = {}; // key → { name, color, count }
    filteredBranches.forEach(function (b) {
      var lcs = b.layerCounts;
      if (!Array.isArray(lcs)) return;
      lcs.forEach(function (lc) {
        if (!layerTotals[lc.key]) {
          layerTotals[lc.key] = { name: lc.name, color: lc.color, count: 0 };
        }
        layerTotals[lc.key].count += lc.count;
      });
    });

    var rows = Object.values(layerTotals).filter(function (r) { return r.count > 0; });

    // Fallback: show total asset count if no per-layer data is available
    if (rows.length === 0) {
      var total = filteredBranches.reduce(function (s, b) { return s + (b.assetCount || 0); }, 0);
      rows = [{ name: 'Total assets', color: '#0C1D31', count: total }];
    }

    var locLabel = filteredBranches.length + ' location' + (filteredBranches.length === 1 ? '' : 's');
    rowsEl.innerHTML = ''
      + '<div class="pfm-breakdown-scope">' + esc(locLabel) + '</div>'
      + rows.map(function (r) {
          return '<div class="pfm-breakdown-row">'
            + '<span class="pfm-breakdown-swatch" style="background:' + esc(r.color) + '"></span>'
            + '<span class="pfm-breakdown-label">' + esc(r.name) + '</span>'
            + '<span class="pfm-breakdown-count">' + r.count + '</span>'
            + '</div>';
        }).join('');
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
        + '<div class="pfm-body">'
          // ── Left rail ──
          + '<div class="pfm-rail" id="pfm-rail">'
            + '<div class="pfm-rail-head"><h1>Portfolio Map</h1></div>'
            + '<div class="pfm-rail-body">'

              // 1. Filter by group
              + '<div class="pfm-rail-section">'
                + '<div class="pfm-rail-section-title">Filter by group</div>'
                + '<div id="pfm-rail-groups"></div>'
              + '</div>'

              // 2. Show toggles
              + '<div class="pfm-rail-section">'
                + '<div class="pfm-rail-section-title">Show</div>'
                + '<div id="pfm-rail-toggles"></div>'
              + '</div>'

              // 3. Selected location card
              + '<div class="pfm-rail-section pfm-rail-section--card">'
                + '<div class="pfm-rail-section-title">Selected location</div>'
                + '<div id="pfm-rail-card"></div>'
              + '</div>'

              // 4. Layer breakdown
              + '<div class="pfm-rail-section pfm-rail-section--breakdown" id="pfm-rail-breakdown">'
                + '<div class="pfm-breakdown-heading pfm-rail-section-title">Layer breakdown</div>'
                + '<div class="pfm-breakdown-rows"></div>'
              + '</div>'

            + '</div>'
          + '</div>'

          // ── Right: map area ──
          + '<div class="pfm-map-area">'
            + '<div class="pfm-map-wrap" id="pfm-map-wrap">'
              + '<iframe id="pf-map-iframe" src="/leaflet-map.html" class="pfm-iframe" allowfullscreen></iframe>'
              + '<button class="pfm-map-expand-btn" id="pfm-map-expand-btn" title="Expand map" aria-label="Expand map" aria-pressed="false">'
                + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'
                  + '<path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/>'
                + '</svg>'
              + '</button>'
            + '</div>'
            + '<div id="pfm-unmapped" class="pfm-unmapped" style="display:none"></div>'
          + '</div>'
        + '</div>'
      + '</div>';

    var mapWrap   = document.getElementById('pfm-map-wrap');
    var expandBtn = document.getElementById('pfm-map-expand-btn');
    var iframe    = document.getElementById('pf-map-iframe');

    var allBranches = mapData.branches || [];
    var allUnmapped = mapData.unmapped || [];
    var branchById  = {};
    allBranches.forEach(function (b) { branchById[b.id] = b; });

    // ── Filter state ──────────────────────────────────────────────────────────
    // activeGroupIds: Set of group IDs currently checked.
    // Empty set means "no group constraint" → show all pins.
    var activeGroupIds   = new Set();
    var showOpenWork     = false;
    var showServicedWeek = false;
    var selectedBranch   = null;

    function getFilteredBranches() {
      var result = allBranches;

      // Group filter (intersection of selected groups union)
      if (activeGroupIds.size > 0) {
        var allowedIds = {};
        groups.forEach(function (g) {
          if (!activeGroupIds.has(g.id)) return;
          (g.branchIds || []).forEach(function (id) { allowedIds[id] = true; });
        });
        result = result.filter(function (b) { return allowedIds[b.id]; });
      }

      // Show-filter: open work
      if (showOpenWork) {
        result = result.filter(function (b) { return b.openWorkOrders > 0; });
      }

      // Show-filter: serviced this week
      if (showServicedWeek) {
        result = result.filter(function (b) { return b.servicedThisWeek; });
      }

      return result;
    }

    function refreshAll() {
      var filtered = getFilteredBranches();
      sendBranchPins(filtered);
      renderGroupRail(groups, allBranches, activeGroupIds, onGroupToggle);
      renderShowToggles(filtered, showOpenWork, showServicedWeek, onShowToggle);
      renderLayerBreakdown(filtered, groups, activeGroupIds);
      // If the selected branch is no longer in the filtered set, clear it
      if (selectedBranch && !filtered.some(function (b) { return b.id === selectedBranch.id; })) {
        selectedBranch = null;
      }
      renderRailCard(selectedBranch);
    }

    function onGroupToggle(groupId, checked) {
      if (groupId === null) {
        // "All locations" checkbox — clear all group selections
        activeGroupIds.clear();
      } else {
        if (checked) {
          activeGroupIds.add(groupId);
        } else {
          activeGroupIds.delete(groupId);
        }
      }
      refreshAll();
    }

    function onShowToggle(toggleKey, checked) {
      if (toggleKey === 'openWork')     showOpenWork     = checked;
      if (toggleKey === 'servicedWeek') showServicedWeek = checked;
      refreshAll();
    }

    // ── Map renderer ──────────────────────────────────────────────────────────
    // Null adapter — the portfolio map page doesn't render community layers;
    // it only renders branch pins via addCustomLayer.
    var nullAdapter = {
      fetchLayers:       function () { return Promise.resolve([]); },
      fetchLayerGeojson: function () { return Promise.resolve(null); },
      fetchControllers:  function () { return Promise.resolve([]); },
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

    // Attach ResizeObserver so the map repaints when the flex layout resizes
    if (mapWrap && typeof ResizeObserver !== 'undefined') {
      _resizeObserver = new ResizeObserver(function () {
        clearTimeout(_resizeTimer);
        _resizeTimer = setTimeout(function () {
          if (_renderer) { _renderer.invalidateSize(); }
        }, 120);
      });
      _resizeObserver.observe(mapWrap);
    }

    _renderer.on('ready', function () {
      sendBranchPins(getFilteredBranches());
    });

    _renderer.on('assetTap', function (data) {
      var branchId = data && (data.featureRef || data.featureId || data.label);
      if (branchId) {
        selectedBranch = branchById[branchId] || null;
        renderRailCard(selectedBranch);
      }
    });

    // Load with no communityId — community is empty so only custom layers appear
    _renderer.load(null);

    // Initial render of all rail sections
    refreshAll();
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
