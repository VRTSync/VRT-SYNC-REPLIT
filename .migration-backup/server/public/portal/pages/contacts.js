PortalRouter.register('contacts', async function (container) {
  const ctx = PortalState.getCommunityContext();
  const { role, activeCommunity } = ctx;
  const M = PortalModules;

  if (!activeCommunity) {
    if (ctx.isMultiCommunityUser) {
      PortalRouter.navigate('communities');
      return;
    }
    container.innerHTML = `
      <div class="empty-state" style="margin-top:80px;">
        <h3 style="color:var(--navy);margin-bottom:8px;">No community assigned</h3>
        <p style="color:var(--gray-500);">Contact your administrator to get access to a community.</p>
      </div>`;
    return;
  }

  const canEdit = ['property_manager', 'hoa_admin'].includes(role);

  const CONTACT_TYPES = ['HOA Board', 'Property Management', 'Contractor', 'Vendor', 'City/Municipality', 'Emergency', 'Other'];
  const TYPE_BADGE = {
    'HOA Board': { bg: '#f3e8ff', color: '#7c3aed' },
    'Property Management': { bg: 'rgba(59,130,246,0.1)', color: '#2563eb' },
    'Contractor': { bg: 'rgba(37,193,172,0.1)', color: '#0d9488' },
    'Vendor': { bg: 'rgba(245,158,11,0.1)', color: '#b45309' },
    'City/Municipality': { bg: 'rgba(59,130,246,0.1)', color: '#2563eb' },
    'Emergency': { bg: 'rgba(239,68,68,0.1)', color: '#dc2626' },
    'Other': { bg: '#f3f4f6', color: '#4b5563' },
  };

  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function typeBadge(type) {
    const b = TYPE_BADGE[type] || TYPE_BADGE['Other'];
    return `<span style="display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600;background:${b.bg};color:${b.color};">${esc(type)}</span>`;
  }

  container.innerHTML = M.pageHeader('Contacts', activeCommunity) + `
    <div id="contacts-root">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <select id="portal-filter-type" style="padding:7px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;font-family:inherit;background:#fff;min-width:160px;">
            <option value="">All Types</option>
            ${CONTACT_TYPES.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}
          </select>
        </div>
        ${canEdit ? `<button class="btn btn-primary btn-sm" id="portal-add-contact-btn">+ Add Contact</button>` : ''}
      </div>
      <div class="table-container">
        <table class="admin-table" style="width:100%;">
          <thead><tr>
            <th>Name</th>
            <th>Title / Role</th>
            <th>Company</th>
            <th>Phone</th>
            <th>Email</th>
            <th>Type</th>
            ${canEdit ? '<th style="width:120px;text-align:right;">Actions</th>' : ''}
          </tr></thead>
          <tbody id="portal-contacts-tbody">
            <tr><td colspan="${canEdit ? 7 : 6}" style="text-align:center;padding:40px;color:var(--gray-400);">Loading...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  let allContacts = [];
  let filterType = '';
  let editingContact = null;

  if (canEdit) {
    document.getElementById('portal-add-contact-btn').addEventListener('click', openCreateModal);
  }
  document.getElementById('portal-filter-type').addEventListener('change', function() {
    filterType = this.value;
    renderTable();
  });

  await loadContacts();

  function buildUrl() {
    return '/api/contacts?communityId=' + encodeURIComponent(activeCommunity.id);
  }

  async function loadContacts() {
    try {
      allContacts = await PortalAPI.apiFetch(buildUrl());
      renderTable();
    } catch (err) {
      console.error('Load contacts error:', err);
      const tbody = document.getElementById('portal-contacts-tbody');
      if (tbody) tbody.innerHTML = `<tr><td colspan="${canEdit ? 7 : 6}" style="text-align:center;padding:32px;color:var(--gray-400);">Failed to load contacts. Please refresh.</td></tr>`;
    }
  }

  function renderTable() {
    const tbody = document.getElementById('portal-contacts-tbody');
    if (!tbody) return;

    let filtered = allContacts;
    if (filterType) {
      filtered = filtered.filter(c => c.contactType === filterType);
    }

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${canEdit ? 7 : 6}" style="text-align:center;padding:40px;color:var(--gray-400);">${canEdit ? 'No contacts yet. Add one to get started.' : 'No contacts available.'}</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(c => `
      <tr style="cursor:pointer;" class="portal-contact-row" data-id="${esc(c.id)}">
        <td style="font-weight:500;">${esc(c.name)}</td>
        <td style="color:var(--gray-500);font-size:13px;">${esc(c.title || '—')}</td>
        <td style="color:var(--gray-500);font-size:13px;">${esc(c.company || '—')}</td>
        <td style="color:var(--gray-500);font-size:13px;">${c.phone ? `<a href="tel:${esc(c.phone)}" style="color:var(--primary);text-decoration:none;">${esc(c.phone)}</a>` : '—'}</td>
        <td style="color:var(--gray-500);font-size:13px;">${c.email ? `<a href="mailto:${esc(c.email)}" style="color:var(--primary);text-decoration:none;">${esc(c.email)}</a>` : '—'}</td>
        <td>${typeBadge(c.contactType)}</td>
        ${canEdit ? `<td style="text-align:right;">
          <button class="btn btn-ghost btn-xs portal-edit-btn" data-id="${esc(c.id)}" title="Edit" style="margin-right:4px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn btn-ghost btn-xs portal-delete-btn" data-id="${esc(c.id)}" data-name="${esc(c.name)}" title="Delete" style="color:var(--red,#ef4444)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
        </td>` : ''}
      </tr>
    `).join('');

    if (canEdit) {
      tbody.querySelectorAll('.portal-edit-btn').forEach(btn => {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          const contact = allContacts.find(c => c.id === btn.dataset.id);
          if (contact) openEditModal(contact);
        });
      });
      tbody.querySelectorAll('.portal-delete-btn').forEach(btn => {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          openDeleteModal(btn.dataset.id, btn.dataset.name);
        });
      });
    }

    tbody.querySelectorAll('.portal-contact-row').forEach(row => {
      row.addEventListener('click', function(e) {
        if (e.target.closest('button') || e.target.closest('a')) return;
        const contact = allContacts.find(c => c.id === row.dataset.id);
        if (!contact) return;
        if (canEdit) {
          openEditModal(contact);
        } else {
          openDetailModal(contact);
        }
      });
    });
  }

  function showModal(title, bodyHtml, onSave) {
    var existing = document.querySelector('.modal-overlay');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:480px;">
        <div class="modal-header">
          <h3 class="modal-title">${esc(title)}</h3>
          <button class="modal-close" id="portal-contact-modal-close">&times;</button>
        </div>
        <div class="modal-body">${bodyHtml}</div>
        <div class="modal-footer">
          <button class="btn btn-ghost btn-sm" id="portal-contact-modal-cancel">Cancel</button>
          <button class="btn btn-primary btn-sm" id="portal-contact-modal-save">Save</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    function closeOverlay() { overlay.remove(); }
    overlay.querySelector('#portal-contact-modal-close').addEventListener('click', closeOverlay);
    overlay.querySelector('#portal-contact-modal-cancel').addEventListener('click', closeOverlay);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) closeOverlay(); });

    overlay.querySelector('#portal-contact-modal-save').addEventListener('click', async function() {
      var saveBtn = this;
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
      try {
        await onSave(overlay);
        closeOverlay();
        await loadContacts();
      } catch (err) {
        PortalAPI.showToast(err.message || 'Operation failed', 'error');
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
      }
    });
  }

  function contactFormHtml(contact) {
    const typeOptions = CONTACT_TYPES.map(t =>
      `<option value="${esc(t)}"${contact && contact.contactType === t ? ' selected' : ''}>${esc(t)}</option>`
    ).join('');
    return `
      <div class="form-group">
        <label style="display:block;font-size:13px;font-weight:600;color:var(--gray-700);margin-bottom:5px;">Name *</label>
        <input class="form-input" id="pc-name" value="${esc(contact ? contact.name : '')}" placeholder="Full name" style="width:100%;" />
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="form-group">
          <label style="display:block;font-size:13px;font-weight:600;color:var(--gray-700);margin-bottom:5px;">Title / Role</label>
          <input class="form-input" id="pc-title" value="${esc(contact ? (contact.title || '') : '')}" placeholder="e.g. Board President" style="width:100%;" />
        </div>
        <div class="form-group">
          <label style="display:block;font-size:13px;font-weight:600;color:var(--gray-700);margin-bottom:5px;">Company</label>
          <input class="form-input" id="pc-company" value="${esc(contact ? (contact.company || '') : '')}" placeholder="Company name" style="width:100%;" />
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="form-group">
          <label style="display:block;font-size:13px;font-weight:600;color:var(--gray-700);margin-bottom:5px;">Phone</label>
          <input class="form-input" id="pc-phone" value="${esc(contact ? (contact.phone || '') : '')}" placeholder="Phone number" style="width:100%;" />
        </div>
        <div class="form-group">
          <label style="display:block;font-size:13px;font-weight:600;color:var(--gray-700);margin-bottom:5px;">Email</label>
          <input class="form-input" id="pc-email" type="email" value="${esc(contact ? (contact.email || '') : '')}" placeholder="Email address" style="width:100%;" />
        </div>
      </div>
      <div class="form-group">
        <label style="display:block;font-size:13px;font-weight:600;color:var(--gray-700);margin-bottom:5px;">Contact Type *</label>
        <select class="form-select" id="pc-type" style="width:100%;">${typeOptions}</select>
      </div>
      <div class="form-group">
        <label style="display:block;font-size:13px;font-weight:600;color:var(--gray-700);margin-bottom:5px;">Notes</label>
        <textarea class="form-textarea" id="pc-notes" placeholder="Additional notes..." style="width:100%;min-height:70px;">${esc(contact ? (contact.notes || '') : '')}</textarea>
      </div>
    `;
  }

  function openDetailModal(contact) {
    var existing = document.querySelector('.modal-overlay');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:440px;">
        <div class="modal-header">
          <h3 class="modal-title">${esc(contact.name)}</h3>
          <button class="modal-close" id="portal-detail-close">&times;</button>
        </div>
        <div class="modal-body" style="display:flex;flex-direction:column;gap:14px;">
          <div style="text-align:center;margin-bottom:4px;">${typeBadge(contact.contactType)}</div>
          ${contact.title ? `<div style="display:flex;gap:10px;"><span style="font-size:13px;font-weight:600;color:var(--gray-600);min-width:90px;">Title</span><span style="font-size:14px;color:var(--gray-800);">${esc(contact.title)}</span></div>` : ''}
          ${contact.company ? `<div style="display:flex;gap:10px;"><span style="font-size:13px;font-weight:600;color:var(--gray-600);min-width:90px;">Company</span><span style="font-size:14px;color:var(--gray-800);">${esc(contact.company)}</span></div>` : ''}
          ${contact.phone ? `<div style="display:flex;gap:10px;"><span style="font-size:13px;font-weight:600;color:var(--gray-600);min-width:90px;">Phone</span><a href="tel:${esc(contact.phone)}" style="font-size:14px;color:var(--primary);text-decoration:none;">${esc(contact.phone)}</a></div>` : ''}
          ${contact.email ? `<div style="display:flex;gap:10px;"><span style="font-size:13px;font-weight:600;color:var(--gray-600);min-width:90px;">Email</span><a href="mailto:${esc(contact.email)}" style="font-size:14px;color:var(--primary);text-decoration:none;">${esc(contact.email)}</a></div>` : ''}
          ${contact.notes ? `<div style="border-top:1px solid var(--gray-100);padding-top:12px;"><p style="font-size:13px;font-weight:600;color:var(--gray-600);margin:0 0 4px;">Notes</p><p style="font-size:14px;color:var(--gray-700);margin:0;white-space:pre-wrap;">${esc(contact.notes)}</p></div>` : ''}
        </div>
        <div class="modal-footer">
          <button class="btn btn-primary btn-sm" id="portal-detail-close-btn">Close</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    function closeOverlay() { overlay.remove(); }
    overlay.querySelector('#portal-detail-close').addEventListener('click', closeOverlay);
    overlay.querySelector('#portal-detail-close-btn').addEventListener('click', closeOverlay);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) closeOverlay(); });
  }

  function openCreateModal() {
    editingContact = null;
    showModal('Add Contact', contactFormHtml(null), async function(overlay) {
      const name = overlay.querySelector('#pc-name').value.trim();
      if (!name) throw new Error('Name is required');
      const body = {
        communityId: activeCommunity.id,
        name,
        title: overlay.querySelector('#pc-title').value.trim() || null,
        company: overlay.querySelector('#pc-company').value.trim() || null,
        phone: overlay.querySelector('#pc-phone').value.trim() || null,
        email: overlay.querySelector('#pc-email').value.trim() || null,
        contactType: overlay.querySelector('#pc-type').value,
        notes: overlay.querySelector('#pc-notes').value.trim() || null,
      };
      await PortalAPI.apiFetch('/api/contacts', { method: 'POST', body });
      PortalAPI.showToast('Contact created', 'success');
    });
    setTimeout(function() {
      var inp = document.querySelector('#pc-name');
      if (inp) inp.focus();
    }, 100);
  }

  function openEditModal(contact) {
    editingContact = contact;
    showModal('Edit Contact', contactFormHtml(contact), async function(overlay) {
      const name = overlay.querySelector('#pc-name').value.trim();
      if (!name) throw new Error('Name is required');
      const body = {
        name,
        title: overlay.querySelector('#pc-title').value.trim() || null,
        company: overlay.querySelector('#pc-company').value.trim() || null,
        phone: overlay.querySelector('#pc-phone').value.trim() || null,
        email: overlay.querySelector('#pc-email').value.trim() || null,
        contactType: overlay.querySelector('#pc-type').value,
        notes: overlay.querySelector('#pc-notes').value.trim() || null,
      };
      await PortalAPI.apiFetch(`/api/contacts/${contact.id}`, { method: 'PUT', body });
      PortalAPI.showToast('Contact updated', 'success');
    });
    setTimeout(function() {
      var inp = document.querySelector('#pc-name');
      if (inp) inp.focus();
    }, 100);
  }

  function openDeleteModal(id, name) {
    var existing = document.querySelector('.modal-overlay');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:400px;">
        <div class="modal-header">
          <h3 class="modal-title">Delete Contact?</h3>
          <button class="modal-close" id="portal-del-close">&times;</button>
        </div>
        <div class="modal-body">
          <p style="margin:0;">Are you sure you want to delete <strong>${esc(name)}</strong>? This cannot be undone.</p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost btn-sm" id="portal-del-cancel">Cancel</button>
          <button class="btn btn-sm" id="portal-del-confirm" style="background:var(--red,#ef4444);color:#fff;">Delete</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    function closeOverlay() { overlay.remove(); }
    overlay.querySelector('#portal-del-close').addEventListener('click', closeOverlay);
    overlay.querySelector('#portal-del-cancel').addEventListener('click', closeOverlay);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) closeOverlay(); });

    overlay.querySelector('#portal-del-confirm').addEventListener('click', async function() {
      var btn = this;
      btn.disabled = true;
      btn.textContent = 'Deleting...';
      try {
        await PortalAPI.apiFetch('/api/contacts/' + id, { method: 'DELETE' });
        PortalAPI.showToast('Contact deleted', 'success');
        closeOverlay();
        await loadContacts();
      } catch (err) {
        PortalAPI.showToast(err.message || 'Delete failed', 'error');
        btn.disabled = false;
        btn.textContent = 'Delete';
      }
    });
  }
});
