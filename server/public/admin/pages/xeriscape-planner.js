AdminRouter.register('xeriscape-planner', async function(container) {
  const { apiFetch, showToast } = AdminAPI;

  const DEFAULT_COST_PER_SF = 6.00;
  const DEFAULT_SAVINGS_PER_SF = 0.50;
  const PROPERTY_NAME = 'Huntington Trails';

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
          <div id="xp-compare-all-wrap" style="display:none;margin-top:12px;padding-top:12px;border-top:1px solid var(--gray-100)">
            <button id="xp-compare-all-btn" class="btn btn-sm" style="width:100%;background:var(--navy);color:#fff;border:none;border-radius:var(--radius);cursor:pointer;font-size:12px;font-weight:600;padding:7px 10px">Compare All Groups</button>
          </div>
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

    <!-- Summary overlay (hidden by default) -->
    <div id="xp-summary-overlay" style="display:none;position:fixed;inset:0;z-index:9000;background:#f8fafc;overflow-y:auto">
      <div id="xp-summary-content" style="max-width:860px;margin:0 auto;padding:40px 32px 80px"></div>
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
        flex-wrap: wrap;
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
      .xp-group-btn.xp-btn-summary { border-color: var(--teal); color: var(--teal); }
      .xp-group-btn.xp-btn-summary:hover { background: #f0fdfa; }
      .xp-group-btn.xp-btn-print { border-color: #6366f1; color: #6366f1; }
      .xp-group-btn.xp-btn-print:hover { background: #eef2ff; }
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

      /* ── Summary styles ─────────────────────────── */
      .xps-header {
        border-bottom: 3px solid var(--teal);
        padding-bottom: 20px;
        margin-bottom: 28px;
      }
      .xps-property {
        font-size: 13px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 1px;
        color: var(--teal);
        margin-bottom: 6px;
      }
      .xps-title {
        font-size: 26px;
        font-weight: 700;
        color: var(--navy);
        margin: 0 0 6px;
        line-height: 1.2;
      }
      .xps-meta {
        font-size: 12px;
        color: var(--gray-500);
        display: flex;
        gap: 16px;
        flex-wrap: wrap;
      }
      .xps-meta-item { display: flex; gap: 4px; }
      .xps-kpi-row {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 16px;
        margin-bottom: 28px;
      }
      .xps-kpi-card {
        background: var(--white);
        border: 1px solid var(--gray-200);
        border-radius: var(--radius);
        padding: 16px;
        page-break-inside: avoid;
      }
      .xps-kpi-label {
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.7px;
        color: var(--gray-400);
        margin-bottom: 6px;
      }
      .xps-kpi-value {
        font-size: 24px;
        font-weight: 700;
        color: var(--navy);
        line-height: 1;
      }
      .xps-kpi-value.accent { color: var(--teal); }
      .xps-section-title {
        font-size: 13px;
        font-weight: 700;
        color: var(--navy);
        text-transform: uppercase;
        letter-spacing: 0.6px;
        margin: 0 0 12px;
        padding-bottom: 6px;
        border-bottom: 1px solid var(--gray-200);
      }
      .xps-block {
        background: var(--white);
        border: 1px solid var(--gray-200);
        border-radius: var(--radius);
        padding: 16px 20px;
        margin-bottom: 20px;
        page-break-inside: avoid;
      }
      .xps-assumptions-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px 24px;
        font-size: 13px;
        color: var(--gray-700);
        margin-bottom: 10px;
      }
      .xps-disclaimer {
        font-size: 12px;
        color: var(--gray-500);
        line-height: 1.6;
        font-style: italic;
        border-top: 1px solid var(--gray-100);
        padding-top: 10px;
        margin-top: 10px;
      }
      .xps-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
      }
      .xps-table th {
        text-align: left;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--gray-400);
        padding: 6px 8px;
        border-bottom: 2px solid var(--gray-200);
        white-space: nowrap;
      }
      .xps-table td {
        padding: 8px 8px;
        border-bottom: 1px solid var(--gray-100);
        color: var(--navy);
        vertical-align: top;
      }
      .xps-table tr:last-child td { border-bottom: none; }
      .xps-compare-table th { text-align: right; }
      .xps-compare-table th:first-child { text-align: left; }
      .xps-compare-table td { text-align: right; }
      .xps-compare-table td:first-child { text-align: left; font-weight: 700; }
      .xps-map-container {
        background: var(--gray-100);
        border: 1px solid var(--gray-200);
        border-radius: var(--radius);
        margin-bottom: 20px;
        overflow: hidden;
        page-break-inside: avoid;
      }
      .xps-map-label {
        font-size: 11px;
        color: var(--gray-400);
        font-style: italic;
        text-align: center;
        padding: 6px 0;
        background: var(--white);
        border-top: 1px solid var(--gray-100);
      }
      .xps-map-placeholder {
        height: 220px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--gray-400);
        font-size: 13px;
      }
      .xps-back-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        font-weight: 600;
        color: var(--gray-600);
        cursor: pointer;
        background: none;
        border: 1px solid var(--gray-200);
        border-radius: var(--radius);
        padding: 7px 14px;
        margin-bottom: 24px;
        transition: background 0.12s;
      }
      .xps-back-btn:hover { background: var(--gray-100); }
      .xps-print-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        font-weight: 600;
        color: #fff;
        cursor: pointer;
        background: var(--navy);
        border: none;
        border-radius: var(--radius);
        padding: 7px 16px;
        margin-bottom: 24px;
        margin-left: 8px;
        transition: opacity 0.12s;
      }
      .xps-print-btn:hover { opacity: 0.87; }
      .xps-admin-badge {
        display: inline-block;
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 1px;
        background: #fef9c3;
        color: #854d0e;
        border: 1px solid #fde68a;
        border-radius: 4px;
        padding: 2px 8px;
        margin-left: 10px;
        vertical-align: middle;
      }
      .xps-group-detail-section {
        margin-bottom: 24px;
        page-break-inside: avoid;
      }

      /* ── Print styles ──────────────────────────── */
      @media print {
        #sidebar,
        #topbar,
        .xps-back-btn,
        .xps-print-btn,
        .xps-map-container,
        #xp-map,
        #xp-right-panel,
        .page-header {
          display: none !important;
        }
        #xp-summary-overlay {
          position: static !important;
          background: #fff !important;
          overflow: visible !important;
        }
        #xp-summary-content {
          max-width: 100% !important;
          padding: 20px !important;
        }
        body, #app, #main-content, #page-content {
          overflow: visible !important;
        }
        .xps-kpi-card,
        .xps-block,
        .xps-group-detail-section,
        .xps-map-container {
          page-break-inside: avoid;
        }
        .xps-map-print-placeholder {
          display: block !important;
          height: 60px;
          background: #f1f5f9;
          border: 1px dashed #cbd5e1;
          border-radius: 6px;
          text-align: center;
          line-height: 60px;
          font-size: 12px;
          color: #94a3b8;
          margin-bottom: 20px;
        }
        .xps-no-print { display: none !important; }
      }
      .xps-map-print-placeholder { display: none; }
    </style>
  `;

  // ── State ──────────────────────────────────────────────────────────────────
  const selectedIds = new Set();
  let allFeatures = [];
  let leafletLayers = {};
  let map = null;
  let groups = [];            // PlannerGroup[]
  let highlightedGroupId = null;
  let summaryMiniMaps = [];   // track mini-map instances for cleanup

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

  function formatDate(isoOrDate) {
    const d = isoOrDate ? new Date(isoOrDate) : new Date();
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function getAssumptions() {
    const costPerSf = parseFloat(document.getElementById('xp-cost-per-sf').value) || 0;
    const savingsPerSf = parseFloat(document.getElementById('xp-savings-per-sf').value) || 0;
    return { costPerSf, savingsPerSf };
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
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

  // ── buildGroupSummary — pure, reusable ─────────────────────────────────────
  // Accepts the group, the full polygon feature collection, assumptions, and optional
  // overrides for propertyName and generatedDate so the function is fully deterministic
  // and testable without side-effects.
  function buildGroupSummary(group, polygonFeatures, assumptions, opts) {
    opts = opts || {};
    const propertyName = opts.propertyName !== undefined ? opts.propertyName : PROPERTY_NAME;
    const generatedDate = opts.generatedDate !== undefined ? opts.generatedDate : formatDate(new Date());

    const paybackStr = group.estimatedPaybackYears === null
      ? '—'
      : group.estimatedPaybackYears < 1
        ? '< 1 yr'
        : group.estimatedPaybackYears.toFixed(1) + ' yrs';

    const polygonDetails = polygonFeatures
      .filter(f => group.polygonIds.includes(f.properties.id))
      .map(f => ({ name: f.properties.name || f.properties.id, sqft: f.properties.area_sqft || 0 }))
      .sort((a, b) => b.sqft - a.sqft);

    return {
      propertyName,
      groupName: group.name,
      generatedDate,
      polygonCount: group.polygonCount,
      totalSquareFootage: group.totalSquareFootage,
      costPerSf: assumptions.costPerSf,
      savingsPerSf: assumptions.savingsPerSf,
      estimatedConversionCost: group.estimatedConversionCost,
      estimatedAnnualWaterSavings: group.estimatedAnnualWaterSavings,
      estimatedPaybackYears: group.estimatedPaybackYears,
      paybackStr,
      polygonDetails,
      polygonIds: group.polygonIds,
    };
  }

  // ── renderAssumptionsBlock — reusable HTML component ──────────────────────
  function renderAssumptionsBlock(assumptions) {
    return `
      <div class="xps-block">
        <div class="xps-section-title">Assumptions &amp; Disclaimer</div>
        <div class="xps-assumptions-grid">
          <div><strong>Conversion cost:</strong> ${formatCurrency(assumptions.costPerSf)} / SF</div>
          <div><strong>Annual water savings:</strong> ${formatCurrency(assumptions.savingsPerSf)} / SF</div>
          <div style="grid-column:1/-1"><strong>Payback basis:</strong> Water-only savings (does not include maintenance savings or utility rate escalation)</div>
        </div>
        <div class="xps-disclaimer">
          Estimates shown are planning-level figures based on selected assumptions and mapped polygon area. Actual project cost, water savings, and payback may vary based on final design, utility rates, site conditions, and operational factors.
        </div>
      </div>
    `;
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
    const compareAllWrap = document.getElementById('xp-compare-all-wrap');

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
          <button class="xp-group-btn xp-btn-summary" data-action="summary" data-id="${group.id}">View Summary</button>
          <button class="xp-group-btn xp-btn-print" data-action="print" data-id="${group.id}">Print Summary</button>
          <button class="xp-group-btn" data-action="rename" data-id="${group.id}">Rename</button>
          <button class="xp-group-btn xp-btn-delete" data-action="delete" data-id="${group.id}">Delete</button>
        </div>
      `;

      list.appendChild(row);
    });

    if (compareAllWrap) {
      compareAllWrap.style.display = groups.length >= 2 ? 'block' : 'none';
    }

    // event delegation
    list.onclick = handleGroupListClick;

    const compareAllBtn = document.getElementById('xp-compare-all-btn');
    if (compareAllBtn) {
      compareAllBtn.onclick = showComparisonSummary;
    }
  }

  function handleGroupListClick(e) {
    const btn = e.target.closest('[data-action]');
    if (btn) {
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if (action === 'view') viewGroupOnMap(id);
      else if (action === 'summary') showGroupSummary(id);
      else if (action === 'print') printGroupSummary(id);
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

  // ── Summary overlay helpers ────────────────────────────────────────────────
  function destroyMiniMaps() {
    summaryMiniMaps.forEach(m => { try { m.remove(); } catch {} });
    summaryMiniMaps = [];
  }

  function showOverlay(htmlContent) {
    destroyMiniMaps();
    const overlay = document.getElementById('xp-summary-overlay');
    const content = document.getElementById('xp-summary-content');
    if (!overlay || !content) return;
    content.innerHTML = htmlContent;
    overlay.style.display = 'block';
    overlay.scrollTop = 0;
  }

  function hideSummaryOverlay() {
    destroyMiniMaps();
    const overlay = document.getElementById('xp-summary-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  // ── Mini-map rendering ─────────────────────────────────────────────────────
  function renderMiniMap(containerId, polygonIdSets, colorSets) {
    // polygonIdSets: array of arrays (one per group/color)
    // colorSets: array of color strings matching each set
    const el = document.getElementById(containerId);
    if (!el) return;

    if (typeof L === 'undefined') {
      el.innerHTML = '<div class="xps-map-placeholder">Map preview unavailable — map library not loaded.</div>';
      return;
    }

    try {
      const miniMap = L.map(el, {
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        touchZoom: false,
        keyboard: false,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 20,
      }).addTo(miniMap);

      const bounds = L.latLngBounds([]);

      polygonIdSets.forEach((ids, idx) => {
        const color = colorSets[idx] || '#14b8a6';
        const features = allFeatures.filter(f => ids.includes(f.properties.id));
        features.forEach(feature => {
          const layer = L.geoJSON(feature, {
            style: () => ({ color, weight: 2, fillColor: color, fillOpacity: 0.35, opacity: 1 }),
            interactive: false,
          }).addTo(miniMap);
          try { bounds.extend(layer.getBounds()); } catch {}
        });
      });

      if (bounds.isValid()) {
        miniMap.fitBounds(bounds, { padding: [16, 16] });
      } else {
        miniMap.remove();
        el.innerHTML = '<div class="xps-map-placeholder">Map preview unavailable — no polygon geometry found.</div>';
        return;
      }

      summaryMiniMaps.push(miniMap);
    } catch (err) {
      const el2 = document.getElementById(containerId);
      if (el2) el2.innerHTML = '<div class="xps-map-placeholder">Map preview unavailable.</div>';
    }
  }

  // ── Single-group summary view ──────────────────────────────────────────────
  function showGroupSummary(id) {
    const group = groups.find(g => g.id === id);
    if (!group) return;

    const assumptions = getAssumptions();
    const summary = buildGroupSummary(group, allFeatures, assumptions);

    const polygonRows = summary.polygonDetails.map((p, i) => `
      <tr>
        <td style="color:var(--gray-500);font-size:12px">${i + 1}</td>
        <td>${escapeHtml(p.name)}</td>
        <td style="text-align:right">${formatNumber(p.sqft)}</td>
      </tr>
    `).join('');

    const html = `
      <div>
        <div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:4px" class="xps-no-print">
          <button class="xps-back-btn" id="xps-back-btn">&#8592; Back to Planner</button>
          <button class="xps-print-btn" id="xps-print-btn">&#128438; Print Summary</button>
        </div>

        <div class="xps-header">
          <div class="xps-property">${escapeHtml(summary.propertyName)}</div>
          <h1 class="xps-title">${escapeHtml(summary.groupName)} <span class="xps-admin-badge">Admin Planning Tool &mdash; Internal Use Only</span></h1>
          <div class="xps-meta">
            <span class="xps-meta-item"><strong>Generated:</strong>&nbsp;${escapeHtml(summary.generatedDate)}</span>
            <span class="xps-meta-item"><strong>Polygons:</strong>&nbsp;${summary.polygonCount}</span>
            <span class="xps-meta-item"><strong>Total SF:</strong>&nbsp;${formatNumber(summary.totalSquareFootage)}</span>
          </div>
        </div>

        <div class="xps-kpi-row">
          <div class="xps-kpi-card">
            <div class="xps-kpi-label">Conversion Cost</div>
            <div class="xps-kpi-value">${formatCurrency(summary.estimatedConversionCost)}</div>
          </div>
          <div class="xps-kpi-card">
            <div class="xps-kpi-label">Annual Water Savings</div>
            <div class="xps-kpi-value accent">${summary.estimatedAnnualWaterSavings > 0 ? formatCurrency(summary.estimatedAnnualWaterSavings) + '/yr' : '—'}</div>
          </div>
          <div class="xps-kpi-card">
            <div class="xps-kpi-label">Payback Period</div>
            <div class="xps-kpi-value">${summary.paybackStr}</div>
          </div>
        </div>

        <div class="xps-map-container xps-no-print">
          <div id="xps-mini-map-single" style="height:220px"></div>
          <div class="xps-map-label">Planning reference map — not to scale. Shows selected polygons only.</div>
        </div>
        <div class="xps-map-print-placeholder">Map preview omitted from print. See digital summary for spatial reference.</div>

        ${renderAssumptionsBlock(assumptions)}

        <div class="xps-block">
          <div class="xps-section-title">Polygon Detail</div>
          <table class="xps-table">
            <thead>
              <tr>
                <th style="width:32px">#</th>
                <th>Polygon Name</th>
                <th style="text-align:right">Square Footage</th>
              </tr>
            </thead>
            <tbody>
              ${polygonRows}
            </tbody>
            <tfoot>
              <tr>
                <td colspan="2" style="font-weight:700;border-top:2px solid var(--gray-200);padding-top:10px">Total</td>
                <td style="text-align:right;font-weight:700;border-top:2px solid var(--gray-200);padding-top:10px">${formatNumber(summary.totalSquareFootage)} SF</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    `;

    showOverlay(html);

    document.getElementById('xps-back-btn').addEventListener('click', hideSummaryOverlay);
    document.getElementById('xps-print-btn').addEventListener('click', function() { window.print(); });

    // Render mini-map after DOM is ready
    setTimeout(() => {
      renderMiniMap('xps-mini-map-single', [summary.polygonIds], ['#14b8a6']);
    }, 100);
  }

  // ── Print shortcut (generate + print in one step) ──────────────────────────
  function printGroupSummary(id) {
    const group = groups.find(g => g.id === id);
    if (!group) return;
    showGroupSummary(id);
    // slight delay so the overlay renders before print dialog
    setTimeout(() => { window.print(); }, 300);
  }

  // ── Comparison summary view ─────────────────────────────────────────────────
  function showComparisonSummary() {
    if (groups.length < 2) {
      showToast('Save at least two groups to compare', 'error');
      return;
    }

    const assumptions = getAssumptions();
    const summaries = groups.map(g => buildGroupSummary(g, allFeatures, assumptions));

    const GROUP_COLORS = ['#14b8a6', '#6366f1', '#f59e0b', '#22c55e', '#ef4444', '#8b5cf6', '#0ea5e9', '#f97316'];

    const comparisonRows = summaries.map(s => {
      const paybackStr = s.paybackStr;
      return `<tr>
        <td>${escapeHtml(s.groupName)}</td>
        <td>${s.polygonCount}</td>
        <td>${formatNumber(s.totalSquareFootage)}</td>
        <td>${formatCurrency(s.estimatedConversionCost)}</td>
        <td>${s.estimatedAnnualWaterSavings > 0 ? formatCurrency(s.estimatedAnnualWaterSavings) + '/yr' : '—'}</td>
        <td>${paybackStr}</td>
      </tr>`;
    }).join('');

    const detailSections = summaries.map((s, idx) => {
      const color = GROUP_COLORS[idx % GROUP_COLORS.length];
      const polygonRows = s.polygonDetails.map((p, i) => `
        <tr>
          <td style="color:var(--gray-500);font-size:12px">${i + 1}</td>
          <td>${escapeHtml(p.name)}</td>
          <td style="text-align:right">${formatNumber(p.sqft)}</td>
        </tr>
      `).join('');

      return `
        <div class="xps-group-detail-section">
          <div class="xps-section-title" style="border-left:4px solid ${color};padding-left:10px">${escapeHtml(s.groupName)}</div>
          <table class="xps-table" style="margin-bottom:0">
            <thead>
              <tr>
                <th style="width:32px">#</th>
                <th>Polygon Name</th>
                <th style="text-align:right">Square Footage</th>
              </tr>
            </thead>
            <tbody>${polygonRows}</tbody>
            <tfoot>
              <tr>
                <td colspan="2" style="font-weight:700;border-top:2px solid var(--gray-200);padding-top:10px">Total</td>
                <td style="text-align:right;font-weight:700;border-top:2px solid var(--gray-200);padding-top:10px">${formatNumber(s.totalSquareFootage)} SF</td>
              </tr>
            </tfoot>
          </table>
        </div>
      `;
    }).join('');

    const html = `
      <div>
        <div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:4px" class="xps-no-print">
          <button class="xps-back-btn" id="xps-back-btn">&#8592; Back to Planner</button>
          <button class="xps-print-btn" id="xps-print-btn">&#128438; Print Comparison</button>
        </div>

        <div class="xps-header">
          <div class="xps-property">${escapeHtml(PROPERTY_NAME)}</div>
          <h1 class="xps-title">Scenario Comparison &mdash; All Groups <span class="xps-admin-badge">Admin Planning Tool &mdash; Internal Use Only</span></h1>
          <div class="xps-meta">
            <span class="xps-meta-item"><strong>Generated:</strong>&nbsp;${formatDate(new Date())}</span>
            <span class="xps-meta-item"><strong>Groups compared:</strong>&nbsp;${groups.length}</span>
          </div>
        </div>

        <div class="xps-block" style="page-break-inside:avoid">
          <div class="xps-section-title">Side-by-Side Comparison</div>
          <div style="overflow-x:auto">
            <table class="xps-table xps-compare-table">
              <thead>
                <tr>
                  <th style="text-align:left">Group Name</th>
                  <th>Polygons</th>
                  <th>Total SF</th>
                  <th>Est. Cost</th>
                  <th>Annual Savings</th>
                  <th>Payback</th>
                </tr>
              </thead>
              <tbody>${comparisonRows}</tbody>
            </table>
          </div>
        </div>

        <div class="xps-map-container xps-no-print">
          <div id="xps-mini-map-compare" style="height:260px"></div>
          <div class="xps-map-label">Planning reference map — all groups shown. Not to scale.</div>
        </div>
        <div class="xps-map-print-placeholder">Map preview omitted from print. See digital summary for spatial reference.</div>

        ${renderAssumptionsBlock(assumptions)}

        <div class="xps-block">
          <div class="xps-section-title">Polygon Detail by Group</div>
          ${detailSections}
        </div>
      </div>
    `;

    showOverlay(html);

    document.getElementById('xps-back-btn').addEventListener('click', hideSummaryOverlay);
    document.getElementById('xps-print-btn').addEventListener('click', function() { window.print(); });

    // Render comparison mini-map
    setTimeout(() => {
      const polygonIdSets = summaries.map(s => s.polygonIds);
      const colorSets = summaries.map((_, i) => GROUP_COLORS[i % GROUP_COLORS.length]);
      renderMiniMap('xps-mini-map-compare', polygonIdSets, colorSets);
    }, 100);
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
