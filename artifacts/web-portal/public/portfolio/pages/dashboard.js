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

  // ── Group chip color cycling (matches mockup g1/g2/g3) ────────────────────
  var GROUP_COLORS = ['g1', 'g2', 'g3', 'g4', 'g5'];
  // Group card top-border classes (css: .gcard.g1 → blue, .g2 → amber, .g3 → teal …)
  function groupColorClass(idx) {
    return GROUP_COLORS[idx % GROUP_COLORS.length];
  }

  // ── Group chip color cycling (for branch snapshot) ───────────────────────
  // Build a groupId → { name, colorIdx } lookup from an ordered array of groups
  function buildGroupLookup(groups) {
    var map = {};
    (groups || []).forEach(function (g, idx) {
      map[g.id] = { name: g.name, colorIdx: idx };
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
    var photoProofPct  = Number(t.photoProofPct  || 0);
    var openWO         = Number(wo.total         || 0);

    return '<div class="kpi-grid">'
      + kpiTile('Branches',          branches,        'branches active',          'navy',  '')
      + kpiTile('Assets Mapped',      assetsMapped,    'across all branches',      'teal',  '')
      + kpiTile('Services Logged',    servicesLogged,  'all time',                 'blue',  '')
      + kpiTile('Photo Documentation', photoProofPct + '%', 'of completions verified', 'green', '')
      + kpiTile('Open Work Orders',   openWO,          wo.awaitingApproval + ' awaiting approval', 'amber', '')
      + '</div>';
  }

  function kpiTile(label, value, sub, colorClass, _extra) {
    return '<div class="kpi ' + colorClass + '">'
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
            + (item.branchCount > 1 ? esc(item.branchCount) + ' branches' : '') + '</div>';
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
        + 'No groups configured yet. Groups let you organize branches into regional or logical collections.'
        + '</div>';
    }

    var cards = groups.map(function (g, idx) {
      var colorCls = groupColorClass(idx);
      var branches = Number(g.branches || 0);
      var services = Number(g.services || 0);
      var openItems = Number(g.openItems || 0);
      var photoPct  = Number(g.photoProofPct || 0);

      return '<div class="gcard ' + colorCls + '">'
        + '<div class="gc-name">' + esc(g.name) + '</div>'
        + '<div class="gc-sub">' + esc(branches) + ' ' + (branches === 1 ? 'branch' : 'branches') + '</div>'
        + '<div class="gc-stats">'
          + '<div><b>' + esc(services) + '</b>services</div>'
          + '<div><b>' + esc(photoPct) + '%</b>photo proof</div>'
          + '<div><b>' + esc(openItems) + '</b>open ' + (openItems === 1 ? 'item' : 'items') + '</div>'
        + '</div>'
        + '</div>';
    }).join('');

    return '<div class="group-grid">' + cards + '</div>';
  }

  // ── Branch snapshot table ─────────────────────────────────────────────────
  function renderBranchSnapshot(branches, groups) {
    var bArr = Array.isArray(branches) ? branches : [];
    var gArr = Array.isArray(groups)   ? groups   : [];

    // Build groupId → { name, colorIdx } lookup
    var groupLookup = buildGroupLookup(gArr);

    var rows;
    if (bArr.length === 0) {
      rows = '<tr class="pf-empty-row"><td colspan="5">No branches provisioned yet.</td></tr>';
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
          var cc = groupColorClass(groupInfo.colorIdx);
          groupChip = '<span class="gchip ' + cc + '">' + esc(groupInfo.name) + '</span>';
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

        return '<tr>'
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
      + '<div class="panel-head"><h2>Branch Snapshot</h2>'
      + '<span class="hint">' + esc(bArr.length) + ' ' + (bArr.length === 1 ? 'branch' : 'branches') + '</span>'
      + '</div>'
      + '<table><thead><tr>'
      + '<th>Code</th><th>Branch</th><th>Group</th>'
      + '<th class="num">Services YTD</th><th>Last Service</th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table>'
      + '</div>';
  }

  // ── Refresh label ─────────────────────────────────────────────────────────
  function refreshLabel() {
    return '<span class="refresh-label" id="pf-refresh-label">updated just now</span>';
  }

  // ── Main render function ───────────────────────────────────────────────────
  function renderDashboard(container, _params) {
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

      // Merge group info: PortfolioState.groups has id+name; dashboard.byGroup has same IDs
      // Build group map for branch chips using dashboard group order + state groups
      var dashGroups = Array.isArray(dash.byGroup) ? dash.byGroup : [];
      var stateGroups = Array.isArray(state.groups) ? state.groups : [];

      // Reconcile: prefer state.groups for id/name, use dashGroups for order
      var orderedGroups;
      if (stateGroups.length > 0) {
        orderedGroups = stateGroups.map(function (g) {
          return { id: g.id, name: g.name };
        });
      } else {
        orderedGroups = dashGroups.map(function (g) {
          return { id: g.groupId, name: g.name };
        });
      }

      var org  = state.organization || {};
      var html = '<div class="ctx">'
        + '<h1>' + esc(org.name || 'Portfolio') + '</h1>'
        + '<span class="sub">Dashboard</span>'
        + refreshLabel()
        + '</div>'
        + renderKpiRow(dash.totals, dash.openWorkOrders)
        + renderWeekHero(dash.thisWeek)
        + renderGroupCards(dashGroups.map(function (g, idx) {
            return {
              name:         g.name,
              branches:     g.branches,
              services:     g.services,
              openItems:    g.openItems,
              photoProofPct: g.photoProofPct,
              colorIdx:     idx,
            };
          }))
        + renderBranchSnapshot(branches, orderedGroups);

      container.innerHTML = html;

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
