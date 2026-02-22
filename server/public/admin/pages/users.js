AdminRouter.register('users', async function(container) {
  const { apiFetch, showToast } = AdminAPI;

  container.innerHTML = `
    <div class="page-header">
      <h1>Users</h1>
    </div>
    <div class="table-container">
      <table>
        <thead><tr>
          <th>Name</th>
          <th>Username</th>
          <th>Role</th>
          <th>Created</th>
          <th class="text-right">Actions</th>
        </tr></thead>
        <tbody id="users-tbody">
          <tr><td colspan="5" class="loading-spinner">Loading...</td></tr>
        </tbody>
      </table>
    </div>
  `;

  await loadUsers();

  async function loadUsers() {
    try {
      const users = await apiFetch('/api/users');
      const tbody = document.getElementById('users-tbody');
      if (users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No users yet</td></tr>';
        return;
      }
      tbody.innerHTML = users.map(u => `
        <tr>
          <td><strong>${esc(u.displayName || '—')}</strong></td>
          <td class="text-muted">${esc(u.username)}</td>
          <td><span class="badge ${u.role === 'admin' ? 'badge-blue' : 'badge-teal'}">${esc(u.role)}</span></td>
          <td class="text-sm text-muted">${new Date(u.createdAt).toLocaleDateString()}</td>
          <td class="text-right">
            <button class="btn btn-secondary btn-xs role-btn" data-id="${u.id}" data-role="${u.role}">
              ${u.role === 'admin' ? 'Make Contractor' : 'Make Admin'}
            </button>
          </td>
        </tr>
      `).join('');

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
