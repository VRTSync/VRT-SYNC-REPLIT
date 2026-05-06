PortalRouter.register('requests', async function (container) {
  var ctx = PortalState.getCommunityContext();
  var role = ctx.role;
  var community = ctx.activeCommunity;
  var M = PortalModules;
  var isAdmin = role === 'hoa_admin';

  if (window._portalRequestsCleanup) {
    window._portalRequestsCleanup();
  }

  if (!community) {
    container.innerHTML = '<div class="empty-state" style="margin-top:80px"><p>Select a community first.</p></div>';
    return;
  }

  var centerLat = (community && community.centerLat) ? community.centerLat : 39.5;
  var centerLng = (community && community.centerLng) ? community.centerLng : -104.9;
  var reqPinLat = centerLat;
  var reqPinLng = centerLng;

  container.innerHTML = '<div class="loading-spinner" style="margin-top:80px">Loading requests\u2026</div>';

  var requests = [];
  var fetchError = false;
  try {
    requests = await PortalAPI.apiFetch('/api/hoa/requests');
    if (!Array.isArray(requests)) requests = [];
  } catch (e) {
    console.error('Failed to fetch requests', e);
    fetchError = true;
  }

  if (fetchError) {
    container.innerHTML = M.pageHeader('Requests', community)
      + '<div class="portal-module" style="margin-top:16px"><div class="module-empty" style="color:var(--red)">'
      + 'Failed to load requests. <button class="module-view-all" onclick="PortalRouter.refresh()">Retry</button></div></div>';
    return;
  }

  var activeFilter = 'all';

  var contractors = [];
  if (isAdmin) {
    try {
      var members = await PortalAPI.apiFetch('/api/communities/' + community.id + '/members');
      if (Array.isArray(members)) {
        contractors = members.filter(function (m) {
          return m.role === 'contractor' || m.role === 'admin';
        });
      }
    } catch (e) { /* optional field — OK if it fails */ }
  }

  container.innerHTML = renderPage();
  renderList();
  wireEvents();
  wireForm();

  function renderPage() {
    return M.pageHeader('Requests', community)
      + '<div class="tf-bar">'
      + '  <button class="tf-tab tf-tab--active" data-filter="all">All</button>'
      + '  <button class="tf-tab" data-filter="open">Open</button>'
      + '  <button class="tf-tab" data-filter="completed">Completed</button>'
      + (isAdmin ? '  <button class="tf-tab tf-tab--accent" id="btn-new-request">+ New Request</button>' : '')
      + '</div>'
      + '<div class="portal-module" style="margin-top:16px">'
      + '  <div class="pm-body pm-body--list" id="requests-list"></div>'
      + '</div>'
      + (isAdmin ? renderForm() : '');
  }

  function renderForm() {
    var contractorOpts = '<option value="">— None (unassigned) —</option>';
    contractors.forEach(function (m) {
      var name = m.displayName || m.username || m.userId;
      contractorOpts += '<option value="' + M.esc(m.userId) + '">' + M.esc(name) + '</option>';
    });

    var iframeSrc = '/pin-picker.html?lat=' + encodeURIComponent(centerLat) + '&lng=' + encodeURIComponent(centerLng) + '&zoom=15';

    return '<div class="req-form-overlay" id="req-form-overlay" style="display:none">'
      + '<div class="req-form-card">'
      + '  <div class="req-form-header">'
      + '    <h3 class="req-form-title">New Request</h3>'
      + '    <button class="td-close" id="req-form-close">&times;</button>'
      + '  </div>'
      + '  <div class="cf-group"><label class="cf-label">Title *</label><input type="text" class="cf-input" id="req-title" placeholder="Brief description of the issue"></div>'
      + '  <div class="cf-group"><label class="cf-label">Description *</label><textarea class="cf-input cf-textarea" id="req-desc" placeholder="Detailed description" required></textarea></div>'
      + '  <div class="cf-row">'
      + '    <div class="cf-group cf-half"><label class="cf-label">Priority</label>'
      + '      <select class="cf-input" id="req-priority"><option value="General">General</option><option value="Urgent">Urgent</option></select>'
      + '    </div>'
      + '    <div class="cf-group cf-half"><label class="cf-label">Category</label>'
      + '      <select class="cf-input" id="req-category">'
      + '        <option value="">— Select —</option>'
      + '        <option value="Irrigation">Irrigation</option>'
      + '        <option value="Landscape">Landscape</option>'
      + '        <option value="Snow">Snow</option>'
      + '        <option value="Other">Other</option>'
      + '      </select>'
      + '    </div>'
      + '  </div>'
      + '  <div class="cf-group"><label class="cf-label">Assign to Contractor</label>'
      + '    <select class="cf-input" id="req-assigned">' + contractorOpts + '</select>'
      + '  </div>'
      + '  <div class="cf-group"><label class="cf-label">Location (optional)</label>'
      + '    <div style="border:1px solid var(--border,#e2e8f0);border-radius:8px;overflow:hidden;height:280px;">'
      + '      <iframe id="req-pin-iframe" src="' + iframeSrc + '" style="width:100%;height:100%;border:none;display:block;" allowfullscreen></iframe>'
      + '    </div>'
      + '    <p id="req-pin-label" style="font-size:11px;color:var(--text-muted,#888);margin-top:4px">Lat: ' + centerLat.toFixed(6) + ', Lng: ' + centerLng.toFixed(6) + '</p>'
      + '  </div>'
      + '  <div class="cf-actions">'
      + '    <button class="btn btn-ghost btn-sm" id="req-cancel">Cancel</button>'
      + '    <button class="btn btn-primary btn-sm" id="req-submit">Submit Request</button>'
      + '  </div>'
      + '</div></div>';
  }

  function filterRequests() {
    if (activeFilter === 'all') return requests;
    if (activeFilter === 'open') return requests.filter(function (r) { return r.status !== 'completed'; });
    return requests.filter(function (r) { return r.status === 'completed'; });
  }

  function renderList() {
    var listEl = container.querySelector('#requests-list');
    if (!listEl) return;
    var filtered = filterRequests();
    if (filtered.length === 0) {
      listEl.innerHTML = '<div class="module-empty">No requests found.</div>';
    } else {
      listEl.innerHTML = filtered.map(function (r) { return M.taskRow(r); }).join('');
    }
    listEl.querySelectorAll('[data-task-id]').forEach(function (row) {
      row.addEventListener('click', function () {
        if (typeof window.openTaskDetail === 'function') {
          window.openTaskDetail(row.dataset.taskId);
        }
      });
    });
  }

  function wireEvents() {
    container.querySelectorAll('.tf-tab[data-filter]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        activeFilter = btn.dataset.filter;
        container.querySelectorAll('.tf-tab[data-filter]').forEach(function (b) { b.classList.remove('tf-tab--active'); });
        btn.classList.add('tf-tab--active');
        renderList();
      });
    });

    var newBtn = container.querySelector('#btn-new-request');
    if (newBtn) {
      newBtn.addEventListener('click', function () {
        var overlay = document.getElementById('req-form-overlay');
        if (overlay) overlay.style.display = 'flex';
      });
    }
  }

  function wireForm() {
    var overlay = document.getElementById('req-form-overlay');
    if (!overlay) return;

    var closeBtn = overlay.querySelector('#req-form-close');
    var cancelBtn = overlay.querySelector('#req-cancel');
    var submitBtn = overlay.querySelector('#req-submit');

    function resetPin() {
      reqPinLat = centerLat;
      reqPinLng = centerLng;
      var label = overlay.querySelector('#req-pin-label');
      if (label) label.textContent = 'Lat: ' + centerLat.toFixed(6) + ', Lng: ' + centerLng.toFixed(6);
      var iframe = overlay.querySelector('#req-pin-iframe');
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ type: 'setPin', lat: centerLat, lng: centerLng }, '*');
      }
    }

    function hideForm() {
      overlay.style.display = 'none';
      overlay.querySelector('#req-title').value = '';
      overlay.querySelector('#req-desc').value = '';
      overlay.querySelector('#req-priority').value = 'General';
      overlay.querySelector('#req-category').value = '';
      overlay.querySelector('#req-assigned').value = '';
      resetPin();
    }

    function pinMessageHandler(e) {
      if (!e.data || e.data.type !== 'pin') return;
      var pinIframe = overlay.querySelector('#req-pin-iframe');
      if (pinIframe && e.source !== pinIframe.contentWindow) return;
      var lat = e.data.lat;
      var lng = e.data.lng;
      if (lat == null || lng == null) return;
      reqPinLat = lat;
      reqPinLng = lng;
      var label = overlay.querySelector('#req-pin-label');
      if (label) label.textContent = 'Lat: ' + lat.toFixed(6) + ', Lng: ' + lng.toFixed(6);
    }

    window.addEventListener('message', pinMessageHandler);

    if (window._portalRequestsCleanup) {
      window._portalRequestsCleanup();
    }
    window._portalRequestsCleanup = function () {
      window.removeEventListener('message', pinMessageHandler);
      window._portalRequestsCleanup = null;
    };

    if (closeBtn) closeBtn.addEventListener('click', hideForm);
    if (cancelBtn) cancelBtn.addEventListener('click', hideForm);

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) hideForm();
    });

    if (submitBtn) {
      submitBtn.addEventListener('click', async function () {
        var title = overlay.querySelector('#req-title').value.trim();
        var desc = overlay.querySelector('#req-desc').value.trim();
        if (!title) {
          showToast('Title is required', true);
          return;
        }
        if (!desc) {
          showToast('Description is required', true);
          return;
        }
        var body = {
          title: title,
          description: desc,
          priority: overlay.querySelector('#req-priority').value,
          category: overlay.querySelector('#req-category').value || undefined,
          assignedTo: overlay.querySelector('#req-assigned').value || undefined,
          pinLat: reqPinLat,
          pinLng: reqPinLng
        };

        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting\u2026';
        try {
          await PortalAPI.apiFetch('/api/hoa/requests', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
          showToast('Request submitted!');
          hideForm();
          var fresh = await PortalAPI.apiFetch('/api/hoa/requests');
          if (Array.isArray(fresh)) requests = fresh;
          renderList();
        } catch (e) {
          showToast('Failed: ' + (e.message || 'Unknown error'), true);
        }
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Request';
      });
    }

    if (window._pendingOpenNewRequest) {
      window._pendingOpenNewRequest = false;
      overlay.style.display = 'flex';
    }
  }

  function showToast(msg, isError) {
    var el = document.createElement('div');
    el.className = 'portal-toast' + (isError ? ' portal-toast--error' : '');
    el.textContent = msg;
    var tc = document.getElementById('toast-container');
    if (tc) { tc.appendChild(el); setTimeout(function () { el.remove(); }, 3500); }
  }
});
