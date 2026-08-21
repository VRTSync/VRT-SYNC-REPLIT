/**
 * groups.js — Branch Portfolio "Groups" page.
 * Registered as PortfolioRouter.register('groups', fn).
 *
 * Fetches GET /api/portfolio/group-sets (+ organizationId when in admin preview).
 * Renders:
 *   • Context header — "Groups"
 *   • Anchor band — coverage bar segmented by the first set's groups
 *   • Group cards row for the first set (+ inert "+ New group" card)
 *   • One panel per group set, in sortOrder, each with a group metrics table
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

  // ── Colors ────────────────────────────────────────────────────────────────
  // Group colour comes from the group record; the neutral fallback matches
  // the dashboard cards' default (gray).
  var NEUTRAL = '#94a3b8';
  var PANEL_ACCENTS = ['p-blue', 'p-green', 'p-amber', 'p-navy'];

  function groupColor(g) {
    return (g && g.color) ? g.color : NEUTRAL;
  }

  function hexToRgba(hex, alpha) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return 'rgba(148,163,184,' + alpha + ')';
    var n = parseInt(m[1], 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
  }

  function groupChip(g) {
    var c = groupColor(g);
    return '<span class="gchip" style="background:' + esc(hexToRgba(c, 0.12))
      + ';color:' + esc(c) + ';">' + esc(g.name) + '</span>';
  }

  // ── Branch code lookup ────────────────────────────────────────────────────
  function buildBranchCodeLookup() {
    var state = window.PortfolioState || {};
    var branches = Array.isArray(state.branches) ? state.branches : [];
    var map = {};
    branches.forEach(function (b) { map[b.id] = b.code || b.name || '—'; });
    return map;
  }

  // ── Anchor band ───────────────────────────────────────────────────────────
  function renderAnchorBand(sets) {
    var state = window.PortfolioState || {};
    var branchTotal = Array.isArray(state.branches) ? state.branches.length : 0;

    var setCount = sets.length;
    var groupTotal = sets.reduce(function (acc, s) { return acc + (s.groups || []).length; }, 0);

    var firstGroups = (sets[0] && sets[0].groups) || [];
    var covered = firstGroups.reduce(function (acc, g) { return acc + Number(g.branchCount || 0); }, 0);

    var barHtml = '';
    var legendHtml = '';
    if (covered > 0) {
      firstGroups.forEach(function (g) {
        var n = Number(g.branchCount || 0);
        if (n <= 0) return;
        var pct = Math.round((n / covered) * 100);
        var c = groupColor(g);
        barHtml += '<i style="width:' + pct + '%;background:' + esc(c) + '"></i>';
        legendHtml += '<span><i style="background:' + esc(c) + '"></i>' + esc(g.name) + ' · ' + n + '</span>';
      });
    } else {
      barHtml = '<i style="width:100%;background:rgba(255,255,255,0.14)"></i>';
      legendHtml = '<span style="color:var(--gray-400)">No grouped locations yet</span>';
    }

    return '<div class="anchor">'
      + '<div class="a-title">'
        + '<div class="a-label">Portfolio Structure</div>'
        + '<div class="a-main">' + esc(setCount) + ' group ' + (setCount === 1 ? 'set' : 'sets') + ' · '
          + esc(branchTotal) + ' ' + (branchTotal === 1 ? 'location' : 'locations') + '</div>'
        + '<div class="a-sub">' + (sets[0] ? esc(sets[0].name) + ' coverage shown' : 'no group sets yet') + '</div>'
      + '</div>'
      + '<div class="a-mid">'
        + '<div class="a-bar">' + barHtml + '</div>'
        + '<div class="a-legend">' + legendHtml + '</div>'
      + '</div>'
      + '<div class="a-stats">'
        + '<div class="a-stat teal"><b>' + esc(setCount) + '</b><span>group ' + (setCount === 1 ? 'set' : 'sets') + '</span></div>'
        + '<div class="a-stat blue"><b>' + esc(groupTotal) + '</b><span>' + (groupTotal === 1 ? 'group' : 'groups') + '</span></div>'
      + '</div>'
      + '</div>';
  }

  // ── Group cards row (first set) ───────────────────────────────────────────
  function renderGroupCards(firstSet) {
    var groups = (firstSet && firstSet.groups) || [];

    var cards = groups.map(function (g) {
      var c = groupColor(g);
      var branches = Number(g.branchCount || 0);
      var openItems = Number(g.openItems || 0);
      var photoPct = g.photoProofPct != null ? Number(g.photoProofPct) : null;

      return '<div class="gcard" style="border-top-color:' + esc(c) + ';">'
        + '<div class="gc-name">' + esc(g.name) + '</div>'
        + '<div class="gc-sub">' + esc(branches) + ' ' + (branches === 1 ? 'location' : 'locations') + '</div>'
        + '<div class="gc-stats">'
          + '<div><b>' + esc(g.servicesPerBranch != null ? g.servicesPerBranch : '—') + '</b>svcs / location</div>'
          + '<div><b>' + (photoPct != null ? esc(photoPct) + '%' : '—') + '</b>photo proof</div>'
          + '<div><b>' + esc(openItems) + '</b>open ' + (openItems === 1 ? 'item' : 'items') + '</div>'
        + '</div>'
        + '</div>';
    }).join('');

    // Inert in this slice: renders, not clickable, no handler.
    cards += '<div class="gcard add">+ New group</div>';

    return '<div class="group-grid">' + cards + '</div>';
  }

  // ── Set panel ─────────────────────────────────────────────────────────────
  function renderSetPanel(set, idx, codeLookup) {
    var groups = set.groups || [];
    var accent = PANEL_ACCENTS[idx % PANEL_ACCENTS.length];

    var rows;
    if (groups.length === 0) {
      rows = '<tr class="pf-empty-row"><td colspan="8">No groups in this set yet.</td></tr>';
    } else {
      rows = groups.map(function (g) {
        var codes = (Array.isArray(g.branchIds) ? g.branchIds : [])
          .map(function (id) { return codeLookup[id] || '—'; })
          .join(', ');
        var svcs = g.servicesPerBranch != null ? g.servicesPerBranch : '—';
        return '<tr>'
          + '<td>' + groupChip(g) + '</td>'
          + '<td class="bsub">' + (codes ? esc(codes) : '—') + '</td>'
          + '<td class="num">' + esc(Number(g.assets || 0)) + '</td>'
          + '<td class="num">' + esc(Number(g.irrigationZones || 0)) + '</td>'
          + '<td class="num">' + esc(Number(g.trees || 0)) + '</td>'
          + '<td class="num">' + esc(svcs) + '</td>'
          + '<td class="num">' + esc(Number(g.openItems || 0)) + '</td>'
          + '<td class="num">' + (g.photoProofPct != null ? esc(Number(g.photoProofPct)) + '%' : '—') + '</td>'
          + '</tr>';
      }).join('');
    }

    return '<div class="panel ' + accent + '">'
      + '<div class="panel-head"><h2>' + esc(set.name) + '</h2>'
      + '<span class="hint">group set · ' + esc(groups.length) + ' ' + (groups.length === 1 ? 'group' : 'groups') + '</span>'
      + '</div>'
      + '<table><thead><tr>'
      + '<th>Group</th><th>Locations</th>'
      + '<th class="num">Assets</th><th class="num">Zones</th><th class="num">Trees</th>'
      + '<th class="num">Services</th><th class="num">Open</th><th class="num">Photo Rate</th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table>'
      + '</div>';
  }

  // ── Main render ───────────────────────────────────────────────────────────
  function renderGroups(container, _params) {
    var url = '/api/portfolio/group-sets' + orgParam();

    apiFetch(url).then(function (sets) {
      sets = Array.isArray(sets) ? sets : [];
      var codeLookup = buildBranchCodeLookup();

      var html = '<div class="ctx">'
        + '<h1>Groups</h1>'
        + '<span class="sub">organize locations the way your business is structured</span>'
        + '</div>'
        + renderAnchorBand(sets)
        + renderGroupCards(sets[0]);

      sets.forEach(function (set, idx) {
        html += renderSetPanel(set, idx, codeLookup);
      });

      if (sets.length === 0) {
        html += '<div class="pf-empty">No group sets configured yet. Groups let you organize locations into regional or logical collections.</div>';
      }

      container.innerHTML = html;
    }).catch(function (err) {
      console.error('[portfolio/groups] fetch failed:', err);
      container.innerHTML = '<div class="pf-empty">Failed to load groups. Please refresh.</div>';
    });
  }

  // ── Register ──────────────────────────────────────────────────────────────
  if (window.PortfolioRouter) {
    PortfolioRouter.register('groups', renderGroups);
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      if (window.PortfolioRouter) PortfolioRouter.register('groups', renderGroups);
    });
  }
})();
