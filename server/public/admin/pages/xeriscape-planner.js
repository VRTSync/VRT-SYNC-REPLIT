AdminRouter.register('xeriscape-planner', async function(container) {
  const { apiFetch, showToast } = AdminAPI;

  const DEFAULT_COST_PER_SF = 6.00;
  const DEFAULT_SAVINGS_PER_SF = 0.50;

  const breadcrumb = document.getElementById('breadcrumb-area');
  if (breadcrumb) breadcrumb.innerHTML = '';

  container.innerHTML = `
    <div class="page-header" style="margin-bottom:16px">
      <div>
        <h1 style="font-size:22px;font-weight:700;color:var(--navy);margin:0">Xeriscape Conversion Planner</h1>
        <p style="font-size:13px;color:var(--gray-500);margin:4px 0 0">Huntington Trails &mdash; Select bluegrass polygons to estimate conversion cost and water savings</p>
      </div>
    </div>
    <div style="display:flex;gap:20px;height:calc(100vh - 160px);min-height:500px">
      <div style="flex:1;min-width:0;position:relative;border-radius:var(--radius);overflow:hidden;box-shadow:var(--shadow-md);border:1px solid var(--gray-200)">
        <div id="xp-map" style="width:100%;height:100%;background:#e8eef4"></div>
        <div id="xp-map-loading" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(240,244,248,0.85);z-index:1000;font-size:14px;color:var(--gray-500)">
          <div style="text-align:center">
            <div style="margin-bottom:8px;font-size:24px">🌿</div>
            Loading polygons&hellip;
          </div>
        </div>
      </div>
      <div style="width:300px;flex-shrink:0;display:flex;flex-direction:column;gap:16px;position:sticky;top:0;max-height:calc(100vh - 160px);overflow-y:auto">
        <div class="xp-card">
          <div class="xp-card-title">Selection</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
            <div>
              <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--gray-400);margin-bottom:4px">Polygons</div>
              <div id="xp-count" style="font-size:28px;font-weight:700;color:var(--navy)">0</div>
            </div>
            <div>
              <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--gray-400);margin-bottom:4px">Total Sq Ft</div>
              <div id="xp-area" style="font-size:28px;font-weight:700;color:var(--navy)">0</div>
            </div>
          </div>
          <div style="margin-top:12px">
            <button id="xp-clear-btn" class="btn btn-secondary btn-sm" style="width:100%" disabled>Clear Selection</button>
          </div>
        </div>

        <div class="xp-card">
          <div class="xp-card-title">Assumptions</div>
          <div class="xp-field" style="margin-top:12px">
            <label class="xp-label">Conversion cost per SF ($)</label>
            <input type="number" id="xp-cost-per-sf" class="form-input" value="${DEFAULT_COST_PER_SF.toFixed(2)}" min="0" step="0.25" style="margin-top:4px">
          </div>
          <div class="xp-field" style="margin-top:12px">
            <label class="xp-label">Annual water savings per SF ($)</label>
            <input type="number" id="xp-savings-per-sf" class="form-input" value="${DEFAULT_SAVINGS_PER_SF.toFixed(2)}" min="0" step="0.05" style="margin-top:4px">
          </div>
        </div>

        <div class="xp-card" style="border-top:3px solid var(--teal)">
          <div class="xp-card-title">Estimated Summary</div>
          <div style="margin-top:12px;display:flex;flex-direction:column;gap:14px">
            <div>
              <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--gray-400);margin-bottom:4px">Conversion Cost</div>
              <div id="xp-est-cost" style="font-size:22px;font-weight:700;color:var(--navy)">&mdash;</div>
            </div>
            <div style="height:1px;background:var(--gray-100)"></div>
            <div>
              <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--gray-400);margin-bottom:4px">Annual Water Savings</div>
              <div id="xp-est-savings" style="font-size:22px;font-weight:700;color:var(--teal)">&mdash;</div>
            </div>
            <div style="height:1px;background:var(--gray-100)"></div>
            <div>
              <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--gray-400);margin-bottom:4px">Payback Period</div>
              <div id="xp-est-payback" style="font-size:22px;font-weight:700;color:var(--gray-700)">&mdash;</div>
            </div>
          </div>
        </div>

        <div class="xp-card" style="background:var(--gray-50)">
          <div style="font-size:12px;color:var(--gray-500);line-height:1.5">
            <strong>How to use:</strong> Click polygons on the map to select them. Hold <kbd style="background:var(--gray-200);padding:1px 5px;border-radius:3px;font-size:11px">Shift</kbd> or just keep clicking to build a multi-polygon selection. Adjust assumptions to update estimates instantly.
          </div>
        </div>
      </div>
    </div>

    <style>
      .xp-card {
        background: var(--white);
        border-radius: var(--radius);
        padding: 16px;
        box-shadow: var(--shadow);
        border: 1px solid var(--gray-100);
      }
      .xp-card-title {
        font-size: 13px;
        font-weight: 700;
        color: var(--navy);
        text-transform: uppercase;
        letter-spacing: 0.6px;
      }
      .xp-label {
        font-size: 12px;
        font-weight: 600;
        color: var(--gray-600);
        display: block;
      }
    </style>
  `;

  const selectedIds = new Set();
  let allFeatures = [];
  let leafletLayers = {};
  let map = null;

  function formatNumber(n) {
    return Math.round(n).toLocaleString();
  }

  function formatCurrency(n) {
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function recalculate() {
    const count = selectedIds.size;
    const totalArea = allFeatures
      .filter(f => selectedIds.has(f.properties.id))
      .reduce((sum, f) => sum + (f.properties.area_sqft || 0), 0);

    const costPerSf = parseFloat(document.getElementById('xp-cost-per-sf').value) || 0;
    const savingsPerSf = parseFloat(document.getElementById('xp-savings-per-sf').value) || 0;

    document.getElementById('xp-count').textContent = count;
    document.getElementById('xp-area').textContent = count > 0 ? formatNumber(totalArea) : '0';

    const clearBtn = document.getElementById('xp-clear-btn');
    if (clearBtn) clearBtn.disabled = count === 0;

    if (count === 0 || totalArea === 0) {
      document.getElementById('xp-est-cost').textContent = '—';
      document.getElementById('xp-est-savings').textContent = '—';
      document.getElementById('xp-est-payback').textContent = '—';
      return;
    }

    const estCost = totalArea * costPerSf;
    const estSavings = totalArea * savingsPerSf;

    document.getElementById('xp-est-cost').textContent = formatCurrency(estCost);
    document.getElementById('xp-est-savings').textContent = estSavings > 0 ? formatCurrency(estSavings) + '/yr' : '—';

    if (estSavings <= 0) {
      document.getElementById('xp-est-payback').textContent = '—';
    } else {
      const years = estCost / estSavings;
      if (years < 1) {
        document.getElementById('xp-est-payback').textContent = '< 1 yr';
      } else {
        document.getElementById('xp-est-payback').textContent = years.toFixed(1) + ' yrs';
      }
    }
  }

  function getLayerStyle(id) {
    const isSelected = selectedIds.has(id);
    if (isSelected) {
      return { color: '#1a7a3c', weight: 2, fillColor: '#22c55e', fillOpacity: 0.45, opacity: 1 };
    }
    return { color: '#4b7fa3', weight: 1.5, fillColor: '#7eb8e0', fillOpacity: 0.22, opacity: 0.85 };
  }

  function getHoverStyle(id) {
    const isSelected = selectedIds.has(id);
    if (isSelected) {
      return { fillOpacity: 0.6, weight: 2.5 };
    }
    return { fillOpacity: 0.4, color: '#2b6cb0', weight: 2 };
  }

  function applyLayerStyle(id) {
    const layer = leafletLayers[id];
    if (!layer) return;
    layer.setStyle(getLayerStyle(id));
  }

  function toggleSelection(id) {
    if (selectedIds.has(id)) {
      selectedIds.delete(id);
    } else {
      selectedIds.add(id);
    }
    applyLayerStyle(id);
    recalculate();
  }

  function clearSelection() {
    const prev = [...selectedIds];
    selectedIds.clear();
    prev.forEach(id => applyLayerStyle(id));
    recalculate();
  }

  async function initMap() {
    if (typeof L === 'undefined') {
      showToast('Map library not available', 'error');
      return;
    }

    const mapEl = document.getElementById('xp-map');
    if (!mapEl) return;

    map = L.map(mapEl, { zoomControl: true, attributionControl: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 20,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);

    try {
      const geojson = await apiFetch('/api/admin/xeriscape/polygons');
      allFeatures = geojson.features || [];

      if (allFeatures.length === 0) {
        showToast('No polygons found in KML', 'error');
        return;
      }

      const bounds = L.latLngBounds([]);

      allFeatures.forEach(feature => {
        const id = feature.properties.id;
        const name = feature.properties.name;

        const layer = L.geoJSON(feature, {
          style: () => getLayerStyle(id),
          onEachFeature: function(feat, lyr) {
            lyr.bindTooltip(name, { permanent: true, direction: 'center', className: 'xp-tooltip' });

            lyr.on('mouseover', function() {
              if (!selectedIds.has(id)) {
                lyr.setStyle(getHoverStyle(id));
              }
            });

            lyr.on('mouseout', function() {
              applyLayerStyle(id);
            });

            lyr.on('click', function() {
              toggleSelection(id);
            });
          },
        }).addTo(map);

        leafletLayers[id] = layer;

        try {
          bounds.extend(layer.getBounds());
        } catch {}
      });

      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [24, 24] });
      }

      const loadingEl = document.getElementById('xp-map-loading');
      if (loadingEl) loadingEl.style.display = 'none';

    } catch (err) {
      showToast('Failed to load polygons: ' + err.message, 'error');
      const loadingEl = document.getElementById('xp-map-loading');
      if (loadingEl) loadingEl.textContent = 'Failed to load polygons';
    }
  }

  document.getElementById('xp-cost-per-sf').addEventListener('input', recalculate);
  document.getElementById('xp-savings-per-sf').addEventListener('input', recalculate);
  document.getElementById('xp-clear-btn').addEventListener('click', clearSelection);

  if (typeof L === 'undefined') {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);

    const style = document.createElement('style');
    style.textContent = '.xp-tooltip { font-size: 12px; font-weight: 600; background: rgba(12,29,49,0.85); color: #fff; border: none; padding: 3px 8px; border-radius: 4px; }';
    document.head.appendChild(style);

    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = initMap;
    script.onerror = () => showToast('Failed to load map library', 'error');
    document.head.appendChild(script);
  } else {
    const style = document.createElement('style');
    style.textContent = '.xp-tooltip { font-size: 12px; font-weight: 600; background: rgba(12,29,49,0.85); color: #fff; border: none; padding: 3px 8px; border-radius: 4px; }';
    document.head.appendChild(style);
    await initMap();
  }
});
