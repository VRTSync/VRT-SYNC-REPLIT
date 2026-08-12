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
    _updateMapLegend(categoryKey);
    // Keep the expanded overlay's active category in sync with the page tab bar
    if (_bMapPanel) {
      _bMapPanel.dispatchEvent(new CustomEvent('vrt-sync-overlay-category', {
        bubbles: false, detail: { activeCategory: categoryKey }
      }));
    }

    // Summary (tabIdx===0): show map preview overlay (blocks scroll-hijack),
    // show asset cards, map panel is narrow (1.35fr in two-column grid).
    // Category tabs: hide overlay (map is fully interactive), hide cards,
    // map panel goes full-width (grid collapses to one column).
    if (_container) {
      var row1    = _container.querySelector('#branch-row1');
      var overlay = _container.querySelector('#summ-map-overlay');
      var caption = _container.querySelector('#bmap-all-layers-caption');
      if (row1) {
        if (tabIdx === 0) { row1.classList.remove('branch-row1--cat'); }
        else              { row1.classList.add('branch-row1--cat');    }
      }
      if (overlay) { overlay.style.display = tabIdx === 0 ? 'block' : 'none'; }
      if (caption) { caption.style.display = tabIdx === 0 ? 'block' : 'none'; }
    }
  }

  function _updateMapPanelTitle(title) {
    if (!_container) return;
    var el = _container.querySelector('#bmap-panel-title');
    if (el) el.textContent = title;
  }

  function _syncRailCheckboxes(categoryKey) {
    if (!_container) return;
    var checked  = _checkedSubLayers[categoryKey] || {};
    var tabIdx   = _categoryOrder.indexOf(categoryKey) + 1;
    if (tabIdx <= 0) return;
    var pane = _container.querySelector('.tabpane[data-pane-idx="' + tabIdx + '"]');
    if (!pane) return;
    pane.querySelectorAll('input[type="checkbox"][data-category-key]').forEach(function (cb) {
      var lid = cb.getAttribute('data-layer-id');
      if (lid !== null) cb.checked = !!checked[lid];
    });
  }
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
        // Keep rail checkboxes in sync when the expanded-overlay toggles
        _syncRailCheckboxes(ck);
      });
    });

    // Sync rail checkboxes to current _checkedSubLayers state
    _syncRailCheckboxes(categoryKey);
  }

  function _updateControllerRails() {
    if (!_container || !_renderer) return;
    var ctrlData = _renderer.getControllerData();
    _categoryOrder.forEach(function (key, i) {
      if (key !== 'irrigation') return;
      var paneIdx = i + 1;
      var pane = _container.querySelector('.tabpane[data-pane-idx="' + paneIdx + '"]');
      if (!pane) return;
      var listEl = pane.querySelector('#rail-ctrl-list');
      if (!listEl) return;
      if (!ctrlData || ctrlData.length === 0) {
        listEl.innerHTML = '<div class="pf-empty" style="padding:8px 0;">No controllers found.</div>';
        return;
      }
      listEl.innerHTML = ctrlData.map(function (c) {
        var color     = c.controllerColor || '#25C1AC';
        var zoneCount = c.zoneCount || (c.zones ? c.zones.length : 0);
        return '<div class="rail-ctrl-row">'
          + '<span class="rail-ctrl-dot" style="background:' + esc(color) + '"></span>'
          + '<span class="rail-ctrl-name">' + esc(c.label || c.controllerKey || 'Controller') + '</span>'
          + '<span class="rail-ctrl-zones">' + esc(zoneCount) + ' zone' + (zoneCount !== 1 ? 's' : '') + '</span>'
          + '</div>';
      }).join('');
    });
    // Refresh the map legend so controller-colour entries appear now that data is loaded.
    var activeCatKey = _categoryOrder[_activeTabIdx - 1] || null;
    _updateMapLegend(activeCatKey);
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

      // Populate controller list in irrigation rail section (data available after load)
      _updateControllerRails();

      if (isInitial && _activeTabIdx === 0) {
        // First load: Summary tab, all layers visible, fit to content.
        _updateSublayerOverlay(0);
        _renderer.setActiveCategory(null);
        _updateMapLegend(null);
        return;
      }

      // Restore the user's current tab, category, and sub-layer selections.
      // On the first ready this may still fit (the user navigated to a
      // category before data finished loading — fitting that category is
      // first-load behaviour). On any replayed ready, never refit: the user
      // may have panned/zoomed, and their viewport must be preserved.
      var fitOpts = { fit: isInitial };
      _updateSublayerOverlay(_activeTabIdx);
      var restoreCatForLegend = _activeTabIdx > 0 ? _categoryOrder[_activeTabIdx - 1] : null;
      _updateMapLegend(restoreCatForLegend);
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
      + '<span class="codes">' + esc(branch.code || '—') + '</span>'
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
    // Service History tab — always last, plain style (no category accent)
    var histIdx = categoryOrder.length + 1;
    var histOn  = activeIdx === histIdx ? ' on' : '';
    tabs += '<div class="tab' + histOn + '" data-tab-idx="' + histIdx + '">Service History</div>';
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
      // Overlay approach: a transparent div sits above the iframe in Summary mode.
      // It captures scroll-wheel events (they bubble to the page, not the iframe),
      // preventing scroll-hijack without requiring interactive:false on the renderer.
      // The panel-head controls (expand, satellite toggle) sit above this container
      // and are unaffected. When a category tab is active the overlay hides so the
      // map is fully interactive for those tabs.
      + '<div class="branch-map-container" id="bmap-stable">'
        + '<div class="summ-map-overlay" id="summ-map-overlay"></div>'
        // Caption shown on Summary (all-layers mode); hidden on category tabs
        + '<div class="bmap-all-layers-caption" id="bmap-all-layers-caption">All layers shown</div>'
        + '<div id="bmap-legend" class="bmap-legend"></div>'
      + '</div>'
      + '</div>';
  }

  function _updateMapLegend(categoryKey) {
    if (!_container) return;
    var legendEl = _container.querySelector('#bmap-legend');
    if (!legendEl) return;
    if (!categoryKey) { legendEl.innerHTML = ''; return; }

    var catLayers = (_categoryGroups && _categoryGroups[categoryKey]) || [];
    if (catLayers.length === 0) { legendEl.innerHTML = ''; return; }

    var body = '';

    if (categoryKey === 'irrigation') {
      // ── Irrigation: controller colours + marker vocabulary ──────────────────
      var controllers = (_renderer && typeof _renderer.getControllerData === 'function')
        ? (_renderer.getControllerData() || []) : [];

      if (controllers.length > 0) {
        // Show one coloured dot per controller, labelled with its name.
        // Controller colour = the zone colour the renderer assigns (same colour used on map markers).
        body += '<div class="bmap-legend-section-head">Controllers</div>'
          + controllers.slice(0, 8).map(function (c) {
              var color = c.controllerColor || '#25C1AC';
              var zc    = c.zoneCount || (c.zones ? c.zones.length : 0);
              return '<div class="bmap-legend-item">'
                + '<span class="bmap-legend-dot" style="background:' + esc(color) + '"></span>'
                + '<span class="bmap-legend-lbl">' + esc(c.label || c.controllerKey || 'Controller')
                  + (zc ? ' <span class="bmap-legend-dim">(' + zc + ')</span>' : '') + '</span>'
                + '</div>';
            }).join('');
      } else {
        // Fallback before renderer ready: show sub-layer zone colours.
        body += '<div class="bmap-legend-section-head">Zones</div>'
          + catLayers.slice(0, 8).map(function (layer) {
              var color = _layerColor(layer);
              return '<div class="bmap-legend-item">'
                + '<span class="bmap-legend-dot" style="background:' + esc(color) + '"></span>'
                + '<span class="bmap-legend-lbl">' + esc(layer.name || '') + '</span>'
                + '</div>';
            }).join('');
      }

      // Marker vocabulary for irrigation
      body += '<div class="bmap-legend-divider"></div>'
        + '<div class="bmap-legend-section-head">Markers</div>'
        + '<div class="bmap-legend-item"><span class="bmap-legend-pin">📍</span><span class="bmap-legend-lbl">Valve box / zone</span></div>'
        + '<div class="bmap-legend-item"><span class="bmap-legend-badge-ex">3</span><span class="bmap-legend-lbl">= multiple zones in box</span></div>'
        + '<div class="bmap-legend-item"><span class="bmap-legend-pin">🔵</span><span class="bmap-legend-lbl">Backflow preventer</span></div>'
        + '<div class="bmap-legend-item"><span class="bmap-legend-pin">⚡</span><span class="bmap-legend-lbl">Quick connect</span></div>';
    } else {
      // Non-irrigation: plain sub-layer colour swatches.
      body = catLayers.map(function (layer) {
        var color = _layerColor(layer);
        return '<div class="bmap-legend-item">'
          + '<span class="bmap-legend-dot" style="background:' + esc(color) + '"></span>'
          + '<span class="bmap-legend-lbl">' + esc(layer.name || '') + '</span>'
          + '</div>';
      }).join('');
    }

    legendEl.innerHTML = '<div class="bmap-legend-title">' + esc(_categoryLabel(categoryKey)) + '</div>'
      + body;
  }
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

  function renderAssetCards(data, categoryOrder, categoryGroups) {
    var inventory = data.inventory || [];

    // Build layerId → categoryKey map
    var layerToCat = {};
    categoryOrder.forEach(function (key) {
      (categoryGroups[key] || []).forEach(function (layer) {
        layerToCat[layer.id] = key;
      });
    });

    // Aggregate inventory counts per category per asset type
    var catTypeCount = {};
    categoryOrder.forEach(function (key) { catTypeCount[key] = {}; });
    inventory.forEach(function (inv) {
      var cat = layerToCat[inv.layerId];
      if (cat) {
        catTypeCount[cat][inv.assetType] = (catTypeCount[cat][inv.assetType] || 0) + inv.count;
      }
    });

    var cards = [];
    var unmapped = [];

    categoryOrder.forEach(function (key, i) {
      var catLayers  = categoryGroups[key] || [];
      var label      = _categoryLabel(key);
      var total      = catLayers.reduce(function (s, l) { return s + (l.assetCount || 0); }, 0);
      var hasGeo     = catLayers.some(function (l) { return l.hasGeometry; });

      // Category color: first sub-layer with a valid admin-set hex (layers[].color)
      var catColor = '#888888';
      for (var j = 0; j < catLayers.length; j++) {
        if (_isValidHex(catLayers[j].color)) { catColor = catLayers[j].color.trim(); break; }
      }
      if (catColor === '#888888') {
        // Fall back to sub-layer default colours (still from the single color source)
        catColor = _layerColor(catLayers[0] || {});
      }

      // Unmapped when either zero assets OR no geometry — both conditions make the
      // category incomplete from the client's perspective, matching the spec.
      if (total === 0 || !hasGeo) {
        unmapped.push({ key: key, label: label, tabIdx: i + 1 });
        return;
      }

      // Sub-line: top 2-3 asset types by count, data-driven from inventory
      var typeEntries = Object.keys(catTypeCount[key] || {}).map(function (t) {
        return { type: t, count: catTypeCount[key][t] };
      }).sort(function (a, b) { return b.count - a.count; });

      var topTypes = typeEntries.slice(0, 3);
      var subLine  = topTypes.map(function (e) {
        // Pluralise the last word of the asset type label
        var words = e.type.replace(/_/g, ' ').split(' ');
        var last  = words[words.length - 1];
        if (e.count !== 1) {
          // Basic plural: append 's' unless already ends in 's'
          if (!/s$/.test(last)) last += 's';
          words[words.length - 1] = last;
        }
        return e.count + ' ' + words.join(' ');
      }).join(' · ');

      cards.push({ key: key, label: label, total: total, color: catColor, subLine: subLine, tabIdx: i + 1 });
    });

    var cardsHtml = cards.length === 0 ? '' :
      '<div class="summ-cards-grid">'
      + cards.map(function (card) {
          return '<div class="summ-card" data-tab-idx="' + esc(card.tabIdx) + '"'
            + ' style="border-left-color:' + esc(card.color) + '"'
            + ' role="button" tabindex="0">'
            + '<div class="summ-card-cat">' + esc(card.label) + '</div>'
            + '<div class="summ-card-count">' + esc(card.total) + '</div>'
            + (card.subLine ? '<div class="summ-card-sub">' + esc(card.subLine) + '</div>' : '')
            + '</div>';
        }).join('')
      + '</div>';

    var unmappedHtml = unmapped.length === 0 ? '' :
      '<div class="summ-unmapped-list">'
      + unmapped.map(function (cat) {
          return '<div class="summ-unmapped-row" data-tab-idx="' + esc(cat.tabIdx) + '">'
            + '<span class="summ-unmapped-label">' + esc(cat.label) + ' not yet mapped</span>'
            + '<span class="summ-unmapped-req">Request →</span>'
            + '</div>';
        }).join('')
      + '</div>';

    return cardsHtml + unmappedHtml;
  }
  function renderSummaryTab(data, histTabIdx) {
    var svcs    = data.recentServices || [];
    var openWOs = data.openWorkOrders || [];

    // ── Service metrics panel ─────────────────────────────────────────────
    var lastSvcDate    = svcs.length > 0 ? fmtDate(svcs[0].date) : '—';
    var servicesTotalV = data.servicesTotal != null ? data.servicesTotal : '—';
    var photoPctV      = data.photoProofPct != null ? data.photoProofPct + '%' : '—';

    var metricsPanel = '<div class="panel summ-metrics-panel">'
      + '<div class="panel-head"><h2>Service</h2></div>'
      + '<div class="summ-metric-rows">'
        + '<div class="summ-metric-row"><span class="smr-label">Services YTD</span><span class="smr-value">' + esc(servicesTotalV) + '</span></div>'
        + '<div class="summ-metric-row"><span class="smr-label">Last service</span><span class="smr-value smr-date">' + esc(lastSvcDate) + '</span></div>'
        + '<div class="summ-metric-row"><span class="smr-label">Photo proof</span><span class="smr-value">' + esc(photoPctV) + '</span></div>'
      + '</div>'
      + '</div>';

    // ── Open items panel (Approve / Decline inline) ───────────────────────
    var woBodyHtml;
    if (openWOs.length === 0) {
      woBodyHtml = '<div class="pf-empty" style="padding:20px 22px;">'
        + '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="display:inline-block;vertical-align:-4px;margin-right:6px;color:var(--green)"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>'
        + 'All clear — no open items.</div>';
    } else {
      woBodyHtml = openWOs.map(function (wo) {
        var estimate     = wo.estimateCents ? fmtMoney(wo.estimateCents) : '';
        var ref          = wo.id ? ('#' + wo.id.slice(-6).toUpperCase()) : '';
        var isApproved   = !!wo.approvedAt;
        var hasEstimate  = wo.estimateCents != null;

        // Approved items are still "open" (not yet completed) so they appear here,
        // but without action buttons — matching the Locations open-WO definition.
        // Decline is only available when an estimate is present (endpoint enforces this).
        var actionsHtml;
        if (isApproved) {
          actionsHtml = '<span class="summ-wo-approved-badge">Approved</span>';
        } else {
          actionsHtml = '<div class="summ-wo-actions">'
            + '<button class="summ-wo-btn summ-wo-approve" data-wo-id="' + esc(wo.id) + '">Approve</button>'
            + (hasEstimate
              ? '<button class="summ-wo-btn summ-wo-decline" data-wo-id="' + esc(wo.id) + '">Decline</button>'
              : '')
            + '</div>';
        }

        return '<div class="summ-wo-card" data-wo-id="' + esc(wo.id) + '">'
          + '<div class="summ-wo-main">'
            + '<div class="summ-wo-title">' + esc(wo.title || '—') + '</div>'
            + '<div class="summ-wo-meta">'
              + (ref      ? '<span class="summ-wo-ref">'  + esc(ref)      + '</span>' : '')
              + (estimate ? '<span class="summ-wo-est">'  + esc(estimate) + '</span>' : '')
            + '</div>'
          + '</div>'
          + actionsHtml
          + '</div>';
      }).join('');
    }
    var woHint    = openWOs.length > 0 ? '<span class="hint">' + esc(openWOs.length) + ' open</span>' : '';
    var woPanel   = '<div class="panel summ-wo-panel">'
      + '<div class="panel-head"><h2>Open Items</h2>' + woHint + '</div>'
      + woBodyHtml
      + '</div>';

    // ── Recent activity panel ─────────────────────────────────────────────
    var recentSvcs    = svcs.slice(0, 5);
    var activityRows  = recentSvcs.length === 0
      ? '<div class="pf-empty" style="padding:20px 22px;">No services recorded yet.</div>'
      : recentSvcs.map(function (svc) {
          var photoChip = svc.photoCount > 0
            ? '<span class="summ-photo-chip">📷 ' + esc(svc.photoCount) + '</span>'
            : '';
          return '<div class="summ-activity-row">'
            + '<div class="summ-act-main">'
              + '<div class="summ-act-title">' + esc(svc.title || '—') + '</div>'
              + '<div class="summ-act-date">'  + esc(fmtDate(svc.date)) + '</div>'
            + '</div>'
            + photoChip
            + '</div>';
        }).join('');
    // Footer: navigate to the Service History tab (always the last tab).
    // histTabIdx is passed in from renderDetailPage where categoryOrder is known.
    var activityFooter = svcs.length > 0
      ? '<div class="summ-activity-footer" id="summ-activity-more" data-hist-tab-idx="' + esc(histTabIdx) + '">View full service history →</div>'
      : '';
    var activityPanel = '<div class="panel summ-activity-panel">'
      + '<div class="panel-head"><h2>Recent Activity</h2></div>'
      + activityRows
      + activityFooter
      + '</div>';

    return '<div class="summ-row2">' + metricsPanel + woPanel + activityPanel + '</div>';
  }

  // ── Category tab content — left rail layout ───────────────────────────────
  //
  // Data decisions:
  //   Services:  option (b) — property-level services shown with an honest
  //              "branch-level" label. Layer attribution does not exist in the
  //              current data model; a blank placeholder is less useful.
  //   Open WOs:  no layer attribution → show all branch open WOs on every tab.
  //              Hiding actionable items when attribution is absent is worse
  //              than over-showing them.
  //
  function renderCategoryContent(categoryKey, categoryLayers, data) {
    var categoryLabel = _categoryLabel(categoryKey);
    // Filter services to those attributed to this category via task → asset → map_layer.
    // Services without a layerKey (service_visits, or tasks with no linked asset) are
    // excluded from category tabs — they cannot be reliably assigned to a category.
    var allSvcs  = data.recentServices  || [];
    var svcs     = allSvcs.filter(function (svc) { return svc.layerKey === categoryKey; });
    var openWOs  = data.openWorkOrders  || [];

    // ── Section 1: Sub-layer toggles ───────────────────────────────────────
    var sublayerHtml = '<div class="lrail-sec">'
      + '<div class="lrail-sec-title">' + esc(categoryLabel) + ' sub-layers</div>'
      + '<div class="rail-sublayers">' + renderSubLayerPanel(categoryKey, categoryLayers) + '</div>'
      + '</div>';

    // ── Section 2: Category-specific grouping ──────────────────────────────
    // Irrigation: controller list (populated async after renderer 'ready').
    // Other categories: no equivalent grouping exists — section is omitted.
    var groupingHtml = '';
    if (categoryKey === 'irrigation') {
      groupingHtml = '<div class="lrail-sec" id="rail-ctrl-section">'
        + '<div class="lrail-sec-title">Controllers</div>'
        + '<div class="rail-ctrl-list" id="rail-ctrl-list">'
          + '<div class="pf-empty" style="padding:8px 0;font-style:italic;">Loading map data…</div>'
        + '</div>'
        + '</div>';
    }

    // ── Snow season block (compact) ────────────────────────────────────────
    var snowHtml = '';
    if (categoryKey === 'snow') {
      var s = data.snowSeason;
      if (s) {
        snowHtml = '<div class="lrail-sec">'
          + '<div class="lrail-sec-title">Winter season</div>'
          + '<div class="winter-compact">'
          + '<div class="wc-label">' + esc(s.seasonLabel || 'Season') + '</div>'
          + (s.events    != null ? '<div class="wc-stat"><b>' + esc(s.events)    + '</b> snow events</div>'   : '')
          + (s.clearings != null ? '<div class="wc-stat"><b>' + esc(s.clearings) + '</b> clearings</div>'     : '')
          + (s.photoPct  != null ? '<div class="wc-stat"><b>' + esc(s.photoPct)  + '%</b> photo+timestamp</div>' : '')
          + (s.avgResponse       ? '<div class="wc-stat"><b>' + esc(s.avgResponse) + '</b> avg response</div>' : '')
          + '</div>'
          + '</div>';
      } else {
        snowHtml = '<div class="lrail-sec">'
          + '<div class="lrail-sec-title">Winter season</div>'
          + '<div class="pf-empty" style="padding:8px 0;">No winter season data recorded yet.</div>'
          + '</div>';
      }
    }

    // ── Section 3: Recent work (branch-level — layer attribution pending) ──
    var svcItems;
    if (svcs.length === 0) {
      svcItems = '<div class="pf-empty" style="padding:8px 0;">No recent ' + esc(categoryLabel.toLowerCase()) + ' services recorded.</div>';
    } else {
      svcItems = '<div class="rail-work-tl">'
        + svcs.slice(0, 6).map(function (svc) {
            var photos = svc.photoCount > 0
              ? ' <span class="sr-photos">📷 ' + esc(svc.photoCount) + '</span>'
              : '';
            return '<div class="rail-tl-item">'
              + '<div class="rail-tl-dot"></div>'
              + '<div class="rail-tl-body">'
                + '<div class="rail-tl-title">' + esc(svc.title || '—') + '</div>'
                + '<div class="rail-tl-meta">' + esc(fmtDate(svc.date)) + photos + '</div>'
              + '</div>'
              + '</div>';
          }).join('')
        + '</div>';
    }
    var recentWorkHtml = '<div class="lrail-sec">'
      + '<div class="lrail-sec-title">Recent ' + esc(categoryLabel) + ' work</div>'
      + svcItems
      + '</div>';

    // ── Section 4: Open items with inline Approve / Decline ────────────────
    // Show WOs attributed to this category, plus genuinely unattributed ones
    // (layerKey === null means no asset link exists on the task).
    // WOs attributed to a DIFFERENT category are excluded from this tab.
    var tabWOs = openWOs.filter(function (wo) {
      return wo.layerKey === categoryKey || wo.layerKey === null;
    });
    var openItemsHtml = '';
    if (tabWOs.length > 0) {
      var cards = tabWOs.map(function (wo) {
        var canApprove = wo.estimateCents != null && !wo.approvedAt;
        var approveBtn = canApprove
          ? '<button class="oi-btn oi-btn--approve" data-task-id="' + esc(wo.id) + '"'
            + ' data-task-title="' + esc(wo.title) + '"'
            + ' data-est="' + esc(wo.estimateCents) + '">Approve</button>'
          : '';
        var declineBtn = canApprove
          ? '<button class="oi-btn oi-btn--decline" data-task-id="' + esc(wo.id) + '"'
            + ' data-task-title="' + esc(wo.title) + '">Decline</button>'
          : '';
        var statusLabel = wo.approvedAt
          ? 'Approved — awaiting schedule'
          : wo.estimateCents != null
            ? 'Estimate ' + fmtMoney(wo.estimateCents)
            : (wo.status || '').replace(/_/g, ' ');
        // Derive who flagged the item: origin 'client' = client org request, else Contractor (field crews).
        var source = wo.origin === 'client' ? 'Client request' : 'Contractor';
        return '<div class="oi-card">'
          + (wo.ref ? '<div class="oi-ref">' + esc(wo.ref) + '</div>' : '')
          + '<div class="oi-title">' + esc(wo.title || '—') + '</div>'
          + '<div class="oi-meta">' + esc(statusLabel) + '</div>'
          + '<div class="oi-flagged">flagged by ' + esc(source) + '</div>'
          + (canApprove ? '<div class="oi-actions">' + approveBtn + declineBtn + '</div>' : '')
          + '</div>';
      }).join('');
      openItemsHtml = '<div class="lrail-sec">'
        + '<div class="lrail-sec-title">Open items</div>'
        + cards
        + '</div>';
    }

    return '<div class="layer-rail">'
      + sublayerHtml + snowHtml + groupingHtml + recentWorkHtml + openItemsHtml
      + '</div>';
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

    // Service History tab is always the last tab.
    var histTabIdx = categoryOrder.length + 1;

    var summaryPane = '<div class="tabpane on" data-pane-idx="0">' + renderSummaryTab(data, histTabIdx) + '</div>';

    var categoryPanes = categoryOrder.map(function (key, i) {
      var catLayers = categoryGroups[key] || [];
      return '<div class="tabpane" data-pane-idx="' + (i + 1) + '" data-category-key="' + esc(key) + '">'
        + renderCategoryContent(key, catLayers, data)
        + '</div>';
    }).join('');

    // Service History pane — shows all recentServices (up to 20 from payload).
    var allSvcs = data.recentServices || [];
    var svcRows = allSvcs.length === 0
      ? '<div class="pf-empty" style="padding:20px 22px;">No services recorded yet.</div>'
      : allSvcs.map(function (svc) {
          var photoChip = svc.photoCount > 0
            ? '<span class="summ-photo-chip">📷 ' + esc(svc.photoCount) + '</span>' : '';
          return '<div class="summ-activity-row">'
            + '<div class="summ-act-main">'
              + '<div class="summ-act-title">' + esc(svc.title || '—') + '</div>'
              + '<div class="summ-act-date">'  + esc(fmtDate(svc.date)) + '</div>'
            + '</div>'
            + photoChip
            + '</div>';
        }).join('');
    var historyPane = '<div class="tabpane" data-pane-idx="' + histTabIdx + '">'
      + '<div class="panel">'
        + '<div class="panel-head"><h2>Service History</h2>'
          + (data.servicesTotal != null
              ? '<span class="hint">' + esc(data.servicesTotal) + ' services YTD</span>' : '')
        + '</div>'
        + svcRows
      + '</div>'
      + '</div>';

    container.innerHTML = selectorHtml + titleHtml + tabBarHtml
      + '<div id="branch-content-wrapper" class="summary-mode">'
      + '<div id="branch-pane-area">'
      + summaryPane + categoryPanes + historyPane
      + '</div>'
      + renderStableMapPanel()
      + '</div>';

    wireSelectorBlock(container, branchId, allBranches);
    wireTabBar(container);
    wireSummaryActions(container, branchId);
    wireRailCheckboxes(container);
    wireRailOpenItems(container);
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

  function wireSummaryActions(container, branchId) {
    var suffix = orgParam();

    // Asset card clicks → navigate to matching category tab
    container.querySelectorAll('.summ-card[data-tab-idx]').forEach(function (card) {
      function goTab() {
        var idx = parseInt(card.getAttribute('data-tab-idx'), 10);
        var tabEl = container.querySelector('#branch-tab-bar .tab[data-tab-idx="' + idx + '"]');
        if (tabEl) tabEl.click();
      }
      card.addEventListener('click', goTab);
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goTab(); }
      });
    });

    // Unmapped-row clicks → navigate to matching category tab
    container.querySelectorAll('.summ-unmapped-row[data-tab-idx]').forEach(function (row) {
      row.addEventListener('click', function () {
        var idx = parseInt(row.getAttribute('data-tab-idx'), 10);
        var tabEl = container.querySelector('#branch-tab-bar .tab[data-tab-idx="' + idx + '"]');
        if (tabEl) tabEl.click();
      });
    });

    // Footer link → Service History tab
    var moreLink = container.querySelector('#summ-activity-more');
    if (moreLink) {
      moreLink.addEventListener('click', function () {
        var idx = parseInt(moreLink.getAttribute('data-hist-tab-idx'), 10);
        var tabEl = container.querySelector('#branch-tab-bar .tab[data-tab-idx="' + idx + '"]');
        if (tabEl) tabEl.click();
      });
    }

    // Approve / Decline buttons
    container.querySelectorAll('.summ-wo-approve').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var woId = btn.getAttribute('data-wo-id');
        if (!woId || btn.disabled) return;
        btn.disabled = true;
        var declineBtn = btn.closest('.summ-wo-card') && btn.closest('.summ-wo-card').querySelector('.summ-wo-decline');
        if (declineBtn) declineBtn.disabled = true;

        fetch('/api/portfolio/work-orders/' + encodeURIComponent(woId) + '/approve' + suffix, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          // Approved items remain open (not yet completed) so the card stays.
          // Replace the action controls with an Approved badge — consistent with
          // how the panel renders server-side for already-approved tasks.
          var actionsEl = btn.closest('.summ-wo-actions');
          if (actionsEl) {
            actionsEl.outerHTML = '<span class="summ-wo-approved-badge">Approved</span>';
          }
        }).catch(function (err) {
          console.error('[portfolio/approve]', err);
          btn.disabled = false;
          if (declineBtn) declineBtn.disabled = false;
          alert('Could not approve this item. Please try again.');
        });
      });
    });

    container.querySelectorAll('.summ-wo-decline').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var woId = btn.getAttribute('data-wo-id');
        if (!woId || btn.disabled) return;
        var reason = window.prompt('Reason for declining (required):');
        if (!reason || !reason.trim()) return;
        btn.disabled = true;
        var approveBtn = btn.closest('.summ-wo-card') && btn.closest('.summ-wo-card').querySelector('.summ-wo-approve');
        if (approveBtn) approveBtn.disabled = true;

        fetch('/api/portfolio/work-orders/' + encodeURIComponent(woId) + '/decline' + suffix, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: reason.trim() }),
        }).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          _removeWOCard(container, woId);
        }).catch(function (err) {
          console.error('[portfolio/decline]', err);
          btn.disabled = false;
          if (approveBtn) approveBtn.disabled = false;
          alert('Could not decline this item. Please try again.');
        });
      });
    });
  }
  function wireTabBar(container) {
    var tabs  = container.querySelectorAll('#branch-tab-bar .tab');
    var panes = container.querySelectorAll('.tabpane[data-pane-idx]');

    function _setWrapperMode(idx) {
      var wrapper = container.querySelector('#branch-content-wrapper');
      if (!wrapper) return;
      if (idx === 0) {
        wrapper.classList.add('summary-mode');
        wrapper.classList.remove('layer-mode');
      } else {
        wrapper.classList.add('layer-mode');
        wrapper.classList.remove('summary-mode');
      }
    }

    function activateTab(idx) {
      tabs.forEach(function (t) { t.classList.remove('on'); });
      panes.forEach(function (p) { p.classList.remove('on'); });
      var tab = container.querySelector('#branch-tab-bar .tab[data-tab-idx="' + idx + '"]');
      if (tab) tab.classList.add('on');
      var pane = container.querySelector('.tabpane[data-pane-idx="' + idx + '"]');
      if (pane) pane.classList.add('on');
      _setWrapperMode(idx);
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
  // Syncs the tab bar, pane visibility, and Row 1 layout when the active tab
  // changes from outside (e.g. expanded overlay category switch).
  function _syncTabUI(tabIdx) {
    if (!_container) return;
    _container.querySelectorAll('#branch-tab-bar .tab').forEach(function (t) { t.classList.remove('on'); });
    _container.querySelectorAll('.tabpane[data-pane-idx]').forEach(function (p) { p.classList.remove('on'); });
    var tab  = _container.querySelector('#branch-tab-bar .tab[data-tab-idx="'  + tabIdx + '"]');
    var pane = _container.querySelector('.tabpane[data-pane-idx="' + tabIdx + '"]');
    if (tab)  tab.classList.add('on');
    if (pane) pane.classList.add('on');
    // Keep content-wrapper layout mode in sync
    var wrapper = _container.querySelector('#branch-content-wrapper');
    if (wrapper) {
      if (tabIdx === 0) {
        wrapper.classList.add('summary-mode');
        wrapper.classList.remove('layer-mode');
      } else {
        wrapper.classList.add('layer-mode');
        wrapper.classList.remove('summary-mode');
      }
    }
    // Keep scroll-block overlay and "All layers shown" caption in sync
    var overlay = _container.querySelector('#summ-map-overlay');
    var caption = _container.querySelector('#bmap-all-layers-caption');
    if (overlay) { overlay.style.display = tabIdx === 0 ? 'block' : 'none'; }
    if (caption) { caption.style.display = tabIdx === 0 ? 'block' : 'none'; }
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
  // ── Rail: Approve / Decline dialogs and wiring (inside IIFE for closure access) ──

  function _showApproveDialog(taskId, taskTitle, estimateCents, suffix, onSuccess) {
    var existing = document.getElementById('oi-approve-dialog');
    if (existing) existing.remove();
    var overlay = document.createElement('div');
    overlay.id = 'oi-approve-dialog';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9800;background:rgba(12,29,49,0.55);display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = '<div style="background:#fff;border-radius:12px;box-shadow:0 8px 32px rgba(12,29,49,0.18);padding:28px 32px;max-width:420px;width:calc(100vw - 48px);">'
      + '<h3 style="font-family:Outfit,sans-serif;font-size:18px;font-weight:700;color:var(--navy);margin-bottom:10px;">Approve estimate</h3>'
      + '<p style="font-size:13.5px;color:var(--gray-600);margin-bottom:16px;">Approve the estimate'
        + (estimateCents ? ' of <b>' + fmtMoney(estimateCents) + '</b>' : '') + ' for:<br>'
        + '<b style="color:var(--navy)">' + esc(taskTitle) + '</b></p>'
      + '<div id="oi-approve-err" style="display:none;background:var(--red-light);color:var(--red);border-radius:6px;padding:8px 12px;font-size:12.5px;margin-bottom:14px;"></div>'
      + '<div style="display:flex;gap:10px;justify-content:flex-end;">'
        + '<button id="oi-approve-cancel" style="background:var(--gray-100);border:1px solid var(--gray-200);color:var(--gray-600);border-radius:999px;padding:8px 20px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">Cancel</button>'
        + '<button id="oi-approve-confirm" style="background:var(--amber);color:var(--navy);border:none;border-radius:999px;padding:8px 22px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;">Confirm Approval</button>'
      + '</div>'
      + '</div>';
    document.body.appendChild(overlay);
    overlay.querySelector('#oi-approve-cancel').addEventListener('click', function () { overlay.remove(); });
    overlay.querySelector('#oi-approve-confirm').addEventListener('click', function () {
      var confirmBtn = overlay.querySelector('#oi-approve-confirm');
      var errEl      = overlay.querySelector('#oi-approve-err');
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Approving…';
      var url = '/api/portfolio/work-orders/' + encodeURIComponent(taskId) + '/approve' + suffix;
      fetch(url, { method: 'POST', credentials: 'same-origin' })
        .then(function (r) {
          if (!r.ok) return r.json().then(function (d) { throw new Error(d.error || 'HTTP ' + r.status); });
          return r.json();
        })
        .then(function () {
          overlay.remove();
          if (typeof onSuccess === 'function') onSuccess();
          if (window.showToast) showToast('Work order approved');
        })
        .catch(function (err) {
          errEl.textContent = err.message || 'Failed to approve. Please try again.';
          errEl.style.display = 'block';
          confirmBtn.disabled = false;
          confirmBtn.textContent = 'Confirm Approval';
        });
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

  function _removeWOCard(container, woId) {
    var card = container.querySelector('.summ-wo-card[data-wo-id="' + woId + '"]');
    if (card) card.remove();
    var remaining = container.querySelectorAll('.summ-wo-card').length;
    var hint = container.querySelector('.summ-wo-panel .panel-head .hint');
    if (hint) hint.textContent = remaining > 0 ? remaining + ' open' : '';
    if (remaining === 0) {
      var panel = container.querySelector('.summ-wo-panel');
      if (panel) {
        // Replace whatever body content remains with the empty state
        var existingEmpty = panel.querySelector('.pf-empty');
        if (!existingEmpty) {
          panel.insertAdjacentHTML('beforeend',
            '<div class="pf-empty" style="padding:20px 22px;">'
            + '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="display:inline-block;vertical-align:-4px;margin-right:6px;color:var(--green)"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>'
            + 'All clear — no open items.</div>'
          );
        }
      }
    }
  }

  function wireRailCheckboxes(container) {
    container.querySelectorAll('.tabpane[data-pane-idx]').forEach(function (pane) {
      var paneIdx = parseInt(pane.getAttribute('data-pane-idx'), 10);
      if (paneIdx === 0) return;
      pane.querySelectorAll('.rail-sublayers input[type="checkbox"]').forEach(function (cb) {
        cb.addEventListener('change', function () {
          var ck  = cb.getAttribute('data-category-key');
          var lid = cb.getAttribute('data-layer-id');
          if (!ck || !lid) return;
          if (!_checkedSubLayers[ck]) _checkedSubLayers[ck] = {};
          _checkedSubLayers[ck][lid] = cb.checked;
          _syncCategoryVisibility(ck);
          // Keep the expanded-overlay in sync with rail state
          _updateSublayerOverlay(paneIdx);
        });
      });
    });
  }

  function _showDeclineDialog(taskId, taskTitle, suffix, onSuccess) {
    var existing = document.getElementById('oi-decline-dialog');
    if (existing) existing.remove();
    var overlay = document.createElement('div');
    overlay.id = 'oi-decline-dialog';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9800;background:rgba(12,29,49,0.55);display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = '<div style="background:#fff;border-radius:12px;box-shadow:0 8px 32px rgba(12,29,49,0.18);padding:28px 32px;max-width:420px;width:calc(100vw - 48px);">'
      + '<h3 style="font-family:Outfit,sans-serif;font-size:18px;font-weight:700;color:var(--navy);margin-bottom:10px;">Decline estimate</h3>'
      + '<p style="font-size:13.5px;color:var(--gray-600);margin-bottom:10px;">Decline the estimate for:<br><b style="color:var(--navy)">' + esc(taskTitle) + '</b></p>'
      + '<label style="font-size:13px;color:var(--gray-700);font-weight:600;display:block;margin-bottom:6px;">Reason <span style="font-weight:400;color:var(--gray-400)">(required)</span></label>'
      + '<textarea id="oi-decline-reason" rows="3" placeholder="e.g. out of budget for this season" style="width:100%;border:1px solid var(--gray-200);border-radius:6px;padding:8px 12px;font-size:13px;font-family:inherit;resize:vertical;margin-bottom:14px;"></textarea>'
      + '<div id="oi-decline-err" style="display:none;background:var(--red-light);color:var(--red);border-radius:6px;padding:8px 12px;font-size:12.5px;margin-bottom:14px;"></div>'
      + '<div style="display:flex;gap:10px;justify-content:flex-end;">'
        + '<button id="oi-decline-cancel" style="background:var(--gray-100);border:1px solid var(--gray-200);color:var(--gray-600);border-radius:999px;padding:8px 20px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">Cancel</button>'
        + '<button id="oi-decline-confirm" style="background:var(--red);color:#fff;border:none;border-radius:999px;padding:8px 22px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;">Decline Estimate</button>'
      + '</div>'
      + '</div>';
    document.body.appendChild(overlay);
    overlay.querySelector('#oi-decline-cancel').addEventListener('click', function () { overlay.remove(); });
    overlay.querySelector('#oi-decline-confirm').addEventListener('click', function () {
      var confirmBtn = overlay.querySelector('#oi-decline-confirm');
      var errEl      = overlay.querySelector('#oi-decline-err');
      var reason     = (overlay.querySelector('#oi-decline-reason').value || '').trim();
      if (!reason) {
        errEl.textContent = 'Please provide a reason for declining.';
        errEl.style.display = 'block';
        return;
      }
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Declining…';
      var url = '/api/portfolio/work-orders/' + encodeURIComponent(taskId) + '/decline' + suffix;
      fetch(url, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason }),
      })
        .then(function (r) {
          if (!r.ok) return r.json().then(function (d) { throw new Error(d.error || 'HTTP ' + r.status); });
          return r.json();
        })
        .then(function () {
          overlay.remove();
          if (typeof onSuccess === 'function') onSuccess();
          if (window.showToast) showToast('Estimate declined');
        })
        .catch(function (err) {
          errEl.textContent = err.message || 'Failed to decline. Please try again.';
          errEl.style.display = 'block';
          confirmBtn.disabled = false;
          confirmBtn.textContent = 'Decline Estimate';
        });
    });
  }

  function wireRailOpenItems(container) {
    var suffix = orgParam();
    container.querySelectorAll('.oi-btn--approve').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var taskId = btn.getAttribute('data-task-id');
        var title  = btn.getAttribute('data-task-title');
        var est    = parseInt(btn.getAttribute('data-est'), 10);
        _showApproveDialog(taskId, title, est, suffix, function () {
          var card = btn.closest('.oi-card');
          if (card) card.remove();
          // Remove empty section header if no cards remain
          var sec = btn.closest('.lrail-sec');
          if (sec && sec.querySelectorAll('.oi-card').length === 0) sec.remove();
        });
      });
    });
    container.querySelectorAll('.oi-btn--decline').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var taskId = btn.getAttribute('data-task-id');
        var title  = btn.getAttribute('data-task-title');
        _showDeclineDialog(taskId, title, suffix, function () {
          var card = btn.closest('.oi-card');
          if (card) card.remove();
          var sec = btn.closest('.lrail-sec');
          if (sec && sec.querySelectorAll('.oi-card').length === 0) sec.remove();
        });
      });
    });
  }
