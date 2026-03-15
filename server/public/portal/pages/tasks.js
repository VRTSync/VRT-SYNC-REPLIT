PortalRouter.register('tasks', async function (container) {
  var ctx = PortalState.getCommunityContext();
  var role = ctx.role;
  var community = ctx.activeCommunity;
  var M = PortalModules;

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
      + '<div class="tf-bar">'
      + tabs.map(function (t) {
          return '<button class="tf-tab' + (t.key === current ? ' tf-tab--active' : '') + '" data-tab="' + t.key + '">'
            + M.esc(t.label) + '</button>';
        }).join('')
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

  function renderList(container, tasks, tab, isContractor) {
    var listEl = container.querySelector('#tasks-list');
    if (!listEl) return;
    var filtered = filterTasks(tasks, tab, isContractor);
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

  function wireEvents(container, tabs, tasks, isContractor) {
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
