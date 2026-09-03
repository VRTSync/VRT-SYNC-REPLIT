/**
 * dashboard.js — Branch Portfolio Dashboard page.
 * Registered as PortfolioRouter.register('dashboard', fn).
 *
 * Fetches /api/portfolio/dashboard (+ /api/portfolio/branches for snapshot table).
 * Appends ?organizationId=<id> when in admin preview mode (PortfolioState.organizationId).
 */
(function () {
  'use strict';

  var esc = (window.VRTUtils && window.VRTUtils.esc) || function (v) { return v == null ? '' : String(v); };
  var formatShortDate = (window.VRTUtils && window.VRTUtils.formatShortDate) || function (d) { return d || '—'; };

  // ── Group colours ──────────────────────────────────────────────────────────
  // Build a groupId → { name, color, fallbackIndex } lookup. Fallback indexes
  // are stable even when an API response arrives in a different order.
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

  // ── Build admin org-id suffix ──────────────────────────────────────────────
  function orgParam() {
    var state = window.PortfolioState;
    if (state && state.organizationId) {
      return '?organizationId=' + encodeURIComponent(state.organizationId);
    }
    return '';
  }

  // ── Fetch helpers ──────────────────────────────────────────────────────────
  function apiFetch(path) {
    return fetch(path, { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  // ── Formatting helpers ────────────────────────────────────────────────────
  function pct(value, total) {
    if (!total) return 0;
    return Math.round((value / total) * 100);
  }

  function fmtDate(isoStr) {
    if (!isoStr) return '—';
    try {
      var d = new Date(isoStr);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch (_) { return isoStr; }
  }

  function fmtWholeDollars(cents) {
    return '$' + Math.round(Number(cents || 0) / 100).toLocaleString('en-US');
  }

  function portfolioHref(route, groupId) {
    var params = new URLSearchParams();
    var current = new URLSearchParams(window.location.search);
    if (current.get('org')) params.set('org', current.get('org'));
    if (groupId) params.set('group', groupId);
    var search = params.toString();
    return '/web/portfolio/' + route + (search ? '?' + search : '');
  }

  function fmtWeekRange(start, end) {
    if (!start || !end) return '';
    try {
      var s = new Date(start + 'T00:00:00');
      var e = new Date(end   + 'T00:00:00');
      var opts = { month: 'short', day: 'numeric' };
      return s.toLocaleDateString('en-US', opts) + ' – ' + e.toLocaleDateString('en-US', opts);
    } catch (_) { return start + ' – ' + end; }
  }

  function isToday(dateStr) {
    if (!dateStr) return false;
    var today = new Date();
    var s = dateStr.slice(0, 10);
    var t = today.toISOString().slice(0, 10);
    return s === t;
  }

  function dayLabel(dateStr) {
    if (!dateStr) return '';
    try {
      var d = new Date(dateStr + 'T00:00:00');
      var day = d.toLocaleDateString('en-US', { weekday: 'short' });
      var num = d.getDate();
      return day + ' ' + num;
    } catch (_) { return dateStr; }
  }

  // ── KPI row ────────────────────────────────────────────────────────────────
  function renderKpiRow(totals, openWorkOrders) {
    var t  = totals        || {};
    var wo = openWorkOrders || {};
    var branches       = Number(t.branches       || 0);
    var assetsMapped   = Number(t.assetsMapped   || 0);
    var servicesLogged = Number(t.servicesLogged || 0);
    var photoProofPct  = t.photoProofPct != null ? Number(t.photoProofPct) : null;
    var openWO         = Number(wo.total         || 0);

    return '<div class="kpi-grid">'
      + kpiTile('Locations',         branches,        'locations active',          'navy',  '')
      + kpiTile('Assets Mapped',      assetsMapped,    'across all locations',      'teal',  '')
      + kpiTile('Services Logged',    servicesLogged,  'all time',                 'blue',  '')
      + (photoProofPct != null
          ? kpiTile('Photo Documentation', photoProofPct + '%', 'of field-logged services', 'green', '')
          : kpiTile('Photo Documentation', '—', 'No field-logged services yet', 'navy', ''))
      + kpiTile('Open Work Orders',   openWO,          wo.awaitingApproval + ' awaiting approval', 'amber kpi-clickable', 'data-nav="work-orders" title="View Work Orders" style="cursor:pointer;"')
      + '</div>';
  }

  function kpiTile(label, value, sub, colorClass, extra) {
    var attrs = extra || '';
    return '<div class="kpi ' + colorClass + '" ' + attrs + '>'
      + '<div class="k-label">' + esc(label) + '</div>'
      + '<div class="k-value">' + esc(value) + '</div>'
      + '<div class="k-sub">'  + esc(sub)   + '</div>'
      + '</div>';
  }

  // ── This Week anchor band ─────────────────────────────────────────────────
  function renderWeekHero(thisWeek) {
    var tw = thisWeek || {};
    var scheduled     = Number(tw.scheduled     || 0);
    var completed     = Number(tw.completed     || 0);
    var needsAttn     = Number(tw.needsAttention || 0);
    var weekStart     = tw.weekStart || '';
    var weekEnd       = tw.weekEnd   || '';
    var days          = Array.isArray(tw.days) ? tw.days : [];
    // "total" is scheduled + completed (needsAttention is overdue/missed — a separate
    // orthogonal count, not an additional service bucket; adding it would double-count).
    var total         = scheduled + completed;
    var donePct       = total > 0 ? pct(completed, total) : 0;
    // Use remaining scheduled proportion for the amber segment (what's still pending)
    var pendPct       = total > 0 ? pct(scheduled, total) : 0;

    // Build 7-day grid: fill all 7 days of the week (Mon–Sun)
    var dayMap = {};
    days.forEach(function (d) { dayMap[d.date] = d.items; });

    // Compute Mon–Sun dates for this week
    var dayGrid = renderDayGrid(weekStart, weekEnd, dayMap);

    return '<div class="week-hero">'
      + '<div class="wh-head">'
        + '<div class="wh-title">'
          + '<div class="wh-label">This Week</div>'
          + '<h2>Service Activity</h2>'
          + '<div class="wh-range">' + esc(fmtWeekRange(weekStart, weekEnd)) + '</div>'
        + '</div>'
        + '<div class="wh-prog">'
          + '<div class="wh-prog-top">'
            + '<span><b>' + esc(completed) + '</b> completed</span>'
            + '<span>' + esc(total) + ' scheduled + completed</span>'
          + '</div>'
          + '<div class="wh-bar">'
            + '<i class="done" style="width:' + donePct + '%"></i>'
            + '<i class="flag" style="width:' + pendPct + '%"></i>'
          + '</div>'
        + '</div>'
        + '<div class="wh-stats">'
          + '<div class="wh-stat"><b>' + esc(scheduled) + '</b><span>Scheduled</span></div>'
          + '<div class="wh-stat done"><b>' + esc(completed) + '</b><span>Completed</span></div>'
          + '<div class="wh-stat alert"><b>' + esc(needsAttn) + '</b><span>Needs Attention</span></div>'
        + '</div>'
      + '</div>'
      + '<div class="wh-days">' + dayGrid + '</div>'
      + '</div>';
  }

  function renderDayGrid(weekStart, weekEnd, dayMap) {
    // Build an array of 7 YYYY-MM-DD strings for the week
    var dates = [];
    if (weekStart) {
      var base = new Date(weekStart + 'T00:00:00');
      for (var i = 0; i < 7; i++) {
        var d = new Date(base);
        d.setDate(base.getDate() + i);
        dates.push(d.toISOString().slice(0, 10));
      }
    } else {
      // Fallback: no week data — show 7 empty columns
      for (var j = 0; j < 7; j++) dates.push('');
    }

    return dates.map(function (dateStr) {
      var today   = dateStr && isToday(dateStr);
      var items   = dateStr ? (dayMap[dateStr] || []) : [];
      var isEmpty = items.length === 0;
      var cls     = 'wd' + (today ? ' today' : '') + (isEmpty ? ' empty' : '');
      var label   = dateStr ? dayLabel(dateStr) : '';

      var itemsHtml = '';
      if (isEmpty) {
        itemsHtml = '<div class="wd-empty-note">No services</div>';
      } else {
        itemsHtml = items.map(function (item) {
          var status = item.status || 'scheduled';
          var svCls  = 'wsvc';
          if      (status === 'completed') svCls += ' done';
          else if (status === 'missed'  )  svCls += ' flag';
          else if (status === 'scheduled') svCls += ' sched';
          return '<div class="' + svCls + '"><b>' + esc(item.label || status) + '</b>'
            + (item.branchCount > 1 ? esc(item.branchCount) + ' locations' : '') + '</div>';
        }).join('');
      }

      return '<div class="' + cls + '">'
        + '<div class="wd-name">' + esc(label) + '</div>'
        + itemsHtml + '</div>';
    }).join('');
  }

  // ── Group cards ────────────────────────────────────────────────────────────
  function renderGroupCards(byGroup) {
    var groups = Array.isArray(byGroup) ? byGroup : [];
    if (groups.length === 0) {
      return '<div class="pf-empty" style="margin-bottom:18px;">'
        + 'No groups configured yet. Groups let you organize locations into regional or logical collections.'
        + '</div>';
    }

    var cards = groups.map(function (g, idx) {
      var color = window.VRTGroupColors.resolveGroupColor(g, g.fallbackIndex != null ? g.fallbackIndex : idx);
      var branches = Number(g.branches || 0);
      var services = Number(g.services || 0);
      var openItems = Number(g.openItems || 0);
      var spendYtdCents = Number(g.spendYtdCents || 0);
      var locationsHref = portfolioHref('branches', g.id);
      var workOrdersHref = portfolioHref('work-orders', g.id);
      var openItemsStat = openItems > 0
        ? '<a class="gc-stat-link" href="' + esc(workOrdersHref) + '" data-group-work-orders="' + esc(g.id) + '">'
            + '<b>' + esc(openItems) + '</b>open ' + (openItems === 1 ? 'item' : 'items')
          + '</a>'
        : '<div><b>0</b>open items</div>';

      return '<div class="gcard actionable" role="link" tabindex="0"'
        + ' aria-label="View locations in ' + esc(g.name) + '"'
        + ' data-group-card="' + esc(g.id) + '"'
        + ' data-href="' + esc(locationsHref) + '"'
        + ' style="border-top-color:' + esc(color) + ';">'
        + '<div class="gc-name">' + esc(g.name) + '</div>'
        + '<div class="gc-sub">' + esc(branches) + ' ' + (branches === 1 ? 'location' : 'locations') + '</div>'
        + '<div class="gc-stats">'
          + '<div><b>' + esc(services) + '</b>services</div>'
          + '<div><b>' + esc(fmtWholeDollars(spendYtdCents)) + '</b>Spend YTD</div>'
          + openItemsStat
        + '</div>'
        + '</div>';
    }).join('');

    return '<div class="group-grid">' + cards + '</div>';
  }

  // ── Branch snapshot table ─────────────────────────────────────────────────
  function renderBranchSnapshot(branches, groups) {
    var bArr = Array.isArray(branches) ? branches : [];
    var gArr = Array.isArray(groups)   ? groups   : [];

    // Build groupId → { name, color, fallbackIndex } lookup
    var groupLookup = buildGroupLookup(gArr);

    var rows;
    if (bArr.length === 0) {
      rows = '<tr class="pf-empty-row"><td colspan="5">No locations provisioned yet.</td></tr>';
    } else {
      rows = bArr.map(function (b) {
        var code    = b.code  || '—';
        var name    = b.name  || '—';
        var city    = b.city  || '';
        var ytd     = Number(b.servicesYtd || 0);
        var lastAt  = b.lastServiceAt  || null;
        var lastLbl = b.lastServiceLabel || '';

        // API returns groupIds: string[] (a branch can belong to multiple groups)
        // Show the first assigned group; show '—' if none.
        var groupIds = Array.isArray(b.groupIds) ? b.groupIds : [];
        var primaryGroupId = groupIds.length > 0 ? groupIds[0] : null;
        var groupInfo = primaryGroupId ? groupLookup[primaryGroupId] : null;

        var groupChip = '';
        if (groupInfo) {
          var color = window.VRTGroupColors.resolveGroupColor(groupInfo, groupInfo.fallbackIndex);
          groupChip = '<span class="gchip" style="background:' + esc(window.VRTGroupColors.hexToRgba(color, 0.12))
            + ';color:' + esc(color) + ';">' + esc(groupInfo.name) + '</span>';
        } else {
          groupChip = '<span style="color:var(--gray-400);font-size:12px;">—</span>';
        }

        var lastSvcText = '';
        if (lastAt) {
          lastSvcText = fmtDate(lastAt);
          if (lastLbl) lastSvcText += ' · ' + lastLbl;
        } else {
          lastSvcText = '—';
        }

        return '<tr class="clickable" data-branch-id="' + esc(b.id) + '">'
          + '<td class="bcode">' + esc(code)    + '</td>'
          + '<td><div class="bname">' + esc(name) + '</div>'
          +     (city ? '<div class="bsub">' + esc(city) + '</div>' : '')
          + '</td>'
          + '<td>' + groupChip + '</td>'
          + '<td class="num">' + esc(ytd) + '</td>'
          + '<td class="bsub">' + esc(lastSvcText) + '</td>'
          + '</tr>';
      }).join('');
    }

    return '<div class="panel p-navy">'
      + '<div class="panel-head"><h2>Location Snapshot</h2>'
      + '<span class="hint">' + esc(bArr.length) + ' ' + (bArr.length === 1 ? 'location' : 'locations') + '</span>'
      + '</div>'
      + '<table><thead><tr>'
      + '<th>Code</th><th>Location</th><th>Group</th>'
      + '<th class="num">Services YTD</th><th>Last Service</th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table>'
      + '</div>';
  }

  // ── Portfolio map preview panel ───────────────────────────────────────────
  var _mapRenderer = null;

  function teardownMapPreview() {
    if (_mapRenderer) { _mapRenderer.destroy(); _mapRenderer = null; }
  }

  function mappedBranches(branches) {
    return (Array.isArray(branches) ? branches : []).filter(function (b) {
      return b.lat != null && b.lng != null
        && Number.isFinite(Number(b.lat)) && Number.isFinite(Number(b.lng));
    });
  }

  function renderMapPanel(branches) {
    var mapped = mappedBranches(branches);
    var total = Array.isArray(branches) ? branches.length : 0;
    var unmappedCount = total - mapped.length;
    var body;
    if (mapped.length === 0) {
      body = '<div class="pf-empty" style="flex:1;">No locations mapped yet. Locations appear here once their property maps have geometry.</div>';
    } else {
      body = '<div class="dash-map-body" id="dash-map-body">'
        + '<iframe id="dash-map-iframe" src="/leaflet-map.html" class="dash-map-iframe" title="Portfolio map preview"></iframe>'
        + '<div class="dash-map-legend" id="dash-map-legend"></div>'
        + '</div>';
    }
    var caveat = unmappedCount > 0
      ? '<div class="dash-map-caveat">' + esc(unmappedCount) + ' '
        + (unmappedCount === 1 ? 'location is' : 'locations are')
        + ' not yet mapped and omitted from this map.</div>'
      : '';
    return '<div class="panel p-teal dash-map-panel" id="dash-map-panel" title="Open Portfolio Map">'
      + '<div class="panel-head"><h2>Portfolio Map</h2>'
      + '<span class="hint">' + esc(mapped.length) + ' ' + (mapped.length === 1 ? 'location' : 'locations') + '</span>'
      + '</div>'
      + body
      + caveat
      + '</div>';
  }

  // Compact legend: each group and its mapped-location count.
  // When pins are group-coloured (branchGroups supplied) the dots carry the
  // group colours and rows follow the same first-group-wins assignment the
  // pins use. Without a colour-by set the pins keep their navy/amber default,
  // so the legend keeps its original dots and the open-work-order key.
  function buildLegendHtml(mapped, orderedGroups, branchGroups) {
    var counts = {};   // groupId → count
    var colors = {};   // groupId → hex (group-coloured mode only)
    var ungrouped = 0;
    mapped.forEach(function (b) {
      if (branchGroups) {
        var entry = branchGroups[b.id];
        if (!entry) { ungrouped++; return; }
        counts[entry.group.id] = (counts[entry.group.id] || 0) + 1;
        colors[entry.group.id] = window.VRTGroupColors
          .resolveGroupColor(entry.group, entry.fallbackIndex);
        return;
      }
      var gids = Array.isArray(b.groupIds) ? b.groupIds : [];
      if (gids.length === 0) { ungrouped++; return; }
      counts[gids[0]] = (counts[gids[0]] || 0) + 1;
    });
    var unassignedColor = branchGroups
      ? window.VRTGroupColors.UNASSIGNED_COLOR
      : '#0C1D31';
    var rows = '';
    (orderedGroups || []).forEach(function (g) {
      if (!counts[g.id]) return;
      rows += '<div class="dml-row"><span class="dml-dot" style="background:'
        + esc(colors[g.id] || '#0C1D31') + '"></span>'
        + esc(g.name) + '<b>' + esc(counts[g.id]) + '</b></div>';
    });
    if (ungrouped > 0) {
      rows += '<div class="dml-row"><span class="dml-dot" style="background:' + unassignedColor + '"></span>'
        + (branchGroups ? 'Unassigned' : 'Ungrouped') + '<b>' + esc(ungrouped) + '</b></div>';
    }
    if (!branchGroups) {
      var hasWo = mapped.some(function (b) { return Number(b.openWorkOrders) > 0; });
      if (hasWo) {
        rows += '<div class="dml-row"><span class="dml-dot" style="background:#f59e0b"></span>Open work order</div>';
      }
    }
    return rows;
  }

  function initMapPreview(container, branches, orderedGroups) {
    var mapped = mappedBranches(branches);
    var panel  = container.querySelector('#dash-map-panel');
    if (!panel) return;

    // Colour pins by group, exactly like the Portfolio Map. The set is resolved
    // on every render (not once at load) so switching "Colour by" on the Map
    // page and navigating back here shows the new colours. With no set
    // selected both helpers yield null and the pins keep today's default.
    var state        = window.PortfolioState || {};
    var colorBySetId = window.VRTGroupColors.resolveColorBySetId(state);
    var branchGroups = window.VRTGroupColors.makeBranchGroupLookup(state.groups || [], colorBySetId);
    var colorFor     = window.VRTGroupColors.makeBranchColorFor(state.groups || [], colorBySetId);

    // Header (and empty-state panel) click → full Portfolio Map route.
    panel.querySelector('.panel-head').addEventListener('click', function () {
      if (window.PortfolioRouter) PortfolioRouter.navigate('map', true, {});
    });

    if (mapped.length === 0) return; // empty-state panel, no renderer

    var iframe = container.querySelector('#dash-map-iframe');
    var legend = container.querySelector('#dash-map-legend');
    if (legend) legend.innerHTML = buildLegendHtml(mapped, orderedGroups, branchGroups);

    // Null adapter — the preview renders only branch pins via the shared
    // custom-layer path; no community layers.
    var nullAdapter = {
      fetchLayers:       function () { return Promise.resolve([]); },
      fetchLayerGeojson: function () { return Promise.resolve(null); },
      fetchControllers:  function () { return Promise.resolve([]); },
    };

    _mapRenderer = window.VRTMapRenderer.create({
      iframe:      iframe,
      adapter:     nullAdapter,
      hierarchy:   {},
      interactive: false, // preview: no scroll-wheel zoom, drag, dbl-click, keyboard
    });

    var renderer = _mapRenderer;
    var didInit  = false;
    renderer.on('ready', function () {
      // 'ready' can fire late/replayed — send pins + fit only once.
      if (didInit) return;
      didInit = true;
      // directTap stays on — the preview navigates straight to the location.
      var pinOpts = { directTap: true };
      if (colorFor) pinOpts.colorFor = colorFor;
      window.VRTMapRenderer.sendBranchPins(renderer, mapped, 'dash-branches', pinOpts);
      // Fit the viewport to all mapped locations once, on first render.
      renderer.fit();
    });

    renderer.on('assetTap', function (data) {
      var branchId = data && (data.featureRef || data.featureId);
      if (branchId && window.PortfolioRouter) {
        PortfolioRouter.navigate('branch-detail', true, { id: branchId });
      }
    });

    renderer.on('mapTap', function () {
      if (window.PortfolioRouter) PortfolioRouter.navigate('map', true, {});
    });

    renderer.load(null);
  }

  // ── Refresh label ─────────────────────────────────────────────────────────
  function refreshLabel() {
    return '<span class="refresh-label" id="pf-refresh-label">updated just now</span>';
  }

  // ── Main render function ───────────────────────────────────────────────────
  function renderDashboard(container, _params) {
    teardownMapPreview();
    var orgSuffix = orgParam();
    var state     = window.PortfolioState || {};
    var groups    = state.groups || [];

    // Fetch dashboard data + branch list in parallel
    var dashUrl     = '/api/portfolio/dashboard' + orgSuffix;
    var branchesUrl = '/api/portfolio/branches'  + orgSuffix;

    Promise.all([
      apiFetch(dashUrl),
      apiFetch(branchesUrl),
    ]).then(function (results) {
      var dash     = results[0];
      var branches = results[1];

      // Merge group info: PortfolioState.groups has saved colours; dashboard.byGroup
      // has the metrics. The shared lookup supplies stable fallback indexes.
      var dashGroups = Array.isArray(dash.byGroup) ? dash.byGroup : [];
      var stateGroups = Array.isArray(state.groups) ? state.groups : [];
      var groupRecords = stateGroups.length > 0
        ? stateGroups
        : dashGroups.map(function (g) { return { id: g.groupId, name: g.name }; });
      var groupLookup = buildGroupLookup(groupRecords);
      var orderedGroups = groupRecords.map(function (g) {
        var info = groupLookup[g.id] || {};
        return {
          id: g.id,
          name: g.name,
          color: g.color,
          fallbackIndex: info.fallbackIndex,
        };
      });

      var org      = state.organization || {};
      var locCount = Array.isArray(branches) ? branches.length : 0;
      var grpCount = orderedGroups.length;
      var dashSubtitle = (org.name ? esc(org.name) + ' · ' : '')
        + locCount + ' ' + (locCount === 1 ? 'location' : 'locations')
        + ' · ' + grpCount + ' ' + (grpCount === 1 ? 'group' : 'groups');
      var html = '<div class="ctx">'
        + '<h1>Portfolio Dashboard</h1>'
        + '<span class="sub">' + dashSubtitle + '</span>'
        + refreshLabel()
        + '</div>'
        + renderKpiRow(dash.totals, dash.openWorkOrders)
        + renderWeekHero(dash.thisWeek)
        + renderGroupCards(dashGroups.map(function (g, idx) {
            var groupInfo = groupLookup[g.groupId] || {};
            return {
              id:           g.groupId,
              name:         g.name,
              branches:     g.branches,
              services:     g.services,
              openItems:    g.openItems,
              spendYtdCents: g.spendYtdCents,
              color:        groupInfo.color,
              fallbackIndex: groupInfo.fallbackIndex != null ? groupInfo.fallbackIndex : idx,
            };
          }))
        + '<div class="dash-bottom">'
        +   renderBranchSnapshot(branches, orderedGroups)
        +   renderMapPanel(branches)
        + '</div>';

      teardownMapPreview();
      container.innerHTML = html;
      initMapPreview(container, branches, orderedGroups);

      container.querySelectorAll('[data-group-work-orders]').forEach(function (link) {
        link.addEventListener('click', function (event) {
          event.preventDefault();
          event.stopPropagation();
          var groupId = link.getAttribute('data-group-work-orders');
          if (groupId && window.PortfolioRouter) {
            PortfolioRouter.navigate('work-orders', true, { group: groupId });
          }
        });
      });

      container.querySelectorAll('[data-group-card]').forEach(function (card) {
        function openLocations() {
          var groupId = card.getAttribute('data-group-card');
          if (groupId && window.PortfolioRouter) {
            PortfolioRouter.navigate('branches', true, { group: groupId });
          }
        }
        card.addEventListener('click', function (event) {
          if (event.target.closest && event.target.closest('[data-group-work-orders]')) return;
          openLocations();
        });
        card.addEventListener('keydown', function (event) {
          if (event.target.closest && event.target.closest('[data-group-work-orders]')) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openLocations();
          }
        });
      });

      // Wire branch snapshot rows to navigate to branch-detail
      container.querySelectorAll('tr.clickable[data-branch-id]').forEach(function (row) {
        row.addEventListener('click', function () {
          var id = row.getAttribute('data-branch-id');
          if (id && window.PortfolioRouter) {
            PortfolioRouter.navigate('branch-detail', true, { id: id });
          }
        });
      });

      // Wire "Open Work Orders" KPI tile to navigate to work-orders page
      container.querySelectorAll('[data-nav]').forEach(function (el) {
        el.addEventListener('click', function () {
          var route = el.getAttribute('data-nav');
          if (route && window.PortfolioRouter) {
            PortfolioRouter.navigate(route, true, {});
          }
        });
      });

    }).catch(function (err) {
      console.error('[portfolio/dashboard] fetch failed:', err);
      container.innerHTML = '<div class="pf-empty">Failed to load dashboard data. Please refresh.</div>';
    });
  }

  // ── Register ───────────────────────────────────────────────────────────────
  if (window.PortfolioRouter) {
    PortfolioRouter.register('dashboard', renderDashboard);
  } else {
    // Defer registration until PortfolioRouter is available (shouldn't normally happen)
    document.addEventListener('DOMContentLoaded', function () {
      if (window.PortfolioRouter) PortfolioRouter.register('dashboard', renderDashboard);
    });
  }
})();
