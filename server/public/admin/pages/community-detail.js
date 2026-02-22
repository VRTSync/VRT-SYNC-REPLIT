AdminRouter.register('community-detail', async function(container, params) {
  const { apiFetch, showToast } = AdminAPI;
  const communityId = params.id;
  const activeTab = params.tab || 'overview';

  if (!communityId) {
    AdminRouter.navigate('communities');
    return;
  }

  let community = null;
  try {
    const communities = await apiFetch('/api/communities');
    community = communities.find(c => c.id === communityId);
  } catch {}

  if (!community) {
    container.innerHTML = '<div class="empty-state"><p>Community not found</p></div>';
    return;
  }

  const breadcrumb = document.getElementById('breadcrumb-area');
  if (breadcrumb) {
    breadcrumb.innerHTML = `
      <a href="/web/admin/communities" class="breadcrumb-link" id="back-to-communities">Communities</a>
      <span class="breadcrumb-sep">/</span>
      <span class="breadcrumb-current">${esc(community.name)}</span>
    `;
    document.getElementById('back-to-communities').addEventListener('click', (e) => {
      e.preventDefault();
      AdminRouter.navigate('communities');
    });
  }

  const tabs = [
    { key: 'overview', label: 'Overview', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>' },
    { key: 'layers', label: 'Map Layers', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>' },
    { key: 'assets', label: 'Assets', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>' },
    { key: 'tasks', label: 'Tasks', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>' },
    { key: 'members', label: 'Members', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>' },
    { key: 'packs', label: 'Offline Packs', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' },
  ];

  container.innerHTML = `
    <div class="community-detail-header">
      <div>
        <h1>${esc(community.name)}</h1>
        ${community.description ? `<p class="text-muted" style="margin-top:4px">${esc(community.description)}</p>` : ''}
      </div>
      <button class="btn btn-secondary btn-sm" id="edit-community-btn">Edit Community</button>
    </div>
    <div class="community-tabs">
      ${tabs.map(t => `
        <button class="community-tab ${activeTab === t.key ? 'active' : ''}" data-tab="${t.key}">
          ${t.icon}
          ${t.label}
        </button>
      `).join('')}
    </div>
    <div id="community-tab-content"></div>
  `;

  container.querySelectorAll('.community-tab').forEach(tabBtn => {
    tabBtn.addEventListener('click', () => {
      const tab = tabBtn.dataset.tab;
      AdminRouter.navigate('community-detail', true, { id: communityId, tab });
    });
  });

  document.getElementById('edit-community-btn').addEventListener('click', () => {
    showEditModal(community);
  });

  const tabContent = document.getElementById('community-tab-content');
  renderTab(activeTab, tabContent);

  async function renderTab(tab, el) {
    switch (tab) {
      case 'overview':
        await renderOverview(el);
        break;
      case 'layers':
        if (window._renderMapLayers) await window._renderMapLayers(el, communityId);
        else el.innerHTML = '<div class="empty-state">Map Layers module not loaded</div>';
        break;
      case 'assets':
        if (window._renderAssets) await window._renderAssets(el, communityId);
        else el.innerHTML = '<div class="empty-state">Assets module not loaded</div>';
        break;
      case 'tasks':
        if (window._renderTasks) await window._renderTasks(el, communityId);
        else el.innerHTML = '<div class="empty-state">Tasks module not loaded</div>';
        break;
      case 'members':
        await renderMembers(el);
        break;
      case 'packs':
        await renderPacks(el);
        break;
    }
  }

  async function renderOverview(el) {
    el.innerHTML = '<div class="loading-spinner">Loading...</div>';
    try {
      const summary = await apiFetch(`/api/admin/summary?communityId=${communityId}`);
      el.innerHTML = `
        <div class="stats-grid" style="margin-top:16px">
          <div class="stat-card teal">
            <div class="stat-label">Active Assets</div>
            <div class="stat-value">${summary.activeAssetsCount ?? 0}</div>
          </div>
          <div class="stat-card amber">
            <div class="stat-label">Incomplete Assets</div>
            <div class="stat-value">${summary.incompleteAssetsCount ?? 0}</div>
          </div>
          <div class="stat-card red">
            <div class="stat-label">Archived Assets</div>
            <div class="stat-value">${summary.archivedAssetsCount ?? 0}</div>
          </div>
          <div class="stat-card green">
            <div class="stat-label">Total Tasks</div>
            <div class="stat-value">${summary.tasksCount ?? 0}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Pending Tasks</div>
            <div class="stat-value">${summary.pendingTasksCount ?? 0}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Completed Tasks</div>
            <div class="stat-value">${summary.completedTasksCount ?? 0}</div>
          </div>
          <div class="stat-card blue">
            <div class="stat-label">Map Layers</div>
            <div class="stat-value">${summary.mapLayersCount ?? 0}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Members</div>
            <div class="stat-value">${summary.membersCount ?? 0}</div>
          </div>
        </div>
      `;
    } catch (err) {
      el.innerHTML = `<div class="empty-state"><p>Failed to load overview</p></div>`;
    }
  }

  async function renderMembers(el) {
    el.innerHTML = '<div class="loading-spinner">Loading...</div>';
    try {
      const [members, allUsers] = await Promise.all([
        apiFetch(`/api/communities/${communityId}/members`),
        apiFetch('/api/users'),
      ]);

      const memberIds = new Set(members.map(m => m.userId));
      const nonMembers = allUsers.filter(u => !memberIds.has(u.id));

      el.innerHTML = `
        <div class="page-header" style="margin-top:16px">
          <h2 style="font-size:16px">Members (${members.length})</h2>
          <button class="btn btn-primary btn-sm" id="open-add-members-btn">+ Add Members</button>
        </div>
        <div class="table-container">
          <table>
            <thead><tr>
              <th>Name</th>
              <th>Username</th>
              <th>Role</th>
              <th>Joined</th>
              <th class="text-right">Actions</th>
            </tr></thead>
            <tbody id="members-tbody">
              ${members.length === 0 ? '<tr><td colspan="5" class="empty-state">No members yet</td></tr>' :
                members.map(m => {
                  const u = allUsers.find(u => u.id === m.userId);
                  return `<tr>
                    <td><strong>${esc(u?.displayName || m.displayName || '—')}</strong></td>
                    <td class="text-muted">${esc(u?.username || m.username || m.userId)}</td>
                    <td><span class="badge ${(u?.role || m.role) === 'admin' ? 'badge-blue' : 'badge-teal'}">${esc(u?.role || m.role || '—')}</span></td>
                    <td class="text-sm text-muted">${m.joinedAt ? new Date(m.joinedAt).toLocaleDateString() : '—'}</td>
                    <td class="text-right">
                      <button class="btn btn-danger btn-xs remove-member-btn" data-user-id="${m.userId}">Remove</button>
                    </td>
                  </tr>`;
                }).join('')}
            </tbody>
          </table>
        </div>
        <div class="modal-overlay" id="add-members-modal" style="display:none">
          <div class="modal" style="max-width:500px">
            <div class="modal-header">
              <h3>Add Members</h3>
              <button class="modal-close" id="add-members-close">&times;</button>
            </div>
            <div class="modal-body">
              <input class="form-input" id="member-search" placeholder="Search users..." style="margin-bottom:12px" />
              ${nonMembers.length === 0
                ? '<p class="text-muted text-sm">All users are already members of this community.</p>'
                : `<div id="member-checklist" style="max-height:300px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:8px">
                    ${nonMembers.map(u => `
                      <label style="display:flex;align-items:center;gap:8px;padding:8px;cursor:pointer;border-bottom:1px solid var(--border-light, #f0f0f0)" class="member-option" data-name="${esc((u.displayName || u.username).toLowerCase())}">
                        <input type="checkbox" value="${u.id}" class="member-checkbox" />
                        <span><strong>${esc(u.displayName || u.username)}</strong> <span class="text-muted text-sm">${esc(u.username)}</span></span>
                        <span class="badge ${u.role === 'admin' ? 'badge-blue' : 'badge-teal'}" style="margin-left:auto">${esc(u.role)}</span>
                      </label>
                    `).join('')}
                  </div>
                  <div style="margin-top:8px;display:flex;align-items:center;gap:8px">
                    <span class="text-sm text-muted"><span id="selected-count">0</span> selected</span>
                    <button class="btn btn-secondary btn-xs" id="select-all-btn">Select All</button>
                  </div>`
              }
            </div>
            <div class="modal-footer">
              <button class="btn btn-secondary" id="add-members-cancel">Cancel</button>
              <button class="btn btn-primary" id="add-members-submit" ${nonMembers.length === 0 ? 'disabled' : ''}>Add Selected</button>
            </div>
          </div>
        </div>
      `;

      document.getElementById('open-add-members-btn').addEventListener('click', () => {
        document.getElementById('add-members-modal').style.display = 'flex';
        const searchInput = document.getElementById('member-search');
        if (searchInput) { searchInput.value = ''; searchInput.focus(); }
        updateSelectedCount();
      });

      const closeAddModal = () => { document.getElementById('add-members-modal').style.display = 'none'; };
      document.getElementById('add-members-close').addEventListener('click', closeAddModal);
      document.getElementById('add-members-cancel').addEventListener('click', closeAddModal);

      function updateSelectedCount() {
        const cnt = el.querySelectorAll('.member-checkbox:checked').length;
        const countEl = document.getElementById('selected-count');
        if (countEl) countEl.textContent = cnt;
      }

      el.querySelectorAll('.member-checkbox').forEach(cb => {
        cb.addEventListener('change', updateSelectedCount);
      });

      const searchInput = document.getElementById('member-search');
      if (searchInput) {
        searchInput.addEventListener('input', () => {
          const q = searchInput.value.toLowerCase();
          el.querySelectorAll('.member-option').forEach(opt => {
            opt.style.display = opt.dataset.name.includes(q) ? '' : 'none';
          });
        });
      }

      const selectAllBtn = document.getElementById('select-all-btn');
      if (selectAllBtn) {
        selectAllBtn.addEventListener('click', () => {
          const boxes = el.querySelectorAll('.member-checkbox');
          const allChecked = Array.from(boxes).every(b => b.checked);
          boxes.forEach(b => { b.checked = !allChecked; });
          updateSelectedCount();
        });
      }

      document.getElementById('add-members-submit').addEventListener('click', async () => {
        const selected = Array.from(el.querySelectorAll('.member-checkbox:checked')).map(cb => cb.value);
        if (selected.length === 0) { showToast('Select at least one user', 'error'); return; }
        try {
          const result = await apiFetch(`/api/communities/${communityId}/members`, {
            method: 'POST',
            body: { userIds: selected },
          });
          showToast(`Added ${result.added} member(s)${result.skipped ? `, ${result.skipped} already existed` : ''}`, 'success');
          closeAddModal();
          await renderMembers(el);
        } catch (err) {
          showToast(err.message, 'error');
        }
      });

      el.querySelectorAll('.remove-member-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Remove this member from the community?')) return;
          try {
            await apiFetch(`/api/communities/${communityId}/members/${btn.dataset.userId}`, { method: 'DELETE' });
            showToast('Member removed', 'success');
            await renderMembers(el);
          } catch (err) {
            showToast(err.message, 'error');
          }
        });
      });
    } catch (err) {
      el.innerHTML = `<div class="empty-state"><p>Failed to load members</p></div>`;
    }
  }

  async function renderPacks(el) {
    el.innerHTML = '<div class="loading-spinner">Loading...</div>';
    try {
      const packs = await apiFetch(`/api/offline-packs?communityId=${communityId}`);
      el.innerHTML = `
        <div class="page-header" style="margin-top:16px">
          <h2 style="font-size:16px">Offline Packs</h2>
          <button class="btn btn-primary btn-sm" id="generate-pack-btn">Generate New Pack</button>
        </div>
        <div class="table-container">
          <table>
            <thead><tr>
              <th>Version</th>
              <th>Created</th>
              <th>Checksum</th>
            </tr></thead>
            <tbody>
              ${packs.length === 0 ? '<tr><td colspan="3" class="empty-state">No offline packs yet</td></tr>' :
                packs.map(p => `<tr>
                  <td><strong>v${p.packVersion}</strong></td>
                  <td class="text-sm text-muted">${new Date(p.createdAt).toLocaleString()}</td>
                  <td class="font-mono text-sm">${esc((p.checksum || '—').substring(0, 16))}${p.checksum && p.checksum.length > 16 ? '...' : ''}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      `;

      document.getElementById('generate-pack-btn').addEventListener('click', async () => {
        const btn = document.getElementById('generate-pack-btn');
        btn.disabled = true;
        btn.textContent = 'Generating...';
        try {
          await apiFetch(`/api/communities/${communityId}/generate-offline-pack`, { method: 'POST' });
          showToast('Offline pack generated', 'success');
          await renderPacks(el);
        } catch (err) {
          showToast(err.message, 'error');
          btn.disabled = false;
          btn.textContent = 'Generate New Pack';
        }
      });
    } catch (err) {
      el.innerHTML = `<div class="empty-state"><p>Failed to load packs</p></div>`;
    }
  }

  function showEditModal(c) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h2>Edit Community</h2>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>Name</label>
            <input type="text" class="form-input" id="edit-c-name" value="${esc(c.name)}" />
          </div>
          <div class="form-group">
            <label>Description</label>
            <textarea class="form-textarea" id="edit-c-desc">${esc(c.description || '')}</textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary cancel-btn">Cancel</button>
          <button class="btn btn-primary save-btn">Save Changes</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
    overlay.querySelector('.cancel-btn').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('.save-btn').addEventListener('click', async () => {
      const name = document.getElementById('edit-c-name').value.trim();
      const description = document.getElementById('edit-c-desc').value.trim();
      if (!name) { showToast('Name is required', 'error'); return; }
      try {
        await apiFetch(`/api/communities/${c.id}`, { method: 'PATCH', body: { name, description: description || null } });
        showToast('Community updated', 'success');
        overlay.remove();
        await AdminState.refreshCommunities();
        AdminRouter.navigate('community-detail', false, { id: communityId, tab: activeTab });
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  function esc(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }
});
