AdminRouter.register('map-layers', async function(container) {
  const { apiFetch, showToast } = AdminAPI;
  const communityId = AdminState.getActiveCommunityId();

  const LAYER_HIERARCHY = {
    community: ["bluegrass_area", "native_area", "landscape_bed", "pet_station"],
    irrigation: ["backflow", "controller", "zone", "master_valve", "flow_meter", "qc_iso_valve"],
    snow: ["plow", "atv", "hand_shovel", "ice_melt", "slicer", "storage_area"],
    trees: ["tree"],
  };

  if (!communityId) {
    container.innerHTML = '<div class="empty-state"><p>Select a community from the top bar to manage map layers.</p></div>';
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <h1>Map Layers</h1>
      <div class="flex gap-2">
        <button class="btn btn-primary" id="upload-layer-btn">Upload File</button>
        <button class="btn btn-secondary" id="add-layer-btn">+ Manual Entry</button>
      </div>
    </div>
    <div id="layer-tree"></div>
  `;

  document.getElementById('upload-layer-btn').addEventListener('click', () => showUploadModal());
  document.getElementById('add-layer-btn').addEventListener('click', () => showLayerModal());
  await loadLayers();

  async function loadLayers() {
    try {
      const layers = await apiFetch(`/api/map-layers?communityId=${communityId}`);
      const summaries = {};
      await Promise.all(layers.map(async (l) => {
        try {
          summaries[l.id] = await apiFetch(`/api/map-layers/${l.id}/summary`);
        } catch {}
      }));

      const treeEl = document.getElementById('layer-tree');
      if (layers.length === 0) {
        treeEl.innerHTML = '<div class="empty-state">No map layers yet. Upload a KML or GeoJSON file to get started.</div>';
        return;
      }

      const grouped = {};
      layers.forEach(l => {
        const key = l.layerKey || 'uncategorized';
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(l);
      });

      let html = '';
      for (const [layerKey, groupLayers] of Object.entries(grouped)) {
        html += `<div class="layer-group" style="margin-bottom:24px">`;
        html += `<h3 style="text-transform:capitalize;margin-bottom:12px;color:var(--text-primary)">
          <span style="display:inline-block;width:8px;height:8px;background:var(--accent-primary);border-radius:50%;margin-right:8px"></span>
          ${esc(layerKey)}
        </h3>`;
        html += `<div class="table-container"><table><thead><tr>
          <th>Name</th>
          <th>Sub Layer</th>
          <th>Format</th>
          <th>Features</th>
          <th>Active</th>
          <th>Archived</th>
          <th>Incomplete</th>
          <th class="text-right">Actions</th>
        </tr></thead><tbody>`;

        groupLayers.forEach(l => {
          const s = summaries[l.id] || {};
          html += `<tr>
            <td><strong>${esc(l.displayName)}</strong></td>
            <td><span class="badge badge-blue">${esc(l.subLayerKey || '—')}</span></td>
            <td>${formatBadge(s.sourceFormat || l.sourceFormat)}</td>
            <td>${s.featureCount ?? '—'}</td>
            <td>${s.activeAssetCount ?? '—'}</td>
            <td>${s.archivedAssetCount ?? '—'}</td>
            <td>${s.incompleteAssetCount != null ? (s.incompleteAssetCount > 0 ? `<span class="badge badge-warning">${s.incompleteAssetCount}</span>` : '0') : '—'}</td>
            <td class="text-right">
              <button class="btn btn-primary btn-xs sync-btn" data-id="${l.id}">Sync</button>
              <button class="btn btn-secondary btn-xs edit-btn" data-id="${l.id}">Edit</button>
              <button class="btn btn-danger btn-xs delete-btn" data-id="${l.id}" data-name="${esc(l.displayName)}">Delete</button>
            </td>
          </tr>`;
        });

        html += `</tbody></table></div></div>`;
      }

      treeEl.innerHTML = html;

      treeEl.querySelectorAll('.sync-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          btn.textContent = 'Syncing...';
          try {
            const result = await apiFetch(`/api/map-layers/${btn.dataset.id}/sync-assets`, { method: 'POST' });
            showSyncReport(result);
            await loadLayers();
          } catch (err) {
            showToast('Sync failed: ' + err.message, 'error');
            btn.disabled = false;
            btn.textContent = 'Sync';
          }
        });
      });

      treeEl.querySelectorAll('.edit-btn').forEach(btn => {
        const layer = layers.find(l => l.id === btn.dataset.id);
        btn.addEventListener('click', () => showLayerModal(layer));
      });

      treeEl.querySelectorAll('.delete-btn').forEach(btn => {
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

  function formatBadge(format) {
    if (format === 'kml') return '<span class="badge" style="background:#e67e22;color:#fff">KML</span>';
    if (format === 'geojson') return '<span class="badge" style="background:#27ae60;color:#fff">GeoJSON</span>';
    return '<span class="badge">—</span>';
  }

  function showSyncReport(result) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:440px">
        <div class="modal-header">
          <h2>Sync Report</h2>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;text-align:center">
            <div style="background:var(--bg-tertiary);padding:16px;border-radius:8px">
              <div style="font-size:24px;font-weight:700;color:#27ae60">${result.created || 0}</div>
              <div style="font-size:12px;color:var(--text-muted)">Created</div>
            </div>
            <div style="background:var(--bg-tertiary);padding:16px;border-radius:8px">
              <div style="font-size:24px;font-weight:700;color:#3498db">${result.updated || 0}</div>
              <div style="font-size:12px;color:var(--text-muted)">Updated</div>
            </div>
            <div style="background:var(--bg-tertiary);padding:16px;border-radius:8px">
              <div style="font-size:24px;font-weight:700;color:#e67e22">${result.archived || 0}</div>
              <div style="font-size:12px;color:var(--text-muted)">Archived</div>
            </div>
            <div style="background:var(--bg-tertiary);padding:16px;border-radius:8px">
              <div style="font-size:24px;font-weight:700;color:#95a5a6">${result.skippedMissingId || 0}</div>
              <div style="font-size:12px;color:var(--text-muted)">Skipped (no ID)</div>
            </div>
          </div>
          <p style="margin-top:16px;font-size:13px;color:var(--text-muted)">Total features processed: ${result.featureCount || result.total || 0}</p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-primary close-btn">Done</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
    overlay.querySelector('.close-btn').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  }

  function showUploadModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal modal-wide">
        <div class="modal-header">
          <h2>Upload Map Layer File</h2>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <div class="flex gap-4">
            <div class="form-group" style="flex:1">
              <label>Display Name</label>
              <input type="text" class="form-input" id="ul-name" placeholder="e.g. Oak Park Backflows" />
            </div>
          </div>
          <div class="flex gap-4">
            <div class="form-group" style="flex:1">
              <label>Layer Key</label>
              <select class="form-input" id="ul-layerKey">
                <option value="">-- Select --</option>
                ${Object.keys(LAYER_HIERARCHY).map(k => `<option value="${k}">${k}</option>`).join('')}
              </select>
            </div>
            <div class="form-group" style="flex:1">
              <label>Sub Layer Key</label>
              <select class="form-input" id="ul-subLayerKey" disabled>
                <option value="">-- Select layer key first --</option>
              </select>
            </div>
          </div>
          <div class="form-group">
            <label>File (.kml or .geojson / .json)</label>
            <div id="ul-dropzone" style="border:2px dashed var(--border-primary);border-radius:8px;padding:40px;text-align:center;cursor:pointer;transition:border-color 0.2s">
              <div style="font-size:32px;margin-bottom:8px">📁</div>
              <div id="ul-droptext">Drop a file here or click to browse</div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:4px">Supports .kml, .geojson, .json — max 50 MB</div>
              <input type="file" id="ul-file" accept=".kml,.geojson,.json" style="display:none" />
            </div>
          </div>
          <div id="ul-preview" style="display:none;margin-top:12px">
            <div style="background:var(--bg-tertiary);padding:12px;border-radius:8px;font-size:13px">
              <strong id="ul-filename"></strong>
              <span id="ul-format-badge" style="margin-left:8px"></span>
              <span id="ul-size" style="margin-left:8px;color:var(--text-muted)"></span>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary cancel-btn">Cancel</button>
          <button class="btn btn-primary upload-btn" disabled>Upload & Sync</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    let selectedFile = null;

    const layerKeySelect = overlay.querySelector('#ul-layerKey');
    const subLayerKeySelect = overlay.querySelector('#ul-subLayerKey');
    layerKeySelect.addEventListener('change', () => {
      const key = layerKeySelect.value;
      if (key && LAYER_HIERARCHY[key]) {
        subLayerKeySelect.disabled = false;
        subLayerKeySelect.innerHTML = '<option value="">-- Select --</option>' +
          LAYER_HIERARCHY[key].map(s => `<option value="${s}">${s}</option>`).join('');
      } else {
        subLayerKeySelect.disabled = true;
        subLayerKeySelect.innerHTML = '<option value="">-- Select layer key first --</option>';
      }
    });

    const dropzone = overlay.querySelector('#ul-dropzone');
    const fileInput = overlay.querySelector('#ul-file');
    const uploadBtn = overlay.querySelector('.upload-btn');

    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.style.borderColor = 'var(--accent-primary)'; });
    dropzone.addEventListener('dragleave', () => { dropzone.style.borderColor = 'var(--border-primary)'; });
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.style.borderColor = 'var(--border-primary)';
      if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); });

    function handleFile(file) {
      selectedFile = file;
      const ext = file.name.split('.').pop().toLowerCase();
      const isKml = ext === 'kml';
      const format = isKml ? 'KML' : 'GeoJSON';

      overlay.querySelector('#ul-preview').style.display = 'block';
      overlay.querySelector('#ul-filename').textContent = file.name;
      overlay.querySelector('#ul-format-badge').innerHTML = isKml
        ? '<span class="badge" style="background:#e67e22;color:#fff">KML</span>'
        : '<span class="badge" style="background:#27ae60;color:#fff">GeoJSON</span>';
      overlay.querySelector('#ul-size').textContent = formatSize(file.size);
      overlay.querySelector('#ul-droptext').textContent = file.name;
      uploadBtn.disabled = false;

      if (!overlay.querySelector('#ul-name').value) {
        overlay.querySelector('#ul-name').value = file.name.replace(/\.[^.]+$/, '');
      }
    }

    overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
    overlay.querySelector('.cancel-btn').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    uploadBtn.addEventListener('click', async () => {
      const displayName = overlay.querySelector('#ul-name').value.trim();
      const layerKey = layerKeySelect.value;
      const subLayerKey = subLayerKeySelect.value;

      if (!displayName) { showToast('Display name is required', 'error'); return; }
      if (!layerKey) { showToast('Layer key is required', 'error'); return; }
      if (!subLayerKey) { showToast('Sub layer key is required', 'error'); return; }
      if (!selectedFile) { showToast('Please select a file', 'error'); return; }

      uploadBtn.disabled = true;
      uploadBtn.textContent = 'Uploading...';

      try {
        const formData = new FormData();
        formData.append('file', selectedFile);
        formData.append('displayName', displayName);
        formData.append('communityId', communityId);
        formData.append('layerKey', layerKey);
        formData.append('subLayerKey', subLayerKey);

        const resp = await fetch('/api/map-layers/upload', {
          method: 'POST',
          body: formData,
          credentials: 'include',
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          throw new Error(err.error || `Upload failed (${resp.status})`);
        }
        const result = await resp.json();
        overlay.remove();
        showToast(`Layer created with ${result.featureCount} features`, 'success');
        if (result.syncReport) {
          showSyncReport(result.syncReport);
        }
        await loadLayers();
      } catch (err) {
        showToast(err.message, 'error');
        uploadBtn.disabled = false;
        uploadBtn.textContent = 'Upload & Sync';
      }
    });
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
          </div>
          <div class="flex gap-4">
            <div class="form-group" style="flex:1">
              <label>Layer Key</label>
              <select class="form-input" id="ml-layerKey">
                <option value="">-- Select --</option>
                ${Object.keys(LAYER_HIERARCHY).map(k => `<option value="${k}" ${layer?.layerKey === k ? 'selected' : ''}>${k}</option>`).join('')}
              </select>
            </div>
            <div class="form-group" style="flex:1">
              <label>Sub Layer Key</label>
              <select class="form-input" id="ml-subLayerKey">
                <option value="">-- Select layer key first --</option>
                ${layer?.layerKey && LAYER_HIERARCHY[layer.layerKey] ? LAYER_HIERARCHY[layer.layerKey].map(s => `<option value="${s}" ${layer?.subLayerKey === s ? 'selected' : ''}>${s}</option>`).join('') : ''}
              </select>
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

    const layerKeySelect = overlay.querySelector('#ml-layerKey');
    const subLayerKeySelect = overlay.querySelector('#ml-subLayerKey');
    layerKeySelect.addEventListener('change', () => {
      const key = layerKeySelect.value;
      if (key && LAYER_HIERARCHY[key]) {
        subLayerKeySelect.disabled = false;
        subLayerKeySelect.innerHTML = '<option value="">-- Select --</option>' +
          LAYER_HIERARCHY[key].map(s => `<option value="${s}">${s}</option>`).join('');
      } else {
        subLayerKeySelect.disabled = true;
        subLayerKeySelect.innerHTML = '<option value="">-- Select layer key first --</option>';
      }
    });

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
      const layerKey = layerKeySelect.value;
      const subLayerKey = subLayerKeySelect.value;
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

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function esc(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }
});
