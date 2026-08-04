/**
 * branch-detail.js — Branch Portfolio "Branch Detail" page.
 * Registered as PortfolioRouter.register('branch-detail', fn).
 *
 * Fetches GET /api/portfolio/branches/:id (the URL param is named :communityId
 * in the route but the value passed is branch.id from the branches list).
 * Appends ?organizationId=<id> when in admin preview mode.
 *
 * Renders:
 *   • Branch Selector block (dropdown + ‹ › arrows)
 *   • Title row (name, PNC code, address · city, group chip)
 *   • Layer tab bar — "Summary" always first, then one tab per main-layer category
 *     (Site Grounds, Irrigation, Snow, Trees).  Each category tab has a sub-layer
 *     toggle panel, combined KPI strip, lazy map, and inventory table.
 *   • Snow category tab prepends a winter season block when data is available.
 */
(function () {
  'use strict';

  var esc = (window.VRTUtils && window.VRTUtils.esc) || function (v) { return v == null ? '' : String(v); };

  // ── Demo presentation flag ─────────────────────────────────────────────────
  // Set to false to hide "· opened <date>" on work order rows during demos
  // where all work orders share the same creation date.  Flip back to true once
  // real historical data has accumulated.
  var SHOW_WORK_ORDER_DATES = false;

  /**
   * Ordered list of main layer categories.  Tabs appear in this order; any
   * layer_key not listed here falls through with a title-cased label so a
   * new type surfaces automatically without code changes.
   */
  var LAYER_HIERARCHY = [
    { key: 'community',  label: 'Site Grounds' },
    { key: 'irrigation', label: 'Irrigation'   },
    { key: 'snow',       label: 'Snow'          },
    { key: 'trees',      label: 'Trees'         },
  ];

  /** Return tab accent class set for a main-layer category key. */
  function categoryAccent(key) {
    if (key === 'irrigation') return { cls: 't-blue',  panel: 'p-blue',  invcBorder: 'b-blue'  };
    if (key === 'trees')      return { cls: 't-green', panel: 'p-green', invcBorder: 'b-green' };
    if (key === 'community')  return { cls: 't-lime',  panel: 'p-green', invcBorder: 'b-lime'  };
    if (key === 'snow')       return { cls: 't-slate', panel: 'p-slate', invcBorder: 'b-gray'  };
    // Unknown category — use teal defaults
    return { cls: '', panel: '', invcBorder: 'b-teal' };
  }

  // ── Per-branch Leaflet map state ──────────────────────────────────────────
  // One shared iframe is created per branch detail render and moved between
  // tab pane slots. GeoJSON is fetched lazily (per-tab on first visit) and
  // cached in geojsonCache for the lifetime of the current branch view.
  var _bMap = {
    iframe:           null,
    ready:            false,
    pending:          [],
    handler:          null,
    geojsonCache:     null, // Map<layerId, geojson|null> — null = fetched but no geometry
    addedSet:         null, // Set<layerId>  — layers already sent to iframe via addLayers
    layerColors:      null, // Record<layerId, hex> — original colour per layer
    branchId:         null, // current branch id (for GeoJSON URL construction)
    allLayers:        null, // all layers array for current branch (includes outline)
    serviceLayers:    null, // layers where type !== 'outline'
    outlineLayer:     null, // first outline layer, if any — pushed as context shape
    container:        null, // container element (for slot lookup in lazy handlers)
    categoryGroups:   null, // Record<categoryKey, Layer[]> — service layers per category
    categoryOrder:    null, // string[] — ordered category keys that have service layers
    checkedSubLayers: null, // Record<categoryKey, Set<layerId>> — toggle state per category
  };

  function _bCmd(fn) {
    var args = Array.prototype.slice.call(arguments, 1);
    if (!_bMap.iframe || !_bMap.iframe.contentWindow) return;
    if (!_bMap.ready) { _bMap.pending.push({ fn: fn, args: args }); return; }
    _bMap.iframe.contentWindow.postMessage({ type: 'cmd', fn: fn, args: args }, '*');
  }

  function _bFlush() {
    var cmds = _bMap.pending.slice(); _bMap.pending = [];
    cmds.forEach(function (c) { _bCmd.apply(null, [c.fn].concat(c.args)); });
  }

  function _bTeardown() {
    if (_bMap.handler) { window.removeEventListener('message', _bMap.handler); _bMap.handler = null; }
    if (_bMap.iframe && _bMap.iframe.parentNode) _bMap.iframe.parentNode.removeChild(_bMap.iframe);
    _bMap.iframe = null; _bMap.ready = false; _bMap.pending = [];
    _bMap.geojsonCache = null; _bMap.addedSet = null; _bMap.layerColors = null;
    _bMap.branchId = null; _bMap.allLayers = null; _bMap.container = null;
    _bMap.serviceLayers = null; _bMap.outlineLayer = null;
    _bMap.categoryGroups = null; _bMap.categoryOrder = null; _bMap.checkedSubLayers = null;
  }

  /** Dot colour → hex for layer styling (tab underlines/dots only — not geometry). */
  function _dotHex(accent) {
    var map = { blue: '#3b82f6', green: '#10b981', teal: '#25C1AC', gray: '#9ca3af', lime: '#84cc16', slate: '#64748b' };
    return (accent && map[accent.dot]) || '#25C1AC';
  }

  /** Return true only for well-formed 3- or 6-digit hex colours (#RGB or #RRGGBB). */
  var _HEX_RE = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;
  function _isValidHex(s) {
    return typeof s === 'string' && _HEX_RE.test(s.trim());
  }

  /**
   * Per-sub-layer hardcoded default geometry colours.
   * Matches the LAYER_HIERARCHY colors in portal/pages/map.js.
   * Used as fallback when map_layers.color is absent or invalid.
   * Geometry color must NEVER fall back to a tab-accent palette — that
   * produces confusing results when the layer is displayed on a different tab.
   */
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
  /**
   * Return a valid geometry colour for a layer.
   * Resolution order:
   *   1. map_layers.color (admin-configured via Map Layers color picker) — only
   *      accepted when it is a well-formed hex string.
   *   2. Hardcoded per-sub-layer default from _SUBLAYER_DEFAULT_COLORS.
   *   3. Neutral grey — geometry always renders, never silently invisible.
   */
  function _layerColor(layer) {
    var raw = layer && layer.color;
    if (_isValidHex(raw)) return raw.trim();
    var subKey = layer && (layer.subLayerKey || layer.type);
    if (subKey && _SUBLAYER_DEFAULT_COLORS[subKey]) return _SUBLAYER_DEFAULT_COLORS[subKey];
    return '#888888';
  }

  /**
   * Derive a dimmed shade from a hex colour for inactive-layer context rendering.
   * Blends the colour 25% original + 75% white, producing a washed-out tint of
   * the same hue rather than a generic grey.
   * Falls back to a safe neutral when the input is not a valid hex colour.
   */
  function _dimHex(hex) {
    if (!_isValidHex(hex)) return '#c8cdd4';
    try {
      var h = hex.trim().replace('#', '');
      if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
      var r = parseInt(h.substr(0,2), 16);
      var g = parseInt(h.substr(2,2), 16);
      var b = parseInt(h.substr(4,2), 16);
      var dr = Math.round(r * 0.25 + 255 * 0.75);
      var dg = Math.round(g * 0.25 + 255 * 0.75);
      var db = Math.round(b * 0.25 + 255 * 0.75);
      return '#' + ('0'+dr.toString(16)).slice(-2) + ('0'+dg.toString(16)).slice(-2) + ('0'+db.toString(16)).slice(-2);
    } catch (_) { return '#c8cdd4'; }
  }

  /**
   * Fetch one layer's GeoJSON lazily. Returns a Promise<geojson|null>.
   * Fetches regardless of assetCount — outline layers have geometry but no assets.
   * Result is cached so repeat calls are instant with no network round-trip.
   */
  function _fetchLayer(layer) {
    if (_bMap.geojsonCache.has(layer.id)) return Promise.resolve(_bMap.geojsonCache.get(layer.id));
    var suffix = orgParam();
    var url = '/api/portfolio/branches/' + encodeURIComponent(_bMap.branchId)
      + '/layers/' + encodeURIComponent(layer.id) + '/geojson' + suffix;
    return apiFetch(url).then(function (geojson) {
      // Treat null/empty feature collections as "no geometry"
      var hasFeatures = geojson
        && geojson.features
        && geojson.features.length > 0;
      var val = hasFeatures ? geojson : null;
      _bMap.geojsonCache.set(layer.id, val);
      return val;
    }).catch(function (err) {
      console.warn('[branch-detail] geojson fetch failed layer=' + layer.id, err);
      _bMap.geojsonCache.set(layer.id, null);
      return null;
    });
  }

  /**
   * Send any newly-fetched layers to the iframe's addLayers cache.
   * Skips layers that are already in the iframe's layerCache (tracked by addedSet).
   * Records original colours in _bMap.layerColors so dimming can be undone.
   */
  function _pushNewLayers(layers, geojsonMap) {
    var toAdd = [];
    layers.forEach(function (layer) {
      if (_bMap.addedSet.has(layer.id)) return;
      if (layer.type === 'outline') return; // outline is pushed via setCommunityOutline, not addLayers
      var geojson = geojsonMap[layer.id];
      if (!geojson) return;
      // _layerColor validates the API color and falls back to the accent palette for
      // null, empty, or malformed values so geometry always has a usable hex color.
      var color  = _layerColor(layer);
      _bMap.layerColors[layer.id] = color; // remember for dimming restore
      toAdd.push({
        id: layer.id,
        layerKey:    layer.type || 'community',
        subLayerKey: layer.subLayerKey || layer.type || 'community',
        displayName: layer.name,
        color:       color,
        geojson:     geojson,
      });
      _bMap.addedSet.add(layer.id);
    });
    if (toAdd.length > 0) _bCmd('addLayers', toAdd);
  }

  /**
   * Fetch the outline layer's GeoJSON (cached) and send it to the iframe as a
   * community boundary shape via setCommunityOutline.  The iframe renders it as
   * a neutral grey context polygon that does not participate in dimming or
   * showLayerIds visibility toggling.  No-ops when there is no outline layer or
   * when its GeoJSON is empty.
   */
  function _pushOutline() {
    var outline = _bMap.outlineLayer;
    if (!outline) return;
    _fetchLayer(outline).then(function (geojson) {
      if (geojson) _bCmd('setCommunityOutline', geojson);
    });
  }

  /**
   * Show a "no geometry" notice overlaid on the stable map container.
   * The iframe is never removed — only a notice div is layered on top.
   */
  function _showNoGeometry() {
    if (!_bMap.container) return;
    var stable = _bMap.container.querySelector('#bmap-stable');
    if (!stable || stable.querySelector('.bmap-no-geom-notice')) return;
    var notice = document.createElement('div');
    notice.className = 'bmap-no-geom-notice map-placeholder';
    notice.innerHTML = '<div class="mp-note">No geometry mapped for this layer yet</div>';
    stable.appendChild(notice);
  }

  /** Remove the "no geometry" notice from the stable map container. */
  function _clearNoGeometry() {
    if (!_bMap.container) return;
    var stable = _bMap.container.querySelector('#bmap-stable');
    if (!stable) return;
    var notice = stable.querySelector('.bmap-no-geom-notice');
    if (notice) notice.remove();
  }
  /**
   * Show the Summary tab: fetch ALL layers (including outline layers that have
   * geometry but no assets), push new ones to the iframe, restore original colours,
   * then show all with showLayerIds.  If nothing has geometry, show placeholder.
   * No network activity for layers already in the cache.
   */
  function _showSummaryTab() {
    var layers = _bMap.allLayers || [];
    if (layers.length === 0) { _showNoGeometry(); return; }
    Promise.all(layers.map(function (l) {
      return _fetchLayer(l).then(function (g) { return { id: l.id, layer: l, g: g }; });
    })).then(function (results) {
      var gmap = {};
      results.forEach(function (r) { gmap[r.id] = r.g; });
      _pushNewLayers(layers, gmap);
      var allIds = layers.filter(function (l) { return gmap[l.id]; }).map(function (l) { return l.id; });
      if (allIds.length === 0) { _showNoGeometry(); return; }
      // Iframe stays in #bmap-stable — never re-parented.
      _clearNoGeometry();
      _bCmd('showLayerIds', allIds);
      // Restore original colours for all layers (undo any per-tab dimming)
      allIds.forEach(function (id) {
        _bCmd('updateLayerColor', id, _bMap.layerColors[id] || '#25C1AC');
      });
      // setCommunityOutline renders the border polygon; setOutlineBounds stores
      // communityBounds from the same GeoJSON so fitToContent can fall back to the
      // outline extent when no service layers are currently visible.
      // Both must arrive at the iframe before fitToContent.
      if (_bMap.outlineLayer && gmap[_bMap.outlineLayer.id]) {
        _bCmd('setCommunityOutline', gmap[_bMap.outlineLayer.id]);
        _bCmd('setOutlineBounds',    gmap[_bMap.outlineLayer.id]);
      } else {
        _pushOutline();
      }
      _bCmd('fitToContent', [], null);
    });
  }

  /**
   * Show a category tab: lazily fetch all layers in the category (plus the outline
   * layer) in one parallel batch, push new service layers to the iframe, then show
   * only the checked sub-layers.  The outline is included in the same Promise.all so
   * setCommunityOutline is always dispatched synchronously—from the resolved
   * result—before fitToContent, regardless of whether the cache is warm or cold.
   */
  function _showCategoryTab(categoryKey) {
    var layers = (_bMap.categoryGroups && _bMap.categoryGroups[categoryKey]) || [];
    if (layers.length === 0) { _showNoGeometry(); return; }

    // Always include the outline in the fetch list so its GeoJSON is resolved
    // inside this .then() and can be sent before fitToContent in every code path.
    var outline  = _bMap.outlineLayer;
    var fetchList = outline ? layers.concat([outline]) : layers;

    Promise.all(fetchList.map(function (l) {
      return _fetchLayer(l).then(function (g) { return { id: l.id, layer: l, g: g }; });
    })).then(function (results) {
      var gmap = {};
      results.forEach(function (r) { gmap[r.id] = r.g; });
      // _pushNewLayers skips the outline type internally — safe to pass the full gmap.
      _pushNewLayers(layers, gmap);

      // Iframe stays in #bmap-stable — never re-parented.

      // Update any "no data" disabled state in the sub-layer overlay based on actual geometry
      _syncSubLayerPanelState(categoryKey, gmap);

      // Collect checked + has-geometry sub-layer IDs
      var checkedSet = (_bMap.checkedSubLayers && _bMap.checkedSubLayers[categoryKey]) || new Set();
      var checkedIds = layers
        .filter(function (l) { return checkedSet.has(l.id) && gmap[l.id]; })
        .map(function (l) { return l.id; });

      // If nothing has any geometry at all, show placeholder
      var anyGeometry = layers.some(function (l) { return gmap[l.id]; });
      if (!anyGeometry) { _showNoGeometry(); return; }
      _clearNoGeometry();

      // Restore all loaded layer colours (no dimming — category view shows/hides)
      Array.from(_bMap.addedSet).forEach(function (id) {
        _bCmd('updateLayerColor', id, _bMap.layerColors[id] || '#25C1AC');
      });

      _bCmd('showLayerIds', checkedIds);
      // setCommunityOutline renders the border polygon; setOutlineBounds stores
      // communityBounds so fitToContent can fall back to the outline extent when
      // no service sub-layers are currently checked/visible.
      // gmap[outline.id] comes from the parallel fetch above — always synchronous.
      if (outline && gmap[outline.id]) {
        _bCmd('setCommunityOutline', gmap[outline.id]);
        _bCmd('setOutlineBounds',    gmap[outline.id]);
      }
      _bCmd('fitToContent', [], null);
    });
  }

  /**
   * After fetching GeoJSON for a category, update the sub-layer checkbox rows in
   * the DOM to reflect actual geometry availability (disables rows with no data,
   * adds "no data" hint).  Defensive — no-ops if the panel elements are absent.
   */
  function _syncSubLayerPanelState(categoryKey, gmap) {
    if (!_bMap.container) return;
    var rows = _bMap.container.querySelectorAll('.bd-sublayer-row[data-category-key="' + categoryKey + '"]');
    rows.forEach(function (row) {
      var layerId = row.getAttribute('data-layer-id');
      var hasGeometry = !!(gmap && gmap[layerId]);
      var cb = row.querySelector('input[type="checkbox"]');
      if (!hasGeometry) {
        row.classList.add('bd-sublayer-row--disabled');
        if (cb) { cb.disabled = true; cb.checked = false; }
        // Add "no data" hint if not already present
        if (!row.querySelector('.bd-no-data')) {
          var label = row.querySelector('.bd-sub-label');
          if (label) {
            var hint = document.createElement('span');
            hint.className = 'bd-no-data';
            hint.textContent = 'no data';
            label.parentNode.insertBefore(hint, label.nextSibling);
          }
        }
        // Remove from checked set
        if (_bMap.checkedSubLayers && _bMap.checkedSubLayers[categoryKey]) {
          _bMap.checkedSubLayers[categoryKey].delete(layerId);
        }
      } else {
        row.classList.remove('bd-sublayer-row--disabled');
        if (cb) { cb.disabled = false; }
      }
    });
  }

  /**
   * Switch the map to show the requested tab's layers.
   * tabIdx 0 = Summary; tabIdx > 0 = categoryOrder[tabIdx-1].
   *
   * ⚠️ HAZARD: re-parenting an iframe reloads it and empties the map's
   * layerCache.  The iframe MUST stay in #bmap-stable.  We use CSS to
   * position the panel, never DOM moves.
   */
  function _switchToTab(tabIdx) {
    if (!_bMap.iframe || !_bMap.container) return;
    _bMap.activeTab = tabIdx; // persist so post-reload mapReady can restore this tab
    _updateSublayerOverlay(tabIdx);
    _bCmd('invalidateSize');
    if (tabIdx === 0) {
      _updateMapPanelTitle('Property Map');
      _showSummaryTab();
    } else {
      var order = _bMap.categoryOrder || [];
      var categoryKey = order[tabIdx - 1];
      if (!categoryKey) return;
      _updateMapPanelTitle(_categoryLabel(categoryKey) + ' Map');
      _showCategoryTab(categoryKey);
    }
  }

  /** Update the stable map panel's header title. */
  function _updateMapPanelTitle(title) {
    if (!_bMap.container) return;
    var el = _bMap.container.querySelector('#bmap-panel-title');
    if (el) el.textContent = title;
  }
  /**
   * Mount the shared Leaflet iframe in the summary (or first available) slot
   * and register the mapReady message listener.
   * Called after renderDetailPage() sets the container innerHTML.
   */
  function setupBranchMaps(container, data) {
    _bTeardown();
    var layers = data.layers || [];
    var serviceLayers = layers.filter(function (l) { return l.type !== 'outline'; });

    // Build category groups ordered by LAYER_HIERARCHY; unknown types appended after.
    var categoryGroups = {};
    var categoryOrder = [];
    var seenKeys = {};

    // Process in LAYER_HIERARCHY order first
    LAYER_HIERARCHY.forEach(function (cat) {
      var group = serviceLayers.filter(function (l) { return l.type === cat.key; });
      if (group.length > 0) {
        categoryGroups[cat.key] = group;
        categoryOrder.push(cat.key);
        seenKeys[cat.key] = true;
      }
    });
    // Append any unknown category keys not in LAYER_HIERARCHY
    serviceLayers.forEach(function (l) {
      if (!seenKeys[l.type]) {
        if (!categoryGroups[l.type]) { categoryGroups[l.type] = []; categoryOrder.push(l.type); }
        categoryGroups[l.type].push(l);
        seenKeys[l.type] = true;
      }
    });

    // Initialize checked sub-layers: all layers with hasGeometry start checked
    var checkedSubLayers = {};
    categoryOrder.forEach(function (key) {
      checkedSubLayers[key] = new Set();
      (categoryGroups[key] || []).forEach(function (l) {
        if (l.hasGeometry) checkedSubLayers[key].add(l.id);
      });
    });

    _bMap.geojsonCache      = new Map();
    _bMap.addedSet          = new Set();
    _bMap.layerColors       = {};
    _bMap.branchId          = data.branch.id;
    _bMap.allLayers         = layers;
    _bMap.serviceLayers     = serviceLayers;
    _bMap.outlineLayer      = layers.find(function (l) { return l.type === 'outline'; }) || null;
    _bMap.container         = container;
    _bMap.categoryGroups    = categoryGroups;
    _bMap.categoryOrder     = categoryOrder;
    _bMap.checkedSubLayers  = checkedSubLayers;

    // ⚠️ HAZARD: re-parenting an iframe reloads it and empties the Leaflet
    // layerCache inside it.  The iframe is created once and lives permanently
    // in #bmap-stable — it is NEVER moved to another DOM node.
    var slot = container.querySelector('#bmap-stable');
    if (!slot) return; // stable container not present — shouldn't happen

    var iframe = document.createElement('iframe');
    iframe.src = '/leaflet-map.html';
    iframe.className = 'branch-map-iframe';
    iframe.setAttribute('allowfullscreen', 'true');
    _bMap.iframe = iframe;
    slot.appendChild(iframe);

    // If the iframe reloads (e.g. user navigated away and back in the same
    // SPA session), reset the tracking sets so _pushNewLayers re-sends all
    // layers instead of skipping them because addedSet still thinks they are
    // in the now-empty layerCache.
    iframe.addEventListener('load', function () {
      if (!_bMap.ready) return; // first load is handled by mapReady
      console.warn('[branch-detail] map iframe reloaded — resetting layer state');
      _bMap.ready       = false;
      _bMap.addedSet    = new Set();
      _bMap.layerColors = {};
      _bMap.pending     = [];
    });

    _bMap.activeTab = 0; // 0 = Summary; updated by _switchToTab on every switch

    _bMap.handler = function (e) {
      if (!e.data) return;
      // Leaflet template serialises every message with JSON.stringify
      var msg;
      if (typeof e.data === 'string') {
        try { msg = JSON.parse(e.data); } catch (_) { return; }
      } else {
        msg = e.data;
      }
      if (msg.type === 'mapReady' && !_bMap.ready) {
        _bMap.ready = true;
        _bFlush();
        // Restore whichever tab was active when the map became ready.
        // This handles both first load (activeTab=0 → Summary) and
        // any iframe reload that occurs while a category tab is selected.
        _switchToTab(_bMap.activeTab || 0);
      }
    };
    window.addEventListener('message', _bMap.handler);
  }

  // ── Admin org-id suffix ───────────────────────────────────────────────────
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

  // ── Group chip helpers ─────────────────────────────────────────────────────
  var GROUP_COLORS = ['g1', 'g2', 'g3', 'g4', 'g5'];
  function groupColorClass(idx) { return GROUP_COLORS[idx % GROUP_COLORS.length]; }

  function buildGroupLookup(groups) {
    var map = {};
    (groups || []).forEach(function (g, idx) {
      map[g.id] = { name: g.name, colorIdx: idx };
    });
    return map;
  }

  // ── Layer accent color lookup ──────────────────────────────────────────────
  // Colors are cosmetic only — never control which tabs exist.
  function layerAccent(layer) {
    var name = (layer.name || '').toLowerCase();
    var type = (layer.type || '').toLowerCase();
    var combined = name + ' ' + type;
    if (/irrig/.test(combined))         return { cls: 't-blue',  panel: 'p-blue',  invcBorder: 'b-blue',  dot: 'blue'  };
    if (/tree|arbo/.test(combined))     return { cls: 't-green', panel: 'p-green', invcBorder: 'b-green', dot: 'green' };
    if (/turf|ground|lawn|grass|landscape|bed/.test(combined)) {
                                        return { cls: 't-lime',  panel: 'p-green', invcBorder: 'b-lime',  dot: 'green' };
    }
    if (/snow|winter|ice/.test(combined)) return { cls: 't-slate', panel: 'p-slate', invcBorder: 'b-gray', dot: 'gray' };
    return                                       { cls: '',         panel: '',        invcBorder: 'b-teal', dot: 'teal' };
  }

  // ── Branch Selector block ──────────────────────────────────────────────────
  function renderSelectorBlock(currentBranchId, allBranches) {
    var current = null;
    var currentIdx = 0;
    allBranches.forEach(function (b, idx) {
      if (b.id === currentBranchId) { current = b; currentIdx = idx; }
    });

    var label = current ? esc(current.name) : '—';
    var code  = current ? esc(current.code || '') : '';

    var menuItems = '<div class="bsel-item all" id="bs-all-link">← All Branches'
      + '<span class="bi-city">' + esc(allBranches.length) + ' branches</span></div>'
      + '<div class="bs-head">Switch branch</div>'
      + allBranches.map(function (b) {
          var activeCls = b.id === currentBranchId ? ' active' : '';
          return '<div class="bsel-item' + activeCls + '" data-branch-id="' + esc(b.id) + '">'
            + '<span class="bi-code">' + esc(b.code || '') + '</span>'
            + esc(b.name)
            + '<span class="bi-city">' + esc(b.city || '') + '</span>'
            + '</div>';
        }).join('');

    return '<div class="branch-selector-block">'
      + '<div class="bs-label">Branch Selector</div>'
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
          + '<button class="bs-arrow" id="bs-prev" title="Previous branch">‹</button>'
          + '<button class="bs-arrow" id="bs-next" title="Next branch">›</button>'
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

  // ── Category label helper ─────────────────────────────────────────────────
  function _categoryLabel(key) {
    var entry;
    for (var i = 0; i < LAYER_HIERARCHY.length; i++) {
      if (LAYER_HIERARCHY[i].key === key) { entry = LAYER_HIERARCHY[i]; break; }
    }
    if (entry) return entry.label;
    // Unknown key — title-case it
    return key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ');
  }

  /**
   * Build ordered category groups from service layers.
   * Returns { groups: Record<key,Layer[]>, order: string[] }.
   */
  function _buildCategoryGroups(serviceLayers) {
    var groups = {};
    var order  = [];
    var seen   = {};
    LAYER_HIERARCHY.forEach(function (cat) {
      var group = serviceLayers.filter(function (l) { return l.type === cat.key; });
      if (group.length > 0) {
        groups[cat.key] = group;
        order.push(cat.key);
        seen[cat.key] = true;
      }
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

  // ── Tab bar ────────────────────────────────────────────────────────────────
  // Renders one tab per main-layer category (not per sub-layer).
  // Badge shows summed asset count across all sub-layers in the category.
  function renderTabBar(categoryOrder, categoryGroups, activeIdx) {
    // activeIdx 0 = Summary
    var summaryOn = activeIdx === 0 ? ' on' : '';
    var tabs = '<div class="tab' + summaryOn + '" data-tab-idx="0">Summary</div>';

    categoryOrder.forEach(function (key, i) {
      var idx        = i + 1;
      var accent     = categoryAccent(key);
      var label      = _categoryLabel(key);
      var catLayers  = categoryGroups[key] || [];
      var totalCount = catLayers.reduce(function (s, l) { return s + (l.assetCount || 0); }, 0);
      var on         = activeIdx === idx ? ' on' : '';
      tabs += '<div class="tab ' + accent.cls + on + '" data-tab-idx="' + idx + '" data-category-key="' + esc(key) + '">'
        + esc(label)
        + '<span class="tcount">' + esc(totalCount) + '</span>'
        + '</div>';
    });

    return '<div class="tabs" id="branch-tab-bar">' + tabs + '</div>';
  }

  // ── Sub-layer toggle panel ─────────────────────────────────────────────────
  // Renders one checkbox row per sub-layer with colour swatch and asset count.
  // Rows are disabled (with "no data" hint) only when hasGeometry is false.
  function renderSubLayerPanel(categoryKey, layers) {
    if (layers.length === 0) return '';
    var rows = layers.map(function (layer) {
      var color        = _isValidHex(layer.color) ? layer.color.trim() : _dotHex(layerAccent(layer));
      var hasGeo       = layer.hasGeometry;
      var disabledAttr = hasGeo ? '' : ' disabled';
      var disabledCls  = hasGeo ? '' : ' bd-sublayer-row--disabled';
      var checkedAttr  = hasGeo ? ' checked' : '';
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

  // ── KPI strip (4-cell) ─────────────────────────────────────────────────────
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

  // ── Map placeholder panel (used only when assetCount === 0) ──────────────
  function renderMapPlaceholder(title, panelClass) {
    return '<div class="panel ' + esc(panelClass || '') + '">'
      + '<div class="panel-head"><h2>' + esc(title) + '</h2></div>'
      + '<div class="map-placeholder">'
        + '<div class="mp-note">No geometry mapped for this layer yet</div>'
      + '</div>'
      + '</div>';
  }

  // ── Live Leaflet map panel ─────────────────────────────────────────────────
  // Returns an HTML string with a uniquely-id'd mount point for the shared iframe.
  function renderMapPanel(title, panelClass, slotId) {
    return '<div class="panel ' + esc(panelClass || '') + '">'
      + '<div class="panel-head"><h2>' + esc(title) + '</h2></div>'
      + '<div class="branch-map-container" id="' + esc(slotId) + '"></div>'
      + '</div>';
  }

  /**
   * Render the single stable Leaflet map panel that lives OUTSIDE the tab panes.
   * The iframe is always mounted in #bmap-stable and is never re-parented.
   * The sub-layer overlay (#bmap-sublayer-overlay) is updated by _updateSublayerOverlay
   * whenever the active tab changes.
   */
  function renderStableMapPanel() {
    return '<div class="panel p-blue" id="branch-map-panel">'
      + '<div class="panel-head">'
        + '<h2 id="bmap-panel-title">Property Map</h2>'
        + '<button class="bmap-expand-btn" id="bmap-expand-btn" title="Expand map" aria-label="Expand map" aria-pressed="false">'
          + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'
            + '<path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/>'
          + '</svg>'
        + '</button>'
      + '</div>'
      + '<div id="bmap-sublayer-overlay"></div>'
      + '<div class="branch-map-container" id="bmap-stable"></div>'
      + '</div>';
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
  // Compact per-category rows: label · total assets · active sub-layer count.
  // categoryOrder is the tab order built by _buildCategoryGroups — used to
  // derive the tab index (Summary = 0, first category = 1, …).
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

      // Derive a CSS color name from the accent class (e.g. 't-blue' → 'blue')
      var accentColor = (accent.cls || '').replace('t-', '') || 'teal';

      var assetsLabel = isEmpty
        ? '<span class="bd-cat-inv-assets bd-cat-inv-none">no data</span>'
        : '<span class="bd-cat-inv-assets"><b>' + esc(total) + '</b> asset' + (total !== 1 ? 's' : '') + '</span>';

      var subLabel = isEmpty
        ? ''
        : '<span class="bd-cat-inv-sublayers">' + esc(catLayers.length) + ' sub-layer' + (catLayers.length !== 1 ? 's' : '')
          + (activeSubs < catLayers.length ? ' · <span class="bd-cat-inv-active">' + esc(activeSubs) + ' mapped</span>' : '')
          + '</span>';

      return '<div class="bd-cat-inv-row' + emptyCls + '" data-tab-idx="' + tabIdx + '" role="button" tabindex="0">'
        + '<span class="bd-cat-inv-dot bd-cat-inv-dot--' + esc(accentColor) + '"></span>'
        + '<span class="bd-cat-inv-label">' + esc(label) + '</span>'
        + assetsLabel
        + subLabel
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
    var branch = data.branch;
    var layers = data.layers || [];
    var svcs   = data.recentServices || [];
    var openWOs = data.openWorkOrders || [];

    // KPI strip: assets, layers, open WOs, last service
    var totalAssets = layers.reduce(function (s, l) { return s + l.assetCount; }, 0);
    var lastSvcDate = svcs.length > 0 ? fmtDate(svcs[0].date) : '—';

    var kpis = renderKpiStrip([
      { label: 'Assets Mapped',   value: totalAssets,     border: 'b-blue'  },
      { label: 'Layers',          value: layers.length,   border: 'b-teal'  },
      { label: 'Open Work Orders',value: openWOs.length,  border: 'b-amber' },
      { label: 'Last Service',    value: lastSvcDate,     border: 'b-green' },
    ]);

    // Category breakdown: one row per main-layer category
    var serviceLayers    = layers.filter(function (l) { return l.type !== 'outline'; });
    var catResult        = _buildCategoryGroups(serviceLayers);
    var breakdownHtml    = renderCategoryBreakdown(catResult.order, catResult.groups);

    // The map is rendered in the single stable panel outside the tab panes.

    // Recent services panel
    var svcRows = svcs.length > 0
      ? svcs.slice(0, 8).map(renderServiceRow).join('')
      : '<div class="pf-empty">No services recorded yet.</div>';

    var svcPanel = '<div class="panel p-green">'
      + '<div class="panel-head"><h2>Recent Services</h2>'
      + '<span class="hint">' + esc(svcs.length) + ' total</span>'
      + '</div>'
      + svcRows
      + '</div>';

    // Open WOs panel
    var woRows;
    if (openWOs.length === 0) {
      woRows = '<div class="pf-empty">No open work orders.</div>';
    } else {
      woRows = openWOs.map(function (wo) {
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
    }

    var woPanel = '<div class="panel p-amber">'
      + '<div class="panel-head"><h2>Open Work Orders</h2>'
      + '<span class="hint">' + esc(openWOs.length) + ' open</span>'
      + '</div>'
      + woRows
      + '</div>';

    return kpis + breakdownHtml
      + '<div class="two-col">' + svcPanel + woPanel + '</div>';
  }

  // ── Category tab content ─────────────────────────────────────────────────
  // One pane per main-layer category.  Shows sub-layer toggle panel + map +
  // combined KPI/inventory for all sub-layers in the category.
  function renderCategoryContent(categoryKey, categoryLayers, data) {
    var accent        = categoryAccent(categoryKey);
    var categoryLabel = _categoryLabel(categoryKey);
    var inventory     = data.inventory || [];
    var svcs          = data.recentServices || [];

    // Filter inventory to all sub-layers in this category
    var catLayerIds = categoryLayers.map(function (l) { return l.id; });
    var catInv = inventory.filter(function (inv) {
      return catLayerIds.indexOf(inv.layerId) !== -1;
    });

    var totalAssets  = categoryLayers.reduce(function (s, l) { return s + (l.assetCount || 0); }, 0);
    var distinctTypes = catInv.length;
    var lastSvcDate   = svcs.length > 0 ? fmtDate(svcs[0].date) : '—';

    // Sub-layer checkboxes are rendered in #bmap-sublayer-overlay (the stable
    // map panel's overlay) by _updateSublayerOverlay on each tab switch.

    var kpiStrip = renderKpiStrip([
      { label: 'Assets',       value: totalAssets,                        border: accent.invcBorder },
      { label: 'Asset Types',  value: distinctTypes,                      border: accent.invcBorder },
      { label: 'Last Service', value: lastSvcDate,                        border: 'b-teal'          },
      { label: 'Open Items',   value: (data.openWorkOrders || []).length, border: 'b-amber'         },
    ]);

    // The map is rendered in the single stable panel outside the tab panes.

    // Inventory table (all sub-layers combined)
    var invRows;
    if (catInv.length === 0) {
      invRows = '<div class="pf-empty">No assets mapped for this category yet.</div>';
    } else {
      invRows = '<table><thead><tr><th>Asset Type</th><th class="num">Count</th></tr></thead><tbody>'
        + catInv.map(function (inv) {
            var typeName = (inv.assetType || '').replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
            return '<tr><td class="bname">' + esc(typeName) + '</td><td class="num">' + esc(inv.count) + '</td></tr>';
          }).join('')
        + '</tbody></table>';
    }

    var invPanel = '<div class="panel ' + esc(accent.panel) + '">'
      + '<div class="panel-head"><h2>' + esc(categoryLabel) + ' Inventory</h2></div>'
      + invRows
      + '</div>';

    // Service history — branch-wide services shown on Summary; per-layer attribution not yet available
    var svcContent = '<div class="pf-empty" style="font-style:italic;color:var(--gray-400);">'
      + 'Per-layer service history will appear here once service records include layer attribution.'
      + '</div>';

    var svcPanel = '<div class="panel ' + esc(accent.panel) + '">'
      + '<div class="panel-head"><h2>' + esc(categoryLabel) + ' Service History</h2>'
      + (svcs.length > 0 ? '<span class="hint">' + esc(svcs.length) + ' recent</span>' : '')
      + '</div>'
      + svcContent
      + '</div>';

    var contentHtml = kpiStrip
      + '<div class="two-col">' + invPanel + svcPanel + '</div>';

    // Snow category: prepend winter season block
    if (categoryKey === 'snow') {
      var snowSeason = data.snowSeason;
      var snowBlock;
      if (snowSeason) {
        snowBlock = '<div class="winter" style="margin-bottom:18px;">'
          + '<div><div class="w-label">Winter Operations</div>'
          + '<div class="w-main">' + esc(snowSeason.seasonLabel || 'Season') + '</div></div>'
          + (snowSeason.events != null    ? '<div class="w-stat"><b>' + esc(snowSeason.events)      + '</b><span>snow events</span></div>'  : '')
          + (snowSeason.clearings != null ? '<div class="w-stat"><b>' + esc(snowSeason.clearings)   + '</b><span>clearings</span></div>'    : '')
          + (snowSeason.photoPct != null  ? '<div class="w-stat"><b>' + esc(snowSeason.photoPct)    + '%</b><span>photo + timestamp</span></div>' : '')
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

    var branch = data.branch;
    var layers = data.layers || [];
    // Exclude outline layers — pushed separately as context shape, never a tab.
    var serviceLayers = layers.filter(function (l) { return l.type !== 'outline'; });

    // Group service layers into ordered main-layer categories
    var catResult      = _buildCategoryGroups(serviceLayers);
    var categoryOrder  = catResult.order;
    var categoryGroups = catResult.groups;

    var selectorHtml = renderSelectorBlock(branchId, allBranches);
    var titleHtml    = renderTitleRow(branch, groupLookup);
    var tabBarHtml   = renderTabBar(categoryOrder, categoryGroups, 0 /* start on Summary */);

    // Summary pane (always index 0)
    var summaryPane = '<div class="tabpane on" data-pane-idx="0">'
      + renderSummaryTab(data)
      + '</div>';

    // One pane per main-layer category
    var categoryPanes = categoryOrder.map(function (key, i) {
      var catLayers = categoryGroups[key] || [];
      return '<div class="tabpane" data-pane-idx="' + (i + 1) + '" data-category-key="' + esc(key) + '">'
        + renderCategoryContent(key, catLayers, data)
        + '</div>';
    }).join('');

    // The stable map panel is rendered OUTSIDE the tab panes so the shared
    // iframe is never re-parented when switching tabs.
    container.innerHTML = selectorHtml + titleHtml + tabBarHtml
      + renderStableMapPanel()
      + summaryPane + categoryPanes;

    wireSelectorBlock(container, branchId, allBranches);
    wireTabBar(container);
    // wireSubLayerToggles is a no-op here because sub-layer checkboxes now
    // live in #bmap-sublayer-overlay (populated by _updateSublayerOverlay on
    // each tab switch) rather than in the tab panes.
    _wireExpandButton(container);
    setupBranchMaps(container, data);
  }

  // ── Wire selector block ────────────────────────────────────────────────────
  function wireSelectorBlock(container, currentBranchId, allBranches) {
    var menu = container.querySelector('#bsel-menu');
    var btn  = container.querySelector('#bsel-toggle-btn');

    if (!btn || !menu) return;

    // Toggle dropdown
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var isOpen = menu.classList.toggle('open');
      btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    // Close on outside click
    document.addEventListener('click', function closeOnOutside(e) {
      if (!container.contains(e.target)) {
        menu.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
      }
    });

    // "All Branches" link
    var allLink = container.querySelector('#bs-all-link');
    if (allLink) {
      allLink.addEventListener('click', function () {
        if (window.PortfolioRouter) PortfolioRouter.navigate('branches', true, {});
      });
    }

    // Branch items in dropdown
    container.querySelectorAll('.bsel-item[data-branch-id]').forEach(function (item) {
      item.addEventListener('click', function () {
        var id = item.getAttribute('data-branch-id');
        if (id && id !== currentBranchId && window.PortfolioRouter) {
          PortfolioRouter.navigate('branch-detail', true, { id: id });
        }
      });
    });

    // Prev / Next arrows
    var currentIdx = allBranches.findIndex
      ? allBranches.findIndex(function (b) { return b.id === currentBranchId; })
      : (function () {
          for (var i = 0; i < allBranches.length; i++) {
            if (allBranches[i].id === currentBranchId) return i;
          }
          return -1;
        })();

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
      var target = container.querySelector('.tabpane[data-pane-idx="' + idx + '"]');
      if (target) target.classList.add('on');

      // Move the shared iframe to the new slot and lazy-load geometry.
      // Tab 0 = Summary (all layers); Tab N = categoryOrder[N-1].
      _switchToTab(idx);
    }

    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        activateTab(parseInt(tab.getAttribute('data-tab-idx'), 10));
      });
    });

    // Category breakdown rows in the Summary pane — clicking navigates to
    // the corresponding category tab.
    container.querySelectorAll('.bd-cat-inv-row[data-tab-idx]').forEach(function (row) {
      row.addEventListener('click', function () {
        activateTab(parseInt(row.getAttribute('data-tab-idx'), 10));
      });
      // Keyboard accessibility
      row.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activateTab(parseInt(row.getAttribute('data-tab-idx'), 10));
        }
      });
    });
  }

  // ── Wire sub-layer toggle checkboxes ──────────────────────────────────────
  function wireSubLayerToggles(container) {
    container.querySelectorAll('.bd-sublayer-row input[type="checkbox"]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var categoryKey = cb.getAttribute('data-category-key');
        var layerId     = cb.getAttribute('data-layer-id');
        if (!categoryKey || !layerId || !_bMap.checkedSubLayers) return;

        if (!_bMap.checkedSubLayers[categoryKey]) _bMap.checkedSubLayers[categoryKey] = new Set();
        if (cb.checked) {
          _bMap.checkedSubLayers[categoryKey].add(layerId);
        } else {
          _bMap.checkedSubLayers[categoryKey].delete(layerId);
        }

        // Build the visible ID list: checked sub-layers that have actual geometry
        var catLayers = (_bMap.categoryGroups && _bMap.categoryGroups[categoryKey]) || [];
        var checkedSet = _bMap.checkedSubLayers[categoryKey];
        var checkedIds = catLayers.filter(function (l) {
          return checkedSet.has(l.id) && _bMap.geojsonCache && _bMap.geojsonCache.get(l.id);
        }).map(function (l) { return l.id; });

        // Restore all loaded layer colours to full (no dimming — category view shows/hides)
        Array.from(_bMap.addedSet || []).forEach(function (id) {
          _bCmd('updateLayerColor', id, _bMap.layerColors[id] || '#25C1AC');
        });

        _bCmd('showLayerIds', checkedIds);
        // setCommunityOutline renders the border; setOutlineBounds stores
        // communityBounds so fitToContent can fall back to the outline extent
        // when all service sub-layers are unchecked.  The category tab must
        // have been visited before toggles can fire, so the outline GeoJSON is
        // always in geojsonCache by this point.
        var toggleOutline = _bMap.outlineLayer;
        var toggleOutlineGeo = toggleOutline && _bMap.geojsonCache
          ? _bMap.geojsonCache.get(toggleOutline.id)
          : undefined;
        if (toggleOutlineGeo) {
          _bCmd('setCommunityOutline', toggleOutlineGeo);
          _bCmd('setOutlineBounds',    toggleOutlineGeo);
        }
        _bCmd('fitToContent', [], null);
      });
    });
  }

  // ── Main render ────────────────────────────────────────────────────────────
  function renderBranchDetail(container, params) {
    // Tear down any map from a previous render (branch navigation)
    _bTeardown();

    var branchId = params && params.id;
    if (!branchId) {
      container.innerHTML = '<div class="pf-empty">No branch ID specified.</div>';
      return;
    }

    var orgSuffix = orgParam();
    var url = '/api/portfolio/branches/' + encodeURIComponent(branchId) + orgSuffix;

    apiFetch(url).then(function (data) {
      renderDetailPage(container, data, branchId);
    }).catch(function (err) {
      console.error('[portfolio/branch-detail] fetch failed:', err);
      container.innerHTML = '<div class="pf-empty">Failed to load branch data. Please refresh.</div>';
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
  /**
   * Populate the sub-layer overlay inside the stable map panel for the given tab.
   * tabIdx 0 = Summary → empty overlay.
   * tabIdx > 0 = category sub-layers for categoryOrder[tabIdx-1].
   * Wires checkbox toggle listeners after rendering the new HTML.
   */
  function _updateSublayerOverlay(tabIdx) {
    if (!_bMap.container) return;
    var overlay = _bMap.container.querySelector('#bmap-sublayer-overlay');
    if (!overlay) return;
    if (tabIdx === 0) {
      overlay.innerHTML = '';
      return;
    }
    var order = _bMap.categoryOrder || [];
    var categoryKey = order[tabIdx - 1];
    if (!categoryKey) { overlay.innerHTML = ''; return; }
    var catLayers = (_bMap.categoryGroups && _bMap.categoryGroups[categoryKey]) || [];
    overlay.innerHTML = renderSubLayerPanel(categoryKey, catLayers);
    // Wire toggle listeners for the freshly-rendered checkboxes in the overlay
    overlay.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var ck  = cb.getAttribute('data-category-key');
        var lid = cb.getAttribute('data-layer-id');
        if (!ck || !lid || !_bMap.checkedSubLayers) return;
        if (!_bMap.checkedSubLayers[ck]) _bMap.checkedSubLayers[ck] = new Set();
        if (cb.checked) { _bMap.checkedSubLayers[ck].add(lid); }
        else            { _bMap.checkedSubLayers[ck].delete(lid); }
        var catLayersForToggle = (_bMap.categoryGroups && _bMap.categoryGroups[ck]) || [];
        var checkedSet = _bMap.checkedSubLayers[ck];
        var checkedIds = catLayersForToggle.filter(function (l) {
          return checkedSet.has(l.id) && _bMap.geojsonCache && _bMap.geojsonCache.get(l.id);
        }).map(function (l) { return l.id; });
        Array.from(_bMap.addedSet || []).forEach(function (id) {
          _bCmd('updateLayerColor', id, _bMap.layerColors[id] || '#25C1AC');
        });
        _bCmd('showLayerIds', checkedIds);
        var outlineLayer = _bMap.outlineLayer;
        var outlineGeo = outlineLayer && _bMap.geojsonCache
          ? _bMap.geojsonCache.get(outlineLayer.id) : undefined;
        if (outlineGeo) {
          _bCmd('setCommunityOutline', outlineGeo);
          _bCmd('setOutlineBounds',    outlineGeo);
        }
        _bCmd('fitToContent', [], null);
      });
    });
  }

  /**
   * Wire the expand/collapse button for the stable branch map panel.
   * Toggling adds/removes .bmap-panel--expanded on #branch-map-panel.
   * invalidateSize fires after a short delay so Leaflet measures the final
   * container dimensions, not mid-animation ones.
   * The iframe is NEVER re-parented — expand is CSS-only.
   */
  function _wireExpandButton(container) {
    var panel = container.querySelector('#branch-map-panel');
    var btn   = container.querySelector('#bmap-expand-btn');
    if (!panel || !btn) return;

    function postExpandInvalidate() {
      _bCmd('invalidateSize');
    }

    function toggleExpand() {
      var expanded = panel.classList.toggle('bmap-panel--expanded');
      btn.setAttribute('aria-pressed', expanded ? 'true' : 'false');
      btn.title = expanded ? 'Collapse map' : 'Expand map';
      // Call invalidateSize after the CSS expand animation (250 ms) so Leaflet
      // measures the final container dimensions, not mid-animation ones.
      setTimeout(postExpandInvalidate, 270);
    }

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      toggleExpand();
    });

    // Escape key collapses the panel
    document.addEventListener('keydown', function onEsc(e) {
      if (e.key === 'Escape' && panel.classList.contains('bmap-panel--expanded')) {
        panel.classList.remove('bmap-panel--expanded');
        btn.setAttribute('aria-pressed', 'false');
        btn.title = 'Expand map';
        setTimeout(postExpandInvalidate, 270);
      }
    });
  }

})();
