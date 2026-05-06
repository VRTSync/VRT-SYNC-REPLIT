AdminRouter.register('templates', async function(container) {
  const { apiFetch, showToast } = AdminAPI;

  container.innerHTML = `
    <div class="page-header" style="margin-top:16px">
      <h2 style="font-size:16px">Task Templates</h2>
      <button class="btn btn-primary btn-sm" id="add-template-btn">+ New Template</button>
    </div>
    <div class="table-container">
      <table>
        <thead><tr>
          <th>Name</th>
          <th>Title</th>
          <th>Priority</th>
          <th>Target Type</th>
          <th>Target Detail</th>
          <th>Due Offset</th>
          <th class="text-right">Actions</th>
        </tr></thead>
        <tbody id="templates-tbody">
          <tr><td colspan="7" class="loading-spinner">Loading...</td></tr>
        </tbody>
      </table>
    </div>
  `;

  let templates = [];
  let communities = [];
  let contractors = [];

  try {
    [communities, contractors] = await Promise.all([
      apiFetch('/api/communities'),
      apiFetch('/api/contractors'),
    ]);
  } catch {}

  document.getElementById('add-template-btn').addEventListener('click', () => showTemplateModal());
  await loadTemplates();

  async function loadTemplates() {
    try {
      templates = await apiFetch('/api/task-templates');
      renderTemplates();
    } catch (err) {
      showToast('Failed to load templates', 'error');
    }
  }

  function renderTemplates() {
    const tbody = document.getElementById('templates-tbody');
    if (templates.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No templates yet</td></tr>';
      return;
    }
    tbody.innerHTML = templates.map(t => {
      const priorityClass = `priority-${t.priority || 'medium'}`;
      let targetDetail = '';
      if (t.targetType === 'asset_type') targetDetail = t.targetAssetType || '';
      else if (t.targetType === 'map_layer') targetDetail = t.targetMapLayerId ? '(layer)' : '';
      else if (t.targetType === 'specific_asset') targetDetail = t.targetAssetId ? '(asset)' : '';
      return `
        <tr>
          <td><strong>${esc(t.name)}</strong></td>
          <td>${esc(t.title)}</td>
          <td><span class="${priorityClass}">${esc(t.priority)}</span></td>
          <td>${esc(t.targetType)}</td>
          <td>${esc(targetDetail)}</td>
          <td>${t.dueDaysOffset != null ? t.dueDaysOffset + ' days' : '—'}</td>
          <td class="text-right">
            <button class="btn btn-sm btn-ghost edit-tmpl-btn" data-id="${t.id}">Edit</button>
            <button class="btn btn-sm btn-primary generate-btn" data-id="${t.id}">Generate</button>
            <button class="btn btn-sm btn-danger delete-tmpl-btn" data-id="${t.id}">Delete</button>
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('.edit-tmpl-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = templates.find(x => x.id === btn.dataset.id);
        if (t) showTemplateModal(t);
      });
    });

    tbody.querySelectorAll('.generate-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = templates.find(x => x.id === btn.dataset.id);
        if (t) showGenerateModal(t);
      });
    });

    tbody.querySelectorAll('.delete-tmpl-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this template?')) return;
        try {
          await apiFetch(`/api/task-templates/${btn.dataset.id}`, { method: 'DELETE' });
          showToast('Template deleted', 'success');
          await loadTemplates();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  }

  function showTemplateModal(existing) {
    const isEdit = !!existing;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.innerHTML = `
      <div class="modal" style="max-width:540px">
        <div class="modal-header">
          <h3>${isEdit ? 'Edit' : 'Create'} Template</h3>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">Template Name *</label>
            <input class="form-input" id="tmpl-name" value="${esc(existing?.name || '')}" placeholder="e.g. Spring Backflow Inspection">
          </div>
          <div class="form-group">
            <label class="form-label">Task Title *</label>
            <input class="form-input" id="tmpl-title" value="${esc(existing?.title || '')}" placeholder="Title for generated tasks">
          </div>
          <div class="form-group">
            <label class="form-label">Description</label>
            <textarea class="form-input" id="tmpl-desc" rows="2" placeholder="Optional description">${esc(existing?.description || '')}</textarea>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="form-group">
              <label class="form-label">Priority</label>
              <select class="form-select" id="tmpl-priority">
                <option value="low" ${existing?.priority === 'low' ? 'selected' : ''}>Low</option>
                <option value="medium" ${(!existing || existing?.priority === 'medium') ? 'selected' : ''}>Medium</option>
                <option value="high" ${existing?.priority === 'high' ? 'selected' : ''}>High</option>
                <option value="urgent" ${existing?.priority === 'urgent' ? 'selected' : ''}>Urgent</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Due Days Offset</label>
              <input class="form-input" id="tmpl-due-offset" type="number" value="${existing?.dueDaysOffset ?? ''}" placeholder="e.g. 7">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Target Type</label>
            <select class="form-select" id="tmpl-target-type">
              <option value="none" ${(!existing || existing?.targetType === 'none') ? 'selected' : ''}>None (single task)</option>
              <option value="asset_type" ${existing?.targetType === 'asset_type' ? 'selected' : ''}>By Asset Type</option>
              <option value="map_layer" ${existing?.targetType === 'map_layer' ? 'selected' : ''}>By Map Layer</option>
              <option value="specific_asset" ${existing?.targetType === 'specific_asset' ? 'selected' : ''}>Specific Asset</option>
            </select>
          </div>
          <div class="form-group" id="tmpl-target-detail-group" style="display:none">
            <label class="form-label" id="tmpl-target-detail-label">Asset Type</label>
            <select class="form-select" id="tmpl-target-asset-type" style="display:none">
              <option value="">Select asset type...</option>
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
            <input class="form-input" id="tmpl-target-layer-id" style="display:none" placeholder="Map Layer ID">
            <input class="form-input" id="tmpl-target-asset-id" style="display:none" placeholder="Asset ID">
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="form-group">
              <label class="form-label" style="display:flex;align-items:center;gap:6px">
                <input type="checkbox" id="tmpl-sign-off" ${(!existing || existing?.requireSignOffName) ? 'checked' : ''}>
                Require Sign-off Name
              </label>
            </div>
            <div class="form-group">
              <label class="form-label" style="display:flex;align-items:center;gap:6px">
                <input type="checkbox" id="tmpl-photos" ${(!existing || existing?.allowPhotos) ? 'checked' : ''}>
                Allow Photos
              </label>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" id="tmpl-cancel-btn">Cancel</button>
          <button class="btn btn-primary" id="tmpl-save-btn">${isEdit ? 'Update' : 'Create'}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const targetTypeSelect = overlay.querySelector('#tmpl-target-type');
    const detailGroup = overlay.querySelector('#tmpl-target-detail-group');
    const detailLabel = overlay.querySelector('#tmpl-target-detail-label');
    const assetTypeSelect = overlay.querySelector('#tmpl-target-asset-type');
    const layerInput = overlay.querySelector('#tmpl-target-layer-id');
    const assetInput = overlay.querySelector('#tmpl-target-asset-id');

    function updateTargetUI() {
      const tt = targetTypeSelect.value;
      assetTypeSelect.style.display = 'none';
      layerInput.style.display = 'none';
      assetInput.style.display = 'none';
      if (tt === 'none') {
        detailGroup.style.display = 'none';
      } else {
        detailGroup.style.display = 'block';
        if (tt === 'asset_type') {
          detailLabel.textContent = 'Asset Type';
          assetTypeSelect.style.display = 'block';
        } else if (tt === 'map_layer') {
          detailLabel.textContent = 'Map Layer ID';
          layerInput.style.display = 'block';
        } else if (tt === 'specific_asset') {
          detailLabel.textContent = 'Asset ID';
          assetInput.style.display = 'block';
        }
      }
    }

    targetTypeSelect.addEventListener('change', updateTargetUI);

    if (existing) {
      if (existing.targetAssetType) assetTypeSelect.value = existing.targetAssetType;
      if (existing.targetMapLayerId) layerInput.value = existing.targetMapLayerId;
      if (existing.targetAssetId) assetInput.value = existing.targetAssetId;
    }
    updateTargetUI();

    function close() { overlay.remove(); }
    overlay.querySelector('.modal-close').addEventListener('click', close);
    overlay.querySelector('#tmpl-cancel-btn').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    overlay.querySelector('#tmpl-save-btn').addEventListener('click', async () => {
      const name = overlay.querySelector('#tmpl-name').value.trim();
      const title = overlay.querySelector('#tmpl-title').value.trim();
      if (!name || !title) { showToast('Name and title are required', 'error'); return; }

      const tt = targetTypeSelect.value;
      const dueOffset = overlay.querySelector('#tmpl-due-offset').value;

      const body = {
        name,
        title,
        description: overlay.querySelector('#tmpl-desc').value.trim() || undefined,
        priority: overlay.querySelector('#tmpl-priority').value,
        targetType: tt,
        dueDaysOffset: dueOffset !== '' ? parseInt(dueOffset) : null,
        targetAssetType: tt === 'asset_type' ? assetTypeSelect.value || null : null,
        targetMapLayerId: tt === 'map_layer' ? layerInput.value.trim() || null : null,
        targetAssetId: tt === 'specific_asset' ? assetInput.value.trim() || null : null,
        requireSignOffName: overlay.querySelector('#tmpl-sign-off').checked,
        allowPhotos: overlay.querySelector('#tmpl-photos').checked,
      };

      try {
        if (isEdit) {
          await apiFetch(`/api/task-templates/${existing.id}`, { method: 'PATCH', body });
          showToast('Template updated', 'success');
        } else {
          await apiFetch('/api/task-templates', { method: 'POST', body });
          showToast('Template created', 'success');
        }
        close();
        await loadTemplates();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  function showGenerateModal(template) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.innerHTML = `
      <div class="modal" style="max-width:540px">
        <div class="modal-header">
          <h3>Generate Tasks from "${esc(template.name)}"</h3>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <p class="text-sm text-muted" style="margin-bottom:12px">
            Target: <strong>${esc(template.targetType)}</strong>
            ${template.targetAssetType ? ' — ' + esc(template.targetAssetType) : ''}
          </p>
          <div class="form-group">
            <label class="form-label">Community *</label>
            <select class="form-select" id="gen-community">
              <option value="">Select community...</option>
              ${communities.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Assign To (optional)</label>
            <select class="form-select" id="gen-assign">
              <option value="">Unassigned</option>
              ${contractors.map(u => `<option value="${u.id}">${esc(u.displayName || u.username)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Due Date (optional)</label>
            <input class="form-input" id="gen-due-date" type="date">
          </div>
          <div class="form-group">
            <label class="form-label">Limit (optional)</label>
            <input class="form-input" id="gen-limit" type="number" placeholder="Max assets to target">
          </div>
          <div id="gen-preview" style="margin-top:12px;padding:12px;background:var(--bg-light);border-radius:8px;display:none">
            <p class="text-sm"><strong>Preview:</strong> <span id="gen-preview-count">0</span> tasks will be created</p>
            <div id="gen-preview-assets" class="text-sm text-muted" style="margin-top:4px"></div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" id="gen-cancel-btn">Cancel</button>
          <button class="btn btn-ghost" id="gen-preview-btn">Preview</button>
          <button class="btn btn-primary" id="gen-submit-btn">Generate Tasks</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    function close() { overlay.remove(); }
    overlay.querySelector('.modal-close').addEventListener('click', close);
    overlay.querySelector('#gen-cancel-btn').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    overlay.querySelector('#gen-preview-btn').addEventListener('click', async () => {
      const communityId = overlay.querySelector('#gen-community').value;
      if (!communityId) { showToast('Select a community', 'error'); return; }
      const limitVal = overlay.querySelector('#gen-limit').value;
      try {
        const result = await apiFetch(`/api/task-templates/${template.id}/preview`, {
          method: 'POST',
          body: {
            communityId,
            limit: limitVal ? parseInt(limitVal) : undefined,
          },
        });
        const previewDiv = overlay.querySelector('#gen-preview');
        previewDiv.style.display = 'block';
        overlay.querySelector('#gen-preview-count').textContent = result.taskCount;
        if (result.assets && result.assets.length > 0) {
          overlay.querySelector('#gen-preview-assets').innerHTML =
            'Sample: ' + result.assets.map(a => esc(a.label || a.assetType)).join(', ');
        }
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    overlay.querySelector('#gen-submit-btn').addEventListener('click', async () => {
      const communityId = overlay.querySelector('#gen-community').value;
      if (!communityId) { showToast('Select a community', 'error'); return; }
      const assignTo = overlay.querySelector('#gen-assign').value;
      const dueDate = overlay.querySelector('#gen-due-date').value;
      const limitVal = overlay.querySelector('#gen-limit').value;

      try {
        const result = await apiFetch(`/api/task-templates/${template.id}/generate`, {
          method: 'POST',
          body: {
            communityId,
            assignToUserId: assignTo || undefined,
            dueDate: dueDate || undefined,
            limit: limitVal ? parseInt(limitVal) : undefined,
          },
        });
        showToast(`Created ${result.createdCount} tasks`, 'success');
        close();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  function esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
  }
});
