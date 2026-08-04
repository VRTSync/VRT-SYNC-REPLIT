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
 *   • Layer tab bar — "Summary" always first, then one tab per layer in API order
 *   • Tab content — Summary tab + per-layer content (KPI strip, map placeholder,
 *     inventory table, service history); Snow layer appends snowSeason block
 */
(function () {
  'use strict';

  var esc = (window.VRTUtils && window.VRTUtils.esc) || function (v) { return v == null ? '' : String(v); };

  // ── Per-branch Leaflet map state ──────────────────────────────────────────
  // One shared iframe is created per branch detail render and moved between
  // tab pane slots. GeoJSON is fetched lazily (per-tab on first visit) and
  // cached in geojsonCache for the lifetime of the current branch view.
  var _bMap = {
    iframe:        null,
    ready:         false,
    pending:       [],
    handler:       null,
    geojsonCache:  null, // Map<layerId, geojson|null> — null = fetched but no geometry
    addedSet:      null, // Set<layerId>  — layers already sent to iframe via addLayers
    layerColors:   null, // Record<layerId, hex> — original colour per layer (for dimming)
    branchId:      null, // current branch id (for GeoJSON URL construction)
    allLayers:     null, // all layers array for current branch (includes outline)
    serviceLayers: null, // layers where type !== 'outline' — used for tab bar
    outlineLayer:  null, // first outline layer, if any — pushed as context shape
    container:     null, // container element (for slot lookup in lazy handlers)
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
   * Return a valid geometry color for a layer.
   * Accepts the admin-configured color from the API when it is a well-formed hex
   * value; falls back to the tab-accent palette for null, empty, or malformed values
   * so geometry always renders even when the database holds a bad string.
   */
  function _layerColor(layer) {
    var raw = layer && layer.color;
    if (_isValidHex(raw)) return raw.trim();
    return _dotHex(layerAccent(layer));
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
        subLayerKey: layer.type || 'community',
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

  /** Show a "no geometry" notice inside a slot container. */
  function _showNoGeometry(slotId) {
    if (!_bMap.container) return;
    var slot = _bMap.container.querySelector('#' + slotId);
    if (!slot) return;
    // Remove iframe if it's currently in this slot
    if (_bMap.iframe && _bMap.iframe.parentNode === slot) slot.removeChild(_bMap.iframe);
    if (!slot.querySelector('.mp-note')) {
      slot.innerHTML = '<div class="map-placeholder"><div class="mp-note">No geometry mapped for this layer yet</div></div>';
    }
  }

  /**
   * Show the Summary tab: fetch ALL layers (including outline layers that have
   * geometry but no assets), push new ones to the iframe, restore original colours,
   * then show all with showLayerIds.  If nothing has geometry, show placeholder.
   * No network activity for layers already in the cache.
   */
  function _showSummaryTab() {
    var layers = _bMap.allLayers || [];
    if (layers.length === 0) { _showNoGeometry('bmap-summary'); return; }
    Promise.all(layers.map(function (l) {
      return _fetchLayer(l).then(function (g) { return { id: l.id, layer: l, g: g }; });
    })).then(function (results) {
      var gmap = {};
      results.forEach(function (r) { gmap[r.id] = r.g; });
      _pushNewLayers(layers, gmap);
      var allIds = layers.filter(function (l) { return gmap[l.id]; }).map(function (l) { return l.id; });
      if (allIds.length === 0) { _showNoGeometry('bmap-summary'); return; }
      // Ensure iframe is in the summary slot
      var slot = _bMap.container && _bMap.container.querySelector('#bmap-summary');
      if (slot && _bMap.iframe && _bMap.iframe.parentNode !== slot) slot.appendChild(_bMap.iframe);
      _bCmd('showLayerIds', allIds);
      // Restore original colours for all layers (undo any per-tab dimming)
      allIds.forEach(function (id) {
        _bCmd('updateLayerColor', id, _bMap.layerColors[id] || '#25C1AC');
      });
      _bCmd('fitToContent', [], null);
      // Always re-send the outline so it remains visible on the summary view
      _pushOutline();
    });
  }

  /**
   * Show a specific layer tab: lazily fetch only that layer (cache hit = instant),
   * push it to the iframe if new, then show ALL loaded layers but dim the inactive
   * ones via updateLayerColor — so the active layer stands out while the others
   * remain visible as a greyed-out context layer.
   * No network activity if the layer was already loaded.
   */
  function _showLayerTab(layer) {
    if (!layer) return;
    _fetchLayer(layer).then(function (geojson) {
      if (!geojson) { _showNoGeometry('bmap-layer-' + layer.id); return; }
      var gmap = {}; gmap[layer.id] = geojson;
      _pushNewLayers([layer], gmap);
      // Collect all layers that have been loaded into the iframe
      var loadedIds = Array.from(_bMap.addedSet);
      _bCmd('showLayerIds', loadedIds);
      // Active layer: full admin colour; others: washed-out tint derived from
      // each layer's own colour so they stay contextually visible but subdued.
      loadedIds.forEach(function (id) {
        if (id === layer.id) {
          _bCmd('updateLayerColor', id, _bMap.layerColors[id] || '#25C1AC');
        } else {
          _bCmd('updateLayerColor', id, _dimHex(_bMap.layerColors[id] || '#25C1AC'));
        }
      });
      _bCmd('fitToContent', [], null);
      // Always re-send the outline so it remains visible on this tab view
      _pushOutline();
    });
  }

  /**
   * Move the shared iframe into the named slot, then trigger lazy loading
   * for the appropriate tab content.
   * tabIdx 0 = Summary; tabIdx > 0 = layers[tabIdx-1].
   */
  function _switchToTab(tabIdx) {
    if (!_bMap.iframe || !_bMap.container) return;
    var layers = _bMap.serviceLayers || [];
    var slotId, layer;
    if (tabIdx === 0) {
      slotId = 'bmap-summary';
    } else {
      layer = layers[tabIdx - 1];
      if (!layer) return;
      slotId = 'bmap-layer-' + layer.id;
    }
    var slot = _bMap.container.querySelector('#' + slotId);
    if (!slot) return; // this layer has no geometry — no slot was rendered
    slot.appendChild(_bMap.iframe);
    // invariant: after tab switch, active layer id is in showLayerIds set and map container is sized.
    // Moving the iframe to a new DOM slot resets its layout box; invalidateSize tells Leaflet to
    // recalculate its container dimensions so tiles and vectors render at the correct size.
    _bCmd('invalidateSize');
    if (tabIdx === 0) {
      _showSummaryTab();
    } else {
      _showLayerTab(layer);
    }
  }

  /**
   * Mount the shared Leaflet iframe in the summary (or first available) slot
   * and register the mapReady message listener.
   * Called after renderDetailPage() sets the container innerHTML.
   */
  function setupBranchMaps(container, data) {
    _bTeardown();
    var layers = data.layers || [];
    _bMap.geojsonCache  = new Map();
    _bMap.addedSet      = new Set();
    _bMap.layerColors   = {};
    _bMap.branchId      = data.branch.id;
    _bMap.allLayers     = layers;
    _bMap.serviceLayers = layers.filter(function (l) { return l.type !== 'outline'; });
    _bMap.outlineLayer  = layers.find(function (l) { return l.type === 'outline'; }) || null;
    _bMap.container     = container;

    // Mount in summary slot — always present now that we render it unconditionally.
    // Fall back to first layer slot in case the branch has no summary panel.
    var slot = container.querySelector('#bmap-summary');
    if (!slot) {
      for (var i = 0; i < layers.length; i++) {
        slot = container.querySelector('#bmap-layer-' + layers[i].id);
        if (slot) break;
      }
    }
    if (!slot) return; // no map panels at all — shouldn't happen but guard

    var iframe = document.createElement('iframe');
    iframe.src = '/leaflet-map.html';
    iframe.className = 'branch-map-iframe';
    iframe.setAttribute('allowfullscreen', 'true');
    _bMap.iframe = iframe;
    slot.appendChild(iframe);

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
        // Initial tab is always Summary — kick off its lazy load
        _showSummaryTab();
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

  // ── Tab bar ────────────────────────────────────────────────────────────────
  function renderTabBar(layers, activeIdx) {
    // activeIdx 0 = Summary
    var summaryOn = activeIdx === 0 ? ' on' : '';
    var tabs = '<div class="tab' + summaryOn + '" data-tab-idx="0">Summary</div>';

    layers.forEach(function (layer, i) {
      var idx = i + 1;
      var accent = layerAccent(layer);
      var on = activeIdx === idx ? ' on' : '';
      tabs += '<div class="tab ' + accent.cls + on + '" data-tab-idx="' + idx + '">'
        + esc(layer.name)
        + '<span class="tcount">' + esc(layer.assetCount) + '</span>'
        + '</div>';
    });

    return '<div class="tabs" id="branch-tab-bar">' + tabs + '</div>';
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

  // ── Service row ────────────────────────────────────────────────────────────
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

    // Always render the map panel — geometry is fetched lazily and a
    // "no geometry" notice is shown in-slot if the API returns nothing.
    var mapHtml = renderMapPanel('Property Map', 'p-blue', 'bmap-summary');

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
            + '<div class="sr-meta">' + esc(statusLabel) + ' · opened ' + esc(fmtDate(wo.openedAt)) + esc(estimate) + '</div>'
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

    return kpis + mapHtml
      + '<div class="two-col">' + svcPanel + woPanel + '</div>';
  }

  // ── Layer tab content ──────────────────────────────────────────────────────
  function renderLayerContent(layer, data) {
    var accent    = layerAccent(layer);
    var inventory = data.inventory || [];
    var svcs      = data.recentServices || [];

    // Filter inventory to this layer's assets
    var layerInv = inventory.filter(function (inv) {
      return inv.layerId === layer.id;
    });

    // KPI strip
    var distinctTypes   = layerInv.length;
    var totalInvAssets  = layerInv.reduce(function (s, inv) { return s + inv.count; }, 0);
    var lastSvcDate     = svcs.length > 0 ? fmtDate(svcs[0].date) : '—';
    var kpiStrip = renderKpiStrip([
      { label: 'Assets',       value: layer.assetCount || 0, border: accent.invcBorder },
      { label: 'Asset Types',  value: distinctTypes,         border: accent.invcBorder },
      { label: 'Last Service', value: lastSvcDate,           border: 'b-teal'          },
      { label: 'Open Items',   value: (data.openWorkOrders || []).length, border: 'b-amber' },
    ]);

    // Always render the map panel — geometry is fetched lazily and a
    // "no geometry" notice is shown in-slot if the API returns nothing.
    var mapHtml = renderMapPanel(layer.name + ' Map', accent.panel, 'bmap-layer-' + layer.id);

    // Inventory table
    var invRows;
    if (layerInv.length === 0) {
      invRows = '<div class="pf-empty">No assets mapped for this layer yet.</div>';
    } else {
      invRows = '<table><thead><tr><th>Asset Type</th><th class="num">Count</th></tr></thead><tbody>'
        + layerInv.map(function (inv) {
            var typeName = (inv.assetType || '').replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
            return '<tr><td class="bname">' + esc(typeName) + '</td><td class="num">' + esc(inv.count) + '</td></tr>';
          }).join('')
        + '</tbody></table>';
    }

    var invPanel = '<div class="panel ' + esc(accent.panel) + '">'
      + '<div class="panel-head"><h2>' + esc(layer.name) + ' Inventory</h2></div>'
      + invRows
      + '</div>';

    // Service history — branch-wide services are shown on Summary only.
    // Layer-level attribution is not available in the current API schema, so
    // individual layer tabs show an honest empty state rather than misleading
    // the viewer into thinking all branch services belong to this layer.
    var svcContent = '<div class="pf-empty" style="font-style:italic;color:var(--gray-400);">'
      + 'Per-layer service history will appear here once service records include layer attribution.'
      + '</div>';

    var svcPanel = '<div class="panel ' + esc(accent.panel) + '">'
      + '<div class="panel-head"><h2>' + esc(layer.name) + ' Service History</h2>'
      + (svcs.length > 0 ? '<span class="hint">' + esc(svcs.length) + ' recent</span>' : '')
      + '</div>'
      + svcContent
      + '</div>';

    var contentHtml = kpiStrip + mapHtml
      + '<div class="two-col">' + invPanel + svcPanel + '</div>';

    // Snow-type extra block
    var isSnow = /snow|winter|ice/.test((layer.name || '').toLowerCase() + ' ' + (layer.type || '').toLowerCase());
    if (isSnow) {
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
    var state      = window.PortfolioState || {};
    var allBranches = Array.isArray(state.branches) ? state.branches : [];
    var groups      = Array.isArray(state.groups)   ? state.groups   : [];
    var groupLookup = buildGroupLookup(groups);

    var branch = data.branch;
    var layers = data.layers || [];
    // Exclude outline layers from the tab bar — they are boundary shapes, not
    // service layers.  The outline is pushed separately via setCommunityOutline
    // so it always appears as a neutral context shape on every map view.
    var serviceLayers = layers.filter(function (l) { return l.type !== 'outline'; });

    var selectorHtml = renderSelectorBlock(branchId, allBranches);
    var titleHtml    = renderTitleRow(branch, groupLookup);
    var tabBarHtml   = renderTabBar(serviceLayers, 0 /* start on Summary */);

    // Build all tab pane HTML (hidden except index 0)
    var summaryPane = '<div class="tabpane on" data-pane-idx="0">'
      + renderSummaryTab(data)
      + '</div>';

    var layerPanes = serviceLayers.map(function (layer, i) {
      return '<div class="tabpane" data-pane-idx="' + (i + 1) + '">'
        + renderLayerContent(layer, data)
        + '</div>';
    }).join('');

    container.innerHTML = selectorHtml + titleHtml + tabBarHtml + summaryPane + layerPanes;

    // Wire selector block
    wireSelectorBlock(container, branchId, allBranches);

    // Wire tab bar (pass service layers so slot switching works)
    wireTabBar(container, serviceLayers);

    // Mount live Leaflet maps
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
  function wireTabBar(container, layers) {
    var tabs  = container.querySelectorAll('#branch-tab-bar .tab');
    var panes = container.querySelectorAll('.tabpane[data-pane-idx]');

    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        var idx = parseInt(tab.getAttribute('data-tab-idx'), 10);

        tabs.forEach(function (t) { t.classList.remove('on'); });
        panes.forEach(function (p) { p.classList.remove('on'); });

        tab.classList.add('on');
        var target = container.querySelector('.tabpane[data-pane-idx="' + idx + '"]');
        if (target) target.classList.add('on');

        // Move the shared iframe to the new slot and lazy-load its geometry.
        // Tab 0 = Summary (shows all layers); others = single-layer (others hidden).
        _switchToTab(idx);
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
})();
