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
          : isHoa ? 'badge-purple'
          : 'badge-teal';
        const roleLabel = u.role === 'hoa_admin' ? 'HOA Admin'
          : u.role === 'hoa_member' ? 'HOA Member'
          : u.role;

        const isActive = u.isActive !== false;
        const statusBadge = isActive
          ? '<span class="badge badge-teal" style="font-size:11px">Active</span>'
          : '<span class="badge" style="background:#e5e7eb;color:#4b5563;font-size:11px">Inactive</span>';

        const toggleLabel = isActive ? 'Deactivate' : 'Reactivate';

        let actions = '';
        if (!isHoa) {
          actions = `
            <button class="btn btn-secondary btn-xs role-btn" data-id="${u.id}" data-role="${u.role}">
              ${u.role === 'admin' ? 'Make Contractor' : 'Make Admin'}
            </button>
            <button class="btn btn-secondary btn-xs status-btn" data-id="${u.id}" data-active="${isActive}" style="margin-left:4px">
              ${toggleLabel}
            </button>
          `;
        } else {
          actions = `
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

      tbody.querySelectorAll('.role-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const newRole = btn.dataset.role === 'admin' ? 'contractor' : 'admin';
          if (!confirm(`Change this user's role to ${newRole}?`)) return;
          try {
            await apiFetch(`/api/users/${btn.dataset.id}/role`, {
              method: 'PUT',
              body: { role: newRole },
            });
            showToast('Role updated', 'success');
            await loadUsers();
          } catch (err) {
            showToast(err.message, 'error');
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
