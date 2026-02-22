(async function() {
  const { apiFetch, showToast } = AdminAPI;

  let currentUser = null;
  let communities = [];

  function getActiveCommunityId() {
    return localStorage.getItem('admin_community_id') || '';
  }

  function setActiveCommunityId(id) {
    localStorage.setItem('admin_community_id', id);
  }

  window.AdminState = {
    getActiveCommunityId,
    setActiveCommunityId,
    getCommunities: () => communities,
    getUser: () => currentUser,
    refreshCommunities,
  };

  async function bootstrap() {
    try {
      const data = await apiFetch('/api/auth/me');
      if (!data || !data.user) {
        window.location.href = '/web/admin/login';
        return;
      }
      currentUser = data.user;
      if (currentUser.role !== 'admin') {
        document.getElementById('page-content').innerHTML =
          '<div class="empty-state"><p>Not authorized. Admin access required.</p></div>';
        return;
      }

      document.getElementById('user-display').textContent = currentUser.displayName || currentUser.username;

      document.getElementById('logout-btn').addEventListener('click', async () => {
        await apiFetch('/api/auth/logout', { method: 'POST' });
        window.location.href = '/web/admin/login';
      });

      await refreshCommunities();
      setupCommunitySelector();

      AdminRouter.init();
      const route = AdminRouter.getRouteFromPath();
      AdminRouter.navigate(route, false);
    } catch (err) {
      console.error('Bootstrap failed:', err);
    }
  }

  async function refreshCommunities() {
    try {
      communities = await apiFetch('/api/communities');
      populateCommunitySelector();
    } catch (err) {
      console.error('Failed to load communities:', err);
    }
  }

  function populateCommunitySelector() {
    const sel = document.getElementById('community-selector');
    const activeId = getActiveCommunityId();
    sel.innerHTML = '<option value="">All communities</option>';
    communities.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      if (c.id === activeId) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function setupCommunitySelector() {
    const sel = document.getElementById('community-selector');
    sel.addEventListener('change', () => {
      setActiveCommunityId(sel.value);
      const route = AdminRouter.getCurrentRoute() || AdminRouter.getRouteFromPath();
      AdminRouter.navigate(route, false);
    });
  }

  bootstrap();
})();
