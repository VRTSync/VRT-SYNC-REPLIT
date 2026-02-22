window._renderAssets = async function(container, communityId) {
  const { apiFetch, showToast } = AdminAPI;

  let allAssets = [];
  let selectedIds = new Set();
  let templates = {};

  container.innerHTML = `
    <div class="page-header" style="margin-top:16px">
      <h2 style="font-size:16px">Assets</h2>
    </div>
    <div class="filters-bar" id="asset-filters">
      <select class="form-select" id="filter-type">
        <option value="">All types</option>
      </select>
      <select class="form-select" id="filter-status">
        <option value="active">Active</option>
        <option value="archived">Archived</option>
        <option value="all">All</option>
      </select>
      <select class="form-select" id="filter-incomplete">
        <option value="">All completeness</option>
        <option value="incomplete">Incomplete only</option>
      </select>
      <select class="form-select" id="filter-missing-key">
        <option value="">Any missing key</option>
      </select>
    </div>
    <div id="bulk-panel-area"></div>
    <div class="table-container">
      <table>
        <thead><tr>
          <th class="checkbox-cell"><input type="checkbox" id="select-all" /></th>
          <th>Label</th>
          <th>Type</th>
          <th>Feature Ref</th>
          <th>Layer</th>
          <th>Status</th>
          <th>Missing Fields</th>
        </tr></thead>
        <tbody id="assets-tbody">
          <tr><td colspan="7" class="loading-spinner">Loading...</td></tr>
        </tbody>
      </table>
    </div>
  `;

  try {
    templates = await apiFetch('/api/asset-type-templates');
  } catch {}

  const typeOptions = Object.keys(templates);
  const typeSelect = document.getElementById('filter-type');
  typeOptions.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t.replace(/_/g, ' ');
    typeSelect.appendChild(opt);
  });

  document.getElementById('filter-type').addEventListener('change', () => { updateMissingKeyOptions(); loadAssets(); });
  document.getElementById('filter-status').addEventListener('change', loadAssets);
  document.getElementById('filter-incomplete').addEventListener('change', loadAssets);
  document.getElementById('filter-missing-key').addEventListener('change', loadAssets);

  document.getElementById('select-all').addEventListener('change', (e) => {
    if (e.target.checked) {
      allAssets.forEach(a => selectedIds.add(a.id));
    } else {
      selectedIds.clear();
    }
    renderTable();
    renderBulkPanel();
  });

  await loadAssets();

  function getRequiredKeys(type) {
    const tmpl = templates[type];
    if (!tmpl) return [];
    return tmpl.requiredKeys || [];
  }

  function updateMissingKeyOptions() {
    const type = document.getElementById('filter-type').value;
    const sel = document.getElementById('filter-missing-key');
    sel.innerHTML = '<option value="">Any missing key</option>';
    const keys = getRequiredKeys(type);
    keys.forEach(k => {
      const opt = document.createElement('option');
      opt.value = k;
      opt.textContent = k;
      sel.appendChild(opt);
    });
  }

  async function loadAssets() {
    selectedIds.clear();
    const filterType = document.getElementById('filter-type').value;
    const filterStatus = document.getElementById('filter-status').value;
    const filterIncomplete = document.getElementById('filter-incomplete').value;
    const filterMissing = document.getElementById('filter-missing-key').value;

    try {
      if (filterIncomplete === 'incomplete') {
        let url = `/api/communities/${communityId}/assets/incomplete?`;
        if (filterType) url += `assetType=${filterType}&`;
        if (filterMissing) url += `missingKey=${filterMissing}&`;
        const data = await apiFetch(url);
        allAssets = data.map(item => ({
          ...item.asset,
          properties: item.asset.properties || [],
          missingKeys: item.missingKeys || [],
        }));
      } else {
        let url = `/api/communities/${communityId}/assets?`;
        if (filterType) url += `type=${filterType}&`;
        if (filterStatus === 'all') url += `includeArchived=true&`;
        else if (filterStatus === 'archived') url += `includeArchived=true&`;
        const data = await apiFetch(url);
        let filtered = data;
        if (filterStatus === 'archived') {
          filtered = data.filter(a => a.isArchived);
        }
        allAssets = filtered.map(a => ({
          ...a,
          missingKeys: getMissingKeys(a),
        }));
      }
      renderTable();
      renderBulkPanel();
    } catch (err) {
      showToast('Failed to load assets: ' + err.message, 'error');
    }
  }

  function getMissingKeys(asset) {
    const required = getRequiredKeys(asset.assetType);
    const propKeys = (asset.properties || []).map(p => p.key);
    return required.filter(k => !propKeys.includes(k));
  }

  function renderTable() {
    const tbody = document.getElementById('assets-tbody');
    if (allAssets.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No assets match filters</td></tr>';
      return;
    }
    tbody.innerHTML = allAssets.map(a => `
      <tr class="${a.isArchived ? 'row-archived' : ''}">
        <td class="checkbox-cell">
          <input type="checkbox" class="asset-cb" data-id="${a.id}" ${selectedIds.has(a.id) ? 'checked' : ''} />
        </td>
        <td><strong>${esc(a.label || '—')}</strong></td>
        <td><span class="badge badge-teal">${esc(a.assetType)}</span></td>
        <td class="font-mono text-sm">${esc(a.featureRef || '—')}</td>
        <td class="text-sm">${esc(a.mapLayerId ? a.mapLayerId.substring(0, 8) + '...' : '—')}</td>
        <td>${a.isArchived ? '<span class="badge badge-gray">Archived</span>' : '<span class="badge badge-green">Active</span>'}</td>
        <td>${a.missingKeys && a.missingKeys.length > 0 ? a.missingKeys.map(k => `<span class="badge badge-amber">${esc(k)}</span>`).join(' ') : '<span class="text-muted">—</span>'}</td>
      </tr>
    `).join('');

    tbody.querySelectorAll('.asset-cb').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) selectedIds.add(cb.dataset.id);
        else selectedIds.delete(cb.dataset.id);
        renderBulkPanel();
      });
    });
  }

  function renderBulkPanel() {
    const area = document.getElementById('bulk-panel-area');
    if (selectedIds.size === 0) {
      area.innerHTML = '';
      return;
    }
    area.innerHTML = `
      <div class="bulk-panel">
        <span class="bulk-count">${selectedIds.size} selected</span>
        <select class="form-select" id="bulk-key" style="min-width:140px">
          <option value="">Select property...</option>
        </select>
        <input type="text" class="form-input" id="bulk-value" placeholder="Value" style="max-width:200px" />
        <select class="form-select" id="bulk-mode" style="min-width:140px">
          <option value="set_if_missing">Set if missing</option>
          <option value="overwrite">Overwrite</option>
        </select>
        <button class="btn btn-primary btn-sm" id="bulk-apply">Apply</button>
        <button class="btn btn-ghost btn-sm" id="bulk-clear" style="color:white">Clear</button>
      </div>
    `;

    const keySelect = document.getElementById('bulk-key');
    const firstAsset = allAssets.find(a => selectedIds.has(a.id));
    const type = firstAsset?.assetType;
    const keys = getRequiredKeys(type);
    keys.forEach(k => {
      const opt = document.createElement('option');
      opt.value = k;
      opt.textContent = k;
      keySelect.appendChild(opt);
    });

    document.getElementById('bulk-clear').addEventListener('click', () => {
      selectedIds.clear();
      renderTable();
      renderBulkPanel();
    });

    document.getElementById('bulk-apply').addEventListener('click', async () => {
      const key = document.getElementById('bulk-key').value;
      const value = document.getElementById('bulk-value').value.trim();
      const mode = document.getElementById('bulk-mode').value;
      if (!key || !value) { showToast('Select a property and enter a value', 'error'); return; }

      try {
        await apiFetch('/api/assets/bulk/properties', {
          method: 'POST',
          body: { assetIds: [...selectedIds], key, value, mode },
        });
        showToast(`Updated ${selectedIds.size} assets`, 'success');
        selectedIds.clear();
        await loadAssets();
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
