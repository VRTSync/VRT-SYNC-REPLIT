AdminRouter.register('asset-types', async function(container) {
  const { apiFetch, showToast } = AdminAPI;
  const esc = VRTUtils.esc;

  let allTypes = [];
  let editingKey = null; // null = create mode, string = edit mode

  function renderPage() {
    container.innerHTML = `
      <div class="page-header" style="margin-top:16px;display:flex;align-items:center;justify-content:space-between">
        <h2 style="font-size:16px;margin:0">Asset Types</h2>
        <button class="btn btn-primary btn-sm" id="add-type-btn">+ New Type</button>
      </div>
      <p style="color:#666;font-size:13px;margin:4px 0 16px">
        Data-driven catalogue of asset types. Adding a new type here — not in code — makes it available for KML import and map display immediately.
      </p>
      <div class="filters-bar" id="type-filters" style="margin-bottom:12px">
        <input class="form-input" id="search-input" placeholder="Search by key or label…" style="max-width:220px" />
        <select class="form-select" id="layer-filter">
          <option value="">All layers</option>
          <option value="community">Community</option>
          <option value="irrigation">Irrigation</option>
          <option value="snow">Snow</option>
          <option value="trees">Trees</option>
        </select>
        <select class="form-select" id="status-filter">
          <option value="active">Active only</option>
          <option value="all">All (incl. inactive)</option>
        </select>
      </div>
      <div class="table-container">
        <table>
          <thead><tr>
            <th>Key</th>
            <th>Label</th>
            <th>Layer</th>
            <th>Sub-Layer</th>
            <th>Required Fields</th>
            <th>Optional Fields</th>
            <th>Sort</th>
            <th>Status</th>
            <th>Actions</th>
          </tr></thead>
          <tbody id="types-tbody">
            <tr><td colspan="9" class="loading-spinner">Loading…</td></tr>
          </tbody>
        </table>
      </div>

      <!-- Create / Edit modal -->
      <div id="type-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9000;display:none;align-items:center;justify-content:center">
        <div style="background:#fff;border-radius:10px;width:540px;max-width:96vw;max-height:90vh;overflow-y:auto;padding:24px;box-shadow:0 8px 32px rgba(0,0,0,.18)">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
            <h3 style="margin:0;font-size:15px" id="modal-title">New Asset Type</h3>
            <button id="modal-close" class="btn btn-ghost btn-sm">✕</button>
          </div>
          <form id="type-form" autocomplete="off">
            <div style="display:grid;gap:12px">
              <div>
                <label class="form-label">Key <span style="color:#e53e3e">*</span></label>
                <input class="form-input" id="field-key" placeholder="e.g. parking_sweep" required pattern="[a-z][a-z0-9_]*" />
                <span style="font-size:11px;color:#666">Lowercase letters, digits, underscores. Immutable after creation.</span>
              </div>
              <div>
                <label class="form-label">Label <span style="color:#e53e3e">*</span></label>
                <input class="form-input" id="field-label" placeholder="e.g. Parking Sweep" required />
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                <div>
                  <label class="form-label">Layer Key <span style="color:#e53e3e">*</span></label>
                  <input class="form-input" id="field-layer-key" placeholder="e.g. snow" required />
                </div>
                <div>
                  <label class="form-label">Sub-Layer Key <span style="color:#e53e3e">*</span></label>
                  <input class="form-input" id="field-sub-layer-key" placeholder="e.g. parking_sweep" required />
                </div>
              </div>
              <div>
                <label class="form-label">Sort Order</label>
                <input class="form-input" id="field-sort-order" type="number" min="0" value="0" />
              </div>
              <div>
                <label class="form-label">Allowed Geometry (comma-separated)</label>
                <input class="form-input" id="field-geometry" placeholder="point, polygon, line" />
                <span style="font-size:11px;color:#666">e.g. point, polygon — leave blank to allow all</span>
              </div>
              <div>
                <label class="form-label">Required Field Keys (comma-separated)</label>
                <input class="form-input" id="field-required-keys" placeholder="brand, serialNumber, size" />
              </div>
              <div>
                <label class="form-label">Optional Field Keys (comma-separated)</label>
                <input class="form-input" id="field-optional-keys" placeholder="installDate, notes" />
              </div>
              <div style="display:flex;align-items:center;gap:8px">
                <input type="checkbox" id="field-active" checked />
                <label for="field-active" style="font-size:13px;cursor:pointer">Active (available for new imports)</label>
              </div>
              <div id="form-error" style="color:#e53e3e;font-size:13px;display:none"></div>
              <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px">
                <button type="button" class="btn btn-ghost btn-sm" id="modal-cancel">Cancel</button>
                <button type="submit" class="btn btn-primary btn-sm" id="modal-submit">Create</button>
              </div>
            </div>
          </form>
        </div>
      </div>
    `;

    document.getElementById('add-type-btn').addEventListener('click', () => openModal(null));
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('search-input').addEventListener('input', renderTable);
    document.getElementById('layer-filter').addEventListener('change', renderTable);
    document.getElementById('status-filter').addEventListener('change', renderTable);

    document.getElementById('type-form').addEventListener('submit', handleSubmit);

    // Close modal on backdrop click
    document.getElementById('type-modal').addEventListener('click', (e) => {
      if (e.target === document.getElementById('type-modal')) closeModal();
    });

    loadTypes();
  }

  async function loadTypes() {
    try {
      // ?all=true is honoured only for admins — returns active + inactive rows
      allTypes = await apiFetch('/api/asset-types?all=true');
      renderTable();
    } catch (err) {
      document.getElementById('types-tbody').innerHTML =
        `<tr><td colspan="10" style="color:#e53e3e;padding:16px">Failed to load: ${esc(err.message)}</td></tr>`;
    }
  }

  function renderTable() {
    const search = (document.getElementById('search-input')?.value || '').toLowerCase();
    const layer = document.getElementById('layer-filter')?.value || '';
    const status = document.getElementById('status-filter')?.value || 'active';

    let filtered = allTypes.filter(t => {
      if (status === 'active' && !t.isActive) return false;
      if (layer && t.layerKey !== layer) return false;
      if (search && !t.key.toLowerCase().includes(search) && !t.label.toLowerCase().includes(search)) return false;
      return true;
    });

    const tbody = document.getElementById('types-tbody');
    if (!filtered.length) {
      tbody.innerHTML = `<tr><td colspan="10" style="padding:24px;text-align:center;color:#666">No asset types match the current filter.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(t => `
      <tr style="${!t.isActive ? 'opacity:.5' : ''}">
        <td><code style="font-size:12px">${esc(t.key)}</code></td>
        <td>${esc(t.label)}</td>
        <td><span class="badge badge-teal">${esc(t.layerKey)}</span></td>
        <td><code style="font-size:12px">${esc(t.subLayerKey)}</code></td>
        <td style="font-size:12px">${(t.requiredKeys || []).length ? esc((t.requiredKeys || []).join(', ')) : '<span style="color:#aaa">—</span>'}</td>
        <td style="font-size:12px">${(t.optionalKeys || []).length ? esc((t.optionalKeys || []).join(', ')) : '<span style="color:#aaa">—</span>'}</td>
        <td style="text-align:center">${t.sortOrder}</td>
        <td>
          ${t.isActive
            ? '<span class="badge badge-green">Active</span>'
            : '<span class="badge" style="background:#f5f5f5;color:#666">Inactive</span>'}
        </td>
        <td style="white-space:nowrap">
          <button class="btn btn-ghost btn-sm" onclick="window._editAssetType('${esc(t.key)}')">Edit</button>
          ${t.isActive
            ? `<button class="btn btn-ghost btn-sm" style="color:#e53e3e" onclick="window._deactivateAssetType('${esc(t.key)}')">Deactivate</button>`
            : `<button class="btn btn-ghost btn-sm" onclick="window._reactivateAssetType('${esc(t.key)}')">Reactivate</button>`}
        </td>
      </tr>
    `).join('');
  }

  function openModal(key) {
    editingKey = key;
    const modal = document.getElementById('type-modal');
    const form = document.getElementById('type-form');
    const errorEl = document.getElementById('form-error');
    errorEl.style.display = 'none';
    form.reset();

    if (key) {
      // Edit mode — populate form
      const t = allTypes.find(x => x.key === key);
      if (!t) return;
      document.getElementById('modal-title').textContent = `Edit: ${t.key}`;
      document.getElementById('modal-submit').textContent = 'Save Changes';
      document.getElementById('field-key').value = t.key;
      document.getElementById('field-key').readOnly = true;
      document.getElementById('field-key').style.opacity = '.6';
      document.getElementById('field-label').value = t.label;
      document.getElementById('field-layer-key').value = t.layerKey;
      document.getElementById('field-sub-layer-key').value = t.subLayerKey;
      document.getElementById('field-sort-order').value = t.sortOrder ?? 0;
      document.getElementById('field-geometry').value = (t.allowedGeometry || []).join(', ');
      document.getElementById('field-required-keys').value = (t.requiredKeys || []).join(', ');
      document.getElementById('field-optional-keys').value = (t.optionalKeys || []).join(', ');
      document.getElementById('field-active').checked = t.isActive;
    } else {
      // Create mode
      document.getElementById('modal-title').textContent = 'New Asset Type';
      document.getElementById('modal-submit').textContent = 'Create';
      document.getElementById('field-key').readOnly = false;
      document.getElementById('field-key').style.opacity = '1';
    }

    modal.style.display = 'flex';
  }

  function closeModal() {
    document.getElementById('type-modal').style.display = 'none';
    editingKey = null;
  }

  function parseKeyList(raw) {
    return raw.split(',').map(s => s.trim()).filter(Boolean);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const errorEl = document.getElementById('form-error');
    errorEl.style.display = 'none';

    const key = document.getElementById('field-key').value.trim();
    const label = document.getElementById('field-label').value.trim();
    const layerKey = document.getElementById('field-layer-key').value.trim();
    const subLayerKey = document.getElementById('field-sub-layer-key').value.trim();
    const sortOrder = parseInt(document.getElementById('field-sort-order').value, 10) || 0;
    const allowedGeometry = parseKeyList(document.getElementById('field-geometry').value);
    const requiredKeys = parseKeyList(document.getElementById('field-required-keys').value);
    const optionalKeys = parseKeyList(document.getElementById('field-optional-keys').value);
    const isActive = document.getElementById('field-active').checked;

    const body = { key, label, layerKey, subLayerKey, sortOrder,
      allowedGeometry: allowedGeometry.length ? allowedGeometry : null,
      requiredKeys, optionalKeys, isActive };

    try {
      const submitBtn = document.getElementById('modal-submit');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving…';

      let result;
      if (editingKey) {
        result = await apiFetch(`/api/asset-types/${encodeURIComponent(editingKey)}`, { method: 'PATCH', body });
        allTypes = allTypes.map(t => t.key === editingKey ? { ...t, ...result } : t);
        showToast('Asset type updated');
      } else {
        result = await apiFetch('/api/asset-types', { method: 'POST', body });
        allTypes = [...allTypes, result];
        showToast('Asset type created');
      }

      closeModal();
      renderTable();
    } catch (err) {
      errorEl.textContent = err.message || 'Save failed';
      errorEl.style.display = 'block';
      const submitBtn = document.getElementById('modal-submit');
      submitBtn.disabled = false;
      submitBtn.textContent = editingKey ? 'Save Changes' : 'Create';
    }
  }

  window._editAssetType = function(key) { openModal(key); };

  window._deactivateAssetType = async function(key) {
    if (!confirm(`Deactivate "${key}"? Existing assets are unaffected — this only prevents new imports.`)) return;
    try {
      await apiFetch(`/api/asset-types/${encodeURIComponent(key)}`, { method: 'DELETE' });
      allTypes = allTypes.map(t => t.key === key ? { ...t, isActive: false } : t);
      renderTable();
      showToast(`${key} deactivated`);
    } catch (err) {
      showToast(err.message || 'Failed to deactivate', 'error');
    }
  };

  window._reactivateAssetType = async function(key) {
    try {
      const result = await apiFetch(`/api/asset-types/${encodeURIComponent(key)}`, {
        method: 'PATCH', body: { isActive: true },
      });
      allTypes = allTypes.map(t => t.key === key ? { ...t, ...result } : t);
      renderTable();
      showToast(`${key} reactivated`);
    } catch (err) {
      showToast(err.message || 'Failed to reactivate', 'error');
    }
  };

  renderPage();
});
