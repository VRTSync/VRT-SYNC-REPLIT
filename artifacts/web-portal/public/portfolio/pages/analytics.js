/**
 * analytics.js — Portfolio Analytics page.
 * Registered as PortfolioRouter.register('analytics', renderAnalytics).
 *
 * Data: single GET /api/portfolio/analytics fetch, cached for the page lifetime.
 *
 * Layer focus control:
 *   Buttons above the chip filter let users narrow Tier 1 cards and Tier 2 columns
 *   to a single asset layer (Landscape | Irrigation | Snow | Trees). "All" shows
 *   everything. The selection is driven by the layerKey field on each assetType
 *   returned from the API.
 *
 * Group filter semantics:
 *   - No group sets configured → all locations shown (no filter).
 *   - AND across sets; OR within each set.
 *   - Each set has an "Unassigned" chip for locations with no group in that set.
 *   - Zero chips selected in a set → empty state.
 *
 * Chip selection is persisted to localStorage keyed by orgId.
 *
 * assetTypes from the API: Array<{ key, label, sortOrder, layerKey }>, sorted by
 * catalogue sort_order.
 */
(function () {
  'use strict';

  var esc  = (window.VRTUtils && window.VRTUtils.esc)            || function (v) { return v == null ? '' : String(v); };
  var fmtC = (window.VRTUtils && window.VRTUtils.formatCurrency) || function (v) { return '$' + Number(v).toLocaleString(); };

  var _UNASSIGNED_ID = '__unassigned__';

  // ── Org helpers ────────────────────────────────────────────────────────────
  function orgParam() {
    var state = window.PortfolioState;
    if (state && state.organizationId) return '?organizationId=' + encodeURIComponent(state.organizationId);
    return '';
  }
  function orgKey() {
    var state = window.PortfolioState;
    return (state && state.organizationId) ? String(state.organizationId) : '_default';
  }
  function apiFetch(path) {
    return fetch(path, { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  // ── Module state ──────────────────────────────────────────────────────────
  var _payload    = null;
  var _chipState  = {};   // setId → Set of selected groupIds (includes _UNASSIGNED_ID)
  var _layerFocus = null; // null = all; string = layerKey to narrow
  var _sortCol    = 'name';
  var _sortDir    = 'asc';

  function _teardown() {
    _payload    = null;
    _chipState  = {};
    _layerFocus = null;
    _sortCol    = 'name';
    _sortDir    = 'asc';
  }

  // ── localStorage persistence ───────────────────────────────────────────────
  var _LS_KEY_PREFIX = 'pa_chips_v2_';

  function _saveChips() {
    try {
      var plain = {};
      Object.keys(_chipState).forEach(function (sid) {
        plain[sid] = Array.from(_chipState[sid]);
      });
      localStorage.setItem(_LS_KEY_PREFIX + orgKey(), JSON.stringify(plain));
    } catch (_) {}
  }

  function _loadChips(groupSets) {
    try {
      var raw = localStorage.getItem(_LS_KEY_PREFIX + orgKey());
      if (!raw) return null;
      var plain = JSON.parse(raw);
      var restored = {};
      groupSets.forEach(function (gs) {
        var sid = gs.id || '__ungrouped__';
        var ids = plain[sid];
        if (Array.isArray(ids)) restored[sid] = new Set(ids);
      });
      return Object.keys(restored).length > 0 ? restored : null;
    } catch (_) { return null; }
  }

  function _initChipState(groupSets) {
    var state = {};
    groupSets.forEach(function (gs) {
      var sid = gs.id || '__ungrouped__';
      state[sid] = new Set();
      (gs.groups || []).forEach(function (g) { state[sid].add(g.id); });
      state[sid].add(_UNASSIGNED_ID);
    });
    return state;
  }

  // ── Colour helpers ─────────────────────────────────────────────────────────
  function resolveGroupColor(group, idx) {
    if (window.VRTGroupColors) return window.VRTGroupColors.resolveGroupColor(group, idx);
    var p = ['#3b82f6','#f59e0b','#25C1AC','#10b981','#ef4444','#8b5cf6','#06b6d4'];
    return (group && group.color) ? group.color : p[idx % p.length];
  }
  function hexToRgba(hex, alpha) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return 'rgba(148,163,184,' + alpha + ')';
    var n = parseInt(m[1], 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
  }

  // ── Group lookup: groupId → { name, color, idx } ──────────────────────────
  function buildGroupLookup(groupSets) {
    var map = {};
    groupSets.forEach(function (gs) {
      (gs.groups || []).forEach(function (g, idx) {
        map[g.id] = { name: g.name, color: g.color, idx: idx };
      });
    });
    return map;
  }

  function buildSetGroupIds(groupSets) {
    var result = {};
    groupSets.forEach(function (gs) {
      var sid = gs.id || '__ungrouped__';
      var m = new Set();
      (gs.groups || []).forEach(function (g) { m.add(g.id); });
      result[sid] = m;
    });
    return result;
  }

  // ── Layer focus ────────────────────────────────────────────────────────────
  // Build the ordered list of distinct layers present in the current assetTypes.
  function buildLayerList(assetTypes) {
    // Preserve the order layers first appear in the sorted assetTypes array.
    var seen = [];
    var seenSet = new Set();
    assetTypes.forEach(function (at) {
      if (at.layerKey && !seenSet.has(at.layerKey)) {
        seen.push(at.layerKey);
        seenSet.add(at.layerKey);
      }
    });
    return seen;
  }

  // Human-readable label for a layerKey.
  var LAYER_LABELS = {
    community:  'Landscape',
    irrigation: 'Irrigation',
    snow:       'Snow',
    trees:      'Trees',
  };
  function layerLabel(key) { return LAYER_LABELS[key] || key; }

  function renderLayerFocus(container, assetTypes, onChange) {
    var layers = buildLayerList(assetTypes);
    if (layers.length < 2) { container.innerHTML = ''; return; } // no toggle needed

    var buttons = ['<button class="pa-layer-btn' + (_layerFocus === null ? ' pa-layer-btn--on' : '') + '" data-layer="">All</button>'];
    layers.forEach(function (lk) {
      var on = _layerFocus === lk;
      buttons.push('<button class="pa-layer-btn' + (on ? ' pa-layer-btn--on' : '') + '" data-layer="' + esc(lk) + '">' + esc(layerLabel(lk)) + '</button>');
    });

    container.innerHTML = '<div class="pa-layer-row">' + buttons.join('') + '</div>';
    container.querySelectorAll('.pa-layer-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var lk = btn.getAttribute('data-layer');
        _layerFocus = lk || null;
        onChange();
      });
    });
  }

  // Apply layer focus filter to assetTypes.
  function applyLayerFocus(assetTypes) {
    if (_layerFocus === null) return assetTypes;
    return assetTypes.filter(function (at) { return at.layerKey === _layerFocus; });
  }

  // ── Group filtering ────────────────────────────────────────────────────────
  function getFilteredLocations(locations, groupSets) {
    if (!groupSets || groupSets.length === 0) return locations;

    var setGroupIds = buildSetGroupIds(groupSets);

    return locations.filter(function (loc) {
      return groupSets.every(function (gs) {
        var sid = gs.id || '__ungrouped__';
        var sel = _chipState[sid];
        if (!sel || sel.size === 0) return false;

        var setIds = setGroupIds[sid];
        var locGroupsInSet = loc.groupIds.filter(function (gid) { return setIds && setIds.has(gid); });

        if (locGroupsInSet.some(function (gid) { return sel.has(gid); })) return true;
        return locGroupsInSet.length === 0 && sel.has(_UNASSIGNED_ID);
      });
    });
  }

  // ── Chip filter render ─────────────────────────────────────────────────────
  function renderChips(container, groupSets, onChipChange) {
    if (!groupSets || groupSets.length === 0) {
      container.innerHTML = '<div class="pa-chip-none">All locations shown — no group sets configured.</div>';
      return;
    }

    var html = groupSets.map(function (gs) {
      var sid    = gs.id || '__ungrouped__';
      var sel    = _chipState[sid] || new Set();
      var groups = gs.groups || [];
      var allIds = groups.map(function (g) { return g.id; }).concat([_UNASSIGNED_ID]);
      var allOn  = allIds.every(function (id) { return sel.has(id); });

      var chips = groups.map(function (g, idx) {
        var color  = resolveGroupColor(g, idx);
        var active = sel.has(g.id);
        var bg     = active ? hexToRgba(color, 0.16) : 'transparent';
        var bdr    = active ? color : 'var(--gray-200)';
        var clr    = active ? color : 'var(--gray-500)';
        return '<button class="pa-chip' + (active ? ' pa-chip--on' : '') + '"'
          + ' data-set="' + esc(sid) + '" data-gid="' + esc(g.id) + '"'
          + ' style="background:' + bg + ';border-color:' + bdr + ';color:' + clr + ';">'
          + esc(g.name) + '</button>';
      }).join('');

      var uActive = sel.has(_UNASSIGNED_ID);
      var uBdr = uActive ? 'var(--gray-400)' : 'var(--gray-200)';
      var uClr = uActive ? 'var(--gray-600)' : 'var(--gray-400)';
      var uBg  = uActive ? 'rgba(148,163,184,0.14)' : 'transparent';
      chips += '<button class="pa-chip' + (uActive ? ' pa-chip--on' : '') + ' pa-chip--unassigned"'
        + ' data-set="' + esc(sid) + '" data-gid="' + esc(_UNASSIGNED_ID) + '"'
        + ' style="background:' + uBg + ';border-color:' + uBdr + ';color:' + uClr + ';font-style:italic;">'
        + 'Unassigned</button>';

      return '<div class="pa-chip-row">'
        + '<span class="pa-chip-set-label">' + esc(gs.name) + '</span>'
        + '<button class="pa-chip-all" data-set="' + esc(sid) + '" data-all="' + (allOn ? 'on' : 'off') + '">'
          + (allOn ? 'None' : 'All') + '</button>'
        + chips
        + '</div>';
    }).join('');

    container.innerHTML = html;

    container.querySelectorAll('.pa-chip').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var sid = btn.getAttribute('data-set');
        var gid = btn.getAttribute('data-gid');
        if (!_chipState[sid]) _chipState[sid] = new Set();
        if (_chipState[sid].has(gid)) _chipState[sid].delete(gid);
        else _chipState[sid].add(gid);
        _saveChips();
        if (onChipChange) onChipChange();
      });
    });

    container.querySelectorAll('.pa-chip-all').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var sid   = btn.getAttribute('data-set');
        var allOn = btn.getAttribute('data-all') === 'on';
        var gs    = groupSets.find(function (s) { return (s.id || '__ungrouped__') === sid; });
        if (!gs) return;
        if (!_chipState[sid]) _chipState[sid] = new Set();
        if (allOn) {
          _chipState[sid].clear();
        } else {
          (gs.groups || []).forEach(function (g) { _chipState[sid].add(g.id); });
          _chipState[sid].add(_UNASSIGNED_ID);
        }
        _saveChips();
        if (onChipChange) onChipChange();
      });
    });
  }

  // ── Tier 1: summary cards ─────────────────────────────────────────────────
  function renderTier1(container, locations, visibleTypes) {
    if (locations.length === 0) {
      container.innerHTML = '<div class="pf-empty pa-empty-state">'
        + 'No locations match the selected filters.</div>';
      return;
    }

    var totalServicesYtd = 0;
    var totalSpendCents  = 0;
    locations.forEach(function (loc) {
      totalServicesYtd += loc.servicesYtd || 0;
      totalSpendCents  += loc.spendYtdCents || 0;
    });

    var totalAssets = 0;
    locations.forEach(function (loc) {
      Object.values(loc.assets).forEach(function (b) { totalAssets += b.count; });
    });

    // ── Group asset types by layer, preserving sort order ─────────────────
    var layerBands = [];      // [{layerKey, layerName, layerColor, types:[]}]
    var layerKeyIndex = {};   // layerKey → index in layerBands

    visibleTypes.forEach(function (at) {
      var lk = at.layerKey || '__other__';
      if (layerKeyIndex[lk] === undefined) {
        layerKeyIndex[lk] = layerBands.length;
        layerBands.push({
          layerKey:   lk,
          layerName:  at.layerName  || null,
          layerColor: at.layerColor || null,
          types: [],
        });
      }
      layerBands[layerKeyIndex[lk]].types.push(at);
    });

    // ── Build per-band HTML ────────────────────────────────────────────────
    var typeSectionHtml = layerBands.map(function (band) {
      var cardsHtml = band.types.map(function (at) {
        var totalCount   = 0;
        var totalSqFt    = 0;
        var coveredCount = 0;
        var totalPoly    = 0;

        locations.forEach(function (loc) {
          var b = loc.assets[at.key];
          if (!b) return;
          totalCount   += b.count;
          totalSqFt    += b.sqFtTotal;
          coveredCount += b.sqFtCovered;
          totalPoly    += b.sqFtCount;
        });

        if (totalCount === 0) return '';

        // Inline style from API-supplied layer colour — no hex hardcoded here
        var styleAttr = '';
        if (at.layerColor) {
          var hex = at.layerColor.replace('#', '');
          var r   = parseInt(hex.substring(0, 2), 16);
          var g   = parseInt(hex.substring(2, 4), 16);
          var bl  = parseInt(hex.substring(4, 6), 16);
          styleAttr = ' style="border-bottom-color:' + at.layerColor
            + ';background:linear-gradient(160deg,rgba(' + r + ',' + g + ',' + bl + ',0.08),#fff 62%)"';
        }

        var hasSqFt = totalSqFt > 0;
        var cardHtml;
        if (hasSqFt) {
          // Area-first layout: ft² headline, count/coverage sub-line
          var isPartial = totalPoly > 0 && coveredCount < totalPoly;
          var subLine = isPartial
            ? '<span class="pa-card-coverage">' + coveredCount + ' of ' + totalPoly + ' areas measured</span>'
            : totalCount.toLocaleString() + ' area' + (totalCount !== 1 ? 's' : '');
          cardHtml = '<div class="pa-card"' + styleAttr + '>'
            + '<div class="pa-card-label">' + esc(at.label) + '</div>'
            + '<div class="pa-card-value">' + _fmtSqFtFull(totalSqFt) + ' ft²</div>'
            + '<div class="pa-card-sqft">' + subLine + '</div>'
            + '</div>';
        } else {
          // Point type: count headline, no area line
          cardHtml = '<div class="pa-card"' + styleAttr + '>'
            + '<div class="pa-card-label">' + esc(at.label) + '</div>'
            + '<div class="pa-card-value">' + totalCount.toLocaleString() + '</div>'
            + '</div>';
        }
        return cardHtml;
      }).join('');

      if (!cardsHtml) return '';

      var labelHtml = band.layerName
        ? '<div class="pa-layer-band-label">' + esc(band.layerName) + '</div>'
        : '';
      return '<div class="pa-layer-band">'
        + labelHtml
        + '<div class="pa-layer-cards">' + cardsHtml + '</div>'
        + '</div>';
    }).join('');

    // ── Assemble final HTML ────────────────────────────────────────────────
    container.innerHTML = '<div class="pa-summary-row">'
      + '<div class="pa-card pa-card--teal">'
        + '<div class="pa-card-label">Locations</div>'
        + '<div class="pa-card-value">' + locations.length + '</div>'
      + '</div>'
      + '<div class="pa-card pa-card--navy">'
        + '<div class="pa-card-label">Total Assets</div>'
        + '<div class="pa-card-value">' + totalAssets.toLocaleString() + '</div>'
      + '</div>'
      + (totalServicesYtd > 0
          ? '<div class="pa-card pa-card--blue">'
              + '<div class="pa-card-label">Services YTD</div>'
              + '<div class="pa-card-value">' + totalServicesYtd.toLocaleString() + '</div>'
            + '</div>' : '')
      + (totalSpendCents > 0
          ? '<div class="pa-card pa-card--amber">'
              + '<div class="pa-card-label">Spend YTD</div>'
              + '<div class="pa-card-value">' + fmtC(Math.round(totalSpendCents / 100)) + '</div>'
            + '</div>' : '')
      + '</div>'
      + '<div class="pa-type-section">' + typeSectionHtml + '</div>';
  }

  // ── Tier 2: location table ─────────────────────────────────────────────────
  function renderTier2(container, locations, visibleTypes, groupSets, onSort) {
    if (locations.length === 0) { container.innerHTML = ''; return; }

    var groupLookup = buildGroupLookup(groupSets);

    // Active types = visibleTypes with non-zero count in the filtered set
    var activeTypes = visibleTypes.filter(function (at) {
      return locations.some(function (loc) { return loc.assets[at.key] && loc.assets[at.key].count > 0; });
    });

    var cols = _buildColDefs(activeTypes);

    var sortColDef = cols.find(function (c) { return c.key === _sortCol; }) || cols[1];
    var sorted = locations.slice().sort(function (a, b) {
      var av = _locValue(a, sortColDef);
      var bv = _locValue(b, sortColDef);
      if (av < bv) return _sortDir === 'asc' ? -1 : 1;
      if (av > bv) return _sortDir === 'asc' ?  1 : -1;
      return 0;
    });

    var totals = {};
    cols.forEach(function (col) {
      if (col.num) {
        var s = 0;
        sorted.forEach(function (loc) { s += Number(_locValue(loc, col)); });
        totals[col.key] = s;
      }
    });

    var thead = '<thead><tr>'
      + cols.map(function (col) {
          var isActive = _sortCol === col.key;
          var arrow    = isActive ? (_sortDir === 'asc' ? ' ▲' : ' ▼') : '';
          return '<th class="' + (col.num ? 'num ' : '') + 'pa-th-sortable" data-col="' + esc(col.key) + '">'
            + esc(col.label)
            + '<span class="pa-sort-ind">' + arrow + '</span>'
            + '</th>';
        }).join('')
      + '</tr></thead>';

    var tbody = '<tbody>'
      + sorted.map(function (loc) {
          return '<tr>'
            + cols.map(function (col) {
                if (col.key === 'groups') {
                  var chips = loc.groupIds.map(function (gid) {
                    var g = groupLookup[gid];
                    if (!g) return '';
                    var color = resolveGroupColor(g, g.idx);
                    return '<span class="pa-tbl-chip" style="background:' + hexToRgba(color, 0.14)
                      + ';color:' + color + ';">' + esc(g.name) + '</span>';
                  }).join('');
                  return '<td>' + (chips || '<span style="color:var(--gray-300);font-style:italic;">—</span>') + '</td>';
                }
                var v = _locValue(loc, col);
                var display;
                if (col.isMoney)    display = v > 0 ? fmtC(Math.round(v / 100)) : '—';
                else if (col.isSqFt) display = v > 0 ? _fmtSqFt(v) : '—';
                else if (col.num)   display = v > 0 ? Number(v).toLocaleString() : '—';
                else               display = esc(v) || '—';
                return '<td class="' + (col.num ? 'num' : '') + '">' + display + '</td>';
              }).join('')
            + '</tr>';
        }).join('')
      + '</tbody>';

    var tfoot = '<tfoot><tr class="totals-row">'
      + cols.map(function (col) {
          if (col.key === 'groups') return '<td></td>';
          var v = totals[col.key];
          var display;
          if (v == null)          display = '';
          else if (col.isMoney)   display = v > 0 ? fmtC(Math.round(v / 100)) : '—';
          else if (col.isSqFt)    display = v > 0 ? _fmtSqFt(v) : '—';
          else if (col.key === 'name') display = sorted.length + ' location' + (sorted.length === 1 ? '' : 's');
          else if (col.key === 'code') display = 'Total';
          else                   display = v > 0 ? Number(v).toLocaleString() : '—';
          return '<td class="' + (col.num ? 'num' : '') + '">' + display + '</td>';
        }).join('')
      + '</tr></tfoot>';

    container.innerHTML = '<div class="pa-table-wrap panel">'
      + '<div class="panel-head"><h2>Locations</h2>'
        + '<button class="pa-csv-btn" id="pa-csv-btn">Export CSV</button>'
      + '</div>'
      + '<div class="pa-table-scroll"><table>' + thead + tbody + tfoot + '</table></div>'
      + '</div>';

    container.querySelectorAll('.pa-th-sortable').forEach(function (th) {
      th.style.cursor = 'pointer';
      th.addEventListener('click', function () {
        var c = th.getAttribute('data-col');
        if (_sortCol === c) _sortDir = _sortDir === 'asc' ? 'desc' : 'asc';
        else { _sortCol = c; _sortDir = 'asc'; }
        if (onSort) onSort();
      });
    });

    var csvBtn = container.querySelector('#pa-csv-btn');
    if (csvBtn) csvBtn.addEventListener('click', function () { _exportCsv(sorted, cols); });
  }

  function _buildColDefs(activeTypes) {
    var cols = [
      { key: 'code',  label: 'Code',     num: false },
      { key: 'name',  label: 'Location', num: false },
      { key: 'groups',label: 'Groups',   num: false },
    ];
    activeTypes.forEach(function (at) {
      cols.push({ key: 'at_' + at.key, label: at.label,          num: true, assetType: at.key });
      cols.push({ key: 'sq_' + at.key, label: at.label + ' ft²', num: true, assetType: at.key, isSqFt: true });
    });
    cols.push({ key: 'servicesYtd',    label: 'Services YTD', num: true });
    cols.push({ key: 'spendYtdCents',  label: 'Spend YTD',    num: true, isMoney: true });
    return cols;
  }

  function _locValue(loc, col) {
    if (!col) return '';
    if (col.key === 'code')          return loc.code || '';
    if (col.key === 'name')          return loc.name || '';
    if (col.key === 'groups')        return '';
    if (col.key === 'servicesYtd')   return loc.servicesYtd || 0;
    if (col.key === 'spendYtdCents') return loc.spendYtdCents || 0;
    if (col.assetType) {
      var b = loc.assets[col.assetType];
      if (!b) return 0;
      return col.isSqFt ? b.sqFtTotal : b.count;
    }
    return '';
  }

  // ── Tier 3: spend efficiency ───────────────────────────────────────────────
  function renderTier3(container, locations) {
    var hasSpend = locations.some(function (l) { return l.spendYtdCents > 0; });
    if (!hasSpend || locations.length === 0) { container.innerHTML = ''; return; }

    var TOP_N = 5;

    // ── Card 1: Cost per irrigation zone ─────────────────────────────────────
    var cpzHtml = '';
    var locWithZones = locations.filter(function (l) {
      return l.spendYtdCents > 0 && l.assets['zone'] && l.assets['zone'].count > 0;
    });
    if (locWithZones.length > 0) {
      var cpzValues = locWithZones.map(function (l) {
        return { name: l.name, code: l.code, cpz: l.spendYtdCents / l.assets['zone'].count };
      }).sort(function (a, b) { return b.cpz - a.cpz; });

      var sortedForMedian = cpzValues.slice().sort(function (a, b) { return a.cpz - b.cpz; });
      var mid = Math.floor(sortedForMedian.length / 2);
      var median = sortedForMedian.length % 2 === 0
        ? (sortedForMedian[mid - 1].cpz + sortedForMedian[mid].cpz) / 2
        : sortedForMedian[mid].cpz;
      var threshold = median * 2;

      var top5cpz  = cpzValues.slice(0, TOP_N);
      var maxCpz   = top5cpz[0].cpz;
      var medPct   = maxCpz > 0 ? Math.round((median / maxCpz) * 100) : 0;

      // Selection total: total spend / total zones across ALL filtered locations
      var selSpend = locWithZones.reduce(function (s, l) { return s + l.spendYtdCents; }, 0);
      var selZones = locWithZones.reduce(function (s, l) { return s + l.assets['zone'].count; }, 0);
      var selNote  = 'median ' + fmtC(Math.round(median / 100))
        + ' · selection ' + fmtC(Math.round(selSpend / 100)) + ' / ' + selZones + ' zones';

      cpzHtml = '<div class="pa-eff-card panel">'
        + '<div class="panel-head"><h2>Cost per Zone</h2>'
          + '<span class="hint">' + esc(selNote) + '</span>'
        + '</div>'
        + '<div class="pa-eff-bars">'
        + top5cpz.map(function (v) {
            var pct  = maxCpz > 0 ? Math.round((v.cpz / maxCpz) * 100) : 0;
            var flag = v.cpz > threshold;
            var lbl  = v.code || v.name.slice(0, 16);
            return '<div class="pa-eff-row">'
              + '<span class="pa-eff-name" title="' + esc(v.name) + '">' + esc(lbl) + '</span>'
              + '<div class="pa-eff-bar-wrap">'
                + '<div class="pa-eff-bar' + (flag ? ' pa-eff-bar--flag' : '') + '" style="width:' + pct + '%"></div>'
                + '<div class="pa-eff-median-line" style="left:' + medPct + '%"></div>'
              + '</div>'
              + '<span class="pa-eff-val' + (flag ? ' pa-eff-val--flag' : '') + '">' + fmtC(Math.round(v.cpz / 100)) + '</span>'
              + '</div>';
          }).join('')
        + (cpzValues.length > TOP_N ? '<div class="pa-eff-more">+ ' + (cpzValues.length - TOP_N) + ' more locations</div>' : '')
        + '</div></div>';
    }

    // ── Card 2: Spend per 1,000 ft² turf (with native-grass composition) ─────
    var spfHtml = '';
    var TURF_TYPES = ['bluegrass_area', 'native_area'];
    var locWithTurf = locations.filter(function (l) {
      var sq = 0;
      TURF_TYPES.forEach(function (t) { if (l.assets[t]) sq += l.assets[t].sqFtTotal; });
      return l.spendYtdCents > 0 && sq > 0;
    });

    // If no turf types, fall back to any area type.
    if (locWithTurf.length === 0) {
      locWithTurf = locations.filter(function (l) {
        var sq = 0;
        Object.values(l.assets).forEach(function (b) { sq += b.sqFtTotal; });
        return l.spendYtdCents > 0 && sq > 0;
      });
    }

    if (locWithTurf.length > 0) {
      // Check if native vs bluegrass split is meaningful.
      var totalNative = 0; var totalBluegrass = 0;
      locWithTurf.forEach(function (l) {
        if (l.assets['native_area'])    totalNative    += l.assets['native_area'].sqFtTotal;
        if (l.assets['bluegrass_area']) totalBluegrass += l.assets['bluegrass_area'].sqFtTotal;
      });
      var totalTurf = totalNative + totalBluegrass;
      var compositionNote = '';
      if (totalTurf > 0 && totalNative > 0 && totalBluegrass > 0) {
        var nativePct     = Math.round((totalNative / totalTurf) * 100);
        var bluegrassPct  = 100 - nativePct;
        compositionNote   = ' · ' + nativePct + '% native / ' + bluegrassPct + '% bluegrass';
      }

      var spfValues = locWithTurf.map(function (l) {
        var sq = 0;
        TURF_TYPES.forEach(function (t) { if (l.assets[t]) sq += l.assets[t].sqFtTotal; });
        if (sq === 0) Object.values(l.assets).forEach(function (b) { sq += b.sqFtTotal; });
        return { name: l.name, code: l.code, spf: (l.spendYtdCents / sq) * 1000 };
      }).sort(function (a, b) { return b.spf - a.spf; });

      var sortedSpf = spfValues.slice().sort(function (a, b) { return a.spf - b.spf; });
      var midSpf    = Math.floor(sortedSpf.length / 2);
      var medianSpf = sortedSpf.length % 2 === 0
        ? (sortedSpf[midSpf - 1].spf + sortedSpf[midSpf].spf) / 2
        : sortedSpf[midSpf].spf;

      var top5spf   = spfValues.slice(0, TOP_N);
      var maxSpf    = top5spf[0].spf;
      var medSpfPct = maxSpf > 0 ? Math.round((medianSpf / maxSpf) * 100) : 0;

      spfHtml = '<div class="pa-eff-card panel">'
        + '<div class="panel-head"><h2>Spend / 1,000 ft² Turf</h2>'
          + '<span class="hint">median ' + fmtC(Math.round(medianSpf / 100)) + compositionNote + '</span>'
        + '</div>'
        + '<div class="pa-eff-bars">'
        + top5spf.map(function (v) {
            var pct = maxSpf > 0 ? Math.round((v.spf / maxSpf) * 100) : 0;
            var lbl = v.code || v.name.slice(0, 16);
            return '<div class="pa-eff-row">'
              + '<span class="pa-eff-name" title="' + esc(v.name) + '">' + esc(lbl) + '</span>'
              + '<div class="pa-eff-bar-wrap">'
                + '<div class="pa-eff-bar" style="width:' + pct + '%"></div>'
                + '<div class="pa-eff-median-line" style="left:' + medSpfPct + '%"></div>'
              + '</div>'
              + '<span class="pa-eff-val">' + fmtC(Math.round(v.spf / 100)) + '</span>'
              + '</div>';
          }).join('')
        + (spfValues.length > TOP_N ? '<div class="pa-eff-more">+ ' + (spfValues.length - TOP_N) + ' more locations</div>' : '')
        + '</div></div>';
    }

    // ── Card 3: Services Logged (top 5, with per-location avg + spend-per-svc) ─
    var svcHtml = '';
    var locWithSvc = locations.filter(function (l) { return l.servicesYtd > 0; });
    if (locWithSvc.length > 0) {
      var svcValues   = locWithSvc.slice().sort(function (a, b) { return b.servicesYtd - a.servicesYtd; });
      var maxSvc      = svcValues[0].servicesYtd;
      var totalSvc    = locWithSvc.reduce(function (s, l) { return s + l.servicesYtd; }, 0);
      var totalSpend  = locWithSvc.reduce(function (s, l) { return s + l.spendYtdCents; }, 0);
      var avgPerLoc   = (totalSvc / locWithSvc.length).toFixed(1);
      var avgPerSvc   = totalSvc > 0 ? fmtC(Math.round(totalSpend / totalSvc / 100)) : null;

      var hint = 'YTD · avg ' + avgPerLoc + '/location'
        + (avgPerSvc ? ' · ' + avgPerSvc + '/service' : '');

      svcHtml = '<div class="pa-eff-card panel">'
        + '<div class="panel-head"><h2>Services Logged</h2>'
          + '<span class="hint">' + esc(hint) + '</span>'
        + '</div>'
        + '<div class="pa-eff-bars">'
        + svcValues.slice(0, TOP_N).map(function (l) {
            var pct = maxSvc > 0 ? Math.round((l.servicesYtd / maxSvc) * 100) : 0;
            var lbl = l.code || l.name.slice(0, 16);
            return '<div class="pa-eff-row">'
              + '<span class="pa-eff-name" title="' + esc(l.name) + '">' + esc(lbl) + '</span>'
              + '<div class="pa-eff-bar-wrap"><div class="pa-eff-bar pa-eff-bar--blue" style="width:' + pct + '%"></div></div>'
              + '<span class="pa-eff-val">' + l.servicesYtd + '</span>'
              + '</div>';
          }).join('')
        + (svcValues.length > TOP_N ? '<div class="pa-eff-more">+ ' + (svcValues.length - TOP_N) + ' more locations</div>' : '')
        + '</div></div>';
    }

    container.innerHTML = '<div class="pa-tier3">' + cpzHtml + spfHtml + svcHtml + '</div>';
  }

  // ── Main render ────────────────────────────────────────────────────────────
  function renderAnalytics(container, _params) {
    _teardown();
    container.innerHTML = '<div class="pf-spinner">Loading analytics\u2026</div>';

    function doRender(data) {
      var groupSets  = data.groupSets  || [];
      var locations  = data.locations  || [];
      var assetTypes = data.assetTypes || []; // Array<{ key, label, sortOrder, layerKey }>

      var restored = _loadChips(groupSets);
      _chipState = restored || _initChipState(groupSets);

      container.innerHTML = ''
        + '<div class="pa-page">'
          + '<div class="ctx">'
            + '<h1>Analytics</h1>'
            + '<span class="sub">cross-location insights</span>'
          + '</div>'
          + '<div class="pa-layer-focus" id="pa-layer-focus"></div>'
          + '<div class="pa-chips" id="pa-chips"></div>'
          + '<div class="pa-tier1" id="pa-tier1"></div>'
          + '<div class="pa-tier2" id="pa-tier2"></div>'
          + '<div id="pa-tier3"></div>'
        + '</div>';

      var layerEl = document.getElementById('pa-layer-focus');
      var chipsEl = document.getElementById('pa-chips');
      var tier1El = document.getElementById('pa-tier1');
      var tier2El = document.getElementById('pa-tier2');
      var tier3El = document.getElementById('pa-tier3');

      function refresh() {
        var filtered    = getFilteredLocations(locations, groupSets);
        // All types with data in the filtered set, then apply layer focus.
        var typesWithData = assetTypes.filter(function (at) {
          return filtered.some(function (loc) { return loc.assets[at.key] && loc.assets[at.key].count > 0; });
        });
        var visibleTypes  = applyLayerFocus(typesWithData);

        renderLayerFocus(layerEl, typesWithData, function () { refresh(); });
        renderChips(chipsEl, groupSets, function () { refresh(); });
        renderTier1(tier1El, filtered, visibleTypes);
        renderTier2(tier2El, filtered, visibleTypes, groupSets, function () { refresh(); });
        renderTier3(tier3El, filtered);
      }

      refresh();
    }

    if (_payload) { doRender(_payload); return; }

    apiFetch('/api/portfolio/analytics' + orgParam()).then(function (data) {
      _payload = data;
      doRender(data);
    }).catch(function (err) {
      console.error('[portfolio/analytics] fetch failed:', err);
      container.innerHTML = '<div class="pf-empty">Failed to load analytics. Please refresh.</div>';
    });
  }

  // ── CSV export ─────────────────────────────────────────────────────────────
  function _exportCsv(sorted, cols) {
    var header = cols.filter(function (c) { return c.key !== 'groups'; })
      .map(function (c) { return '"' + c.label.replace(/"/g, '""') + '"'; }).join(',');
    var rows = sorted.map(function (loc) {
      return cols.filter(function (c) { return c.key !== 'groups'; }).map(function (col) {
        var v = _locValue(loc, col);
        if (col.isMoney) return v > 0 ? (v / 100).toFixed(2) : '0';
        if (col.isSqFt)  return v > 0 ? Math.round(v) : '0';
        if (typeof v === 'number') return String(v);
        return '"' + String(v).replace(/"/g, '""') + '"';
      }).join(',');
    });
    var csv  = [header].concat(rows).join('\n');
    var blob = new Blob([csv], { type: 'text/csv' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href = url; a.download = 'portfolio-analytics.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function _fmtSqFt(n) {
    if (n == null || isNaN(n)) return '—';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000)    return (n / 1000).toFixed(1)    + 'K';
    return Math.round(n).toLocaleString();
  }

  // Full number with thousands separators — used for area-card headlines
  function _fmtSqFtFull(n) {
    if (n == null || isNaN(n)) return '—';
    return Math.round(n).toLocaleString();
  }

  // ── Register ───────────────────────────────────────────────────────────────
  if (window.PortfolioRouter) {
    PortfolioRouter.register('analytics', renderAnalytics);
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      if (window.PortfolioRouter) PortfolioRouter.register('analytics', renderAnalytics);
    });
  }
})();
