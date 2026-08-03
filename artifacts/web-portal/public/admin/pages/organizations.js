AdminRouter.register('organizations', async function(container, params) {
  const { apiFetch, showToast } = AdminAPI;
  const esc = VRTUtils.esc;

  const breadcrumb = document.getElementById('breadcrumb-area');
  if (breadcrumb) breadcrumb.innerHTML = '';

  container.innerHTML = `
    <div class="page-header">
      <h1>Organizations</h1>
      <button class="btn btn-primary" id="add-org-btn">+ New Organization</button>
    </div>
    <div class="table-container">
      <table>
        <thead><tr>
          <th>Name</th>
          <th>Kind</th>
          <th>Contact</th>
          <th>Branches</th>
          <th>Created</th>
        </tr></thead>
        <tbody id="orgs-tbody">
          <tr><td colspan="5" class="loading-spinner">Loading...</td></tr>
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('add-org-btn').addEventListener('click', () => showOrgModal());

  let allOrgs = [];

  await loadOrgs();

  async function loadOrgs() {
    try {
      allOrgs = await apiFetch('/api/admin/organizations');
      renderOrgs();
      // Lazily fetch branch counts per org after initial render (avoids N+1 blocking the table paint)
      allOrgs.forEach(async (org) => {
        try {
          const branches = await apiFetch(`/api/admin/organizations/${org.id}/branches`);
          org._branchCount = branches.length;
          renderOrgs();
        } catch { /* ignore individual failures */ }
      });
    } catch (err) {
      showToast('Failed to load organizations', 'error');
      document.getElementById('orgs-tbody').innerHTML = '<tr><td colspan="5" class="empty-state">Failed to load organizations</td></tr>';
    }
  }

  function renderOrgs() {
    const tbody = document.getElementById('orgs-tbody');
    if (!tbody) return;
    if (allOrgs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No organizations yet.</td></tr>';
      return;
    }
    tbody.innerHTML = allOrgs.map(org => `
      <tr class="org-row" data-id="${esc(org.id)}" style="cursor:pointer">
        <td><strong>${esc(org.name)}</strong></td>
        <td><span class="badge badge-teal">${esc(org.kind || 'commercial')}</span></td>
        <td class="text-muted">
          ${org.contactName ? esc(org.contactName) : ''}
          ${org.contactEmail ? `<br><span class="text-sm">${esc(org.contactEmail)}</span>` : ''}
          ${!org.contactName && !org.contactEmail ? '—' : ''}
        </td>
        <td>${org._branchCount !== undefined ? org._branchCount : '<span class="text-muted">…</span>'}</td>
        <td class="text-sm text-muted">${new Date(org.createdAt).toLocaleDateString()}</td>
      </tr>
    `).join('');

    tbody.querySelectorAll('.org-row').forEach(row => {
      row.addEventListener('click', () => {
        AdminRouter.navigate('organization-detail', true, { id: row.dataset.id });
      });
    });
  }

  function showOrgModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h2>New Organization</h2>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>Name <span style="color:var(--red)">*</span></label>
            <input type="text" class="form-input" id="new-org-name" placeholder="Organization name" />
          </div>
          <div class="form-group">
            <label>Kind</label>
            <select class="form-select" id="new-org-kind">
              <option value="commercial">Commercial</option>
              <option value="municipal">Municipal</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div class="form-group">
            <label>Contact Name</label>
            <input type="text" class="form-input" id="new-org-contact-name" placeholder="Contact person" />
          </div>
          <div class="form-group">
            <label>Contact Email</label>
            <input type="email" class="form-input" id="new-org-contact-email" placeholder="contact@example.com" />
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary cancel-btn">Cancel</button>
          <button class="btn btn-primary save-btn">Create</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('.modal-close').addEventListener('click', close);
    overlay.querySelector('.cancel-btn').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    overlay.querySelector('.save-btn').addEventListener('click', async () => {
      const name = document.getElementById('new-org-name').value.trim();
      const kind = document.getElementById('new-org-kind').value;
      const contactName = document.getElementById('new-org-contact-name').value.trim();
      const contactEmail = document.getElementById('new-org-contact-email').value.trim();
      if (!name) { showToast('Name is required', 'error'); return; }
      try {
        await apiFetch('/api/admin/organizations', {
          method: 'POST',
          body: { name, kind, contactName: contactName || undefined, contactEmail: contactEmail || undefined },
        });
        showToast('Organization created', 'success');
        close();
        await loadOrgs();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }
});
