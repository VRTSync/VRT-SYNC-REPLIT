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

      const name = currentUser.displayName || currentUser.username || '';
      document.getElementById('user-display').textContent = name;
      const roleTag = document.querySelector('.user-role-tag');
      if (roleTag) roleTag.textContent = window.VRT_ROLE_LABELS[currentUser.role] || currentUser.role;

      const avatar = document.getElementById('user-avatar');
      if (avatar) {
        if (currentUser.avatarUrl) {
          const safeUrl = String(currentUser.avatarUrl).replace(/"/g, '&quot;');
          avatar.innerHTML = '<img src="' + safeUrl + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;" />';
        } else {
          const parts = name.split(' ').filter(Boolean);
          avatar.textContent = parts.length >= 2
            ? (parts[0][0] + parts[1][0]).toUpperCase()
            : name.slice(0, 2).toUpperCase();
        }
      }

      document.getElementById('logout-btn').addEventListener('click', async () => {
        await apiFetch('/api/auth/logout', { method: 'POST' });
        window.location.replace('/web/login');
      });

      await refreshCommunities();

      AdminRouter.init();
      const parsed = AdminRouter.parseRoute();
      const bootUrl = new URL(window.location.href);
      if (parsed.route === 'community-detail' && parsed.params.tab === 'tasks') {
        parsed.params.task = bootUrl.searchParams.get('task');
      }
      const action = bootUrl.searchParams.get('action');
      const formButton = parsed.route === 'users' && action === 'create_user' ? 'create-user-btn'
        : parsed.route === 'communities' && action === 'new_community' ? 'add-community-btn' : null;
      if (formButton) {
        // These pages render asynchronously. Observe only until this initial form is ready.
        const container = document.getElementById('page-content');
        const observer = new MutationObserver(openBootForm);
        const timeout = setTimeout(() => {
          observer.disconnect();
          showToast('Unable to open the requested form. Please try again.', 'error');
        }, 15000);
        function openBootForm() {
          const button = document.getElementById(formButton);
          if (!button) return;
          observer.disconnect();
          clearTimeout(timeout);
          setTimeout(() => {
            if (!button.isConnected || AdminRouter.getCurrentRoute() !== parsed.route) return;
            button.click();
            const url = new URL(window.location.href);
            if (url.searchParams.get('action') === action) {
              url.searchParams.delete('action');
              history.replaceState(history.state, '', url.pathname + url.search + url.hash);
            }
          }, 0);
        }
        observer.observe(container, { childList: true, subtree: true });
      }
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

  // Guard against bfcache restoring a stale authenticated page after logout.
  // When the browser serves a page from bfcache (e.g. after Back), reload it so
  // requireRole on the server runs and redirects to /web/login if the session ended.
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) window.location.reload();
  });
})();
