(function () {
  var overlayEl = null;
  var M = null;

  function ensureOverlay() {
    if (overlayEl) return;
    M = PortalModules;
    overlayEl = document.createElement('div');
    overlayEl.className = 'td-overlay';
    overlayEl.id = 'td-overlay';
    overlayEl.innerHTML = '<div class="td-panel" id="td-panel"></div>';
    document.body.appendChild(overlayEl);
    overlayEl.addEventListener('click', function (e) {
      if (e.target === overlayEl) closePanel();
    });
  }

  function closePanel() {
    if (overlayEl) overlayEl.classList.remove('open');
  }

  window.openTaskDetail = async function (taskId) {
    ensureOverlay();
    var panel = document.getElementById('td-panel');
    panel.innerHTML = '<div class="loading-spinner" style="margin-top:60px">Loading\u2026</div>';
    overlayEl.classList.add('open');

    var ctx = PortalState.getCommunityContext();
    var role = ctx.role;
    var isContractor = role === 'contractor';

    var task = null;
    var completions = [];
    try {
      task = await PortalAPI.apiFetch('/api/tasks/' + taskId);
    } catch (e) {
      panel.innerHTML = '<div class="td-error">Failed to load task details.</div>';
      return;
    }

    try {
      var c = await PortalAPI.apiFetch('/api/tasks/' + taskId + '/completions');
      if (Array.isArray(c)) completions = c;
    } catch (e) { /* ignore */ }

    renderDetail(panel, task, completions, isContractor);
  };

  function renderDetail(panel, task, completions, isContractor) {
    var priorityColor = (M.PRIORITY_COLOR[task.priority] || '#6b7280');
    var statusLabel = M.STATUS_LABEL[task.status] || task.status;
    var statusColor = M.STATUS_COLOR[task.status] || '#6b7280';
    var isHoa = task.origin === 'hoa_request' || task.origin === 'HOA';
    var window = M.fmtDateRange(task.windowStart, task.windowEnd);

    var actionsHtml = '';
    if (isContractor && task.status !== 'completed') {
      var btns = '';
      if (isHoa) {
        if (task.status === 'submitted') {
          btns += '<button class="td-action-btn td-btn-ack" data-action="acknowledge">Acknowledge</button>';
        }
        if (task.status === 'acknowledged') {
          btns += '<button class="td-action-btn td-btn-complete" data-action="complete">Complete Task</button>';
        }
      } else {
        if (task.status === 'pending' || task.status === 'acknowledged') {
          btns += '<button class="td-action-btn td-btn-progress" data-action="in_progress">Mark In Progress</button>';
        }
        if (task.status === 'in_progress') {
          btns += '<button class="td-action-btn td-btn-complete" data-action="complete">Complete Task</button>';
        }
      }
      if (btns) actionsHtml = '<div class="td-actions">' + btns + '</div>';
    }

    var completionHtml = '';
    if (completions.length > 0) {
      var latest = completions[0];
      completionHtml = '<div class="td-section"><h4 class="td-section-title">Completion Details</h4>'
        + '<div class="td-field"><span class="td-label">Signed off by</span><span class="td-value">' + M.esc(latest.employeeSignOffName || '—') + '</span></div>'
        + (latest.timeSpentMinutes ? '<div class="td-field"><span class="td-label">Time spent</span><span class="td-value">' + latest.timeSpentMinutes + ' min</span></div>' : '')
        + (latest.notes ? '<div class="td-field"><span class="td-label">Notes</span><span class="td-value">' + M.esc(latest.notes) + '</span></div>' : '')
        + (latest.materialsUsed ? '<div class="td-field"><span class="td-label">Materials</span><span class="td-value">' + M.esc(latest.materialsUsed) + '</span></div>' : '')
        + (latest.followUpNeeded ? '<div class="td-field"><span class="td-label">Follow-up</span><span class="td-value">' + M.esc(latest.followUpNeeded) + '</span></div>' : '')
        + '</div>';
    }

    panel.innerHTML = ''
      + '<div class="td-header">'
      + '  <button class="td-close" id="td-close">&times;</button>'
      + '  <div class="td-badges">'
      + '    <span class="td-status-badge" style="background:' + statusColor + '18;color:' + statusColor + '">' + statusLabel + '</span>'
      + '    <span class="td-priority-badge" style="background:' + priorityColor + '18;color:' + priorityColor + '">' + M.esc(task.priority || 'low') + '</span>'
      + (isHoa ? '    <span class="td-hoa-badge">HOA Request</span>' : '')
      + '  </div>'
      + '  <h2 class="td-title">' + M.esc(task.title || 'Untitled') + '</h2>'
      + '</div>'
      + '<div class="td-body">'
      + (task.description ? '<div class="td-section"><h4 class="td-section-title">Description</h4><p class="td-desc">' + M.esc(task.description) + '</p></div>' : '')
      + '<div class="td-section"><h4 class="td-section-title">Details</h4>'
      + (window ? '<div class="td-field"><span class="td-label">Window</span><span class="td-value">' + window + '</span></div>' : '')
      + (task.category ? '<div class="td-field"><span class="td-label">Category</span><span class="td-value">' + M.esc(task.category) + '</span></div>' : '')
      + (task.assignedToName || task.assignedTo ? '<div class="td-field"><span class="td-label">Assigned to</span><span class="td-value">' + M.esc(task.assignedToName || task.assignedTo) + '</span></div>' : '')
      + (task.address ? '<div class="td-field"><span class="td-label">Address</span><span class="td-value">' + M.esc(task.address) + '</span></div>' : '')
      + '<div class="td-field"><span class="td-label">Created</span><span class="td-value">' + new Date(task.createdAt).toLocaleDateString() + '</span></div>'
      + '</div>'
      + completionHtml
      + actionsHtml
      + '<div class="td-completion-form" id="td-completion-form" style="display:none">'
      + '  <h4 class="td-section-title">Complete Task</h4>'
      + '  <div class="cf-group"><label class="cf-label">Sign-off Name *</label><input type="text" class="cf-input" id="cf-signoff" placeholder="Your name" required></div>'
      + '  <div class="cf-group"><label class="cf-label">Time Spent (minutes)</label><input type="number" class="cf-input" id="cf-time" min="1" placeholder="e.g. 45"></div>'
      + '  <div class="cf-group"><label class="cf-label">Materials Used</label><textarea class="cf-input cf-textarea" id="cf-materials" placeholder="List materials used"></textarea></div>'
      + '  <div class="cf-group"><label class="cf-label">Follow-up Needed</label><textarea class="cf-input cf-textarea" id="cf-followup" placeholder="Describe any follow-up work"></textarea></div>'
      + '  <div class="cf-group"><label class="cf-label">Notes</label><textarea class="cf-input cf-textarea" id="cf-notes" placeholder="Additional notes"></textarea></div>'
      + '  <div class="cf-actions">'
      + '    <button class="btn btn-ghost btn-sm" id="cf-cancel">Cancel</button>'
      + '    <button class="btn btn-primary btn-sm" id="cf-submit">Submit Completion</button>'
      + '  </div>'
      + '</div>'
      + '</div>';

    document.getElementById('td-close').addEventListener('click', closePanel);
    wireActions(panel, task);
  }

  function wireActions(panel, task) {
    panel.querySelectorAll('.td-action-btn').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var action = btn.dataset.action;

        if (action === 'complete') {
          document.getElementById('td-completion-form').style.display = 'block';
          panel.querySelector('.td-actions').style.display = 'none';
          return;
        }

        btn.disabled = true;
        btn.textContent = 'Updating\u2026';
        try {
          await PortalAPI.apiFetch('/api/tasks/' + task.id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: action === 'acknowledge' ? 'acknowledged' : 'in_progress', version: task.version })
          });
          showToast('Task updated');
          closePanel();
          PortalRouter.refresh();
        } catch (e) {
          showToast('Failed: ' + (e.message || 'Unknown error'), true);
          btn.disabled = false;
          btn.textContent = action === 'acknowledge' ? 'Acknowledge' : 'Mark In Progress';
        }
      });
    });

    var cancelBtn = panel.querySelector('#cf-cancel');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        document.getElementById('td-completion-form').style.display = 'none';
        var acts = panel.querySelector('.td-actions');
        if (acts) acts.style.display = '';
      });
    }

    var submitBtn = panel.querySelector('#cf-submit');
    if (submitBtn) {
      submitBtn.addEventListener('click', async function () {
        var signoff = document.getElementById('cf-signoff').value.trim();
        if (!signoff) {
          showToast('Sign-off name is required', true);
          return;
        }
        var timeVal = document.getElementById('cf-time').value;
        var body = {
          employeeSignOffName: signoff,
          version: task.version
        };
        if (timeVal) body.timeSpentMinutes = parseInt(timeVal, 10);
        var materials = document.getElementById('cf-materials').value.trim();
        if (materials) body.materialsUsed = materials;
        var followup = document.getElementById('cf-followup').value.trim();
        if (followup) body.followUpNeeded = followup;
        var notes = document.getElementById('cf-notes').value.trim();
        if (notes) body.notes = notes;

        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting\u2026';
        try {
          await PortalAPI.apiFetch('/api/tasks/' + task.id + '/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
          showToast('Task completed!');
          closePanel();
          PortalRouter.refresh();
        } catch (e) {
          showToast('Failed: ' + (e.message || 'Unknown error'), true);
          submitBtn.disabled = false;
          submitBtn.textContent = 'Submit Completion';
        }
      });
    }
  }

  function showToast(msg, isError) {
    var el = document.createElement('div');
    el.className = 'portal-toast' + (isError ? ' portal-toast--error' : '');
    el.textContent = msg;
    var container = document.getElementById('toast-container');
    if (container) {
      container.appendChild(el);
      setTimeout(function () { el.remove(); }, 3500);
    }
  }
})();
