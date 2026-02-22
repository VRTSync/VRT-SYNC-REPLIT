AdminRouter.register('dashboard', async function(container) {
  const { apiFetch } = AdminAPI;

  const breadcrumb = document.getElementById('breadcrumb-area');
  if (breadcrumb) breadcrumb.innerHTML = '';

  container.innerHTML = `
    <div class="page-header"><h1>Dashboard</h1></div>
    <div class="stats-grid" id="dash-stats">
      <div class="stat-card"><div class="stat-label">Loading...</div><div class="stat-value">—</div></div>
    </div>
  `;

  try {
    const summary = await apiFetch('/api/admin/summary');
    const grid = document.getElementById('dash-stats');
    grid.innerHTML = `
      <div class="stat-card blue">
        <div class="stat-label">Communities</div>
        <div class="stat-value">${summary.communitiesCount}</div>
      </div>
      <div class="stat-card teal">
        <div class="stat-label">Active Assets</div>
        <div class="stat-value">${summary.activeAssetsCount}</div>
      </div>
      <div class="stat-card amber">
        <div class="stat-label">Incomplete Assets</div>
        <div class="stat-value">${summary.incompleteAssetsCount}</div>
      </div>
      <div class="stat-card red">
        <div class="stat-label">Archived Assets</div>
        <div class="stat-value">${summary.archivedAssetsCount}</div>
      </div>
      <div class="stat-card green">
        <div class="stat-label">Total Tasks</div>
        <div class="stat-value">${summary.tasksCount}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Pending Tasks</div>
        <div class="stat-value">${summary.pendingTasksCount}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Completed Tasks</div>
        <div class="stat-value">${summary.completedTasksCount}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Map Layers</div>
        <div class="stat-value">${summary.mapLayersCount}</div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>Failed to load dashboard</p></div>`;
  }
});
