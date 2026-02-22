AdminRouter.register('tasks', async function(container) {
  const { apiFetch, showToast } = AdminAPI;
  const communityId = AdminState.getActiveCommunityId();

  if (!communityId) {
    container.innerHTML = '<div class="empty-state"><p>Select a community from the top bar to manage tasks.</p></div>';
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <h1>Tasks</h1>
      <button class="btn btn-primary" id="add-task-btn">+ New Task</button>
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
          <th>Status</th>
          <th>Priority</th>
          <th>Assigned To</th>
          <th>Due Date</th>
          <th>Linked Asset</th>
          <th class="text-right">Actions</th>
        </tr></thead>
        <tbody id="tasks-tbody">
          <tr><td colspan="7" class="loading-spinner">Loading...</td></tr>
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

  function renderTasks() {
    const statusFilter = document.getElementById('task-status-filter').value;
    let filtered = allTasks;
    if (statusFilter) filtered = filtered.filter(t => t.status === statusFilter);

    const tbody = document.getElementById('tasks-tbody');
    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No tasks match filters</td></tr>';
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
          <td><span class="badge ${statusBadge}">${esc(t.status)}</span></td>
          <td><span class="${priorityClass}">${esc(t.priority || 'medium')}</span></td>
          <td class="text-sm">${esc(t.assignedToName || '—')}</td>
          <td class="text-sm">${t.dueDate ? new Date(t.dueDate).toLocaleDateString() : '—'}</td>
          <td class="text-sm" id="link-cell-${t.id}">—</td>
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
            <div class="form-group" style="flex:1">
              <label>Due Date</label>
              <input type="date" class="form-input" id="task-due" value="${task?.dueDate ? task.dueDate.substring(0, 10) : ''}" />
            </div>
          </div>
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
      const priority = document.getElementById('task-priority').value;
      const assignedTo = document.getElementById('task-assign').value || null;
      const dueDate = document.getElementById('task-due').value || null;
      const address = document.getElementById('task-address').value.trim() || null;

      if (!title) { showToast('Title is required', 'error'); return; }

      const body = { title, description: description || null, priority, assignedTo, dueDate, address, communityId };

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
});
