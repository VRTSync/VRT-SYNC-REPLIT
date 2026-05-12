AdminRouter.register('contacts', async function(container) {
  const { apiFetch, showToast } = AdminAPI;

  const CONTACT_TYPES = ['HOA Board', 'Property Management', 'Contractor', 'Vendor', 'City/Municipality', 'Emergency', 'Other'];
  const TYPE_BADGE = {
    'HOA Board': 'badge-purple',
    'Property Management': 'badge-blue',
    'Contractor': 'badge-teal',
    'Vendor': 'badge-amber',
    'City/Municipality': 'badge-blue',
    'Emergency': 'badge-red',
    'Other': 'badge-gray',
  };

  let allCommunities = [];
  let currentContacts = [];
  let filterCommunityId = '';
  let filterType = '';
  let editingContact = null;

  function esc(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  try {
    allCommunities = await apiFetch('/api/communities');
  } catch {}

  container.innerHTML = `
    <div class="page-header">
      <h1>Contacts</h1>
      <button class="btn btn-primary btn-sm" id="create-contact-btn">+ Add Contact</button>
    </div>
    <div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap;">
      <select class="form-select" id="filter-community" style="min-width:200px;max-width:280px;">
        <option value="">All Communities</option>
        ${allCommunities.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
      </select>
      <select class="form-select" id="filter-type" style="min-width:180px;max-width:240px;">
        <option value="">All Types</option>
        ${CONTACT_TYPES.map(t => `<option value="${t}">${esc(t)}</option>`).join('')}
      </select>
    </div>
    <div class="table-container">
      <table>
        <thead><tr>
          <th>Name</th>
          <th>Title / Role</th>
          <th>Company</th>
          <th>Phone</th>
          <th>Email</th>
          <th>Type</th>
          <th>Community</th>
          <th class="text-right">Actions</th>
        </tr></thead>
        <tbody id="contacts-tbody">
          <tr><td colspan="8" class="loading-spinner">Loading...</td></tr>
        </tbody>
      </table>
    </div>

    <!-- Create/Edit Modal -->
    <div class="modal-overlay" id="contact-modal" style="display:none">
      <div class="modal" style="max-width:480px">
        <div class="modal-header">
          <h3 id="contact-modal-title">Add Contact</h3>
          <button class="modal-close" id="contact-modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">Name *</label>
            <input class="form-input" id="c-name" placeholder="Full name" />
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div class="form-group">
              <label class="form-label">Title / Role</label>
              <input class="form-input" id="c-title" placeholder="e.g. Board President" />
            </div>
            <div class="form-group">
              <label class="form-label">Company</label>
              <input class="form-input" id="c-company" placeholder="Company name" />
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div class="form-group">
              <label class="form-label">Phone</label>
              <input class="form-input" id="c-phone" placeholder="Phone number" />
            </div>
            <div class="form-group">
              <label class="form-label">Email</label>
              <input class="form-input" id="c-email" type="email" placeholder="Email address" />
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div class="form-group">
              <label class="form-label">Contact Type *</label>
              <select class="form-select" id="c-type">
                ${CONTACT_TYPES.map(t => `<option value="${t}">${esc(t)}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Community *</label>
              <select class="form-select" id="c-community">
                <option value="">Select community...</option>
                ${allCommunities.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Notes</label>
            <textarea class="form-textarea" id="c-notes" placeholder="Additional notes..." style="min-height:80px"></textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="contact-modal-cancel">Cancel</button>
          <button class="btn btn-primary" id="contact-modal-save">Save Contact</button>
        </div>
      </div>
    </div>

    <!-- Delete Confirm Modal -->
    <div class="modal-overlay" id="contact-delete-modal" style="display:none">
      <div class="modal" style="max-width:400px">
        <div class="modal-header">
          <h3>Delete Contact?</h3>
          <button class="modal-close" id="del-modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <p>Are you sure you want to delete <strong id="del-contact-name"></strong>? This cannot be undone.</p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="del-modal-cancel">Cancel</button>
          <button class="btn btn-danger" id="del-modal-confirm">Delete</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('filter-community').addEventListener('change', function() {
    filterCommunityId = this.value;
    renderTable();
  });
  document.getElementById('filter-type').addEventListener('change', function() {
    filterType = this.value;
    renderTable();
  });

  document.getElementById('create-contact-btn').addEventListener('click', openCreateModal);
  document.getElementById('contact-modal-close').addEventListener('click', closeModal);
  document.getElementById('contact-modal-cancel').addEventListener('click', closeModal);
  document.getElementById('contact-modal-save').addEventListener('click', saveContact);

  document.getElementById('del-modal-close').addEventListener('click', closeDeleteModal);
  document.getElementById('del-modal-cancel').addEventListener('click', closeDeleteModal);

  await loadContacts();

  async function loadContacts() {
    try {
      currentContacts = await apiFetch('/api/contacts');
      renderTable();
    } catch (err) {
      showToast('Failed to load contacts', 'error');
      document.getElementById('contacts-tbody').innerHTML = '<tr><td colspan="8" class="empty-state">Failed to load</td></tr>';
    }
  }

  function renderTable() {
    const tbody = document.getElementById('contacts-tbody');
    let filtered = currentContacts;

    if (filterCommunityId) {
      filtered = filtered.filter(c => c.communityId === filterCommunityId);
    }
    if (filterType) {
      filtered = filtered.filter(c => c.contactType === filterType);
    }

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No contacts found</td></tr>';
      return;
    }

    const commLookup = {};
    allCommunities.forEach(c => { commLookup[c.id] = c.name; });

    tbody.innerHTML = filtered.map(c => {
      const badgeClass = TYPE_BADGE[c.contactType] || 'badge-gray';
      const communityName = c.communityName || commLookup[c.communityId] || '—';
      return `
        <tr style="cursor:pointer" class="contact-row" data-id="${c.id}">
          <td><strong>${esc(c.name)}</strong></td>
          <td class="text-muted">${esc(c.title || '—')}</td>
          <td class="text-muted">${esc(c.company || '—')}</td>
          <td class="text-muted">${esc(c.phone || '—')}</td>
          <td class="text-muted">${esc(c.email || '—')}</td>
          <td><span class="badge ${badgeClass}">${esc(c.contactType)}</span></td>
          <td class="text-muted text-sm">${esc(communityName)}</td>
          <td class="text-right">
            <button class="btn btn-secondary btn-xs edit-btn" data-id="${c.id}" style="margin-right:4px">Edit</button>
            <button class="btn btn-danger btn-xs delete-btn" data-id="${c.id}" data-name="${esc(c.name)}">Delete</button>
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const contact = currentContacts.find(c => c.id === btn.dataset.id);
        if (contact) openEditModal(contact);
      });
    });

    tbody.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openDeleteModal(btn.dataset.id, btn.dataset.name);
      });
    });

    tbody.querySelectorAll('.contact-row').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        const contact = currentContacts.find(c => c.id === row.dataset.id);
        if (contact) openEditModal(contact);
      });
    });
  }

  function openCreateModal() {
    editingContact = null;
    document.getElementById('contact-modal-title').textContent = 'Add Contact';
    document.getElementById('contact-modal-save').textContent = 'Create Contact';
    document.getElementById('c-name').value = '';
    document.getElementById('c-title').value = '';
    document.getElementById('c-company').value = '';
    document.getElementById('c-phone').value = '';
    document.getElementById('c-email').value = '';
    document.getElementById('c-type').value = 'Other';
    document.getElementById('c-community').value = '';
    document.getElementById('c-notes').value = '';
    document.getElementById('contact-modal').style.display = 'flex';
    document.getElementById('c-name').focus();
  }

  function openEditModal(contact) {
    editingContact = contact;
    document.getElementById('contact-modal-title').textContent = 'Edit Contact';
    document.getElementById('contact-modal-save').textContent = 'Save Changes';
    document.getElementById('c-name').value = contact.name || '';
    document.getElementById('c-title').value = contact.title || '';
    document.getElementById('c-company').value = contact.company || '';
    document.getElementById('c-phone').value = contact.phone || '';
    document.getElementById('c-email').value = contact.email || '';
    document.getElementById('c-type').value = contact.contactType || 'Other';
    document.getElementById('c-community').value = contact.communityId || '';
    document.getElementById('c-notes').value = contact.notes || '';
    document.getElementById('contact-modal').style.display = 'flex';
    document.getElementById('c-name').focus();
  }

  function closeModal() {
    document.getElementById('contact-modal').style.display = 'none';
    editingContact = null;
  }

  async function saveContact() {
    const name = document.getElementById('c-name').value.trim();
    const title = document.getElementById('c-title').value.trim();
    const company = document.getElementById('c-company').value.trim();
    const phone = document.getElementById('c-phone').value.trim();
    const email = document.getElementById('c-email').value.trim();
    const contactType = document.getElementById('c-type').value;
    const communityId = document.getElementById('c-community').value;
    const notes = document.getElementById('c-notes').value.trim();

    if (!name) { showToast('Name is required', 'error'); return; }
    if (!communityId) { showToast('Community is required', 'error'); return; }

    const btn = document.getElementById('contact-modal-save');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
      const body = { name, title: title || null, company: company || null, phone: phone || null, email: email || null, contactType, communityId, notes: notes || null };
      if (editingContact) {
        await apiFetch(`/api/contacts/${editingContact.id}`, { method: 'PUT', body });
        showToast('Contact updated', 'success');
      } else {
        await apiFetch('/api/contacts', { method: 'POST', body });
        showToast('Contact created', 'success');
      }
      closeModal();
      await loadContacts();
    } catch (err) {
      showToast(err.message || 'Failed to save contact', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = editingContact ? 'Save Changes' : 'Create Contact';
    }
  }

  let pendingDeleteId = null;
  function openDeleteModal(id, name) {
    pendingDeleteId = id;
    document.getElementById('del-contact-name').textContent = name;
    document.getElementById('contact-delete-modal').style.display = 'flex';
  }
  function closeDeleteModal() {
    pendingDeleteId = null;
    document.getElementById('contact-delete-modal').style.display = 'none';
  }

  document.getElementById('del-modal-confirm').addEventListener('click', async function() {
    if (!pendingDeleteId) return;
    this.disabled = true;
    this.textContent = 'Deleting...';
    try {
      await apiFetch(`/api/contacts/${pendingDeleteId}`, { method: 'DELETE' });
      showToast('Contact deleted', 'success');
      closeDeleteModal();
      await loadContacts();
    } catch (err) {
      showToast(err.message || 'Failed to delete contact', 'error');
    } finally {
      this.disabled = false;
      this.textContent = 'Delete';
    }
  });
});
