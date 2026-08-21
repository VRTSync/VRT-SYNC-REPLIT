/**
 * groups.js — Branch Portfolio "Groups" page.
 * Registered as PortfolioRouter.register('groups', fn).
 *
 * Fetches GET /api/portfolio/group-sets (+ organizationId when in admin preview).
 * Renders:
 *   • Context header — "Groups" + "New group set" action
 *   • Anchor band — coverage bar segmented by all sets' groups
 *   • Group cards grid per set (+ live "+ New group" card per set)
 *   • One panel per group set with group metrics table
 *   • "Unassigned" section for orphaned groups (set_id = null)
 */
(function () {
  'use strict';

  var esc = (window.VRTUtils && window.VRTUtils.esc) || function (v) { return v == null ? '' : String(v); };

  // ── State ─────────────────────────────────────────────────────────────────
  var _container = null;
  var _currentSets = [];

  // ── Admin org-id suffix ───────────────────────────────────────────────────
  function orgParam() {
    var state = window.PortfolioState;
    if (state && state.organizationId) {
      return '?organizationId=' + encodeURIComponent(state.organizationId);
    }
    return '';
  }

  // ── API helpers ───────────────────────────────────────────────────────────
  function apiFetch(path) {
    return fetch(path, { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function apiMutate(method, path, body) {
    return fetch(path, {
      method: method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: body != null ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      if (r.status === 204) return null;
      return r.json().then(function (data) {
        if (!r.ok) throw Object.assign(new Error(data.error || 'HTTP ' + r.status), { status: r.status, body: data });
        return data;
      });
    });
  }

  // ── Colour palette ────────────────────────────────────────────────────────
  // Local constant; if the shared palette module from task #530 lands, import
  // that instead. Do NOT introduce a third conflicting palette elsewhere.
  var COLOR_PALETTE = [
    '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6',
    '#ef4444', '#06b6d4', '#f97316', '#14b8a6',
    '#6366f1', '#84cc16', '#ec4899', '#0ea5e9',
  ];
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
    return '<span class="gchip" style="background:' + esc(hexToRgba(c, 0.12)) + ';color:' + esc(c) + ';">' + esc(g.name) + '</span>';
  }

  // ── Branch lookup ─────────────────────────────────────────────────────────
  function buildBranchCodeLookup() {
    var branches = Array.isArray((window.PortfolioState || {}).branches) ? window.PortfolioState.branches : [];
    var map = {};
    branches.forEach(function (b) { map[b.id] = b.code || b.name || '—'; });
    return map;
  }

  function allBranches() {
    return Array.isArray((window.PortfolioState || {}).branches) ? window.PortfolioState.branches : [];
  }

  // ── Anchor band ───────────────────────────────────────────────────────────
  function renderAnchorBand(sets) {
    var branchTotal = allBranches().length;
    var realSets = sets.filter(function (s) { return s.id !== null; });
    var setCount = realSets.length;
    var groupTotal = sets.reduce(function (acc, s) { return acc + (s.groups || []).length; }, 0);

    // Bar & legend based on the first named set (same UX as before, updated description)
    var firstGroups = (realSets[0] && realSets[0].groups) || [];
    var covered = firstGroups.reduce(function (acc, g) { return acc + Number(g.branchCount || 0); }, 0);
    var barHtml = '', legendHtml = '';
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

    var subText = realSets[0]
      ? esc(realSets[0].name) + ' coverage shown'
      : 'no group sets yet';

    return '<div class="anchor">'
      + '<div class="a-title">'
        + '<div class="a-label">Portfolio Structure</div>'
        + '<div class="a-main">' + esc(setCount) + ' group ' + (setCount === 1 ? 'set' : 'sets') + ' · '
          + esc(branchTotal) + ' ' + (branchTotal === 1 ? 'location' : 'locations') + '</div>'
        + '<div class="a-sub">' + subText + '</div>'
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

  // ── Group cards row (per set) ─────────────────────────────────────────────
  function renderGroupCards(set) {
    var groups = (set && set.groups) || [];
    var setId = set ? set.id : null;

    var cards = groups.map(function (g) {
      var c = groupColor(g);
      var branches = Number(g.branchCount || 0);
      var openItems = Number(g.openItems || 0);
      var photoPct = g.photoProofPct != null ? Number(g.photoProofPct) : null;

      return '<div class="gcard" style="border-top-color:' + esc(c) + ';" data-group-id="' + esc(g.id) + '">'
        + '<div class="gc-actions">'
          + '<button class="gc-icon-btn" data-action="edit-group" data-group-id="' + esc(g.id) + '" title="Edit group">✏</button>'
          + '<button class="gc-icon-btn gc-icon-del" data-action="delete-group" data-group-id="' + esc(g.id) + '" title="Delete group">✕</button>'
        + '</div>'
        + '<div class="gc-name">' + esc(g.name) + '</div>'
        + '<div class="gc-sub">' + esc(branches) + ' ' + (branches === 1 ? 'location' : 'locations') + '</div>'
        + '<div class="gc-stats">'
          + '<div><b>' + esc(g.servicesPerBranch != null ? g.servicesPerBranch : '—') + '</b>svcs / location</div>'
          + '<div><b>' + (photoPct != null ? esc(photoPct) + '%' : '—') + '</b>photo proof</div>'
          + '<div><b>' + esc(openItems) + '</b>open ' + (openItems === 1 ? 'item' : 'items') + '</div>'
        + '</div>'
        + '</div>';
    }).join('');

    // "+ New group" card — only for named sets (not the synthetic Unassigned bucket)
    if (setId !== null) {
      cards += '<div class="gcard add" data-action="new-group" data-set-id="' + esc(setId) + '" style="cursor:pointer;">+ New group</div>';
    }

    return '<div class="group-grid">' + cards + '</div>';
  }

  // ── Set panel ─────────────────────────────────────────────────────────────
  function renderSetPanel(set, idx, codeLookup) {
    var groups = set.groups || [];
    var accent = PANEL_ACCENTS[idx % PANEL_ACCENTS.length];
    var isUnassigned = set.id === null;

    var rows;
    if (groups.length === 0) {
      rows = '<tr class="pf-empty-row"><td colspan="9">No groups in this set yet.</td></tr>';
    } else {
      rows = groups.map(function (g) {
        var codes = (Array.isArray(g.branchIds) ? g.branchIds : [])
          .map(function (id) { return codeLookup[id] || '—'; })
          .join(', ');
        var svcs = g.servicesPerBranch != null ? g.servicesPerBranch : '—';
        return '<tr data-group-id="' + esc(g.id) + '">'
          + '<td>' + groupChip(g) + '</td>'
          + '<td class="bsub">' + (codes ? esc(codes) : '—') + '</td>'
          + '<td class="num">' + esc(Number(g.assets || 0)) + '</td>'
          + '<td class="num">' + esc(Number(g.irrigationZones || 0)) + '</td>'
          + '<td class="num">' + esc(Number(g.trees || 0)) + '</td>'
          + '<td class="num">' + esc(svcs) + '</td>'
          + '<td class="num">' + esc(Number(g.openItems || 0)) + '</td>'
          + '<td class="num">' + (g.photoProofPct != null ? esc(Number(g.photoProofPct)) + '%' : '—') + '</td>'
          + '<td class="num gs-row-actions">'
            + '<button class="gc-icon-btn" data-action="edit-group" data-group-id="' + esc(g.id) + '" title="Edit">✏</button>'
            + ' <button class="gc-icon-btn gc-icon-del" data-action="delete-group" data-group-id="' + esc(g.id) + '" title="Delete">✕</button>'
            + ' <button class="gc-icon-btn gc-icon-assign" data-action="assign-members" data-group-id="' + esc(g.id) + '" title="Assign locations">⊕</button>'
          + '</td>'
          + '</tr>';
      }).join('');
    }

    var headActions = '';
    if (!isUnassigned) {
      headActions = '<div class="gs-head-actions">'
        + '<button class="gs-action-btn" data-action="new-group" data-set-id="' + esc(set.id) + '">+ Group</button>'
        + '<button class="gs-action-btn" data-action="edit-set" data-set-id="' + esc(set.id) + '" title="Rename set">✏</button>'
        + '<button class="gs-action-btn gs-action-del" data-action="delete-set" data-set-id="' + esc(set.id) + '" title="Delete set">✕</button>'
        + '</div>';
    }

    return '<div class="panel ' + accent + '">'
      + '<div class="panel-head">'
        + '<h2>' + esc(set.name) + '</h2>'
        + '<span class="hint">group set · ' + esc(groups.length) + ' ' + (groups.length === 1 ? 'group' : 'groups') + '</span>'
        + headActions
      + '</div>'
      + '<table><thead><tr>'
        + '<th>Group</th><th>Locations</th>'
        + '<th class="num">Assets</th><th class="num">Zones</th><th class="num">Trees</th>'
        + '<th class="num">Services</th><th class="num">Open</th><th class="num">Photo Rate</th>'
        + '<th class="num">Actions</th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table>'
      + '</div>';
  }

  // ── Main render ───────────────────────────────────────────────────────────
  function renderGroups(container, _params) {
    _container = container;
    var url = '/api/portfolio/group-sets' + orgParam();

    apiFetch(url).then(function (sets) {
      _currentSets = Array.isArray(sets) ? sets : [];
      _drawPage();
    }).catch(function (err) {
      console.error('[portfolio/groups] fetch failed:', err);
      container.innerHTML = '<div class="pf-empty">Failed to load groups. Please refresh.</div>';
    });
  }

  function _drawPage() {
    var sets = _currentSets;
    var codeLookup = buildBranchCodeLookup();
    var namedSets = sets.filter(function (s) { return s.id !== null; });
    var unassignedSet = sets.find(function (s) { return s.id === null; });

    var html = '<div class="ctx">'
      + '<h1>Groups</h1>'
      + '<span class="sub">organize locations the way your business is structured</span>'
      + '<button class="pf-refresh-btn gs-new-set-btn" data-action="new-set" style="margin-left:auto;">+ New group set</button>'
      + '</div>'
      + renderAnchorBand(sets);

    // Card grids: one per named set
    if (namedSets.length === 0) {
      html += '<div class="group-grid">'
        + '<div class="gcard add" data-action="new-set" style="cursor:pointer;min-height:80px;">+ New group set</div>'
        + '</div>';
    } else {
      namedSets.forEach(function (set) {
        html += '<div class="gs-cards-section">'
          + '<div class="gs-cards-label">' + esc(set.name) + '</div>'
          + renderGroupCards(set)
          + '</div>';
      });
    }

    // Panels
    sets.forEach(function (set, idx) {
      html += renderSetPanel(set, idx, codeLookup);
    });

    if (sets.length === 0) {
      html += '<div class="pf-empty">No group sets configured yet. Use "New group set" to get started.</div>';
    }

    _container.innerHTML = html;
    _bindContainerEvents();
  }

  function _refresh() {
    var url = '/api/portfolio/group-sets' + orgParam();
    apiFetch(url).then(function (sets) {
      _currentSets = Array.isArray(sets) ? sets : [];
      _drawPage();
    }).catch(function (err) {
      console.error('[portfolio/groups] refresh failed:', err);
    });
  }

  // ── Event delegation ──────────────────────────────────────────────────────
  function _bindContainerEvents() {
    if (!_container) return;
    _container.addEventListener('click', _onContainerClick);
  }

  function _onContainerClick(e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.getAttribute('data-action');
    var groupId = btn.getAttribute('data-group-id');
    var setId = btn.getAttribute('data-set-id');

    if (action === 'new-set') { showGroupSetForm(null); }
    else if (action === 'edit-set') { showGroupSetForm(setId); }
    else if (action === 'delete-set') { showDeleteSetConfirm(setId); }
    else if (action === 'new-group') { showGroupForm(null, setId); }
    else if (action === 'edit-group') { showGroupForm(groupId, null); }
    else if (action === 'delete-group') { showDeleteGroupConfirm(groupId); }
    else if (action === 'assign-members') { showLocationPicker(groupId); }

    // Remove listener after first delegation – _drawPage re-adds it
    _container.removeEventListener('click', _onContainerClick);
  }

  // ── Modal helpers ─────────────────────────────────────────────────────────
  function _getOrCreateOverlay() {
    var ov = document.getElementById('gs-modal-overlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'gs-modal-overlay';
      ov.className = 'gs-modal-overlay';
      document.body.appendChild(ov);
    }
    return ov;
  }

  function showModal(html) {
    var ov = _getOrCreateOverlay();
    ov.innerHTML = '<div class="gs-modal">' + html + '</div>';
    ov.style.display = 'flex';
    ov.onclick = function (e) { if (e.target === ov) closeModal(); };
    return ov;
  }

  function closeModal() {
    var ov = document.getElementById('gs-modal-overlay');
    if (ov) { ov.style.display = 'none'; ov.innerHTML = ''; }
  }

  function _modalError(msg) {
    var el = document.querySelector('#gs-modal-overlay .gs-form-error');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
  }

  // ── Colour picker HTML ────────────────────────────────────────────────────
  function renderColorPicker(currentColor) {
    var swatches = COLOR_PALETTE.map(function (c) {
      var active = currentColor && currentColor.toLowerCase() === c.toLowerCase();
      return '<button type="button" class="gs-swatch' + (active ? ' active' : '') + '" '
        + 'data-color="' + esc(c) + '" style="background:' + esc(c) + '" title="' + esc(c) + '"></button>';
    }).join('');

    return '<div class="gs-color-picker">'
      + '<div class="gs-swatches">' + swatches + '</div>'
      + '<div class="gs-color-custom">'
        + '<label>Custom hex</label>'
        + '<input type="text" class="gs-input gs-color-hex" placeholder="#3b82f6" maxlength="7" value="' + esc(currentColor || '') + '">'
        + '<span class="gs-color-preview" style="background:' + esc(currentColor || NEUTRAL) + '"></span>'
      + '</div>'
      + '</div>';
  }

  function _bindColorPicker(container) {
    var hexInput = container.querySelector('.gs-color-hex');
    var preview = container.querySelector('.gs-color-preview');
    var swatches = container.querySelectorAll('.gs-swatch');

    swatches.forEach(function (sw) {
      sw.addEventListener('click', function () {
        swatches.forEach(function (s) { s.classList.remove('active'); });
        sw.classList.add('active');
        hexInput.value = sw.getAttribute('data-color');
        preview.style.background = sw.getAttribute('data-color');
      });
    });

    if (hexInput) {
      hexInput.addEventListener('input', function () {
        var val = hexInput.value.trim();
        var m = /^#?([0-9a-f]{6})$/i.exec(val);
        if (m) {
          var hex = '#' + m[1];
          preview.style.background = hex;
          swatches.forEach(function (s) {
            s.classList.toggle('active', s.getAttribute('data-color').toLowerCase() === hex.toLowerCase());
          });
        }
      });
    }
  }

  function _getSelectedColor(container) {
    var hexInput = container.querySelector('.gs-color-hex');
    if (hexInput && hexInput.value.trim()) {
      var m = /^#?([0-9a-f]{6})$/i.exec(hexInput.value.trim());
      if (m) return '#' + m[1];
    }
    var active = container.querySelector('.gs-swatch.active');
    return active ? active.getAttribute('data-color') : null;
  }

  // ── Find group/set in current state ──────────────────────────────────────
  function _findGroup(groupId) {
    for (var i = 0; i < _currentSets.length; i++) {
      var groups = _currentSets[i].groups || [];
      for (var j = 0; j < groups.length; j++) {
        if (groups[j].id === groupId) return groups[j];
      }
    }
    return null;
  }

  function _findSet(setId) {
    for (var i = 0; i < _currentSets.length; i++) {
      if (_currentSets[i].id === setId) return _currentSets[i];
    }
    return null;
  }

  function _namedSets() {
    return _currentSets.filter(function (s) { return s.id !== null; });
  }

  // ── Group create / edit form ──────────────────────────────────────────────
  function showGroupForm(groupId, defaultSetId) {
    var group = groupId ? _findGroup(groupId) : null;
    var currentName = group ? group.name : '';
    var currentColor = group ? (group.color || '') : '';

    // Determine which set this group currently belongs to
    var currentSetId = null;
    if (group) {
      for (var i = 0; i < _currentSets.length; i++) {
        var found = (_currentSets[i].groups || []).find(function (g) { return g.id === groupId; });
        if (found && _currentSets[i].id !== null) { currentSetId = _currentSets[i].id; break; }
      }
    } else {
      currentSetId = defaultSetId || null;
    }

    var setOptions = _namedSets().map(function (s) {
      var sel = (s.id === currentSetId) ? ' selected' : '';
      return '<option value="' + esc(s.id) + '"' + sel + '>' + esc(s.name) + '</option>';
    }).join('');

    var title = group ? 'Edit Group' : 'New Group';
    var submitLabel = group ? 'Save changes' : 'Create group';

    var html = '<div class="gs-modal-header"><h3>' + title + '</h3><button type="button" class="gs-close-btn" id="gs-modal-close">✕</button></div>'
      + '<div class="gs-form-error" style="display:none"></div>'
      + '<form id="gs-group-form">'
        + '<label class="gs-label">Name</label>'
        + '<input class="gs-input" name="name" type="text" value="' + esc(currentName) + '" placeholder="e.g. North Metro" required autofocus>'
        + '<label class="gs-label" style="margin-top:14px;">Colour</label>'
        + renderColorPicker(currentColor)
        + (setOptions ? '<label class="gs-label" style="margin-top:14px;">Group set</label>'
            + '<select class="gs-input" name="setId"><option value="">— No set —</option>' + setOptions + '</select>' : '')
        + (group ? '<button type="button" class="gs-btn gs-btn-secondary" id="gs-assign-members-btn" data-group-id="' + esc(group.id) + '" style="margin-top:14px;width:100%;">Assign locations…</button>' : '')
        + '<div class="gs-form-footer">'
          + '<button type="button" class="gs-btn gs-btn-cancel" id="gs-cancel-btn">Cancel</button>'
          + '<button type="submit" class="gs-btn gs-btn-primary">' + submitLabel + '</button>'
        + '</div>'
      + '</form>';

    var ov = showModal(html);
    _bindColorPicker(ov);

    ov.querySelector('#gs-modal-close').onclick = closeModal;
    ov.querySelector('#gs-cancel-btn').onclick = closeModal;

    if (group) {
      var assignBtn = ov.querySelector('#gs-assign-members-btn');
      if (assignBtn) {
        assignBtn.onclick = function () {
          closeModal();
          showLocationPicker(group.id);
        };
      }
    }

    ov.querySelector('#gs-group-form').onsubmit = function (e) {
      e.preventDefault();
      var form = e.target;
      var name = form.name.value.trim();
      var color = _getSelectedColor(ov) || null;
      var setIdEl = form.elements['setId'];
      var setId = setIdEl ? (setIdEl.value || null) : (defaultSetId || null);
      if (!name) { _modalError('Name is required.'); return; }

      var submitBtn = form.querySelector('[type=submit]');
      submitBtn.disabled = true;

      var promise;
      if (group) {
        promise = apiMutate('PATCH', '/api/portfolio/groups/' + group.id, { name: name, color: color, setId: setId });
      } else {
        promise = apiMutate('POST', '/api/portfolio/groups', { name: name, color: color, setId: setId });
      }

      promise.then(function () {
        closeModal();
        _refresh();
      }).catch(function (err) {
        submitBtn.disabled = false;
        _modalError(err.message || 'Save failed. Please try again.');
      });
    };
  }

  // ── Group delete confirm ──────────────────────────────────────────────────
  function showDeleteGroupConfirm(groupId) {
    var group = _findGroup(groupId);
    if (!group) return;
    var count = Number(group.branchCount || 0);
    var locationNote = count > 0
      ? count + ' location' + (count === 1 ? '' : 's') + ' will become unassigned in this set (not deleted).'
      : 'This group has no locations.';

    var html = '<div class="gs-modal-header"><h3>Delete group?</h3><button type="button" class="gs-close-btn" id="gs-modal-close">✕</button></div>'
      + '<p class="gs-confirm-text">Delete <strong>' + esc(group.name) + '</strong>?</p>'
      + '<p class="gs-confirm-note">' + esc(locationNote) + '</p>'
      + '<div class="gs-form-footer">'
        + '<button type="button" class="gs-btn gs-btn-cancel" id="gs-cancel-btn">Cancel</button>'
        + '<button type="button" class="gs-btn gs-btn-danger" id="gs-confirm-del-btn">Delete</button>'
      + '</div>';

    var ov = showModal(html);
    ov.querySelector('#gs-modal-close').onclick = closeModal;
    ov.querySelector('#gs-cancel-btn').onclick = closeModal;
    ov.querySelector('#gs-confirm-del-btn').onclick = function () {
      this.disabled = true;
      apiMutate('DELETE', '/api/portfolio/groups/' + groupId, null)
        .then(function () { closeModal(); _refresh(); })
        .catch(function (err) { _modalError(err.message || 'Delete failed.'); });
    };
  }

  // ── Group set create / rename form ────────────────────────────────────────
  function showGroupSetForm(setId) {
    var set = setId ? _findSet(setId) : null;
    var currentName = set ? set.name : '';
    var title = set ? 'Rename Group Set' : 'New Group Set';
    var submitLabel = set ? 'Save changes' : 'Create group set';

    var html = '<div class="gs-modal-header"><h3>' + title + '</h3><button type="button" class="gs-close-btn" id="gs-modal-close">✕</button></div>'
      + '<div class="gs-form-error" style="display:none"></div>'
      + '<form id="gs-set-form">'
        + '<label class="gs-label">Name</label>'
        + '<input class="gs-input" name="name" type="text" value="' + esc(currentName) + '" placeholder="e.g. Regional Structure" required autofocus>'
        + '<div class="gs-form-footer">'
          + '<button type="button" class="gs-btn gs-btn-cancel" id="gs-cancel-btn">Cancel</button>'
          + '<button type="submit" class="gs-btn gs-btn-primary">' + submitLabel + '</button>'
        + '</div>'
      + '</form>';

    var ov = showModal(html);
    ov.querySelector('#gs-modal-close').onclick = closeModal;
    ov.querySelector('#gs-cancel-btn').onclick = closeModal;

    ov.querySelector('#gs-set-form').onsubmit = function (e) {
      e.preventDefault();
      var name = e.target.name.value.trim();
      if (!name) { _modalError('Name is required.'); return; }
      var submitBtn = e.target.querySelector('[type=submit]');
      submitBtn.disabled = true;

      var promise = set
        ? apiMutate('PATCH', '/api/portfolio/group-sets/' + set.id, { name: name })
        : apiMutate('POST', '/api/portfolio/group-sets', { name: name });

      promise.then(function () { closeModal(); _refresh(); })
        .catch(function (err) {
          submitBtn.disabled = false;
          _modalError(err.message || 'Save failed. Please try again.');
        });
    };
  }

  // ── Group set delete confirm ──────────────────────────────────────────────
  function showDeleteSetConfirm(setId) {
    var set = _findSet(setId);
    if (!set) return;
    var groupCount = (set.groups || []).length;
    var note = groupCount > 0
      ? groupCount + ' group' + (groupCount === 1 ? '' : 's') + ' will appear in an "Ungrouped" section — their locations are not deleted.'
      : 'This set has no groups.';

    var html = '<div class="gs-modal-header"><h3>Delete group set?</h3><button type="button" class="gs-close-btn" id="gs-modal-close">✕</button></div>'
      + '<p class="gs-confirm-text">Delete <strong>' + esc(set.name) + '</strong>?</p>'
      + '<p class="gs-confirm-note">' + esc(note) + '</p>'
      + '<div class="gs-form-footer">'
        + '<button type="button" class="gs-btn gs-btn-cancel" id="gs-cancel-btn">Cancel</button>'
        + '<button type="button" class="gs-btn gs-btn-danger" id="gs-confirm-del-btn">Delete set</button>'
      + '</div>';

    var ov = showModal(html);
    ov.querySelector('#gs-modal-close').onclick = closeModal;
    ov.querySelector('#gs-cancel-btn').onclick = closeModal;
    ov.querySelector('#gs-confirm-del-btn').onclick = function () {
      this.disabled = true;
      apiMutate('DELETE', '/api/portfolio/group-sets/' + setId, null)
        .then(function () { closeModal(); _refresh(); })
        .catch(function (err) { _modalError(err.message || 'Delete failed.'); });
    };
  }

  // ── Location picker modal ─────────────────────────────────────────────────
  function showLocationPicker(groupId) {
    var group = _findGroup(groupId);
    if (!group) return;
    var branches = allBranches();

    // Build a map: branchId → sibling group name (same set, different group)
    // so we can warn the user about moves.
    var siblingMap = {};  // branchId → { groupName }
    // Find which set this group is in
    var groupSetId = null;
    for (var i = 0; i < _currentSets.length; i++) {
      var setGroups = _currentSets[i].groups || [];
      for (var j = 0; j < setGroups.length; j++) {
        if (setGroups[j].id === groupId) {
          groupSetId = _currentSets[i].id;
          break;
        }
      }
      if (groupSetId) break;
    }

    if (groupSetId) {
      var setGroups = (_findSet(groupSetId) || {}).groups || [];
      setGroups.forEach(function (sg) {
        if (sg.id === groupId) return;  // skip self
        (sg.branchIds || []).forEach(function (bid) {
          siblingMap[bid] = sg.name;
        });
      });
    }

    var currentIds = new Set(group.branchIds || []);

    if (branches.length === 0) {
      var html0 = '<div class="gs-modal-header"><h3>Assign locations</h3><button type="button" class="gs-close-btn" id="gs-modal-close">✕</button></div>'
        + '<p class="gs-confirm-note">No locations found in your portfolio.</p>'
        + '<div class="gs-form-footer"><button type="button" class="gs-btn gs-btn-cancel" id="gs-cancel-btn">Close</button></div>';
      var ov0 = showModal(html0);
      ov0.querySelector('#gs-modal-close').onclick = closeModal;
      ov0.querySelector('#gs-cancel-btn').onclick = closeModal;
      return;
    }

    var items = branches.map(function (b) {
      var checked = currentIds.has(b.id) ? ' checked' : '';
      var sibName = siblingMap[b.id] || null;
      var note = sibName ? '<span class="gs-picker-sibling">currently in ' + esc(sibName) + '</span>' : '';
      return '<label class="gs-picker-item">'
        + '<input type="checkbox" class="gs-picker-cb" value="' + esc(b.id) + '"' + checked + '>'
        + '<span class="gs-picker-name">' + esc(b.name) + (b.code ? ' <span class="bcode">' + esc(b.code) + '</span>' : '') + '</span>'
        + note
        + '</label>';
    }).join('');

    var html = '<div class="gs-modal-header"><h3>Assign locations — ' + esc(group.name) + '</h3><button type="button" class="gs-close-btn" id="gs-modal-close">✕</button></div>'
      + '<div class="gs-form-error" style="display:none"></div>'
      + '<p class="gs-picker-hint">Check the locations that belong in this group. Locations marked "currently in …" will move out of that sibling group when you save.</p>'
      + '<div class="gs-picker-summary" id="gs-picker-summary"></div>'
      + '<div class="gs-picker-list" id="gs-picker-list">' + items + '</div>'
      + '<div class="gs-form-footer">'
        + '<button type="button" class="gs-btn gs-btn-cancel" id="gs-cancel-btn">Cancel</button>'
        + '<button type="button" class="gs-btn gs-btn-primary" id="gs-picker-save-btn">Save</button>'
      + '</div>';

    var ov = showModal(html);
    ov.querySelector('#gs-modal-close').onclick = closeModal;
    ov.querySelector('#gs-cancel-btn').onclick = closeModal;

    // Live summary
    function updateSummary() {
      var cbs = ov.querySelectorAll('.gs-picker-cb');
      var moveOut = {};
      cbs.forEach(function (cb) {
        var bid = cb.value;
        var wasIn = currentIds.has(bid);
        var nowIn = cb.checked;
        if (!wasIn && nowIn && siblingMap[bid]) {
          moveOut[siblingMap[bid]] = (moveOut[siblingMap[bid]] || 0) + 1;
        }
      });
      var lines = Object.keys(moveOut).map(function (gName) {
        var n = moveOut[gName];
        return n + ' location' + (n === 1 ? '' : 's') + ' will move out of ' + gName;
      });
      var sumEl = ov.querySelector('#gs-picker-summary');
      if (lines.length > 0) {
        sumEl.innerHTML = lines.map(function (l) { return '<span class="gs-move-warn">⚠ ' + esc(l) + '</span>'; }).join('');
        sumEl.style.display = 'block';
      } else {
        sumEl.style.display = 'none';
      }
    }

    ov.querySelector('#gs-picker-list').addEventListener('change', updateSummary);
    updateSummary();

    ov.querySelector('#gs-picker-save-btn').onclick = function () {
      var cbs = ov.querySelectorAll('.gs-picker-cb');
      var ids = [];
      cbs.forEach(function (cb) { if (cb.checked) ids.push(cb.value); });
      this.disabled = true;
      apiMutate('PUT', '/api/portfolio/groups/' + groupId + '/members', { communityIds: ids })
        .then(function () { closeModal(); _refresh(); })
        .catch(function (err) {
          ov.querySelector('#gs-picker-save-btn').disabled = false;
          _modalError(err.message || 'Save failed.');
        });
    };
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
