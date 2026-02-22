AdminRouter.register('communities', async function(container) {
  const { apiFetch, showToast } = AdminAPI;

  container.innerHTML = `
    <div class="page-header">
      <h1>Communities</h1>
      <button class="btn btn-primary" id="add-community-btn">+ New Community</button>
    </div>
    <div class="table-container">
      <table>
        <thead><tr>
          <th>Name</th>
          <th>Description</th>
          <th>Created</th>
          <th class="text-right">Actions</th>
        </tr></thead>
        <tbody id="communities-tbody">
          <tr><td colspan="4" class="loading-spinner">Loading...</td></tr>
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('add-community-btn').addEventListener('click', () => showModal());
  await loadCommunities();

  async function loadCommunities() {
    try {
      const list = await apiFetch('/api/communities');
      const tbody = document.getElementById('communities-tbody');
      if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No communities yet</td></tr>';
        return;
      }
      tbody.innerHTML = list.map(c => `
        <tr>
          <td><strong>${esc(c.name)}</strong></td>
          <td class="text-muted">${esc(c.description || '—')}</td>
          <td class="text-sm text-muted">${new Date(c.createdAt).toLocaleDateString()}</td>
          <td class="text-right">
            <button class="btn btn-secondary btn-xs edit-btn" data-id="${c.id}" data-name="${esc(c.name)}" data-desc="${esc(c.description || '')}">Edit</button>
          </td>
        </tr>
      `).join('');

      tbody.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          showModal(btn.dataset.id, btn.dataset.name, btn.dataset.desc);
        });
      });
    } catch (err) {
      showToast('Failed to load communities', 'error');
    }
  }

  function showModal(id = null, name = '', desc = '') {
    const isEdit = !!id;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h2>${isEdit ? 'Edit' : 'Create'} Community</h2>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>Name</label>
            <input type="text" class="form-input" id="modal-name" value="${esc(name)}" placeholder="Community name" />
          </div>
          <div class="form-group">
            <label>Description</label>
            <textarea class="form-textarea" id="modal-desc" placeholder="Optional description">${esc(desc)}</textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary cancel-btn">Cancel</button>
          <button class="btn btn-primary save-btn">${isEdit ? 'Save Changes' : 'Create'}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
    overlay.querySelector('.cancel-btn').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('.save-btn').addEventListener('click', async () => {
      const nameVal = document.getElementById('modal-name').value.trim();
      const descVal = document.getElementById('modal-desc').value.trim();
      if (!nameVal) { showToast('Name is required', 'error'); return; }

      try {
        if (isEdit) {
          await apiFetch(`/api/communities/${id}`, {
            method: 'PATCH',
            body: { name: nameVal, description: descVal || null },
          });
          showToast('Community updated', 'success');
        } else {
          await apiFetch('/api/communities', {
            method: 'POST',
            body: { name: nameVal, description: descVal || null },
          });
          showToast('Community created', 'success');
        }
        overlay.remove();
        await AdminState.refreshCommunities();
        await loadCommunities();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  function esc(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
});
