PortalRouter.register('tasks', async function (container) {
  var ctx = PortalState.getCommunityContext();
  var role = ctx.role;
  var community = ctx.activeCommunity;
  var M = PortalModules;

  /* Stop any previous sync when navigating away */
  if (window._tasksSyncManager) {
    window._tasksSyncManager.stop();
    window._tasksSyncManager = null;
  }
  if (window._tasksSyncTicker) {
    clearInterval(window._tasksSyncTicker);
    window._tasksSyncTicker = null;
  }

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
  var tabs;
  var activeTab;
  if (isContractor) {
    tabs = [
      { key: 'active',    label: 'Active' },
      { key: 'overdue',   label: 'Overdue' },
      { key: 'upcoming',  label: 'Upcoming' },
      { key: 'completed', label: 'Completed' }
    ];
    activeTab = 'active';
  } else if (isHoa) {
    tabs = [
      { key: 'open',        label: 'Open' },
      { key: 'in_progress', label: 'In Progress' },
      { key: 'completed',   label: 'Completed' }
    ];
    activeTab = 'open';
  } else {
    tabs = [
      { key: 'all',       label: 'All' },
      { key: 'active',    label: 'Active' },
      { key: 'completed', label: 'Completed' }
    ];
    activeTab = 'all';
  }

  var priorityFilter = 'all';
  var isPM = role === 'property_manager';

  container.innerHTML = renderPage(tabs, activeTab);
  renderList(container, tasks, activeTab, isContractor);
  wireEvents(container, tabs, tasks, isContractor);
  prevTaskStatuses = buildStatusMap(tasks);
  startSync(container);

  function renderPage(tabs, current) {
    var priorityBar = '';
    if (isPM) {
      var pTabs = [
        { key: 'all', label: 'All Priorities' },
        { key: 'urgent', label: 'Urgent' },
        { key: 'high', label: 'High' },
        { key: 'medium', label: 'Medium' },
        { key: 'low', label: 'Low' }
      ];
      priorityBar = '<div class="tf-bar" style="margin-top:8px" id="priority-bar">'
        + pTabs.map(function (p) {
            return '<button class="tf-tab tf-tab--sm' + (p.key === priorityFilter ? ' tf-tab--active' : '') + '" data-priority="' + p.key + '">'
              + M.esc(p.label) + '</button>';
          }).join('')
        + '</div>';
    }

    return M.pageHeader('Tasks', community)
      + '<div class="tf-bar tf-bar--with-sync">'
      + tabs.map(function (t) {
          return '<button class="tf-tab' + (t.key === current ? ' tf-tab--active' : '') + '" data-tab="' + t.key + '">'
            + M.esc(t.label) + '</button>';
        }).join('')
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
      + priorityBar
      + '<div class="portal-module" style="margin-top:16px">'
      + '  <div class="pm-body pm-body--list" id="tasks-list"></div>'
      + '</div>';
  }

  function filterTasks(tasks, tab, isContractor) {
    var result = tasks;
    if (tab !== 'all') {
      result = result.filter(function (t) {
        var cls = M.classifyTask(t);
        if (tab === 'active') return cls === 'active' || cls === 'other';
        if (tab === 'overdue') return cls === 'overdue';
        if (tab === 'upcoming') return cls === 'upcoming';
        if (tab === 'completed') return cls === 'completed';
        if (tab === 'open') return t.status !== 'completed' && t.status !== 'in_progress';
        if (tab === 'in_progress') return t.status === 'in_progress';
        return true;
      });
    }
    if (priorityFilter !== 'all') {
      result = result.filter(function (t) { return t.priority === priorityFilter; });
    }
    return result;
  }

  function renderList(container, taskData, tab, isContractor) {
    var listEl = container.querySelector('#tasks-list');
    if (!listEl) return;
    var filtered = filterTasks(taskData, tab, isContractor);
    if (filtered.length === 0) {
      listEl.innerHTML = '<div class="module-empty">No tasks in this category.</div>';
    } else {
      listEl.innerHTML = filtered.map(function (t) { return M.taskRow(t); }).join('');
    }
    listEl.querySelectorAll('[data-task-id]').forEach(function (row) {
      row.addEventListener('click', function () {
        if (typeof window.openTaskDetail === 'function') {
          window.openTaskDetail(row.dataset.taskId);
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
    container.querySelectorAll('.tf-tab[data-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        activeTab = btn.dataset.tab;
        container.querySelectorAll('.tf-tab[data-tab]').forEach(function (b) { b.classList.remove('tf-tab--active'); });
        btn.classList.add('tf-tab--active');
        renderList(container, tasks, activeTab, isContractor);
      });
    });
    container.querySelectorAll('.tf-tab[data-priority]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        priorityFilter = btn.dataset.priority;
        container.querySelectorAll('.tf-tab[data-priority]').forEach(function (b) { b.classList.remove('tf-tab--active'); });
        btn.classList.add('tf-tab--active');
        renderList(container, tasks, activeTab, isContractor);
      });
    });
  }
});
