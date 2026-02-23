AdminRouter.register('dashboard', async function(container) {
  const { apiFetchWithRetry, showToast } = AdminAPI;

  const breadcrumb = document.getElementById('breadcrumb-area');
  if (breadcrumb) breadcrumb.innerHTML = '';

  container.innerHTML = `
    <div class="page-header"><h1>Dashboard</h1></div>
    <div class="stats-grid" id="dash-stats">
      <div class="stat-card"><div class="stat-label">Loading...</div><div class="stat-value">&mdash;</div></div>
    </div>
  `;

  async function loadDashboard() {
    const grid = document.getElementById('dash-stats');
    if (!grid) return;
    grid.innerHTML = `<div class="stat-card"><div class="stat-label">Loading...</div><div class="stat-value">&mdash;</div></div>`;

    try {
      const summary = await apiFetchWithRetry('/api/admin/summary');
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
      const message = err.isTimeout
        ? 'The request timed out. The server may be busy.'
        : (err.message || 'Could not connect to the server.');
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 2rem;">
          <p style="color: #999; margin-bottom: 1rem;">${message}</p>
          <button id="dash-retry-btn" class="btn btn-primary">Retry</button>
        </div>
      `;
      const retryBtn = document.getElementById('dash-retry-btn');
      if (retryBtn) {
        retryBtn.addEventListener('click', loadDashboard);
      }
    }
  }

  await loadDashboard();
});
