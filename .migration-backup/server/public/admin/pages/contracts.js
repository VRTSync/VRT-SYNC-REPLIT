AdminRouter.register('contracts', async function(container) {
  const { apiFetch, showToast } = AdminAPI;
  const communities = AdminState.getCommunities();

  const communityMap = {};
  communities.forEach(c => { communityMap[c.id] = c.name; });

  var allContractors = [];
  try {
    allContractors = await apiFetch('/api/users?role=contractor');
  } catch (err) {
    console.error('Failed to load contractors:', err);
  }

  var contractorMap = {};
  allContractors.forEach(function(u) { contractorMap[u.id] = u.displayName; });

  container.innerHTML = `
    <div class="page-header">
      <h1>Contracts</h1>
      <button class="btn btn-primary" id="new-contract-btn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:4px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        New Contract
      </button>
    </div>
    <div class="card" style="margin-bottom:20px">
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <label style="font-size:13px;font-weight:600;color:var(--gray-700)">Community:</label>
        <select id="ct-community-filter" class="form-select" style="max-width:240px">
          <option value="">All Communities</option>
          ${communities.map(c => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join('')}
        </select>
        <label style="font-size:13px;font-weight:600;color:var(--gray-700);margin-left:8px">Contractor:</label>
        <select id="ct-contractor-filter" class="form-select" style="max-width:240px">
          <option value="">All Contractors</option>
          ${allContractors.map(function(u) { return '<option value="' + u.id + '">' + esc(u.displayName) + '</option>'; }).join('')}
        </select>
        <label style="font-size:13px;font-weight:600;color:var(--gray-700);margin-left:8px">Status:</label>
        <select id="ct-status-filter" class="form-select" style="max-width:180px">
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="upcoming">Upcoming</option>
          <option value="expired">Expired</option>
        </select>
      </div>
    </div>
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Community</th>
            <th>Contractor</th>
            <th>Contract Type</th>
            <th>Start Date</th>
            <th>End Date</th>
            <th>Status</th>
            <th>Services Included</th>
            <th>Document</th>
          </tr>
        </thead>
        <tbody id="contracts-tbody">
          <tr><td colspan="8" style="text-align:center;color:var(--gray-400)">Loading...</td></tr>
        </tbody>
      </table>
    </div>
    <div id="contract-modal-container"></div>
  `;

  var tbody = document.getElementById('contracts-tbody');
  var communityFilter = document.getElementById('ct-community-filter');
  var contractorFilter = document.getElementById('ct-contractor-filter');
  var statusFilter = document.getElementById('ct-status-filter');

  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function formatDate(str) {
    if (!str) return '';
    var d = new Date(str + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function computeStatus(row) {
    if (!row.isActive) return 'expired';
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var start = new Date(row.startDate + 'T00:00:00');
    var end = new Date(row.endDate + 'T00:00:00');
    if (today < start) return 'upcoming';
    if (today > end) return 'expired';
    return 'active';
  }

  function statusBadge(status) {
    var map = {
      active: '<span class="badge badge-green">Active</span>',
      upcoming: '<span class="badge badge-blue">Upcoming</span>',
      expired: '<span class="badge badge-gray">Expired</span>'
    };
    return map[status] || '<span class="badge badge-gray">' + esc(status) + '</span>';
  }

  function servicesPreview(services) {
    if (!services || !Array.isArray(services) || services.length === 0) return '<span style="color:var(--gray-300)">\u2014</span>';
    if (services.length <= 2) return esc(services.join(', '));
    return esc(services.slice(0, 2).join(', ')) + ' +' + (services.length - 2) + ' more';
  }

  async function loadContracts() {
    try {
      var params = [];
      if (communityFilter.value) params.push('communityId=' + communityFilter.value);
      if (contractorFilter.value) params.push('contractorUserId=' + contractorFilter.value);
      if (statusFilter.value) params.push('status=' + statusFilter.value);
      var url = '/api/contracts' + (params.length ? '?' + params.join('&') : '');
      var rows = await apiFetch(url);
      renderTable(rows);
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--red)">' + esc(err.message) + '</td></tr>';
    }
  }

  function renderTable(rows) {
    if (!rows || rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--gray-400)">No contracts yet. Click "New Contract" to create one.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(function(row) {
      var communityName = row.communityName || communityMap[row.communityId] || row.communityId;
      var contractorName = row.contractorName || contractorMap[row.contractorUserId] || row.contractorUserId;
      var status = computeStatus(row);
      var services = Array.isArray(row.servicesIncluded) ? row.servicesIncluded : [];
      var pdfIcon = row.pdfObjectKey
        ? '<span title="PDF attached" style="color:var(--teal);cursor:pointer" class="ct-pdf-icon" data-pdf="' + esc(row.pdfObjectKey) + '"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></span>'
        : '<span style="color:var(--gray-300)">\u2014</span>';
      return '<tr class="ct-row" data-id="' + esc(row.id) + '" style="cursor:pointer">' +
        '<td>' + esc(communityName) + '</td>' +
        '<td>' + esc(contractorName) + '</td>' +
        '<td><span class="badge badge-teal">' + esc(row.contractType) + '</span></td>' +
        '<td>' + formatDate(row.startDate) + '</td>' +
        '<td>' + formatDate(row.endDate) + '</td>' +
        '<td>' + statusBadge(status) + '</td>' +
        '<td>' + servicesPreview(services) + '</td>' +
        '<td style="text-align:center">' + pdfIcon + '</td>' +
        '</tr>';
    }).join('');

    tbody.querySelectorAll('.ct-row').forEach(function(row) {
      row.addEventListener('click', function(e) {
        if (e.target.closest('.ct-pdf-icon')) return;
        showContractDetail(row.dataset.id);
      });
    });

    tbody.querySelectorAll('.ct-pdf-icon').forEach(function(icon) {
      icon.addEventListener('click', function(e) {
        e.stopPropagation();
        window.open(icon.dataset.pdf, '_blank');
      });
    });
  }

  communityFilter.addEventListener('change', loadContracts);
  contractorFilter.addEventListener('change', loadContracts);
  statusFilter.addEventListener('change', loadContracts);

  document.getElementById('new-contract-btn').addEventListener('click', function() {
    showContractForm();
  });

  function showContractForm(contract) {
    var isEdit = !!contract;
    var title = isEdit ? 'Edit Contract' : 'New Contract';
    var modalContainer = document.getElementById('contract-modal-container');
    var existingServices = isEdit && Array.isArray(contract.servicesIncluded) ? contract.servicesIncluded : [];

    modalContainer.innerHTML = `
      <div class="modal-overlay" id="ct-modal-overlay">
        <div class="modal" style="max-width:620px">
          <div class="modal-header">
            <h3 class="modal-title">${title}</h3>
            <button class="modal-close" id="ct-modal-close">&times;</button>
          </div>
          <div class="modal-body">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
              <div class="form-group">
                <label>Community${isEdit ? ' (read-only)' : ''}</label>
                <select id="ct-community" class="form-select" ${isEdit ? 'disabled' : ''}>
                  <option value="">Select community...</option>
                  ${communities.map(c => '<option value="' + c.id + '"' + (isEdit && contract.communityId === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('')}
                </select>
              </div>
              <div class="form-group">
                <label>Contractor</label>
                <select id="ct-contractor" class="form-select">
                  <option value="">Select contractor...</option>
                  ${allContractors.map(function(u) {
                    return '<option value="' + u.id + '"' + (isEdit && contract.contractorUserId === u.id ? ' selected' : '') + '>' + esc(u.displayName) + '</option>';
                  }).join('')}
                </select>
              </div>
              <div class="form-group">
                <label>Contract Type</label>
                <select id="ct-type" class="form-select">
                  <option value="">Select type...</option>
                  ${['Landscape Maintenance', 'Snow Removal', 'Irrigation Services', 'Tree Care', 'Pest Control', 'General Maintenance', 'Other'].map(function(t) {
                    return '<option value="' + t + '"' + (isEdit && contract.contractType === t ? ' selected' : '') + '>' + t + '</option>';
                  }).join('')}
                </select>
              </div>
              <div class="form-group">
                <label>Active</label>
                <select id="ct-active" class="form-select">
                  <option value="true" ${!isEdit || contract.isActive ? 'selected' : ''}>Yes</option>
                  <option value="false" ${isEdit && !contract.isActive ? 'selected' : ''}>No (Deactivated)</option>
                </select>
              </div>
              <div class="form-group">
                <label>Start Date</label>
                <input type="date" id="ct-start" class="form-input" value="${isEdit ? (contract.startDate || '') : ''}">
              </div>
              <div class="form-group">
                <label>End Date</label>
                <input type="date" id="ct-end" class="form-input" value="${isEdit ? (contract.endDate || '') : ''}">
              </div>
              <div class="form-group" style="grid-column:span 2">
                <label>PDF Document (optional)</label>
                <div style="display:flex;gap:8px;align-items:center">
                  <button class="btn btn-secondary btn-sm" id="ct-upload-pdf-btn" type="button">Upload PDF</button>
                  <span id="ct-pdf-status" style="font-size:12px;color:var(--gray-500)">${isEdit && contract.pdfObjectKey ? 'PDF attached' : 'No file'}</span>
                  <input type="file" id="ct-pdf-input" accept="application/pdf" style="display:none">
                </div>
              </div>
            </div>
            <div class="form-group" style="margin-top:4px">
              <label>Services Included</label>
              <div id="ct-services-list"></div>
              <button class="btn btn-secondary btn-sm" id="ct-add-service-btn" type="button" style="margin-top:8px">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:4px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Add Service
              </button>
            </div>
          </div>
          <div class="modal-footer" style="display:flex;gap:8px;justify-content:flex-end;padding:16px 24px;border-top:1px solid var(--gray-200)">
            ${isEdit ? '<button class="btn btn-danger btn-sm" id="ct-delete-btn">Delete</button><div style="flex:1"></div>' : ''}
            <button class="btn btn-secondary" id="ct-cancel-btn">Cancel</button>
            <button class="btn btn-primary" id="ct-save-btn">${isEdit ? 'Update' : 'Create'}</button>
          </div>
        </div>
      </div>
    `;

    var pdfObjectKey = isEdit ? (contract.pdfObjectKey || '') : '';
    var overlay = document.getElementById('ct-modal-overlay');
    overlay.querySelector('#ct-modal-close').addEventListener('click', function() { modalContainer.innerHTML = ''; });
    overlay.querySelector('#ct-cancel-btn').addEventListener('click', function() { modalContainer.innerHTML = ''; });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) modalContainer.innerHTML = ''; });

    var pdfBtn = overlay.querySelector('#ct-upload-pdf-btn');
    var pdfInput = overlay.querySelector('#ct-pdf-input');
    var pdfStatus = overlay.querySelector('#ct-pdf-status');

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

    var servicesList = overlay.querySelector('#ct-services-list');

    function renderServices(services) {
      servicesList.innerHTML = '';
      services.forEach(function(svc, idx) {
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:6px';
        row.innerHTML = '<input type="text" class="form-input ct-service-input" value="' + esc(svc) + '" placeholder="Service name..." style="flex:1">' +
          '<button class="btn btn-ghost btn-sm ct-remove-svc" data-idx="' + idx + '" type="button" style="color:var(--red);padding:4px 8px">&times;</button>';
        servicesList.appendChild(row);
      });

      servicesList.querySelectorAll('.ct-remove-svc').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var current = getServicesFromInputs();
          current.splice(parseInt(btn.dataset.idx), 1);
          renderServices(current);
        });
      });
    }

    function getServicesFromInputs() {
      var inputs = servicesList.querySelectorAll('.ct-service-input');
      var result = [];
      inputs.forEach(function(input) {
        var val = input.value.trim();
        if (val) result.push(val);
      });
      return result;
    }

    renderServices(existingServices);

    overlay.querySelector('#ct-add-service-btn').addEventListener('click', function() {
      var current = getServicesFromInputs();
      current.push('');
      renderServices(current);
      var inputs = servicesList.querySelectorAll('.ct-service-input');
      if (inputs.length > 0) inputs[inputs.length - 1].focus();
    });

    overlay.querySelector('#ct-save-btn').addEventListener('click', async function() {
      var saveBtn = overlay.querySelector('#ct-save-btn');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      try {
        var data = {
          contractorUserId: overlay.querySelector('#ct-contractor').value,
          contractType: overlay.querySelector('#ct-type').value,
          startDate: overlay.querySelector('#ct-start').value,
          endDate: overlay.querySelector('#ct-end').value,
          servicesIncluded: getServicesFromInputs(),
          pdfObjectKey: pdfObjectKey || null,
          isActive: overlay.querySelector('#ct-active').value === 'true',
        };

        if (!isEdit) {
          data.communityId = overlay.querySelector('#ct-community').value;
        }

        if ((!isEdit && !data.communityId) || !data.contractorUserId || !data.contractType || !data.startDate || !data.endDate) {
          showToast('Please fill in all required fields', 'error');
          saveBtn.disabled = false;
          saveBtn.textContent = isEdit ? 'Update' : 'Create';
          return;
        }

        if (isEdit) {
          await apiFetch('/api/contracts/' + contract.id, { method: 'PUT', body: data });
          showToast('Contract updated', 'success');
        } else {
          await apiFetch('/api/contracts', { method: 'POST', body: data });
          showToast('Contract created', 'success');
        }
        modalContainer.innerHTML = '';
        loadContracts();
      } catch (err) {
        showToast(err.message || 'Failed to save contract', 'error');
        saveBtn.disabled = false;
        saveBtn.textContent = isEdit ? 'Update' : 'Create';
      }
    });

    if (isEdit) {
      overlay.querySelector('#ct-delete-btn').addEventListener('click', async function() {
        if (!confirm('Are you sure you want to delete this contract?')) return;
        try {
          await apiFetch('/api/contracts/' + contract.id, { method: 'DELETE' });
          showToast('Contract deleted', 'success');
          modalContainer.innerHTML = '';
          loadContracts();
        } catch (err) {
          showToast(err.message || 'Failed to delete contract', 'error');
        }
      });
    }
  }

  async function showContractDetail(id) {
    try {
      var contract = await apiFetch('/api/contracts/' + id);
      var modalContainer = document.getElementById('contract-modal-container');
      var communityName = contract.communityName || communityMap[contract.communityId] || contract.communityId;
      var contractorName = contract.contractorName || contractorMap[contract.contractorUserId] || contract.contractorUserId;
      var status = computeStatus(contract);
      var services = Array.isArray(contract.servicesIncluded) ? contract.servicesIncluded : [];

      modalContainer.innerHTML = `
        <div class="modal-overlay" id="ct-detail-overlay">
          <div class="modal" style="max-width:560px">
            <div class="modal-header">
              <h3 class="modal-title">Contract Details</h3>
              <button class="modal-close" id="ct-detail-close">&times;</button>
            </div>
            <div class="modal-body">
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
                <div>
                  <div style="font-size:12px;color:var(--gray-400);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Community</div>
                  <div style="font-weight:600;color:var(--navy)">${esc(communityName)}</div>
                </div>
                <div>
                  <div style="font-size:12px;color:var(--gray-400);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Contractor</div>
                  <div style="font-weight:600;color:var(--navy)">${esc(contractorName)}</div>
                </div>
                <div>
                  <div style="font-size:12px;color:var(--gray-400);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Contract Type</div>
                  <div><span class="badge badge-teal">${esc(contract.contractType)}</span></div>
                </div>
                <div>
                  <div style="font-size:12px;color:var(--gray-400);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Status</div>
                  <div>${statusBadge(status)}</div>
                </div>
                <div>
                  <div style="font-size:12px;color:var(--gray-400);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Start Date</div>
                  <div style="font-weight:600;color:var(--navy)">${formatDate(contract.startDate)}</div>
                </div>
                <div>
                  <div style="font-size:12px;color:var(--gray-400);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">End Date</div>
                  <div style="font-weight:600;color:var(--navy)">${formatDate(contract.endDate)}</div>
                </div>
                <div>
                  <div style="font-size:12px;color:var(--gray-400);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Active</div>
                  <div>${contract.isActive ? '<span class="badge badge-green">Yes</span>' : '<span class="badge badge-red">No</span>'}</div>
                </div>
                <div>
                  <div style="font-size:12px;color:var(--gray-400);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Document</div>
                  ${contract.pdfObjectKey
                    ? '<a href="' + esc(contract.pdfObjectKey) + '" target="_blank" class="btn btn-secondary btn-sm" style="margin-top:2px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;vertical-align:-2px"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>View PDF</a>'
                    : '<span style="color:var(--gray-400)">No PDF attached</span>'}
                </div>
              </div>
              ${services.length > 0 ? `
                <div style="margin-top:16px;padding:12px 16px;background:var(--gray-50);border-radius:var(--radius);border:1px solid var(--gray-200)">
                  <div style="font-size:12px;color:var(--gray-400);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Services Included</div>
                  <ul style="margin:0;padding-left:20px;color:var(--navy)">
                    ${services.map(function(s) { return '<li style="margin-bottom:4px;font-size:14px">' + esc(s) + '</li>'; }).join('')}
                  </ul>
                </div>
              ` : ''}
            </div>
            <div class="modal-footer" style="display:flex;gap:8px;justify-content:flex-end;padding:16px 24px;border-top:1px solid var(--gray-200)">
              <button class="btn btn-secondary" id="ct-detail-edit-btn">Edit</button>
              <button class="btn btn-ghost" id="ct-detail-done-btn">Close</button>
            </div>
          </div>
        </div>
      `;

      var detailOverlay = document.getElementById('ct-detail-overlay');
      detailOverlay.querySelector('#ct-detail-close').addEventListener('click', function() { modalContainer.innerHTML = ''; });
      detailOverlay.querySelector('#ct-detail-done-btn').addEventListener('click', function() { modalContainer.innerHTML = ''; });
      detailOverlay.addEventListener('click', function(e) { if (e.target === detailOverlay) modalContainer.innerHTML = ''; });
      detailOverlay.querySelector('#ct-detail-edit-btn').addEventListener('click', function() {
        modalContainer.innerHTML = '';
        showContractForm(contract);
      });
    } catch (err) {
      showToast(err.message || 'Failed to load contract', 'error');
    }
  }

  await loadContracts();
});
