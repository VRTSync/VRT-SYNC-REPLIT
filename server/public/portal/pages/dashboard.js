/* Dashboard — placeholder for Slice 1.
 * Subsequent slices will replace this with role-specific dashboard content.
 */
PortalRouter.register('dashboard', async function (container) {
  const user = PortalState.getUser();
  const community = PortalState.getActiveCommunity();

  const roleLabels = {
    contractor:       'Contractor',
    hoa_admin:        'HOA Admin',
    hoa_member:       'HOA Member',
    property_manager: 'Property Manager',
  };

  const roleLabel = user ? (roleLabels[user.role] || user.role) : '';
  const communityLine = community
    ? `<p style="color:var(--teal);font-size:13px;font-weight:600;margin-top:6px;">${community.name}</p>`
    : '';

  container.innerHTML = `
    <div class="page-header">
      <h1>Dashboard</h1>
    </div>
    <div style="display:flex;align-items:center;justify-content:center;min-height:420px;">
      <div style="text-align:center;max-width:400px;">
        <div style="
          width:72px;height:72px;
          background:linear-gradient(135deg,var(--teal),var(--teal-dark));
          border-radius:20px;
          display:flex;align-items:center;justify-content:center;
          margin:0 auto 24px;
          box-shadow:0 4px 20px rgba(37,193,172,0.35);
        ">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
            <rect x="3" y="3" width="7" height="7"/>
            <rect x="14" y="3" width="7" height="7"/>
            <rect x="3" y="14" width="7" height="7"/>
            <rect x="14" y="14" width="7" height="7"/>
          </svg>
        </div>
        <h2 style="font-size:22px;font-weight:700;color:var(--navy);margin-bottom:8px;">
          Welcome, ${user ? (user.displayName || user.username) : 'there'}
        </h2>
        <p style="color:var(--gray-500);font-size:14px;line-height:1.6;">
          Your <strong>${roleLabel}</strong> dashboard is coming in the next slice.
        </p>
        ${communityLine}
      </div>
    </div>
  `;
});
