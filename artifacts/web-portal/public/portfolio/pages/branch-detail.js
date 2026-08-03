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

  // ── Map placeholder panel ──────────────────────────────────────────────────
  function renderMapPlaceholder(title, panelClass, assetCount) {
    var note = (assetCount === 0)
      ? 'No geometry mapped for this layer yet'
      : assetCount + ' asset' + (assetCount === 1 ? '' : 's') + ' mapped · map integration coming in a later slice';
    return '<div class="panel ' + esc(panelClass || '') + '">'
      + '<div class="panel-head"><h2>' + esc(title) + '</h2>'
      + '<span class="view-all" style="cursor:default;color:var(--gray-400);">Open full map →</span>'
      + '</div>'
      + '<div class="map-placeholder">'
        + '<div class="mp-note">' + esc(note) + '</div>'
      + '</div>'
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

    var mapHtml = renderMapPlaceholder('Property Map', 'p-blue', totalAssets);

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

    // Map placeholder
    var mapHtml = renderMapPlaceholder(layer.name + ' Map', accent.panel, layer.assetCount || 0);

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

    var selectorHtml = renderSelectorBlock(branchId, allBranches);
    var titleHtml    = renderTitleRow(branch, groupLookup);
    var tabBarHtml   = renderTabBar(layers, 0 /* start on Summary */);

    // Build all tab pane HTML (hidden except index 0)
    var summaryPane = '<div class="tabpane on" data-pane-idx="0">'
      + renderSummaryTab(data)
      + '</div>';

    var layerPanes = layers.map(function (layer, i) {
      return '<div class="tabpane" data-pane-idx="' + (i + 1) + '">'
        + renderLayerContent(layer, data)
        + '</div>';
    }).join('');

    container.innerHTML = selectorHtml + titleHtml + tabBarHtml + summaryPane + layerPanes;

    // Wire selector block
    wireSelectorBlock(container, branchId, allBranches);

    // Wire tab bar
    wireTabBar(container);
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

    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        var idx = parseInt(tab.getAttribute('data-tab-idx'), 10);

        tabs.forEach(function (t) { t.classList.remove('on'); });
        panes.forEach(function (p) { p.classList.remove('on'); });

        tab.classList.add('on');
        var target = container.querySelector('.tabpane[data-pane-idx="' + idx + '"]');
        if (target) target.classList.add('on');
      });
    });
  }

  // ── Main render ────────────────────────────────────────────────────────────
  function renderBranchDetail(container, params) {
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
