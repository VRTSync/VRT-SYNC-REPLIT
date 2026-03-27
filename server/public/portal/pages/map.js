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
  let controllerData = [];
  let activeColorPicker = null;
  let sessionColorOverrides = {};
  let _outlineGeojson = null;
  let _outlineStyle = null;
  let _showCommunityOutline = true;

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

  document.addEventListener('click', dismissColorPicker, true);

  function dismissColorPicker(e) {
    if (!activeColorPicker) return;
    if (!e.target.closest('.mlp-color-swatch-btn') && !e.target.closest('.mlp-color-picker-wrap')) {
      closeColorPicker();
    }
  }

  function closeColorPicker() {
    if (activeColorPicker) {
      activeColorPicker.remove();
      activeColorPicker = null;
    }
  }

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
        syncVisibleLayers(true);
      });
    });
  }

  function getLayerEffectiveColor(cat, subKey) {
    const apiLayer = mapLayers.find(l => l.subLayerKey === subKey && l.layerKey === cat);
    if (apiLayer && apiLayer.color) return apiLayer.color;
    const def = (LAYER_HIERARCHY[cat] || []).find(s => s.key === subKey);
    return def ? def.color : '#888888';
  }

  function renderSublayers() {
    const el = document.getElementById('mlp-sublayers');
    if (!el) return;
    const subs = LAYER_HIERARCHY[activeCategory] || [];
    const isAdmin = role === 'admin';

    const outlineColor = (_outlineStyle && _outlineStyle.strokeColor) || '#0C1D31';
    const outlineRow = _outlineGeojson ? `
      <label class="mlp-sublayer-row" style="border-bottom:1px solid #eef1f5;margin-bottom:6px;padding-bottom:6px">
        <input type="checkbox" id="mlp-outline-toggle" ${_showCommunityOutline ? 'checked' : ''}>
        <span class="mlp-sub-dot" style="background:${outlineColor};border-radius:2px"></span>
        <span class="mlp-sub-label">Community Outline</span>
      </label>
    ` : '';

    el.innerHTML = outlineRow + subs.map(sub => {
      const checked = sublayerState[activeCategory][sub.key] ? 'checked' : '';
      const dotColor = getLayerEffectiveColor(activeCategory, sub.key);
      const swatchBtn = isAdmin
        ? `<button class="mlp-color-swatch-btn" data-cat="${activeCategory}" data-key="${sub.key}" style="background:${dotColor}" title="Change color" aria-label="Change color for ${esc(sub.label)}"></button>`
        : `<span class="mlp-sub-dot" style="background:${dotColor}"></span>`;
      return `
        <label class="mlp-sublayer-row">
          <input type="checkbox" ${checked} data-cat="${activeCategory}" data-key="${sub.key}">
          ${swatchBtn}
          <span class="mlp-sub-label">${esc(sub.label)}</span>
        </label>
      `;
    }).join('');

    const outlineToggle = document.getElementById('mlp-outline-toggle');
    if (outlineToggle) {
      outlineToggle.addEventListener('change', () => {
        _showCommunityOutline = outlineToggle.checked;
        cmdToIframe('setCommunityOutline', _showCommunityOutline ? _outlineGeojson : null, _outlineStyle);
      });
    }

    el.querySelectorAll('input[type="checkbox"]:not(#mlp-outline-toggle)').forEach(cb => {
      cb.addEventListener('change', () => {
        sublayerState[cb.dataset.cat][cb.dataset.key] = cb.checked;
        syncVisibleLayers();
      });
    });
    if (isAdmin) {
      el.querySelectorAll('.mlp-color-swatch-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          openColorPicker(btn, btn.dataset.cat, btn.dataset.key);
        });
      });
    }
  }

  function openColorPicker(swatchBtn, cat, subKey) {
    closeColorPicker();
    const currentColor = getLayerEffectiveColor(cat, subKey);
    const wrap = document.createElement('div');
    wrap.className = 'mlp-color-picker-wrap';
    wrap.innerHTML = `<input type="color" class="mlp-color-input" value="${currentColor}">`;
    document.body.appendChild(wrap);

    const rect = swatchBtn.getBoundingClientRect();
    wrap.style.position = 'fixed';
    wrap.style.left = (rect.right + 6) + 'px';
    wrap.style.top = rect.top + 'px';
    wrap.style.zIndex = '9999';

    const input = wrap.querySelector('.mlp-color-input');
    input.focus();
    input.click();
    activeColorPicker = wrap;

    input.addEventListener('input', () => {
      const newColor = input.value;
      swatchBtn.style.background = newColor;
      applyLayerColorLive(cat, subKey, newColor);
    });

    input.addEventListener('change', () => {
      const newColor = input.value;
      swatchBtn.style.background = newColor;
      applyLayerColorLive(cat, subKey, newColor);
      persistLayerColor(cat, subKey, newColor);
      closeColorPicker();
    });
  }

  function buildZoneColorMap(uniformColor) {
    const colorMap = {};
    for (const ctrl of controllerData) {
      if (ctrl.featureRef) {
        colorMap[ctrl.featureRef] = uniformColor;
      }
    }
    return colorMap;
  }

  function applyLayerColorLive(cat, subKey, newColor) {
    if (cat === 'irrigation' && (subKey === 'controller' || subKey === 'zone')) {
      setSessionColorOverride(cat, subKey, newColor);
      const ctrlOverride = getSessionColorOverride('irrigation', 'controller');
      const zoneOverride = getSessionColorOverride('irrigation', 'zone');
      sendIrrigationMarkers(ctrlOverride, zoneOverride);
      const ctrlLayer = mapLayers.find(l => l.layerKey === 'irrigation' && l.subLayerKey === 'controller');
      const zoneLayer = mapLayers.find(l => l.layerKey === 'irrigation' && l.subLayerKey === 'zone');
      if (subKey === 'controller') {
        const updatedColorMap = buildControllerColorMap(ctrlOverride);
        if (ctrlLayer) {
          cmdToIframe('updateLayerColorMap', ctrlLayer.id, updatedColorMap, ctrlOverride || getLayerEffectiveColor('irrigation', 'controller'));
        }
        if (zoneLayer) {
          const effectiveZone = zoneOverride || getLayerEffectiveColor('irrigation', 'zone');
          const zoneGeoMap = zoneOverride
            ? buildZoneColorMap(effectiveZone)
            : updatedColorMap;
          cmdToIframe('updateLayerColorMap', zoneLayer.id, zoneGeoMap, effectiveZone);
        }
      } else {
        if (zoneLayer) {
          const zoneColorMap = buildZoneColorMap(newColor);
          cmdToIframe('updateLayerColorMap', zoneLayer.id, zoneColorMap, newColor);
        }
      }
      return;
    }
    const apiLayer = mapLayers.find(l => l.subLayerKey === subKey && l.layerKey === cat);
    if (!apiLayer) return;
    cmdToIframe('updateLayerColor', apiLayer.id, newColor);
  }

  function sendIrrigationMarkers(ctrlColorOverride, zoneColorOverride) {
    const fallbackCtrlColor = getLayerEffectiveColor('irrigation', 'controller');

    const ctrlMarkers = controllerData
      .filter(c => c.latitude != null && c.longitude != null)
      .map(c => {
        const perCtrlColor = ctrlColorOverride !== null
          ? ctrlColorOverride
          : (c.controllerColor || fallbackCtrlColor);
        return {
          id: c.id,
          label: c.label || c.controllerKey || 'Controller',
          featureRef: c.featureRef,
          controllerKey: c.controllerKey || '',
          color: perCtrlColor,
          latitude: c.latitude,
          longitude: c.longitude,
          zoneCount: c.zoneCount || (c.zones ? c.zones.length : 0),
        };
      });

    const fallbackZoneColor = getLayerEffectiveColor('irrigation', 'zone');
    const zoneMarkers = controllerData.flatMap(c => {
      const perCtrlColor = ctrlColorOverride !== null
        ? ctrlColorOverride
        : (c.controllerColor || fallbackCtrlColor);
      const zColor = zoneColorOverride !== null ? zoneColorOverride : perCtrlColor;
      return (c.zones || [])
        .filter(z => z.latitude != null && z.longitude != null)
        .map(z => ({
          id: z.id,
          label: z.label || z.zoneLabelShort || `Zone ${z.zoneNumber || ''}`,
          featureRef: z.featureRef,
          zoneNumber: z.zoneNumber,
          controllerColor: zColor,
          controllerLabel: c.label || c.controllerKey || 'Controller',
          latitude: z.latitude,
          longitude: z.longitude,
        }));
    });

    if (ctrlMarkers.length > 0) {
      cmdToIframe('setControllerMarkers', ctrlMarkers);
    }
    if (zoneMarkers.length > 0) {
      cmdToIframe('setZoneMarkers', zoneMarkers);
    }
  }

  async function persistLayerColor(cat, subKey, newColor) {
    const apiLayer = mapLayers.find(l => l.subLayerKey === subKey && l.layerKey === cat);
    if (apiLayer) {
      try {
        const updated = await apiFetch(`/api/map-layers/${apiLayer.id}`, {
          method: 'PATCH',
          body: { color: newColor, version: apiLayer.version },
        });
        if (updated && updated.id) {
          const idx = mapLayers.findIndex(l => l.id === apiLayer.id);
          if (idx !== -1) {
            mapLayers[idx] = { ...mapLayers[idx], color: newColor, version: updated.version };
          }
        }
      } catch (err) {
        console.error('Failed to save layer color:', err);
      }
    }

    if (cat === 'irrigation' && subKey === 'controller' && controllerData.length > 0) {
      const updates = controllerData
        .filter(c => c.id)
        .map(c => apiFetch(`/api/assets/${c.id}/properties`, {
          method: 'PUT',
          body: { properties: [{ key: 'controllerColor', value: newColor }] },
        }).then(result => {
          const idx = controllerData.findIndex(cd => cd.id === c.id);
          if (idx !== -1) controllerData[idx] = { ...controllerData[idx], controllerColor: newColor };
          return result;
        }).catch(err => console.error('Failed to update controller color for', c.id, err)));
      await Promise.allSettled(updates);
    }

    if (cat === 'irrigation' && subKey === 'zone') {
      const allZones = controllerData.flatMap(c => c.zones || []).filter(z => z.id);
      const updates = allZones.map(z => apiFetch(`/api/assets/${z.id}/properties`, {
        method: 'PUT',
        body: { properties: [{ key: 'zoneColor', value: newColor }] },
      }).then(() => {
        for (const ctrl of controllerData) {
          const zi = (ctrl.zones || []).findIndex(zz => zz.id === z.id);
          if (zi !== -1) ctrl.zones[zi] = { ...ctrl.zones[zi], zoneColor: newColor };
        }
      }).catch(err => console.error('Failed to update zone color for', z.id, err)));
      await Promise.allSettled(updates);
    }
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
      document.removeEventListener('click', dismissColorPicker, true);
      closeColorPicker();
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
      if (bounds && bounds.bounds && bounds.bounds.length > 0) {
        cmdToIframe('fitBounds', bounds.bounds);
      }
    } catch (err) {
      console.error('Failed to load community bounds:', err);
    }
  }

  async function loadMapData() {
    try {
      const [layers, controllers] = await Promise.all([
        apiFetch(`/api/map-layers?communityId=${community.id}`),
        apiFetch(`/api/communities/${community.id}/controllers`).catch(() => []),
      ]);
      mapLayers = layers || [];
      controllerData = controllers || [];

      for (const layer of mapLayers) {
        try {
          const geojson = await apiFetch(`/api/map-layers/${layer.id}/geojson`);
          if (geojson) {
            layer._geojson = geojson;
          }
        } catch (_) {}
      }
      pushLayersToIframe();
      pushIrrigationToIframe();
      syncVisibleLayers();
      loadCommunityOutline();
      renderSublayers();
    } catch (err) {
      console.error('Failed to load map layers:', err);
    }
  }

  function buildOutlineStyle(layer) {
    if (!layer) return null;
    const s = {};
    if (layer.strokeColor) s.strokeColor = layer.strokeColor;
    if (layer.strokeWeight) s.strokeWeight = layer.strokeWeight;
    if (layer.fillOpacity != null) {
      const fo = parseFloat(layer.fillOpacity);
      if (!isNaN(fo) && fo >= 0 && fo <= 1) s.fillOpacity = fo;
    }
    return Object.keys(s).length ? s : null;
  }

  function loadCommunityOutline() {
    const outlineLayer = mapLayers.find(l => l.layerKey === 'outline' && l._geojson && l.isEnabled !== false);
    if (outlineLayer) {
      _outlineGeojson = outlineLayer._geojson;
      _outlineStyle = buildOutlineStyle(outlineLayer);
      if (_showCommunityOutline) {
        cmdToIframe('setCommunityOutline', _outlineGeojson, _outlineStyle);
      }
      cmdToIframe('fitToOutline');
    } else {
      _outlineGeojson = null;
      _outlineStyle = null;
      cmdToIframe('setCommunityOutline', null);
    }
    renderSublayers();
  }

  function getSessionColorOverride(cat, subKey) {
    return sessionColorOverrides[cat + '/' + subKey] || null;
  }

  function setSessionColorOverride(cat, subKey, color) {
    sessionColorOverrides[cat + '/' + subKey] = color;
  }

  function buildControllerColorMap(uniformColorOverride) {
    const colorMap = {};
    const fallback = getLayerEffectiveColor('irrigation', 'controller');
    for (const ctrl of controllerData) {
      if (ctrl.featureRef) {
        colorMap[ctrl.featureRef] = uniformColorOverride !== null
          ? uniformColorOverride
          : (ctrl.controllerColor || fallback);
      }
    }
    return colorMap;
  }

  function pushLayersToIframe() {
    const ctrlOverride = getSessionColorOverride('irrigation', 'controller');
    const ctrlColorMap = buildControllerColorMap(ctrlOverride);
    const storedZoneColor = getStoredZoneColor();
    const hasControllerData = controllerData && controllerData.length > 0;
    const layerData = mapLayers.filter(l => {
      if (!l._geojson || l.layerKey === 'outline') return false;
      if (hasControllerData && (l.subLayerKey === 'controller' || l.subLayerKey === 'zone')) return false;
      return true;
    }).map(l => {
      let colorMap = {};
      if (l.subLayerKey === 'controller') {
        colorMap = ctrlColorMap;
      } else if (l.subLayerKey === 'zone') {
        colorMap = storedZoneColor ? buildZoneColorMap(storedZoneColor) : ctrlColorMap;
      }
      return {
        id: l.id,
        layerKey: l.layerKey,
        subLayerKey: l.subLayerKey,
        displayName: l.displayName,
        color: l.color || '#25C1AC',
        geojson: l._geojson,
        controllerColorMap: colorMap,
      };
    });
    if (layerData.length > 0) {
      cmdToIframe('addLayers', layerData);
    }
  }

  function getStoredZoneColor() {
    for (const ctrl of controllerData) {
      for (const z of (ctrl.zones || [])) {
        if (z.zoneColor) return z.zoneColor;
      }
    }
    return null;
  }

  function pushIrrigationToIframe() {
    if (!controllerData || controllerData.length === 0) return;
    const ctrlOverride = getSessionColorOverride('irrigation', 'controller');
    const zoneOverride = getSessionColorOverride('irrigation', 'zone') || getStoredZoneColor();
    sendIrrigationMarkers(ctrlOverride, zoneOverride);
  }

  function syncVisibleLayers(fitMap) {
    const hasControllerData = controllerData && controllerData.length > 0;
    const visibleIds = [];
    mapLayers.forEach(layer => {
      const cat = layer.layerKey;
      const sub = layer.subLayerKey;
      if (hasControllerData && (sub === 'controller' || sub === 'zone')) return;
      if (cat === activeCategory && sublayerState[cat] && sublayerState[cat][sub]) {
        visibleIds.push(layer.id);
      }
    });
    cmdToIframe('showLayerIds', visibleIds);

    const showControllers = activeCategory === 'irrigation' && sublayerState.irrigation && sublayerState.irrigation.controller;
    const showZones = activeCategory === 'irrigation' && sublayerState.irrigation && sublayerState.irrigation.zone;
    cmdToIframe('showControllers', !!showControllers);
    cmdToIframe('showZones', !!showZones);
    if (fitMap) {
      cmdToIframe('fitToContent');
    }
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
      const currentUserId = ctx.user ? ctx.user.id : null;
      const isAdmin = role === 'admin';
      body.innerHTML = `
        <div class="mdp-notes-list">
          ${notes.map(note => {
            const canDelete = isAdmin || (currentUserId && note.createdBy === currentUserId);
            const noteText = note.noteText || note.content || note.text || note.note || '';
            const authorName = note.creatorName || note.authorName || note.author || 'Unknown';
            const noteDate = note.createdAt ? new Date(note.createdAt).toLocaleDateString() : '';
            return `
            <div class="mdp-note-item" data-note-id="${esc(note.id)}">
              <div class="mdp-note-meta">
                <span class="mdp-note-author">${esc(authorName)}</span>
                <div class="mdp-note-meta-right">
                  <span class="mdp-note-date">${noteDate}</span>
                  ${canDelete ? `<button class="mdp-note-delete-btn" data-note-id="${esc(note.id)}" title="Delete note" aria-label="Delete note">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                  </button>` : ''}
                </div>
              </div>
              <div class="mdp-note-text">${esc(noteText)}</div>
            </div>
          `;
          }).join('')}
        </div>
      `;

      body.querySelectorAll('.mdp-note-delete-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this note?')) return;
          const noteId = btn.dataset.noteId;
          try {
            await apiFetch(`/api/assets/${asset.id}/notes/${noteId}`, { method: 'DELETE' });
            loadNotesTab(body, asset);
          } catch (err) {
            showToast('Failed to delete note', 'error');
          }
        });
      });
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
