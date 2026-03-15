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
  var tabs = isContractor
    ? [
        { key: 'active',    label: 'Active' },
        { key: 'overdue',   label: 'Overdue' },
        { key: 'upcoming',  label: 'Upcoming' },
        { key: 'completed', label: 'Completed' }
      ]
    : [
        { key: 'all',       label: 'All' },
        { key: 'active',    label: 'Active' },
        { key: 'completed', label: 'Completed' }
      ];

  var activeTab = isContractor ? 'active' : 'all';

  container.innerHTML = renderPage(tabs, activeTab);
  renderList(container, tasks, activeTab, isContractor);
  wireEvents(container, tabs, tasks, isContractor);

  function renderPage(tabs, current) {
    return M.pageHeader('Tasks', community)
      + '<div class="tf-bar">'
      + tabs.map(function (t) {
          return '<button class="tf-tab' + (t.key === current ? ' tf-tab--active' : '') + '" data-tab="' + t.key + '">'
            + M.esc(t.label) + '</button>';
        }).join('')
      + '</div>'
      + '<div class="portal-module" style="margin-top:16px">'
      + '  <div class="pm-body pm-body--list" id="tasks-list"></div>'
      + '</div>';
  }

  function filterTasks(tasks, tab, isContractor) {
    if (tab === 'all') return tasks;
    return tasks.filter(function (t) {
      var cls = M.classifyTask(t);
      if (tab === 'active') return cls === 'active' || cls === 'other';
      if (tab === 'overdue') return cls === 'overdue';
      if (tab === 'upcoming') return cls === 'upcoming';
      if (tab === 'completed') return cls === 'completed';
      return true;
    });
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
    container.querySelectorAll('.tf-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        activeTab = btn.dataset.tab;
        container.querySelectorAll('.tf-tab').forEach(function (b) { b.classList.remove('tf-tab--active'); });
        btn.classList.add('tf-tab--active');
        renderList(container, tasks, activeTab, isContractor);
      });
    });
  }
});
