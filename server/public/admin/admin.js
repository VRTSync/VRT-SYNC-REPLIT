(async function() {
  const { apiFetch, showToast } = AdminAPI;

  let currentUser = null;
  let communities = [];

  window.AdminState = {
    getCommunities: () => communities,
    getUser: () => currentUser,
    refreshCommunities,
  };

  async function bootstrap() {
    try {
      const data = await apiFetch('/api/auth/me');
      if (!data || !data.user) {
        window.location.href = '/web/login';
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
        window.location.href = '/web/login';
      });

      await refreshCommunities();

      AdminRouter.init();
      const parsed = AdminRouter.parseRoute();
      AdminRouter.navigate(parsed.route, false, parsed.params);
    } catch (err) {
      console.error('Bootstrap failed:', err);
    }
  }

  async function refreshCommunities() {
    try {
      communities = await apiFetch('/api/communities');
    } catch (err) {
      console.error('Failed to load communities:', err);
    }
  }

  bootstrap();
})();
