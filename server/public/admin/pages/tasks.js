window._renderTasks = async function(container, communityId) {
  const { apiFetch, showToast } = AdminAPI;

  container.innerHTML = `
    <div class="page-header" style="margin-top:16px">
      <h2 style="font-size:16px">Tasks</h2>
      <div style="display:flex;gap:8px">
        <button class="btn btn-secondary btn-sm" id="import-csv-btn">Import CSV</button>
        <button class="btn btn-primary btn-sm" id="add-task-btn">+ New Task</button>
      </div>
    </div>
    <div class="filters-bar">
      <select class="form-select" id="task-status-filter">
        <option value="">All statuses</option>
        <option value="pending">Pending</option>
        <option value="in_progress">In Progress</option>
        <option value="completed">Completed</option>
      </select>
    </div>
    <div class="table-container">
      <table>
        <thead><tr>
          <th>Title</th>
          <th>Type</th>
          <th>Status</th>
          <th>Priority</th>
          <th>Assigned To</th>
          <th>Window</th>
          <th>Linked Asset</th>
          <th class="text-right">Actions</th>
        </tr></thead>
        <tbody id="tasks-tbody">
          <tr><td colspan="8" class="loading-spinner">Loading...</td></tr>
        </tbody>
      </table>
    </div>
  `;

  let contractors = [];
  let assets = [];
  let allTasks = [];

  try {
    [contractors, assets] = await Promise.all([
      apiFetch('/api/contractors'),
      apiFetch(`/api/communities/${communityId}/assets`),
    ]);
  } catch {}

  document.getElementById('add-task-btn').addEventListener('click', () => showTaskModal());
  document.getElementById('import-csv-btn').addEventListener('click', () => showImportCsvModal());
  document.getElementById('task-status-filter').addEventListener('change', renderTasks);
  await loadTasks();

  async function loadTasks() {
    try {
      allTasks = await apiFetch(`/api/tasks?communityId=${communityId}`);
      renderTasks();
    } catch (err) {
      showToast('Failed to load tasks', 'error');
    }
  }

  function formatDateWindow(task) {
    if (task.windowStart && task.windowEnd) {
      const ws = new Date(task.windowStart + 'T00:00:00').toLocaleDateString();
      const we = new Date(task.windowEnd + 'T00:00:00').toLocaleDateString();
      return `${ws} \u2013 ${we}`;
    }
    const s = task.startDate ? new Date(task.startDate).toLocaleDateString() : null;
    const d = task.dueDate ? new Date(task.dueDate).toLocaleDateString() : null;
    if (s && d) return `${s} \u2013 ${d}`;
    if (d) return `Due ${d}`;
    if (s) return `Start ${s}`;
    return '\u2014';
  }

  function renderTasks() {
    const statusFilter = document.getElementById('task-status-filter').value;
    let filtered = allTasks;
    if (statusFilter) filtered = filtered.filter(t => t.status === statusFilter);

    const tbody = document.getElementById('tasks-tbody');
    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No tasks match filters</td></tr>';
      return;
    }
    tbody.innerHTML = filtered.map(t => {
      const statusBadge = {
        pending: 'badge-amber',
        in_progress: 'badge-blue',
        completed: 'badge-green',
      }[t.status] || 'badge-gray';
      const priorityClass = `priority-${t.priority || 'medium'}`;
      return `
        <tr>
          <td><strong>${esc(t.title)}</strong>${t.description ? `<br><span class="text-sm text-muted">${esc(t.description.substring(0, 80))}${t.description.length > 80 ? '...' : ''}</span>` : ''}</td>
          <td class="text-sm">${esc(t.ticketType || '\u2014')}</td>
          <td><span class="badge ${statusBadge}">${esc(t.status)}</span></td>
          <td><span class="${priorityClass}">${esc(t.priority || 'medium')}</span></td>
          <td class="text-sm">${esc(t.assignedToName || '\u2014')}</td>
          <td class="text-sm" style="white-space:nowrap">${formatDateWindow(t)}</td>
          <td class="text-sm" id="link-cell-${t.id}">\u2014</td>
          <td class="text-right">
            <button class="btn btn-secondary btn-xs edit-btn" data-id="${t.id}">Edit</button>
            <button class="btn btn-secondary btn-xs link-btn" data-id="${t.id}">Link Asset</button>
          </td>
        </tr>
      `;
    }).join('');

    filtered.forEach(t => loadTaskLink(t.id));

    tbody.querySelectorAll('.edit-btn').forEach(btn => {
      const task = allTasks.find(t => t.id === btn.dataset.id);
      btn.addEventListener('click', () => showTaskModal(task));
    });

    tbody.querySelectorAll('.link-btn').forEach(btn => {
      btn.addEventListener('click', () => showLinkModal(btn.dataset.id));
    });
  }

  async function loadTaskLink(taskId) {
    try {
      const link = await apiFetch(`/api/tasks/${taskId}/link`);
      const cell = document.getElementById(`link-cell-${taskId}`);
      if (cell && link && link.linkType === 'asset') {
        const asset = assets.find(a => a.id === link.targetId);
        cell.innerHTML = asset ? `<span class="badge badge-teal">${esc(asset.label || asset.featureRef || asset.id.substring(0,8))}</span>` : `<span class="text-sm text-muted">${link.targetId.substring(0,8)}...</span>`;
      }
    } catch {}
  }

  function showTaskModal(task = null) {
    const isEdit = !!task;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal modal-wide">
        <div class="modal-header">
          <h2>${isEdit ? 'Edit' : 'Create'} Task</h2>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>Title</label>
            <input type="text" class="form-input" id="task-title" value="${esc(task?.title || '')}" />
          </div>
          <div class="form-group">
            <label>Description</label>
            <textarea class="form-textarea" id="task-desc">${esc(task?.description || '')}</textarea>
          </div>
          <div class="flex gap-4">
            <div class="form-group" style="flex:1">
              <label>Ticket Type</label>
              <input type="text" class="form-input" id="task-type" value="${esc(task?.ticketType || '')}" placeholder="e.g. Maintenance - Seasonal" />
            </div>
            <div class="form-group" style="flex:1">
              <label>Priority</label>
              <select class="form-select" id="task-priority">
                <option value="low" ${task?.priority === 'low' ? 'selected' : ''}>Low</option>
                <option value="medium" ${(!task || task?.priority === 'medium') ? 'selected' : ''}>Medium</option>
                <option value="high" ${task?.priority === 'high' ? 'selected' : ''}>High</option>
                <option value="urgent" ${task?.priority === 'urgent' ? 'selected' : ''}>Urgent</option>
              </select>
            </div>
            <div class="form-group" style="flex:1">
              <label>Assign To</label>
              <select class="form-select" id="task-assign">
                <option value="">Unassigned</option>
                ${contractors.map(c => `<option value="${c.id}" ${task?.assignedTo === c.id ? 'selected' : ''}>${esc(c.displayName || c.username)}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="flex gap-4">
            <div class="form-group" style="flex:1">
              <label>Start Date</label>
              <input type="date" class="form-input" id="task-start" value="${task?.startDate ? task.startDate.substring(0, 10) : ''}" />
            </div>
            <div class="form-group" style="flex:1">
              <label>Due Date (End)</label>
              <input type="date" class="form-input" id="task-due" value="${task?.dueDate ? task.dueDate.substring(0, 10) : ''}" />
            </div>
          </div>
          <div class="flex gap-4">
            <div class="form-group" style="flex:1">
              <label>Window Start</label>
              <input type="date" class="form-input" id="task-window-start" value="${task?.windowStart || ''}" />
            </div>
            <div class="form-group" style="flex:1">
              <label>Window End</label>
              <input type="date" class="form-input" id="task-window-end" value="${task?.windowEnd || ''}" />
            </div>
          </div>
          <p class="text-sm text-muted" style="margin-top:-8px;margin-bottom:8px">Execution window restricts when contractors can complete this task.</p>
          <div class="form-group">
            <label>Address</label>
            <input type="text" class="form-input" id="task-address" value="${esc(task?.address || '')}" />
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary cancel-btn">Cancel</button>
          <button class="btn btn-primary save-btn">${isEdit ? 'Save Changes' : 'Create Task'}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
    overlay.querySelector('.cancel-btn').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('.save-btn').addEventListener('click', async () => {
      const title = document.getElementById('task-title').value.trim();
      const description = document.getElementById('task-desc').value.trim();
      const ticketType = document.getElementById('task-type').value.trim() || null;
      const priority = document.getElementById('task-priority').value;
      const assignedTo = document.getElementById('task-assign').value || null;
      const startDate = document.getElementById('task-start').value || null;
      const dueDate = document.getElementById('task-due').value || null;
      const address = document.getElementById('task-address').value.trim() || null;
      const windowStart = document.getElementById('task-window-start').value || null;
      const windowEnd = document.getElementById('task-window-end').value || null;

      if (!title) { showToast('Title is required', 'error'); return; }
      if ((windowStart && !windowEnd) || (!windowStart && windowEnd)) {
        showToast('Both window start and end are required', 'error');
        return;
      }

      const body = { title, description: description || null, ticketType, priority, assignedTo, startDate, dueDate, address, communityId, windowStart, windowEnd };

      try {
        if (isEdit) {
          body.version = task.version;
          await apiFetch(`/api/tasks/${task.id}`, { method: 'PUT', body });
          showToast('Task updated', 'success');
        } else {
          await apiFetch('/api/tasks', { method: 'POST', body });
          showToast('Task created', 'success');
        }
        overlay.remove();
        await loadTasks();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  function showImportCsvModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:900px;width:90vw">
        <div class="modal-header">
          <h2>Import Tasks from CSV</h2>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <div id="csv-upload-section">
            <p class="text-sm text-muted" style="margin-bottom:12px">
              Upload a CSV or tab-separated file with task data. Supported columns: Ticket Title, Ticket Type, Priority, Start Date, End Date, Frequency, Total Visits, Description.
              Priority mapping: Critical \u2192 Urgent, Core \u2192 High, Ongoing \u2192 Medium.
            </p>
            <div style="border:2px dashed var(--border);border-radius:8px;padding:32px;text-align:center;cursor:pointer;transition:border-color 0.2s" id="csv-dropzone">
              <div style="font-size:32px;margin-bottom:8px">\uD83D\uDCC4</div>
              <div>Drop CSV/TSV/TXT file here or click to browse</div>
              <input type="file" accept=".csv,.tsv,.txt" id="csv-file-input" style="display:none" />
            </div>
            <div id="csv-file-name" style="margin-top:8px;display:none" class="text-sm"></div>
          </div>
          <div id="csv-preview-section" style="display:none">
            <div id="csv-summary" style="margin-bottom:12px"></div>
            <div style="max-height:400px;overflow:auto">
              <table style="font-size:12px">
                <thead id="csv-preview-thead"></thead>
                <tbody id="csv-preview-tbody"></tbody>
              </table>
            </div>
          </div>
          <div id="csv-result-section" style="display:none">
            <div id="csv-result-content"></div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary cancel-btn">Cancel</button>
          <button class="btn btn-primary" id="csv-preview-btn" style="display:none">Preview</button>
          <button class="btn btn-primary" id="csv-commit-btn" style="display:none">Import Tasks</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    let selectedFile = null;
    let previewData = null;

    const dropzone = overlay.querySelector('#csv-dropzone');
    const fileInput = overlay.querySelector('#csv-file-input');
    const fileNameEl = overlay.querySelector('#csv-file-name');
    const previewBtn = overlay.querySelector('#csv-preview-btn');
    const commitBtn = overlay.querySelector('#csv-commit-btn');

    overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
    overlay.querySelector('.cancel-btn').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.style.borderColor = 'var(--teal)'; });
    dropzone.addEventListener('dragleave', () => { dropzone.style.borderColor = 'var(--border)'; });
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.style.borderColor = 'var(--border)';
      if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', () => {
      if (fileInput.files.length) handleFile(fileInput.files[0]);
    });

    function handleFile(file) {
      if (!file.name.endsWith('.csv') && !file.name.endsWith('.tsv') && !file.name.endsWith('.txt')) {
        showToast('Please select a CSV, TSV, or TXT file', 'error');
        return;
      }
      selectedFile = file;
      fileNameEl.textContent = `Selected: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
      fileNameEl.style.display = 'block';
      previewBtn.style.display = 'inline-flex';
      commitBtn.style.display = 'none';
    }

    previewBtn.addEventListener('click', async () => {
      if (!selectedFile) return;
      previewBtn.disabled = true;
      previewBtn.textContent = 'Parsing...';
      try {
        const formData = new FormData();
        formData.append('file', selectedFile);
        formData.append('communityId', communityId);
        formData.append('mode', 'preview');

        const resp = await fetch('/api/tasks/import-csv', {
          method: 'POST',
          body: formData,
          credentials: 'include',
        });
        if (!resp.ok) {
          const err = await resp.json();
          throw new Error(err.error || 'Preview failed');
        }
        previewData = await resp.json();
        showPreview(previewData);
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        previewBtn.disabled = false;
        previewBtn.textContent = 'Preview';
      }
    });

    commitBtn.addEventListener('click', async () => {
      if (!selectedFile) return;
      commitBtn.disabled = true;
      commitBtn.textContent = 'Importing...';
      try {
        const formData = new FormData();
        formData.append('file', selectedFile);
        formData.append('communityId', communityId);
        formData.append('mode', 'commit');

        const resp = await fetch('/api/tasks/import-csv', {
          method: 'POST',
          body: formData,
          credentials: 'include',
        });
        if (!resp.ok) {
          const err = await resp.json();
          throw new Error(err.error || 'Import failed');
        }
        const result = await resp.json();
        showResult(result);
        await loadTasks();
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        commitBtn.disabled = false;
        commitBtn.textContent = 'Import Tasks';
      }
    });

    function showPreview(data) {
      overlay.querySelector('#csv-upload-section').style.display = 'none';
      overlay.querySelector('#csv-preview-section').style.display = 'block';
      previewBtn.style.display = 'none';
      commitBtn.style.display = 'inline-flex';

      const summaryEl = overlay.querySelector('#csv-summary');
      summaryEl.innerHTML = `
        <div style="display:flex;gap:16px;align-items:center">
          <span class="badge badge-blue">${data.totalRows} rows</span>
          <span class="badge badge-green">${data.validCount} valid</span>
          ${data.invalidCount > 0 ? `<span class="badge badge-amber">${data.invalidCount} invalid</span>` : ''}
        </div>
      `;

      const thead = overlay.querySelector('#csv-preview-thead');
      thead.innerHTML = '<tr><th>#</th><th>Title</th><th>Type</th><th>Priority</th><th>Start</th><th>End</th><th>Freq</th><th>Status</th></tr>';

      const tbody = overlay.querySelector('#csv-preview-tbody');
      tbody.innerHTML = data.rows.map(r => {
        const rowClass = r.valid ? '' : 'style="background:rgba(239,68,68,0.1)"';
        const startStr = r.startDate ? new Date(r.startDate).toLocaleDateString() : '\u2014';
        const endStr = r.dueDate ? new Date(r.dueDate).toLocaleDateString() : '\u2014';
        return `
          <tr ${rowClass}>
            <td>${r.row}</td>
            <td>${esc(r.title)}</td>
            <td>${esc(r.ticketType || '\u2014')}</td>
            <td><span class="priority-${r.priority}">${r.priority}</span></td>
            <td>${startStr}</td>
            <td>${endStr}</td>
            <td>${esc(r.frequency || '\u2014')}</td>
            <td>${r.valid ? '<span class="badge badge-green">OK</span>' : `<span class="badge badge-amber" title="${esc(r.errors.join(', '))}">${esc(r.errors[0])}</span>`}</td>
          </tr>
        `;
      }).join('');
    }

    function showResult(data) {
      overlay.querySelector('#csv-preview-section').style.display = 'none';
      overlay.querySelector('#csv-result-section').style.display = 'block';
      commitBtn.style.display = 'none';

      const content = overlay.querySelector('#csv-result-content');
      content.innerHTML = `
        <div style="text-align:center;padding:24px">
          <div style="font-size:48px;margin-bottom:16px">\u2705</div>
          <h3 style="margin-bottom:8px">Import Complete</h3>
          <p><strong>${data.createdCount}</strong> tasks created${data.skippedCount > 0 ? `, <strong>${data.skippedCount}</strong> skipped` : ''}</p>
          ${data.skipped && data.skipped.length > 0 ? `
            <div style="margin-top:16px;text-align:left">
              <h4 style="font-size:13px;margin-bottom:4px">Skipped rows:</h4>
              <ul style="font-size:12px;color:var(--text-muted)">
                ${data.skipped.map(s => `<li>Row ${s.row}: ${esc(s.title || 'untitled')} \u2014 ${esc(s.reason)}</li>`).join('')}
              </ul>
            </div>
          ` : ''}
        </div>
      `;
    }
  }

  function showLinkModal(taskId) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h2>Link Task to Asset</h2>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>Select Asset</label>
            <select class="form-select" id="link-asset">
              <option value="">Choose an asset...</option>
              ${assets.filter(a => !a.isArchived).map(a => `<option value="${a.id}">${esc(a.label || a.featureRef || a.id.substring(0,8))} (${a.assetType})</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary cancel-btn">Cancel</button>
          <button class="btn btn-primary save-btn">Link</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
    overlay.querySelector('.cancel-btn').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('.save-btn').addEventListener('click', async () => {
      const assetId = document.getElementById('link-asset').value;
      if (!assetId) { showToast('Select an asset', 'error'); return; }
      try {
        await apiFetch(`/api/tasks/${taskId}/link`, {
          method: 'PUT',
          body: { linkType: 'asset', targetId: assetId },
        });
        showToast('Asset linked', 'success');
        overlay.remove();
        await loadTasks();
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
};
