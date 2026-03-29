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
      <div id="xp-right-panel" style="width:320px;flex-shrink:0;display:flex;flex-direction:column;gap:16px;position:sticky;top:0;max-height:calc(100vh - 160px);overflow-y:auto;padding-right:2px">

        <!-- Selection card -->
        <div class="xp-card">
          <div class="xp-card-title">Selection</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
            <div>
              <div class="xp-stat-label">Polygons</div>
              <div id="xp-count" style="font-size:28px;font-weight:700;color:var(--navy)">0</div>
            </div>
            <div>
              <div class="xp-stat-label">Total Sq Ft</div>
              <div id="xp-area" style="font-size:28px;font-weight:700;color:var(--navy)">0</div>
            </div>
          </div>
          <div style="margin-top:12px;display:flex;gap:8px">
            <button id="xp-clear-btn" class="btn btn-secondary btn-sm" style="flex:1" disabled>Clear Selection</button>
            <button id="xp-save-group-btn" class="btn btn-sm" style="flex:1;background:var(--teal);color:#fff;border:none;border-radius:var(--radius);cursor:pointer;font-size:12px;font-weight:600;padding:6px 10px" disabled>Save as Group</button>
          </div>
          <!-- Inline save group form (hidden by default) -->
          <div id="xp-save-group-form" style="display:none;margin-top:12px;border-top:1px solid var(--gray-100);padding-top:12px">
            <label class="xp-label" style="margin-bottom:4px;display:block">Group name</label>
            <input type="text" id="xp-group-name-input" class="form-input" placeholder="e.g. North entrance lawns" style="margin-bottom:8px">
            <div id="xp-save-group-error" style="display:none;font-size:11px;color:#dc2626;margin-bottom:6px"></div>
            <div style="display:flex;gap:8px">
              <button id="xp-save-group-confirm" class="btn btn-sm" style="flex:1;background:var(--teal);color:#fff;border:none;border-radius:var(--radius);cursor:pointer;font-size:12px;font-weight:600;padding:6px 10px">Save</button>
              <button id="xp-save-group-cancel" class="btn btn-secondary btn-sm" style="flex:1">Cancel</button>
            </div>
          </div>
        </div>

        <!-- Assumptions card -->
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

        <!-- Estimated Summary card -->
        <div class="xp-card" style="border-top:3px solid var(--teal)">
          <div class="xp-card-title">Estimated Summary</div>
          <div style="margin-top:12px;display:flex;flex-direction:column;gap:14px">
            <div>
              <div class="xp-stat-label">Conversion Cost</div>
              <div id="xp-est-cost" style="font-size:22px;font-weight:700;color:var(--navy)">&mdash;</div>
            </div>
            <div style="height:1px;background:var(--gray-100)"></div>
            <div>
              <div class="xp-stat-label">Annual Water Savings</div>
              <div id="xp-est-savings" style="font-size:22px;font-weight:700;color:var(--teal)">&mdash;</div>
            </div>
            <div style="height:1px;background:var(--gray-100)"></div>
            <div>
              <div class="xp-stat-label">Payback Period</div>
              <div id="xp-est-payback" style="font-size:22px;font-weight:700;color:var(--gray-700)">&mdash;</div>
            </div>
          </div>
        </div>

        <!-- Saved Groups panel -->
        <div id="xp-groups-panel" class="xp-card" style="display:none">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
            <div class="xp-card-title">Saved Groups</div>
            <span id="xp-groups-count-badge" style="font-size:11px;font-weight:700;background:var(--teal);color:#fff;padding:2px 7px;border-radius:20px"></span>
          </div>
          <div id="xp-groups-list" style="display:flex;flex-direction:column;gap:10px"></div>
        </div>

        <!-- Scenario Comparison panel -->
        <div id="xp-comparison-panel" class="xp-card" style="display:none">
          <div class="xp-card-title" style="margin-bottom:12px">Scenario Comparison</div>
          <div id="xp-comparison-content" style="overflow-x:auto"></div>
        </div>

        <!-- How to use -->
        <div class="xp-card" style="background:var(--gray-50)">
          <div style="font-size:12px;color:var(--gray-500);line-height:1.5">
            <strong>How to use:</strong> Click polygons on the map to select them. Keep clicking to build a multi-polygon selection. Adjust assumptions to update estimates instantly. Save named groups to compare scenarios side by side.
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
      .xp-stat-label {
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.8px;
        color: var(--gray-400);
        margin-bottom: 4px;
      }
      .xp-group-row {
        border: 1px solid var(--gray-200);
        border-radius: var(--radius);
        padding: 10px 12px;
        background: var(--gray-50);
        transition: border-color 0.15s;
      }
      .xp-group-row.xp-group-highlighted {
        border-color: #d97706;
        background: #fffbeb;
      }
      .xp-group-name {
        font-size: 13px;
        font-weight: 700;
        color: var(--navy);
        margin-bottom: 6px;
      }
      .xp-group-meta {
        font-size: 11px;
        color: var(--gray-500);
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 4px 8px;
        margin-bottom: 8px;
      }
      .xp-group-actions {
        display: flex;
        gap: 6px;
      }
      .xp-group-btn {
        font-size: 11px;
        font-weight: 600;
        padding: 3px 8px;
        border-radius: 4px;
        border: 1px solid var(--gray-200);
        background: var(--white);
        color: var(--gray-600);
        cursor: pointer;
        transition: background 0.12s, color 0.12s;
      }
      .xp-group-btn:hover { background: var(--gray-100); }
      .xp-group-btn.xp-btn-view { border-color: #d97706; color: #d97706; }
      .xp-group-btn.xp-btn-view:hover { background: #fffbeb; }
      .xp-group-btn.xp-btn-delete { border-color: #dc2626; color: #dc2626; }
      .xp-group-btn.xp-btn-delete:hover { background: #fef2f2; }
      .xp-comparison-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 11px;
      }
      .xp-comparison-table th {
        text-align: left;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--gray-400);
        padding: 4px 6px;
        border-bottom: 2px solid var(--gray-100);
        white-space: nowrap;
      }
      .xp-comparison-table td {
        padding: 6px 6px;
        border-bottom: 1px solid var(--gray-100);
        color: var(--navy);
        font-weight: 500;
        vertical-align: top;
      }
      .xp-comparison-table tr:last-child td { border-bottom: none; }
      .xp-rename-input {
        font-size: 13px;
        font-weight: 700;
        color: var(--navy);
        border: 1px solid var(--teal);
        border-radius: 4px;
        padding: 2px 6px;
        width: 100%;
        outline: none;
        background: var(--white);
        box-sizing: border-box;
        margin-bottom: 6px;
      }
      #xp-right-panel::-webkit-scrollbar { width: 4px; }
      #xp-right-panel::-webkit-scrollbar-thumb { background: var(--gray-200); border-radius: 2px; }
    </style>
  `;

  // ── State ──────────────────────────────────────────────────────────────────
  const selectedIds = new Set();
  let allFeatures = [];
  let leafletLayers = {};
  let map = null;
  let groups = [];            // PlannerGroup[]
  let highlightedGroupId = null; // id of currently map-highlighted group

  // ── Helpers ────────────────────────────────────────────────────────────────
  function genId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
  }

  function formatNumber(n) {
    return Math.round(n).toLocaleString();
  }

  function formatCurrency(n) {
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function getAssumptions() {
    const costPerSf = parseFloat(document.getElementById('xp-cost-per-sf').value) || 0;
    const savingsPerSf = parseFloat(document.getElementById('xp-savings-per-sf').value) || 0;
    return { costPerSf, savingsPerSf };
  }

  // ── Group computation (pure functions) ─────────────────────────────────────
  function computeGroupOutputs(polygonIds, assumptions) {
    const { costPerSf, savingsPerSf } = assumptions;
    const features = allFeatures.filter(f => polygonIds.includes(f.properties.id));
    const totalSquareFootage = features.reduce((sum, f) => sum + (f.properties.area_sqft || 0), 0);
    const polygonCount = features.length;
    const estimatedConversionCost = totalSquareFootage * costPerSf;
    const estimatedAnnualWaterSavings = totalSquareFootage * savingsPerSf;
    let estimatedPaybackYears = null;
    if (estimatedAnnualWaterSavings > 0) {
      estimatedPaybackYears = estimatedConversionCost / estimatedAnnualWaterSavings;
    }
    return { polygonCount, totalSquareFootage, estimatedConversionCost, estimatedAnnualWaterSavings, estimatedPaybackYears };
  }

  function recomputeAllGroups() {
    const assumptions = getAssumptions();
    groups = groups.map(g => ({
      ...g,
      ...computeGroupOutputs(g.polygonIds, assumptions),
    }));
  }

  // ── Map styles ─────────────────────────────────────────────────────────────
  function getLayerStyle(id) {
    const isSelected = selectedIds.has(id);
    const isGroupHighlighted = highlightedGroupId !== null &&
      groups.find(g => g.id === highlightedGroupId)?.polygonIds.includes(id);

    if (isSelected && isGroupHighlighted) {
      return { color: '#1a7a3c', weight: 3, fillColor: '#22c55e', fillOpacity: 0.55, opacity: 1 };
    }
    if (isSelected) {
      return { color: '#1a7a3c', weight: 2, fillColor: '#22c55e', fillOpacity: 0.45, opacity: 1 };
    }
    if (isGroupHighlighted) {
      return { color: '#b45309', weight: 2.5, fillColor: '#f59e0b', fillOpacity: 0.45, opacity: 1 };
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

  function refreshAllLayerStyles() {
    allFeatures.forEach(f => applyLayerStyle(f.properties.id));
  }

  // ── Selection ──────────────────────────────────────────────────────────────
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

  // ── Current selection summary recalculate ──────────────────────────────────
  function recalculate() {
    const count = selectedIds.size;
    const totalArea = allFeatures
      .filter(f => selectedIds.has(f.properties.id))
      .reduce((sum, f) => sum + (f.properties.area_sqft || 0), 0);

    const { costPerSf, savingsPerSf } = getAssumptions();

    document.getElementById('xp-count').textContent = count;
    document.getElementById('xp-area').textContent = count > 0 ? formatNumber(totalArea) : '0';

    const clearBtn = document.getElementById('xp-clear-btn');
    if (clearBtn) clearBtn.disabled = count === 0;

    const saveGroupBtn = document.getElementById('xp-save-group-btn');
    if (saveGroupBtn) saveGroupBtn.disabled = count === 0;

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

  function onAssumptionsChange() {
    recalculate();
    recomputeAllGroups();
    renderGroupsPanel();
    renderComparisonPanel();
  }

  // ── Save-as-Group UI ───────────────────────────────────────────────────────
  function showSaveGroupForm() {
    const form = document.getElementById('xp-save-group-form');
    if (form) {
      form.style.display = 'block';
      const input = document.getElementById('xp-group-name-input');
      if (input) { input.value = ''; input.focus(); }
      clearSaveGroupError();
    }
  }

  function hideSaveGroupForm() {
    const form = document.getElementById('xp-save-group-form');
    if (form) form.style.display = 'none';
    clearSaveGroupError();
  }

  function clearSaveGroupError() {
    const err = document.getElementById('xp-save-group-error');
    if (err) { err.style.display = 'none'; err.textContent = ''; }
  }

  function showSaveGroupError(msg) {
    const err = document.getElementById('xp-save-group-error');
    if (err) { err.style.display = 'block'; err.textContent = msg; }
  }

  function confirmSaveGroup() {
    const nameInput = document.getElementById('xp-group-name-input');
    const name = (nameInput ? nameInput.value : '').trim();

    if (selectedIds.size === 0) {
      showSaveGroupError('Select at least one polygon before saving a group.');
      return;
    }
    if (!name) {
      showSaveGroupError('Group name cannot be blank.');
      return;
    }

    const polygonIds = [...selectedIds];
    const assumptions = getAssumptions();
    const outputs = computeGroupOutputs(polygonIds, assumptions);

    const newGroup = {
      id: genId(),
      name,
      polygonIds,
      createdAt: new Date().toISOString(),
      ...outputs,
    };

    groups.push(newGroup);
    hideSaveGroupForm();
    renderGroupsPanel();
    renderComparisonPanel();
    showToast('Group "' + name + '" saved', 'success');
  }

  // ── Groups panel rendering ─────────────────────────────────────────────────
  function renderGroupsPanel() {
    const panel = document.getElementById('xp-groups-panel');
    const list = document.getElementById('xp-groups-list');
    const badge = document.getElementById('xp-groups-count-badge');

    if (!panel || !list) return;

    if (groups.length === 0) {
      panel.style.display = 'none';
      return;
    }

    panel.style.display = 'block';
    if (badge) badge.textContent = groups.length;

    list.innerHTML = '';

    groups.forEach(group => {
      const isHighlighted = highlightedGroupId === group.id;
      const row = document.createElement('div');
      row.className = 'xp-group-row' + (isHighlighted ? ' xp-group-highlighted' : '');
      row.dataset.groupId = group.id;

      const paybackStr = group.estimatedPaybackYears === null
        ? '—'
        : group.estimatedPaybackYears < 1
          ? '< 1 yr'
          : group.estimatedPaybackYears.toFixed(1) + ' yrs';

      row.innerHTML = `
        <div class="xp-group-name-wrap">
          <div class="xp-group-name" id="xp-gname-${group.id}">${escapeHtml(group.name)}</div>
        </div>
        <div class="xp-group-meta">
          <span><strong>${group.polygonCount}</strong> polygons</span>
          <span><strong>${formatNumber(group.totalSquareFootage)}</strong> SF</span>
          <span>Cost: <strong>${formatCurrency(group.estimatedConversionCost)}</strong></span>
          <span>Savings: <strong>${group.estimatedAnnualWaterSavings > 0 ? formatCurrency(group.estimatedAnnualWaterSavings) + '/yr' : '—'}</strong></span>
          <span style="grid-column:1/-1">Payback: <strong>${paybackStr}</strong></span>
        </div>
        <div class="xp-group-actions">
          <button class="xp-group-btn xp-btn-view" data-action="view" data-id="${group.id}">View on Map</button>
          <button class="xp-group-btn" data-action="rename" data-id="${group.id}">Rename</button>
          <button class="xp-group-btn xp-btn-delete" data-action="delete" data-id="${group.id}">Delete</button>
        </div>
      `;

      list.appendChild(row);
    });

    // event delegation — assign once per render (replaces prior handler, never accumulates)
    list.onclick = handleGroupListClick;
  }

  function handleGroupListClick(e) {
    const btn = e.target.closest('[data-action]');
    if (btn) {
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if (action === 'view') viewGroupOnMap(id);
      else if (action === 'rename') startRenameGroup(id);
      else if (action === 'delete') deleteGroup(id);
      return;
    }
    // clicking anywhere else on the row highlights the group on the map
    const row = e.target.closest('[data-group-id]');
    if (row) viewGroupOnMap(row.dataset.groupId);
  }

  function viewGroupOnMap(id) {
    const group = groups.find(g => g.id === id);
    if (!group || !map) return;

    if (highlightedGroupId === id) {
      highlightedGroupId = null;
      refreshAllLayerStyles();
      renderGroupsPanel();
      return;
    }

    highlightedGroupId = id;
    refreshAllLayerStyles();
    renderGroupsPanel();

    // fit map to group extent
    const bounds = L.latLngBounds([]);
    group.polygonIds.forEach(pid => {
      const layer = leafletLayers[pid];
      if (layer) {
        try { bounds.extend(layer.getBounds()); } catch {}
      }
    });
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [32, 32] });
    }
  }

  function startRenameGroup(id) {
    const nameWrap = document.getElementById('xp-gname-' + id);
    if (!nameWrap) return;
    const group = groups.find(g => g.id === id);
    if (!group) return;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'xp-rename-input';
    input.value = group.name;

    const parent = nameWrap.parentElement;
    parent.replaceChild(input, nameWrap);
    input.focus();
    input.select();

    function commit() {
      const newName = input.value.trim();
      if (!newName) {
        showToast('Group name cannot be blank', 'error');
        input.focus();
        return;
      }
      group.name = newName;
      renderGroupsPanel();
      renderComparisonPanel();
    }

    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') commit();
      if (e.key === 'Escape') { renderGroupsPanel(); }
    });

    input.addEventListener('blur', commit);
  }

  function deleteGroup(id) {
    const idx = groups.findIndex(g => g.id === id);
    if (idx === -1) return;
    const name = groups[idx].name;
    groups.splice(idx, 1);
    if (highlightedGroupId === id) {
      highlightedGroupId = null;
      refreshAllLayerStyles();
    }
    renderGroupsPanel();
    renderComparisonPanel();
    showToast('Group "' + name + '" deleted', 'success');
  }

  // ── Comparison panel rendering ─────────────────────────────────────────────
  function renderComparisonPanel() {
    const panel = document.getElementById('xp-comparison-panel');
    const content = document.getElementById('xp-comparison-content');
    if (!panel || !content) return;

    if (groups.length === 0) {
      panel.style.display = 'none';
      return;
    }

    panel.style.display = 'block';

    let rows = groups.map(g => {
      const paybackStr = g.estimatedPaybackYears === null
        ? '—'
        : g.estimatedPaybackYears < 1
          ? '< 1 yr'
          : g.estimatedPaybackYears.toFixed(1) + ' yrs';

      return `<tr>
        <td style="font-weight:700;max-width:90px;word-break:break-word">${escapeHtml(g.name)}</td>
        <td style="text-align:right">${g.polygonCount}</td>
        <td style="text-align:right">${formatNumber(g.totalSquareFootage)}</td>
        <td style="text-align:right">${formatCurrency(g.estimatedConversionCost)}</td>
        <td style="text-align:right">${g.estimatedAnnualWaterSavings > 0 ? formatCurrency(g.estimatedAnnualWaterSavings) : '—'}</td>
        <td style="text-align:right">${paybackStr}</td>
      </tr>`;
    }).join('');

    content.innerHTML = `
      <table class="xp-comparison-table">
        <thead>
          <tr>
            <th>Group</th>
            <th style="text-align:right">#</th>
            <th style="text-align:right">SF</th>
            <th style="text-align:right">Cost</th>
            <th style="text-align:right">Savings/yr</th>
            <th style="text-align:right">Payback</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  // ── Utility ────────────────────────────────────────────────────────────────
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Map init ───────────────────────────────────────────────────────────────
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

  // ── Event listeners ────────────────────────────────────────────────────────
  document.getElementById('xp-cost-per-sf').addEventListener('input', onAssumptionsChange);
  document.getElementById('xp-savings-per-sf').addEventListener('input', onAssumptionsChange);
  document.getElementById('xp-clear-btn').addEventListener('click', clearSelection);

  document.getElementById('xp-save-group-btn').addEventListener('click', function() {
    if (selectedIds.size === 0) {
      showToast('Select at least one polygon first', 'error');
      return;
    }
    showSaveGroupForm();
  });

  document.getElementById('xp-save-group-confirm').addEventListener('click', confirmSaveGroup);
  document.getElementById('xp-save-group-cancel').addEventListener('click', hideSaveGroupForm);

  document.getElementById('xp-group-name-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') confirmSaveGroup();
    if (e.key === 'Escape') hideSaveGroupForm();
  });

  // ── Bootstrap leaflet ──────────────────────────────────────────────────────
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
