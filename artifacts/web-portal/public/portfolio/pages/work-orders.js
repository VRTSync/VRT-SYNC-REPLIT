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

  // ── Demo presentation flag ─────────────────────────────────────────────────
  // Set to false to hide opened/closed/days-open dates during demos where all
  // work orders share the same creation date.  Flip back to true once real
  // historical data has accumulated.
  var SHOW_WORK_ORDER_DATES = false;

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
    if (task.cancelledAt) return '<span class="gchip g-cancelled">Cancelled</span>';
    if (task.declinedAt)  return '<span class="gchip g-declined">Declined</span>';
    var s = task.status;
    if (task.estimateCents != null && !task.approvedAt && !task.declinedAt) {
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

  function applyFilter(open, closed, cancelled) {
    var cancelledArr = (cancelled || []).map(function (t) { return Object.assign({ _cancelled: true }, t); });
    var all = open.concat(closed.map(function (t) { return Object.assign({ _closed: true }, t); })).concat(cancelledArr);
    var filtered;
    if (_filter === 'open') {
      filtered = open;
    } else if (_filter === 'awaiting') {
      filtered = open.filter(function (t) { return t.estimateCents != null && !t.approvedAt && !t.declinedAt; });
    } else if (_filter === 'scheduled') {
      filtered = open.filter(function (t) { return t.status === 'pending' || t.status === 'in_progress'; });
    } else if (_filter === 'closed') {
      filtered = closed.map(function (t) { return Object.assign({ _closed: true }, t); });
    } else if (_filter === 'cancelled') {
      filtered = cancelledArr;
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
  function renderPipeline(pipeline, open, closed, cancelled) {
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
  function renderFilterChips(pipeline, open, closed, cancelled) {
    var p = pipeline || {};
    var chips = [
      { key: 'open',      label: 'Open (' + (open || []).length + ')' },
      { key: 'awaiting',  label: 'Awaiting approval (' + (p.awaitingApproval || 0) + ')' },
      { key: 'scheduled', label: 'Scheduled (' + (p.scheduled || 0) + ')' },
      { key: 'closed',    label: 'Closed (' + (closed || []).length + ')' },
      { key: 'cancelled', label: 'Cancelled (' + (cancelled || []).length + ')' },
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
    var colCount = SHOW_WORK_ORDER_DATES ? 7 : 6;
    var header = '<div class="panel p-amber">'
      + '<div class="panel-head"><h2>Open Work Orders</h2>'
      + '<span class="hint">flagged by HP or submitted by client</span></div>'
      + '<table>'
      + (SHOW_WORK_ORDER_DATES
          ? '<colgroup><col style="width:130px"><col style="width:150px"><col><col style="width:160px">'
            + '<col style="width:100px"><col style="width:150px"><col style="width:110px"></colgroup>'
          : '<colgroup><col style="width:130px"><col style="width:150px"><col><col style="width:160px">'
            + '<col style="width:150px"><col style="width:110px"></colgroup>')
      + '<thead><tr>'
      + '<th>Work Order</th><th>Branch</th><th>Item</th><th>Source</th>'
      + (SHOW_WORK_ORDER_DATES ? '<th>Opened</th>' : '')
      + '<th>Status</th><th class="num">Estimate</th>'
      + '</tr></thead><tbody>';

    var body;
    if (rows.length === 0) {
      body = '<tr><td colspan="' + colCount + '" style="text-align:center;color:var(--gray-400);padding:24px;">No open work orders.</td></tr>';
    } else {
      body = rows.map(function (t) {
        var photoBadge = t.photoCount > 0
          ? ' · <span class="sr-photos">📷 ' + esc(t.photoCount) + '</span>'
          : '';
        // Only show Approve button when there is an estimate and the task is not yet
        // approved, cancelled, or declined (both cancelled and declined are terminal).
        var approveBtn = (t.estimateCents != null && !t.approvedAt && !t.cancelledAt && !t.declinedAt)
          ? ' <button class="ghost-btn approve-btn" data-task-id="' + esc(t.id) + '" data-task-ref="' + esc(t.ref) + '" data-branch="' + esc(t.branchName) + '" data-title="' + esc(t.title) + '" data-est="' + esc(t.estimateCents) + '" style="font-size:11.5px;padding:4px 12px;">Approve</button>'
          : '';

        return '<tr class="clickable" data-community-id="' + esc(t.communityId) + '" data-task-id="' + esc(t.id) + '">'
          + '<td class="sr-ref">' + esc(t.ref) + '</td>'
          + '<td><span class="bcode">' + esc(t.branchCode || '—') + '</span>'
          + (t.branchName ? '<div class="bsub">' + esc(t.branchName) + '</div>' : '') + '</td>'
          + '<td><div class="bname">' + esc(t.title) + '</div>'
          + (t.description ? '<div class="bsub">' + esc(t.description.slice(0, 80)) + '</div>' : '')
          + photoBadge + '</td>'
          + '<td class="bsub">' + esc(t.source) + '</td>'
          + (SHOW_WORK_ORDER_DATES
              ? '<td class="bsub">' + esc(fmtDate(t.createdAt)) + '<div class="bsub">' + esc(t.daysOpen) + ' days open</div></td>'
              : '')
          + '<td>' + statusChip(t) + '</td>'
          + '<td class="num">' + esc(fmtCents(t.estimateCents)) + approveBtn + '</td>'
          + '</tr>';
      }).join('');
    }

    return header + body + '</tbody></table></div>';
  }

  // ── Recently Closed table ──────────────────────────────────────────────────
  function renderClosedTable(rows) {
    var colCount = SHOW_WORK_ORDER_DATES ? 6 : 3;
    var header = '<div class="panel p-green">'
      + '<div class="panel-head"><h2>Recently Closed</h2>'
      + '<span class="view-all">Service history →</span></div>'
      + '<table>'
      + (SHOW_WORK_ORDER_DATES
          ? '<colgroup><col style="width:130px"><col style="width:100px"><col>'
            + '<col style="width:100px"><col style="width:100px"><col style="width:100px"></colgroup>'
          : '<colgroup><col style="width:130px"><col style="width:100px"><col></colgroup>')
      + '<thead><tr>'
      + '<th>Work Order</th><th>Branch</th><th>Item</th>'
      + (SHOW_WORK_ORDER_DATES ? '<th>Opened</th><th>Closed</th><th class="num">Days Open</th>' : '')
      + '</tr></thead><tbody>';

    var body;
    if (rows.length === 0) {
      body = '<tr><td colspan="' + colCount + '" style="text-align:center;color:var(--gray-400);padding:24px;">No closed work orders in the last 30 days.</td></tr>';
    } else {
      body = rows.map(function (t) {
        return '<tr class="clickable" data-community-id="' + esc(t.communityId) + '" data-task-id="' + esc(t.id) + '">'
          + '<td class="sr-ref">' + esc(t.ref) + '</td>'
          + '<td><span class="bcode">' + esc(t.branchCode || '—') + '</span></td>'
          + '<td><div class="bname">' + esc(t.title) + '</div>'
          + (t.photoCount > 0 ? '<div class="bsub">📷 ' + esc(t.photoCount) + ' photos</div>' : '') + '</td>'
          + (SHOW_WORK_ORDER_DATES
              ? '<td class="bsub">' + esc(fmtDate(t.createdAt)) + '</td>'
                + '<td class="bsub">' + esc(fmtDate(t.completedAt)) + '</td>'
                + '<td class="num">' + esc(t.daysOpen) + '</td>'
              : '')
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
    container.querySelectorAll('tr.clickable[data-task-id]').forEach(function (row) {
      row.addEventListener('click', function (e) {
        // Don't trigger if clicking an approve button
        if (e.target.closest('.approve-btn')) return;
        var taskId = row.getAttribute('data-task-id');
        if (taskId) openDetailPanel(container, taskId);
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

  // ── Detail panel ───────────────────────────────────────────────────────────

  function openDetailPanel(container, taskId) {
    var suffix = orgParam();
    var url = '/api/portfolio/work-orders/' + encodeURIComponent(taskId) + (suffix || '');
    apiFetch(url)
      .then(function (detail) {
        var existing = document.getElementById('wo-detail-overlay');
        if (existing) existing.remove();
        var overlay = document.createElement('div');
        overlay.id = 'wo-detail-overlay';
        overlay.className = 'wo-detail-overlay';
        overlay.innerHTML = renderDetailPanel(detail);
        document.body.appendChild(overlay);
        // Force reflow then add visible class for CSS transition
        requestAnimationFrame(function () { overlay.classList.add('visible'); });
        wireDetailPanel(overlay, detail, container);
      })
      .catch(function (err) {
        console.error('[work-orders] detail fetch failed:', err);
        showToast('Failed to load work order details');
      });
  }

  function fmtDateTime(iso) {
    if (!iso) return '—';
    try {
      var d = new Date(iso);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    } catch (_) { return iso; }
  }

  function renderDetailPanel(d) {
    // ── Header status chip ──
    var chip = '';
    if (d.cancelledAt)        chip = '<span class="gchip g-cancelled">Cancelled</span>';
    else if (d.declinedAt)    chip = '<span class="gchip g-declined">Declined</span>';
    else if (d.approvedAt)    chip = '<span class="gchip g3">Approved</span>';
    else if (d.estimateCents != null) chip = '<span class="gchip g2">Awaiting approval</span>';
    else if (d.acknowledgedAt) chip = '<span class="gchip g1">In review</span>';
    else                       chip = '<span class="gchip g1">Submitted</span>';

    // ── Branch link ──
    var branchLink = '<a class="wo-detail-branch-link" href="#" data-community-id="' + esc(d.communityId) + '">'
      + (d.branchCode ? esc(d.branchCode) + ' · ' : '') + esc(d.branchName)
      + ' <span style="font-size:11px;opacity:0.7;">View Branch →</span></a>';

    // ── Estimate section ──
    var estHtml = '';
    if (d.estimateCents != null) {
      estHtml = '<div class="wo-detail-section">'
        + '<div class="wo-detail-section-title">Estimate</div>'
        + '<div class="wo-detail-est">' + esc(fmtCents(d.estimateCents)) + '</div>'
        + (d.approvedAt   ? '<div class="wo-detail-approved">✓ Approved ' + esc(fmtDate(d.approvedAt)) + '</div>' : '')
        + (d.declinedAt   ? '<div class="wo-detail-declined-note">✕ Declined — ' + esc(d.declineReason || '') + '</div>' : '')
        + '</div>';
    }

    // ── Map pin ──
    var mapHtml = '';
    if (d.latitude != null && d.longitude != null) {
      mapHtml = '<div class="wo-detail-section">'
        + '<div class="wo-detail-section-title">Location</div>'
        + '<div class="wo-detail-map-pin">📍 ' + esc(Number(d.latitude).toFixed(5)) + ', ' + esc(Number(d.longitude).toFixed(5)) + '</div>'
        + '</div>';
    }

    // ── Photos ──
    var photosHtml = '';
    if (d.attachments && d.attachments.length > 0) {
      photosHtml = '<div class="wo-detail-section">'
        + '<div class="wo-detail-section-title">Photos (' + esc(d.attachments.length) + ')</div>'
        + '<div class="wo-detail-photos">'
        + d.attachments.map(function (a) {
            // fileRef is already an /objects/... path — use it directly
            var src = a.fileRef.startsWith('/objects/') ? a.fileRef : '/objects/' + a.fileRef;
            return '<img class="wo-detail-photo" src="' + esc(src) + '" alt="attachment" data-url="' + esc(src) + '">';
          }).join('')
        + '</div></div>';
    }

    // ── Timeline ──
    var tlHtml = '';
    if (d.timeline && d.timeline.length > 0) {
      var eventLabels = { submitted: 'Submitted', acknowledged: 'Acknowledged by contractor',
        scheduled: 'Scheduled', approved: 'Estimate approved', declined: 'Estimate declined',
        cancelled: 'Cancelled', completed: 'Completed' };
      tlHtml = '<div class="wo-detail-section">'
        + '<div class="wo-detail-section-title">Timeline</div>'
        + '<div class="wo-detail-timeline">'
        + d.timeline.map(function (e) {
            return '<div class="tl-row">'
              + '<div class="tl-dot"></div>'
              + '<div class="tl-body">'
              + '<div class="tl-event">' + esc(eventLabels[e.event] || e.event)
              + (e.actor ? ' <span class="tl-actor">by ' + esc(e.actor) + '</span>' : '')
              + '</div>'
              + '<div class="tl-time">' + esc(fmtDateTime(e.timestamp)) + '</div>'
              + '</div></div>';
          }).join('')
        + '</div></div>';
    }

    // ── Comments ──
    var cmtHtml = '<div class="wo-detail-section" id="wo-detail-comments-section">'
      + '<div class="wo-detail-section-title">Comments</div>'
      + '<div class="wo-detail-comments" id="wo-detail-comments-list">'
      + (d.comments && d.comments.length > 0
          ? d.comments.map(function (c) {
              return '<div class="wo-comment">'
                + '<div class="wo-comment-meta"><b>' + esc(c.authorName || 'Unknown') + '</b> · ' + esc(fmtDateTime(c.createdAt)) + '</div>'
                + '<div class="wo-comment-body">' + esc(c.body) + '</div>'
                + '</div>';
            }).join('')
          : '<div class="wo-comment-empty">No comments yet.</div>')
      + '</div>'
      + '<div class="wo-detail-comment-form">'
      + '<textarea id="wo-detail-comment-input" class="wo-comment-input" placeholder="Add a comment…" rows="2"></textarea>'
      + '<div id="wo-detail-comment-err" class="wo-inline-err" style="display:none;"></div>'
      + '<button id="wo-detail-comment-submit" class="cmp-btn" style="margin-top:6px;" disabled>Post Comment</button>'
      + '</div></div>';

    // ── Action buttons ──
    var canEdit    = d.origin === 'client' && !d.acknowledgedAt && !d.cancelledAt;
    var canCancel  = d.origin === 'client' && !d.acknowledgedAt && !d.cancelledAt;
    var canApprove = d.estimateCents != null && !d.approvedAt && !d.declinedAt && !d.cancelledAt;
    var canDecline = d.estimateCents != null && !d.approvedAt && !d.declinedAt && !d.cancelledAt;

    var actionsHtml = '';
    if (canEdit || canCancel || canApprove || canDecline) {
      actionsHtml = '<div class="wo-detail-actions">';
      if (canEdit)    actionsHtml += '<button class="ghost-btn" id="wo-detail-edit-btn">Edit</button>';
      if (canDecline) actionsHtml += '<button class="ghost-btn wo-decline-btn" id="wo-detail-decline-btn" style="color:var(--red);">Decline Estimate</button>';
      if (canApprove) actionsHtml += '<button class="cmp-btn" id="wo-detail-approve-btn" data-task-id="' + esc(d.id) + '" data-task-ref="' + esc(d.ref) + '" data-branch="' + esc(d.branchName) + '" data-title="' + esc(d.title) + '" data-est="' + esc(d.estimateCents) + '">Approve Estimate</button>';
      if (canCancel)  actionsHtml += '<button class="ghost-btn" id="wo-detail-cancel-btn" style="color:var(--gray-500);">Cancel Request</button>';
      actionsHtml += '</div>';
    }

    // ── Cancel/Decline reason blocks (hidden until button clicked) ──
    var cancelFormHtml = canCancel ? (
      '<div id="wo-detail-cancel-form" class="wo-detail-reason-form" style="display:none;">'
      + '<div class="wo-detail-section-title">Cancel Request</div>'
      + '<textarea id="wo-detail-cancel-reason" class="wo-comment-input" placeholder="Reason for cancelling (required)…" rows="2"></textarea>'
      + '<div id="wo-detail-cancel-err" class="wo-inline-err" style="display:none;"></div>'
      + '<div style="display:flex;gap:8px;margin-top:6px;">'
      + '<button id="wo-detail-cancel-submit" class="ghost-btn" style="color:var(--red);" disabled>Confirm Cancel</button>'
      + '<button id="wo-detail-cancel-dismiss" class="ghost-btn">Never mind</button>'
      + '</div></div>'
    ) : '';

    var declineFormHtml = canDecline ? (
      '<div id="wo-detail-decline-form" class="wo-detail-reason-form" style="display:none;">'
      + '<div class="wo-detail-section-title">Decline Estimate</div>'
      + '<textarea id="wo-detail-decline-reason" class="wo-comment-input" placeholder="Reason for declining (required)…" rows="2"></textarea>'
      + '<div id="wo-detail-decline-err" class="wo-inline-err" style="display:none;"></div>'
      + '<div style="display:flex;gap:8px;margin-top:6px;">'
      + '<button id="wo-detail-decline-submit" class="ghost-btn" style="color:var(--red);" disabled>Confirm Decline</button>'
      + '<button id="wo-detail-decline-dismiss" class="ghost-btn">Never mind</button>'
      + '</div></div>'
    ) : '';

    // ── Edit form (hidden until Edit clicked) ──
    var editFormHtml = canEdit ? (
      '<div id="wo-detail-edit-form" class="wo-detail-reason-form" style="display:none;">'
      + '<div class="wo-detail-section-title">Edit Request</div>'
      + '<input id="wo-detail-edit-title" class="wo-detail-edit-input" type="text" value="' + esc(d.title) + '" placeholder="Title">'
      + '<textarea id="wo-detail-edit-desc" class="wo-comment-input" rows="3" placeholder="Description (optional)…">' + esc(d.description || '') + '</textarea>'
      + '<div class="wo-edit-photos-section" style="margin-top:10px;">'
      + '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--gray-400);margin-bottom:6px;">Add Photos</div>'
      + '<label class="wo-edit-photo-label ghost-btn" for="wo-detail-edit-photos" style="cursor:pointer;display:inline-block;">📷 Choose Photos…</label>'
      + '<input id="wo-detail-edit-photos" type="file" accept="image/*" multiple style="display:none;">'
      + '<div id="wo-detail-edit-photo-queue" class="wo-detail-photos" style="margin-top:8px;"></div>'
      + '</div>'
      + '<div id="wo-detail-edit-err" class="wo-inline-err" style="display:none;"></div>'
      + '<div style="display:flex;gap:8px;margin-top:6px;">'
      + '<button id="wo-detail-edit-submit" class="cmp-btn">Save Changes</button>'
      + '<button id="wo-detail-edit-dismiss" class="ghost-btn">Cancel</button>'
      + '</div></div>'
    ) : '';

    // ── Assemble ──
    return '<div class="wo-detail-panel">'
      + '<div class="wo-detail-header">'
      +   '<div>'
      +     '<div class="wo-detail-ref">' + esc(d.ref) + ' ' + chip + '</div>'
      +     '<h2 class="wo-detail-title">' + esc(d.title) + '</h2>'
      +     '<div class="wo-detail-meta">' + branchLink + ' · <span>' + esc(d.source) + '</span></div>'
      +   '</div>'
      +   '<button class="wo-detail-close" id="wo-detail-close">&times;</button>'
      + '</div>'
      + '<div class="wo-detail-body">'
      + (d.description ? '<div class="wo-detail-section"><div class="wo-detail-section-title">Description</div><p class="wo-detail-desc">' + esc(d.description) + '</p></div>' : '')
      + estHtml + mapHtml + photosHtml
      + actionsHtml + editFormHtml + cancelFormHtml + declineFormHtml
      + tlHtml + cmtHtml
      + '</div></div>';
  }

  function wireDetailPanel(overlay, detail, container) {
    var panel = overlay.querySelector('.wo-detail-panel');
    var suffix = orgParam();

    // ── Close ──
    document.getElementById('wo-detail-close').addEventListener('click', function () {
      overlay.classList.remove('visible');
      setTimeout(function () { overlay.remove(); }, 260);
    });
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) {
        overlay.classList.remove('visible');
        setTimeout(function () { overlay.remove(); }, 260);
      }
    });

    // ── Branch link ──
    var branchLink = overlay.querySelector('.wo-detail-branch-link');
    if (branchLink) {
      branchLink.addEventListener('click', function (e) {
        e.preventDefault();
        var cid = branchLink.getAttribute('data-community-id');
        overlay.remove();
        if (cid && window.PortfolioRouter) {
          var branches = (window.PortfolioState && window.PortfolioState.branches) || [];
          var branch = branches.find(function (b) { return b.id === cid; });
          if (branch) PortfolioRouter.navigate('branch-detail', true, { id: branch.id });
        }
      });
    }

    // ── Photo click-to-enlarge ──
    overlay.querySelectorAll('.wo-detail-photo').forEach(function (img) {
      img.addEventListener('click', function () {
        var lbk = document.createElement('div');
        lbk.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:600;display:flex;align-items:center;justify-content:center;cursor:zoom-out;';
        lbk.innerHTML = '<img src="' + esc(img.getAttribute('data-url')) + '" style="max-width:92vw;max-height:90vh;border-radius:6px;">';
        lbk.addEventListener('click', function () { lbk.remove(); });
        document.body.appendChild(lbk);
      });
    });

    // ── Comment input / submit ──
    var cmtInput  = document.getElementById('wo-detail-comment-input');
    var cmtSubmit = document.getElementById('wo-detail-comment-submit');
    var cmtErr    = document.getElementById('wo-detail-comment-err');
    if (cmtInput && cmtSubmit) {
      cmtInput.addEventListener('input', function () {
        cmtSubmit.disabled = cmtInput.value.trim().length === 0;
      });
      cmtSubmit.addEventListener('click', function () {
        var body = cmtInput.value.trim();
        if (!body) return;
        cmtSubmit.disabled = true;
        cmtSubmit.textContent = 'Posting…';
        cmtErr.style.display = 'none';
        var url = '/api/portfolio/work-orders/' + encodeURIComponent(detail.id) + '/comments' + (suffix || '');
        apiFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: body }) })
          .then(function (comment) {
            cmtInput.value = '';
            cmtSubmit.disabled = true;
            cmtSubmit.textContent = 'Post Comment';
            var list = document.getElementById('wo-detail-comments-list');
            var empty = list && list.querySelector('.wo-comment-empty');
            if (empty) empty.remove();
            var el = document.createElement('div');
            el.className = 'wo-comment';
            el.innerHTML = '<div class="wo-comment-meta"><b>' + esc(comment.authorName || 'You') + '</b> · ' + esc(fmtDateTime(comment.createdAt)) + '</div>'
              + '<div class="wo-comment-body">' + esc(comment.body) + '</div>';
            if (list) list.appendChild(el);
          })
          .catch(function (err) {
            cmtErr.textContent = err.message || 'Failed to post comment';
            cmtErr.style.display = 'block';
            cmtSubmit.disabled = false;
            cmtSubmit.textContent = 'Post Comment';
          });
      });
    }

    // ── Approve button (reuse existing dialog) ──
    var approveBtn = document.getElementById('wo-detail-approve-btn');
    if (approveBtn) {
      approveBtn.addEventListener('click', function () {
        renderApproveDialog(
          approveBtn.getAttribute('data-task-id'),
          approveBtn.getAttribute('data-task-ref'),
          approveBtn.getAttribute('data-branch'),
          approveBtn.getAttribute('data-title'),
          approveBtn.getAttribute('data-est')
        );
      });
    }

    // ── Edit form ──
    var editBtn = document.getElementById('wo-detail-edit-btn');
    if (editBtn) {
      editBtn.addEventListener('click', function () {
        document.getElementById('wo-detail-edit-form').style.display = 'block';
        editBtn.style.display = 'none';
      });
      document.getElementById('wo-detail-edit-dismiss').addEventListener('click', function () {
        document.getElementById('wo-detail-edit-form').style.display = 'none';
        editBtn.style.display = '';
      });
      // ── Photo file picker → preview ──
      var photoInput  = document.getElementById('wo-detail-edit-photos');
      var photoQueue  = document.getElementById('wo-detail-edit-photo-queue');
      var pendingFiles = []; // File objects to upload when Save is clicked
      if (photoInput) {
        photoInput.addEventListener('change', function () {
          var files = Array.from(photoInput.files || []);
          files.forEach(function (f) {
            pendingFiles.push(f);
            var img = document.createElement('img');
            img.className = 'wo-detail-photo';
            img.src = URL.createObjectURL(f);
            img.alt = f.name;
            img.style.cursor = 'default';
            photoQueue.appendChild(img);
          });
          photoInput.value = '';
        });
      }

      document.getElementById('wo-detail-edit-submit').addEventListener('click', function () {
        var titleEl  = document.getElementById('wo-detail-edit-title');
        var descEl   = document.getElementById('wo-detail-edit-desc');
        var errEl    = document.getElementById('wo-detail-edit-err');
        var submitEl = document.getElementById('wo-detail-edit-submit');
        errEl.style.display = 'none';
        if (!titleEl.value.trim()) {
          errEl.textContent = 'Title is required.';
          errEl.style.display = 'block';
          return;
        }
        submitEl.disabled = true;
        submitEl.textContent = 'Saving…';

        // Upload any pending photos first, then PATCH the task.
        // pendingFiles is NOT cleared until the full operation succeeds so the
        // user can retry with the same files if the save fails partway through.
        var uploadPhotoFiles = pendingFiles.slice();
        // confirmedKeys accumulates each objectPath as it is confirmed so that
        // on failure we can delete the orphaned private objects.
        var confirmedKeys = [];

        function uploadNext(remaining) {
          if (remaining.length === 0) return Promise.resolve();
          var file = remaining[0];
          var rest = remaining.slice(1);
          return apiFetch('/api/objects/upload', { method: 'POST' })
            .then(function (r) {
              return fetch(r.uploadURL, { method: 'PUT', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } })
                .then(function () {
                  return apiFetch('/api/objects/confirm', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ uploadURL: r.uploadURL }),
                  });
                })
                .then(function (c) { confirmedKeys.push(c.objectPath); return uploadNext(rest); });
            });
        }

        uploadNext(uploadPhotoFiles)
          .then(function () {
            var patchUrl = '/api/portfolio/work-orders/' + encodeURIComponent(detail.id) + (suffix || '');
            var photoUrl = '/api/portfolio/work-orders/' + encodeURIComponent(detail.id) + '/photos' + (suffix || '');
            // Run PATCH and photo attachment in sequence (photos need task to exist)
            return apiFetch(patchUrl, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ title: titleEl.value.trim(), description: descEl.value.trim() || null }) })
              .then(function () {
                if (confirmedKeys.length === 0) return;
                return apiFetch(photoUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ objectKeys: confirmedKeys }) });
              });
          })
          .then(function () {
            // Full success — clear the pending-file list and close the dialog
            pendingFiles = [];
            overlay.remove();
            showToast('Work order updated');
            if (window._woRefreshPage) window._woRefreshPage();
            openDetailPanel(container, detail.id);
          })
          .catch(function (err) {
            // Best-effort cleanup: delete any objects we already confirmed but
            // failed to attach, so they are not orphaned in private storage.
            // pendingFiles is intentionally NOT cleared here so the user can retry.
            if (confirmedKeys.length > 0) {
              apiFetch('/api/objects', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ objectPaths: confirmedKeys }),
              }).catch(function () { /* best-effort */ });
              confirmedKeys = [];
            }
            errEl.textContent = err.message || 'Failed to save changes.';
            errEl.style.display = 'block';
            submitEl.disabled = false;
            submitEl.textContent = 'Save Changes';
          });
      });
    }

    // ── Cancel form ──
    var cancelBtn = document.getElementById('wo-detail-cancel-btn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        document.getElementById('wo-detail-cancel-form').style.display = 'block';
        cancelBtn.style.display = 'none';
      });
      document.getElementById('wo-detail-cancel-dismiss').addEventListener('click', function () {
        document.getElementById('wo-detail-cancel-form').style.display = 'none';
        cancelBtn.style.display = '';
      });
      var cancelReason = document.getElementById('wo-detail-cancel-reason');
      var cancelSubmit = document.getElementById('wo-detail-cancel-submit');
      cancelReason.addEventListener('input', function () {
        cancelSubmit.disabled = cancelReason.value.trim().length === 0;
      });
      cancelSubmit.addEventListener('click', function () {
        var errEl = document.getElementById('wo-detail-cancel-err');
        errEl.style.display = 'none';
        cancelSubmit.disabled = true;
        cancelSubmit.textContent = 'Cancelling…';
        var url = '/api/portfolio/work-orders/' + encodeURIComponent(detail.id) + '/cancel' + (suffix || '');
        apiFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: cancelReason.value.trim() }) })
          .then(function () {
            overlay.remove();
            showToast('Work order cancelled');
            if (window._woRefreshPage) window._woRefreshPage();
          })
          .catch(function (err) {
            errEl.textContent = err.message || 'Failed to cancel.';
            errEl.style.display = 'block';
            cancelSubmit.disabled = false;
            cancelSubmit.textContent = 'Confirm Cancel';
          });
      });
    }

    // ── Decline form ──
    var declineBtn = document.getElementById('wo-detail-decline-btn');
    if (declineBtn) {
      declineBtn.addEventListener('click', function () {
        document.getElementById('wo-detail-decline-form').style.display = 'block';
        declineBtn.style.display = 'none';
      });
      document.getElementById('wo-detail-decline-dismiss').addEventListener('click', function () {
        document.getElementById('wo-detail-decline-form').style.display = 'none';
        declineBtn.style.display = '';
      });
      var declineReason = document.getElementById('wo-detail-decline-reason');
      var declineSubmit = document.getElementById('wo-detail-decline-submit');
      declineReason.addEventListener('input', function () {
        declineSubmit.disabled = declineReason.value.trim().length === 0;
      });
      declineSubmit.addEventListener('click', function () {
        var errEl = document.getElementById('wo-detail-decline-err');
        errEl.style.display = 'none';
        declineSubmit.disabled = true;
        declineSubmit.textContent = 'Declining…';
        var url = '/api/portfolio/work-orders/' + encodeURIComponent(detail.id) + '/decline' + (suffix || '');
        apiFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: declineReason.value.trim() }) })
          .then(function () {
            overlay.remove();
            showToast('Estimate declined');
            if (window._woRefreshPage) window._woRefreshPage();
          })
          .catch(function (err) {
            errEl.textContent = err.message || 'Failed to decline.';
            errEl.style.display = 'block';
            declineSubmit.disabled = false;
            declineSubmit.textContent = 'Confirm Decline';
          });
      });
    }
  }

  // ── Full page render ───────────────────────────────────────────────────────
  function renderPage(container, data) {
    var open      = Array.isArray(data.open)      ? data.open      : [];
    var closed    = Array.isArray(data.closed)    ? data.closed    : [];
    var cancelled = Array.isArray(data.cancelled) ? data.cancelled : [];
    var pipeline  = data.pipeline || {};

    var filtered = applyFilter(open, closed, cancelled);

    // Split filtered back into open / closed / cancelled for separate tables
    var filteredOpen      = filtered.filter(function (t) { return !t._closed && !t._cancelled; });
    var filteredClosed    = filtered.filter(function (t) { return t._closed; });
    var filteredCancelled = filtered.filter(function (t) { return t._cancelled; });

    // When showing cancelled filter use the open table renderer (shows status chip)
    var showCancelled = _filter === 'cancelled';

    var html  = '<div class="ctx">'
      + '<h1>Work Orders</h1>'
      + '<span class="sub">Open items across all branches</span>'
      + '<button class="cmp-btn" id="wo-open-modal" style="margin-left:auto;">+ Submit Request</button>'
      + '</div>'
      + renderPipeline(pipeline, open, closed, cancelled)
      + renderKpiRow(pipeline, open)
      + renderFilterChips(pipeline, open, closed, cancelled)
      + (showCancelled
          ? renderOpenTable(filteredCancelled)
          : renderOpenTable(filteredOpen) + renderClosedTable(filteredClosed))
      + renderCallout()
      + renderSubmitModal();

    container.innerHTML = html;

    wireFilters(container);
    wireTableRows(container);
    wireModal(container);

    // Expose refresh function for approve/cancel/decline callbacks
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
        var cancelled = Array.isArray(data.cancelled) ? data.cancelled : [];
        if (open.length === 0 && closed.length === 0 && cancelled.length === 0) {
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
