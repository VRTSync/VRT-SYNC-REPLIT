PortalRouter.register('map', async function (container) {
  const { apiFetch, showToast } = PortalAPI;
  const { esc, ICONS, fmtDate } = PortalModules;
  const ctx = PortalState.getCommunityContext();
  const community = PortalState.getActiveCommunity();
  const role = ctx.role;

  if (!community) {
    container.innerHTML = '<div class="empty-state" style="margin-top:60px"><p>Select a community to view the map.</p></div>';
    return;
  }

  const LAYER_HIERARCHY = {
    community: [
      { key: 'bluegrass_area', label: 'Bluegrass', color: '#2E8B57' },
      { key: 'native_area', label: 'Native Area', color: '#8F9779' },
      { key: 'landscape_bed', label: 'Landscape Bed', color: '#8B5A2B' },
      { key: 'pet_station', label: 'Pet Station', color: '#1ABC9C' },
    ],
    irrigation: [
      { key: 'backflow', label: 'Backflow', color: '#00BFFF' },
      { key: 'controller', label: 'Controller', color: '#25C1AC' },
      { key: 'zone', label: 'Zone', color: '#3498db' },
      { key: 'master_valve', label: 'Master Valve', color: '#1F4E79' },
      { key: 'flow_meter', label: 'Flow Meter', color: '#00CED1' },
      { key: 'qc_iso_valve', label: 'QC/ISO Valve', color: '#87CEEB' },
    ],
    snow: [
      { key: 'plow', label: 'Plow', color: '#4A90E2' },
      { key: 'atv', label: 'ATV', color: '#6A5ACD' },
      { key: 'hand_shovel', label: 'Hand Shovel', color: '#E83E8C' },
      { key: 'ice_melt', label: 'Ice Melt', color: '#FF8C00' },
      { key: 'slicer', label: 'Slicer', color: '#D62828' },
      { key: 'storage_area', label: 'Storage Area', color: '#708090' },
    ],
    trees: [
      { key: 'tree', label: 'Trees', color: '#006400' },
    ],
  };

  const CATEGORY_ICONS = {
    community: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
    irrigation: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0z"/></svg>',
    snow: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="2" x2="12" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/><line x1="19.07" y1="4.93" x2="4.93" y2="19.07"/></svg>',
    trees: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L7 10h2l-3 6h3l-2 6h10l-2-6h3l-3-6h2z"/></svg>',
  };

  let activeCategory = 'community';
  let sublayerState = {};
  let selectedAsset = null;
  let detailTab = 'details';
  let mapLayers = [];
  let iframeReady = false;
  let pendingCmds = [];
  let renderGeneration = 0;

  if (window._portalMapCleanup) {
    window._portalMapCleanup();
  }

  Object.keys(LAYER_HIERARCHY).forEach(cat => {
    sublayerState[cat] = {};
    LAYER_HIERARCHY[cat].forEach(sub => {
      sublayerState[cat][sub.key] = cat === 'community';
    });
  });

  container.innerHTML = `
    <div class="map-workspace">
      <div class="map-layers-panel" id="map-layers-panel">
        <div class="mlp-header">
          <span class="mlp-title">Layers</span>
        </div>
        <div class="mlp-categories" id="mlp-categories"></div>
        <div class="mlp-sublayers" id="mlp-sublayers"></div>
      </div>
      <div class="map-canvas-wrap">
        <iframe id="map-iframe" src="/leaflet-map.html" class="map-iframe" allowfullscreen></iframe>
      </div>
      <div class="map-detail-panel" id="map-detail-panel">
        <div class="mdp-empty" id="mdp-empty">
          <div style="color:var(--gray-300);margin-bottom:12px">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </div>
          <p style="font-size:13px;color:var(--gray-400);margin:0">Select a map item to view details</p>
        </div>
        <div class="mdp-content" id="mdp-content" style="display:none"></div>
      </div>
    </div>
  `;

  renderCategories();
  renderSublayers();
  setupIframe();
  loadMapData();

  function renderCategories() {
    const el = document.getElementById('mlp-categories');
    if (!el) return;
    el.innerHTML = Object.keys(LAYER_HIERARCHY).map(cat => {
      const active = cat === activeCategory ? ' mlp-cat--active' : '';
      const label = cat.charAt(0).toUpperCase() + cat.slice(1);
      return `<button class="mlp-cat-btn${active}" data-cat="${cat}">${CATEGORY_ICONS[cat] || ''}<span>${esc(label)}</span></button>`;
    }).join('');
    el.querySelectorAll('.mlp-cat-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        activeCategory = btn.dataset.cat;
        renderCategories();
        renderSublayers();
        syncVisibleLayers();
      });
    });
  }

  function renderSublayers() {
    const el = document.getElementById('mlp-sublayers');
    if (!el) return;
    const subs = LAYER_HIERARCHY[activeCategory] || [];
    el.innerHTML = subs.map(sub => {
      const checked = sublayerState[activeCategory][sub.key] ? 'checked' : '';
      const apiLayer = mapLayers.find(l => l.subLayerKey === sub.key && l.layerKey === activeCategory);
      const dotColor = (apiLayer && apiLayer.color) ? apiLayer.color : sub.color;
      return `
        <label class="mlp-sublayer-row">
          <input type="checkbox" ${checked} data-cat="${activeCategory}" data-key="${sub.key}">
          <span class="mlp-sub-dot" style="background:${dotColor}"></span>
          <span class="mlp-sub-label">${esc(sub.label)}</span>
        </label>
      `;
    }).join('');
    el.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        sublayerState[cb.dataset.cat][cb.dataset.key] = cb.checked;
        syncVisibleLayers();
      });
    });
  }

  function setupIframe() {
    const iframe = document.getElementById('map-iframe');
    if (!iframe) return;

    function handler(e) {
      if (!e.data || typeof e.data !== 'string') return;
      try {
        var msg = JSON.parse(e.data);
      } catch (_) { return; }
      if (msg.type === 'mapReady') {
        iframeReady = true;
        var cmds = pendingCmds.slice();
        pendingCmds = [];
        cmds.forEach(function(c) {
          var iframe = document.getElementById('map-iframe');
          if (iframe && iframe.contentWindow) {
            iframe.contentWindow.postMessage({ type: 'cmd', fn: c.fn, args: c.args }, '*');
          }
        });
        loadCommunity(community.id);
      } else if (msg.type === 'viewAssetDetail') {
        handleAssetDetail(msg.data);
      }
    }

    window.addEventListener('message', handler);
    window._portalMapCleanup = function () {
      window.removeEventListener('message', handler);
      window._portalMapCleanup = null;
    };
  }

  function cmdToIframe(fn) {
    var args = Array.prototype.slice.call(arguments, 1);
    var iframe = document.getElementById('map-iframe');
    if (!iframe || !iframe.contentWindow) return;
    if (!iframeReady) {
      pendingCmds.push({ fn: fn, args: args });
      return;
    }
    iframe.contentWindow.postMessage({ type: 'cmd', fn: fn, args: args }, '*');
  }

  async function loadCommunity(communityId) {
    selectedAsset = null;
    renderDetailPanel();
    activeCategory = 'community';
    Object.keys(LAYER_HIERARCHY).forEach(cat => {
      sublayerState[cat] = {};
      LAYER_HIERARCHY[cat].forEach(sub => {
        sublayerState[cat][sub.key] = cat === 'community';
      });
    });
    renderCategories();
    renderSublayers();

    cmdToIframe('clearIrrigation');

    try {
      const bounds = await apiFetch(`/api/communities/${communityId}/bounds`);
      if (bounds && bounds.coordinates && bounds.coordinates.length > 0) {
        cmdToIframe('fitBounds', bounds.coordinates);
      }
    } catch (err) {
      console.error('Failed to load community bounds:', err);
    }
  }

  async function loadMapData() {
    try {
      const layers = await apiFetch(`/api/map-layers?communityId=${community.id}`);
      mapLayers = layers || [];
      for (const layer of mapLayers) {
        try {
          const geojson = await apiFetch(`/api/map-layers/${layer.id}/geojson`);
          if (geojson) {
            layer._geojson = geojson;
          }
        } catch (_) {}
      }
      pushLayersToIframe();
      syncVisibleLayers();
      loadCommunityOutline();
    } catch (err) {
      console.error('Failed to load map layers:', err);
    }
  }

  function loadCommunityOutline() {
    const outlineLayer = mapLayers.find(l => l.layerKey === 'outline' && l._geojson);
    if (outlineLayer) {
      cmdToIframe('setCommunityOutline', outlineLayer._geojson);
    } else {
      cmdToIframe('setCommunityOutline', null);
    }
  }

  function pushLayersToIframe() {
    const layerData = mapLayers.filter(l => l._geojson && l.layerKey !== 'outline').map(l => ({
      id: l.id,
      layerKey: l.layerKey,
      subLayerKey: l.subLayerKey,
      displayName: l.displayName,
      color: l.color || '#25C1AC',
      geojson: l._geojson,
      controllerColorMap: l.controllerColorMap || {},
    }));
    if (layerData.length > 0) {
      cmdToIframe('addLayers', layerData);
    }
  }

  function syncVisibleLayers() {
    const visibleIds = [];
    mapLayers.forEach(layer => {
      const cat = layer.layerKey;
      const sub = layer.subLayerKey;
      if (cat === activeCategory && sublayerState[cat] && sublayerState[cat][sub]) {
        visibleIds.push(layer.id);
      }
    });
    cmdToIframe('showLayerIds', visibleIds);

    const showControllers = activeCategory === 'irrigation' && sublayerState.irrigation && sublayerState.irrigation.controller;
    const showZones = activeCategory === 'irrigation' && sublayerState.irrigation && sublayerState.irrigation.zone;
    cmdToIframe('showControllers', !!showControllers);
    cmdToIframe('showZones', !!showZones);
    cmdToIframe('fitToContent');
  }

  async function handleAssetDetail(data) {
    if (!data || !data.featureRef) return;
    try {
      const asset = await apiFetch(`/api/assets/by-feature?communityId=${community.id}&featureRef=${encodeURIComponent(data.featureRef)}`);
      if (asset) {
        selectedAsset = asset;
        selectedAsset._label = data.label || asset.label || asset.displayName || '';
        selectedAsset._assetType = data.assetType || asset.assetType || '';
        selectedAsset._layerName = data.layerName || '';
        detailTab = 'details';
        renderDetailPanel();
        const lat = asset.latitude;
        const lng = asset.longitude;
        if (lat != null && lng != null) {
          const flyLabel = selectedAsset._label || '';
          cmdToIframe('flyTo', lat, lng, 16, flyLabel);
        }
      } else {
        selectedAsset = {
          _label: data.label || data.featureRef,
          _assetType: data.assetType || '',
          _layerName: data.layerName || '',
          featureRef: data.featureRef,
          _notFound: true,
        };
        detailTab = 'details';
        renderDetailPanel();
      }
    } catch (err) {
      console.error('Failed to fetch asset detail:', err);
    }
  }

  function renderDetailPanel() {
    const emptyEl = document.getElementById('mdp-empty');
    const contentEl = document.getElementById('mdp-content');
    if (!emptyEl || !contentEl) return;

    if (!selectedAsset) {
      emptyEl.style.display = '';
      contentEl.style.display = 'none';
      return;
    }

    emptyEl.style.display = 'none';
    contentEl.style.display = '';

    const asset = selectedAsset;
    const label = asset._label || asset.label || asset.displayName || asset.featureRef || 'Asset';
    const assetType = asset._assetType || asset.assetType || '';
    const typeLabel = assetType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    const tabs = ['details', 'history', 'notes', 'photos'];
    const tabLabels = { details: 'Details', history: 'Work History', notes: 'Contractor Notes', photos: 'Photos' };

    let html = `
      <div class="mdp-header">
        <button class="mdp-close" id="mdp-close-btn">&times;</button>
        <div class="mdp-type-badge">${esc(typeLabel)}</div>
        <h3 class="mdp-title">${esc(label)}</h3>
        ${asset._layerName ? `<div class="mdp-subtitle">${esc(asset._layerName)}</div>` : ''}
      </div>
      <div class="mdp-tabs">
        ${tabs.map(t => `<button class="mdp-tab${detailTab === t ? ' mdp-tab--active' : ''}" data-tab="${t}">${tabLabels[t]}</button>`).join('')}
      </div>
      <div class="mdp-tab-body" id="mdp-tab-body"></div>
    `;

    contentEl.innerHTML = html;

    contentEl.querySelector('#mdp-close-btn').addEventListener('click', () => {
      selectedAsset = null;
      renderDetailPanel();
    });

    contentEl.querySelectorAll('.mdp-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        detailTab = btn.dataset.tab;
        renderDetailPanel();
      });
    });

    renderTabContent();
  }

  function renderTabContent() {
    const body = document.getElementById('mdp-tab-body');
    if (!body) return;
    const asset = selectedAsset;

    if (asset._notFound) {
      body.innerHTML = `<div class="mdp-empty-tab"><p>No asset record found for this map feature.</p><p style="font-size:12px;color:var(--gray-400);margin-top:4px">Feature ref: ${esc(asset.featureRef)}</p></div>`;
      return;
    }

    if (detailTab === 'details') {
      renderDetailsTab(body, asset);
    } else if (detailTab === 'history') {
      renderHistoryTab(body, asset);
    } else if (detailTab === 'notes') {
      renderNotesTab(body, asset);
    } else if (detailTab === 'photos') {
      renderPhotosTab(body, asset);
    }
  }

  const TYPE_FIELD_DEFS = {
    tree: [
      { key: 'species', label: 'Species' },
      { key: 'common_name', label: 'Common Name' },
      { key: 'dbh', label: 'DBH (inches)' },
      { key: 'height', label: 'Height' },
      { key: 'canopy_spread', label: 'Canopy Spread' },
      { key: 'condition', label: 'Condition' },
      { key: 'health_rating', label: 'Health Rating' },
      { key: 'notes', label: 'Notes' },
    ],
    controller: [
      { key: 'controller_key', label: 'Controller Key' },
      { key: 'make', label: 'Make' },
      { key: 'model', label: 'Model' },
      { key: 'serial_number', label: 'Serial Number' },
      { key: 'zone_count', label: 'Zone Count' },
      { key: 'install_date', label: 'Install Date' },
      { key: 'location_description', label: 'Location' },
      { key: 'notes', label: 'Notes' },
    ],
    zone: [
      { key: 'zone_number', label: 'Zone Number' },
      { key: 'controller_key', label: 'Controller' },
      { key: 'head_type', label: 'Head Type' },
      { key: 'head_count', label: 'Head Count' },
      { key: 'precipitation_rate', label: 'Precip. Rate' },
      { key: 'area_sqft', label: 'Area (sq ft)' },
      { key: 'plant_type', label: 'Plant Type' },
      { key: 'notes', label: 'Notes' },
    ],
    backflow: [
      { key: 'device_type', label: 'Device Type' },
      { key: 'make', label: 'Make' },
      { key: 'model', label: 'Model' },
      { key: 'serial_number', label: 'Serial Number' },
      { key: 'size', label: 'Size' },
      { key: 'install_date', label: 'Install Date' },
      { key: 'last_test_date', label: 'Last Test Date' },
      { key: 'test_result', label: 'Test Result' },
      { key: 'location_description', label: 'Location' },
      { key: 'notes', label: 'Notes' },
    ],
    bluegrass_area: [
      { key: 'area_sqft', label: 'Area (sq ft)' },
      { key: 'turf_type', label: 'Turf Type' },
      { key: 'condition', label: 'Condition' },
      { key: 'notes', label: 'Notes' },
    ],
    native_area: [
      { key: 'area_sqft', label: 'Area (sq ft)' },
      { key: 'vegetation_type', label: 'Vegetation Type' },
      { key: 'condition', label: 'Condition' },
      { key: 'notes', label: 'Notes' },
    ],
    landscape_bed: [
      { key: 'area_sqft', label: 'Area (sq ft)' },
      { key: 'bed_type', label: 'Bed Type' },
      { key: 'mulch_type', label: 'Mulch Type' },
      { key: 'condition', label: 'Condition' },
      { key: 'notes', label: 'Notes' },
    ],
    pet_station: [
      { key: 'station_type', label: 'Station Type' },
      { key: 'condition', label: 'Condition' },
      { key: 'location_description', label: 'Location' },
      { key: 'notes', label: 'Notes' },
    ],
  };

  const IRRIGATION_RUNTIME_KEYS = new Set([
    'runtime_minutes', 'last_run', 'last_run_date', 'last_run_time',
    'flow_rate', 'flow_gpm', 'current_flow', 'water_usage',
    'moisture_level', 'pressure_psi', 'voltage', 'current_ma',
    'signal_strength', 'battery_level', 'firmware_version',
    'last_communication', 'online_status', 'fault_code',
  ]);

  const IRRIGATION_TYPES = new Set(['controller', 'zone', 'backflow', 'master_valve', 'flow_meter', 'qc_iso_valve']);

  function renderDetailsTab(body, asset) {
    const assetType = asset.assetType || asset._assetType || '';
    const isIrrigation = IRRIGATION_TYPES.has(assetType);
    const typeDef = TYPE_FIELD_DEFS[assetType];

    const propsMap = {};
    if (asset.properties && typeof asset.properties === 'object') {
      const props = Array.isArray(asset.properties) ? asset.properties : Object.entries(asset.properties).map(([k, v]) => ({ key: k, value: v }));
      props.forEach(p => {
        const k = p.key || p.propertyKey;
        const v = p.value || p.propertyValue;
        if (k != null) propsMap[k] = v;
      });
    }

    const fields = [];

    fields.push(['Type', assetType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())]);
    if (asset.featureRef) fields.push(['Feature Ref', asset.featureRef]);
    if (asset.status) fields.push(['Status', asset.status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())]);
    if (asset.label) fields.push(['Label', asset.label]);
    if (asset.displayName && asset.displayName !== asset.label) fields.push(['Display Name', asset.displayName]);

    if (typeDef) {
      typeDef.forEach(fd => {
        const v = propsMap[fd.key];
        if (v != null && v !== '') {
          fields.push([fd.label, String(v)]);
        }
        delete propsMap[fd.key];
      });
    }

    Object.entries(propsMap).forEach(([k, v]) => {
      if (v == null || v === '') return;
      if (isIrrigation && IRRIGATION_RUNTIME_KEYS.has(k)) return;
      fields.push([k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), String(v)]);
    });

    if (asset.createdAt) fields.push(['Created', new Date(asset.createdAt).toLocaleDateString()]);
    if (asset.createdByName) fields.push(['Created By', asset.createdByName]);
    if (asset.updatedAt) fields.push(['Updated', new Date(asset.updatedAt).toLocaleDateString()]);
    if (asset.updatedByName) fields.push(['Updated By', asset.updatedByName]);

    if (fields.length === 0) {
      body.innerHTML = '<div class="mdp-empty-tab">No details available for this asset.</div>';
      return;
    }

    body.innerHTML = `
      <div class="mdp-fields">
        ${fields.map(([label, value]) => `
          <div class="mdp-field">
            <span class="mdp-field-label">${esc(label)}</span>
            <span class="mdp-field-value">${esc(value)}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  async function renderHistoryTab(body, asset) {
    const gen = ++renderGeneration;
    body.innerHTML = '<div class="mdp-loading">Loading work history...</div>';
    try {
      const history = await apiFetch(`/api/assets/${asset.id}/history`);
      if (gen !== renderGeneration) return;
      if (!history || history.length === 0) {
        body.innerHTML = '<div class="mdp-empty-tab">No work history found for this asset.</div>';
        return;
      }
      const isContractor = role === 'contractor';
      body.innerHTML = `
        <div class="mdp-history-list">
          ${history.map(item => {
            let html = `<div class="mdp-history-item">`;
            html += `<div class="mdp-hist-title">${esc(item.title || item.taskTitle || 'Task')}</div>`;
            html += `<div class="mdp-hist-meta">`;
            if (item.status) html += `<span class="mdp-hist-status">${esc(item.status.replace(/_/g, ' '))}</span>`;
            if (item.completedAt || item.windowEnd) html += `<span class="mdp-hist-date">${new Date(item.completedAt || item.windowEnd).toLocaleDateString()}</span>`;
            html += `</div>`;
            if (!isContractor && item.invoiceAmount != null) {
              html += `<div class="mdp-hist-amount">$${Number(item.invoiceAmount).toFixed(2)}</div>`;
            }
            html += `</div>`;
            return html;
          }).join('')}
        </div>
      `;
    } catch (err) {
      body.innerHTML = '<div class="mdp-empty-tab">Failed to load work history.</div>';
    }
  }

  function renderNotesTab(body, asset) {
    loadNotesTab(body, asset);
  }

  async function loadNotesTab(body, asset) {
    const gen = ++renderGeneration;
    body.innerHTML = '<div class="mdp-loading">Loading notes...</div>';
    try {
      const notes = await apiFetch(`/api/assets/${asset.id}/notes`);
      if (gen !== renderGeneration) return;
      if (!notes || notes.length === 0) {
        body.innerHTML = '<div class="mdp-empty-tab">No contractor notes for this asset.</div>';
        return;
      }
      body.innerHTML = `
        <div class="mdp-notes-list">
          ${notes.map(note => `
            <div class="mdp-note-item">
              <div class="mdp-note-meta">
                <span class="mdp-note-author">${esc(note.authorName || note.author || 'Unknown')}</span>
                <span class="mdp-note-date">${note.createdAt ? new Date(note.createdAt).toLocaleDateString() : ''}</span>
              </div>
              <div class="mdp-note-text">${esc(note.content || note.text || note.note || '')}</div>
            </div>
          `).join('')}
        </div>
      `;
    } catch (err) {
      body.innerHTML = '<div class="mdp-empty-tab">No contractor notes for this asset.</div>';
    }
  }

  function renderPhotosTab(body, asset) {
    body.innerHTML = `
      <div class="mdp-empty-tab">
        <div style="color:var(--gray-300);margin-bottom:8px">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
        </div>
        <p>No photos available for this asset.</p>
      </div>
    `;
  }
});
