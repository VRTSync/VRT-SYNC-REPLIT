AdminRouter.register('exports', async function(container) {
  const { apiFetch, showToast } = AdminAPI;
  const communities = AdminState.getCommunities();

  container.innerHTML = `
    <div class="page-header">
      <h1>Exports</h1>
      <button class="btn btn-primary" id="new-export-btn">New Export</button>
    </div>
    <div class="card">
      <div style="margin-bottom:16px;display:flex;gap:12px;align-items:center">
        <label style="font-size:13px;font-weight:600;color:#374151">Community:</label>
        <select id="export-community-filter" class="form-select" style="max-width:260px">
          <option value="">All Communities</option>
          ${communities.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
        </select>
      </div>
      <table class="data-table" id="exports-table">
        <thead>
          <tr>
            <th>Created</th>
            <th>Community</th>
            <th>Date Range</th>
            <th>Status</th>
            <th>Download</th>
          </tr>
        </thead>
        <tbody id="exports-tbody">
          <tr><td colspan="5" style="text-align:center;color:#9CA3AF">Loading...</td></tr>
        </tbody>
      </table>
    </div>
    <div id="export-modal-container"></div>
  `;

  const tbody = document.getElementById('exports-tbody');
  const filterSelect = document.getElementById('export-community-filter');

  const communityMap = {};
  communities.forEach(c => { communityMap[c.id] = c.name; });

  async function loadExports() {
    try {
      const communityId = filterSelect.value;
      const url = communityId ? `/api/exports?communityId=${communityId}` : '/api/exports';
      const rows = await apiFetch(url);
      renderTable(rows);
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#EF4444">${err.message}</td></tr>`;
    }
  }

  function renderTable(rows) {
    if (!rows || rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#9CA3AF">No exports yet. Click "New Export" to generate a report.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(row => {
      const filters = row.filters || {};
      const dateRange = filters.dateFrom && filters.dateTo
        ? `${formatShortDate(filters.dateFrom)} — ${formatShortDate(filters.dateTo)}`
        : 'N/A';
      const communityName = communityMap[row.communityId] || row.communityId;
      const statusBadge = getStatusBadge(row.status);
      const downloads = getDownloadLinks(row);
      const created = new Date(row.createdAt).toLocaleString();

      return `<tr>
        <td>${created}</td>
        <td>${communityName}</td>
        <td>${dateRange}</td>
        <td>${statusBadge}</td>
        <td>${downloads}</td>
      </tr>`;
    }).join('');
  }

  function getStatusBadge(status) {
    const colors = {
      queued: 'background:#FEF3C7;color:#92400E',
      running: 'background:#DBEAFE;color:#1D4ED8',
      complete: 'background:#D1FAE5;color:#065F46',
      failed: 'background:#FEE2E2;color:#991B1B',
    };
    return `<span class="badge" style="${colors[status] || ''};padding:4px 10px;border-radius:12px;font-size:12px;font-weight:600">${status}</span>`;
  }

  function getDownloadLinks(row) {
    if (row.status !== 'complete') {
      if (row.status === 'failed') {
        return `<span style="color:#EF4444;font-size:12px" title="${row.errorMessage || ''}">Failed</span>`;
      }
      return '<span style="color:#9CA3AF;font-size:12px">Pending...</span>';
    }
    let links = '';
    if (row.pdfFileRef) {
      links += `<a href="/api/exports/${row.id}/download/pdf" class="btn btn-sm btn-outline" style="font-size:12px;padding:4px 10px;margin-right:6px" target="_blank">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:3px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>PDF</a>`;
    }
    if (row.photosZipRef) {
      links += `<a href="/api/exports/${row.id}/download/zip" class="btn btn-sm btn-outline" style="font-size:12px;padding:4px 10px" target="_blank">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:3px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Photos ZIP</a>`;
    }
    return links || '<span style="color:#9CA3AF;font-size:12px">No files</span>';
  }

  function formatShortDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  filterSelect.addEventListener('change', loadExports);

  document.getElementById('new-export-btn').addEventListener('click', () => {
    showNewExportModal();
  });

  async function showNewExportModal() {
    let users = [];
    try {
      users = await apiFetch('/api/admin/users');
    } catch (e) {}

    const contractors = users.filter(u => u.role === 'contractor');

    const today = new Date().toISOString().split('T')[0];
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const modalContainer = document.getElementById('export-modal-container');
    modalContainer.innerHTML = `
      <div class="modal-overlay active" id="export-modal-overlay">
        <div class="modal" style="max-width:520px">
          <div class="modal-header">
            <h2>New Proof-of-Work Export</h2>
            <button class="modal-close" id="close-export-modal">&times;</button>
          </div>
          <div class="modal-body" id="export-modal-body">
            <div class="form-group">
              <label class="form-label">Community *</label>
              <select class="form-select" id="export-community">
                ${communities.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
              </select>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div class="form-group">
                <label class="form-label">Date From *</label>
                <input type="date" class="form-input" id="export-date-from" value="${thirtyDaysAgo}" />
              </div>
              <div class="form-group">
                <label class="form-label">Date To *</label>
                <input type="date" class="form-input" id="export-date-to" value="${today}" />
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Asset Type (optional)</label>
              <select class="form-select" id="export-asset-type">
                <option value="">All Types</option>
                <option value="controller">Controller</option>
                <option value="backflow">Backflow</option>
                <option value="zone">Zone</option>
                <option value="tree">Tree</option>
                <option value="pet_station">Pet Station</option>
                <option value="landscape_bed">Landscape Bed</option>
                <option value="bluegrass_area">Bluegrass Area</option>
                <option value="native_area">Native Area</option>
                <option value="snow_area">Snow Area</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Contractor (optional)</label>
              <select class="form-select" id="export-contractor">
                <option value="">All Contractors</option>
                ${contractors.map(u => `<option value="${u.id}">${u.displayName || u.username}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Task Status</label>
              <select class="form-select" id="export-status">
                <option value="completed">Completed</option>
                <option value="all">All Statuses</option>
              </select>
            </div>
            <div class="form-group" style="margin-top:8px">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:14px">
                <input type="checkbox" id="export-include-zip" />
                Include Photos ZIP
              </label>
              <p style="font-size:12px;color:#6B7280;margin-top:4px">Bundles all completion photos into a downloadable ZIP file</p>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" id="cancel-export-modal">Cancel</button>
            <button class="btn btn-primary" id="submit-export-btn">Generate Export</button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('close-export-modal').addEventListener('click', closeModal);
    document.getElementById('cancel-export-modal').addEventListener('click', closeModal);
    document.getElementById('export-modal-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'export-modal-overlay') closeModal();
    });

    document.getElementById('submit-export-btn').addEventListener('click', async () => {
      const communityId = document.getElementById('export-community').value;
      const dateFrom = document.getElementById('export-date-from').value;
      const dateTo = document.getElementById('export-date-to').value;
      const assetType = document.getElementById('export-asset-type').value;
      const contractorId = document.getElementById('export-contractor').value;
      const status = document.getElementById('export-status').value;
      const includePhotosZip = document.getElementById('export-include-zip').checked;

      if (!communityId || !dateFrom || !dateTo) {
        showToast('Please fill in all required fields', 'error');
        return;
      }

      if (new Date(dateFrom) > new Date(dateTo)) {
        showToast('Date From must be before Date To', 'error');
        return;
      }

      const submitBtn = document.getElementById('submit-export-btn');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Generating...';

      try {
        const result = await apiFetch('/api/exports/proof-of-work', {
          method: 'POST',
          body: { communityId, dateFrom, dateTo, assetType, contractorId, status, includePhotosZip },
        });

        showToast('Export started! Waiting for completion...', 'info');

        await pollExportStatus(result.exportId);
      } catch (err) {
        showToast('Failed to create export: ' + err.message, 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Generate Export';
      }
    });

    function closeModal() {
      modalContainer.innerHTML = '';
    }

    async function pollExportStatus(exportId) {
      const modalBody = document.getElementById('export-modal-body');
      const submitBtn = document.getElementById('submit-export-btn');
      const cancelBtn = document.getElementById('cancel-export-modal');

      modalBody.innerHTML = `
        <div style="text-align:center;padding:40px 20px">
          <div style="width:48px;height:48px;border:3px solid #E5E7EB;border-top-color:#25C1AC;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 20px"></div>
          <h3 style="margin-bottom:8px;color:#0C1D31">Generating Report...</h3>
          <p style="color:#6B7280;font-size:14px" id="poll-status-text">Processing your proof-of-work export</p>
        </div>
        <style>@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}</style>
      `;
      submitBtn.style.display = 'none';
      cancelBtn.textContent = 'Close';

      let attempts = 0;
      const maxAttempts = 120;

      const poll = setInterval(async () => {
        attempts++;
        try {
          const exp = await apiFetch(`/api/exports/${exportId}`);
          if (exp.status === 'complete') {
            clearInterval(poll);
            showExportComplete(exp);
            loadExports();
          } else if (exp.status === 'failed') {
            clearInterval(poll);
            showExportFailed(exp.errorMessage || 'Unknown error');
            loadExports();
          } else if (attempts >= maxAttempts) {
            clearInterval(poll);
            showExportFailed('Export timed out');
          }
        } catch (err) {
          clearInterval(poll);
          showExportFailed('Lost connection: ' + err.message);
        }
      }, 2000);

      function showExportComplete(exp) {
        modalBody.innerHTML = `
          <div style="text-align:center;padding:30px 20px">
            <div style="width:52px;height:52px;background:#D1FAE5;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 16px">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <h3 style="margin-bottom:8px;color:#0C1D31">Export Complete!</h3>
            <p style="color:#6B7280;font-size:14px;margin-bottom:24px">Your proof-of-work report is ready to download</p>
            <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
              ${exp.pdfFileRef ? `<a href="/api/exports/${exp.id}/download/pdf" class="btn btn-primary" target="_blank" style="text-decoration:none">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Download PDF</a>` : ''}
              ${exp.photosZipRef ? `<a href="/api/exports/${exp.id}/download/zip" class="btn btn-outline" target="_blank" style="text-decoration:none">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Download Photos ZIP</a>` : ''}
            </div>
          </div>
        `;
      }

      function showExportFailed(message) {
        modalBody.innerHTML = `
          <div style="text-align:center;padding:30px 20px">
            <div style="width:52px;height:52px;background:#FEE2E2;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 16px">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#DC2626" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
            </div>
            <h3 style="margin-bottom:8px;color:#0C1D31">Export Failed</h3>
            <p style="color:#EF4444;font-size:14px">${message}</p>
          </div>
        `;
      }
    }
  }

  loadExports();
});
