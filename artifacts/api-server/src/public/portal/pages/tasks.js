PortalRouter.register('tasks', async function (container) {
  var ctx = PortalState.getCommunityContext();
  var role = ctx.role;
  var community = ctx.activeCommunity;
  var M = PortalModules;
  var isPMorAdmin = role === 'property_manager' || role === 'admin';

  /* Stop any previous sync when navigating away */
  if (window._tasksSyncManager) {
    window._tasksSyncManager.stop();
    window._tasksSyncManager = null;
  }
  if (window._tasksSyncTicker) {
    clearInterval(window._tasksSyncTicker);
    window._tasksSyncTicker = null;
  }
  /* Clear stale global modal reference from previous render */
  window.showCreateTaskModal = null;

  if (!community) {
    container.innerHTML = '<div class="empty-state" style="margin-top:80px"><p>Select a community first.</p></div>';
    return;
  }

  container.innerHTML = '<div class="loading-spinner" style="margin-top:80px">Loading tasks\u2026</div>';

  var tasks = [];
  var fetchError = false;
  try {
    tasks = await PortalAPI.apiFetch('/api/tasks?communityId=' + community.id);
    if (!Array.isArray(tasks)) tasks = [];
  } catch (e) {
    console.error('Failed to fetch tasks', e);
    fetchError = true;
  }

  if (fetchError) {
    container.innerHTML = M.pageHeader('Tasks', community)
      + '<div class="portal-module" style="margin-top:16px"><div class="module-empty" style="color:var(--red)">'
      + 'Failed to load tasks. <button class="module-view-all" onclick="PortalRouter.refresh()">Retry</button></div></div>';
    return;
  }

  var isContractor = role === 'contractor';
  var isHoa = role === 'hoa_admin' || role === 'hoa_member';
  var isPM = role === 'property_manager';
  var roleCopy = (window.PortalRoleCopy ? window.PortalRoleCopy.get(role) : null) || {};
  var tasksPage = roleCopy.tasksPage || {};
  var tabLabels = tasksPage.tabLabels || {};
  var tabs;
  var activeTab;

  if (isPM) {
    tabs = [
      { key: 'all',            label: 'All' },
      { key: 'open_requests',  label: 'Open Requests' },
      { key: 'active_work',    label: 'Active Work' },
      { key: 'overdue',        label: 'Overdue' },
      { key: 'completed',      label: 'Completed' }
    ];
    activeTab = 'all';
  } else if (isContractor) {
    tabs = [
      { key: 'active',    label: tabLabels.active    || 'Active' },
      { key: 'overdue',   label: tabLabels.overdue   || 'Overdue' },
      { key: 'upcoming',  label: tabLabels.upcoming  || 'Upcoming' },
      { key: 'completed', label: tabLabels.completed || 'Completed' }
    ];
    activeTab = 'active';
  } else if (isHoa) {
    tabs = [
      { key: 'all',       label: tabLabels.all       || 'All' },
      { key: 'upcoming',  label: tabLabels.upcoming  || 'Upcoming' },
      { key: 'completed', label: tabLabels.completed || 'Completed' }
    ];
    activeTab = 'all';
  } else {
    tabs = [
      { key: 'all',       label: tabLabels.all       || 'All' },
      { key: 'active',    label: tabLabels.active    || 'Active' },
      { key: 'completed', label: tabLabels.completed || 'Completed' }
    ];
    activeTab = 'all';
  }

  var priorityFilter = 'all';
  /* PM view toggle: list (default) or calendar */
  var pmViewMode = (function () {
    try { return sessionStorage.getItem('pm_tasks_view') || 'list'; } catch (_) { return 'list'; }
  })();

  var contractors = [];
  if (isPMorAdmin) {
    try {
      contractors = await PortalAPI.apiFetch('/api/contractors?communityId=' + community.id);
      if (!Array.isArray(contractors)) contractors = [];
    } catch (e) { contractors = []; }
  }

  /* For multi-community PM, community name comes from community context */
  var isMultiCommunity = ctx.isMultiCommunityUser;

  container.innerHTML = renderPage(tabs, activeTab);
  renderList(container, tasks, activeTab, isContractor);
  wireEvents(container, tabs, tasks, isContractor);
  prevTaskStatuses = buildStatusMap(tasks);
  startSync(container);

  window.showCreateTaskModal = function () { showCreateTaskModal(); };

  if (window._pendingOpenCreateTask) {
    window._pendingOpenCreateTask = false;
    if (isPMorAdmin) showCreateTaskModal();
  }

  if (window._pendingOpenTaskDetail) {
    var pendingTaskId = window._pendingOpenTaskDetail;
    window._pendingOpenTaskDetail = null;
    if (typeof window.openTaskDetail === 'function') {
      window.openTaskDetail(pendingTaskId);
    }
  }

  function renderPage(tabs, current) {
    if (isPM) {
      return renderPMPage(tabs, current);
    }

    var priorityBar = '';
    var newTaskBtn = isPMorAdmin
      ? '<button class="tf-tab tf-tab--accent" id="btn-new-task">+ New Task</button>'
      : '';

    var subtitleHtml = tasksPage.pageSubtitle
      ? '<p class="pph-subtitle" style="margin:0 0 12px;font-size:13px;color:var(--text-muted,#888)">' + M.esc(tasksPage.pageSubtitle) + '</p>'
      : '';

    return M.pageHeader('Tasks', community)
      + subtitleHtml
      + '<div class="tf-bar tf-bar--with-sync">'
      + tabs.map(function (t) {
          return '<button class="tf-tab' + (t.key === current ? ' tf-tab--active' : '') + '" data-tab="' + t.key + '">'
            + M.esc(t.label) + '</button>';
        }).join('')
      + newTaskBtn
      + '<div class="sync-bar" id="tasks-sync-bar">'
      + '  <span class="sync-label" id="tasks-sync-label">Syncing\u2026</span>'
      + '  <button class="sync-refresh-btn" id="tasks-sync-btn" title="Refresh now">'
      + '    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">'
      + '      <polyline points="23 4 23 10 17 10"/>'
      + '      <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>'
      + '    </svg>'
      + '  </button>'
      + '</div>'
      + '</div>'
      + '<div class="portal-module" style="margin-top:16px">'
      + '  <div class="pm-body pm-body--list" id="tasks-list"></div>'
      + '</div>';
  }

  function renderPMPage(tabs, current) {
    var isListView = pmViewMode === 'list';

    var tabsHtml = tabs.map(function (t) {
      var isOverdueTab = t.key === 'overdue';
      return '<button class="tf-tab' + (t.key === current ? ' tf-tab--active' : '') + (isOverdueTab ? ' tf-tab--overdue-filter' : '') + '" data-tab="' + t.key + '">'
        + M.esc(t.label) + '</button>';
    }).join('');

    var newTaskBtn = '<button class="tf-tab tf-tab--accent" id="btn-new-task">+ New Task</button>';

    var rightControls = '<div class="pm-bar-right">'
      + '<div class="pm-view-toggle" id="pm-view-toggle">'
      + '<button class="pm-view-btn' + (isListView ? ' pm-view-btn--active' : '') + '" data-view="list" title="List view">'
      + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>'
      + '</button>'
      + '<button class="pm-view-btn' + (!isListView ? ' pm-view-btn--active' : '') + '" data-view="calendar" title="Calendar view">'
      + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>'
      + '</button>'
      + '</div>'
      + '<div class="sync-bar sync-bar--inline" id="tasks-sync-bar">'
      + '  <span class="sync-label" id="tasks-sync-label">Syncing\u2026</span>'
      + '  <button class="sync-refresh-btn" id="tasks-sync-btn" title="Refresh now">'
      + '    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">'
      + '      <polyline points="23 4 23 10 17 10"/>'
      + '      <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>'
      + '    </svg>'
      + '  </button>'
      + '</div>'
      + '</div>';

    var calendarHtml = !isListView
      ? '<div class="portal-module" style="margin-top:16px"><div class="pm-body" id="tasks-calendar-placeholder" style="padding:60px 16px;text-align:center;color:var(--gray-400);font-size:14px">Calendar view — switch to list to see grouped tasks</div></div>'
      : '';

    return M.pageHeader('Tasks', community)
      + '<div class="tf-bar tf-bar--with-sync pm-filter-bar">'
      + tabsHtml
      + newTaskBtn
      + rightControls
      + '</div>'
      + '<div class="portal-module" style="margin-top:16px;' + (!isListView ? 'display:none' : '') + '">'
      + '  <div class="pm-body pm-body--list" id="tasks-list"></div>'
      + '</div>'
      + calendarHtml;
  }

  function showCreateTaskModal() {
    var contractorOpts = '<option value="">— Unassigned —</option>';
    contractors.forEach(function (c) {
      var name = c.displayName || c.username || c.id;
      contractorOpts += '<option value="' + M.esc(c.id) + '">' + M.esc(name) + '</option>';
    });

    var overlay = document.createElement('div');
    overlay.className = 'req-form-overlay';
    overlay.id = 'create-task-overlay';
    overlay.style.display = 'flex';
    overlay.innerHTML = '<div class="req-form-card">'
      + '  <div class="req-form-header">'
      + '    <h3 class="req-form-title">New Task</h3>'
      + '    <button class="td-close" id="ct-close">&times;</button>'
      + '  </div>'
      + '  <div class="cf-group"><label class="cf-label">Title *</label><input type="text" class="cf-input" id="ct-title" placeholder="Task title"></div>'
      + '  <div class="cf-group"><label class="cf-label">Description</label><textarea class="cf-input cf-textarea" id="ct-desc" placeholder="Optional description"></textarea></div>'
      + '  <div class="cf-row">'
      + '    <div class="cf-group cf-half"><label class="cf-label">Priority</label>'
      + '      <select class="cf-input" id="ct-priority">'
      + '        <option value="low">Low</option>'
      + '        <option value="medium" selected>Medium</option>'
      + '        <option value="high">High</option>'
      + '        <option value="urgent">Urgent</option>'
      + '      </select>'
      + '    </div>'
      + '    <div class="cf-group cf-half"><label class="cf-label">Assign to Contractor</label>'
      + '      <select class="cf-input" id="ct-assigned">' + contractorOpts + '</select>'
      + '    </div>'
      + '  </div>'
      + '  <div class="cf-row">'
      + '    <div class="cf-group cf-half"><label class="cf-label">Start Date</label><input type="date" class="cf-input" id="ct-start"></div>'
      + '    <div class="cf-group cf-half"><label class="cf-label">Due Date</label><input type="date" class="cf-input" id="ct-due"></div>'
      + '  </div>'
      + '  <div class="cf-actions">'
      + '    <button class="btn btn-ghost btn-sm" id="ct-cancel">Cancel</button>'
      + '    <button class="btn btn-primary btn-sm" id="ct-submit">Create Task</button>'
      + '  </div>'
      + '</div>';

    document.body.appendChild(overlay);

    function hideModal() {
      overlay.remove();
    }

    overlay.querySelector('#ct-close').addEventListener('click', hideModal);
    overlay.querySelector('#ct-cancel').addEventListener('click', hideModal);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) hideModal(); });

    overlay.querySelector('#ct-submit').addEventListener('click', async function () {
      var title = overlay.querySelector('#ct-title').value.trim();
      if (!title) { PortalAPI.showToast('Title is required', 'error'); return; }

      var startVal = overlay.querySelector('#ct-start').value;
      var dueVal = overlay.querySelector('#ct-due').value;

      var body = {
        communityId: community.id,
        title: title,
        description: overlay.querySelector('#ct-desc').value.trim() || undefined,
        priority: overlay.querySelector('#ct-priority').value,
        assignedTo: overlay.querySelector('#ct-assigned').value || undefined,
        startDate: startVal || undefined,
        dueDate: dueVal || undefined,
      };

      var submitBtn = overlay.querySelector('#ct-submit');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Creating\u2026';
      try {
        await PortalAPI.apiFetch('/api/tasks', {
          method: 'POST',
          body: body
        });
        PortalAPI.showToast('Task created!', 'success');
        hideModal();
        var fresh = await PortalAPI.apiFetch('/api/tasks?communityId=' + community.id);
        if (Array.isArray(fresh)) { tasks = fresh; }
        renderList(container, tasks, activeTab, isContractor);
      } catch (e) {
        PortalAPI.showToast('Failed: ' + (e.message || 'Unknown error'), 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create Task';
      }
    });
  }

  function filterTasks(taskList, tab, isContractor) {
    var result = taskList;
    if (isHoa) {
      if (tab === 'all') {
        result = result.filter(function (t) { return t.status !== 'completed'; });
        result = result.slice().sort(function (a, b) {
          var sa = a.windowStart ? new Date(a.windowStart).getTime() : Infinity;
          var sb = b.windowStart ? new Date(b.windowStart).getTime() : Infinity;
          return sa - sb;
        });
      } else if (tab === 'upcoming') {
        result = result.filter(function (t) {
          if (t.status === 'completed') return false;
          if (!t.windowStart) return false;
          var start = new Date(t.windowStart.includes('T') ? t.windowStart.split('T')[0] : t.windowStart);
          return start > new Date();
        });
        result = result.slice().sort(function (a, b) {
          var sa = a.windowStart ? new Date(a.windowStart).getTime() : 0;
          var sb = b.windowStart ? new Date(b.windowStart).getTime() : 0;
          return sa - sb;
        });
      } else if (tab === 'completed') {
        result = result.filter(function (t) { return t.status === 'completed'; });
      }
    } else if (tab !== 'all') {
      result = result.filter(function (t) {
        var cls = M.classifyTask(t);
        var isRequest = t.origin === 'hoa_request' || t.origin === 'HOA';
        /* PM-specific filter keys */
        if (tab === 'open_requests') return isRequest && t.status !== 'completed';
        if (tab === 'active_work')   return !isRequest && (cls === 'active' || t.status === 'in_progress');
        /* Shared filter keys */
        if (tab === 'active')      return cls === 'active' || cls === 'other';
        if (tab === 'overdue')     return cls === 'overdue';
        if (tab === 'upcoming')    return cls === 'upcoming';
        if (tab === 'completed')   return t.status === 'completed' || cls === 'completed';
        if (tab === 'open')        return t.status !== 'completed' && t.status !== 'in_progress';
        if (tab === 'in_progress') return t.status === 'in_progress';
        return true;
      });
    }
    if (priorityFilter !== 'all') {
      result = result.filter(function (t) { return t.priority === priorityFilter; });
    }
    return result;
  }

  /* Group tasks for PM urgency-first view */
  function groupTasksForPM(taskList) {
    var groups = {
      overdue:       [],
      open_requests: [],
      active_work:   [],
      upcoming:      [],
      completed:     []
    };
    taskList.forEach(function (t) {
      var cls = M.classifyTask(t);
      var isRequest = t.origin === 'hoa_request' || t.origin === 'HOA';
      if (cls === 'completed' || t.status === 'completed') {
        groups.completed.push(t);
      } else if (cls === 'overdue') {
        groups.overdue.push(t);
      } else if (isRequest && t.status !== 'completed') {
        groups.open_requests.push(t);
      } else if (cls === 'active' || t.status === 'in_progress') {
        groups.active_work.push(t);
      } else {
        groups.upcoming.push(t);
      }
    });
    return groups;
  }

  function renderPMGroupedList(listEl, taskList) {
    var groups = groupTasksForPM(taskList);
    var groupOrder = [
      { key: 'overdue',       label: 'Overdue',        isUrgent: true },
      { key: 'open_requests', label: 'Open Requests',  isUrgent: true },
      { key: 'active_work',   label: 'Active Work',    isUrgent: false },
      { key: 'upcoming',      label: 'Upcoming',       isUrgent: false },
      { key: 'completed',     label: 'Completed',      isUrgent: false }
    ];

    var html = '';
    var hasAny = false;

    groupOrder.forEach(function (g) {
      var items = groups[g.key];
      if (!items || items.length === 0) return;
      hasAny = true;
      html += '<div class="pm-group' + (g.isUrgent ? ' pm-group--urgent' : '') + '">'
        + '<div class="pm-group-header' + (g.isUrgent ? ' pm-group-header--urgent' : '') + '">'
        + '<span class="pm-group-label">' + g.label + '</span>'
        + '<span class="pm-group-count">' + items.length + '</span>'
        + '</div>'
        + '<div class="pm-group-body">'
        + items.map(function (t) { return M.pmTaskCard(t, { showCommunity: isMultiCommunity }); }).join('')
        + '</div>'
        + '</div>';
    });

    if (!hasAny) {
      html = '<div class="module-empty">No tasks in this category.</div>';
    }

    listEl.innerHTML = html;
    wireCardActions(listEl);
  }

  function renderList(container, taskData, tab, isContractor) {
    var listEl = container.querySelector('#tasks-list');
    if (!listEl) return;

    if (isPM) {
      if (pmViewMode !== 'list') return;
      var filtered = filterTasks(taskData, tab);
      if (tab === 'all') {
        renderPMGroupedList(listEl, filtered);
      } else {
        if (filtered.length === 0) {
          listEl.innerHTML = '<div class="module-empty">No tasks in this category.</div>';
        } else {
          listEl.innerHTML = '<div class="pm-group-body pm-group-body--flat">'
            + filtered.map(function (t) { return M.pmTaskCard(t, { showCommunity: isMultiCommunity }); }).join('')
            + '</div>';
          wireCardActions(listEl);
        }
      }
      return;
    }

    var nonPMFiltered = filterTasks(taskData, tab);
    if (nonPMFiltered.length === 0) {
      var emptyStates = tasksPage.emptyStates || {};
      var emptyMsg = emptyStates[tab] || emptyStates['default'] || 'No tasks to show.';
      listEl.innerHTML = '<div class="module-empty">' + M.esc(emptyMsg) + '</div>';
    } else {
      listEl.innerHTML = nonPMFiltered.map(function (t) { return M.taskRow(t); }).join('');
    }
    listEl.querySelectorAll('[data-task-id]').forEach(function (row) {
      row.addEventListener('click', function (e) {
        if (e.target && e.target.closest && e.target.closest('[data-action]')) return;
        if (typeof window.openTaskDetail === 'function') {
          window.openTaskDetail(row.dataset.taskId);
        }
      });
    });
    listEl.querySelectorAll('[data-action="view"]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (typeof window.openTaskDetail === 'function') {
          window.openTaskDetail(btn.dataset.taskId);
        }
      });
    });
    listEl.querySelectorAll('[data-action="acknowledge"]').forEach(function (btn) {
      btn.addEventListener('click', async function (e) {
        e.stopPropagation();
        var taskId = btn.dataset.taskId;
        var task = tasks.find(function (t) { return t.id === taskId; });
        if (!task) return;
        btn.disabled = true;
        btn.textContent = 'Acknowledging\u2026';
        try {
          await PortalAPI.apiFetch('/api/tasks/' + taskId, {
            method: 'PUT',
            body: { status: 'acknowledged', version: task.version }
          });
          PortalAPI.showToast('Request acknowledged', 'success');
          var fresh = await PortalAPI.apiFetch('/api/tasks?communityId=' + community.id);
          if (Array.isArray(fresh)) { tasks = fresh; }
          renderList(container, tasks, activeTab, isContractor);
        } catch (err) {
          PortalAPI.showToast('Failed to acknowledge: ' + (err.message || 'Unknown error'), 'error');
          btn.disabled = false;
          btn.textContent = 'Acknowledge';
        }
      });
    });
  }

  function wireCardActions(listEl) {
    /* Open detail action */
    listEl.querySelectorAll('.pm-card-open-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var taskId = btn.dataset.taskId;
        if (typeof window.openTaskDetail === 'function') {
          window.openTaskDetail(taskId);
        }
      });
    });

    /* Whole card click → open detail */
    listEl.querySelectorAll('.pm-task-card').forEach(function (card) {
      card.addEventListener('click', function (e) {
        if (e.target.closest('.pm-card-action-btn')) return;
        var taskId = card.dataset.taskId;
        if (typeof window.openTaskDetail === 'function') {
          window.openTaskDetail(taskId);
        }
      });
    });

    /* View on Map action */
    listEl.querySelectorAll('.pm-card-map-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var lat = btn.dataset.lat;
        var lng = btn.dataset.lng;
        var taskId = btn.dataset.taskId;
        if (lat && lng) {
          PortalRouter.navigate('map', true, { lat: lat, lng: lng, taskId: taskId });
        } else {
          PortalRouter.navigate('map');
        }
      });
    });
  }

  function updateSyncLabel() {
    var label = container.querySelector('#tasks-sync-label');
    if (!label || !window._tasksSyncManager) return;
    var ts = window._tasksSyncManager.lastSynced();
    if (!ts) { label.textContent = 'Syncing\u2026'; return; }
    var secs = Math.round((Date.now() - ts.getTime()) / 1000);
    if (secs < 5)        label.textContent = 'Last synced: just now';
    else if (secs < 60)  label.textContent = 'Last synced: ' + secs + 's ago';
    else                 label.textContent = 'Last synced: ' + Math.round(secs / 60) + 'm ago';
  }

  var prevTaskStatuses = null;

  function detectNewCompletions(newTasks) {
    if (!prevTaskStatuses || !Array.isArray(newTasks)) return false;
    var hasNewCompletion = false;
    newTasks.forEach(function (t) {
      if (t.status === 'completed' && prevTaskStatuses[t.id] && prevTaskStatuses[t.id] !== 'completed') {
        hasNewCompletion = true;
      }
    });
    return hasNewCompletion;
  }

  function buildStatusMap(taskList) {
    var map = {};
    if (!Array.isArray(taskList)) return map;
    taskList.forEach(function (t) { map[t.id] = t.status; });
    return map;
  }

  function switchToCompletedTab() {
    var completedBtn = container.querySelector('.tf-tab[data-tab="completed"]');
    if (!completedBtn) return;
    activeTab = 'completed';
    container.querySelectorAll('.tf-tab[data-tab]').forEach(function (b) { b.classList.remove('tf-tab--active'); });
    completedBtn.classList.add('tf-tab--active');
  }

  function showCompletionBanner() {
    var existing = container.querySelector('#task-completed-banner');
    if (existing) return;
    var banner = document.createElement('div');
    banner.id = 'task-completed-banner';
    banner.style.cssText = 'background:#e6f9f6;border:1px solid #25C1AC;border-radius:8px;padding:10px 14px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:13px;color:#0d7a68;';
    banner.innerHTML = '<span>A task was just marked as complete.</span>'
      + '<div style="display:flex;gap:8px;flex-shrink:0">'
      + '<button id="task-completed-banner-view" style="background:#25C1AC;color:#fff;border:none;border-radius:5px;padding:4px 10px;cursor:pointer;font-size:12px;">View Completed</button>'
      + '<button id="task-completed-banner-dismiss" style="background:transparent;color:#0d7a68;border:1px solid #25C1AC;border-radius:5px;padding:4px 10px;cursor:pointer;font-size:12px;">Dismiss</button>'
      + '</div>';
    var moduleEl = container.querySelector('#tasks-list') && container.querySelector('#tasks-list').closest('.portal-module');
    var insertTarget = moduleEl || container.querySelector('#tasks-list');
    if (insertTarget && insertTarget.parentNode) {
      insertTarget.parentNode.insertBefore(banner, insertTarget);
    }
    banner.querySelector('#task-completed-banner-view').addEventListener('click', function () {
      switchToCompletedTab();
      renderList(container, tasks, activeTab, isContractor);
      banner.remove();
    });
    banner.querySelector('#task-completed-banner-dismiss').addEventListener('click', function () {
      banner.remove();
    });
  }

  function startSync(container) {
    if (!window.SyncManager) return;

    var sm = SyncManager.create();
    window._tasksSyncManager = sm;

    sm.start(
      function () { return PortalAPI.apiFetch('/api/tasks?communityId=' + community.id); },
      function (newTasks, changed) {
        if (!Array.isArray(newTasks)) return;
        var newlyCompleted = detectNewCompletions(newTasks);
        prevTaskStatuses = buildStatusMap(newTasks);
        tasks = newTasks;
        renderList(container, tasks, activeTab, isContractor);
        updateSyncLabel();
        if (newlyCompleted && activeTab !== 'completed') {
          showCompletionBanner();
        } else if (changed) {
          PortalAPI.showToast('Tasks updated', 'info');
        }
      },
      30000
    );

    /* Update the label every 5 seconds */
    window._tasksSyncTicker = setInterval(updateSyncLabel, 5000);

    /* Wire the manual refresh button */
    var btn = container.querySelector('#tasks-sync-btn');
    if (btn) {
      btn.addEventListener('click', function () {
        btn.classList.add('sync-refresh-btn--spinning');
        sm.forceRefresh();
        setTimeout(function () { btn.classList.remove('sync-refresh-btn--spinning'); }, 600);
      });
    }
  }

  function wireEvents(container, tabs, taskData, isContractor) {
    /* Tab filter buttons */
    container.querySelectorAll('.tf-tab[data-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        activeTab = btn.dataset.tab;
        container.querySelectorAll('.tf-tab[data-tab]').forEach(function (b) { b.classList.remove('tf-tab--active'); });
        btn.classList.add('tf-tab--active');
        renderList(container, tasks, activeTab, isContractor);
      });
    });

    /* Priority filter buttons (non-PM roles) */
    container.querySelectorAll('.tf-tab[data-priority]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        priorityFilter = btn.dataset.priority;
        container.querySelectorAll('.tf-tab[data-priority]').forEach(function (b) { b.classList.remove('tf-tab--active'); });
        btn.classList.add('tf-tab--active');
        renderList(container, tasks, activeTab, isContractor);
      });
    });

    /* New task button */
    var newTaskBtn = container.querySelector('#btn-new-task');
    if (newTaskBtn) {
      newTaskBtn.addEventListener('click', function () {
        showCreateTaskModal();
      });
    }

    /* PM view toggle (list / calendar) */
    if (isPM) {
      container.querySelectorAll('.pm-view-btn[data-view]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var newView = btn.dataset.view;
          if (newView === pmViewMode) return;
          pmViewMode = newView;
          try { sessionStorage.setItem('pm_tasks_view', pmViewMode); } catch (_) {}
          /* Re-render the entire page to switch view */
          container.innerHTML = renderPage(tabs, activeTab);
          renderList(container, tasks, activeTab, isContractor);
          wireEvents(container, tabs, tasks, isContractor);
          startSync(container);
        });
      });
    }
  }
});
