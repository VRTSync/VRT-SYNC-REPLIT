/**
 * branch-detail.js — Branch Portfolio "Branch Detail" page.
 * Registered as PortfolioRouter.register('branch-detail', fn).
 *
 * Map rendering is delegated to VRTMapRenderer (common/map-render.js).
 * Page keeps chrome only: selector block, title row, tab bar, sub-layer overlay,
 * expand-in-place button, KPI strips, inventory tables, service history.
 */
(function () {
  'use strict';

  var esc = (window.VRTUtils && window.VRTUtils.esc) || function (v) { return v == null ? '' : String(v); };

  // ── Demo presentation flag ─────────────────────────────────────────────────
  var SHOW_WORK_ORDER_DATES = false;

  /**
   * Ordered list of main layer categories.
   */
  var LAYER_HIERARCHY = [
    { key: 'community',  label: 'Site Grounds' },
    { key: 'irrigation', label: 'Irrigation'   },
    { key: 'snow',       label: 'Snow'          },
    { key: 'trees',      label: 'Trees'         },
  ];

  // LAYER_HIERARCHY as a map keyed by category key (passed to renderer)
  var HIERARCHY_MAP = (function () {
    var map = {};
    LAYER_HIERARCHY.forEach(function (cat) {
      // Sub-layer entries are populated from branch data; colour comes from renderer defaults
      map[cat.key] = [];
    });
    return map;
  })();

  /** Return tab accent class set for a main-layer category key. */
  function categoryAccent(key) {
    if (key === 'irrigation') return { cls: 't-blue',  panel: 'p-blue',  invcBorder: 'b-blue'  };
    if (key === 'trees')      return { cls: 't-green', panel: 'p-green', invcBorder: 'b-green' };
    if (key === 'community')  return { cls: 't-lime',  panel: 'p-green', invcBorder: 'b-lime'  };
    if (key === 'snow')       return { cls: 't-slate', panel: 'p-slate', invcBorder: 'b-gray'  };
    return { cls: '', panel: '', invcBorder: 'b-teal' };
  }

  // ── Per-branch renderer state ─────────────────────────────────────────────
  var _renderer       = null;
  var _activeTabIdx   = 0;
  var _categoryOrder  = [];
  var _categoryGroups = {};
  var _checkedSubLayers = {}; // { [categoryKey]: { [layerId]: bool } }
  var _container      = null;
  var _bMapPanel      = null; // #branch-map-panel — used to sync overlay on tab switch

  function _teardown() {
    if (_renderer) { _renderer.destroy(); _renderer = null; }
    _activeTabIdx   = 0;
    _categoryOrder  = [];
    _categoryGroups = {};
    _checkedSubLayers = {};
    _container      = null;
    _bMapPanel      = null;
  }

  // ── Accent/colour helpers ─────────────────────────────────────────────────
  var _HEX_RE = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;
  function _isValidHex(s) { return typeof s === 'string' && _HEX_RE.test(s.trim()); }

  var _SUBLAYER_DEFAULT_COLORS = {
    'bluegrass_area':   '#2E8B57',
    'native_area':      '#8F9779',
    'landscape_bed':    '#8B5A2B',
    'pet_station':      '#1ABC9C',
    'backflow':         '#00BFFF',
    'controller':       '#25C1AC',
    'zone':             '#3498db',
    'master_valve':     '#1F4E79',
    'flow_meter':       '#00CED1',
    'qc_iso_valve':     '#87CEEB',
    'isolation_valve':  '#F39C12',
    'quick_connect':    '#E67E22',
    'wire_splice':      '#9B59B6',
    'plow':             '#4A90E2',
    'atv':              '#6A5ACD',
    'hand_shovel':      '#E83E8C',
    'ice_melt':         '#FF8C00',
    'slicer':           '#D62828',
    'storage_area':     '#708090',
    'tree':             '#006400',
  };

  function _dotHex(accent) {
    var map = { blue: '#3b82f6', green: '#10b981', teal: '#25C1AC', gray: '#9ca3af', lime: '#84cc16', slate: '#64748b' };
    return (accent && map[accent.dot]) || '#25C1AC';
  }

  function _layerColor(layer) {
    var raw = layer && layer.color;
    if (_isValidHex(raw)) return raw.trim();
    var subKey = layer && (layer.subLayerKey || layer.type);
    if (subKey && _SUBLAYER_DEFAULT_COLORS[subKey]) return _SUBLAYER_DEFAULT_COLORS[subKey];
    return '#888888';
  }

  // ── Org param helper ───────────────────────────────────────────────────────
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

  // ── Date helpers ───────────────────────────────────────────────────────────
  function fmtDate(isoStr) {
    if (!isoStr) return '—';
    try {
      var d = new Date(isoStr);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch (_) { return isoStr; }
  }

  function fmtMoney(cents) {
    if (cents == null) return '';
    return '$' + (cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  // ── Group helpers ──────────────────────────────────────────────────────────
  var GROUP_COLORS = ['g1', 'g2', 'g3', 'g4', 'g5'];
  function groupColorClass(idx) { return GROUP_COLORS[idx % GROUP_COLORS.length]; }

  function buildGroupLookup(groups) {
    var map = {};
    (groups || []).forEach(function (g, idx) { map[g.id] = { name: g.name, colorIdx: idx }; });
    return map;
  }

  function layerAccent(layer) {
    var name = (layer.name || '').toLowerCase();
    var type = (layer.type || '').toLowerCase();
    var combined = name + ' ' + type;
    if (/irrig/.test(combined))          return { cls: 't-blue',  panel: 'p-blue',  invcBorder: 'b-blue',  dot: 'blue'  };
    if (/tree|arbo/.test(combined))      return { cls: 't-green', panel: 'p-green', invcBorder: 'b-green', dot: 'green' };
    if (/turf|ground|lawn|grass|landscape|bed/.test(combined)) {
                                         return { cls: 't-lime',  panel: 'p-green', invcBorder: 'b-lime',  dot: 'green' };
    }
    if (/snow|winter|ice/.test(combined)) return { cls: 't-slate', panel: 'p-slate', invcBorder: 'b-gray', dot: 'gray' };
    return                                        { cls: '',        panel: '',        invcBorder: 'b-teal', dot: 'teal' };
  }

  // ── Category label helper ─────────────────────────────────────────────────
  function _categoryLabel(key) {
    for (var i = 0; i < LAYER_HIERARCHY.length; i++) {
      if (LAYER_HIERARCHY[i].key === key) return LAYER_HIERARCHY[i].label;
    }
    return key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ');
  }

  // ── Build category groups from service layers ─────────────────────────────
  function _buildCategoryGroups(serviceLayers) {
    var groups = {};
    var order  = [];
    var seen   = {};
    LAYER_HIERARCHY.forEach(function (cat) {
      var group = serviceLayers.filter(function (l) { return l.type === cat.key; });
      if (group.length > 0) { groups[cat.key] = group; order.push(cat.key); seen[cat.key] = true; }
    });
    serviceLayers.forEach(function (l) {
      if (!seen[l.type]) {
        if (!groups[l.type]) { groups[l.type] = []; order.push(l.type); }
        groups[l.type].push(l);
        seen[l.type] = true;
      }
    });
    return { groups: groups, order: order };
  }

  // ── Tab switching ─────────────────────────────────────────────────────────
  function _switchToTab(tabIdx) {
    if (!_renderer) return;
    _activeTabIdx = tabIdx;
    _updateSublayerOverlay(tabIdx);
    _renderer.invalidateSize();
    var categoryKey;
    if (tabIdx === 0) {
      _updateMapPanelTitle('Property Map');
      _renderer.setActiveCategory(null); // null = show all layers (summary)
      categoryKey = null;
    } else {
      categoryKey = _categoryOrder[tabIdx - 1];
      if (!categoryKey) return;
      _updateMapPanelTitle(_categoryLabel(categoryKey) + ' Map');
      _renderer.setActiveCategory(categoryKey);
    }
    // Keep the expanded overlay's active category in sync with the page tab bar
    if (_bMapPanel) {
      _bMapPanel.dispatchEvent(new CustomEvent('vrt-sync-overlay-category', {
        bubbles: false, detail: { activeCategory: categoryKey }
      }));
    }
  }

  function _updateMapPanelTitle(title) {
    if (!_container) return;
    var el = _container.querySelector('#bmap-panel-title');
    if (el) el.textContent = title;
  }

  // ── Sub-layer overlay ─────────────────────────────────────────────────────
  function _updateSublayerOverlay(tabIdx) {
    if (!_container) return;
    var overlay = _container.querySelector('#bmap-sublayer-overlay');
    if (!overlay) return;
    if (tabIdx === 0) { overlay.innerHTML = ''; return; }
    var categoryKey = (_categoryOrder || [])[tabIdx - 1];
    if (!categoryKey) { overlay.innerHTML = ''; return; }
    var catLayers = (_categoryGroups && _categoryGroups[categoryKey]) || [];
    overlay.innerHTML = renderSubLayerPanel(categoryKey, catLayers);

    overlay.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var ck  = cb.getAttribute('data-category-key');
        var lid = cb.getAttribute('data-layer-id');
        if (!ck || !lid) return;
        if (!_checkedSubLayers[ck]) _checkedSubLayers[ck] = {};
        _checkedSubLayers[ck][lid] = cb.checked;
        _syncCategoryVisibility(ck);
      });
    });
  }

  function _syncCategoryVisibility(categoryKey) {
    if (!_renderer) return;
    var catLayers = (_categoryGroups && _categoryGroups[categoryKey]) || [];
    var checked   = _checkedSubLayers[categoryKey] || {};

    // Build stateForCat keyed by subLayerKey for the renderer
    var stateForCat = {};
    catLayers.forEach(function (l) {
      var subKey = l.subLayerKey || l.type;
      if (subKey) stateForCat[subKey] = !!checked[l.id];
    });
    _renderer.setVisibleSubLayers(stateForCat);
  }

  // ── Renderer setup ─────────────────────────────────────────────────────────
  function setupBranchRenderer(container, data, branchId) {
    _teardown();
    _container = container;

    var layers        = data.layers || [];
    var serviceLayers = layers.filter(function (l) { return l.type !== 'outline'; });
    var catResult     = _buildCategoryGroups(serviceLayers);
    _categoryOrder    = catResult.order;
    _categoryGroups   = catResult.groups;

    // Build hierarchy map for renderer (sub-layers per category)
    var hierarchyMap = {};
    _categoryOrder.forEach(function (key) {
      hierarchyMap[key] = (_categoryGroups[key] || []).map(function (l) {
        return { key: l.subLayerKey || l.type || key, label: l.name, color: _layerColor(l) };
      });
    });

    // Initialize checked sub-layers: layers with hasGeometry start checked
    _checkedSubLayers = {};
    _categoryOrder.forEach(function (key) {
      _checkedSubLayers[key] = {};
      (_categoryGroups[key] || []).forEach(function (l) {
        _checkedSubLayers[key][l.id] = !!l.hasGeometry;
      });
    });

    var slot = container.querySelector('#bmap-stable');
    if (!slot) return;

    var iframe = document.createElement('iframe');
    iframe.src = '/leaflet-map.html';
    iframe.className = 'branch-map-iframe';
    iframe.setAttribute('allowfullscreen', 'true');
    slot.appendChild(iframe);

    // Handle iframe reload (navigate away and back)
    iframe.addEventListener('load', function () {
      // The renderer's handler will fire mapReady on next ready message
    });

    var suffix = orgParam();

    // Portfolio adapter (org-scoped)
    var portfolioAdapter = {
      fetchLayers: function (communityId) {
        // Branch detail API returns layers inline; build the list from branch data
        var layerList = (data.layers || []).map(function (l) {
          return {
            id:           l.id,
            layerKey:     l.type || 'community',
            subLayerKey:  l.subLayerKey || l.type || 'community',
            displayName:  l.name,
            name:         l.name,
            type:         l.type,
            color:        l.color,
            isEnabled:    true,
            hasGeometry:  l.hasGeometry,
            assetCount:   l.assetCount,
          };
        });
        return Promise.resolve(layerList);
      },
      fetchLayerGeojson: function (layerId) {
        var url = '/api/portfolio/branches/' + encodeURIComponent(branchId)
          + '/layers/' + encodeURIComponent(layerId) + '/geojson' + suffix;
        return apiFetch(url).catch(function () { return null; });
      },
      fetchControllers: function (communityId) {
        var url = '/api/portfolio/branches/' + encodeURIComponent(branchId)
          + '/controllers' + suffix;
        return apiFetch(url).catch(function () { return []; });
      },
    };

    _renderer = window.VRTMapRenderer.create({
      iframe:    iframe,
      adapter:   portfolioAdapter,
      hierarchy: hierarchyMap,
    });

    // Wire satellite toggle and expand button now that renderer instance exists
    var _bPanel    = container.querySelector('#branch-map-panel');
    _bMapPanel     = _bPanel; // expose to _switchToTab for overlay sync
    var _bExpBtn   = container.querySelector('#bmap-expand-btn');
    var _bHeadCtrl = container.querySelector('#bmap-head-controls');

    if (window.VRTMapRenderer && _bHeadCtrl) {
      window.VRTMapRenderer.renderSatelliteToggle(_bHeadCtrl, _renderer);
    }
    if (window.VRTMapRenderer && _bExpBtn && _bPanel) {
      window.VRTMapRenderer.renderExpandButton(_bExpBtn, _bPanel, _renderer, 'bmap-panel--expanded');
    }

    // Inject expanded floating overlay + wire panel listeners ONCE per page
    // render. Layer data (_categoryOrder/_categoryGroups/_checkedSubLayers)
    // is available synchronously from branch data, so this must NOT live in
    // the 'ready' handler — a re-emitted 'ready' would attach duplicate
    // listeners and double-fire every toggle.
    if (window.VRTMapRenderer && _bPanel) {
      var _bLayerState = {
        categoryOrder:    _categoryOrder,
        categoryGroups:   _categoryGroups,
        checkedSubLayers: _checkedSubLayers,
        activeCategory:   null,
      };
      window.VRTMapRenderer.renderExpandedOverlays(
        _bPanel, _renderer, _bLayerState, 'bmap-panel--expanded'
      );

      // Sync expanded overlay → tab bar (real-time category switch)
      _bPanel.addEventListener('vrt-overlay-category-change', function (e) {
        var cat = e.detail.activeCategory;
        var idx = _categoryOrder.indexOf(cat) + 1;
        if (idx > 0) { _activeTabIdx = idx; _syncTabUI(idx); }
      });

      // Sync expanded overlay → checked sub-layers (real-time toggle)
      _bPanel.addEventListener('vrt-overlay-sublayer-change', function (e) {
        var cat = e.detail.cat;
        var lid = e.detail.layerId;
        if (cat && lid !== undefined) {
          if (!_checkedSubLayers[cat]) _checkedSubLayers[cat] = {};
          _checkedSubLayers[cat][lid] = e.detail.checked;
          _updateSublayerOverlay(_activeTabIdx);
        }
      });

      // Sync collapsed state → tab bar + sub-layer overlay
      _bPanel.addEventListener('layer-state-change', function (e) {
        var detail = e.detail;
        if (detail.activeCategory) {
          var idx2 = _categoryOrder.indexOf(detail.activeCategory) + 1;
          if (idx2 > 0) { _activeTabIdx = idx2; _syncTabUI(idx2); }
        }
        if (detail.checkedSubLayers) {
          Object.keys(detail.checkedSubLayers).forEach(function (cat) {
            _checkedSubLayers[cat] = {};
            var src = detail.checkedSubLayers[cat];
            Object.keys(src).forEach(function (k) { _checkedSubLayers[cat][k] = src[k]; });
          });
          _updateSublayerOverlay(_activeTabIdx);
        }
      });
    }

    // First-load behaviour ('ready' → Summary, all layers, fit) must be
    // single-shot per branch. The leaflet iframe posts 'mapReady' with a
    // retry schedule (up to ~5s), so 'ready' can arrive late or replay after
    // a re-initialisation — long after the user has switched tabs or toggled
    // sub-layers. Any ready after the first (or after the user has navigated
    // off Summary) RESTORES the current selection instead of resetting it.
    // _initialReadyDone lives in this closure, so it naturally resets when a
    // new branch is rendered (setupBranchRenderer runs again).
    var _initialReadyDone = false;

    _renderer.on('ready', function () {
      var isInitial = !_initialReadyDone;
      _initialReadyDone = true;

      if (isInitial && _activeTabIdx === 0) {
        // First load: Summary tab, all layers visible, fit to content.
        _updateSublayerOverlay(0);
        _renderer.setActiveCategory(null);
        return;
      }

      // Restore the user's current tab, category, and sub-layer selections.
      // On the first ready this may still fit (the user navigated to a
      // category before data finished loading — fitting that category is
      // first-load behaviour). On any replayed ready, never refit: the user
      // may have panned/zoomed, and their viewport must be preserved.
      var fitOpts = { fit: isInitial };
      _updateSublayerOverlay(_activeTabIdx);
      if (_activeTabIdx === 0) {
        _renderer.setActiveCategory(null, fitOpts);
      } else {
        var restoreCat = _categoryOrder[_activeTabIdx - 1];
        if (restoreCat) {
          _renderer.setActiveCategory(restoreCat, fitOpts);
          _syncCategoryVisibility(restoreCat);
        } else {
          _renderer.setActiveCategory(null, fitOpts);
        }
      }
    });

    _renderer.load(branchId);
  }

  // ── Branch Selector block ──────────────────────────────────────────────────
  function renderSelectorBlock(currentBranchId, allBranches) {
    var current    = null;
    var currentIdx = 0;
    allBranches.forEach(function (b, idx) {
      if (b.id === currentBranchId) { current = b; currentIdx = idx; }
    });

    var label = current ? esc(current.name) : '—';
    var code  = current ? esc(current.code || '') : '';

    var menuItems = '<div class="bsel-item all" id="bs-all-link">← All Locations'
      + '<span class="bi-city">' + esc(allBranches.length) + ' locations</span></div>'
      + '<div class="bs-head">Switch location</div>'
      + allBranches.map(function (b) {
          var activeCls = b.id === currentBranchId ? ' active' : '';
          return '<div class="bsel-item' + activeCls + '" data-branch-id="' + esc(b.id) + '">'
            + '<span class="bi-code">' + esc(b.code || '') + '</span>'
            + esc(b.name) + '<span class="bi-city">' + esc(b.city || '') + '</span>'
            + '</div>';
        }).join('');

    return '<div class="branch-selector-block">'
      + '<div class="bs-label">Location Selector</div>'
      + '<div class="bs-row">'
        + '<div class="bsel">'
          + '<button class="bsel-btn" id="bsel-toggle-btn" aria-haspopup="true" aria-expanded="false">'
            + '<span id="bsel-label">' + label + '</span>'
            + '<span class="bs-code" id="bsel-code">' + code + '</span>'
            + '<span class="caret">▼</span>'
          + '</button>'
          + '<div class="bsel-menu" id="bsel-menu">' + menuItems + '</div>'
        + '</div>'
        + '<div class="bsel-arrows">'
          + '<button class="bs-arrow" id="bs-prev" title="Previous location">‹</button>'
          + '<button class="bs-arrow" id="bs-next" title="Next location">›</button>'
        + '</div>'
      + '</div>'
      + '</div>';
  }

  // ── Title row ──────────────────────────────────────────────────────────────
  function renderTitleRow(branch, groupLookup) {
    var groupIds  = Array.isArray(branch.groupIds) ? branch.groupIds : [];
    var primaryGid = groupIds.length > 0 ? groupIds[0] : null;
    var groupInfo  = primaryGid ? groupLookup[primaryGid] : null;
    var groupChip  = groupInfo
      ? '<span class="gchip ' + groupColorClass(groupInfo.colorIdx) + '">' + esc(groupInfo.name) + '</span>'
      : '';
    var location = [branch.address, branch.city].filter(Boolean).join(', ');
    return '<div class="det-head">'
      + '<h2>' + esc(branch.name || '—') + '</h2>'
      + '<span class="codes">PNC Code ' + esc(branch.code || '—') + '</span>'
      + (location ? '<span class="sub">' + esc(location) + (groupChip ? ' · ' + groupChip : '') + '</span>' : (groupChip ? groupChip : ''))
      + '</div>';
  }

  // ── Tab bar ────────────────────────────────────────────────────────────────
  function renderTabBar(categoryOrder, categoryGroups, activeIdx) {
    var summaryOn = activeIdx === 0 ? ' on' : '';
    var tabs = '<div class="tab' + summaryOn + '" data-tab-idx="0">Summary</div>';
    categoryOrder.forEach(function (key, i) {
      var idx       = i + 1;
      var accent    = categoryAccent(key);
      var label     = _categoryLabel(key);
      var catLayers = categoryGroups[key] || [];
      var totalCount = catLayers.reduce(function (s, l) { return s + (l.assetCount || 0); }, 0);
      var on        = activeIdx === idx ? ' on' : '';
      tabs += '<div class="tab ' + accent.cls + on + '" data-tab-idx="' + idx + '" data-category-key="' + esc(key) + '">'
        + esc(label) + '<span class="tcount">' + esc(totalCount) + '</span>'
        + '</div>';
    });
    return '<div class="tabs" id="branch-tab-bar">' + tabs + '</div>';
  }

  // ── Sub-layer toggle panel (rendered in #bmap-sublayer-overlay) ────────────
  function renderSubLayerPanel(categoryKey, layers) {
    if (layers.length === 0) return '';
    var checked = _checkedSubLayers[categoryKey] || {};
    var rows = layers.map(function (layer) {
      var color        = _isValidHex(layer.color) ? layer.color.trim() : _dotHex(layerAccent(layer));
      var hasGeo       = layer.hasGeometry;
      var disabledAttr = hasGeo ? '' : ' disabled';
      var disabledCls  = hasGeo ? '' : ' bd-sublayer-row--disabled';
      var checkedAttr  = (hasGeo && checked[layer.id] !== false) ? ' checked' : '';
      var noDataHint   = hasGeo ? '' : '<span class="bd-no-data">no data</span>';
      return '<label class="bd-sublayer-row' + disabledCls + '"'
        + ' data-category-key="' + esc(categoryKey) + '"'
        + ' data-layer-id="' + esc(layer.id) + '">'
        + '<input type="checkbox"' + checkedAttr + disabledAttr
          + ' data-category-key="' + esc(categoryKey) + '"'
          + ' data-layer-id="' + esc(layer.id) + '">'
        + '<span class="bd-sub-dot" style="background:' + esc(color) + '"></span>'
        + '<span class="bd-sub-label">' + esc(layer.name) + '</span>'
        + noDataHint
        + '<span class="bd-sub-count">' + esc(layer.assetCount) + '</span>'
        + '</label>';
    }).join('');
    return '<div class="bd-sublayer-panel">' + rows + '</div>';
  }

  // ── KPI strip ─────────────────────────────────────────────────────────────
  function renderKpiStrip(cells) {
    return '<div class="layer-strip">'
      + cells.map(function (c) {
          return '<div class="invc ' + esc(c.border || 'b-teal') + '">'
            + '<div class="i-label">' + esc(c.label) + '</div>'
            + '<div class="i-value">' + esc(c.value) + '</div>'
            + (c.sub ? '<div class="i-sub">' + esc(c.sub) + '</div>' : '')
            + '</div>';
        }).join('')
      + '</div>';
  }

  // ── Stable map panel ───────────────────────────────────────────────────────
  function renderStableMapPanel() {
    return '<div class="panel p-blue" id="branch-map-panel">'
      + '<div class="panel-head">'
        + '<h2 id="bmap-panel-title">Property Map</h2>'
        + '<div class="bmap-head-controls" id="bmap-head-controls">'
          + '<!-- satellite toggle injected by VRTMapRenderer.renderSatelliteToggle -->'
          + '<button class="bmap-expand-btn" id="bmap-expand-btn" title="Expand map" aria-label="Expand map" aria-pressed="false">'
            + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'
              + '<path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/>'
            + '</svg>'
          + '</button>'
        + '</div>'
      + '</div>'
      + '<div id="bmap-sublayer-overlay"></div>'
      + '<div class="branch-map-container" id="bmap-stable"></div>'
      + '</div>';
  }

  // ── Service row ───────────────────────────────────────────────────────────
  function renderServiceRow(svc) {
    var dotCls = svc.type === 'task_completion' ? 'teal' : 'blue';
    var photos = svc.photoCount > 0 ? '<span class="sr-photos">📷 ' + esc(svc.photoCount) + '</span>' : '';
    var amount = svc.amountCents ? '<span class="sr-amt">' + esc(fmtMoney(svc.amountCents)) + '</span>' : '';
    return '<div class="svc-row">'
      + '<span class="sdot ' + dotCls + '"></span>'
      + '<div class="sr-main">'
        + '<div class="sr-title">' + esc(svc.title || '—') + '</div>'
        + '<div class="sr-meta">' + esc(fmtDate(svc.date)) + '</div>'
      + '</div>'
      + photos + amount
      + '</div>';
  }

  // ── Category breakdown panel (Summary tab) ────────────────────────────────
  function renderCategoryBreakdown(categoryOrder, categoryGroups) {
    if (!categoryOrder || categoryOrder.length === 0) return '';
    var rows = categoryOrder.map(function (key, i) {
      var tabIdx    = i + 1;
      var accent    = categoryAccent(key);
      var label     = _categoryLabel(key);
      var catLayers = categoryGroups[key] || [];
      var total     = catLayers.reduce(function (s, l) { return s + (l.assetCount || 0); }, 0);
      var activeSubs = catLayers.filter(function (l) { return l.hasGeometry; }).length;
      var isEmpty   = total === 0 && activeSubs === 0;
      var emptyCls  = isEmpty ? ' bd-cat-inv-row--empty' : '';
      var accentColor = (accent.cls || '').replace('t-', '') || 'teal';

      var assetsLabel = isEmpty
        ? '<span class="bd-cat-inv-assets bd-cat-inv-none">no data</span>'
        : '<span class="bd-cat-inv-assets"><b>' + esc(total) + '</b> asset' + (total !== 1 ? 's' : '') + '</span>';
      var subLabel = isEmpty ? ''
        : '<span class="bd-cat-inv-sublayers">' + esc(catLayers.length) + ' sub-layer' + (catLayers.length !== 1 ? 's' : '')
          + (activeSubs < catLayers.length ? ' · <span class="bd-cat-inv-active">' + esc(activeSubs) + ' mapped</span>' : '')
          + '</span>';

      return '<div class="bd-cat-inv-row' + emptyCls + '" data-tab-idx="' + tabIdx + '" role="button" tabindex="0">'
        + '<span class="bd-cat-inv-dot bd-cat-inv-dot--' + esc(accentColor) + '"></span>'
        + '<span class="bd-cat-inv-label">' + esc(label) + '</span>'
        + assetsLabel + subLabel
        + '<span class="bd-cat-inv-arrow">›</span>'
        + '</div>';
    }).join('');

    return '<div class="panel bd-cat-inv">'
      + '<div class="panel-head"><h2>Category Breakdown</h2>'
      + '<span class="hint">click a row to explore</span>'
      + '</div>'
      + '<div class="bd-cat-inv-list">' + rows + '</div>'
      + '</div>';
  }

  // ── Summary tab content ────────────────────────────────────────────────────
  function renderSummaryTab(data) {
    var branch  = data.branch;
    var layers  = data.layers || [];
    var svcs    = data.recentServices || [];
    var openWOs = data.openWorkOrders || [];

    var totalAssets = layers.reduce(function (s, l) { return s + l.assetCount; }, 0);
    var lastSvcDate = svcs.length > 0 ? fmtDate(svcs[0].date) : '—';

    var kpis = renderKpiStrip([
      { label: 'Assets Mapped',    value: totalAssets,    border: 'b-blue'  },
      { label: 'Layers',           value: layers.length,  border: 'b-teal'  },
      { label: 'Open Work Orders', value: openWOs.length, border: 'b-amber' },
      { label: 'Last Service',     value: lastSvcDate,    border: 'b-green' },
    ]);

    var serviceLayers = layers.filter(function (l) { return l.type !== 'outline'; });
    var catResult     = _buildCategoryGroups(serviceLayers);
    var breakdownHtml = renderCategoryBreakdown(catResult.order, catResult.groups);

    var svcRows = svcs.length > 0
      ? svcs.slice(0, 8).map(renderServiceRow).join('')
      : '<div class="pf-empty">No services recorded yet.</div>';
    var svcPanel = '<div class="panel p-green">'
      + '<div class="panel-head"><h2>Recent Services</h2>'
      + '<span class="hint">' + esc(svcs.length) + ' total</span></div>'
      + svcRows + '</div>';

    var woRows = openWOs.length === 0
      ? '<div class="pf-empty">No open work orders.</div>'
      : openWOs.map(function (wo) {
          var statusLabel = (wo.status || '').replace(/_/g, ' ');
          var estimate = wo.estimateCents ? ' · ' + fmtMoney(wo.estimateCents) : '';
          return '<div class="svc-row">'
            + '<span class="sdot amber"></span>'
            + '<div class="sr-main">'
              + '<div class="sr-title">' + esc(wo.title || '—') + '</div>'
              + '<div class="sr-meta">' + esc(statusLabel) + (SHOW_WORK_ORDER_DATES ? ' · opened ' + esc(fmtDate(wo.openedAt)) : '') + esc(estimate) + '</div>'
            + '</div>'
            + '</div>';
        }).join('');
    var woPanel = '<div class="panel p-amber">'
      + '<div class="panel-head"><h2>Open Work Orders</h2>'
      + '<span class="hint">' + esc(openWOs.length) + ' open</span></div>'
      + woRows + '</div>';

    return kpis + breakdownHtml + '<div class="two-col">' + svcPanel + woPanel + '</div>';
  }

  // ── Category tab content ──────────────────────────────────────────────────
  function renderCategoryContent(categoryKey, categoryLayers, data) {
    var accent        = categoryAccent(categoryKey);
    var categoryLabel = _categoryLabel(categoryKey);
    var inventory     = data.inventory || [];
    var svcs          = data.recentServices || [];

    var catLayerIds = categoryLayers.map(function (l) { return l.id; });
    var catInv = inventory.filter(function (inv) { return catLayerIds.indexOf(inv.layerId) !== -1; });

    var totalAssets   = categoryLayers.reduce(function (s, l) { return s + (l.assetCount || 0); }, 0);
    var distinctTypes = catInv.length;
    var lastSvcDate   = svcs.length > 0 ? fmtDate(svcs[0].date) : '—';

    var kpiStrip = renderKpiStrip([
      { label: 'Assets',       value: totalAssets,                        border: accent.invcBorder },
      { label: 'Asset Types',  value: distinctTypes,                      border: accent.invcBorder },
      { label: 'Last Service', value: lastSvcDate,                        border: 'b-teal'          },
      { label: 'Open Items',   value: (data.openWorkOrders || []).length, border: 'b-amber'         },
    ]);

    var invRows = catInv.length === 0
      ? '<div class="pf-empty">No assets mapped for this category yet.</div>'
      : '<table><thead><tr><th>Asset Type</th><th class="num">Count</th></tr></thead><tbody>'
        + catInv.map(function (inv) {
            var typeName = (inv.assetType || '').replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
            return '<tr><td class="bname">' + esc(typeName) + '</td><td class="num">' + esc(inv.count) + '</td></tr>';
          }).join('')
        + '</tbody></table>';

    var invPanel = '<div class="panel ' + esc(accent.panel) + '">'
      + '<div class="panel-head"><h2>' + esc(categoryLabel) + ' Inventory</h2></div>'
      + invRows + '</div>';

    var svcContent = '<div class="pf-empty" style="font-style:italic;color:var(--gray-400);">'
      + 'Per-layer service history will appear here once service records include layer attribution.'
      + '</div>';
    var svcPanel = '<div class="panel ' + esc(accent.panel) + '">'
      + '<div class="panel-head"><h2>' + esc(categoryLabel) + ' Service History</h2>'
      + (svcs.length > 0 ? '<span class="hint">' + esc(svcs.length) + ' recent</span>' : '')
      + '</div>' + svcContent + '</div>';

    var contentHtml = kpiStrip + '<div class="two-col">' + invPanel + svcPanel + '</div>';

    if (categoryKey === 'snow') {
      var snowSeason = data.snowSeason;
      var snowBlock;
      if (snowSeason) {
        snowBlock = '<div class="winter" style="margin-bottom:18px;">'
          + '<div><div class="w-label">Winter Operations</div>'
          + '<div class="w-main">' + esc(snowSeason.seasonLabel || 'Season') + '</div></div>'
          + (snowSeason.events    != null ? '<div class="w-stat"><b>' + esc(snowSeason.events)      + '</b><span>snow events</span></div>'  : '')
          + (snowSeason.clearings != null ? '<div class="w-stat"><b>' + esc(snowSeason.clearings)   + '</b><span>clearings</span></div>'    : '')
          + (snowSeason.photoPct  != null ? '<div class="w-stat"><b>' + esc(snowSeason.photoPct)    + '%</b><span>photo + timestamp</span></div>' : '')
          + (snowSeason.avgResponse       ? '<div class="w-stat"><b>' + esc(snowSeason.avgResponse) + '</b><span>avg response</span></div>' : '')
          + '</div>';
      } else {
        snowBlock = '<div class="panel p-slate" style="margin-bottom:18px;">'
          + '<div class="panel-head"><h2>Winter Season Data</h2></div>'
          + '<div class="pf-empty">No winter season data recorded yet.</div>'
          + '</div>';
      }
      contentHtml = snowBlock + contentHtml;
    }

    return contentHtml;
  }

  // ── Full detail page ───────────────────────────────────────────────────────
  function renderDetailPage(container, data, branchId) {
    var state       = window.PortfolioState || {};
    var allBranches = Array.isArray(state.branches) ? state.branches : [];
    var groups      = Array.isArray(state.groups)   ? state.groups   : [];
    var groupLookup = buildGroupLookup(groups);

    var branch        = data.branch;
    var layers        = data.layers || [];
    var serviceLayers = layers.filter(function (l) { return l.type !== 'outline'; });
    var catResult     = _buildCategoryGroups(serviceLayers);
    var categoryOrder = catResult.order;
    var categoryGroups = catResult.groups;

    var selectorHtml = renderSelectorBlock(branchId, allBranches);
    var titleHtml    = renderTitleRow(branch, groupLookup);
    var tabBarHtml   = renderTabBar(categoryOrder, categoryGroups, 0);

    var summaryPane = '<div class="tabpane on" data-pane-idx="0">' + renderSummaryTab(data) + '</div>';

    var categoryPanes = categoryOrder.map(function (key, i) {
      var catLayers = categoryGroups[key] || [];
      return '<div class="tabpane" data-pane-idx="' + (i + 1) + '" data-category-key="' + esc(key) + '">'
        + renderCategoryContent(key, catLayers, data)
        + '</div>';
    }).join('');

    container.innerHTML = selectorHtml + titleHtml + tabBarHtml
      + renderStableMapPanel()
      + summaryPane + categoryPanes;

    wireSelectorBlock(container, branchId, allBranches);
    wireTabBar(container);
    setupBranchRenderer(container, data, branchId);
  }

  // ── Wire selector block ────────────────────────────────────────────────────
  function wireSelectorBlock(container, currentBranchId, allBranches) {
    var menu = container.querySelector('#bsel-menu');
    var btn  = container.querySelector('#bsel-toggle-btn');
    if (!btn || !menu) return;

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var isOpen = menu.classList.toggle('open');
      btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    document.addEventListener('click', function closeOnOutside(e) {
      if (!container.contains(e.target)) {
        menu.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
      }
    });

    var allLink = container.querySelector('#bs-all-link');
    if (allLink) {
      allLink.addEventListener('click', function () {
        if (window.PortfolioRouter) PortfolioRouter.navigate('branches', true, {});
      });
    }

    container.querySelectorAll('.bsel-item[data-branch-id]').forEach(function (item) {
      item.addEventListener('click', function () {
        var id = item.getAttribute('data-branch-id');
        if (id && id !== currentBranchId && window.PortfolioRouter) {
          PortfolioRouter.navigate('branch-detail', true, { id: id });
        }
      });
    });

    var currentIdx = -1;
    for (var i = 0; i < allBranches.length; i++) {
      if (allBranches[i].id === currentBranchId) { currentIdx = i; break; }
    }

    var prevBtn = container.querySelector('#bs-prev');
    var nextBtn = container.querySelector('#bs-next');

    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        if (allBranches.length < 2) return;
        var prevIdx = (currentIdx - 1 + allBranches.length) % allBranches.length;
        if (window.PortfolioRouter) PortfolioRouter.navigate('branch-detail', true, { id: allBranches[prevIdx].id });
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        if (allBranches.length < 2) return;
        var nextIdx = (currentIdx + 1) % allBranches.length;
        if (window.PortfolioRouter) PortfolioRouter.navigate('branch-detail', true, { id: allBranches[nextIdx].id });
      });
    }
  }

  // ── Wire tab bar ───────────────────────────────────────────────────────────
  function wireTabBar(container) {
    var tabs  = container.querySelectorAll('#branch-tab-bar .tab');
    var panes = container.querySelectorAll('.tabpane[data-pane-idx]');

    function activateTab(idx) {
      tabs.forEach(function (t) { t.classList.remove('on'); });
      panes.forEach(function (p) { p.classList.remove('on'); });
      var tab = container.querySelector('#branch-tab-bar .tab[data-tab-idx="' + idx + '"]');
      if (tab) tab.classList.add('on');
      var pane = container.querySelector('.tabpane[data-pane-idx="' + idx + '"]');
      if (pane) pane.classList.add('on');
      _switchToTab(idx);
    }

    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        activateTab(parseInt(tab.getAttribute('data-tab-idx'), 10));
      });
    });

    container.querySelectorAll('.bd-cat-inv-row[data-tab-idx]').forEach(function (row) {
      row.addEventListener('click', function () {
        activateTab(parseInt(row.getAttribute('data-tab-idx'), 10));
      });
      row.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activateTab(parseInt(row.getAttribute('data-tab-idx'), 10));
        }
      });
    });
  }

  // ── Tab UI sync helper ─────────────────────────────────────────────────────
  // Syncs the tab bar and pane visibility when the active tab changes from
  // outside (e.g. expanded overlay category switch).
  function _syncTabUI(tabIdx) {
    if (!_container) return;
    _container.querySelectorAll('#branch-tab-bar .tab').forEach(function (t) { t.classList.remove('on'); });
    _container.querySelectorAll('.tabpane[data-pane-idx]').forEach(function (p) { p.classList.remove('on'); });
    var tab  = _container.querySelector('#branch-tab-bar .tab[data-tab-idx="'  + tabIdx + '"]');
    var pane = _container.querySelector('.tabpane[data-pane-idx="' + tabIdx + '"]');
    if (tab)  tab.classList.add('on');
    if (pane) pane.classList.add('on');
  }

  // ── Main render ────────────────────────────────────────────────────────────
  function renderBranchDetail(container, params) {
    _teardown();

    var branchId = params && params.id;
    if (!branchId) {
      container.innerHTML = '<div class="pf-empty">No location ID specified.</div>';
      return;
    }

    var orgSuffix = orgParam();
    var url = '/api/portfolio/branches/' + encodeURIComponent(branchId) + orgSuffix;

    apiFetch(url).then(function (data) {
      renderDetailPage(container, data, branchId);
    }).catch(function (err) {
      console.error('[portfolio/branch-detail] fetch failed:', err);
      container.innerHTML = '<div class="pf-empty">Failed to load location data. Please refresh.</div>';
    });
  }

  // ── Register ───────────────────────────────────────────────────────────────
  if (window.PortfolioRouter) {
    PortfolioRouter.register('branch-detail', renderBranchDetail);
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      if (window.PortfolioRouter) PortfolioRouter.register('branch-detail', renderBranchDetail);
    });
  }
})();
