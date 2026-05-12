AdminRouter.register('users', async function(container) {
  const { apiFetch, showToast } = AdminAPI;

  let allCommunities = [];
  try {
    allCommunities = await apiFetch('/api/communities');
  } catch {}

  container.innerHTML = `
    <div class="page-header">
      <h1>Users</h1>
      <button class="btn btn-primary btn-sm" id="create-user-btn">+ Create User</button>
    </div>
    <div class="table-container">
      <table>
        <thead><tr>
          <th>Name</th>
          <th>Username</th>
          <th>Role</th>
          <th>Status</th>
          <th>Communities</th>
          <th>Created</th>
          <th class="text-right">Actions</th>
        </tr></thead>
        <tbody id="users-tbody">
          <tr><td colspan="7" class="loading-spinner">Loading...</td></tr>
        </tbody>
      </table>
    </div>
    <div class="modal-overlay" id="edit-user-modal" style="display:none">
      <div class="modal" style="max-width:420px">
        <div class="modal-header">
          <h3>Edit Profile</h3>
          <button class="modal-close" id="edit-user-close">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">Username</label>
            <div class="form-control" id="edit-username-display" style="background:#f9fafb;color:#6b7280;cursor:default;"></div>
          </div>
          <div class="form-group">
            <label class="form-label">Display Name</label>
            <input class="form-input" id="edit-display-name" placeholder="Display Name" />
          </div>
          <div class="form-group">
            <label class="form-label">New Password <span class="text-muted text-sm">(optional)</span></label>
            <input class="form-input" id="edit-new-password" type="password" placeholder="Leave blank to keep current password" autocomplete="new-password" />
            <div class="text-muted text-sm" style="margin-top:4px">Setting a new password does not require the user's current password.</div>
          </div>
          <div class="form-group">
            <label class="form-label">Confirm New Password</label>
            <input class="form-input" id="edit-confirm-password" type="password" placeholder="Repeat new password" autocomplete="new-password" />
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="edit-user-cancel">Cancel</button>
          <button class="btn btn-primary" id="edit-user-submit">Save Changes</button>
        </div>
      </div>
    </div>
    <div class="modal-overlay" id="create-user-modal" style="display:none">
      <div class="modal" style="max-width:420px">
        <div class="modal-header">
          <h3>Create User</h3>
          <button class="modal-close" id="create-user-close">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">Username</label>
            <input class="form-input" id="new-username" placeholder="Username" autocomplete="off" />
          </div>
          <div class="form-group">
            <label class="form-label">Display Name</label>
            <input class="form-input" id="new-display-name" placeholder="Display Name" />
          </div>
          <div class="form-group">
            <label class="form-label">Password</label>
            <input class="form-input" id="new-password" type="password" placeholder="Password" />
          </div>
          <div class="form-group">
            <label class="form-label">Role</label>
            <select class="form-select" id="new-role">
              <option value="contractor">Contractor</option>
              <option value="admin">Admin</option>
              <option value="hoa_admin">HOA Admin</option>
              <option value="hoa_member">HOA Member</option>
              <option value="property_manager">Property Manager</option>
            </select>
          </div>
          <div class="form-group" id="community-select-group" style="display:none">
            <label class="form-label">HOA Community</label>
            <select class="form-select" id="new-hoa-community">
              <option value="">Select a community...</option>
              ${allCommunities.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="create-user-cancel">Cancel</button>
          <button class="btn btn-primary" id="create-user-submit">Create</button>
        </div>
      </div>
    </div>
  `;

  const roleSelect = document.getElementById('new-role');
  const communityGroup = document.getElementById('community-select-group');
  roleSelect.addEventListener('change', () => {
    const isHoa = roleSelect.value === 'hoa_admin' || roleSelect.value === 'hoa_member';
    communityGroup.style.display = isHoa ? 'block' : 'none';
  });

  document.getElementById('create-user-btn').addEventListener('click', () => {
    document.getElementById('create-user-modal').style.display = 'flex';
    document.getElementById('new-username').value = '';
    document.getElementById('new-display-name').value = '';
    document.getElementById('new-password').value = '';
    roleSelect.value = 'contractor';
    communityGroup.style.display = 'none';
    document.getElementById('new-hoa-community').value = '';
    document.getElementById('new-username').focus();
  });

  const closeModal = () => { document.getElementById('create-user-modal').style.display = 'none'; };
  document.getElementById('create-user-close').addEventListener('click', closeModal);
  document.getElementById('create-user-cancel').addEventListener('click', closeModal);

  let editingUserId = null;
  const editModal = document.getElementById('edit-user-modal');
  const closeEditModal = () => { editModal.style.display = 'none'; editingUserId = null; };
  document.getElementById('edit-user-close').addEventListener('click', closeEditModal);
  document.getElementById('edit-user-cancel').addEventListener('click', closeEditModal);

  document.getElementById('edit-user-submit').addEventListener('click', async () => {
    if (!editingUserId) return;
    const displayName = document.getElementById('edit-display-name').value.trim();
    const newPassword = document.getElementById('edit-new-password').value;
    const confirmPassword = document.getElementById('edit-confirm-password').value;

    if (!displayName) { showToast('Display name cannot be empty', 'error'); return; }
    const body = { displayName };
    if (newPassword || confirmPassword) {
      if (newPassword.length < 6) { showToast('New password must be at least 6 characters', 'error'); return; }
      if (newPassword !== confirmPassword) { showToast('Passwords do not match', 'error'); return; }
      body.newPassword = newPassword;
    }
    const submitBtn = document.getElementById('edit-user-submit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving…';
    try {
      await apiFetch(`/api/admin/users/${editingUserId}`, { method: 'PATCH', body });
      showToast('User updated', 'success');
      closeEditModal();
      await loadUsers();
    } catch (err) {
      showToast(err.message || 'Failed to update user', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Save Changes';
    }
  });

  document.getElementById('create-user-submit').addEventListener('click', async () => {
    const username = document.getElementById('new-username').value.trim();
    const displayName = document.getElementById('new-display-name').value.trim();
    const password = document.getElementById('new-password').value;
    const role = roleSelect.value;
    const hoaCommunityId = document.getElementById('new-hoa-community').value;
    if (!username || !password) { showToast('Username and password are required', 'error'); return; }
    if (password.length < 6) { showToast('Password must be at least 6 characters', 'error'); return; }
    const isHoa = role === 'hoa_admin' || role === 'hoa_member';
    if (isHoa && !hoaCommunityId) { showToast('Please select a community for the HOA user', 'error'); return; }
    try {
      const body = { username, displayName: displayName || username, password, role };
      if (isHoa) body.hoaCommunityId = hoaCommunityId;
      await apiFetch('/api/admin/users', { method: 'POST', body });
      showToast('User created', 'success');
      closeModal();
      await loadUsers();
    } catch (err) {
      showToast(err.message || 'Failed to create user', 'error');
    }
  });

  await loadUsers();

  async function loadUsers() {
    try {
      const users = await apiFetch('/api/users');
      const tbody = document.getElementById('users-tbody');
      if (users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No users yet</td></tr>';
        return;
      }

      const communityMap = {};
      await Promise.all(users.map(async u => {
        try {
          communityMap[u.id] = await apiFetch(`/api/users/${u.id}/communities`);
        } catch { communityMap[u.id] = []; }
      }));

      const commLookup = {};
      allCommunities.forEach(c => { commLookup[c.id] = c.name; });

      tbody.innerHTML = users.map(u => {
        const isHoa = u.role === 'hoa_admin' || u.role === 'hoa_member';
        const comms = communityMap[u.id] || [];
        let commBadges;
        if (isHoa && u.hoaCommunityId) {
          const commName = commLookup[u.hoaCommunityId] || 'Unknown';
          commBadges = `<span class="badge badge-outline" style="margin:1px">${esc(commName)}</span>`;
        } else {
          commBadges = comms.length === 0
            ? '<span class="text-muted text-sm">None</span>'
            : comms.map(c => `<span class="badge badge-outline" style="margin:1px">${esc(c.name)}</span>`).join('');
        }

        const roleBadgeClass = u.role === 'admin' ? 'badge-blue'
          : u.role === 'contractor' ? 'badge-teal'
          : u.role === 'hoa_admin' ? 'badge-purple'
          : u.role === 'hoa_member' ? 'badge-purple'
          : u.role === 'property_manager' ? 'badge-amber'
          : 'badge-teal';
        const roleLabel = u.role === 'admin' ? 'Admin'
          : u.role === 'contractor' ? 'Contractor'
          : u.role === 'hoa_admin' ? 'HOA Admin'
          : u.role === 'hoa_member' ? 'HOA Member'
          : u.role === 'property_manager' ? 'Property Manager'
          : u.role;

        const isActive = u.isActive !== false;
        const statusBadge = isActive
          ? '<span class="badge badge-teal" style="font-size:11px">Active</span>'
          : '<span class="badge" style="background:#e5e7eb;color:#4b5563;font-size:11px">Inactive</span>';

        const toggleLabel = isActive ? 'Deactivate' : 'Reactivate';

        const editBtn = `<button class="btn btn-secondary btn-xs edit-btn" data-id="${u.id}" data-username="${esc(u.username)}" data-display="${esc(u.displayName || '')}" style="margin-right:4px">Edit Profile</button>`;
        let actions = '';
        if (!isHoa) {
          actions = `
            ${editBtn}
            <select class="form-select role-select" data-id="${u.id}" data-current="${u.role}" style="display:inline-block;width:auto;padding:3px 8px;font-size:12px;margin-right:4px">
              <option value="" disabled selected>Change role…</option>
              <option value="contractor">Contractor</option>
              <option value="admin">Admin</option>
              <option value="property_manager">Property Manager</option>
            </select>
            <button class="btn btn-secondary btn-xs status-btn" data-id="${u.id}" data-active="${isActive}" style="margin-left:4px">
              ${toggleLabel}
            </button>
          `;
        } else {
          actions = `
            ${editBtn}
            <button class="btn btn-secondary btn-xs status-btn" data-id="${u.id}" data-active="${isActive}" style="margin-right:4px">
              ${toggleLabel}
            </button>
            <button class="btn btn-secondary btn-xs delete-btn" data-id="${u.id}" data-name="${esc(u.displayName || u.username)}" title="Delete user">
              Delete
            </button>
          `;
        }

        return `
        <tr>
          <td><strong>${esc(u.displayName || '—')}</strong></td>
          <td class="text-muted">${esc(u.username)}</td>
          <td><span class="badge ${roleBadgeClass}">${esc(roleLabel)}</span></td>
          <td>${statusBadge}</td>
          <td style="max-width:250px">${commBadges}</td>
          <td class="text-sm text-muted">${new Date(u.createdAt).toLocaleDateString()}</td>
          <td class="text-right">${actions}</td>
        </tr>
      `;}).join('');

      tbody.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          editingUserId = btn.dataset.id;
          document.getElementById('edit-username-display').textContent = btn.dataset.username;
          document.getElementById('edit-display-name').value = btn.dataset.display || '';
          document.getElementById('edit-new-password').value = '';
          document.getElementById('edit-confirm-password').value = '';
          editModal.style.display = 'flex';
          document.getElementById('edit-display-name').focus();
        });
      });

      const rolePrettyLabel = {
        contractor: 'Contractor',
        admin: 'Admin',
        property_manager: 'Property Manager',
      };

      tbody.querySelectorAll('.role-select').forEach(sel => {
        sel.addEventListener('change', async () => {
          const newRole = sel.value;
          const label = rolePrettyLabel[newRole] || newRole;
          if (!confirm(`Change this user's role to ${label}?`)) {
            sel.value = '';
            return;
          }
          try {
            await apiFetch(`/api/users/${sel.dataset.id}/role`, {
              method: 'PUT',
              body: { role: newRole },
            });
            showToast('Role updated', 'success');
            await loadUsers();
          } catch (err) {
            showToast(err.message, 'error');
            sel.value = '';
          }
        });
      });

      tbody.querySelectorAll('.status-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const currentlyActive = btn.dataset.active === 'true';
          const newStatus = !currentlyActive;
          const label = newStatus ? 'reactivate' : 'deactivate';
          if (!confirm(`Are you sure you want to ${label} this user?`)) return;
          try {
            await apiFetch(`/api/users/${btn.dataset.id}/status`, {
              method: 'PUT',
              body: { isActive: newStatus },
            });
            showToast(`User ${newStatus ? 'activated' : 'deactivated'}`, 'success');
            await loadUsers();
          } catch (err) {
            showToast(err.message || 'Failed to update status', 'error');
          }
        });
      });

      tbody.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const name = btn.dataset.name;
          if (!confirm(`Delete user "${name}"? This cannot be undone.`)) return;
          try {
            await apiFetch(`/api/admin/users/${btn.dataset.id}`, { method: 'DELETE' });
            showToast('User deleted', 'success');
            await loadUsers();
          } catch (err) {
            showToast(err.message || 'Failed to delete user', 'error');
          }
        });
      });
    } catch (err) {
      showToast('Failed to load users', 'error');
    }
  }

  function esc(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }
});
