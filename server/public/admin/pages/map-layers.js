window._renderMapLayers = async function(container, communityId) {
  const { apiFetch, showToast } = AdminAPI;

  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    var k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
    var i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  const LAYER_HIERARCHY = {
    community: ["bluegrass_area", "native_area", "landscape_bed", "pet_station"],
    irrigation: ["backflow", "controller", "zone", "master_valve", "flow_meter", "qc_iso_valve"],
    snow: ["plow", "atv", "hand_shovel", "ice_melt", "slicer", "storage_area"],
    trees: ["tree"],
  };

  container.innerHTML = `
    <div class="page-header" style="margin-top:16px">
      <h2 style="font-size:16px">Map Layers</h2>
      <div class="flex gap-2">
        <button class="btn btn-sm" id="upload-irrigation-btn" style="background:#0C1D31;color:#fff;border:none">🌊 Upload Irrigation KML</button>
        <button class="btn btn-primary btn-sm" id="upload-layer-btn">Upload File</button>
        <button class="btn btn-secondary btn-sm" id="add-layer-btn">+ Manual Entry</button>
      </div>
    </div>
    <div id="outline-section"></div>
    <div id="layer-tree"></div>
  `;

  document.getElementById('upload-layer-btn').addEventListener('click', () => showUploadModal());
  document.getElementById('add-layer-btn').addEventListener('click', () => showLayerModal());
  document.getElementById('upload-irrigation-btn').addEventListener('click', () => showIrrigationUploadModal());
  await loadLayers();
  await loadOutlineSection();

  async function loadOutlineSection() {
    const sectionEl = document.getElementById('outline-section');
    if (!sectionEl) return;
    try {
      const layers = await apiFetch(`/api/map-layers?communityId=${communityId}&layerKey=outline`);
      const outline = layers.find(l => l.subLayerKey === 'community_boundary');
      let featureCount = 0;
      if (outline) {
        try {
          const summary = await apiFetch(`/api/map-layers/${outline.id}/summary`);
          featureCount = summary.featureCount || 0;
        } catch {}
      }

      let html = `
        <div style="margin-bottom:24px;border:2px solid #0C1D31;border-radius:10px;padding:16px;background:#f8fafb">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
            <div style="display:flex;align-items:center;gap:8px">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0C1D31" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M9 3v18"/></svg>
              <h3 style="font-size:14px;font-weight:700;color:#0C1D31;margin:0">Community Outline</h3>
            </div>
            <div style="display:flex;gap:6px">`;

      if (outline) {
        html += `
              <button class="btn btn-primary btn-xs" id="outline-edit-btn">Replace</button>
              <button class="btn btn-danger btn-xs" id="outline-delete-btn">Delete</button>`;
      } else {
        html += `
              <button class="btn btn-primary btn-xs" id="outline-upload-btn">Upload Outline</button>
              <button class="btn btn-secondary btn-xs" id="outline-paste-btn">Paste GeoJSON</button>`;
      }

      html += `
            </div>
          </div>`;

      if (outline) {
        const currentStrokeColor = outline.strokeColor || '#0C1D31';
        const currentStrokeWeight = outline.strokeWeight || 3;
        const currentFillOpacity = outline.fillOpacity != null ? parseFloat(outline.fillOpacity) : 0.08;
        html += `
          <div style="display:flex;gap:16px;font-size:13px;color:var(--gray-600);margin-bottom:12px">
            <div><strong>Name:</strong> ${esc(outline.displayName)}</div>
            <div><strong>Format:</strong> ${formatBadge(outline.sourceFormat)}</div>
            <div><strong>Features:</strong> ${featureCount}</div>
          </div>
          <div style="border-top:1px solid #e0e4ea;padding-top:12px;margin-top:4px">
            <div style="font-size:12px;font-weight:700;color:#0C1D31;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px">Style</div>
            <div style="display:flex;gap:16px;align-items:flex-end;flex-wrap:wrap">
              <div>
                <label style="display:block;font-size:12px;color:var(--gray-500);margin-bottom:4px">Stroke Color</label>
                <input type="color" id="outline-stroke-color" value="${currentStrokeColor}" style="width:40px;height:30px;padding:0;border:1px solid #ddd;border-radius:4px;cursor:pointer">
              </div>
              <div>
                <label style="display:block;font-size:12px;color:var(--gray-500);margin-bottom:4px">Line Width (1–10)</label>
                <input type="number" id="outline-stroke-weight" value="${currentStrokeWeight}" min="1" max="10" style="width:60px;padding:4px 6px;border:1px solid #ddd;border-radius:4px;font-size:13px">
              </div>
              <div style="flex:1;min-width:120px">
                <label style="display:block;font-size:12px;color:var(--gray-500);margin-bottom:4px">Fill Opacity: <span id="outline-opacity-val">${currentFillOpacity.toFixed(2)}</span></label>
                <input type="range" id="outline-fill-opacity" min="0" max="1" step="0.01" value="${currentFillOpacity}" style="width:100%">
              </div>
              <button class="btn btn-primary btn-xs" id="outline-style-save-btn">Save Style</button>
            </div>
          </div>`;
      } else {
        html += `
          <div style="font-size:13px;color:var(--gray-400)">No community outline defined. Upload a KML or GeoJSON file to show a boundary overlay on all map views.</div>`;
      }

      html += `</div>`;
      sectionEl.innerHTML = html;

      if (outline) {
        document.getElementById('outline-edit-btn')?.addEventListener('click', () => showOutlineUploadModal(outline));
        document.getElementById('outline-delete-btn')?.addEventListener('click', async () => {
          if (!confirm('Delete the community outline? This cannot be undone.')) return;
          try {
            await apiFetch(`/api/map-layers/${outline.id}`, { method: 'DELETE' });
            showToast('Outline deleted', 'success');
            await loadOutlineSection();
          } catch (err) {
            showToast('Delete failed: ' + err.message, 'error');
          }
        });

        const opacitySlider = document.getElementById('outline-fill-opacity');
        const opacityVal = document.getElementById('outline-opacity-val');
        if (opacitySlider && opacityVal) {
          opacitySlider.addEventListener('input', () => {
            opacityVal.textContent = parseFloat(opacitySlider.value).toFixed(2);
          });
        }

        document.getElementById('outline-style-save-btn')?.addEventListener('click', async () => {
          const saveBtn = document.getElementById('outline-style-save-btn');
          const strokeColor = document.getElementById('outline-stroke-color')?.value || '#0C1D31';
          const strokeWeight = parseInt(document.getElementById('outline-stroke-weight')?.value || '3', 10);
          const fillOpacity = parseFloat(document.getElementById('outline-fill-opacity')?.value || '0.08');
          if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }
          try {
            await apiFetch(`/api/map-layers/${outline.id}`, {
              method: 'PATCH',
              body: {
                strokeColor,
                strokeWeight,
                fillOpacity: String(fillOpacity),
                version: outline.version,
              },
            });
            showToast('Outline style saved', 'success');
            await loadOutlineSection();
          } catch (err) {
            showToast('Save failed: ' + err.message, 'error');
            if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Style'; }
          }
        });
      } else {
        document.getElementById('outline-upload-btn')?.addEventListener('click', () => showOutlineUploadModal());
        document.getElementById('outline-paste-btn')?.addEventListener('click', () => showOutlinePasteModal());
      }
    } catch (err) {
      sectionEl.innerHTML = '';
    }
  }

  function showOutlineUploadModal(existing = null) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:520px">
        <div class="modal-header">
          <h2>${existing ? 'Replace' : 'Upload'} Community Outline</h2>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>Display Name</label>
            <input type="text" class="form-input" id="ol-name" value="${esc(existing?.displayName || 'Community Boundary')}" />
          </div>
          <div class="form-group">
            <label>File (.kml or .geojson / .json)</label>
            <div id="ol-dropzone" style="border:2px dashed var(--gray-300);border-radius:8px;padding:32px;text-align:center;cursor:pointer;transition:border-color 0.2s">
              <div style="font-size:28px;margin-bottom:8px;color:var(--gray-400)">&#128193;</div>
              <div id="ol-droptext" style="color:var(--gray-500)">Drop a file here or click to browse</div>
              <div style="font-size:12px;color:var(--gray-400);margin-top:4px">Supports .kml, .geojson, .json</div>
              <input type="file" id="ol-file" accept=".kml,.geojson,.json" style="display:none" />
            </div>
          </div>
          <div id="ol-preview" style="display:none;margin-top:8px">
            <div style="background:var(--gray-50);padding:10px;border-radius:8px;font-size:13px">
              <strong id="ol-filename"></strong>
              <span id="ol-format-badge" style="margin-left:8px"></span>
              <span id="ol-size" style="margin-left:8px;color:var(--gray-500)"></span>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary cancel-btn">Cancel</button>
          <button class="btn btn-primary upload-ol-btn" disabled>${existing ? 'Replace' : 'Upload'}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    let selectedFile = null;
    const dropzone = overlay.querySelector('#ol-dropzone');
    const fileInput = overlay.querySelector('#ol-file');
    const uploadBtn = overlay.querySelector('.upload-ol-btn');

    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.style.borderColor = 'var(--teal)'; });
    dropzone.addEventListener('dragleave', () => { dropzone.style.borderColor = 'var(--gray-300)'; });
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.style.borderColor = 'var(--gray-300)';
      if (e.dataTransfer.files[0]) handleOlFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleOlFile(fileInput.files[0]); });

    function handleOlFile(file) {
      selectedFile = file;
      const ext = file.name.split('.').pop().toLowerCase();
      const isKml = ext === 'kml';
      overlay.querySelector('#ol-preview').style.display = 'block';
      overlay.querySelector('#ol-filename').textContent = file.name;
      overlay.querySelector('#ol-format-badge').innerHTML = isKml
        ? '<span class="badge" style="background:#e67e22;color:#fff">KML</span>'
        : '<span class="badge" style="background:#27ae60;color:#fff">GeoJSON</span>';
      overlay.querySelector('#ol-size').textContent = formatSize(file.size);
      overlay.querySelector('#ol-droptext').textContent = file.name;
      if (!overlay.querySelector('#ol-name').value || overlay.querySelector('#ol-name').value === 'Community Boundary') {
        overlay.querySelector('#ol-name').value = file.name.replace(/\.[^.]+$/, '');
      }
      uploadBtn.disabled = false;
    }

    overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
    overlay.querySelector('.cancel-btn').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    uploadBtn.addEventListener('click', async () => {
      const displayName = overlay.querySelector('#ol-name').value.trim();
      if (!displayName) { showToast('Display name is required', 'error'); return; }
      if (!selectedFile) { showToast('Please select a file', 'error'); return; }

      uploadBtn.disabled = true;
      uploadBtn.textContent = 'Uploading...';

      try {
        const formData = new FormData();
        formData.append('file', selectedFile);
        formData.append('displayName', displayName);
        formData.append('communityId', communityId);
        formData.append('layerKey', 'outline');
        formData.append('subLayerKey', 'community_boundary');
        if (existing) {
          formData.append('layerId', existing.id);
          formData.append('version', String(existing.version));
        }

        const resp = await fetch('/api/map-layers/upload', {
          method: 'POST',
          body: formData,
          credentials: 'include',
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          throw new Error(err.error || 'Upload failed');
        }
        const result = await resp.json();
        overlay.remove();
        showToast(`Outline ${existing ? 'replaced' : 'uploaded'} with ${result.featureCount} feature(s)`, 'success');
        await loadOutlineSection();
      } catch (err) {
        showToast(err.message, 'error');
        uploadBtn.disabled = false;
        uploadBtn.textContent = existing ? 'Replace' : 'Upload';
      }
    });
  }

  function showOutlinePasteModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:600px">
        <div class="modal-header">
          <h2>Paste Community Outline GeoJSON</h2>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>Display Name</label>
            <input type="text" class="form-input" id="olp-name" value="Community Boundary" />
          </div>
          <div class="form-group">
            <label>GeoJSON Data</label>
            <textarea class="form-textarea geojson-input" id="olp-geojson" placeholder='Paste GeoJSON FeatureCollection or Feature here...' style="min-height:200px"></textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary cancel-btn">Cancel</button>
          <button class="btn btn-primary save-olp-btn">Save Outline</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
    overlay.querySelector('.cancel-btn').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('.save-olp-btn').addEventListener('click', async () => {
      const displayName = overlay.querySelector('#olp-name').value.trim();
      const geojsonRaw = overlay.querySelector('#olp-geojson').value.trim();

      if (!displayName) { showToast('Display name is required', 'error'); return; }
      if (!geojsonRaw) { showToast('GeoJSON data is required', 'error'); return; }

      try {
        JSON.parse(geojsonRaw);
      } catch {
        showToast('Invalid JSON', 'error');
        return;
      }

      const saveBtn = overlay.querySelector('.save-olp-btn');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      try {
        await apiFetch('/api/map-layers', {
          method: 'POST',
          body: {
            displayName,
            communityId,
            layerKey: 'outline',
            subLayerKey: 'community_boundary',
            geojsonData: geojsonRaw,
          },
        });
        overlay.remove();
        showToast('Community outline created', 'success');
        await loadOutlineSection();
      } catch (err) {
        showToast(err.message, 'error');
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Outline';
      }
    });
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

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
      const nonOutlineLayers = layers.filter(l => l.layerKey !== 'outline');

      if (nonOutlineLayers.length === 0) {
        treeEl.innerHTML = '<div class="empty-state">No map layers yet. Upload a KML or GeoJSON file to get started.</div>';
        return;
      }

      const grouped = {};
      nonOutlineLayers.forEach(l => {
        const key = l.layerKey || 'uncategorized';
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(l);
      });

      let controllerGroups = null;
      if (grouped['irrigation']) {
        try {
          controllerGroups = await apiFetch(`/api/communities/${communityId}/controllers`);
        } catch {}
      }

      let html = '';
      for (const [layerKey, groupLayers] of Object.entries(grouped)) {
        html += `<div class="layer-group" style="margin-bottom:24px">`;
        html += `<h3 style="text-transform:capitalize;margin-bottom:12px;color:var(--navy);font-size:14px;font-weight:600">
          <span style="display:inline-block;width:8px;height:8px;background:var(--teal);border-radius:50%;margin-right:8px"></span>
          ${esc(layerKey)}
        </h3>`;

        if (layerKey === 'irrigation' && controllerGroups && controllerGroups.length > 0) {
          html += renderIrrigationGrouped(groupLayers, summaries, controllerGroups);
        } else {
          html += renderLayerTable(groupLayers, summaries);
        }

        html += `</div>`;
      }

      treeEl.innerHTML = html;

      treeEl.querySelectorAll('.validate-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          btn.textContent = '...';
          try {
            const result = await apiFetch(`/api/map-layers/${btn.dataset.id}/validate`, { method: 'POST' });
            showValidationModal(result);
          } catch (err) {
            showToast('Validation failed: ' + err.message, 'error');
          }
          btn.disabled = false;
          btn.textContent = 'Validate';
        });
      });

      treeEl.querySelectorAll('.preview-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          btn.textContent = '...';
          try {
            const result = await apiFetch(`/api/map-layers/${btn.dataset.id}/sync-preview`, { method: 'POST' });
            showSyncPreviewModal(result);
          } catch (err) {
            showToast('Preview failed: ' + err.message, 'error');
          }
          btn.disabled = false;
          btn.textContent = 'Preview';
        });
      });

      treeEl.querySelectorAll('.unlinked-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          btn.textContent = '...';
          try {
            const features = await apiFetch(`/api/map-layers/${btn.dataset.id}/unlinked-features`);
            showUnlinkedModal(features, btn.dataset.id);
          } catch (err) {
            showToast('Failed to load unlinked features: ' + err.message, 'error');
          }
          btn.disabled = false;
          btn.textContent = 'Unlinked';
        });
      });

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

      treeEl.querySelectorAll('.ctrl-color-swatch-btn').forEach(swatchBtn => {
        const hiddenPicker = swatchBtn.querySelector('.ctrl-color-picker');
        swatchBtn.addEventListener('click', () => hiddenPicker && hiddenPicker.click());
        if (hiddenPicker) {
          hiddenPicker.addEventListener('change', async () => {
            const ctrlKey = hiddenPicker.dataset.ctrlKey;
            const newColor = hiddenPicker.value;
            const prevColor = swatchBtn.style.background;
            swatchBtn.style.background = newColor;
            try {
              const allAssets = (controllerGroups || []).flatMap(c => {
                const cKey = c.controllerKey || c.label || c.id || '';
                if (cKey !== ctrlKey) return [];
                return [c, ...(c.zones || [])];
              });
              if (allAssets.length === 0) {
                showToast('No assets found for this controller', 'error');
                swatchBtn.style.background = prevColor;
                return;
              }
              const results = await Promise.allSettled(allAssets.filter(a => a.id).map(a =>
                apiFetch(`/api/assets/${a.id}/properties`, {
                  method: 'PUT',
                  body: { properties: [{ key: 'controllerColor', value: newColor }] },
                })
              ));
              const failed = results.filter(r => r.status === 'rejected').length;
              if (failed === 0) {
                showToast('Controller color updated', 'success');
              } else if (failed < results.length) {
                showToast(`Color updated with ${failed} error(s)`, 'error');
              } else {
                swatchBtn.style.background = prevColor;
                showToast('Failed to update controller color', 'error');
              }
            } catch (err) {
              swatchBtn.style.background = prevColor;
              showToast('Failed to update color: ' + err.message, 'error');
            }
          });
        }
      });

      treeEl.addEventListener('click', (e) => {
        if (e.target.closest('.ctrl-color-swatch-btn')) return;
        const header = e.target.closest('.ctrl-collapse-header');
        if (!header) return;
        const zoneTableId = header.dataset.zoneTable;
        const zoneTable = zoneTableId ? document.getElementById(zoneTableId) : null;
        const chevron = header.querySelector('.ctrl-chevron');
        if (!zoneTable) return;
        const isHidden = zoneTable.style.display === 'none';
        zoneTable.style.display = isHidden ? '' : 'none';
        if (chevron) chevron.style.transform = isHidden ? 'rotate(90deg)' : 'rotate(0deg)';
      });
    } catch (err) {
      showToast('Failed to load layers', 'error');
    }
  }

  function renderLayerTable(groupLayers, summaries) {
    let html = `<div class="table-container"><table><thead><tr>
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
        <td><span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:${esc(l.color||'#25C1AC')};border:1px solid rgba(0,0,0,0.15);vertical-align:middle;margin-right:6px"></span><strong>${esc(l.displayName)}</strong></td>
        <td><span class="badge badge-blue">${esc(l.subLayerKey || '—')}</span></td>
        <td>${formatBadge(s.sourceFormat || l.sourceFormat)}</td>
        <td>${s.featureCount ?? '—'}</td>
        <td>${s.activeAssetCount ?? '—'}</td>
        <td>${s.archivedAssetCount ?? '—'}</td>
        <td>${s.incompleteAssetCount != null ? (s.incompleteAssetCount > 0 ? `<span class="badge badge-amber">${s.incompleteAssetCount}</span>` : '0') : '—'}</td>
        <td class="text-right" style="white-space:nowrap">
          <div style="display:inline-flex;gap:4px;flex-wrap:wrap;justify-content:flex-end">
            <button class="btn btn-xs validate-btn" data-id="${l.id}" style="background:#8e44ad;color:#fff;border:none">Validate</button>
            <button class="btn btn-xs preview-btn" data-id="${l.id}" style="background:#2980b9;color:#fff;border:none">Preview</button>
            <button class="btn btn-xs unlinked-btn" data-id="${l.id}" style="background:#e67e22;color:#fff;border:none">Unlinked</button>
            <button class="btn btn-primary btn-xs sync-btn" data-id="${l.id}">Sync</button>
            <button class="btn btn-secondary btn-xs edit-btn" data-id="${l.id}">Edit</button>
            <button class="btn btn-danger btn-xs delete-btn" data-id="${l.id}" data-name="${esc(l.displayName)}">Delete</button>
          </div>
        </td>
      </tr>`;
    });

    html += `</tbody></table></div>`;
    return html;
  }

  function renderIrrigationGrouped(groupLayers, summaries, controllerGroups) {
    const controllerLayer = groupLayers.find(l => l.subLayerKey === 'controller');
    const zoneLayer = groupLayers.find(l => l.subLayerKey === 'zone');
    const otherLayers = groupLayers.filter(l => l.subLayerKey !== 'controller' && l.subLayerKey !== 'zone');

    let html = '';

    html += `<div style="margin-bottom:12px;padding:10px 12px;background:#f0f7ff;border:1px solid #c3daf7;border-radius:8px;display:flex;flex-wrap:wrap;gap:6px;align-items:center">`;
    html += `<span style="font-size:12px;color:#4a7fa8;font-weight:600;margin-right:4px">Layer actions:</span>`;
    [controllerLayer, zoneLayer, ...otherLayers].filter(Boolean).forEach(l => {
      html += `<span style="font-size:12px;color:var(--gray-600);margin-right:2px">${esc(l.subLayerKey)}</span>`;
      html += `<div style="display:inline-flex;gap:3px;margin-right:8px">`;
      html += `<button class="btn btn-xs validate-btn" data-id="${l.id}" style="background:#8e44ad;color:#fff;border:none">Validate</button>`;
      html += `<button class="btn btn-xs preview-btn" data-id="${l.id}" style="background:#2980b9;color:#fff;border:none">Preview</button>`;
      html += `<button class="btn btn-xs unlinked-btn" data-id="${l.id}" style="background:#e67e22;color:#fff;border:none">Unlinked</button>`;
      html += `<button class="btn btn-primary btn-xs sync-btn" data-id="${l.id}">Sync</button>`;
      html += `<button class="btn btn-secondary btn-xs edit-btn" data-id="${l.id}">Edit</button>`;
      html += `<button class="btn btn-danger btn-xs delete-btn" data-id="${l.id}" data-name="${esc(l.displayName)}">Delete</button>`;
      html += `</div>`;
    });
    html += `</div>`;

    html += `<div style="display:flex;flex-direction:column;gap:10px">`;
    controllerGroups.forEach((ctrl, ctrlIdx) => {
      const color = ctrl.controllerColor || '#999999';
      const ctrlKey = ctrl.controllerKey || ctrl.label || ctrl.id;
      const label = ctrl.label || ctrl.controllerKey || 'Controller';
      const zones = ctrl.zones || [];
      const zoneTableId = `ctrl-zones-${ctrlIdx}`;

      html += `<div style="border:1px solid #dde3ea;border-radius:8px;overflow:hidden">`;
      html += `<div class="ctrl-collapse-header" data-zone-table="${zoneTableId}" style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:#f8fafb;border-bottom:1px solid #dde3ea;cursor:pointer;user-select:none">`;
      html += `<div class="ctrl-color-swatch-btn" title="Click to change controller color" style="display:inline-block;width:20px;height:20px;border-radius:4px;background:${esc(color)};border:2px solid rgba(0,0,0,0.2);flex-shrink:0;cursor:pointer;position:relative">`;
      html += `<input type="color" class="ctrl-color-picker" data-ctrl-key="${esc(ctrlKey)}" value="${esc(color)}" style="position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;border:none;padding:0" />`;
      html += `</div>`;
      html += `<strong style="font-size:13px;color:var(--navy);flex:1">${esc(label)}</strong>`;
      html += `<span style="font-size:12px;color:var(--gray-500)">${zones.length} zone${zones.length !== 1 ? 's' : ''}</span>`;
      html += `<span class="ctrl-chevron" style="font-size:14px;color:var(--gray-400);transition:transform 0.2s;display:inline-block;transform:rotate(0deg)">&#8250;</span>`;
      html += `</div>`;

      if (zones.length > 0) {
        html += `<div id="${zoneTableId}" style="padding:0;display:none">`;
        html += `<table style="width:100%;border-collapse:collapse;font-size:12px">`;
        html += `<thead><tr style="background:#f0f3f6">`;
        html += `<th style="padding:6px 14px;text-align:left;color:var(--gray-600);font-weight:600">Zone</th>`;
        html += `<th style="padding:6px 14px;text-align:left;color:var(--gray-600);font-weight:600">Zone #</th>`;
        html += `<th style="padding:6px 14px;text-align:center;color:var(--gray-600);font-weight:600">Features</th>`;
        html += `<th style="padding:6px 14px;text-align:left;color:var(--gray-600);font-weight:600">Feature Ref</th>`;
        html += `</tr></thead><tbody>`;
        zones.forEach((z, i) => {
          const bg = i % 2 === 0 ? '#fff' : '#fafbfc';
          const zoneLabel = z.label || z.zoneLabelShort || `Zone ${z.zoneNumber || ''}`;
          const featureCount = z.featureCount != null ? z.featureCount : 1;
          html += `<tr style="background:${bg}">`;
          html += `<td style="padding:5px 14px;color:var(--navy)">${esc(zoneLabel)}</td>`;
          html += `<td style="padding:5px 14px;color:var(--gray-500)">${z.zoneNumber != null ? z.zoneNumber : '—'}</td>`;
          html += `<td style="padding:5px 14px;text-align:center;color:var(--gray-600)">${featureCount}</td>`;
          html += `<td style="padding:5px 14px;color:var(--gray-400);font-family:monospace;font-size:11px">${esc(z.featureRef || '—')}</td>`;
          html += `</tr>`;
        });
        html += `</tbody></table>`;
        html += `</div>`;
      } else {
        html += `<div id="${zoneTableId}" style="padding:10px 14px;font-size:12px;color:var(--gray-400);display:none">No zones linked to this controller.</div>`;
      }

      html += `</div>`;
    });
    html += `</div>`;

    if (otherLayers.length > 0) {
      html += `<div style="margin-top:12px">`;
      html += renderLayerTable(otherLayers, summaries);
      html += `</div>`;
    }

    return html;
  }

  function formatBadge(format) {
    if (format === 'kml') return '<span class="badge" style="background:#e67e22;color:#fff">KML</span>';
    if (format === 'geojson') return '<span class="badge" style="background:#27ae60;color:#fff">GeoJSON</span>';
    return '<span class="badge">—</span>';
  }

  function renderValidationPanel(result) {
    const hasErrors = result.errors && result.errors.length > 0;
    const hasWarnings = result.warnings && result.warnings.length > 0;
    const statusColor = hasErrors ? '#e74c3c' : hasWarnings ? '#f39c12' : '#27ae60';
    const statusLabel = hasErrors ? 'Errors Found' : hasWarnings ? 'Warnings' : 'Valid';
    const statusIcon = hasErrors ? '&#10008;' : hasWarnings ? '&#9888;' : '&#10004;';

    let html = `
      <div style="border:2px solid ${statusColor};border-radius:8px;padding:16px;margin-top:12px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
          <span style="color:${statusColor};font-size:18px">${statusIcon}</span>
          <strong style="color:${statusColor}">${statusLabel}</strong>
          <span style="margin-left:auto;font-size:13px;color:var(--gray-500)">${result.featureCount} features</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px">
          <div style="text-align:center;background:var(--gray-50);padding:8px;border-radius:6px">
            <div style="font-size:18px;font-weight:700">${result.geometryCounts?.points || 0}</div>
            <div style="font-size:11px;color:var(--gray-500)">Points</div>
          </div>
          <div style="text-align:center;background:var(--gray-50);padding:8px;border-radius:6px">
            <div style="font-size:18px;font-weight:700">${result.geometryCounts?.lines || 0}</div>
            <div style="font-size:11px;color:var(--gray-500)">Lines</div>
          </div>
          <div style="text-align:center;background:var(--gray-50);padding:8px;border-radius:6px">
            <div style="font-size:18px;font-weight:700">${result.geometryCounts?.polygons || 0}</div>
            <div style="font-size:11px;color:var(--gray-500)">Polygons</div>
          </div>
          <div style="text-align:center;background:var(--gray-50);padding:8px;border-radius:6px">
            <div style="font-size:18px;font-weight:700">${result.geometryCounts?.other || 0}</div>
            <div style="font-size:11px;color:var(--gray-500)">Other</div>
          </div>
        </div>`;

    if (result.missingIdCount > 0) {
      html += `<div style="background:#fdf2f2;border-left:3px solid #e74c3c;padding:10px;margin-bottom:8px;border-radius:4px;font-size:13px">
        <strong style="color:#e74c3c">${result.missingIdCount} feature(s) missing stable ID</strong>
        ${result.missingIdSamples?.length > 0 ? `<div style="margin-top:6px;font-size:12px;color:#666">Samples: ${result.missingIdSamples.map(s => `Feature #${s.index}`).join(', ')}</div>` : ''}
      </div>`;
    }

    if (result.duplicateIdCount > 0) {
      html += `<div style="background:#fdf2f2;border-left:3px solid #e74c3c;padding:10px;margin-bottom:8px;border-radius:4px;font-size:13px">
        <strong style="color:#e74c3c">${result.duplicateIdCount} duplicate feature ID(s)</strong>
        ${result.duplicateIdSamples?.length > 0 ? `<div style="margin-top:6px;font-size:12px;color:#666">IDs: ${result.duplicateIdSamples.map(s => `"${esc(s.featureId)}" (x${s.count})`).join(', ')}</div>` : ''}
      </div>`;
    }

    if (result.invalidGeometryCount > 0) {
      html += `<div style="background:#fef9e7;border-left:3px solid #f39c12;padding:10px;margin-bottom:8px;border-radius:4px;font-size:13px">
        <strong style="color:#f39c12">${result.invalidGeometryCount} invalid geometry</strong>
        ${result.invalidGeometrySamples?.length > 0 ? `<div style="margin-top:6px;font-size:12px;color:#666">${result.invalidGeometrySamples.map(s => `#${s.index}: ${s.issue}`).join(', ')}</div>` : ''}
      </div>`;
    }

    if (hasErrors) {
      html += `<div style="margin-top:8px">`;
      result.errors.forEach(e => {
        html += `<div style="color:#e74c3c;font-size:12px;margin-bottom:2px">&#10008; ${esc(e)}</div>`;
      });
      html += `</div>`;
    }

    if (hasWarnings) {
      const warnList = result.warnings.slice(0, 5);
      html += `<div style="margin-top:8px">`;
      warnList.forEach(w => {
        html += `<div style="color:#f39c12;font-size:12px;margin-bottom:2px">&#9888; ${esc(w)}</div>`;
      });
      if (result.warnings.length > 5) {
        html += `<div style="color:#999;font-size:11px">...and ${result.warnings.length - 5} more</div>`;
      }
      html += `</div>`;
    }

    html += `</div>`;
    return html;
  }

  function showValidationModal(result) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:560px">
        <div class="modal-header">
          <h2>Validation Report</h2>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          ${renderValidationPanel(result)}
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

  function showSyncPreviewModal(result) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:560px">
        <div class="modal-header">
          <h2>Sync Preview</h2>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <p style="color:var(--gray-500);font-size:13px;margin-bottom:16px">This preview shows what would happen if you sync now. No changes have been made.</p>
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;text-align:center">
            <div style="background:var(--gray-50);padding:16px;border-radius:8px">
              <div style="font-size:24px;font-weight:700;color:#27ae60">${result.wouldCreateCount || 0}</div>
              <div style="font-size:12px;color:var(--gray-500)">Would Create</div>
            </div>
            <div style="background:var(--gray-50);padding:16px;border-radius:8px">
              <div style="font-size:24px;font-weight:700;color:#3498db">${result.wouldUpdateCount || 0}</div>
              <div style="font-size:12px;color:var(--gray-500)">Would Update</div>
            </div>
            <div style="background:var(--gray-50);padding:16px;border-radius:8px">
              <div style="font-size:24px;font-weight:700;color:#e67e22">${result.wouldArchiveCount || 0}</div>
              <div style="font-size:12px;color:var(--gray-500)">Would Archive</div>
            </div>
            <div style="background:var(--gray-50);padding:16px;border-radius:8px">
              <div style="font-size:24px;font-weight:700;color:#95a5a6">${result.wouldSkipCount || 0}</div>
              <div style="font-size:12px;color:var(--gray-500)">Would Skip</div>
            </div>
          </div>
          ${result.wouldCreateSamples?.length > 0 ? `
            <div style="margin-top:16px">
              <div style="font-size:13px;font-weight:600;margin-bottom:6px;color:var(--navy)">New Assets (sample)</div>
              <div style="max-height:150px;overflow-y:auto">
                ${result.wouldCreateSamples.map(s => `
                  <div style="font-size:12px;padding:4px 8px;background:var(--gray-50);margin-bottom:2px;border-radius:4px">
                    <span style="color:var(--gray-500);font-family:monospace">${esc(s.featureId)}</span>
                    <span style="margin-left:8px">${esc(s.label)}</span>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}
          ${result.wouldArchiveSamples?.length > 0 ? `
            <div style="margin-top:16px">
              <div style="font-size:13px;font-weight:600;margin-bottom:6px;color:#e67e22">Would Archive (sample)</div>
              <div style="max-height:150px;overflow-y:auto">
                ${result.wouldArchiveSamples.map(s => `
                  <div style="font-size:12px;padding:4px 8px;background:#fef9e7;margin-bottom:2px;border-radius:4px">
                    <span style="color:var(--gray-500);font-family:monospace">${esc(s.featureRef)}</span>
                    <span style="margin-left:8px">${esc(s.label)}</span>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}
          <p style="margin-top:12px;font-size:12px;color:var(--gray-400)">Total features: ${result.featureCount || 0}</p>
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

  function showUnlinkedModal(features, layerId) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const reasonLabel = (r) => {
      if (r === 'missing_asset') return '<span class="badge" style="background:#e74c3c;color:#fff">Missing</span>';
      if (r === 'archived_asset_exists') return '<span class="badge badge-amber">Archived</span>';
      if (r === 'invalid_id') return '<span class="badge" style="background:#95a5a6;color:#fff">Invalid ID</span>';
      return '<span class="badge">Unknown</span>';
    };

    const creatableCount = features.filter(f => f.reason !== 'invalid_id').length;

    overlay.innerHTML = `
      <div class="modal modal-wide" style="max-width:720px">
        <div class="modal-header">
          <h2>Unlinked Features (${features.length})</h2>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          ${features.length === 0 ? '<div class="empty-state" style="padding:24px">All features are linked to active assets.</div>' : `
            <p style="color:var(--gray-500);font-size:13px;margin-bottom:12px">Features in the GeoJSON that do not have a corresponding active asset.</p>
            ${creatableCount > 0 ? `<button class="btn btn-primary btn-sm" id="create-all-btn" style="margin-bottom:12px">Create All Missing Assets (${creatableCount})</button>` : ''}
            <div class="table-container" style="max-height:400px;overflow-y:auto">
              <table>
                <thead><tr>
                  <th>Feature ID</th>
                  <th>Label</th>
                  <th>Geometry</th>
                  <th>Status</th>
                  <th class="text-right">Action</th>
                </tr></thead>
                <tbody>
                  ${features.map(f => `<tr>
                    <td style="font-family:monospace;font-size:12px">${esc(f.featureId)}</td>
                    <td>${esc(f.label)}</td>
                    <td><span class="badge">${esc(f.geometryType || 'none')}</span></td>
                    <td>${reasonLabel(f.reason)}</td>
                    <td class="text-right">
                      ${f.reason !== 'invalid_id' ? `<button class="btn btn-primary btn-xs create-one-btn" data-feature-id="${esc(f.featureId)}">Create</button>` : '<span style="color:#999;font-size:12px">—</span>'}
                    </td>
                  </tr>`).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary close-btn">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
    overlay.querySelector('.close-btn').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    const createAllBtn = overlay.querySelector('#create-all-btn');
    if (createAllBtn) {
      createAllBtn.addEventListener('click', async () => {
        createAllBtn.disabled = true;
        createAllBtn.textContent = 'Creating...';
        try {
          const result = await apiFetch(`/api/map-layers/${layerId}/create-missing-assets`, { method: 'POST' });
          showToast(`Created ${result.created} asset(s), reactivated ${result.reactivated}`, 'success');
          overlay.remove();
          await loadLayers();
        } catch (err) {
          showToast('Failed: ' + err.message, 'error');
          createAllBtn.disabled = false;
          createAllBtn.textContent = `Create All Missing Assets (${creatableCount})`;
        }
      });
    }

    overlay.querySelectorAll('.create-one-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = '...';
        try {
          const result = await apiFetch(`/api/map-layers/${layerId}/create-missing-assets`, {
            method: 'POST',
            body: { featureIds: [btn.dataset.featureId] },
          });
          showToast(`Created ${result.total} asset(s)`, 'success');
          btn.textContent = 'Done';
          btn.style.background = '#27ae60';
        } catch (err) {
          showToast('Failed: ' + err.message, 'error');
          btn.disabled = false;
          btn.textContent = 'Create';
        }
      });
    });
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
            <div style="background:var(--gray-50);padding:16px;border-radius:8px">
              <div style="font-size:24px;font-weight:700;color:#27ae60">${result.created || 0}</div>
              <div style="font-size:12px;color:var(--gray-500)">Created</div>
            </div>
            <div style="background:var(--gray-50);padding:16px;border-radius:8px">
              <div style="font-size:24px;font-weight:700;color:#3498db">${result.updated || 0}</div>
              <div style="font-size:12px;color:var(--gray-500)">Updated</div>
            </div>
            <div style="background:var(--gray-50);padding:16px;border-radius:8px">
              <div style="font-size:24px;font-weight:700;color:#e67e22">${result.archived || 0}</div>
              <div style="font-size:12px;color:var(--gray-500)">Archived</div>
            </div>
            <div style="background:var(--gray-50);padding:16px;border-radius:8px">
              <div style="font-size:24px;font-weight:700;color:#95a5a6">${result.skippedMissingId || 0}</div>
              <div style="font-size:12px;color:var(--gray-500)">Skipped (no ID)</div>
            </div>
          </div>
          <p style="margin-top:16px;font-size:13px;color:var(--gray-500)">Total features processed: ${result.featureCount || result.total || 0}</p>
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
            <div id="ul-dropzone" style="border:2px dashed var(--gray-300);border-radius:8px;padding:40px;text-align:center;cursor:pointer;transition:border-color 0.2s">
              <div style="font-size:28px;margin-bottom:8px;color:var(--gray-400)">&#128193;</div>
              <div id="ul-droptext" style="color:var(--gray-500)">Drop a file here or click to browse</div>
              <div style="font-size:12px;color:var(--gray-400);margin-top:4px">Supports .kml, .geojson, .json — max 50 MB</div>
              <input type="file" id="ul-file" accept=".kml,.geojson,.json" style="display:none" />
            </div>
          </div>
          <div id="ul-preview" style="display:none;margin-top:12px">
            <div style="background:var(--gray-50);padding:12px;border-radius:8px;font-size:13px">
              <strong id="ul-filename"></strong>
              <span id="ul-format-badge" style="margin-left:8px"></span>
              <span id="ul-size" style="margin-left:8px;color:var(--gray-500)"></span>
            </div>
          </div>
          <div id="ul-validation-area"></div>
          <div id="ul-sync-preview-area"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary cancel-btn">Cancel</button>
          <button class="btn btn-secondary" id="ul-preview-sync-btn" style="display:none">Preview Sync</button>
          <button class="btn btn-primary upload-btn" disabled>Upload & Sync</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    let selectedFile = null;
    let parsedGeojson = null;
    let validationPassed = false;

    const layerKeySelect = overlay.querySelector('#ul-layerKey');
    const subLayerKeySelect = overlay.querySelector('#ul-subLayerKey');
    const validationArea = overlay.querySelector('#ul-validation-area');
    const syncPreviewArea = overlay.querySelector('#ul-sync-preview-area');
    const previewSyncBtn = overlay.querySelector('#ul-preview-sync-btn');
    const uploadBtn = overlay.querySelector('.upload-btn');

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
      runClientValidation();
    });

    subLayerKeySelect.addEventListener('change', () => runClientValidation());

    const dropzone = overlay.querySelector('#ul-dropzone');
    const fileInput = overlay.querySelector('#ul-file');

    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.style.borderColor = 'var(--teal)'; });
    dropzone.addEventListener('dragleave', () => { dropzone.style.borderColor = 'var(--gray-300)'; });
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.style.borderColor = 'var(--gray-300)';
      if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); });

    function handleFile(file) {
      selectedFile = file;
      const ext = file.name.split('.').pop().toLowerCase();
      const isKml = ext === 'kml';

      overlay.querySelector('#ul-preview').style.display = 'block';
      overlay.querySelector('#ul-filename').textContent = file.name;
      overlay.querySelector('#ul-format-badge').innerHTML = isKml
        ? '<span class="badge" style="background:#e67e22;color:#fff">KML</span>'
        : '<span class="badge" style="background:#27ae60;color:#fff">GeoJSON</span>';
      overlay.querySelector('#ul-size').textContent = formatSize(file.size);
      overlay.querySelector('#ul-droptext').textContent = file.name;

      if (!overlay.querySelector('#ul-name').value) {
        overlay.querySelector('#ul-name').value = file.name.replace(/\.[^.]+$/, '');
      }

      if (!isKml) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            parsedGeojson = JSON.parse(ev.target.result);
            runClientValidation();
          } catch {
            validationArea.innerHTML = `<div style="color:#e74c3c;margin-top:12px;font-size:13px">&#10008; Invalid JSON file</div>`;
            uploadBtn.disabled = true;
            validationPassed = false;
          }
        };
        reader.readAsText(file);
      } else {
        parsedGeojson = null;
        validationArea.innerHTML = `<div style="color:var(--gray-500);margin-top:12px;font-size:13px">KML files are validated server-side during upload.</div>`;
        validationPassed = true;
        uploadBtn.disabled = false;
        previewSyncBtn.style.display = 'none';
      }
    }

    function runClientValidation() {
      if (!parsedGeojson) return;
      const layerKey = layerKeySelect.value;
      const subLayerKey = subLayerKeySelect.value;
      if (!layerKey || !subLayerKey) {
        validationArea.innerHTML = '';
        syncPreviewArea.innerHTML = '';
        uploadBtn.disabled = true;
        previewSyncBtn.style.display = 'none';
        return;
      }

      const result = clientValidate(parsedGeojson, subLayerKey);
      validationArea.innerHTML = renderValidationPanel(result);

      if (result.valid) {
        validationPassed = true;
        uploadBtn.disabled = false;
        previewSyncBtn.style.display = 'inline-block';
      } else {
        validationPassed = false;
        uploadBtn.disabled = true;
        previewSyncBtn.style.display = 'none';
        syncPreviewArea.innerHTML = '';
      }
    }

    previewSyncBtn.addEventListener('click', async () => {
      if (!parsedGeojson) return;
      previewSyncBtn.disabled = true;
      previewSyncBtn.textContent = 'Loading...';
      try {
        const resp = await fetch('/api/map-layers/upload-validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            communityId,
            layerKey: layerKeySelect.value,
            subLayerKey: subLayerKeySelect.value,
            geojsonData: JSON.stringify(parsedGeojson),
          }),
        });
        if (resp.ok) {
          const preview = await resp.json();
          syncPreviewArea.innerHTML = `
            <div style="margin-top:12px;border:1px solid var(--gray-200);border-radius:8px;padding:16px">
              <div style="font-weight:600;margin-bottom:12px;color:var(--navy)">Sync Preview</div>
              <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;text-align:center">
                <div style="background:var(--gray-50);padding:10px;border-radius:6px">
                  <div style="font-size:20px;font-weight:700;color:#27ae60">${preview.wouldCreateCount || 0}</div>
                  <div style="font-size:11px;color:var(--gray-500)">Create</div>
                </div>
                <div style="background:var(--gray-50);padding:10px;border-radius:6px">
                  <div style="font-size:20px;font-weight:700;color:#3498db">${preview.wouldUpdateCount || 0}</div>
                  <div style="font-size:11px;color:var(--gray-500)">Update</div>
                </div>
                <div style="background:var(--gray-50);padding:10px;border-radius:6px">
                  <div style="font-size:20px;font-weight:700;color:#e67e22">${preview.wouldArchiveCount || 0}</div>
                  <div style="font-size:11px;color:var(--gray-500)">Archive</div>
                </div>
                <div style="background:var(--gray-50);padding:10px;border-radius:6px">
                  <div style="font-size:20px;font-weight:700;color:#95a5a6">${preview.wouldSkipCount || 0}</div>
                  <div style="font-size:11px;color:var(--gray-500)">Skip</div>
                </div>
              </div>
            </div>
          `;
        }
      } catch {}
      previewSyncBtn.disabled = false;
      previewSyncBtn.textContent = 'Preview Sync';
    });

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
        if (result.syncResult) {
          showSyncReport(result.syncResult);
        }
        await loadLayers();
      } catch (err) {
        showToast(err.message, 'error');
        uploadBtn.disabled = false;
        uploadBtn.textContent = 'Upload & Sync';
      }
    });
  }

  function clientValidate(geojson, subLayerKey) {
    const EXPECTED_GEOM = {
      backflow: ["Point"], controller: ["Point"], zone: ["Polygon", "MultiPolygon"],
      master_valve: ["Point"], flow_meter: ["Point"], qc_iso_valve: ["Point"],
      tree: ["Point"], pet_station: ["Point"],
      landscape_bed: ["Polygon", "MultiPolygon"], bluegrass_area: ["Polygon", "MultiPolygon"],
      native_area: ["Polygon", "MultiPolygon"], snow_area: ["Polygon", "MultiPolygon"],
    };

    const result = {
      featureCount: 0,
      geometryCounts: { points: 0, lines: 0, polygons: 0, other: 0 },
      missingIdCount: 0, missingIdSamples: [],
      duplicateIdCount: 0, duplicateIdSamples: [],
      invalidGeometryCount: 0, invalidGeometrySamples: [],
      warnings: [], errors: [], valid: true,
    };

    let features = [];
    if (geojson.type === 'FeatureCollection' && Array.isArray(geojson.features)) {
      features = geojson.features;
    } else if (geojson.type === 'Feature') {
      features = [geojson];
    } else {
      result.errors.push('Invalid GeoJSON type');
      result.valid = false;
      return result;
    }

    result.featureCount = features.length;
    const idCounts = {};
    const expectedTypes = EXPECTED_GEOM[subLayerKey] || null;

    for (let i = 0; i < features.length; i++) {
      const f = features[i];
      const fid = (f.id != null && String(f.id).trim()) ? String(f.id).trim()
        : (f.properties?.featureId && String(f.properties.featureId).trim()) ? String(f.properties.featureId).trim()
        : (f.properties?.id && String(f.properties.id).trim()) ? String(f.properties.id).trim()
        : null;

      if (!fid) {
        result.missingIdCount++;
        if (result.missingIdSamples.length < 10) result.missingIdSamples.push({ index: i, properties: {} });
      } else {
        idCounts[fid] = (idCounts[fid] || 0) + 1;
      }

      const geom = f.geometry;
      if (!geom || !geom.type) {
        result.invalidGeometryCount++;
        result.geometryCounts.other++;
      } else {
        if (geom.type === 'Point') result.geometryCounts.points++;
        else if (geom.type === 'LineString' || geom.type === 'MultiLineString') result.geometryCounts.lines++;
        else if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') result.geometryCounts.polygons++;
        else result.geometryCounts.other++;

        if (expectedTypes && !expectedTypes.includes(geom.type)) {
          if (result.warnings.length < 5) {
            result.warnings.push(`Feature ${fid || '#' + i}: geometry "${geom.type}" unexpected for ${subLayerKey}`);
          }
        }
      }
    }

    for (const [id, count] of Object.entries(idCounts)) {
      if (count > 1) {
        result.duplicateIdCount++;
        if (result.duplicateIdSamples.length < 10) result.duplicateIdSamples.push({ featureId: id, count });
      }
    }

    if (result.missingIdCount > 0) {
      result.errors.push(`${result.missingIdCount} feature(s) have no stable ID`);
      result.valid = false;
    }
    if (result.duplicateIdCount > 0) {
      result.errors.push(`${result.duplicateIdCount} duplicate feature ID(s) found`);
      result.valid = false;
    }

    return result;
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
          <div class="form-group">
            <label>Display Name</label>
            <input type="text" class="form-input" id="ml-name" value="${esc(layer?.displayName || '')}" />
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
            <label>Color</label>
            <div style="display:flex;gap:8px;align-items:center">
              <input type="color" id="ml-color-picker" value="${esc(layer?.color||'#25C1AC')}"
                     style="width:40px;height:32px;border:none;cursor:pointer;padding:0">
              <input type="text" class="form-input" id="ml-color-text"
                     value="${esc(layer?.color||'#25C1AC')}" maxlength="7"
                     style="font-family:monospace;width:100px">
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

    const colorPicker = overlay.querySelector('#ml-color-picker');
    const colorText = overlay.querySelector('#ml-color-text');
    colorPicker.addEventListener('input', () => { colorText.value = colorPicker.value; });
    colorText.addEventListener('input', () => {
      if (/^#[0-9A-Fa-f]{6}$/.test(colorText.value)) colorPicker.value = colorText.value;
    });

    const fileInput = overlay.querySelector('#ml-file');
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          overlay.querySelector('#ml-geojson').value = ev.target.result;
        };
        reader.readAsText(file);
      }
    });

    overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
    overlay.querySelector('.cancel-btn').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('.save-btn').addEventListener('click', async () => {
      const displayName = overlay.querySelector('#ml-name').value.trim();
      const layerKey = layerKeySelect.value;
      const subLayerKey = subLayerKeySelect.value;
      const geojsonRaw = overlay.querySelector('#ml-geojson').value.trim();

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

      const color = overlay.querySelector('#ml-color-text').value.trim();
      const body = { displayName, communityId, layerKey, subLayerKey };
      if (color && /^#[0-9A-Fa-f]{6}$/.test(color)) body.color = color;
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

  function showIrrigationUploadModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:520px">
        <div class="modal-header">
          <h2>Upload Irrigation Controllers &amp; Zones KML</h2>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <p style="color:var(--gray-500);font-size:13px;margin-bottom:16px">
            Upload a KML file with the standard Controller/Zones folder structure.
            This will automatically create both <strong>Controller</strong> and <strong>Zone</strong> layers,
            extract parent/child relationships, and parse controller colors from the KML styles.
          </p>
          <div class="form-group">
            <label>Display Name (optional)</label>
            <input type="text" class="form-input" id="irr-name" placeholder="e.g. Miramonte Controllers" />
          </div>
          <div class="form-group">
            <label>KML File</label>
            <div id="irr-dropzone" style="border:2px dashed var(--gray-300);border-radius:8px;padding:32px;text-align:center;cursor:pointer;transition:border-color 0.2s">
              <div style="font-size:28px;margin-bottom:8px;color:var(--gray-400)">🌊</div>
              <div id="irr-droptext" style="color:var(--gray-500)">Drop your irrigation KML file here or click to browse</div>
              <div style="font-size:12px;color:var(--gray-400);margin-top:4px">Supports .kml files with Controllers &amp; Zones structure</div>
              <input type="file" id="irr-file" accept=".kml" style="display:none" />
            </div>
          </div>
          <div id="irr-result" style="display:none"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary cancel-btn">Cancel</button>
          <button class="btn btn-primary upload-irr-btn" disabled>Upload &amp; Sync</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    let selectedFile = null;

    const dropzone = overlay.querySelector('#irr-dropzone');
    const fileInput = overlay.querySelector('#irr-file');
    const uploadBtn = overlay.querySelector('.upload-irr-btn');
    const resultArea = overlay.querySelector('#irr-result');

    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.style.borderColor = 'var(--teal)'; });
    dropzone.addEventListener('dragleave', () => { dropzone.style.borderColor = 'var(--gray-300)'; });
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.style.borderColor = 'var(--gray-300)';
      if (e.dataTransfer.files[0]) handleIrrFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleIrrFile(fileInput.files[0]); });

    function handleIrrFile(file) {
      if (!file.name.toLowerCase().endsWith('.kml')) {
        showToast('Only .kml files are supported', 'error');
        return;
      }
      selectedFile = file;
      overlay.querySelector('#irr-droptext').textContent = file.name + ' (' + formatBytes(file.size) + ')';
      uploadBtn.disabled = false;
    }

    uploadBtn.addEventListener('click', async () => {
      if (!selectedFile) return;
      uploadBtn.disabled = true;
      uploadBtn.textContent = 'Uploading...';

      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('communityId', communityId);
      const displayName = overlay.querySelector('#irr-name').value.trim();
      if (displayName) formData.append('displayName', displayName);

      try {
        const res = await fetch('/api/map-layers/upload-irrigation', {
          method: 'POST',
          body: formData,
          credentials: 'include',
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || 'Upload failed');

        let html = '<div style="background:var(--gray-50);padding:12px;border-radius:8px;margin-top:12px">';
        html += '<div style="font-weight:600;color:var(--navy);margin-bottom:8px">Import Complete</div>';
        html += '<div style="font-size:13px;display:grid;grid-template-columns:1fr 1fr;gap:4px 16px">';
        html += '<div>Controllers found:</div><div><strong>' + data.controllerCount + '</strong></div>';
        html += '<div>Zones found:</div><div><strong>' + data.zoneCount + '</strong></div>';
        html += '<div>Controllers created:</div><div><strong>' + data.syncResult.controllersCreated + '</strong></div>';
        html += '<div>Controllers updated:</div><div><strong>' + data.syncResult.controllersUpdated + '</strong></div>';
        html += '<div>Zones created:</div><div><strong>' + data.syncResult.zonesCreated + '</strong></div>';
        html += '<div>Zones updated:</div><div><strong>' + data.syncResult.zonesUpdated + '</strong></div>';
        html += '<div>Properties set:</div><div><strong>' + data.syncResult.propertiesSet + '</strong></div>';
        html += '</div>';

        if (data.warnings && data.warnings.length > 0) {
          html += '<div style="margin-top:12px;padding:8px;background:#fff3cd;border-radius:4px;font-size:12px">';
          html += '<div style="font-weight:600;color:#856404;margin-bottom:4px">Warnings:</div>';
          data.warnings.forEach(w => { html += '<div style="color:#856404">• ' + esc(w) + '</div>'; });
          html += '</div>';
        }

        html += '</div>';
        resultArea.innerHTML = html;
        resultArea.style.display = 'block';

        uploadBtn.textContent = 'Done';
        showToast('Irrigation data imported successfully', 'success');
        await loadLayers();
      } catch (err) {
        showToast(err.message, 'error');
        uploadBtn.disabled = false;
        uploadBtn.textContent = 'Upload & Sync';
      }
    });

    overlay.querySelector('.cancel-btn').addEventListener('click', () => overlay.remove());
    overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  }

  function esc(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }
};
