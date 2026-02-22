AdminRouter.register('users', async function(container) {
  const { apiFetch, showToast } = AdminAPI;

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
          <th>Communities</th>
          <th>Created</th>
          <th class="text-right">Actions</th>
        </tr></thead>
        <tbody id="users-tbody">
          <tr><td colspan="6" class="loading-spinner">Loading...</td></tr>
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

  document.getElementById('create-user-btn').addEventListener('click', () => {
    document.getElementById('create-user-modal').style.display = 'flex';
    document.getElementById('new-username').value = '';
    document.getElementById('new-display-name').value = '';
    document.getElementById('new-password').value = '';
    document.getElementById('new-role').value = 'contractor';
    document.getElementById('new-username').focus();
  });

  const closeModal = () => { document.getElementById('create-user-modal').style.display = 'none'; };
  document.getElementById('create-user-close').addEventListener('click', closeModal);
  document.getElementById('create-user-cancel').addEventListener('click', closeModal);

  document.getElementById('create-user-submit').addEventListener('click', async () => {
    const username = document.getElementById('new-username').value.trim();
    const displayName = document.getElementById('new-display-name').value.trim();
    const password = document.getElementById('new-password').value;
    const role = document.getElementById('new-role').value;
    if (!username || !password) { showToast('Username and password are required', 'error'); return; }
    if (password.length < 6) { showToast('Password must be at least 6 characters', 'error'); return; }
    try {
      await apiFetch('/api/admin/users', { method: 'POST', body: { username, displayName: displayName || username, password, role } });
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
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No users yet</td></tr>';
        return;
      }

      const communityMap = {};
      await Promise.all(users.map(async u => {
        try {
          communityMap[u.id] = await apiFetch(`/api/users/${u.id}/communities`);
        } catch { communityMap[u.id] = []; }
      }));

      tbody.innerHTML = users.map(u => {
        const comms = communityMap[u.id] || [];
        const commBadges = comms.length === 0
          ? '<span class="text-muted text-sm">None</span>'
          : comms.map(c => `<span class="badge badge-outline" style="margin:1px">${esc(c.name)}</span>`).join('');
        return `
        <tr>
          <td><strong>${esc(u.displayName || '—')}</strong></td>
          <td class="text-muted">${esc(u.username)}</td>
          <td><span class="badge ${u.role === 'admin' ? 'badge-blue' : 'badge-teal'}">${esc(u.role)}</span></td>
          <td style="max-width:250px">${commBadges}</td>
          <td class="text-sm text-muted">${new Date(u.createdAt).toLocaleDateString()}</td>
          <td class="text-right">
            <button class="btn btn-secondary btn-xs role-btn" data-id="${u.id}" data-role="${u.role}">
              ${u.role === 'admin' ? 'Make Contractor' : 'Make Admin'}
            </button>
          </td>
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
