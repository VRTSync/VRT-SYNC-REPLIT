AdminRouter.register('invoices', async function(container) {
  const { apiFetch, showToast } = AdminAPI;
  const communities = AdminState.getCommunities();

  const communityMap = {};
  communities.forEach(c => { communityMap[c.id] = c.name; });

  container.innerHTML = `
    <div class="page-header">
      <h1>Invoices</h1>
      <button class="btn btn-primary" id="new-invoice-btn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:4px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        New Invoice
      </button>
    </div>
    <div class="card" style="margin-bottom:20px">
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <label style="font-size:13px;font-weight:600;color:var(--gray-700)">Community:</label>
        <select id="inv-community-filter" class="form-select" style="max-width:240px">
          <option value="">All Communities</option>
          ${communities.map(c => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join('')}
        </select>
      </div>
    </div>
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Completion Date</th>
            <th>Community</th>
            <th>Contractor</th>
            <th>Service Type</th>
            <th>Attachment Target</th>
            <th>Cost</th>
            <th>PDF</th>
          </tr>
        </thead>
        <tbody id="invoices-tbody">
          <tr><td colspan="7" style="text-align:center;color:var(--gray-400)">Loading...</td></tr>
        </tbody>
      </table>
    </div>
    <div id="invoice-modal-container"></div>
  `;

  const tbody = document.getElementById('invoices-tbody');
  const filterSelect = document.getElementById('inv-community-filter');

  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function formatDate(str) {
    if (!str) return '';
    var d = new Date(str + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function formatCurrency(val) {
    if (val == null) return '';
    return '$' + Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  async function loadInvoices() {
    try {
      var communityId = filterSelect.value;
      var url = communityId ? '/api/invoices?communityId=' + communityId : '/api/invoices';
      var rows = await apiFetch(url);
      renderTable(rows);
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--red)">' + esc(err.message) + '</td></tr>';
    }
  }

  function renderTable(rows) {
    if (!rows || rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--gray-400)">No invoices yet. Click "New Invoice" to create one.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(function(row) {
      var communityName = row.communityName || communityMap[row.communityId] || row.communityId;
      var pdfIcon = row.pdfObjectKey
        ? '<span title="PDF attached" style="color:var(--teal);cursor:pointer" class="inv-pdf-icon" data-pdf="' + esc(row.pdfObjectKey) + '"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></span>'
        : '<span style="color:var(--gray-300)">—</span>';
      return '<tr class="inv-row" data-id="' + esc(row.id) + '" style="cursor:pointer">' +
        '<td>' + formatDate(row.completionDate) + '</td>' +
        '<td>' + esc(communityName) + '</td>' +
        '<td>' + esc(row.contractor) + '</td>' +
        '<td><span class="badge badge-teal">' + esc(row.serviceType) + '</span></td>' +
        '<td>' + (row.attachmentLabel ? '<span style="font-size:13px;color:var(--gray-600)">' + esc(row.attachmentLabel) + '</span>' : '<span style="color:var(--gray-300)">—</span>') + '</td>' +
        '<td style="font-weight:600">' + formatCurrency(row.cost) + '</td>' +
        '<td style="text-align:center">' + pdfIcon + '</td>' +
        '</tr>';
    }).join('');

    tbody.querySelectorAll('.inv-row').forEach(function(row) {
      row.addEventListener('click', function(e) {
        if (e.target.closest('.inv-pdf-icon')) return;
        showInvoiceDetail(row.dataset.id);
      });
    });

    tbody.querySelectorAll('.inv-pdf-icon').forEach(function(icon) {
      icon.addEventListener('click', function(e) {
        e.stopPropagation();
        window.open(icon.dataset.pdf, '_blank');
      });
    });
  }

  filterSelect.addEventListener('change', loadInvoices);

  document.getElementById('new-invoice-btn').addEventListener('click', function() {
    showInvoiceForm();
  });

  function showInvoiceForm(invoice) {
    var isEdit = !!invoice;
    var title = isEdit ? 'Edit Invoice' : 'New Invoice';
    var modalContainer = document.getElementById('invoice-modal-container');

    modalContainer.innerHTML = `
      <div class="modal-overlay" id="inv-modal-overlay">
        <div class="modal" style="max-width:620px">
          <div class="modal-header">
            <h3 class="modal-title">${title}</h3>
            <button class="modal-close" id="inv-modal-close">&times;</button>
          </div>
          <div class="modal-body">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
              <div class="form-group">
                <label>Community</label>
                <select id="inv-community" class="form-select">
                  <option value="">Select community...</option>
                  ${communities.map(c => '<option value="' + c.id + '"' + (invoice && invoice.communityId === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('')}
                </select>
              </div>
              <div class="form-group">
                <label>Contractor</label>
                <input type="text" id="inv-contractor" class="form-input" value="${isEdit ? esc(invoice.contractor) : ''}" placeholder="Contractor name">
              </div>
              <div class="form-group">
                <label>Completion Date</label>
                <input type="date" id="inv-date" class="form-input" value="${isEdit ? (invoice.completionDate || '') : ''}">
              </div>
              <div class="form-group">
                <label>Service Type</label>
                <select id="inv-service-type" class="form-select">
                  <option value="">Select type...</option>
                  ${['Irrigation Repair', 'Tree Trimming', 'Landscape Maintenance', 'Snow Removal', 'Mowing', 'Fertilization', 'Pest Control', 'General Maintenance', 'Other'].map(function(t) {
                    return '<option value="' + t + '"' + (isEdit && invoice.serviceType === t ? ' selected' : '') + '>' + t + '</option>';
                  }).join('')}
                </select>
              </div>
              <div class="form-group">
                <label>Cost ($)</label>
                <input type="number" id="inv-cost" class="form-input" step="0.01" min="0" value="${isEdit ? invoice.cost : ''}" placeholder="0.00">
              </div>
              <div class="form-group">
                <label>PDF (optional)</label>
                <div style="display:flex;gap:8px;align-items:center">
                  <button class="btn btn-secondary btn-sm" id="inv-upload-pdf-btn" type="button">Upload PDF</button>
                  <span id="inv-pdf-status" style="font-size:12px;color:var(--gray-500)">${isEdit && invoice.pdfObjectKey ? 'PDF attached' : 'No file'}</span>
                  <input type="file" id="inv-pdf-input" accept="application/pdf" style="display:none">
                </div>
              </div>
            </div>
            <div class="form-group" style="margin-top:4px">
              <label>Attachment Target (optional)</label>
              <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
                <select id="inv-layer" class="form-select">
                  <option value="">Layer category...</option>
                </select>
                <select id="inv-sublayer" class="form-select" disabled>
                  <option value="">Sub-layer...</option>
                </select>
                <select id="inv-asset" class="form-select" disabled>
                  <option value="">Asset...</option>
                </select>
              </div>
              <input type="hidden" id="inv-attachment-label" value="${isEdit ? esc(invoice.attachmentLabel || '') : ''}">
              <input type="hidden" id="inv-attachment-layer-id" value="${isEdit ? esc(invoice.attachmentLayerId || '') : ''}">
              ${isEdit && invoice.attachmentLabel ? '<div style="margin-top:6px;font-size:13px;color:var(--gray-600)">Current: ' + esc(invoice.attachmentLabel) + '</div>' : ''}
            </div>
            <div class="form-group">
              <label>Notes</label>
              <textarea id="inv-notes" class="form-textarea" rows="3" placeholder="Optional notes...">${isEdit ? esc(invoice.notes || '') : ''}</textarea>
            </div>
          </div>
          <div class="modal-footer" style="display:flex;gap:8px;justify-content:flex-end;padding:16px 24px;border-top:1px solid var(--gray-200)">
            ${isEdit ? '<button class="btn btn-danger btn-sm" id="inv-delete-btn">Delete</button><div style="flex:1"></div>' : ''}
            <button class="btn btn-secondary" id="inv-cancel-btn">Cancel</button>
            <button class="btn btn-primary" id="inv-save-btn">${isEdit ? 'Update' : 'Create'}</button>
          </div>
        </div>
      </div>
    `;

    var pdfObjectKey = isEdit ? (invoice.pdfObjectKey || '') : '';

    var overlay = document.getElementById('inv-modal-overlay');
    overlay.querySelector('#inv-modal-close').addEventListener('click', function() { modalContainer.innerHTML = ''; });
    overlay.querySelector('#inv-cancel-btn').addEventListener('click', function() { modalContainer.innerHTML = ''; });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) modalContainer.innerHTML = ''; });

    var pdfBtn = overlay.querySelector('#inv-upload-pdf-btn');
    var pdfInput = overlay.querySelector('#inv-pdf-input');
    var pdfStatus = overlay.querySelector('#inv-pdf-status');

    pdfBtn.addEventListener('click', function() { pdfInput.click(); });
    pdfInput.addEventListener('change', async function() {
      if (!pdfInput.files.length) return;
      var file = pdfInput.files[0];
      if (file.type !== 'application/pdf') {
        showToast('Please select a PDF file', 'error');
        return;
      }
      pdfStatus.textContent = 'Uploading...';
      pdfBtn.disabled = true;
      try {
        var uploadData = await apiFetch('/api/objects/upload', { method: 'POST' });
        await fetch(uploadData.uploadURL, { method: 'PUT', body: file });
        var confirmData = await apiFetch('/api/objects/confirm', { method: 'POST', body: { uploadURL: uploadData.uploadURL } });
        pdfObjectKey = confirmData.objectPath;
        pdfStatus.textContent = 'PDF uploaded';
        pdfStatus.style.color = 'var(--green)';
      } catch (err) {
        pdfStatus.textContent = 'Upload failed';
        pdfStatus.style.color = 'var(--red)';
        showToast('PDF upload failed', 'error');
      }
      pdfBtn.disabled = false;
    });

    var communitySelect = overlay.querySelector('#inv-community');
    var layerSelect = overlay.querySelector('#inv-layer');
    var sublayerSelect = overlay.querySelector('#inv-sublayer');
    var assetSelect = overlay.querySelector('#inv-asset');
    var layerCache = {};

    communitySelect.addEventListener('change', function() {
      loadLayers(communitySelect.value);
    });

    async function loadLayers(communityId) {
      layerSelect.innerHTML = '<option value="">Layer category...</option>';
      sublayerSelect.innerHTML = '<option value="">Sub-layer...</option>';
      sublayerSelect.disabled = true;
      assetSelect.innerHTML = '<option value="">Asset...</option>';
      assetSelect.disabled = true;
      if (!communityId) return;

      try {
        var layers = await apiFetch('/api/map-layers?communityId=' + communityId);
        if (!Array.isArray(layers)) return;
        layerCache = {};
        var layerKeys = {};
        layers.forEach(function(l) {
          if (!layerKeys[l.layerKey]) layerKeys[l.layerKey] = [];
          layerKeys[l.layerKey].push(l);
        });
        Object.keys(layerKeys).sort().forEach(function(key) {
          layerSelect.innerHTML += '<option value="' + key + '">' + esc(key.charAt(0).toUpperCase() + key.slice(1)) + '</option>';
          layerCache[key] = layerKeys[key];
        });
      } catch (err) {
        console.error('Failed to load layers:', err);
      }
    }

    layerSelect.addEventListener('change', function() {
      var key = layerSelect.value;
      sublayerSelect.innerHTML = '<option value="">Sub-layer...</option>';
      sublayerSelect.disabled = true;
      assetSelect.innerHTML = '<option value="">Asset...</option>';
      assetSelect.disabled = true;
      if (!key || !layerCache[key]) return;

      layerCache[key].forEach(function(l) {
        sublayerSelect.innerHTML += '<option value="' + esc(l.id) + '" data-display="' + esc(l.displayName) + '">' + esc(l.displayName) + '</option>';
      });
      sublayerSelect.disabled = false;
    });

    sublayerSelect.addEventListener('change', async function() {
      var layerId = sublayerSelect.value;
      assetSelect.innerHTML = '<option value="">Asset...</option>';
      assetSelect.disabled = true;
      if (!layerId) return;

      var communityId = communitySelect.value;
      if (!communityId) return;

      try {
        var allAssets = await apiFetch('/api/communities/' + communityId + '/assets');
        if (!Array.isArray(allAssets)) return;
        var filtered = allAssets.filter(function(a) { return a.mapLayerId === layerId; });
        filtered.sort(function(a, b) { return (a.label || '').localeCompare(b.label || ''); });
        filtered.forEach(function(a) {
          assetSelect.innerHTML += '<option value="' + esc(a.id) + '" data-label="' + esc(a.label) + '">' + esc(a.label) + '</option>';
        });
        if (filtered.length > 0) assetSelect.disabled = false;
      } catch (err) {
        console.error('Failed to load assets:', err);
      }
    });

    function buildAttachmentLabel() {
      var parts = [];
      if (layerSelect.value) {
        parts.push(layerSelect.options[layerSelect.selectedIndex].text);
      }
      if (sublayerSelect.value) {
        parts.push(sublayerSelect.options[sublayerSelect.selectedIndex].text);
      }
      if (assetSelect.value) {
        parts.push(assetSelect.options[assetSelect.selectedIndex].text);
      }
      return parts.length > 0 ? parts.join(' \u2192 ') : '';
    }

    if (communitySelect.value) {
      loadLayers(communitySelect.value);
    }

    overlay.querySelector('#inv-save-btn').addEventListener('click', async function() {
      var saveBtn = overlay.querySelector('#inv-save-btn');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      try {
        var data = {
          communityId: communitySelect.value,
          contractor: overlay.querySelector('#inv-contractor').value.trim(),
          completionDate: overlay.querySelector('#inv-date').value,
          serviceType: overlay.querySelector('#inv-service-type').value,
          cost: parseFloat(overlay.querySelector('#inv-cost').value) || 0,
          notes: overlay.querySelector('#inv-notes').value.trim() || null,
          pdfObjectKey: pdfObjectKey || null,
          attachmentLabel: buildAttachmentLabel() || overlay.querySelector('#inv-attachment-label').value || null,
          attachmentLayerId: sublayerSelect.value || overlay.querySelector('#inv-attachment-layer-id').value || null,
        };

        if (!data.communityId || !data.contractor || !data.completionDate || !data.serviceType) {
          showToast('Please fill in all required fields', 'error');
          saveBtn.disabled = false;
          saveBtn.textContent = isEdit ? 'Update' : 'Create';
          return;
        }

        if (isEdit) {
          await apiFetch('/api/invoices/' + invoice.id, { method: 'PUT', body: data });
          showToast('Invoice updated', 'success');
        } else {
          await apiFetch('/api/invoices', { method: 'POST', body: data });
          showToast('Invoice created', 'success');
        }
        modalContainer.innerHTML = '';
        loadInvoices();
      } catch (err) {
        showToast(err.message || 'Failed to save invoice', 'error');
        saveBtn.disabled = false;
        saveBtn.textContent = isEdit ? 'Update' : 'Create';
      }
    });

    if (isEdit) {
      overlay.querySelector('#inv-delete-btn').addEventListener('click', async function() {
        if (!confirm('Are you sure you want to delete this invoice?')) return;
        try {
          await apiFetch('/api/invoices/' + invoice.id, { method: 'DELETE' });
          showToast('Invoice deleted', 'success');
          modalContainer.innerHTML = '';
          loadInvoices();
        } catch (err) {
          showToast(err.message || 'Failed to delete invoice', 'error');
        }
      });
    }
  }

  async function showInvoiceDetail(id) {
    try {
      var invoice = await apiFetch('/api/invoices/' + id);
      var modalContainer = document.getElementById('invoice-modal-container');
      var communityName = invoice.communityName || communityMap[invoice.communityId] || invoice.communityId;

      modalContainer.innerHTML = `
        <div class="modal-overlay" id="inv-detail-overlay">
          <div class="modal" style="max-width:560px">
            <div class="modal-header">
              <h3 class="modal-title">Invoice Details</h3>
              <button class="modal-close" id="inv-detail-close">&times;</button>
            </div>
            <div class="modal-body">
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
                <div>
                  <div style="font-size:12px;color:var(--gray-400);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Contractor</div>
                  <div style="font-weight:600;color:var(--navy)">${esc(invoice.contractor)}</div>
                </div>
                <div>
                  <div style="font-size:12px;color:var(--gray-400);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Completion Date</div>
                  <div style="font-weight:600;color:var(--navy)">${formatDate(invoice.completionDate)}</div>
                </div>
                <div>
                  <div style="font-size:12px;color:var(--gray-400);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Community</div>
                  <div style="color:var(--navy)">${esc(communityName)}</div>
                </div>
                <div>
                  <div style="font-size:12px;color:var(--gray-400);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Service Type</div>
                  <div><span class="badge badge-teal">${esc(invoice.serviceType)}</span></div>
                </div>
                <div>
                  <div style="font-size:12px;color:var(--gray-400);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Cost</div>
                  <div style="font-size:20px;font-weight:700;color:var(--teal)">${formatCurrency(invoice.cost)}</div>
                </div>
                <div>
                  <div style="font-size:12px;color:var(--gray-400);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">PDF</div>
                  ${invoice.pdfObjectKey
                    ? '<a href="' + esc(invoice.pdfObjectKey) + '" target="_blank" class="btn btn-secondary btn-sm" style="margin-top:2px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;vertical-align:-2px"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>View PDF</a>'
                    : '<span style="color:var(--gray-400)">No PDF attached</span>'}
                </div>
              </div>
              ${invoice.attachmentLabel ? `
                <div style="margin-top:16px;padding:12px 16px;background:var(--gray-50);border-radius:var(--radius);border:1px solid var(--gray-200)">
                  <div style="font-size:12px;color:var(--gray-400);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Attachment Target</div>
                  <div style="font-size:14px;font-weight:500;color:var(--navy)">${esc(invoice.attachmentLabel)}</div>
                </div>
              ` : ''}
              ${invoice.notes ? `
                <div style="margin-top:16px">
                  <div style="font-size:12px;color:var(--gray-400);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Notes</div>
                  <div style="color:var(--gray-700);white-space:pre-wrap">${esc(invoice.notes)}</div>
                </div>
              ` : ''}
            </div>
            <div class="modal-footer" style="display:flex;gap:8px;justify-content:flex-end;padding:16px 24px;border-top:1px solid var(--gray-200)">
              <button class="btn btn-secondary" id="inv-detail-edit-btn">Edit</button>
              <button class="btn btn-ghost" id="inv-detail-done-btn">Close</button>
            </div>
          </div>
        </div>
      `;

      var detailOverlay = document.getElementById('inv-detail-overlay');
      detailOverlay.querySelector('#inv-detail-close').addEventListener('click', function() { modalContainer.innerHTML = ''; });
      detailOverlay.querySelector('#inv-detail-done-btn').addEventListener('click', function() { modalContainer.innerHTML = ''; });
      detailOverlay.addEventListener('click', function(e) { if (e.target === detailOverlay) modalContainer.innerHTML = ''; });
      detailOverlay.querySelector('#inv-detail-edit-btn').addEventListener('click', function() {
        modalContainer.innerHTML = '';
        showInvoiceForm(invoice);
      });
    } catch (err) {
      showToast(err.message || 'Failed to load invoice', 'error');
    }
  }

  await loadInvoices();
});
