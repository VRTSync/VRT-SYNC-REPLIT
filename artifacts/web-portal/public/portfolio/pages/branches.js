/**
 * branches.js — Branch Portfolio "Branches" list page.
 * Registered as PortfolioRouter.register('branches', fn).
 *
 * Fetches GET /api/portfolio/branches (+ organizationId when in admin preview).
 * Renders:
 *   • Anchor band — asset-type breakdown bar + legend
 *   • Filter chip row — All · per group · Has open items (client-side)
 *   • Table of branches sorted by code (API already orders them)
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

  // ── Date formatting ────────────────────────────────────────────────────────
  function fmtDate(isoStr) {
    if (!isoStr) return '—';
    try {
      var d = new Date(isoStr);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch (_) { return isoStr; }
  }

  // ── Group chip colours ────────────────────────────────────────────────────
  function buildGroupLookup(groups) {
    var map = {};
    var fallbackIndexes = window.VRTGroupColors
      ? window.VRTGroupColors.getStableFallbackIndexes(groups)
      : {};
    (groups || []).forEach(function (g, idx) {
      map[g.id] = {
        id: g.id,
        name: g.name,
        color: g.color,
        fallbackIndex: fallbackIndexes[g.id] != null ? fallbackIndexes[g.id] : idx,
      };
    });
    return map;
  }

  // ── Anchor band ────────────────────────────────────────────────────────────
  function renderAnchorBand(branches) {
    var totalAssets    = 0;
    var totalZones     = 0;
    var totalTrees     = 0;
    var totalSvcsYtd   = 0;

    branches.forEach(function (b) {
      totalAssets  += Number(b.assetCount   || 0);
      totalZones   += Number(b.irrigationZones || 0);
      totalTrees   += Number(b.trees        || 0);
      totalSvcsYtd += Number(b.servicesYtd  || 0);
    });

    var otherAssets = Math.max(0, totalAssets - totalZones - totalTrees);

    // Build breakdown bar segments (only when totals > 0)
    var barHtml = '';
    var legendHtml = '';
    if (totalAssets > 0) {
      var zonesPct  = Math.round((totalZones  / totalAssets) * 100);
      var treesPct  = Math.round((totalTrees  / totalAssets) * 100);
      var otherPct  = Math.max(0, 100 - zonesPct - treesPct);

      barHtml = (zonesPct  > 0 ? '<i style="width:' + zonesPct  + '%;background:var(--blue)"></i>'  : '')
              + (treesPct  > 0 ? '<i style="width:' + treesPct  + '%;background:var(--green)"></i>' : '')
              + (otherPct  > 0 ? '<i style="width:' + otherPct  + '%;background:#94a3b8"></i>'      : '');

      legendHtml = (totalZones > 0  ? '<span><i style="background:var(--blue)"></i>Irrigation ' + totalZones + '</span>'  : '')
                 + (totalTrees > 0  ? '<span><i style="background:var(--green)"></i>Trees ' + totalTrees + '</span>'      : '')
                 + (otherAssets > 0 ? '<span><i style="background:#94a3b8"></i>Other ' + otherAssets + '</span>'          : '');
    } else {
      barHtml    = '<i style="width:100%;background:var(--gray-200)"></i>';
      legendHtml = '<span style="color:var(--gray-400)">No assets mapped yet</span>';
    }

    var branchCount = branches.length;
    var subText = totalAssets > 0
      ? (totalAssets + ' assets documented')
      : 'No assets mapped yet';

    return '<div class="anchor">'
      + '<div class="a-title">'
        + '<div class="a-label">Portfolio Coverage</div>'
        + '<div class="a-main">' + esc(branchCount) + ' ' + (branchCount === 1 ? 'location' : 'locations') + '</div>'
        + '<div class="a-sub">' + esc(subText) + '</div>'
      + '</div>'
      + '<div class="a-mid">'
        + '<div class="a-bar">' + barHtml + '</div>'
        + '<div class="a-legend">' + legendHtml + '</div>'
      + '</div>'
      + '<div class="a-stats">'
        + '<div class="a-stat teal"><b>' + esc(branchCount) + '</b><span>locations</span></div>'
        + '<div class="a-stat blue"><b>' + esc(totalAssets) + '</b><span>assets</span></div>'
        + '<div class="a-stat"><b>' + esc(totalSvcsYtd) + '</b><span>services YTD</span></div>'
      + '</div>'
      + '</div>';
  }

  // ── Filter chip row ────────────────────────────────────────────────────────
  function renderFilterChips(branches, groupLookup, activeFilter) {
    // Gather unique groups present in this branch set — check ALL groupIds per branch
    var groupsSeen = {};
    var groupOrder = [];
    branches.forEach(function (b) {
      var ids = Array.isArray(b.groupIds) ? b.groupIds : [];
      ids.forEach(function (gid) {
        if (!groupsSeen[gid]) {
          var info = groupLookup[gid];
          if (info) {
            groupsSeen[gid] = true;
            groupOrder.push({ id: gid, name: info.name });
          }
        }
      });
    });

    var openCount = branches.filter(function (b) { return Number(b.openWorkOrders) > 0; }).length;

    var chips = '<span class="fchip' + (activeFilter === 'all' ? ' on' : '') + '" data-filter="all">All (' + esc(branches.length) + ')</span>';
    groupOrder.forEach(function (g) {
      var cnt = branches.filter(function (b) {
        return Array.isArray(b.groupIds) && b.groupIds.indexOf(g.id) !== -1;
      }).length;
      chips += '<span class="fchip' + (activeFilter === g.id ? ' on' : '') + '" data-filter="' + esc(g.id) + '">' + esc(g.name) + ' (' + cnt + ')</span>';
    });
    chips += '<span class="fchip' + (activeFilter === 'open' ? ' on' : '') + '" data-filter="open">Has open items (' + esc(openCount) + ')</span>';

    return '<div class="filter-bar" id="branches-filter-bar">' + chips + '</div>';
  }

  // ── Build groupId → setId map from PortfolioState.groups ──────────────────
  // PortfolioState.groups is the full BranchGroup list (includes .setId).
  // Returns: { [groupId]: setId | null }
  function buildGroupSetMap(stateGroups) {
    var map = {};
    (stateGroups || []).forEach(function (g) {
      map[g.id] = g.setId || null;
    });
    return map;
  }

  // ── Totals footer ──────────────────────────────────────────────────────────
  // groupSetMap: { [groupId]: setId | null } — used to count distinct group sets.
  function renderTotalsFooter(branches, groupSetMap) {
    var count = branches.length;
    if (count === 0) return '';
    var totalAssets  = 0;
    var totalZones   = 0;
    var totalTrees   = 0;
    var totalSvcs    = 0;
    var uniqueCities = {};
    var uniqueSetIds = {};   // distinct non-null setIds across all filtered branches
    branches.forEach(function (b) {
      totalAssets += Number(b.assetCount      || 0);
      totalZones  += Number(b.irrigationZones  || 0);
      totalTrees  += Number(b.trees            || 0);
      totalSvcs   += Number(b.servicesYtd      || 0);
      if (b.city) uniqueCities[b.city] = true;
      (Array.isArray(b.groupIds) ? b.groupIds : []).forEach(function (gid) {
        var sid = groupSetMap ? groupSetMap[gid] : null;
        if (sid) uniqueSetIds[sid] = true;
      });
    });
    var regionCount  = Object.keys(uniqueCities).length;
    var setCount     = Object.keys(uniqueSetIds).length;
    var regionText   = regionCount + ' ' + (regionCount === 1 ? 'region' : 'regions')
      + ' · ' + setCount + ' ' + (setCount === 1 ? 'group set' : 'group sets');
    return '<tfoot><tr class="totals-row">'
      + '<td class="bcode">' + esc(count) + '</td>'
      + '<td><div class="bname">Totals</div></td>'
      + '<td class="bsub">' + esc(regionText) + '</td>'
      + '<td class="bsub"></td>'
      + '<td></td>'
      + '<td class="num">' + esc(totalAssets) + '</td>'
      + '<td class="num">' + esc(totalZones) + '</td>'
      + '<td class="num">' + esc(totalTrees) + '</td>'
      + '<td class="num">' + esc(totalSvcs) + '</td>'
      + '<td class="bsub"></td>'
      + '<td class="num"></td>'
      + '</tr></tfoot>';
  }

  // ── Branch table ───────────────────────────────────────────────────────────
  function renderBranchTable(branches, groupLookup, groupSetMap) {
    var rows;
    if (branches.length === 0) {
      rows = '<tr class="pf-empty-row"><td colspan="11">No locations match this filter.</td></tr>';
    } else {
      rows = branches.map(function (b) {
        var code       = b.code    || '—';
        var name       = b.name    || '—';
        var address    = b.address || '';
        var city       = b.city    || '';
        var assets     = Number(b.assetCount      || 0);
        var zones      = Number(b.irrigationZones  || 0);
        var trees      = Number(b.trees            || 0);
        var svcsYtd    = Number(b.servicesYtd      || 0);
        var openWO     = Number(b.openWorkOrders   || 0);
        var lastAt     = b.lastServiceAt   || null;
        var lastLbl    = b.lastServiceLabel || '';

        var lastSvcText = lastAt ? (fmtDate(lastAt) + (lastLbl ? ' · ' + lastLbl : '')) : '—';

        var groupIds    = Array.isArray(b.groupIds) ? b.groupIds : [];
        var primaryGid  = groupIds.length > 0 ? groupIds[0] : null;
        var groupInfo   = primaryGid ? groupLookup[primaryGid] : null;
        var groupChip   = groupInfo
          ? (function () {
              var color = window.VRTGroupColors.resolveGroupColor(groupInfo, groupInfo.fallbackIndex);
              return '<span class="gchip" style="background:' + esc(window.VRTGroupColors.hexToRgba(color, 0.12))
                + ';color:' + esc(color) + ';">' + esc(groupInfo.name) + '</span>';
            })()
          : '<span style="color:var(--gray-400);font-size:12px;">—</span>';

        var openBadge = openWO > 0
          ? '<span class="open-wo-badge">' + openWO + '</span>'
          : '<span style="color:var(--gray-400)">0</span>';

        return '<tr class="clickable" data-branch-id="' + esc(b.id) + '">'
          + '<td class="bcode">' + esc(code) + '</td>'
          + '<td><div class="bname">' + esc(name) + '</div></td>'
          + '<td class="bsub">' + esc(address) + '</td>'
          + '<td class="bsub">' + esc(city) + '</td>'
          + '<td>' + groupChip + '</td>'
          + '<td class="num">' + esc(assets) + '</td>'
          + '<td class="num">' + esc(zones) + '</td>'
          + '<td class="num">' + esc(trees) + '</td>'
          + '<td class="num">' + esc(svcsYtd) + '</td>'
          + '<td class="bsub">' + esc(lastSvcText) + '</td>'
          + '<td class="num">' + openBadge + '</td>'
          + '</tr>';
      }).join('');
    }

    return '<div class="panel p-navy">'
      + '<div class="panel-head"><h2>All Locations</h2>'
      + '<span class="hint">' + esc(branches.length) + ' ' + (branches.length === 1 ? 'location' : 'locations') + '</span>'
      + '</div>'
      + '<table><thead><tr>'
      + '<th>Code</th><th>Location</th><th>Address</th><th>City</th><th>Group</th>'
      + '<th class="num">Assets</th><th class="num">Zones</th><th class="num">Trees</th>'
      + '<th class="num">Services YTD</th><th>Last Service</th><th class="num">Open WOs</th>'
      + '</tr></thead><tbody>' + rows + '</tbody>'
      + renderTotalsFooter(branches, groupSetMap)
      + '</table>'
      + '</div>';
  }

  // ── Wire up interactions ───────────────────────────────────────────────────
  function wireInteractions(container, allBranches, groupLookup, groupSetMap) {
    var activeFilter = 'all';

    function getFiltered() {
      if (activeFilter === 'all') return allBranches;
      if (activeFilter === 'open') return allBranches.filter(function (b) { return Number(b.openWorkOrders) > 0; });
      // group id filter
      return allBranches.filter(function (b) {
        return Array.isArray(b.groupIds) && b.groupIds.indexOf(activeFilter) !== -1;
      });
    }

    function rerenderTable() {
      var tableEl = container.querySelector('.branches-table-wrap');
      if (tableEl) {
        tableEl.innerHTML = renderBranchTable(getFiltered(), groupLookup, groupSetMap);
        wireTableClicks(tableEl);
      }
      // Update chip active state
      container.querySelectorAll('.fchip').forEach(function (chip) {
        chip.classList.toggle('on', chip.dataset.filter === activeFilter);
      });
      // Update table panel hint
      var hint = container.querySelector('.panel-head .hint');
      var filtered = getFiltered();
      if (hint) hint.textContent = filtered.length + ' ' + (filtered.length === 1 ? 'location' : 'locations');
    }

    function wireTableClicks(el) {
      el.querySelectorAll('tr.clickable[data-branch-id]').forEach(function (row) {
        row.addEventListener('click', function () {
          var id = row.getAttribute('data-branch-id');
          if (id && window.PortfolioRouter) {
            PortfolioRouter.navigate('branch-detail', true, { id: id });
          }
        });
      });
    }

    // Filter chip clicks
    container.querySelectorAll('#branches-filter-bar .fchip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        activeFilter = chip.dataset.filter || 'all';
        rerenderTable();
      });
    });

    // Initial table row clicks
    wireTableClicks(container);
  }

  // ── Main render ────────────────────────────────────────────────────────────
  function renderBranches(container, _params) {
    var orgSuffix = orgParam();
    var state     = window.PortfolioState || {};
    var groups    = Array.isArray(state.groups) ? state.groups : [];
    var groupLookup  = buildGroupLookup(groups);
    var groupSetMap  = buildGroupSetMap(groups);   // groupId → setId | null

    var url = '/api/portfolio/branches' + orgSuffix;

    apiFetch(url).then(function (branches) {
      var org  = state.organization || {};

      var html = '<div class="ctx">'
        + '<h1>' + esc(org.name || 'Portfolio') + '</h1>'
        + '<span class="sub">Locations</span>'
        + '</div>'
        + renderAnchorBand(branches)
        + renderFilterChips(branches, groupLookup, 'all')
        + '<div class="branches-table-wrap">'
        + renderBranchTable(branches, groupLookup, groupSetMap)
        + '</div>';

      container.innerHTML = html;
      wireInteractions(container, branches, groupLookup, groupSetMap);

    }).catch(function (err) {
      console.error('[portfolio/branches] fetch failed:', err);
      container.innerHTML = '<div class="pf-empty">Failed to load locations. Please refresh.</div>';
    });
  }

  // ── Register ───────────────────────────────────────────────────────────────
  if (window.PortfolioRouter) {
    PortfolioRouter.register('branches', renderBranches);
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      if (window.PortfolioRouter) PortfolioRouter.register('branches', renderBranches);
    });
  }
})();
