/* VRTSync Portal — Role-aware bootstrap
 *
 * Roles and their nav:
 *   admin / property_manager → full management nav (communities, users, tasks, map, reports)
 *   contractor               → my tasks, map, service schedule
 *   hoa_admin                → dashboard, tasks/requests, map, settings
 *   hoa_member               → dashboard, requests, map
 */

(async function () {
  const { apiFetch, showToast } = PortalAPI;

  let currentUser = null;
  let communities = [];
  let activeCommunity = null;

  /* ─── Nav definitions per role ──────────────────────────────────────────── */
  const NAV = {
    admin: [
      { route: 'dashboard', label: 'Dashboard', icon: iconGrid() },
      { route: 'communities', label: 'Communities', icon: iconBuilding() },
      { route: 'tasks', label: 'Tasks', icon: iconCheckSquare() },
      { route: 'map', label: 'Map', icon: iconMap() },
      { route: 'users', label: 'Users', icon: iconUser() },
      { route: 'reports', label: 'Reports', icon: iconBarChart() },
    ],
    property_manager: [
      { route: 'dashboard', label: 'Dashboard', icon: iconGrid() },
      { route: 'communities', label: 'Communities', icon: iconBuilding() },
      { route: 'tasks', label: 'Tasks', icon: iconCheckSquare() },
      { route: 'map', label: 'Map', icon: iconMap() },
      { route: 'reports', label: 'Reports', icon: iconBarChart() },
    ],
    contractor: [
      { route: 'dashboard', label: 'Dashboard', icon: iconGrid() },
      { route: 'tasks', label: 'My Tasks', icon: iconCheckSquare() },
      { route: 'map', label: 'Map', icon: iconMap() },
      { route: 'service-schedule', label: 'Service Schedule', icon: iconCalendar() },
    ],
    hoa_admin: [
      { route: 'dashboard', label: 'Dashboard', icon: iconGrid() },
      { route: 'tasks', label: 'Tasks & Requests', icon: iconCheckSquare() },
      { route: 'requests', label: 'My Requests', icon: iconInbox() },
      { route: 'map', label: 'Map', icon: iconMap() },
      { route: 'settings', label: 'Settings', icon: iconSettings() },
    ],
    hoa_member: [
      { route: 'dashboard', label: 'Dashboard', icon: iconGrid() },
      { route: 'requests', label: 'Requests', icon: iconInbox() },
      { route: 'map', label: 'Map', icon: iconMap() },
    ],
  };

  /* ─── Role display label ─────────────────────────────────────────────────── */
  const ROLE_LABEL = {
    admin: 'Admin Hub',
    property_manager: 'Property Manager',
    contractor: 'Contractor Portal',
    hoa_admin: 'HOA Admin',
    hoa_member: 'HOA Member',
  };

  /* ─── Public state object (pages access this) ───────────────────────────── */
  window.PortalState = {
    getUser: () => currentUser,
    getCommunities: () => communities,
    getActiveCommunity: () => activeCommunity,
    setActiveCommunity,
    refreshCommunities,
    isHoaRole: () => currentUser && (currentUser.role === 'hoa_admin' || currentUser.role === 'hoa_member'),
    isAdmin: () => currentUser && (currentUser.role === 'admin' || currentUser.role === 'property_manager'),
    isContractor: () => currentUser && currentUser.role === 'contractor',
  };

  /* ─── Bootstrap ─────────────────────────────────────────────────────────── */
  async function bootstrap() {
    try {
      const data = await apiFetch('/api/auth/me');
      if (!data || !data.user) {
        window.location.href = '/web/login';
        return;
      }

      currentUser = data.user;
      const role = currentUser.role;

      /* Super admins: redirect to the dedicated admin hub */
      if (role === 'admin') {
        window.location.href = '/web/admin/dashboard';
        return;
      }

      /* Roles without a portal mapping fall back to login */
      const navItems = NAV[role];
      if (!navItems) {
        window.location.href = '/web/login';
        return;
      }

      /* Update brand subtitle */
      const brandSub = document.getElementById('brand-sub');
      if (brandSub) brandSub.textContent = ROLE_LABEL[role] || 'Portal';

      /* Render nav */
      renderNav(navItems);

      /* Load communities */
      await refreshCommunities();

      /* HOA users are locked to their one community */
      if (currentUser.hoaCommunityId) {
        activeCommunity = communities.find(c => c.id === currentUser.hoaCommunityId) || communities[0] || null;
      } else if (communities.length > 0) {
        activeCommunity = communities[0];
      }

      /* Render topbar context (user badge + community picker) */
      renderTopbar();

      /* Wire logout */
      document.getElementById('logout-btn').addEventListener('click', async () => {
        await apiFetch('/api/auth/logout', { method: 'POST' });
        window.location.href = '/web/login';
      });

      /* Init router and navigate to current path */
      PortalRouter.init();
      const parsed = PortalRouter.parseRoute();
      PortalRouter.navigate(parsed.route, false, parsed.params);

    } catch (err) {
      console.error('Portal bootstrap failed:', err);
      document.getElementById('page-content').innerHTML =
        '<div class="empty-state"><p>Failed to load portal. Please refresh.</p></div>';
    }
  }

  /* ─── Nav rendering ──────────────────────────────────────────────────────── */
  function renderNav(items) {
    const navLinks = document.getElementById('nav-links');
    navLinks.innerHTML = items.map(item => `
      <li>
        <a href="/web/portal/${item.route}" data-route="${item.route}" class="nav-link">
          ${item.icon}
          ${item.label}
        </a>
      </li>
    `).join('');
  }

  /* ─── Topbar rendering ───────────────────────────────────────────────────── */
  function renderTopbar() {
    const userDisplay = document.getElementById('user-display');
    if (userDisplay) {
      userDisplay.textContent = currentUser.displayName || currentUser.username;
    }

    const communityArea = document.getElementById('community-area');
    if (!communityArea) return;

    const isHoa = currentUser.role === 'hoa_admin' || currentUser.role === 'hoa_member';

    if (isHoa || communities.length <= 1) {
      /* Fixed community — show as label */
      const name = activeCommunity ? activeCommunity.name : 'No Community';
      communityArea.innerHTML = `<span class="community-label">${name}</span>`;
    } else {
      /* Multi-community — show picker */
      const opts = communities.map(c =>
        `<option value="${c.id}" ${activeCommunity && activeCommunity.id === c.id ? 'selected' : ''}>${c.name}</option>`
      ).join('');
      communityArea.innerHTML = `
        <select class="community-select" id="community-picker">
          ${opts}
        </select>
      `;
      document.getElementById('community-picker').addEventListener('change', (e) => {
        setActiveCommunity(e.target.value);
      });
    }
  }

  /* ─── Community switching ────────────────────────────────────────────────── */
  function setActiveCommunity(communityId) {
    activeCommunity = communities.find(c => c.id === communityId) || activeCommunity;
    /* Re-render the current page so it reacts to the new community */
    const route = PortalRouter.getCurrentRoute();
    if (route) PortalRouter.render(route, PortalRouter.getParams());
  }

  /* ─── Refresh communities ─────────────────────────────────────────────────── */
  async function refreshCommunities() {
    try {
      communities = await apiFetch('/api/communities');
    } catch (err) {
      console.error('Failed to load communities:', err);
      communities = [];
    }
  }

  /* ─── SVG icon helpers ───────────────────────────────────────────────────── */
  function icon(paths) {
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  }
  function iconGrid() { return icon('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>'); }
  function iconBuilding() { return icon('<path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>'); }
  function iconCheckSquare() { return icon('<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>'); }
  function iconMap() { return icon('<polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/>'); }
  function iconUser() { return icon('<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>'); }
  function iconBarChart() { return icon('<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/>'); }
  function iconCalendar() { return icon('<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'); }
  function iconInbox() { return icon('<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/>'); }
  function iconSettings() { return icon('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>'); }

  bootstrap();
})();
