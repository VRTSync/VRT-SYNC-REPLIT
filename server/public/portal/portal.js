/* VRTSync Portal Bootstrap
 *
 * Reads window.PORTAL_CONFIG set by each shell template:
 *   { base: '/web/contractor', allowedRoles: ['contractor'], label: 'Contractor Portal' }
 *
 * Validates the logged-in user matches the shell's allowed roles,
 * then renders role-appropriate navigation and community context.
 */
(async function () {
  const { apiFetch, showToast } = PortalAPI;
  const config = window.PORTAL_CONFIG || { base: '/web/portal', allowedRoles: [], label: 'Portal' };

  let currentUser = null;
  let communities = [];
  let activeCommunity = null;

  /* ─── Nav definitions per role ───────────────────────────────────────────── */
  const NAV = {
    contractor: [
      { route: 'dashboard',        label: 'Dashboard',         icon: iconGrid() },
      { route: 'tasks',            label: 'My Tasks',          icon: iconCheckSquare() },
      { route: 'map',              label: 'Map',               icon: iconMap() },
      { route: 'service-schedule', label: 'Service Schedule',  icon: iconCalendar() },
    ],
    hoa_admin: [
      { route: 'dashboard',  label: 'Dashboard',       icon: iconGrid() },
      { route: 'tasks',      label: 'Tasks',           icon: iconCheckSquare() },
      { route: 'requests',   label: 'Requests',        icon: iconInbox() },
      { route: 'map',        label: 'Map',             icon: iconMap() },
      { route: 'documents',  label: 'Documents',       icon: iconFile() },
      { route: 'reports',    label: 'Reports',         icon: iconBarChart() },
      { route: 'contacts',   label: 'Contacts',        icon: iconUsers() },
    ],
    hoa_member: [
      { route: 'dashboard',  label: 'Dashboard',       icon: iconGrid() },
      { route: 'requests',   label: 'Requests',        icon: iconInbox() },
      { route: 'map',        label: 'Map',             icon: iconMap() },
    ],
    property_manager: [
      { route: 'dashboard',  label: 'Dashboard',       icon: iconGrid() },
      { route: 'tasks',      label: 'Tasks',           icon: iconCheckSquare() },
      { route: 'map',        label: 'Map',             icon: iconMap() },
      { route: 'invoices',   label: 'Invoices',        icon: iconDollar() },
      { route: 'documents',  label: 'Documents',       icon: iconFile() },
      { route: 'reports',    label: 'Reports',         icon: iconBarChart() },
      { route: 'users',      label: 'Users',           icon: iconUser() },
      { route: 'contacts',   label: 'Contacts',        icon: iconUsers() },
    ],
  };

  /* ─── Public state (pages call into this) ───────────────────────────────── */
  window.PortalState = {
    getUser:            () => currentUser,
    getCommunities:     () => communities,
    getActiveCommunity: () => activeCommunity,
    getCommunityContext: () => ({
      user: currentUser,
      role: currentUser ? currentUser.role : null,
      communities,
      activeCommunity,
      isMultiCommunityUser: communities.length > 1,
    }),
    setActiveCommunity,
    refreshCommunities,
    isHoaRole:    () => currentUser && (currentUser.role === 'hoa_admin' || currentUser.role === 'hoa_member'),
    isAdmin:      () => currentUser && (currentUser.role === 'admin' || currentUser.role === 'property_manager'),
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

      /* Validate this user belongs on this portal shell */
      if (config.allowedRoles.length > 0 && !config.allowedRoles.includes(role)) {
        /* Redirect them to the correct shell */
        redirectByRole(role);
        return;
      }

      /* Update brand subtitle */
      const brandSub = document.getElementById('brand-sub');
      if (brandSub) brandSub.textContent = config.label;

      /* Render sidebar nav */
      const navItems = NAV[role] || [];
      renderNav(navItems);

      /* Load communities */
      await refreshCommunities();

      /* Resolve active community:
       *  1. HOA users → always their assigned community
       *  2. Others → try localStorage, then auto-pick if single, else null (→ selector) */
      const _lsKey = 'vrtsync_community_' + currentUser.id;
      if (currentUser.hoaCommunityId) {
        activeCommunity = communities.find(c => c.id === currentUser.hoaCommunityId) || communities[0] || null;
      } else {
        const savedId = localStorage.getItem(_lsKey);
        const savedMatch = savedId && communities.find(c => c.id === savedId);
        if (savedMatch) {
          activeCommunity = savedMatch;
        } else if (communities.length === 1) {
          activeCommunity = communities[0];
        } else {
          activeCommunity = null; /* multi-community user — needs to select */
        }
      }

      /* Render topbar */
      renderTopbar();

      /* Logout */
      document.getElementById('logout-btn').addEventListener('click', async () => {
        await apiFetch('/api/auth/logout', { method: 'POST' });
        window.location.href = '/web/login';
      });

      /* Init router, then direct to appropriate starting route */
      PortalRouter.init();
      if (!activeCommunity && communities.length > 1) {
        /* Multi-community user with no saved selection → go to selector */
        PortalRouter.navigate('communities', false);
      } else {
        const parsed = PortalRouter.parseRoute();
        /* Avoid sending single-community users to the selector */
        const startRoute = parsed.route === 'communities' && communities.length <= 1
          ? 'dashboard'
          : parsed.route;
        PortalRouter.navigate(startRoute, false, parsed.params);
      }

    } catch (err) {
      console.error('Portal bootstrap failed:', err);
      const content = document.getElementById('page-content');
      if (content) content.innerHTML = '<div class="empty-state"><p>Failed to load portal. Please refresh.</p></div>';
    }
  }

  /* ─── Role-based redirect (wrong shell) ─────────────────────────────────── */
  function redirectByRole(role) {
    const map = {
      admin:            '/web/admin/dashboard',
      property_manager: '/web/pm/dashboard',
      contractor:       '/web/contractor/dashboard',
      hoa_admin:        '/web/hoa/dashboard',
      hoa_member:       '/web/hoa/dashboard',
    };
    window.location.href = map[role] || '/web/login';
  }

  /* ─── Nav rendering ──────────────────────────────────────────────────────── */
  function renderNav(items) {
    const navLinks = document.getElementById('nav-links');
    if (!navLinks) return;
    navLinks.innerHTML = items.map(item => `
      <li>
        <a href="${config.base}/${item.route}" data-route="${item.route}" class="nav-link">
          ${item.icon}
          ${item.label}
        </a>
      </li>
    `).join('');
  }

  /* ─── Topbar rendering ───────────────────────────────────────────────────── */
  function renderTopbar() {
    const name = currentUser.displayName || currentUser.username || '';

    /* User display name */
    const userDisplay = document.getElementById('user-display');
    if (userDisplay) userDisplay.textContent = name;

    /* Avatar initials */
    const avatar = document.getElementById('user-avatar');
    if (avatar) {
      const parts = name.split(' ').filter(Boolean);
      avatar.textContent = parts.length >= 2
        ? (parts[0][0] + parts[1][0]).toUpperCase()
        : name.slice(0, 2).toUpperCase();
    }

    /* Role tag (hoa shell has a dynamic id for this) */
    const roleTagEl = document.getElementById('user-role-tag');
    if (roleTagEl) {
      const roleMap = { hoa_admin: 'HOA Admin', hoa_member: 'HOA Member', contractor: 'Contractor', property_manager: 'Prop. Mgr' };
      roleTagEl.textContent = roleMap[currentUser.role] || currentUser.role;
    }

    /* Community area */
    const communityArea = document.getElementById('community-area');
    if (!communityArea) return;

    const isHoa = currentUser.role === 'hoa_admin' || currentUser.role === 'hoa_member';

    if (isHoa || communities.length <= 1) {
      const name = activeCommunity ? activeCommunity.name : (communities.length === 0 ? 'No Community' : communities[0]?.name);
      communityArea.innerHTML = `
        <span class="topbar-community-label">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.5;flex-shrink:0"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          ${name}
        </span>
      `;
    } else {
      const opts = communities.map(c =>
        `<option value="${c.id}" ${activeCommunity && activeCommunity.id === c.id ? 'selected' : ''}>${c.name}</option>`
      ).join('');
      communityArea.innerHTML = `<select class="community-select" id="community-picker">${opts}</select>`;
      document.getElementById('community-picker').addEventListener('change', (e) => {
        setActiveCommunity(e.target.value);
      });
    }
  }

  /* ─── Community switching ────────────────────────────────────────────────── */
  function setActiveCommunity(communityId) {
    activeCommunity = communities.find(c => c.id === communityId) || activeCommunity;
    /* Persist selection */
    if (currentUser && activeCommunity) {
      localStorage.setItem('vrtsync_community_' + currentUser.id, activeCommunity.id);
    }
    /* Re-render topbar community area */
    renderTopbar();
    /* Re-render current page with new context */
    const route = PortalRouter.getCurrentRoute();
    if (route) PortalRouter.render(route, PortalRouter.getParams());
  }

  async function refreshCommunities() {
    try {
      communities = await apiFetch('/api/communities');
      if (!Array.isArray(communities)) communities = [];
    } catch (err) {
      console.error('Failed to load communities:', err);
      communities = [];
    }
  }

  /* ─── SVG icons ──────────────────────────────────────────────────────────── */
  function svg(d) {
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  }
  function iconGrid()        { return svg('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>'); }
  function iconCheckSquare() { return svg('<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>'); }
  function iconMap()         { return svg('<polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/>'); }
  function iconCalendar()    { return svg('<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'); }
  function iconInbox()       { return svg('<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/>'); }
  function iconFile()        { return svg('<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>'); }
  function iconBarChart()    { return svg('<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/>'); }
  function iconUser()        { return svg('<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>'); }
  function iconUsers()       { return svg('<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>'); }
  function iconDollar()      { return svg('<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>'); }

  bootstrap();
})();
