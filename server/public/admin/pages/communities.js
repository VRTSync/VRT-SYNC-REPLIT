AdminRouter.register('communities', async function(container) {
  const { apiFetch, showToast } = AdminAPI;

  const breadcrumb = document.getElementById('breadcrumb-area');
  if (breadcrumb) breadcrumb.innerHTML = '';

  container.innerHTML = `
    <div class="page-header">
      <h1>Communities</h1>
      <button class="btn btn-primary" id="add-community-btn">+ New Community</button>
    </div>
    <div id="communities-grid" class="communities-grid">
      <div class="loading-spinner">Loading...</div>
    </div>
  `;

  document.getElementById('add-community-btn').addEventListener('click', () => showModal());
  await loadCommunities();

  async function loadCommunities() {
    try {
      const list = await apiFetch('/api/communities');
      const grid = document.getElementById('communities-grid');
      if (list.length === 0) {
        grid.innerHTML = '<div class="empty-state">No communities yet. Create one to get started.</div>';
        return;
      }

      let summaries = {};
      try {
        const results = await Promise.all(list.map(c =>
          apiFetch(`/api/admin/summary?communityId=${c.id}`).then(s => ({ id: c.id, ...s })).catch(() => ({ id: c.id }))
        ));
        results.forEach(s => { summaries[s.id] = s; });
      } catch {}

      grid.innerHTML = list.map(c => {
        const s = summaries[c.id] || {};
        return `
          <div class="community-card" data-id="${c.id}">
            <div class="community-card-header">
              <h3>${esc(c.name)}</h3>
              <button class="btn btn-ghost btn-xs edit-btn" data-id="${c.id}" data-name="${esc(c.name)}" data-desc="${esc(c.description || '')}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
            </div>
            ${c.description ? `<p class="community-card-desc">${esc(c.description)}</p>` : ''}
            <div class="community-card-stats">
              <span title="Assets">${s.activeAssetsCount ?? 0} assets</span>
              <span title="Tasks">${s.tasksCount ?? 0} tasks</span>
              <span title="Layers">${s.mapLayersCount ?? 0} layers</span>
              <span title="Members">${s.membersCount ?? 0} members</span>
            </div>
            <div class="community-card-footer">
              <span class="text-sm text-muted">Created ${new Date(c.createdAt).toLocaleDateString()}</span>
              <span class="community-card-arrow">View &rarr;</span>
            </div>
          </div>
        `;
      }).join('');

      grid.querySelectorAll('.community-card').forEach(card => {
        card.addEventListener('click', (e) => {
          if (e.target.closest('.edit-btn')) return;
          AdminRouter.navigate('community-detail', true, { id: card.dataset.id, tab: 'overview' });
        });
      });

      grid.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
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
