window.PortalTopbar = (function () {
  const _api = window.PortalAPI || window.AdminAPI;
  const { apiFetch, showToast } = _api;

  let _unreadCount = 0;
  let _notifPollTimer = null;
  let _openDropdown = null;
  let _initialized = false;

  function init() {
    if (_initialized) return;
    _initialized = true;
    _initNotifBell();
    _initCommunitySelector();
    _initProfileMenu();
    _initGlobalAddMenu();
    _initOutsideClickHandler();
    _startUnreadPoll();
  }

  function _closeAllDropdowns() {
    document.querySelectorAll('.tb-dropdown').forEach(el => el.remove());
    _openDropdown = null;
  }

  function _initOutsideClickHandler() {
    document.addEventListener('click', (e) => {
      if (_openDropdown && !e.target.closest('.tb-dropdown') && !e.target.closest('#notif-btn') && !e.target.closest('.user-profile-chip') && !e.target.closest('#global-add-btn') && !e.target.closest('#community-area')) {
        _closeAllDropdowns();
      }
    });
  }

  function _toggleDropdown(anchorEl, buildFn, id) {
    if (_openDropdown === id) {
      _closeAllDropdowns();
      return;
    }
    _closeAllDropdowns();
    const dd = buildFn();
    dd.classList.add('tb-dropdown');
    dd.dataset.tbDropdown = id;

    const rect = anchorEl.getBoundingClientRect();
    dd.style.position = 'fixed';
    dd.style.top = (rect.bottom + 6) + 'px';
    dd.style.right = (window.innerWidth - rect.right) + 'px';
    dd.style.zIndex = '1500';

    document.body.appendChild(dd);
    _openDropdown = id;
  }

  function _initNotifBell() {
    const btn = document.getElementById('notif-btn');
    if (!btn) return;
    btn.disabled = false;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      _toggleDropdown(btn, _buildNotifPanel, 'notif');
      if (_openDropdown === 'notif') _loadNotifications();
    });
    _fetchUnreadCount();
  }

  async function _fetchUnreadCount() {
    try {
      const data = await apiFetch('/api/notifications/unread-count');
      _unreadCount = data.count || 0;
      _updateBadge();
    } catch (e) { /* silent */ }
  }

  function _updateBadge() {
    const dot = document.getElementById('notif-dot');
    const btn = document.getElementById('notif-btn');
    if (dot) {
      dot.classList.toggle('visible', _unreadCount > 0);
      dot.textContent = _unreadCount > 0 ? (_unreadCount > 99 ? '99+' : String(_unreadCount)) : '';
    }
    if (btn) {
      btn.classList.toggle('has-unread', _unreadCount > 0);
    }
    const countEl = document.querySelector('.tb-notif-count');
    if (countEl) {
      countEl.textContent = _unreadCount > 0 ? _unreadCount + ' unread' : '';
    }
  }

  function _startUnreadPoll() {
    if (_notifPollTimer) clearInterval(_notifPollTimer);
    _notifPollTimer = setInterval(() => _fetchUnreadCount(), 30000);
  }

  function _buildNotifPanel() {
    const panel = document.createElement('div');
    panel.className = 'tb-notif-panel';
    panel.innerHTML = `
      <div class="tb-notif-header">
        <span class="tb-notif-title">Notifications</span>
        <span class="tb-notif-count">${_unreadCount > 0 ? _unreadCount + ' unread' : ''}</span>
        <button class="tb-notif-mark-all btn btn-ghost btn-xs">Mark all read</button>
      </div>
      <div class="tb-notif-body">
        <div class="loading-spinner" style="padding:24px 0;font-size:13px;">Loading...</div>
      </div>
    `;
    panel.querySelector('.tb-notif-mark-all').addEventListener('click', _markAllRead);
    return panel;
  }

  async function _loadNotifications() {
    const body = document.querySelector('.tb-notif-body');
    if (!body) return;
    try {
      const notifs = await apiFetch('/api/notifications?limit=20');
      if (!Array.isArray(notifs) || notifs.length === 0) {
        body.innerHTML = '<div class="tb-notif-empty">No notifications yet.</div>';
        return;
      }
      const unread = notifs.filter(n => !n.readAt);
      const read = notifs.filter(n => n.readAt);
      const sorted = [...unread, ...read];
      body.innerHTML = sorted.map(n => _renderNotifItem(n)).join('');
      body.querySelectorAll('.tb-notif-item').forEach(item => {
        item.addEventListener('click', () => _onNotifClick(item.dataset.notifId, item.dataset.type, item.dataset.taskId, item.classList.contains('tb-notif-unread')));
      });
    } catch (e) {
      body.innerHTML = '<div class="tb-notif-empty">Failed to load notifications.</div>';
    }
  }

  function _renderNotifItem(n) {
    const isUnread = !n.readAt;
    const timeAgo = _timeAgo(n.createdAt);
    const icon = _notifIcon(n.type);
    return `
      <div class="tb-notif-item ${isUnread ? 'tb-notif-unread' : ''}" data-notif-id="${_esc(n.id)}" data-type="${_esc(n.type || '')}" data-task-id="${_esc(n.relatedTaskId || '')}">
        <div class="tb-notif-item-icon">${icon}</div>
        <div class="tb-notif-item-body">
          <div class="tb-notif-item-title">${_esc(n.title)}</div>
          <div class="tb-notif-item-text">${_esc(n.body)}</div>
          <div class="tb-notif-item-time">${timeAgo}</div>
        </div>
        ${isUnread ? '<div class="tb-notif-item-dot"></div>' : ''}
      </div>
    `;
  }

  function _notifIcon(type) {
    const svg = (d) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
    if (type && type.includes('task')) return svg('<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>');
    if (type && type.includes('invoice')) return svg('<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>');
    if (type && type.includes('document')) return svg('<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>');
    return svg('<path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/>');
  }

  async function _onNotifClick(notifId, type, taskId, wasUnread) {
    if (!notifId) return;
    try {
      await apiFetch('/api/notifications/' + notifId + '/read', { method: 'PUT' });
      if (wasUnread) {
        _unreadCount = Math.max(0, _unreadCount - 1);
        _updateBadge();
      }
      const item = document.querySelector('[data-notif-id="' + notifId + '"]');
      if (item) {
        item.classList.remove('tb-notif-unread');
        const dot = item.querySelector('.tb-notif-item-dot');
        if (dot) dot.remove();
      }
    } catch (e) { /* silent */ }

    _closeAllDropdowns();

    const router = window.PortalRouter || window.AdminRouter;
    if (!router) return;

    if (taskId) {
      window._pendingOpenTaskDetail = taskId;
      router.navigate('tasks', true, {});
    } else if (type && type.includes('invoice')) {
      router.navigate('invoices', true, {});
    } else if (type && type.includes('document')) {
      router.navigate('documents', true, {});
    } else {
      router.navigate('dashboard', true, {});
    }
  }

  async function _markAllRead() {
    try {
      await apiFetch('/api/notifications/read-all', { method: 'PUT' });
      _unreadCount = 0;
      _updateBadge();
      document.querySelectorAll('.tb-notif-item').forEach(item => {
        item.classList.remove('tb-notif-unread');
        const dot = item.querySelector('.tb-notif-item-dot');
        if (dot) dot.remove();
      });
      showToast('All notifications marked as read', 'info');
    } catch (e) {
      showToast('Failed to mark all as read', 'error');
    }
  }

  function _initCommunitySelector() {
    const area = document.getElementById('community-area');
    if (!area) return;

    area.addEventListener('click', (e) => {
      e.stopPropagation();
      const state = window.PortalState;
      if (!state) return;

      const communities = state.getCommunities();
      const user = state.getUser();
      if (!user) return;

      const isHoa = user.role === 'hoa_admin' || user.role === 'hoa_member';
      if (isHoa || communities.length <= 1) return;

      area.style.cursor = 'pointer';
      _toggleDropdown(area, () => _buildCommunityDropdown(communities, state.getActiveCommunity()), 'community');
    });
  }

  function _buildCommunityDropdown(communities, active) {
    const dd = document.createElement('div');
    dd.className = 'tb-menu-dropdown';
    dd.innerHTML = `
      <div class="tb-menu-header">Switch Community</div>
      ${communities.map(c => `
        <div class="tb-menu-item ${active && active.id === c.id ? 'tb-menu-item--active' : ''}" data-community-id="${_esc(c.id)}">
          <span class="tb-menu-item-label">${_esc(c.name)}</span>
          ${active && active.id === c.id ? '<span class="tb-menu-check">\u2713</span>' : ''}
        </div>
      `).join('')}
    `;
    dd.querySelectorAll('[data-community-id]').forEach(item => {
      item.addEventListener('click', () => {
        const id = item.dataset.communityId;
        _closeAllDropdowns();
        if (window.PortalState) window.PortalState.setActiveCommunity(id);
      });
    });
    return dd;
  }

  function _initProfileMenu() {
    const chip = document.querySelector('.user-profile-chip');
    if (!chip) return;
    chip.style.cursor = 'pointer';
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      _toggleDropdown(chip, _buildProfileMenu, 'profile');
    });
  }

  function _buildProfileMenu() {
    const state = window.PortalState || window.AdminState;
    const user = state ? state.getUser() : null;
    const name = user ? (user.displayName || user.username || 'User') : 'User';
    const roleMap = { admin: 'Admin', hoa_admin: 'HOA Admin', hoa_member: 'HOA Member', contractor: 'Contractor', property_manager: 'Property Manager' };
    const roleLabel = user ? (roleMap[user.role] || user.role) : '';

    const dd = document.createElement('div');
    dd.className = 'tb-menu-dropdown';
    dd.innerHTML = `
      <div class="tb-profile-header">
        <div class="tb-profile-name">${_esc(name)}</div>
        <div class="tb-profile-role">${_esc(roleLabel)}</div>
      </div>
      <div class="tb-menu-divider"></div>
      <div class="tb-menu-item tb-menu-item--danger" id="tb-profile-logout">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        <span class="tb-menu-item-label">Logout</span>
      </div>
    `;
    dd.querySelector('#tb-profile-logout').addEventListener('click', async () => {
      _closeAllDropdowns();
      try {
        await apiFetch('/api/auth/logout', { method: 'POST' });
      } catch (e) { /* silent */ }
      window.location.href = '/web/login';
    });
    return dd;
  }

  function _initGlobalAddMenu() {
    const btn = document.getElementById('global-add-btn');
    if (!btn) return;
    btn.disabled = false;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      _toggleDropdown(btn, _buildAddMenu, 'addmenu');
    });
  }

  function _buildAddMenu() {
    const state = window.PortalState || window.AdminState;
    const user = state ? state.getUser() : null;
    const role = user ? user.role : '';

    let items = [];
    if (role === 'property_manager') {
      items = [
        { label: 'Create Task', icon: _menuIcon('task'), action: 'create_task', enabled: true },
        { label: 'Add User', icon: _menuIcon('user'), action: null, enabled: false },
        { label: 'Upload Document', icon: _menuIcon('doc'), action: 'documents', enabled: false },
      ];
    } else if (role === 'hoa_admin') {
      items = [
        { label: 'New Request', icon: _menuIcon('task'), action: 'create_request', enabled: true },
        { label: 'Upload Document', icon: _menuIcon('doc'), action: 'documents', enabled: false },
      ];
    } else if (role === 'admin') {
      items = [
        { label: 'Create Task', icon: _menuIcon('task'), action: 'create_task', enabled: true },
        { label: 'Add User', icon: _menuIcon('user'), action: 'users', enabled: true },
        { label: 'Upload Document', icon: _menuIcon('doc'), action: null, enabled: false },
      ];
    } else {
      items = [
        { label: 'Coming Soon', icon: _menuIcon('clock'), action: null, enabled: false },
      ];
    }

    const dd = document.createElement('div');
    dd.className = 'tb-menu-dropdown';
    dd.innerHTML = `
      <div class="tb-menu-header">Quick Actions</div>
      ${items.map(it => `
        <div class="tb-menu-item ${!it.enabled ? 'tb-menu-item--disabled' : ''}" data-action="${_esc(it.action || '')}">
          ${it.icon}
          <span class="tb-menu-item-label">${_esc(it.label)}</span>
          ${!it.enabled ? '<span class="tb-menu-soon">Soon</span>' : ''}
        </div>
      `).join('')}
    `;
    dd.querySelectorAll('.tb-menu-item:not(.tb-menu-item--disabled)').forEach(item => {
      item.addEventListener('click', () => {
        const action = item.dataset.action;
        _closeAllDropdowns();
        if (action === 'create_task') {
          window._pendingOpenCreateTask = true;
          const router = window.PortalRouter || window.AdminRouter;
          if (router) router.navigate('tasks', true, {});
          return;
        }
        if (action === 'create_request') {
          window._pendingOpenNewRequest = true;
          const router = window.PortalRouter || window.AdminRouter;
          if (router) router.navigate('requests', true, {});
          return;
        }
        const router = window.PortalRouter || window.AdminRouter;
        if (router && action) router.navigate(action, true, {});
      });
    });
    return dd;
  }

  function _menuIcon(type) {
    const s = (d) => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
    if (type === 'task') return s('<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>');
    if (type === 'user') return s('<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>');
    if (type === 'doc') return s('<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>');
    if (type === 'clock') return s('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>');
    return '';
  }

  function _timeAgo(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((now - d) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function _esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  return { init };
})();
