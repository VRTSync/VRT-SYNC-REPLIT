PortalRouter.register('dashboard', async function(container) {
  const { apiFetch } = PortalAPI;
  const user = PortalState.getUser();
  const community = PortalState.getActiveCommunity();

  container.innerHTML = `
    <div class="page-header">
      <h1>Dashboard</h1>
    </div>
    <div class="empty-state" style="margin-top:60px;">
      <div style="font-size:48px;margin-bottom:16px;">🏗️</div>
      <h3 style="color:var(--navy);margin-bottom:8px;">Coming Soon</h3>
      <p style="color:var(--gray-500);">The ${user ? user.role.replace('_', ' ') : ''} dashboard is being built.</p>
      ${community ? `<p style="color:var(--gray-400);margin-top:8px;font-size:13px;">Community: ${community.name}</p>` : ''}
    </div>
  `;
});
