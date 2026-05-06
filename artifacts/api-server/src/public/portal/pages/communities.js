/* Community Selector Page
 * Route: 'communities'
 * Shown to multi-community users before entering their dashboard.
 */
PortalRouter.register('communities', function (container) {
  const { esc } = PortalModules;
  const ctx = PortalState.getCommunityContext();

  /* Single-community users should never land here — auto-forward */
  if (ctx.communities.length === 1) {
    PortalState.setActiveCommunity(ctx.communities[0].id);
    PortalRouter.navigate('dashboard');
    return;
  }

  /* No communities at all */
  if (ctx.communities.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="margin-top:80px;">
        <h3 style="color:var(--navy);margin-bottom:8px;">No communities assigned</h3>
        <p style="color:var(--gray-500);">Contact your administrator to get access.</p>
      </div>`;
    return;
  }

  container.innerHTML = `
    <div class="csp-wrap">
      <div class="csp-hero">
        <h1 class="csp-title">Select a Community</h1>
        <p class="csp-sub">Choose the community you'd like to work in today.</p>
      </div>
      <div class="csp-grid" id="csp-grid">
        ${ctx.communities.map(c => communityCard(c, ctx.activeCommunity)).join('')}
      </div>
    </div>
  `;

  /* Wire up clicks */
  container.querySelectorAll('[data-community-id]').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.communityId;
      PortalState.setActiveCommunity(id);
      PortalRouter.navigate('dashboard');
    });
  });
});

function communityCard(community, active) {
  const { esc } = PortalModules;
  const isActive = active && active.id === community.id;
  return `
    <div class="community-card-sel ${isActive ? 'community-card-sel--active' : ''}"
         data-community-id="${esc(community.id)}"
         role="button" tabindex="0">
      <div class="ccs-icon">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
          <polyline points="9 22 9 12 15 12 15 22"/>
        </svg>
      </div>
      <div class="ccs-body">
        <div class="ccs-name">${esc(community.name)}</div>
        ${community.address ? `<div class="ccs-address">${esc(community.address)}</div>` : ''}
      </div>
      ${isActive ? `<div class="ccs-active-dot" title="Currently active"></div>` : ''}
      <div class="ccs-arrow">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </div>
    </div>
  `;
}
