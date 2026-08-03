/**
 * work-orders.js — Branch Portfolio "Work Orders" page.
 * Registered as PortfolioRouter.register('work-orders', fn).
 *
 * Fetches GET /api/portfolio/work-orders and renders:
 *   • Pipeline band (Flagged by HP → Awaiting approval → Scheduled → Completed)
 *   • KPI row
 *   • Filter chips + search
 *   • Open Work Orders table (with Approve button for qualifying rows)
 *   • Recently Closed table
 *   • Lifecycle callout
 *   • + Submit Request modal
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

  function apiFetch(path, opts) {
    return fetch(path, Object.assign({ credentials: 'same-origin' }, opts || {})).then(function (r) {
      if (!r.ok) return r.json().then(function (body) { throw Object.assign(new Error(body.error || ('HTTP ' + r.status)), { status: r.status, body: body }); });
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

  function fmtCents(cents) {
    if (cents == null) return '—';
    return '$' + (Number(cents) / 100).toFixed(2);
  }

  // ── Status chip ────────────────────────────────────────────────────────────
  function statusChip(task) {
    var s = task.status;
    if (task.estimateCents != null && !task.approvedAt) {
      return '<span class="gchip g2">Awaiting approval</span>';
    }
    if (s === 'completed') return '<span class="gchip g3">Completed</span>';
    if (s === 'in_progress') return '<span class="gchip g1">In progress</span>';
    if (s === 'pending') return '<span class="gchip g1">Pending</span>';
    return '<span class="gchip">' + esc(s) + '</span>';
  }

  // ── Filter / search helpers ────────────────────────────────────────────────
  var _data = null;     // full API response
  var _filter = 'open'; // active chip
  var _search = '';     // search text

  function applyFilter(open, closed) {
    var all = open.concat(closed.map(function (t) { return Object.assign({ _closed: true }, t); }));
    var filtered;
    if (_filter === 'open') {
      filtered = open;
    } else if (_filter === 'awaiting') {
      filtered = open.filter(function (t) { return t.estimateCents != null && !t.approvedAt; });
    } else if (_filter === 'scheduled') {
      filtered = open.filter(function (t) { return t.status === 'pending' || t.status === 'in_progress'; });
    } else if (_filter === 'closed') {
      filtered = closed.map(function (t) { return Object.assign({ _closed: true }, t); });
    } else {
      filtered = all;
    }

    if (_search) {
      var q = _search.toLowerCase();
      filtered = filtered.filter(function (t) {
        return (t.title || '').toLowerCase().indexOf(q) !== -1
          || (t.ref || '').toLowerCase().indexOf(q) !== -1
          || (t.branchName || '').toLowerCase().indexOf(q) !== -1
          || (t.branchCode || '').toLowerCase().indexOf(q) !== -1
          || (t.source || '').toLowerCase().indexOf(q) !== -1;
      });
    }
    return filtered;
  }

  // ── Pipeline band ──────────────────────────────────────────────────────────
  function renderPipeline(pipeline, open, closed) {
    var p = pipeline || {};
    var flagged   = Number(p.flaggedByHp       || 0);
    var awaiting  = Number(p.awaitingApproval  || 0);
    var scheduled = Number(p.scheduled         || 0);
    var comp30    = Number(p.completed30d      || 0);
    var totalOpen = (open || []).length;

    return '<div class="anchor">'
      + '<div class="a-title">'
        + '<div class="a-label">Work Order Pipeline</div>'
        + '<div class="a-main">' + esc(totalOpen) + ' open · ' + esc(comp30) + ' closed in 30 days</div>'
      + '</div>'
      + '<div class="a-mid">'
        + '<div class="flow">'
          + '<div class="flow-step"><b>' + esc(flagged) + '</b>Flagged by HP</div>'
          + '<span class="flow-arrow">→</span>'
          + '<div class="flow-step hot"><b>' + esc(awaiting) + '</b>Awaiting approval</div>'
          + '<span class="flow-arrow">→</span>'
          + '<div class="flow-step"><b>' + esc(scheduled) + '</b>Scheduled</div>'
          + '<span class="flow-arrow">→</span>'
          + '<div class="flow-step ok"><b>' + esc(comp30) + '</b>Completed</div>'
        + '</div>'
      + '</div>'
      + '</div>';
  }

  // ── KPI row ────────────────────────────────────────────────────────────────
  function renderKpiRow(pipeline, open) {
    var p = pipeline || {};
    var awaiting  = Number(p.awaitingApproval || 0);
    var scheduled = Number(p.scheduled        || 0);
    var flagged   = Number(p.flaggedByHp      || 0);
    var comp30    = Number(p.completed30d     || 0);

    function kpi(label, value, sub, color) {
      return '<div class="kpi ' + color + '">'
        + '<div class="k-label">' + esc(label) + '</div>'
        + '<div class="k-value">' + esc(value) + '</div>'
        + '<div class="k-sub">' + esc(sub) + '</div>'
        + '</div>';
    }

    return '<div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">'
      + kpi('Awaiting Your Approval', awaiting, 'estimate provided, pending approval', 'amber')
      + kpi('Scheduled', scheduled, 'crew visit booked', 'blue')
      + kpi('Flagged by HP', flagged, 'crews identified in the field', 'navy')
      + kpi('Closed (30d)', comp30, 'completed last 30 days', 'green')
      + '</div>';
  }

  // ── Filter chip row ────────────────────────────────────────────────────────
  function renderFilterChips(pipeline, open, closed) {
    var p = pipeline || {};
    var chips = [
      { key: 'open',     label: 'Open (' + (open || []).length + ')' },
      { key: 'awaiting', label: 'Awaiting approval (' + (p.awaitingApproval || 0) + ')' },
      { key: 'scheduled',label: 'Scheduled (' + (p.scheduled || 0) + ')' },
      { key: 'closed',   label: 'Closed (' + (closed || []).length + ')' },
    ];

    var chipsHtml = chips.map(function (c) {
      return '<span class="fchip' + (_filter === c.key ? ' on' : '') + '" data-filter="' + esc(c.key) + '">'
        + esc(c.label) + '</span>';
    }).join('');

    return '<div class="filter-bar" id="wo-filter-bar">'
      + chipsHtml
      + '<input class="search-inp" id="wo-search" placeholder="Search work orders…" value="' + esc(_search) + '">'
      + '</div>';
  }

  // ── Open Work Orders table ─────────────────────────────────────────────────
  function renderOpenTable(rows) {
    var header = '<div class="panel p-amber">'
      + '<div class="panel-head"><h2>Open Work Orders</h2>'
      + '<span class="hint">flagged by HP or submitted by client</span></div>'
      + '<table>'
      + '<colgroup><col style="width:130px"><col style="width:150px"><col><col style="width:160px">'
      + '<col style="width:100px"><col style="width:150px"><col style="width:110px"></colgroup>'
      + '<thead><tr>'
      + '<th>Work Order</th><th>Branch</th><th>Item</th><th>Source</th>'
      + '<th>Opened</th><th>Status</th><th class="num">Estimate</th>'
      + '</tr></thead><tbody>';

    var body;
    if (rows.length === 0) {
      body = '<tr><td colspan="7" style="text-align:center;color:var(--gray-400);padding:24px;">No open work orders.</td></tr>';
    } else {
      body = rows.map(function (t) {
        var photoBadge = t.photoCount > 0
          ? ' · <span class="sr-photos">📷 ' + esc(t.photoCount) + '</span>'
          : '';
        var approveBtn = (t.estimateCents != null && !t.approvedAt)
          ? ' <button class="ghost-btn approve-btn" data-task-id="' + esc(t.id) + '" data-task-ref="' + esc(t.ref) + '" data-branch="' + esc(t.branchName) + '" data-title="' + esc(t.title) + '" data-est="' + esc(t.estimateCents) + '" style="font-size:11.5px;padding:4px 12px;">Approve</button>'
          : '';

        return '<tr class="clickable" data-community-id="' + esc(t.communityId) + '">'
          + '<td class="sr-ref">' + esc(t.ref) + '</td>'
          + '<td><span class="bcode">' + esc(t.branchCode || '—') + '</span>'
          + (t.branchName ? '<div class="bsub">' + esc(t.branchName) + '</div>' : '') + '</td>'
          + '<td><div class="bname">' + esc(t.title) + '</div>'
          + (t.description ? '<div class="bsub">' + esc(t.description.slice(0, 80)) + '</div>' : '')
          + photoBadge + '</td>'
          + '<td class="bsub">' + esc(t.source) + '</td>'
          + '<td class="bsub">' + esc(fmtDate(t.createdAt)) + '<div class="bsub">' + esc(t.daysOpen) + ' days open</div></td>'
          + '<td>' + statusChip(t) + '</td>'
          + '<td class="num">' + esc(fmtCents(t.estimateCents)) + approveBtn + '</td>'
          + '</tr>';
      }).join('');
    }

    return header + body + '</tbody></table></div>';
  }

  // ── Recently Closed table ──────────────────────────────────────────────────
  function renderClosedTable(rows) {
    var header = '<div class="panel p-green">'
      + '<div class="panel-head"><h2>Recently Closed</h2>'
      + '<span class="view-all">Service history →</span></div>'
      + '<table>'
      + '<colgroup><col style="width:130px"><col style="width:100px"><col>'
      + '<col style="width:100px"><col style="width:100px"><col style="width:100px"></colgroup>'
      + '<thead><tr>'
      + '<th>Work Order</th><th>Branch</th><th>Item</th>'
      + '<th>Opened</th><th>Closed</th><th class="num">Days Open</th>'
      + '</tr></thead><tbody>';

    var body;
    if (rows.length === 0) {
      body = '<tr><td colspan="6" style="text-align:center;color:var(--gray-400);padding:24px;">No closed work orders in the last 30 days.</td></tr>';
    } else {
      body = rows.map(function (t) {
        return '<tr class="clickable" data-community-id="' + esc(t.communityId) + '">'
          + '<td class="sr-ref">' + esc(t.ref) + '</td>'
          + '<td><span class="bcode">' + esc(t.branchCode || '—') + '</span></td>'
          + '<td><div class="bname">' + esc(t.title) + '</div>'
          + (t.photoCount > 0 ? '<div class="bsub">📷 ' + esc(t.photoCount) + ' photos</div>' : '') + '</td>'
          + '<td class="bsub">' + esc(fmtDate(t.createdAt)) + '</td>'
          + '<td class="bsub">' + esc(fmtDate(t.completedAt)) + '</td>'
          + '<td class="num">' + esc(t.daysOpen) + '</td>'
          + '</tr>';
      }).join('');
    }

    return header + body + '</tbody></table></div>';
  }

  // ── Lifecycle callout ──────────────────────────────────────────────────────
  function renderCallout() {
    return '<div class="bill-callout">'
      + '<div><b>Every work order closes into the permanent record.</b> '
      + 'Flagged → approved → scheduled → completed with photos → billed. '
      + 'Nothing gets lost between the field and the bill.</div>'
      + '</div>';
  }

  // ── Submit Request modal ───────────────────────────────────────────────────
  function renderSubmitModal() {
    var branches = (window.PortfolioState && window.PortfolioState.branches) || [];
    var branchOpts = branches.map(function (b) {
      return '<option value="' + esc(b.id) + '">' + esc(b.code ? b.code + ' — ' : '') + esc(b.name) + '</option>';
    }).join('');

    return '<div id="wo-modal-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:200;display:flex;align-items:center;justify-content:center;">'
      + '<div style="background:#fff;border-radius:12px;width:560px;max-width:96vw;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(12,29,49,0.28);">'
      + '  <div style="background:linear-gradient(135deg,var(--navy) 0%,var(--navy-light) 100%);color:#fff;padding:18px 22px;border-radius:12px 12px 0 0;display:flex;align-items:center;justify-content:space-between;">'
      + '    <div style="font-family:Outfit,sans-serif;font-size:17px;font-weight:700;">Submit Service Request</div>'
      + '    <button id="wo-modal-close" style="background:none;border:none;color:rgba(255,255,255,0.7);font-size:22px;cursor:pointer;line-height:1;">&times;</button>'
      + '  </div>'
      + '  <div style="padding:22px 24px;">'
      + '    <div id="wo-modal-error" style="display:none;background:var(--red-light);color:var(--red);border-radius:6px;padding:9px 14px;font-size:13px;margin-bottom:14px;"></div>'
      + '    <div style="margin-bottom:14px;">'
      + '      <label style="display:block;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--gray-500);margin-bottom:5px;">Branch *</label>'
      + '      <select id="wo-branch" style="width:100%;border:1px solid var(--gray-200);border-radius:6px;padding:9px 12px;font-size:13.5px;font-family:inherit;">'
      + '        <option value="">— Select a branch —</option>'
      + branchOpts
      + '      </select>'
      + '      <div id="wo-branch-err" style="display:none;color:var(--red);font-size:12px;margin-top:4px;"></div>'
      + '    </div>'
      + '    <div style="margin-bottom:14px;">'
      + '      <label style="display:block;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--gray-500);margin-bottom:5px;">Title *</label>'
      + '      <input id="wo-title" type="text" placeholder="Brief description of the issue" style="width:100%;border:1px solid var(--gray-200);border-radius:6px;padding:9px 12px;font-size:13.5px;font-family:inherit;">'
      + '      <div id="wo-title-err" style="display:none;color:var(--red);font-size:12px;margin-top:4px;"></div>'
      + '    </div>'
      + '    <div style="margin-bottom:14px;">'
      + '      <label style="display:block;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--gray-500);margin-bottom:5px;">Description (optional)</label>'
      + '      <textarea id="wo-desc" rows="3" placeholder="More detail about the issue…" style="width:100%;border:1px solid var(--gray-200);border-radius:6px;padding:9px 12px;font-size:13.5px;font-family:inherit;resize:vertical;"></textarea>'
      + '    </div>'
      + '    <div style="margin-bottom:22px;">'
      + '      <label style="display:block;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--gray-500);margin-bottom:5px;">Photos (optional)</label>'
      + '      <div id="wo-photos-list" style="display:flex;flex-wrap:wrap;gap:8px;min-height:36px;"></div>'
      + '      <button id="wo-photo-btn" type="button" style="margin-top:8px;background:var(--gray-100);border:1px dashed var(--gray-300);color:var(--gray-600);border-radius:6px;padding:7px 16px;font-size:12.5px;cursor:pointer;font-family:inherit;">📎 Attach photo</button>'
      + '      <input type="file" id="wo-file-input" accept="image/*" style="display:none;">'
      + '    </div>'
      + '    <div style="display:flex;gap:10px;justify-content:flex-end;">'
      + '      <button id="wo-modal-cancel" style="background:var(--gray-100);border:1px solid var(--gray-200);color:var(--gray-600);border-radius:999px;padding:9px 22px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">Cancel</button>'
      + '      <button id="wo-modal-submit" style="background:var(--navy);color:#fff;border:none;border-radius:999px;padding:9px 26px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;">Submit Request</button>'
      + '    </div>'
      + '  </div>'
      + '</div>'
      + '</div>';
  }

  // ── Approve confirm dialog ─────────────────────────────────────────────────
  function renderApproveDialog(taskId, ref, branch, title, estCents) {
    var existing = document.getElementById('wo-approve-dialog');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'wo-approve-dialog';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:300;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = '<div style="background:#fff;border-radius:12px;width:440px;max-width:92vw;box-shadow:0 20px 60px rgba(12,29,49,0.28);overflow:hidden;">'
      + '<div style="background:linear-gradient(135deg,#92400e 0%,#f59e0b 100%);color:#fff;padding:16px 20px;">'
      + '  <div style="font-family:Outfit,sans-serif;font-size:16px;font-weight:700;">Approve Estimate</div>'
      + '</div>'
      + '<div style="padding:20px 22px;">'
      + '  <p style="font-size:13.5px;color:var(--gray-700);margin-bottom:14px;">'
      + 'Approve the estimate for this work order?</p>'
      + '  <div style="background:var(--gray-50);border-radius:8px;padding:12px 16px;font-size:13px;margin-bottom:18px;">'
      + '    <div><span style="color:var(--gray-500);font-size:11.5px;">Work Order</span> <b>' + esc(ref) + '</b></div>'
      + '    <div style="margin-top:4px;"><span style="color:var(--gray-500);font-size:11.5px;">Branch</span> ' + esc(branch) + '</div>'
      + '    <div style="margin-top:4px;font-size:13px;">' + esc(title) + '</div>'
      + '    <div style="margin-top:8px;font-size:15px;font-weight:700;color:var(--navy);">' + esc(fmtCents(Number(estCents))) + '</div>'
      + '  </div>'
      + '  <div id="wo-approve-err" style="display:none;background:var(--red-light);color:var(--red);border-radius:6px;padding:8px 12px;font-size:12.5px;margin-bottom:14px;"></div>'
      + '  <div style="display:flex;gap:10px;justify-content:flex-end;">'
      + '    <button id="wo-approve-cancel" style="background:var(--gray-100);border:1px solid var(--gray-200);color:var(--gray-600);border-radius:999px;padding:8px 20px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">Cancel</button>'
      + '    <button id="wo-approve-confirm" style="background:var(--amber);color:var(--navy);border:none;border-radius:999px;padding:8px 22px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;">Confirm Approval</button>'
      + '  </div>'
      + '</div>'
      + '</div>';

    document.body.appendChild(overlay);

    overlay.querySelector('#wo-approve-cancel').addEventListener('click', function () { overlay.remove(); });

    overlay.querySelector('#wo-approve-confirm').addEventListener('click', function () {
      var confirmBtn = overlay.querySelector('#wo-approve-confirm');
      var errEl      = overlay.querySelector('#wo-approve-err');
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Approving…';

      var suffix = orgParam();
      var url = '/api/portfolio/work-orders/' + encodeURIComponent(taskId) + '/approve' + suffix;

      apiFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        .then(function () {
          overlay.remove();
          showToast('Work order approved');
          // Reload page data
          if (window._woRefreshPage) window._woRefreshPage();
        })
        .catch(function (err) {
          errEl.textContent = err.message || 'Failed to approve. Please try again.';
          errEl.style.display = 'block';
          confirmBtn.disabled = false;
          confirmBtn.textContent = 'Confirm Approval';
        });
    });
  }

  // ── Toast notification ─────────────────────────────────────────────────────
  function showToast(msg) {
    var t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;bottom:24px;right:24px;background:var(--navy);color:#fff;border-radius:999px;padding:10px 20px;font-size:13px;font-weight:600;z-index:400;box-shadow:0 4px 14px rgba(12,29,49,0.28);';
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 3500);
  }

  // ── Upload helper ──────────────────────────────────────────────────────────
  var _uploadedKeys = [];

  function handleFileUpload(file, onDone) {
    apiFetch('/api/objects/upload', { method: 'POST' })
      .then(function (res) {
        var uploadURL = res.uploadURL;
        return fetch(uploadURL, { method: 'PUT', body: file }).then(function (r) {
          if (!r.ok) throw new Error('Upload failed');
          return apiFetch('/api/objects/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uploadURL: uploadURL }),
          });
        });
      })
      .then(function (res) {
        onDone(null, res.objectPath);
      })
      .catch(function (err) {
        onDone(err, null);
      });
  }

  // ── Wire modal events ──────────────────────────────────────────────────────
  function wireModal(container) {
    var overlay  = document.getElementById('wo-modal-overlay');
    var closeBtn = document.getElementById('wo-modal-close');
    var cancelBtn= document.getElementById('wo-modal-cancel');
    var submitBtn= document.getElementById('wo-modal-submit');
    var photoBtn = document.getElementById('wo-photo-btn');
    var fileInput= document.getElementById('wo-file-input');
    var photoList= document.getElementById('wo-photos-list');

    _uploadedKeys = [];

    function closeModal() {
      overlay.style.display = 'none';
      _uploadedKeys = [];
      if (photoList) photoList.innerHTML = '';
      ['wo-branch','wo-title','wo-desc'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.value = '';
      });
    }

    document.getElementById('wo-open-modal').addEventListener('click', function () {
      overlay.style.display = 'flex';
    });

    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });

    photoBtn.addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      fileInput.value = '';
      var chip = document.createElement('div');
      chip.style.cssText = 'display:inline-flex;align-items:center;gap:6px;background:var(--teal-light);color:var(--teal-dark);border-radius:4px;padding:3px 10px;font-size:12px;font-weight:600;';
      chip.innerHTML = '⟳ Uploading…';
      photoList.appendChild(chip);

      handleFileUpload(file, function (err, key) {
        if (err) {
          chip.style.background = 'var(--red-light)';
          chip.style.color = 'var(--red)';
          chip.innerHTML = '✕ Upload failed';
          setTimeout(function () { chip.remove(); }, 2500);
        } else {
          _uploadedKeys.push(key);
          chip.innerHTML = '📷 ' + esc(file.name.slice(0, 24)) + ' <span style="cursor:pointer;opacity:0.6;" data-key="' + esc(key) + '">✕</span>';
          chip.querySelector('span').addEventListener('click', function (e) {
            var k = e.target.getAttribute('data-key');
            _uploadedKeys = _uploadedKeys.filter(function (x) { return x !== k; });
            chip.remove();
          });
        }
      });
    });

    submitBtn.addEventListener('click', function () {
      // Clear inline errors
      ['wo-branch-err','wo-title-err'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });
      document.getElementById('wo-modal-error').style.display = 'none';

      var branchEl = document.getElementById('wo-branch');
      var titleEl  = document.getElementById('wo-title');
      var descEl   = document.getElementById('wo-desc');

      var valid = true;
      if (!branchEl.value) {
        var be = document.getElementById('wo-branch-err');
        be.textContent = 'Please select a branch.';
        be.style.display = 'block';
        valid = false;
      }
      if (!titleEl.value.trim()) {
        var te = document.getElementById('wo-title-err');
        te.textContent = 'Title is required.';
        te.style.display = 'block';
        valid = false;
      }
      if (!valid) return;

      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting…';

      var suffix = orgParam();
      var url = '/api/portfolio/work-orders' + (suffix || '');
      var payload = {
        communityId: branchEl.value,
        title: titleEl.value.trim(),
        description: descEl.value.trim() || undefined,
        objectKeys: _uploadedKeys.length > 0 ? _uploadedKeys : undefined,
      };

      apiFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
        .then(function (newTask) {
          closeModal();
          showToast('Request submitted');
          // Prepend to open table without full reload
          if (_data) {
            _data.open.unshift(newTask);
            if (_data.pipeline) {
              _data.pipeline.flaggedByHp = (_data.pipeline.flaggedByHp || 0); // HP flag unchanged
            }
            renderPage(container, _data);
          } else {
            if (window._woRefreshPage) window._woRefreshPage();
          }
        })
        .catch(function (err) {
          var errEl = document.getElementById('wo-modal-error');
          errEl.textContent = err.message || 'Failed to submit. Please try again.';
          errEl.style.display = 'block';
          submitBtn.disabled = false;
          submitBtn.textContent = 'Submit Request';
        });
    });
  }

  // ── Wire filter + search events ────────────────────────────────────────────
  function wireFilters(container) {
    var bar = document.getElementById('wo-filter-bar');
    if (bar) {
      bar.querySelectorAll('.fchip[data-filter]').forEach(function (chip) {
        chip.addEventListener('click', function () {
          _filter = chip.getAttribute('data-filter');
          renderPage(container, _data);
        });
      });
    }
    var searchEl = document.getElementById('wo-search');
    if (searchEl) {
      searchEl.addEventListener('input', function () {
        _search = searchEl.value;
        renderPage(container, _data);
      });
    }
  }

  // ── Wire table row clicks ──────────────────────────────────────────────────
  function wireTableRows(container) {
    container.querySelectorAll('tr.clickable[data-community-id]').forEach(function (row) {
      row.addEventListener('click', function (e) {
        // Don't trigger if clicking an approve button
        if (e.target.closest('.approve-btn')) return;
        var cid = row.getAttribute('data-community-id');
        if (cid && window.PortfolioRouter) {
          var branches = (window.PortfolioState && window.PortfolioState.branches) || [];
          var branch = branches.find(function (b) { return b.id === cid; });
          if (branch) {
            PortfolioRouter.navigate('branch-detail', true, { id: branch.id });
          }
        }
      });
    });

    // Approve buttons
    container.querySelectorAll('.approve-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        renderApproveDialog(
          btn.getAttribute('data-task-id'),
          btn.getAttribute('data-task-ref'),
          btn.getAttribute('data-branch'),
          btn.getAttribute('data-title'),
          btn.getAttribute('data-est')
        );
      });
    });
  }

  // ── Full page render ───────────────────────────────────────────────────────
  function renderPage(container, data) {
    var open   = Array.isArray(data.open)   ? data.open   : [];
    var closed = Array.isArray(data.closed) ? data.closed : [];
    var pipeline = data.pipeline || {};

    var filtered = applyFilter(open, closed);

    // Split filtered back into open / closed for separate tables
    var filteredOpen   = filtered.filter(function (t) { return !t._closed; });
    var filteredClosed = filtered.filter(function (t) { return t._closed; });

    var org   = (window.PortfolioState && window.PortfolioState.organization) || {};
    var html  = '<div class="ctx">'
      + '<h1>Work Orders</h1>'
      + '<span class="sub">Open items across all branches</span>'
      + '<button class="cmp-btn" id="wo-open-modal" style="margin-left:auto;">+ Submit Request</button>'
      + '</div>'
      + renderPipeline(pipeline, open, closed)
      + renderKpiRow(pipeline, open)
      + renderFilterChips(pipeline, open, closed)
      + renderOpenTable(filteredOpen)
      + renderClosedTable(filteredClosed)
      + renderCallout()
      + renderSubmitModal();

    container.innerHTML = html;

    wireFilters(container);
    wireTableRows(container);
    wireModal(container);

    // Expose refresh function for approve callback
    window._woRefreshPage = function () {
      var suffix = orgParam();
      apiFetch('/api/portfolio/work-orders' + (suffix || ''))
        .then(function (d) {
          _data = d;
          renderPage(container, _data);
        })
        .catch(function (err) {
          console.error('[work-orders] refresh failed:', err);
        });
    };
  }

  // ── Main render entry ──────────────────────────────────────────────────────
  function renderWorkOrders(container, _params) {
    var suffix = orgParam();
    var url = '/api/portfolio/work-orders' + (suffix || '');

    apiFetch(url)
      .then(function (data) {
        _data = data;

        // Empty portfolio: no open or closed work orders
        var open   = Array.isArray(data.open)   ? data.open   : [];
        var closed = Array.isArray(data.closed) ? data.closed : [];
        if (open.length === 0 && closed.length === 0) {
          container.innerHTML = '<div class="ctx"><h1>Work Orders</h1>'
            + '<span class="sub">Open items across all branches</span>'
            + '<button class="cmp-btn" id="wo-open-modal" style="margin-left:auto;">+ Submit Request</button>'
            + '</div>'
            + '<div class="pf-empty" style="text-align:center;padding:48px 0;">'
            + '<p style="font-size:15px;font-weight:600;color:var(--navy);">No work orders yet.</p>'
            + '<p style="color:var(--gray-500);font-size:13px;margin-top:6px;">Work orders appear when HP crews flag issues or you submit a service request.</p>'
            + '</div>'
            + renderSubmitModal();
          wireModal(container);
          return;
        }

        renderPage(container, data);
      })
      .catch(function (err) {
        console.error('[portfolio/work-orders] fetch failed:', err);
        container.innerHTML = '<div class="pf-empty">Failed to load work orders. Please refresh.</div>';
      });
  }

  // ── Register ───────────────────────────────────────────────────────────────
  if (window.PortfolioRouter) {
    PortfolioRouter.register('work-orders', renderWorkOrders);
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      if (window.PortfolioRouter) PortfolioRouter.register('work-orders', renderWorkOrders);
    });
  }
})();
