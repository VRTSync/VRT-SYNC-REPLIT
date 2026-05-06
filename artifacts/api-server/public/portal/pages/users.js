PortalRouter.register('users', async function(container) {
  var ctx = PortalState.getCommunityContext();
  var role = ctx.role;
  var community = ctx.activeCommunity;

  if (!community) {
    if (ctx.isMultiCommunityUser) {
      PortalRouter.navigate('communities');
      return;
    }
    container.innerHTML = `
      <div class="empty-state" style="margin-top:80px;">
        <h3 style="color:var(--navy);margin-bottom:8px;">No community assigned</h3>
        <p style="color:var(--gray-500);">Contact your administrator to get access to a community.</p>
      </div>`;
    return;
  }

  if (role !== 'property_manager' && role !== 'hoa_admin') {
    container.innerHTML = '<div class="empty-state" style="margin-top:80px;"><p style="color:var(--gray-500);">You do not have access to this page.</p></div>';
    return;
  }

  var isPM = role === 'property_manager';

  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  var allUsers = [];
  var searchTerm = '';
  var filterRole = '';
  var filterStatus = '';

  var HOA_MEMBER_LIMIT = 2;

  function getHoaMemberCount() {
    return allUsers.filter(function(u) { return u.role === 'hoa_member'; }).length;
  }

  function renderPage() {
    var memberCount = getHoaMemberCount();
    var seatDisplay = 'HOA Members: ' + memberCount + ' / ' + HOA_MEMBER_LIMIT + ' included';
    var seatColor = memberCount >= HOA_MEMBER_LIMIT ? 'var(--red, #dc2626)' : 'var(--teal)';
    var createBtnLabel = isPM ? '+ Add User' : '+ Add Member';

    container.innerHTML = `
      <div class="page-header">
        <h1>Users</h1>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <span style="font-size:13px;font-weight:600;color:${seatColor};background:rgba(0,0,0,0.04);padding:6px 12px;border-radius:20px;border:1px solid currentColor" id="seat-display">${esc(seatDisplay)}</span>
          <button class="btn btn-primary btn-sm" id="create-user-btn">${createBtnLabel}</button>
        </div>
      </div>

      <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap">
        <input class="form-input" id="search-input" placeholder="Search by name or username…" style="max-width:260px;font-size:14px;" value="${esc(searchTerm)}" />
        ${isPM ? `
        <select class="form-select" id="filter-role" style="max-width:160px;font-size:14px;">
          <option value="">All roles</option>
          <option value="hoa_admin"${filterRole==='hoa_admin'?' selected':''}>HOA Admin</option>
          <option value="hoa_member"${filterRole==='hoa_member'?' selected':''}>HOA Member</option>
        </select>` : ''}
        <select class="form-select" id="filter-status" style="max-width:140px;font-size:14px;">
          <option value="">All statuses</option>
          <option value="active"${filterStatus==='active'?' selected':''}>Active</option>
          <option value="inactive"${filterStatus==='inactive'?' selected':''}>Inactive</option>
        </select>
      </div>

      <div class="table-container">
        <table>
          <thead><tr>
            <th>Name</th>
            <th>Username</th>
            <th>Role</th>
            <th>Status</th>
            <th class="text-right">Actions</th>
          </tr></thead>
          <tbody id="users-tbody">
            <tr><td colspan="5" class="loading-spinner">Loading...</td></tr>
          </tbody>
        </table>
      </div>

      <div class="modal-overlay" id="create-user-modal" style="display:none">
        <div class="modal" style="max-width:420px">
          <div class="modal-header">
            <h3>Add User</h3>
            <button class="modal-close" id="create-close">&times;</button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label class="form-label">Username</label>
              <input class="form-input" id="new-username" placeholder="Username" autocomplete="off" />
            </div>
            <div class="form-group">
              <label class="form-label">Display Name</label>
              <input class="form-input" id="new-displayname" placeholder="Display Name" />
            </div>
            <div class="form-group">
              <label class="form-label">Password</label>
              <input class="form-input" id="new-password" type="password" placeholder="Password (min. 6 chars)" />
            </div>
            ${isPM ? `
            <div class="form-group">
              <label class="form-label">Role</label>
              <select class="form-select" id="new-role">
                <option value="hoa_member">HOA Member</option>
                <option value="hoa_admin">HOA Admin</option>
              </select>
            </div>` : ''}
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" id="create-cancel">Cancel</button>
            <button class="btn btn-primary" id="create-submit">Create</button>
          </div>
        </div>
      </div>

      <div class="modal-overlay" id="edit-user-modal" style="display:none">
        <div class="modal" style="max-width:420px">
          <div class="modal-header">
            <h3 id="edit-modal-title">Edit User</h3>
            <button class="modal-close" id="edit-close">&times;</button>
          </div>
          <div class="modal-body">
            <div style="margin-bottom:16px;padding:12px 16px;background:var(--gray-50,#f9fafb);border-radius:8px;border:1px solid var(--gray-200,#e5e7eb)">
              <div style="font-size:12px;color:var(--gray-400,#9ca3af);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Username</div>
              <div style="font-weight:600;color:var(--navy,#0a1628)" id="edit-username-display"></div>
            </div>
            ${isPM ? `
            <div class="form-group">
              <label class="form-label">Role</label>
              <select class="form-select" id="edit-role">
                <option value="hoa_member">HOA Member</option>
                <option value="hoa_admin">HOA Admin</option>
              </select>
            </div>` : ''}
            <div class="form-group">
              <label class="form-label">Status</label>
              <select class="form-select" id="edit-status">
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </div>
          </div>
          <div class="modal-footer" style="justify-content:space-between">
            <button class="btn btn-secondary" id="edit-remove-btn" style="color:var(--red,#dc2626)">Remove from Community</button>
            <div style="display:flex;gap:8px">
              <button class="btn btn-secondary" id="edit-cancel">Cancel</button>
              <button class="btn btn-primary" id="edit-submit">Save</button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.getElementById('search-input').addEventListener('input', function(e) {
      searchTerm = e.target.value;
      renderTable();
    });

    if (isPM) {
      document.getElementById('filter-role').addEventListener('change', function(e) {
        filterRole = e.target.value;
        renderTable();
      });
    }

    document.getElementById('filter-status').addEventListener('change', function(e) {
      filterStatus = e.target.value;
      renderTable();
    });

    document.getElementById('create-user-btn').addEventListener('click', function() {
      document.getElementById('new-username').value = '';
      document.getElementById('new-displayname').value = '';
      document.getElementById('new-password').value = '';
      if (isPM) document.getElementById('new-role').value = 'hoa_member';
      document.getElementById('create-user-modal').style.display = 'flex';
      document.getElementById('new-username').focus();
    });

    document.getElementById('create-close').addEventListener('click', function() {
      document.getElementById('create-user-modal').style.display = 'none';
    });
    document.getElementById('create-cancel').addEventListener('click', function() {
      document.getElementById('create-user-modal').style.display = 'none';
    });
    document.getElementById('create-user-modal').addEventListener('click', function(e) {
      if (e.target === document.getElementById('create-user-modal')) {
        document.getElementById('create-user-modal').style.display = 'none';
      }
    });

    document.getElementById('create-submit').addEventListener('click', async function() {
      var username = document.getElementById('new-username').value.trim();
      var displayName = document.getElementById('new-displayname').value.trim();
      var password = document.getElementById('new-password').value;
      var newRole = isPM ? document.getElementById('new-role').value : 'hoa_member';

      if (!username) { PortalAPI.showToast('Username is required', 'error'); return; }
      if (!password || password.length < 6) { PortalAPI.showToast('Password must be at least 6 characters', 'error'); return; }

      try {
        await PortalAPI.apiFetch('/api/portal/users', {
          method: 'POST',
          body: { username: username, displayName: displayName || username, password: password, role: newRole, communityId: community.id }
        });
        PortalAPI.showToast('User created', 'success');
        document.getElementById('create-user-modal').style.display = 'none';
        await loadUsers();
      } catch (err) {
        PortalAPI.showToast(err.message || 'Failed to create user', 'error');
      }
    });

    var editingUser = null;

    document.getElementById('edit-close').addEventListener('click', closeEditModal);
    document.getElementById('edit-cancel').addEventListener('click', closeEditModal);
    document.getElementById('edit-user-modal').addEventListener('click', function(e) {
      if (e.target === document.getElementById('edit-user-modal')) closeEditModal();
    });

    document.getElementById('edit-submit').addEventListener('click', async function() {
      if (!editingUser) return;
      var updates = {};
      if (isPM) {
        var newRole = document.getElementById('edit-role').value;
        if (newRole !== editingUser.role) updates.role = newRole;
      }
      var newStatus = document.getElementById('edit-status').value === 'true';
      if (newStatus !== (editingUser.isActive !== false)) updates.isActive = newStatus;

      if (Object.keys(updates).length === 0) {
        closeEditModal();
        return;
      }

      try {
        await PortalAPI.apiFetch('/api/portal/users/' + editingUser.id, {
          method: 'PUT',
          body: updates
        });
        PortalAPI.showToast('User updated', 'success');
        closeEditModal();
        await loadUsers();
      } catch (err) {
        PortalAPI.showToast(err.message || 'Failed to update user', 'error');
      }
    });

    document.getElementById('edit-remove-btn').addEventListener('click', async function() {
      if (!editingUser) return;
      var name = editingUser.displayName || editingUser.username;
      if (!confirm('Remove "' + name + '" from this community? Their account will remain but they will lose community access.')) return;
      try {
        await PortalAPI.apiFetch('/api/portal/users/' + editingUser.id, { method: 'DELETE' });
        PortalAPI.showToast('User removed from community', 'success');
        closeEditModal();
        await loadUsers();
      } catch (err) {
        PortalAPI.showToast(err.message || 'Failed to remove user', 'error');
      }
    });

    function openEditModal(u) {
      if (!isPM && u.role !== 'hoa_member') {
        PortalAPI.showToast('HOA Admins can only edit HOA Member users', 'error');
        return;
      }
      editingUser = u;
      document.getElementById('edit-modal-title').textContent = 'Edit: ' + (u.displayName || u.username);
      document.getElementById('edit-username-display').textContent = u.username;
      if (isPM) {
        document.getElementById('edit-role').value = u.role || 'hoa_member';
      }
      document.getElementById('edit-status').value = (u.isActive !== false) ? 'true' : 'false';
      document.getElementById('edit-user-modal').style.display = 'flex';
    }

    window._openUserEditModal = openEditModal;

    renderTable();
  }

  function closeEditModal() {
    var modal = document.getElementById('edit-user-modal');
    if (modal) modal.style.display = 'none';
  }

  function getFilteredUsers() {
    return allUsers.filter(function(u) {
      if (searchTerm) {
        var q = searchTerm.toLowerCase();
        var nameMatch = (u.displayName || '').toLowerCase().includes(q);
        var usernameMatch = (u.username || '').toLowerCase().includes(q);
        if (!nameMatch && !usernameMatch) return false;
      }
      if (filterRole && u.role !== filterRole) return false;
      if (filterStatus === 'active' && u.isActive === false) return false;
      if (filterStatus === 'inactive' && u.isActive !== false) return false;
      return true;
    });
  }

  function renderTable() {
    var tbody = document.getElementById('users-tbody');
    if (!tbody) return;

    var filtered = getFilteredUsers();

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No users found</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map(function(u) {
      var isActive = u.isActive !== false;
      var roleBadgeClass = u.role === 'hoa_admin' ? 'badge-blue' : 'badge-purple';
      var roleLabel = u.role === 'hoa_admin' ? 'HOA Admin' : 'HOA Member';
      var statusBadge = isActive
        ? '<span class="badge badge-teal" style="font-size:11px">Active</span>'
        : '<span class="badge" style="background:var(--gray-200,#e5e7eb);color:var(--gray-600,#4b5563);font-size:11px">Inactive</span>';

      var canEdit = isPM || u.role === 'hoa_member';
      var editBtn = canEdit
        ? '<button class="btn btn-secondary btn-xs edit-btn" data-id="' + esc(u.id) + '">Edit</button>'
        : '<span class="text-muted text-sm" style="font-size:11px">View only</span>';

      return '<tr class="user-row" data-id="' + esc(u.id) + '" style="cursor:' + (canEdit ? 'pointer' : 'default') + '">'
        + '<td><strong>' + esc(u.displayName || '—') + '</strong></td>'
        + '<td class="text-muted">' + esc(u.username) + '</td>'
        + '<td><span class="badge ' + roleBadgeClass + '">' + esc(roleLabel) + '</span></td>'
        + '<td>' + statusBadge + '</td>'
        + '<td class="text-right">' + editBtn + '</td>'
        + '</tr>';
    }).join('');

    tbody.querySelectorAll('.user-row').forEach(function(row) {
      row.addEventListener('click', function(e) {
        if (e.target.tagName === 'BUTTON') return;
        var userId = row.dataset.id;
        var user = allUsers.find(function(u) { return u.id === userId; });
        if (user && (isPM || user.role === 'hoa_member') && window._openUserEditModal) {
          window._openUserEditModal(user);
        }
      });
    });

    tbody.querySelectorAll('.edit-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var userId = btn.dataset.id;
        var user = allUsers.find(function(u) { return u.id === userId; });
        if (user && window._openUserEditModal) window._openUserEditModal(user);
      });
    });
  }

  async function loadUsers() {
    try {
      var data = await PortalAPI.apiFetch('/api/users?communityId=' + encodeURIComponent(community.id));
      allUsers = Array.isArray(data) ? data : [];
    } catch (err) {
      console.error('Failed to load users:', err);
      PortalAPI.showToast('Failed to load users', 'error');
      allUsers = [];
    }

    var memberCount = getHoaMemberCount();
    var seatEl = document.getElementById('seat-display');
    if (seatEl) {
      seatEl.textContent = 'HOA Members: ' + memberCount + ' / ' + HOA_MEMBER_LIMIT + ' included';
      seatEl.style.color = memberCount >= HOA_MEMBER_LIMIT ? 'var(--red, #dc2626)' : 'var(--teal)';
    }

    renderTable();
  }

  renderPage();
  loadUsers();
});
