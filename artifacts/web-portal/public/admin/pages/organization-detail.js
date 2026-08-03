AdminRouter.register('organization-detail', async function(container, params) {
  const { apiFetch, showToast } = AdminAPI;
  const esc = VRTUtils.esc;
  const orgId = params.id;

  if (!orgId) {
    AdminRouter.navigate('organizations');
    return;
  }

  let org = null;
  try {
    org = await apiFetch(`/api/admin/organizations/${orgId}`);
  } catch {}

  if (!org) {
    container.innerHTML = '<div class="empty-state"><p>Organization not found</p></div>';
    return;
  }

  const breadcrumb = document.getElementById('breadcrumb-area');
  if (breadcrumb) {
    breadcrumb.innerHTML = `
      <a href="/web/admin/organizations" class="breadcrumb-link" id="back-to-orgs">Organizations</a>
      <span class="breadcrumb-sep">/</span>
      <span class="breadcrumb-current">${esc(org.name)}</span>
    `;
    document.getElementById('back-to-orgs').addEventListener('click', (e) => {
      e.preventDefault();
      AdminRouter.navigate('organizations');
    });
  }

  function renderPage() {
    container.innerHTML = `
      <div class="org-detail-header">
        <div>
          <h1>${esc(org.name)}</h1>
          <span class="badge badge-teal" style="margin-top:4px">${esc(org.kind || 'commercial')}</span>
          ${org.contactName ? `<span class="text-muted text-sm" style="margin-left:8px">${esc(org.contactName)}${org.contactEmail ? ` · ${esc(org.contactEmail)}` : ''}</span>` : ''}
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-secondary btn-sm" id="edit-org-btn">Edit</button>
          <button class="btn btn-danger btn-sm" id="delete-org-btn">Delete</button>
        </div>
      </div>

      <div class="org-section">
        <div class="org-section-header">
          <h2>Branches</h2>
          <button class="btn btn-primary btn-sm" id="add-branch-btn">+ Add Branch</button>
        </div>
        <div id="branches-area"><div class="loading-spinner">Loading...</div></div>
      </div>

      <div class="org-section">
        <div class="org-section-header">
          <h2>Groups</h2>
          <button class="btn btn-primary btn-sm" id="add-group-btn">+ Add Group</button>
        </div>
        <div id="groups-area"><div class="loading-spinner">Loading...</div></div>
      </div>

      <div class="org-section">
        <div class="org-section-header">
          <h2>Client Users</h2>
          <button class="btn btn-primary btn-sm" id="add-client-user-btn">+ Add Client User</button>
        </div>
        <div id="client-users-area"><div class="loading-spinner">Loading...</div></div>
      </div>
    `;

    document.getElementById('edit-org-btn').addEventListener('click', () => showEditOrgModal());
    document.getElementById('delete-org-btn').addEventListener('click', () => deleteOrg());
    document.getElementById('add-branch-btn').addEventListener('click', () => showAddBranchModal());
    document.getElementById('add-group-btn').addEventListener('click', () => showAddGroupModal());
    document.getElementById('add-client-user-btn').addEventListener('click', () => showAddClientUserModal());

    loadBranches();
    loadGroups();
    loadClientUsers();
  }

  renderPage();

  // ── Branches ──────────────────────────────────────────────────────────────

  async function loadBranches() {
    const el = document.getElementById('branches-area');
    if (!el) return;
    try {
      const branches = await apiFetch(`/api/admin/organizations/${orgId}/branches`);
      renderBranches(el, branches);
    } catch (err) {
      el.innerHTML = '<div class="empty-state"><p>Failed to load branches</p></div>';
    }
  }

  function renderBranches(el, branches) {
    if (branches.length === 0) {
      el.innerHTML = '<div class="empty-state" style="padding:24px 0">No branches yet.</div>';
      return;
    }
    el.innerHTML = `
      <div class="table-container">
        <table>
          <thead><tr>
            <th>Code</th>
            <th>Name</th>
            <th>Address</th>
            <th>City</th>
            <th class="text-right">Actions</th>
          </tr></thead>
          <tbody>
            ${branches.map(b => `
              <tr>
                <td class="font-mono">${esc(b.code || '—')}</td>
                <td><strong>${esc(b.name)}</strong></td>
                <td class="text-muted">${esc(b.address || '—')}</td>
                <td class="text-muted">${esc(b.city || '—')}</td>
                <td class="text-right">
                  <button class="btn btn-ghost btn-xs edit-branch-btn" data-id="${esc(b.id)}" data-code="${esc(b.code || '')}" data-name="${esc(b.name)}" data-address="${esc(b.address || '')}" data-city="${esc(b.city || '')}">Edit</button>
                  <button class="btn btn-danger btn-xs delete-branch-btn" data-id="${esc(b.id)}" data-name="${esc(b.name)}">Delete</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    el.querySelectorAll('.edit-branch-btn').forEach(btn => {
      btn.addEventListener('click', () => showEditBranchModal(btn.dataset));
    });
    el.querySelectorAll('.delete-branch-btn').forEach(btn => {
      btn.addEventListener('click', () => deleteBranch(btn.dataset.id, btn.dataset.name));
    });
  }

  function showAddBranchModal() {
    showBranchModal(null);
  }

  function showEditBranchModal(data) {
    showBranchModal({ id: data.id, code: data.code, name: data.name, address: data.address, city: data.city });
  }

  function showBranchModal(existing) {
    const isEdit = !!existing;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h2>${isEdit ? 'Edit Branch' : 'Add Branch'}</h2>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>Code <span style="color:var(--red)">*</span></label>
            <input type="text" class="form-input" id="branch-code" value="${esc(existing?.code || '')}" placeholder="e.g. BRN-001" />
            <div class="form-error" id="branch-code-error" style="display:none;color:var(--red);font-size:12px;margin-top:4px"></div>
          </div>
          <div class="form-group">
            <label>Name <span style="color:var(--red)">*</span></label>
            <input type="text" class="form-input" id="branch-name" value="${esc(existing?.name || '')}" placeholder="Branch name" />
          </div>
          <div class="form-group">
            <label>Address</label>
            <input type="text" class="form-input" id="branch-address" value="${esc(existing?.address || '')}" placeholder="Street address" />
          </div>
          <div class="form-group">
            <label>City</label>
            <input type="text" class="form-input" id="branch-city" value="${esc(existing?.city || '')}" placeholder="City" />
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary cancel-btn">Cancel</button>
          <button class="btn btn-primary save-btn">${isEdit ? 'Save Changes' : 'Add Branch'}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('.modal-close').addEventListener('click', close);
    overlay.querySelector('.cancel-btn').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    overlay.querySelector('.save-btn').addEventListener('click', async () => {
      const code = document.getElementById('branch-code').value.trim();
      const name = document.getElementById('branch-name').value.trim();
      const address = document.getElementById('branch-address').value.trim();
      const city = document.getElementById('branch-city').value.trim();

      const codeErr = document.getElementById('branch-code-error');
      codeErr.style.display = 'none';

      if (!code) { showToast('Code is required', 'error'); return; }
      if (!name) { showToast('Name is required', 'error'); return; }

      try {
        if (isEdit) {
          await apiFetch(`/api/admin/branches/${existing.id}`, {
            method: 'PATCH',
            body: { code, name, address: address || null, city: city || null },
          });
          showToast('Branch updated', 'success');
        } else {
          await apiFetch(`/api/admin/organizations/${orgId}/branches`, {
            method: 'POST',
            body: { code, name, address: address || null, city: city || null },
          });
          showToast('Branch added', 'success');
        }
        close();
        loadBranches();
      } catch (err) {
        // Surface 409 duplicate-code error inline on the code field — not as a toast
        if (err.status === 409 || (err.message && err.message.includes('already exists'))) {
          codeErr.textContent = err.message || 'A branch with this code already exists.';
          codeErr.style.display = 'block';
          document.getElementById('branch-code').focus();
        } else {
          showToast(err.message, 'error');
        }
      }
    });
  }

  async function deleteBranch(branchId, name) {
    if (!confirm(`Delete branch "${name}"? This cannot be undone.`)) return;
    try {
      await apiFetch(`/api/admin/branches/${branchId}`, { method: 'DELETE' });
      showToast('Branch deleted', 'success');
      loadBranches();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // ── Groups ────────────────────────────────────────────────────────────────

  async function loadGroups() {
    const el = document.getElementById('groups-area');
    if (!el) return;
    try {
      const groups = await apiFetch(`/api/admin/organizations/${orgId}/groups`);
      renderGroups(el, groups);
    } catch (err) {
      el.innerHTML = '<div class="empty-state"><p>Failed to load groups</p></div>';
    }
  }

  function renderGroups(el, groups) {
    if (groups.length === 0) {
      el.innerHTML = '<div class="empty-state" style="padding:24px 0">No groups yet.</div>';
      return;
    }
    el.innerHTML = `
      <div class="org-groups-list">
        ${groups.map(g => `
          <div class="org-group-row" data-id="${esc(g.id)}">
            <div class="org-group-swatch" style="background:${esc(g.color || '#6b7280')}"></div>
            <div class="org-group-info">
              <strong>${esc(g.name)}</strong>
              <span class="text-muted text-sm">${g.memberCount ?? (g.memberIds ? g.memberIds.length : 0)} branch(es)</span>
            </div>
            <div class="org-group-actions">
              <button class="btn btn-ghost btn-xs edit-group-btn" data-id="${esc(g.id)}" data-name="${esc(g.name)}" data-color="${esc(g.color || '')}">Edit</button>
              <button class="btn btn-ghost btn-xs members-group-btn" data-id="${esc(g.id)}" data-name="${esc(g.name)}">Members</button>
              <button class="btn btn-danger btn-xs delete-group-btn" data-id="${esc(g.id)}" data-name="${esc(g.name)}">Delete</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;

    el.querySelectorAll('.edit-group-btn').forEach(btn => {
      btn.addEventListener('click', () => showEditGroupModal(btn.dataset.id, btn.dataset.name, btn.dataset.color));
    });
    el.querySelectorAll('.members-group-btn').forEach(btn => {
      btn.addEventListener('click', () => showGroupMembersModal(btn.dataset.id, btn.dataset.name));
    });
    el.querySelectorAll('.delete-group-btn').forEach(btn => {
      btn.addEventListener('click', () => deleteGroup(btn.dataset.id, btn.dataset.name));
    });
  }

  function showAddGroupModal() {
    showGroupModal(null, '', '');
  }

  function showEditGroupModal(id, name, color) {
    showGroupModal(id, name, color);
  }

  function showGroupModal(id, name, color) {
    const isEdit = !!id;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h2>${isEdit ? 'Edit Group' : 'Add Group'}</h2>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>Name <span style="color:var(--red)">*</span></label>
            <input type="text" class="form-input" id="group-name" value="${esc(name)}" placeholder="Group name" />
          </div>
          <div class="form-group">
            <label>Color</label>
            <div style="display:flex;gap:8px;align-items:center">
              <input type="color" id="group-color" value="${color || '#25C1AC'}" style="width:44px;height:36px;border:1px solid var(--gray-200);border-radius:var(--radius-sm);padding:2px;cursor:pointer" />
              <span class="text-sm text-muted">Pick a colour for this group</span>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary cancel-btn">Cancel</button>
          <button class="btn btn-primary save-btn">${isEdit ? 'Save Changes' : 'Create Group'}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('.modal-close').addEventListener('click', close);
    overlay.querySelector('.cancel-btn').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    overlay.querySelector('.save-btn').addEventListener('click', async () => {
      const gName = document.getElementById('group-name').value.trim();
      const gColor = document.getElementById('group-color').value;
      if (!gName) { showToast('Name is required', 'error'); return; }
      try {
        if (isEdit) {
          await apiFetch(`/api/admin/groups/${id}`, {
            method: 'PATCH',
            body: { name: gName, color: gColor },
          });
          showToast('Group updated', 'success');
        } else {
          await apiFetch(`/api/admin/organizations/${orgId}/groups`, {
            method: 'POST',
            body: { name: gName, color: gColor },
          });
          showToast('Group created', 'success');
        }
        close();
        loadGroups();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  async function showGroupMembersModal(groupId, groupName) {
    let branches = [];
    let group = null;
    try {
      [branches, group] = await Promise.all([
        apiFetch(`/api/admin/organizations/${orgId}/branches`),
        apiFetch(`/api/admin/organizations/${orgId}/groups`).then(gs => gs.find(g => g.id === groupId)),
      ]);
    } catch (err) {
      showToast('Failed to load branches', 'error');
      return;
    }

    // Groups list now returns memberIds: string[] (set by listBranchGroupsWithMembers)
    const memberIds = new Set(group ? (group.memberIds || []) : []);

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h2>Members: ${esc(groupName)}</h2>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          ${branches.length === 0 ? '<p class="text-muted text-sm">No branches in this organization yet.</p>' : `
            <div style="max-height:320px;overflow-y:auto;border:1px solid var(--border,var(--gray-200));border-radius:8px;padding:8px">
              ${branches.map(b => `
                <label style="display:flex;align-items:center;gap:8px;padding:8px;cursor:pointer;border-bottom:1px solid var(--gray-100)">
                  <input type="checkbox" class="group-member-cb" value="${esc(b.id)}" ${memberIds.has(b.id) ? 'checked' : ''} />
                  <span><strong>${esc(b.name)}</strong> <span class="text-muted text-sm font-mono">${esc(b.code || '')}</span></span>
                </label>
              `).join('')}
            </div>
          `}
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary cancel-btn">Cancel</button>
          <button class="btn btn-primary save-btn">Save Members</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('.modal-close').addEventListener('click', close);
    overlay.querySelector('.cancel-btn').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    overlay.querySelector('.save-btn').addEventListener('click', async () => {
      const selected = Array.from(overlay.querySelectorAll('.group-member-cb:checked')).map(cb => cb.value);
      try {
        await apiFetch(`/api/admin/groups/${groupId}/members`, {
          method: 'PUT',
          body: { communityIds: selected },
        });
        showToast('Group members saved', 'success');
        close();
        loadGroups();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  async function deleteGroup(groupId, name) {
    if (!confirm(`Delete group "${name}"?`)) return;
    try {
      await apiFetch(`/api/admin/groups/${groupId}`, { method: 'DELETE' });
      showToast('Group deleted', 'success');
      loadGroups();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // ── Client Users ──────────────────────────────────────────────────────────

  async function loadClientUsers() {
    const el = document.getElementById('client-users-area');
    if (!el) return;
    try {
      const users = await apiFetch(`/api/admin/organizations/${orgId}/users`);
      renderClientUsers(el, users);
    } catch (err) {
      el.innerHTML = '<div class="empty-state"><p>Failed to load client users</p></div>';
    }
  }

  function renderClientUsers(el, users) {
    if (users.length === 0) {
      el.innerHTML = '<div class="empty-state" style="padding:24px 0">No client users yet.</div>';
      return;
    }
    el.innerHTML = `
      <div class="table-container">
        <table>
          <thead><tr>
            <th>Display Name</th>
            <th>Username</th>
            <th>Status</th>
            <th>Created</th>
          </tr></thead>
          <tbody>
            ${users.map(u => `
              <tr>
                <td><strong>${esc(u.displayName || u.username)}</strong></td>
                <td class="text-muted font-mono">${esc(u.username)}</td>
                <td><span class="badge ${u.isActive ? 'badge-green' : 'badge-gray'}">${u.isActive ? 'Active' : 'Inactive'}</span></td>
                <td class="text-sm text-muted">${u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function showAddClientUserModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h2>Add Client User</h2>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>Username <span style="color:var(--red)">*</span></label>
            <input type="text" class="form-input" id="cu-username" placeholder="username" autocomplete="off" />
          </div>
          <div class="form-group">
            <label>Display Name</label>
            <input type="text" class="form-input" id="cu-displayname" placeholder="Full name" />
          </div>
          <div class="form-group">
            <label>Password <span style="color:var(--red)">*</span></label>
            <input type="password" class="form-input" id="cu-password" placeholder="Initial password" autocomplete="new-password" />
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary cancel-btn">Cancel</button>
          <button class="btn btn-primary save-btn">Create User</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('.modal-close').addEventListener('click', close);
    overlay.querySelector('.cancel-btn').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    overlay.querySelector('.save-btn').addEventListener('click', async () => {
      const username = document.getElementById('cu-username').value.trim();
      const displayName = document.getElementById('cu-displayname').value.trim();
      const password = document.getElementById('cu-password').value;
      if (!username) { showToast('Username is required', 'error'); return; }
      if (!password) { showToast('Password is required', 'error'); return; }
      try {
        await apiFetch('/api/admin/users', {
          method: 'POST',
          body: { username, displayName: displayName || undefined, password, role: 'client_admin', organizationId: orgId },
        });
        showToast('Client user created', 'success');
        close();
        loadClientUsers();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // ── Org edit / delete ─────────────────────────────────────────────────────

  function showEditOrgModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h2>Edit Organization</h2>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>Name <span style="color:var(--red)">*</span></label>
            <input type="text" class="form-input" id="edit-org-name" value="${esc(org.name)}" />
          </div>
          <div class="form-group">
            <label>Kind</label>
            <select class="form-select" id="edit-org-kind">
              <option value="commercial" ${org.kind === 'commercial' ? 'selected' : ''}>Commercial</option>
              <option value="municipal" ${org.kind === 'municipal' ? 'selected' : ''}>Municipal</option>
              <option value="other" ${org.kind === 'other' ? 'selected' : ''}>Other</option>
            </select>
          </div>
          <div class="form-group">
            <label>Contact Name</label>
            <input type="text" class="form-input" id="edit-org-contact-name" value="${esc(org.contactName || '')}" />
          </div>
          <div class="form-group">
            <label>Contact Email</label>
            <input type="email" class="form-input" id="edit-org-contact-email" value="${esc(org.contactEmail || '')}" />
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary cancel-btn">Cancel</button>
          <button class="btn btn-primary save-btn">Save Changes</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('.modal-close').addEventListener('click', close);
    overlay.querySelector('.cancel-btn').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    overlay.querySelector('.save-btn').addEventListener('click', async () => {
      const name = document.getElementById('edit-org-name').value.trim();
      const kind = document.getElementById('edit-org-kind').value;
      const contactName = document.getElementById('edit-org-contact-name').value.trim();
      const contactEmail = document.getElementById('edit-org-contact-email').value.trim();
      if (!name) { showToast('Name is required', 'error'); return; }
      try {
        org = await apiFetch(`/api/admin/organizations/${orgId}`, {
          method: 'PATCH',
          body: { name, kind, contactName: contactName || null, contactEmail: contactEmail || null },
        });
        showToast('Organization updated', 'success');
        close();
        // Update breadcrumb and header
        const bc = document.getElementById('breadcrumb-area');
        if (bc) {
          bc.innerHTML = `
            <a href="/web/admin/organizations" class="breadcrumb-link" id="back-to-orgs">Organizations</a>
            <span class="breadcrumb-sep">/</span>
            <span class="breadcrumb-current">${esc(org.name)}</span>
          `;
          document.getElementById('back-to-orgs').addEventListener('click', (e) => {
            e.preventDefault();
            AdminRouter.navigate('organizations');
          });
        }
        renderPage();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  async function deleteOrg() {
    if (!confirm(`Delete organization "${org.name}"? This cannot be undone.`)) return;
    try {
      await apiFetch(`/api/admin/organizations/${orgId}`, { method: 'DELETE' });
      showToast('Organization deleted', 'success');
      AdminRouter.navigate('organizations');
    } catch (err) {
      // Surface 409 "has branches" message inline — not as a toast that loses context
      if (err.status === 409 || (err.message && err.message.toLowerCase().includes('branch'))) {
        const el = container.querySelector('.org-detail-header');
        let errDiv = document.getElementById('delete-org-error');
        if (!errDiv) {
          errDiv = document.createElement('div');
          errDiv.id = 'delete-org-error';
          errDiv.style.cssText = 'color:var(--red);font-size:13px;margin-top:8px;padding:8px 12px;background:var(--red-light);border-radius:var(--radius-sm)';
          if (el) el.after(errDiv);
          else container.prepend(errDiv);
        }
        errDiv.textContent = err.message || 'Cannot delete: reassign or delete branches first.';
      } else {
        showToast(err.message, 'error');
      }
    }
  }
});
