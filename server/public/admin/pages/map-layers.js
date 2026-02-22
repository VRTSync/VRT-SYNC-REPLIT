AdminRouter.register('map-layers', async function(container) {
  const { apiFetch, showToast } = AdminAPI;
  const communityId = AdminState.getActiveCommunityId();

  if (!communityId) {
    container.innerHTML = '<div class="empty-state"><p>Select a community from the top bar to manage map layers.</p></div>';
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <h1>Map Layers</h1>
      <button class="btn btn-primary" id="add-layer-btn">+ New Layer</button>
    </div>
    <div class="table-container">
      <table>
        <thead><tr>
          <th>Name</th>
          <th>Layer Key</th>
          <th>Sub Layer</th>
          <th>Features</th>
          <th>Active Assets</th>
          <th>Archived</th>
          <th class="text-right">Actions</th>
        </tr></thead>
        <tbody id="layers-tbody">
          <tr><td colspan="7" class="loading-spinner">Loading...</td></tr>
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('add-layer-btn').addEventListener('click', () => showLayerModal());
  await loadLayers();

  async function loadLayers() {
    try {
      const layers = await apiFetch(`/api/map-layers?communityId=${communityId}`);
      let stats = {};
      try {
        const summary = await apiFetch(`/api/admin/summary?communityId=${communityId}`);
        if (summary.layerStats) {
          summary.layerStats.forEach(s => { stats[s.layerId] = s; });
        }
      } catch {}

      const tbody = document.getElementById('layers-tbody');
      if (layers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No map layers yet</td></tr>';
        return;
      }
      tbody.innerHTML = layers.map(l => {
        const st = stats[l.id] || {};
        const featureCount = countFeatures(l);
        return `
          <tr>
            <td><strong>${esc(l.displayName)}</strong></td>
            <td><span class="badge badge-blue">${esc(l.layerKey || '—')}</span></td>
            <td>${esc(l.subLayerKey || '—')}</td>
            <td>${featureCount}</td>
            <td>${st.activeAssets ?? '—'}</td>
            <td>${st.archivedAssets ?? '—'}</td>
            <td class="text-right">
              <button class="btn btn-primary btn-xs sync-btn" data-id="${l.id}">Sync Assets</button>
              <button class="btn btn-secondary btn-xs edit-btn" data-id="${l.id}">Edit</button>
              <button class="btn btn-danger btn-xs delete-btn" data-id="${l.id}" data-name="${esc(l.displayName)}">Delete</button>
            </td>
          </tr>
        `;
      }).join('');

      tbody.querySelectorAll('.sync-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          btn.textContent = 'Syncing...';
          try {
            const result = await apiFetch(`/api/map-layers/${btn.dataset.id}/sync-assets`, { method: 'POST' });
            showToast(`Sync complete: ${result.created || 0} created, ${result.updated || 0} updated, ${result.archived || 0} archived`, 'success');
            await loadLayers();
          } catch (err) {
            showToast('Sync failed: ' + err.message, 'error');
            btn.disabled = false;
            btn.textContent = 'Sync Assets';
          }
        });
      });

      tbody.querySelectorAll('.edit-btn').forEach(btn => {
        const layer = layers.find(l => l.id === btn.dataset.id);
        btn.addEventListener('click', () => showLayerModal(layer));
      });

      tbody.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm(`Delete layer "${btn.dataset.name}"? This cannot be undone.`)) return;
          try {
            await apiFetch(`/api/map-layers/${btn.dataset.id}`, { method: 'DELETE' });
            showToast('Layer deleted', 'success');
            await loadLayers();
          } catch (err) {
            showToast('Delete failed: ' + err.message, 'error');
          }
        });
      });
    } catch (err) {
      showToast('Failed to load layers', 'error');
    }
  }

  function countFeatures(layer) {
    try {
      if (layer.geojsonData) {
        const geo = typeof layer.geojsonData === 'string' ? JSON.parse(layer.geojsonData) : layer.geojsonData;
        if (geo.features) return geo.features.length;
      }
    } catch {}
    return '—';
  }

  function showLayerModal(layer = null) {
    const isEdit = !!layer;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal modal-wide">
        <div class="modal-header">
          <h2>${isEdit ? 'Edit' : 'Create'} Map Layer</h2>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <div class="flex gap-4">
            <div class="form-group" style="flex:1">
              <label>Display Name</label>
              <input type="text" class="form-input" id="ml-name" value="${esc(layer?.displayName || '')}" />
            </div>
            <div class="form-group" style="flex:1">
              <label>Layer Key</label>
              <input type="text" class="form-input" id="ml-layerKey" value="${esc(layer?.layerKey || '')}" placeholder="e.g. irrigation" />
            </div>
            <div class="form-group" style="flex:1">
              <label>Sub Layer Key</label>
              <input type="text" class="form-input" id="ml-subLayerKey" value="${esc(layer?.subLayerKey || '')}" placeholder="e.g. backflow" />
            </div>
          </div>
          <div class="form-group">
            <label>GeoJSON Data</label>
            <div class="flex gap-2 mb-2">
              <input type="file" id="ml-file" accept=".json,.geojson" style="font-size:13px" />
            </div>
            <textarea class="form-textarea geojson-input" id="ml-geojson" placeholder='Paste GeoJSON here or upload a file...'>${isEdit && layer?.geojsonData ? (typeof layer.geojsonData === 'string' ? layer.geojsonData : JSON.stringify(layer.geojsonData, null, 2)) : ''}</textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary cancel-btn">Cancel</button>
          <button class="btn btn-primary save-btn">${isEdit ? 'Update Layer' : 'Create Layer'}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const fileInput = overlay.querySelector('#ml-file');
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          document.getElementById('ml-geojson').value = ev.target.result;
        };
        reader.readAsText(file);
      }
    });

    overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
    overlay.querySelector('.cancel-btn').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('.save-btn').addEventListener('click', async () => {
      const displayName = document.getElementById('ml-name').value.trim();
      const layerKey = document.getElementById('ml-layerKey').value.trim();
      const subLayerKey = document.getElementById('ml-subLayerKey').value.trim();
      const geojsonRaw = document.getElementById('ml-geojson').value.trim();

      if (!displayName) { showToast('Name is required', 'error'); return; }
      if (!layerKey) { showToast('Layer Key is required', 'error'); return; }
      if (!subLayerKey) { showToast('Sub Layer Key is required', 'error'); return; }

      let geojsonData = undefined;
      if (geojsonRaw) {
        try {
          JSON.parse(geojsonRaw);
          geojsonData = geojsonRaw;
        } catch {
          showToast('Invalid JSON in GeoJSON field', 'error');
          return;
        }
      }

      const body = { displayName, communityId, layerKey, subLayerKey };
      if (geojsonData) body.geojsonData = geojsonData;

      try {
        if (isEdit) {
          body.version = layer.version;
          await apiFetch(`/api/map-layers/${layer.id}`, { method: 'PATCH', body });
          showToast('Layer updated', 'success');
        } else {
          await apiFetch('/api/map-layers', { method: 'POST', body });
          showToast('Layer created', 'success');
        }
        overlay.remove();
        await loadLayers();
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
