AdminRouter.register('xeriscape-planner', async function(container) {
  const { apiFetch, showToast } = AdminAPI;

  const DEFAULT_COST_PER_SF = 6.00;
  const DEFAULT_SAVINGS_PER_SF = 0.50;

  const breadcrumb = document.getElementById('breadcrumb-area');
  if (breadcrumb) breadcrumb.innerHTML = '';

  container.innerHTML = `
    <div class="page-header" style="margin-bottom:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
        <div style="flex:1;min-width:0">
          <h1 style="font-size:22px;font-weight:700;color:var(--navy);margin:0">Xeriscape Conversion Planner</h1>
          <p id="xp-header-subtitle" style="font-size:13px;color:var(--gray-500);margin:4px 0 0">Select a community to begin planning</p>
        </div>
        <div style="display:flex;gap:8px;align-items:center" id="xp-toolbar-actions">
          <span id="xp-loaded-record-badge" style="display:none;font-size:11px;font-weight:700;background:var(--teal);color:#fff;padding:3px 10px;border-radius:20px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>
          <button id="xp-new-session-btn" class="btn btn-secondary btn-sm" style="display:none">New Session</button>
          <button id="xp-save-record-btn" class="btn btn-sm" style="background:var(--navy);color:#fff;border:none;border-radius:var(--radius);cursor:pointer;font-size:12px;font-weight:600;padding:6px 14px">&#128190; Save Record</button>
        </div>
      </div>
    </div>

    <!-- Community Selector -->
    <div id="xp-community-selector-wrap" style="margin-bottom:20px">
      <div class="xp-card" style="padding:14px 16px">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <label style="font-size:13px;font-weight:600;color:var(--navy);white-space:nowrap">Community</label>
          <div style="position:relative;flex:1;min-width:200px;max-width:380px">
            <select id="xp-community-select" class="form-input" style="width:100%;padding-right:32px;appearance:none;-webkit-appearance:none">
              <option value="">— Select a community —</option>
            </select>
            <span style="position:absolute;right:10px;top:50%;transform:translateY(-50%);pointer-events:none;color:var(--gray-400)">▾</span>
          </div>
          <div id="xp-community-loading" style="display:none;font-size:12px;color:var(--gray-400)">Loading communities…</div>
        </div>
      </div>
    </div>

    <!-- Pre-selection empty state -->
    <div id="xp-no-community-state" style="display:flex;align-items:center;justify-content:center;min-height:400px">
      <div style="text-align:center;max-width:400px">
        <div style="font-size:40px;margin-bottom:16px">🌿</div>
        <div style="font-size:16px;font-weight:700;color:var(--navy);margin-bottom:8px">Select a community to begin</div>
        <div style="font-size:13px;color:var(--gray-500);line-height:1.6">Select a community to load mapped bluegrass areas for xeriscape planning.</div>
      </div>
    </div>

    <!-- Planner main layout (hidden until community selected) -->
    <div id="xp-planner-main" style="display:none;gap:20px;height:calc(100vh - 240px);min-height:500px" class="xp-planner-flex">
      <div style="flex:1;min-width:0;position:relative;border-radius:var(--radius);overflow:hidden;box-shadow:var(--shadow-md);border:1px solid var(--gray-200)">
        <div id="xp-map" style="width:100%;height:100%;background:#e8eef4"></div>
        <div id="xp-map-loading" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(240,244,248,0.85);z-index:1000;font-size:14px;color:var(--gray-500)">
          <div style="text-align:center">
            <div style="margin-bottom:8px;font-size:24px">🌿</div>
            Loading polygons&hellip;
          </div>
        </div>
        <!-- No polygons empty state overlay -->
        <div id="xp-no-polygons-state" style="display:none;position:absolute;inset:0;z-index:900;background:rgba(240,244,248,0.97);align-items:center;justify-content:center">
          <div style="text-align:center;max-width:360px;padding:24px">
            <div style="font-size:36px;margin-bottom:12px">🗺️</div>
            <div style="font-size:15px;font-weight:700;color:var(--navy);margin-bottom:8px">No mapped bluegrass areas found</div>
            <div style="font-size:13px;color:var(--gray-500);line-height:1.6">No mapped bluegrass areas were found for this community. Add or sync bluegrass polygons in the Community layer to use the Xeriscape Planner.</div>
          </div>
        </div>
      </div>
      <div id="xp-right-panel" style="width:320px;flex-shrink:0;display:flex;flex-direction:column;gap:16px;position:sticky;top:0;max-height:calc(100vh - 240px);overflow-y:auto;padding-right:2px">

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
            <strong>How to use:</strong> Click polygons on the map to select them. Keep clicking to build a multi-polygon selection. Adjust assumptions to update estimates instantly. Save named groups to compare scenarios side by side. Use "Save Record" to persist the entire planning session to the database.
          </div>
        </div>
      </div>
    </div>

    <!-- Summary overlay (hidden by default) -->
    <div id="xp-summary-overlay" style="display:none;position:fixed;inset:0;z-index:9000;background:#f8fafc;overflow-y:auto">
      <div id="xp-summary-content" style="max-width:860px;margin:0 auto;padding:40px 32px 80px"></div>
    </div>

    <!-- Planning History section (below map) -->
    <div id="xp-history-section" style="margin-top:24px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <h2 style="font-size:16px;font-weight:700;color:var(--navy);margin:0">Planning History</h2>
        <button id="xp-refresh-history-btn" class="btn btn-secondary btn-sm">&#8635; Refresh</button>
      </div>
      <div id="xp-history-content">
        <div style="font-size:13px;color:var(--gray-400);padding:24px 0;text-align:center">Loading records&hellip;</div>
      </div>
    </div>

    <!-- Save Record Modal -->
    <div id="xp-save-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9000;align-items:center;justify-content:center">
      <div style="background:#fff;border-radius:var(--radius);padding:28px;width:440px;max-width:95vw;box-shadow:0 20px 60px rgba(0,0,0,0.25)">
        <div style="font-size:16px;font-weight:700;color:var(--navy);margin-bottom:18px" id="xp-save-modal-title">Save Planning Record</div>
        <div style="margin-bottom:12px">
          <label class="xp-label" style="display:block;margin-bottom:4px">Record Name <span style="color:#dc2626">*</span></label>
          <input type="text" id="xp-modal-record-name" class="form-input" placeholder="e.g. North Lawn Full Conversion — Mar 2026">
        </div>
        <div style="margin-bottom:18px">
          <label class="xp-label" style="display:block;margin-bottom:4px">Internal Notes (optional)</label>
          <textarea id="xp-modal-notes" class="form-input" rows="3" placeholder="Add any notes about this scenario…" style="resize:vertical"></textarea>
        </div>
        <div id="xp-save-modal-error" style="display:none;font-size:12px;color:#dc2626;margin-bottom:10px"></div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button id="xp-save-modal-cancel" class="btn btn-secondary btn-sm">Cancel</button>
          <button id="xp-save-modal-confirm" class="btn btn-sm" style="background:var(--navy);color:#fff;border:none;border-radius:var(--radius);cursor:pointer;font-size:12px;font-weight:600;padding:6px 16px">Save</button>
        </div>
      </div>
    </div>

    <!-- Selected-for-Estimate Warning Modal -->
    <div id="xp-warn-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9000;align-items:center;justify-content:center">
      <div style="background:#fff;border-radius:var(--radius);padding:28px;width:420px;max-width:95vw;box-shadow:0 20px 60px rgba(0,0,0,0.25)">
        <div style="font-size:16px;font-weight:700;color:#b45309;margin-bottom:12px">&#9888; Record Selected for Estimate</div>
        <p style="font-size:13px;color:var(--gray-600);margin:0 0 18px">This record is already marked <strong>Selected for Estimate</strong>. Editing it directly may affect your proposal pipeline. What would you like to do?</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button id="xp-warn-edit-btn" class="btn btn-sm" style="background:#b45309;color:#fff;border:none;border-radius:var(--radius);cursor:pointer;font-size:12px;font-weight:600;padding:6px 14px">Edit Directly</button>
          <button id="xp-warn-duplicate-btn" class="btn btn-sm" style="background:var(--teal);color:#fff;border:none;border-radius:var(--radius);cursor:pointer;font-size:12px;font-weight:600;padding:6px 14px">Duplicate First</button>
          <button id="xp-warn-cancel-btn" class="btn btn-secondary btn-sm">Cancel</button>
        </div>
      </div>
    </div>

    <!-- Planning Packet Overlay (full screen) -->
    <div id="xp-packet-overlay" style="display:none;position:fixed;inset:0;z-index:9100;background:#f0f4f8;overflow-y:auto">
      <div id="xp-packet-content" style="max-width:900px;margin:0 auto;padding:32px 24px 100px"></div>
    </div>

    <style>
      .xp-planner-flex { display: flex; }
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
        .page-header,
        #xp-community-selector-wrap,
        .xpk-toolbar {
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
        #xp-packet-overlay {
          position: static !important;
          background: #fff !important;
          overflow: visible !important;
        }
        #xp-packet-content {
          max-width: 100% !important;
          padding: 20px !important;
        }
        body, #app, #main-content, #page-content {
          overflow: visible !important;
        }
        .xps-kpi-card,
        .xps-block,
        .xps-group-detail-section,
        .xps-map-container,
        .xpk-section {
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
        .xpk-narrative-display { display: block !important; }
        .xpk-narrative-edit { display: none !important; }
      }
      .xps-map-print-placeholder { display: none; }

      /* ── Planning Packet styles ─────────────────── */
      .xpk-header {
        background: var(--navy);
        color: #fff;
        border-radius: var(--radius);
        padding: 28px 32px;
        margin-bottom: 24px;
      }
      .xpk-header-community {
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 1.2px;
        color: rgba(255,255,255,0.6);
        margin-bottom: 6px;
      }
      .xpk-header-title {
        font-size: 24px;
        font-weight: 700;
        color: #fff;
        margin: 0 0 8px;
        line-height: 1.2;
      }
      .xpk-header-meta {
        display: flex;
        gap: 18px;
        flex-wrap: wrap;
        font-size: 12px;
        color: rgba(255,255,255,0.75);
        margin-top: 10px;
      }
      .xpk-status-badge {
        display: inline-block;
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.8px;
        background: rgba(255,255,255,0.18);
        color: #fff;
        border: 1px solid rgba(255,255,255,0.3);
        border-radius: 20px;
        padding: 3px 10px;
        margin-left: 10px;
        vertical-align: middle;
      }
      .xpk-admin-badge {
        display: inline-block;
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.8px;
        background: #fef9c3;
        color: #854d0e;
        border: 1px solid #fde68a;
        border-radius: 4px;
        padding: 2px 8px;
        margin-left: 8px;
        vertical-align: middle;
      }
      .xpk-section {
        background: var(--white);
        border: 1px solid var(--gray-200);
        border-radius: var(--radius);
        padding: 20px 24px;
        margin-bottom: 20px;
        page-break-inside: avoid;
      }
      .xpk-section-title {
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.7px;
        color: var(--gray-400);
        margin: 0 0 16px;
        padding-bottom: 10px;
        border-bottom: 1px solid var(--gray-100);
      }
      .xpk-kpi-row {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: 14px;
        margin-bottom: 4px;
      }
      .xpk-kpi-card {
        background: var(--gray-50);
        border: 1px solid var(--gray-100);
        border-radius: 8px;
        padding: 14px 16px;
      }
      .xpk-kpi-label {
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.6px;
        color: var(--gray-400);
        margin-bottom: 6px;
      }
      .xpk-kpi-value {
        font-size: 22px;
        font-weight: 700;
        color: var(--navy);
        line-height: 1;
      }
      .xpk-kpi-value.accent { color: var(--teal); }
      .xpk-narrative-area {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid var(--gray-200);
        border-radius: 6px;
        padding: 10px 12px;
        font-size: 13px;
        color: var(--gray-700);
        line-height: 1.6;
        resize: vertical;
        min-height: 70px;
        background: #fafafa;
        font-family: inherit;
        outline: none;
        transition: border-color 0.15s;
      }
      .xpk-narrative-area:focus { border-color: var(--teal); background: #fff; }
      .xpk-narrative-label {
        font-size: 11px;
        font-weight: 700;
        color: var(--gray-500);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin: 0 0 5px;
        display: block;
      }
      .xpk-narrative-display {
        font-size: 13px;
        color: var(--gray-700);
        line-height: 1.7;
        white-space: pre-wrap;
        font-style: italic;
        display: none;
      }
      .xpk-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
      }
      .xpk-table th {
        text-align: left;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--gray-400);
        padding: 6px 10px;
        border-bottom: 2px solid var(--gray-200);
        white-space: nowrap;
      }
      .xpk-table td {
        padding: 8px 10px;
        border-bottom: 1px solid var(--gray-100);
        color: var(--navy);
        vertical-align: top;
      }
      .xpk-table tr:last-child td { border-bottom: none; }
      .xpk-table td.right, .xpk-table th.right { text-align: right; }
      .xpk-disclaimer {
        background: var(--gray-50);
        border: 1px solid var(--gray-200);
        border-radius: var(--radius);
        padding: 16px 20px;
        margin-bottom: 20px;
      }
      .xpk-disclaimer-title {
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.6px;
        color: var(--gray-400);
        margin-bottom: 8px;
      }
      .xpk-disclaimer-text {
        font-size: 12px;
        color: var(--gray-500);
        line-height: 1.6;
        font-style: italic;
      }
      .xpk-toolbar {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        margin-bottom: 24px;
      }
      .xpk-save-status {
        font-size: 12px;
        color: var(--gray-400);
        margin-left: auto;
      }
      .xpk-group-color-dot {
        display: inline-block;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        margin-right: 6px;
        vertical-align: middle;
      }
      .xpk-packet-badge {
        display: inline-block;
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        background: #7c3aed;
        color: #fff;
        padding: 2px 8px;
        border-radius: 20px;
        margin-left: 6px;
      }

      /* ── Record styles ──────────────────────────── */
      .xp-record-row {
        background: var(--white);
        border: 1px solid var(--gray-200);
        border-radius: var(--radius);
        padding: 14px 16px;
        display: flex;
        align-items: flex-start;
        gap: 12px;
        transition: border-color 0.15s;
      }
      .xp-record-row.xp-record-selected { border-color: #16a34a; border-left: 4px solid #16a34a; }
      .xp-record-row.xp-record-archived { opacity: 0.55; }
      .xp-record-name { font-size: 13px; font-weight: 700; color: var(--navy); margin-bottom: 4px; }
      .xp-record-meta { font-size: 11px; color: var(--gray-500); display: flex; flex-wrap: wrap; gap: 6px 14px; margin-bottom: 8px; }
      .xp-status-badge {
        display: inline-block;
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        padding: 2px 8px;
        border-radius: 20px;
      }
      .xp-status-draft { background: #f1f5f9; color: #64748b; }
      .xp-status-reviewed { background: #dbeafe; color: #1d4ed8; }
      .xp-status-selected_for_estimate { background: #dcfce7; color: #16a34a; }
      .xp-status-archived { background: #f3f4f6; color: #9ca3af; }
      .xp-record-actions { display: flex; flex-wrap: wrap; gap: 5px; }
      .xp-record-btn {
        font-size: 11px;
        font-weight: 600;
        padding: 3px 9px;
        border-radius: 4px;
        border: 1px solid var(--gray-200);
        background: var(--white);
        color: var(--gray-600);
        cursor: pointer;
        transition: background 0.12s;
      }
      .xp-record-btn:hover { background: var(--gray-100); }
      .xp-record-btn.xp-btn-open { border-color: var(--navy); color: var(--navy); }
      .xp-record-btn.xp-btn-open:hover { background: var(--navy); color: #fff; }
      .xp-record-btn.xp-btn-select { border-color: #16a34a; color: #16a34a; }
      .xp-record-btn.xp-btn-select:hover { background: #dcfce7; }
      .xp-record-btn.xp-btn-proposal { border-color: #7c3aed; color: #7c3aed; }
      .xp-record-btn.xp-btn-proposal:hover { background: #ede9fe; }
      .xp-record-btn.xp-btn-archive { border-color: var(--gray-300); color: var(--gray-500); }
      .xp-record-btn.xp-btn-delete { border-color: #dc2626; color: #dc2626; }
      .xp-record-btn.xp-btn-delete:hover { background: #fef2f2; }
      #xp-no-polygons-state { display: none; }
      #xp-no-polygons-state.xp-visible { display: flex !important; }
    </style>
  `;

  // ── Active community state ────────────────────────────────────────────────
  let activeCommunityId = null;
  let activeCommunityName = null;

  // ── Per-session state (reset on community switch) ─────────────────────────
  const selectedIds = new Set();
  let allFeatures = [];
  let leafletLayers = {};
  let map = null;
  let groups = [];
  let highlightedGroupId = null;
  let summaryMiniMaps = [];   // track mini-map instances for cleanup
  let loadedRecordId = null;
  let isSaving = false;

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

  function formatDateShort(isoStr) {
    if (!isoStr) return '—';
    const d = new Date(isoStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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

  function statusLabel(status) {
    const map = {
      draft: "Draft",
      reviewed: "Reviewed",
      selected_for_estimate: "Selected for Estimate",
      archived: "Archived",
    };
    return map[status] || status;
  }

  function paybackStr(years) {
    if (years === null || years === undefined) return "u2014";
    if (years < 1) return "< 1 yr";
    return years.toFixed(1) + " yrs";
  }

  // u2500u2500 Community selector u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500
  async function loadCommunities() {
    const loadingEl = document.getElementById('xp-community-loading');
    const select = document.getElementById('xp-community-select');
    if (loadingEl) loadingEl.style.display = 'inline';

    try {
      const data = await apiFetch('/api/communities');
      const communities = Array.isArray(data) ? data : (data.communities || []);
      if (select) {
        communities.forEach(c => {
          const opt = document.createElement('option');
          opt.value = c.id;
          opt.textContent = c.name;
          select.appendChild(opt);
        });
      }
    } catch (err) {
      showToast('Failed to load communities', 'error');
    } finally {
      if (loadingEl) loadingEl.style.display = 'none';
    }
  }

  function updateHeaderSubtitle() {
    const subtitle = document.getElementById('xp-header-subtitle');
    if (!subtitle) return;
    if (activeCommunityName) {
      subtitle.textContent = activeCommunityName + ' \u00b7 Bluegrass Areas';
    } else {
      subtitle.textContent = 'Select a community to begin planning';
    }
  }

  // ── Reset all transient state on community switch ──────────────────────────
  function resetPlannerState() {
    selectedIds.clear();
    allFeatures = [];
    leafletLayers = {};
    groups = [];
    highlightedGroupId = null;
    summaryMiniMaps.forEach(m => { try { m.remove(); } catch {} });
    summaryMiniMaps = [];
    hideSummaryOverlay();

    // Clear map layers
    if (map) {
      map.eachLayer(function(layer) {
        if (layer._url) return; // skip tile layer
        try { map.removeLayer(layer); } catch {}
      });
    }

    // Reset UI
    const countEl = document.getElementById('xp-count');
    if (countEl) countEl.textContent = '0';
    const areaEl = document.getElementById('xp-area');
    if (areaEl) areaEl.textContent = '0';
    const estCostEl = document.getElementById('xp-est-cost');
    if (estCostEl) estCostEl.textContent = '\u2014';
    const estSavingsEl = document.getElementById('xp-est-savings');
    if (estSavingsEl) estSavingsEl.textContent = '\u2014';
    const estPaybackEl = document.getElementById('xp-est-payback');
    if (estPaybackEl) estPaybackEl.textContent = '\u2014';

    const clearBtn = document.getElementById('xp-clear-btn');
    if (clearBtn) clearBtn.disabled = true;
    const saveGroupBtn = document.getElementById('xp-save-group-btn');
    if (saveGroupBtn) saveGroupBtn.disabled = true;

    hideSaveGroupForm();
    renderGroupsPanel();
    renderComparisonPanel();

    // Hide no-polygons state
    const noPolygons = document.getElementById('xp-no-polygons-state');
    if (noPolygons) noPolygons.classList.remove('xp-visible');

    // Show map loading
    const loadingEl = document.getElementById('xp-map-loading');
    if (loadingEl) loadingEl.style.display = 'flex';

    updateLoadedBadge(null);
  }

  async function onCommunityChange(communityId, communityName) {
    activeCommunityId = communityId;
    activeCommunityName = communityName;
    updateHeaderSubtitle();

    if (!communityId) {
      document.getElementById('xp-planner-main').style.display = 'none';
      document.getElementById('xp-no-community-state').style.display = 'flex';
      return;
    }

    document.getElementById('xp-no-community-state').style.display = 'none';
    document.getElementById('xp-planner-main').style.display = 'flex';

    resetPlannerState();

    // init map if needed
    if (!map) {
      await ensureMapInit();
    }

    await loadCommunityPolygons(communityId);
    await loadHistory();
  }

  // ── Map initialization ─────────────────────────────────────────────────────
  async function ensureMapInit() {
    if (map) return;

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
  }

  async function loadCommunityPolygons(communityId) {
    const loadingEl = document.getElementById('xp-map-loading');
    const noPolygonsEl = document.getElementById('xp-no-polygons-state');
    if (loadingEl) loadingEl.style.display = 'flex';
    if (noPolygonsEl) noPolygonsEl.classList.remove('xp-visible');

    try {
      const geojson = await apiFetch('/api/admin/xeriscape/community/' + communityId + '/polygons');
      allFeatures = geojson.features || [];
      const assetsFound = geojson.assetsFound ?? allFeatures.length;
      const featuresResolved = geojson.featuresResolved ?? allFeatures.length;

      if (allFeatures.length === 0) {
        if (loadingEl) loadingEl.style.display = 'none';
        if (noPolygonsEl) {
          if (assetsFound > 0 && featuresResolved === 0) {
            noPolygonsEl.innerHTML = `
              <div style="text-align:center;max-width:400px;padding:24px">
                <div style="font-size:36px;margin-bottom:12px">⚠️</div>
                <div style="font-size:15px;font-weight:700;color:var(--navy);margin-bottom:8px">Bluegrass areas found but geometry couldn't be resolved</div>
                <div style="font-size:13px;color:var(--gray-500);line-height:1.6">Found ${assetsFound} bluegrass area${assetsFound !== 1 ? 's' : ''} for this community, but their map geometry could not be resolved. Check that the community layer has GeoJSON data uploaded and that feature IDs match.</div>
              </div>`;
          } else {
            noPolygonsEl.innerHTML = `
              <div style="text-align:center;max-width:360px;padding:24px">
                <div style="font-size:36px;margin-bottom:12px">🗺️</div>
                <div style="font-size:15px;font-weight:700;color:var(--navy);margin-bottom:8px">No mapped bluegrass areas found</div>
                <div style="font-size:13px;color:var(--gray-500);line-height:1.6">No mapped bluegrass areas were found for this community. Add or sync bluegrass polygons in the Community layer to use the Xeriscape Planner.</div>
              </div>`;
          }
          noPolygonsEl.classList.add('xp-visible');
        }
        return;
      }

      const bounds = L.latLngBounds([]);

      allFeatures.forEach(feature => {
        const id = feature.properties.id;

        const layer = L.geoJSON(feature, {
          style: () => getLayerStyle(id),
          onEachFeature: function(feat, lyr) {
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

      if (loadingEl) loadingEl.style.display = 'none';

    } catch (err) {
      showToast('Failed to load polygons: ' + err.message, 'error');
      if (loadingEl) loadingEl.style.display = 'none';
    }
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
  function buildGroupSummary(group, polygonFeatures, assumptions, opts) {
    opts = opts || {};
    const propertyName = opts.propertyName !== undefined ? opts.propertyName : (activeCommunityName || 'Community');
    const generatedDate = opts.generatedDate !== undefined ? opts.generatedDate : formatDate(new Date());

    const pbStr = group.estimatedPaybackYears === null
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
      paybackStr: pbStr,
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

  // ── Planner aggregate totals ───────────────────────────────────────────────
  function computePlannerTotals() {
    const totalSqft = groups.reduce((s, g) => s + (g.totalSquareFootage || 0), 0);
    const totalEstimatedCost = groups.reduce((s, g) => s + (g.estimatedConversionCost || 0), 0);
    const totalAnnualSavings = groups.reduce((s, g) => s + (g.estimatedAnnualWaterSavings || 0), 0);
    const paybackYears = totalAnnualSavings > 0 ? totalEstimatedCost / totalAnnualSavings : null;
    return { totalSqft, totalEstimatedCost, totalAnnualSavings, paybackYears };
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
  function updateSelectionBadges() {
    const orderedIds = [...selectedIds];
    allFeatures.forEach(feature => {
      const id = feature.properties.id;
      const layer = leafletLayers[id];
      if (!layer) return;
      const idx = orderedIds.indexOf(id);
      layer.eachLayer(function(lyr) {
        if (idx >= 0) {
          lyr.bindTooltip(String(idx + 1), { permanent: true, direction: 'center', className: 'xp-tooltip' });
        } else {
          lyr.unbindTooltip();
        }
      });
    });
  }

  function toggleSelection(id) {
    if (selectedIds.has(id)) {
      selectedIds.delete(id);
    } else {
      selectedIds.add(id);
    }
    applyLayerStyle(id);
    updateSelectionBadges();
    recalculate();
  }

  function clearSelection() {
    const prev = [...selectedIds];
    selectedIds.clear();
    prev.forEach(id => applyLayerStyle(id));
    updateSelectionBadges();
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
      document.getElementById('xp-est-cost').textContent = '\u2014';
      document.getElementById('xp-est-savings').textContent = '\u2014';
      document.getElementById('xp-est-payback').textContent = '\u2014';
      return;
    }

    const estCost = totalArea * costPerSf;
    const estSavings = totalArea * savingsPerSf;

    document.getElementById('xp-est-cost').textContent = formatCurrency(estCost);
    document.getElementById('xp-est-savings').textContent = estSavings > 0 ? formatCurrency(estSavings) + '/yr' : '\u2014';

    if (estSavings <= 0) {
      document.getElementById('xp-est-payback').textContent = '\u2014';
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

  // ── Loaded record badge ────────────────────────────────────────────────────
  function updateLoadedBadge(record) {
    const badge = document.getElementById('xp-loaded-record-badge');
    const newBtn = document.getElementById('xp-new-session-btn');
    if (record) {
      loadedRecordId = record.id;
      if (badge) { badge.textContent = '✎ ' + record.recordName; badge.style.display = 'inline-block'; }
      if (newBtn) newBtn.style.display = 'inline-block';
    } else {
      loadedRecordId = null;
      if (badge) badge.style.display = 'none';
      if (newBtn) newBtn.style.display = 'none';
    }
  }

  function startNewSession() {
    loadedRecordId = null;
    groups = [];
    selectedIds.clear();
    highlightedGroupId = null;
    refreshAllLayerStyles();
    updateSelectionBadges();
    recalculate();
    renderGroupsPanel();
    renderComparisonPanel();
    updateLoadedBadge(null);
    showToast('New session started', 'success');
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
      communityId: activeCommunityId,
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

      const pb = group.estimatedPaybackYears === null
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
          <span style="grid-column:1/-1">Payback: <strong>${pb}</strong></span>
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
      const pb = g.estimatedPaybackYears === null
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
        <td style="text-align:right">${pb}</td>
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
            <div class="xps-kpi-value accent">${summary.estimatedAnnualWaterSavings > 0 ? formatCurrency(summary.estimatedAnnualWaterSavings) + '/yr' : '\u2014'}</div>
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

    setTimeout(() => {
      renderMiniMap('xps-mini-map-single', [summary.polygonIds], ['#14b8a6']);
    }, 100);
  }

  // ── Print shortcut ─────────────────────────────────────────────────────────
  function printGroupSummary(id) {
    const group = groups.find(g => g.id === id);
    if (!group) return;
    showGroupSummary(id);
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
      const pb = s.paybackStr;
      return `<tr>
        <td>${escapeHtml(s.groupName)}</td>
        <td>${s.polygonCount}</td>
        <td>${formatNumber(s.totalSquareFootage)}</td>
        <td>${formatCurrency(s.estimatedConversionCost)}</td>
        <td>${s.estimatedAnnualWaterSavings > 0 ? formatCurrency(s.estimatedAnnualWaterSavings) + '/yr' : '—'}</td>
        <td>${pb}</td>
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
          <div class="xps-property">${escapeHtml(activeCommunityName || 'Community')}</div>
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

    setTimeout(() => {
      const polygonIdSets = summaries.map(s => s.polygonIds);
      const colorSets = summaries.map((_, i) => GROUP_COLORS[i % GROUP_COLORS.length]);
      renderMiniMap('xps-mini-map-compare', polygonIdSets, colorSets);
    }, 100);
  }

  // ── Save Record Modal ──────────────────────────────────────────────────────
  function openSaveModal(prefillRecord) {
    const modal = document.getElementById('xp-save-modal');
    const nameEl = document.getElementById('xp-modal-record-name');
    const notesEl = document.getElementById('xp-modal-notes');
    const titleEl = document.getElementById('xp-save-modal-title');
    const errEl = document.getElementById('xp-save-modal-error');

    if (prefillRecord) {
      titleEl.textContent = 'Update Planning Record';
      nameEl.value = prefillRecord.recordName || '';
      notesEl.value = prefillRecord.internalNotes || '';
    } else {
      titleEl.textContent = 'Save Planning Record';
      nameEl.value = '';
      notesEl.value = '';
    }

    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
    modal.style.display = 'flex';
    setTimeout(() => { if (nameEl) nameEl.focus(); }, 50);
  }

  function closeSaveModal() {
    const modal = document.getElementById('xp-save-modal');
    if (modal) modal.style.display = 'none';
  }

  async function confirmSaveRecord() {
    if (isSaving) return;
    const nameEl = document.getElementById('xp-modal-record-name');
    const notesEl = document.getElementById('xp-modal-notes');
    const errEl = document.getElementById('xp-save-modal-error');

    const name = (nameEl ? nameEl.value : '').trim();
    const notes = (notesEl ? notesEl.value : '').trim();

    if (!name) {
      if (errEl) { errEl.textContent = 'Record name is required.'; errEl.style.display = 'block'; }
      nameEl && nameEl.focus();
      return;
    }

    const assumptions = getAssumptions();
    const { totalSqft, totalEstimatedCost, totalAnnualSavings, paybackYears } = computePlannerTotals();

    const payload = {
      propertyId: activeCommunityId,
      recordName: name,
      internalNotes: notes || null,
      assumptionsJson: assumptions,
      groupsJson: groups.map(g => ({
        id: g.id,
        name: g.name,
        polygonIds: g.polygonIds,
        polygonCount: g.polygonCount,
        totalSquareFootage: g.totalSquareFootage,
        estimatedConversionCost: g.estimatedConversionCost,
        estimatedAnnualWaterSavings: g.estimatedAnnualWaterSavings,
        estimatedPaybackYears: g.estimatedPaybackYears,
      })),
      totalSqft,
      totalEstimatedCost,
      totalAnnualSavings,
      paybackYears,
    };

    isSaving = true;
    const confirmBtn = document.getElementById('xp-save-modal-confirm');
    if (confirmBtn) confirmBtn.disabled = true;

    try {
      let saved;
      if (loadedRecordId) {
        saved = await apiFetch('/api/admin/xeriscape/records/' + loadedRecordId, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        saved = await apiFetch('/api/admin/xeriscape/records', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      closeSaveModal();
      updateLoadedBadge(saved);
      showToast('Record "' + saved.recordName + '" saved', 'success');
      loadHistory();
    } catch (err) {
      if (errEl) { errEl.textContent = err.message || 'Save failed.'; errEl.style.display = 'block'; }
    } finally {
      isSaving = false;
      if (confirmBtn) confirmBtn.disabled = false;
    }
  }

  // ── Load record into live planner ──────────────────────────────────────────
  async function openRecord(record) {
    if (record.status === 'selected_for_estimate') {
      showWarnModal(record);
      return;
    }
    loadRecordIntoPlanner(record);
  }

  function loadRecordIntoPlanner(record) {
    const assumptions = record.assumptionsJson || {};
    const costEl = document.getElementById('xp-cost-per-sf');
    const savingsEl = document.getElementById('xp-savings-per-sf');
    if (costEl && assumptions.costPerSf !== undefined) costEl.value = assumptions.costPerSf;
    if (savingsEl && assumptions.savingsPerSf !== undefined) savingsEl.value = assumptions.savingsPerSf;

    const savedGroups = Array.isArray(record.groupsJson) ? record.groupsJson : [];
    groups = savedGroups.map(g => ({
      id: g.id || genId(),
      name: g.name,
      polygonIds: g.polygonIds || [],
      polygonCount: g.polygonCount || 0,
      totalSquareFootage: g.totalSquareFootage || 0,
      estimatedConversionCost: g.estimatedConversionCost || 0,
      estimatedAnnualWaterSavings: g.estimatedAnnualWaterSavings || 0,
      estimatedPaybackYears: g.estimatedPaybackYears,
      createdAt: g.createdAt || new Date().toISOString(),
    }));

    selectedIds.clear();
    highlightedGroupId = null;
    refreshAllLayerStyles();
    updateSelectionBadges();
    recalculate();
    recomputeAllGroups();
    renderGroupsPanel();
    renderComparisonPanel();
    updateLoadedBadge(record);
    showToast('Loaded "' + record.recordName + '"', 'success');
  }

  // ── Warning modal (selected_for_estimate) ──────────────────────────────────
  let warnModalRecord = null;

  function showWarnModal(record) {
    warnModalRecord = record;
    const modal = document.getElementById('xp-warn-modal');
    if (modal) modal.style.display = 'flex';
  }

  function closeWarnModal() {
    const modal = document.getElementById('xp-warn-modal');
    if (modal) modal.style.display = 'none';
    warnModalRecord = null;
  }

  // ── Planning Packet Overlay ────────────────────────────────────────────────
  let currentPacketRecord = null;
  let currentPacketData = null;  // saved packet from DB (if any)
  let packetIsSaving = false;

  const GROUP_COLORS = ['#14b8a6', '#6366f1', '#f59e0b', '#22c55e', '#ef4444', '#8b5cf6', '#0ea5e9', '#f97316'];

  function buildProposalPayload(record) {
    const groups_data = Array.isArray(record.groupsJson) ? record.groupsJson : [];
    const assumptions = record.assumptionsJson || {};
    return {
      communityId: record.propertyId,
      communityName: PROPERTY_NAME,
      planningRecordId: record.id,
      planningRecordName: record.recordName,
      status: record.status,
      totals: {
        polygonCount: groups_data.reduce((s, g) => s + (g.polygonCount || 0), 0),
        totalSqft: record.totalSqft,
        estimatedCost: record.totalEstimatedCost,
        annualSavings: record.totalAnnualSavings,
        paybackYears: record.paybackYears,
      },
      assumptions,
      groups: groups_data.map(g => ({
        name: g.name,
        polygonCount: g.polygonCount,
        sqft: g.totalSquareFootage,
        estimatedCost: g.estimatedConversionCost,
        annualSavings: g.estimatedAnnualWaterSavings,
        paybackYears: g.estimatedPaybackYears,
        polygonIds: g.polygonIds || [],
      })),
      polygonDetails: groups_data.flatMap(g =>
        (g.polygonIds || []).map(pid => {
          const feat = allFeatures.find(f => f.properties.id === pid);
          return {
            id: pid,
            name: feat ? (feat.properties.name || pid) : pid,
            sqft: feat ? (feat.properties.area_sqft || 0) : 0,
            group: g.name,
          };
        })
      ),
      packetNotes: null,
      generatedAt: new Date().toISOString(),
    };
  }

  async function openPlanningPacket(record) {
    currentPacketRecord = record;
    currentPacketData = null;

    // Try to load existing packet from DB
    try {
      const packets = await apiFetch('/api/admin/xeriscape/records/' + record.id + '/packets');
      const active = packets.find(p => p.packetStatus === 'active_proposal_support');
      currentPacketData = active || (packets.length > 0 ? packets[0] : null);
    } catch (e) {
      // no packets yet, that's fine
    }

    renderPacketOverlay(record, currentPacketData);
  }

  function renderPacketOverlay(record, savedPacket) {
    const overlay = document.getElementById('xp-packet-overlay');
    const content = document.getElementById('xp-packet-content');
    if (!overlay || !content) return;

    const groups_data = Array.isArray(record.groupsJson) ? record.groupsJson : [];
    const assumptions = record.assumptionsJson || {};
    const genDate = savedPacket ? formatDate(savedPacket.generatedAt) : formatDate(new Date());
    const packetStatus = savedPacket ? savedPacket.packetStatus : null;
    const isActive = packetStatus === 'active_proposal_support';
    const packetTitle = savedPacket ? savedPacket.packetTitle : record.recordName + ' — Planning Packet';

    // Compute totals
    const totalPolygonCount = groups_data.reduce((s, g) => s + (g.polygonCount || 0), 0);
    const totalSqft = record.totalSqft || 0;
    const totalCost = record.totalEstimatedCost || 0;
    const totalSavings = record.totalAnnualSavings || 0;
    const payback = record.paybackYears;

    // Build exec summary KPI cards
    const kpiCards = `
      <div class="xpk-kpi-row">
        <div class="xpk-kpi-card">
          <div class="xpk-kpi-label">Polygons</div>
          <div class="xpk-kpi-value">${totalPolygonCount}</div>
        </div>
        <div class="xpk-kpi-card">
          <div class="xpk-kpi-label">Total Area</div>
          <div class="xpk-kpi-value">${totalSqft > 0 ? formatNumber(totalSqft) : '—'} SF</div>
        </div>
        <div class="xpk-kpi-card">
          <div class="xpk-kpi-label">Conversion Cost</div>
          <div class="xpk-kpi-value">${totalCost > 0 ? formatCurrency(totalCost) : '—'}</div>
        </div>
        <div class="xpk-kpi-card">
          <div class="xpk-kpi-label">Annual Savings</div>
          <div class="xpk-kpi-value accent">${totalSavings > 0 ? formatCurrency(totalSavings) + '/yr' : '—'}</div>
        </div>
        <div class="xpk-kpi-card">
          <div class="xpk-kpi-label">Payback Period</div>
          <div class="xpk-kpi-value">${paybackStr(payback)}</div>
        </div>
      </div>
    `;

    // Build comparison table if multiple groups
    let comparisonSection = '';
    if (groups_data.length >= 2) {
      const compRows = groups_data.map((g, idx) => {
        const color = GROUP_COLORS[idx % GROUP_COLORS.length];
        return `<tr>
          <td style="font-weight:700"><span class="xpk-group-color-dot" style="background:${color}"></span>${escapeHtml(g.name)}</td>
          <td class="right">${g.polygonCount || 0}</td>
          <td class="right">${formatNumber(g.totalSquareFootage || 0)}</td>
          <td class="right">${formatCurrency(g.estimatedConversionCost || 0)}</td>
          <td class="right">${(g.estimatedAnnualWaterSavings || 0) > 0 ? formatCurrency(g.estimatedAnnualWaterSavings) + '/yr' : '—'}</td>
          <td class="right">${paybackStr(g.estimatedPaybackYears)}</td>
        </tr>`;
      }).join('');

      comparisonSection = `
        <div class="xpk-section">
          <div class="xpk-section-title">Phase / Option Comparison</div>
          <div style="overflow-x:auto">
            <table class="xpk-table">
              <thead>
                <tr>
                  <th>Option Name</th>
                  <th class="right">Polygons</th>
                  <th class="right">Total SF</th>
                  <th class="right">Est. Cost</th>
                  <th class="right">Annual Savings</th>
                  <th class="right">Payback</th>
                </tr>
              </thead>
              <tbody>${compRows}</tbody>
            </table>
          </div>
        </div>
      `;
    }

    // Build group breakdown section
    const groupBreakdownRows = groups_data.map((g, idx) => {
      const color = GROUP_COLORS[idx % GROUP_COLORS.length];
      return `<tr>
        <td style="font-weight:700"><span class="xpk-group-color-dot" style="background:${color}"></span>${escapeHtml(g.name)}</td>
        <td class="right">${g.polygonCount || 0}</td>
        <td class="right">${formatNumber(g.totalSquareFootage || 0)}</td>
        <td class="right">${formatCurrency(g.estimatedConversionCost || 0)}</td>
        <td class="right">${(g.estimatedAnnualWaterSavings || 0) > 0 ? formatCurrency(g.estimatedAnnualWaterSavings) + '/yr' : '—'}</td>
        <td class="right">${paybackStr(g.estimatedPaybackYears)}</td>
      </tr>`;
    }).join('');

    const groupBreakdownSection = groups_data.length > 0 ? `
      <div class="xpk-section">
        <div class="xpk-section-title">Group / Phase Breakdown</div>
        <div style="overflow-x:auto">
          <table class="xpk-table">
            <thead>
              <tr>
                <th>Group Name</th>
                <th class="right">Polygons</th>
                <th class="right">SF</th>
                <th class="right">Est. Cost</th>
                <th class="right">Annual Savings</th>
                <th class="right">Payback</th>
              </tr>
            </thead>
            <tbody>${groupBreakdownRows}</tbody>
          </table>
        </div>
      </div>
    ` : '';

    // Build polygon detail table
    const polygonDetailRows = groups_data.flatMap((g, idx) => {
      const color = GROUP_COLORS[idx % GROUP_COLORS.length];
      return (g.polygonIds || []).map(pid => {
        const feat = allFeatures.find(f => f.properties.id === pid);
        const name = feat ? (feat.properties.name || pid) : pid;
        const sqft = feat ? (feat.properties.area_sqft || 0) : 0;
        return `<tr>
          <td>${escapeHtml(name)}</td>
          <td class="right">${formatNumber(sqft)}</td>
          <td><span class="xpk-group-color-dot" style="background:${color}"></span>${escapeHtml(g.name)}</td>
        </tr>`;
      });
    }).join('');

    const polygonDetailSection = `
      <div class="xpk-section">
        <div class="xpk-section-title">Polygon Detail</div>
        <div style="overflow-x:auto">
          <table class="xpk-table">
            <thead>
              <tr>
                <th>Polygon Name</th>
                <th class="right">Square Footage</th>
                <th>Group</th>
              </tr>
            </thead>
            <tbody>${polygonDetailRows || '<tr><td colspan="3" style="color:var(--gray-400);text-align:center">No polygons in this record</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    `;

    // Assumptions block
    const assumptionsSection = `
      <div class="xpk-section">
        <div class="xpk-section-title">Assumptions (Frozen at Record Save)</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;font-size:13px;color:var(--gray-700)">
          <div><strong>Conversion cost:</strong> ${formatCurrency(assumptions.costPerSf || 0)} / SF</div>
          <div><strong>Annual water savings:</strong> ${formatCurrency(assumptions.savingsPerSf || 0)} / SF</div>
          <div style="grid-column:1/-1;color:var(--gray-500);font-size:12px">Payback basis: Water-only savings. Does not include maintenance savings or utility rate escalation.</div>
        </div>
      </div>
    `;

    // Disclaimer
    const disclaimerBlock = `
      <div class="xpk-disclaimer">
        <div class="xpk-disclaimer-title">Disclaimer</div>
        <div class="xpk-disclaimer-text">
          Estimates shown are planning-level figures based on selected assumptions and mapped polygon area. Actual project cost, water savings, and payback may vary based on final design, utility rates, site conditions, and operational factors. This document is intended for internal HOA board planning purposes only and does not constitute a binding proposal, contract, or guarantee of project scope or pricing.
        </div>
      </div>
    `;

    // Status badge for header
    const statusBadgeHtml = isActive
      ? `<span class="xpk-status-badge" style="background:rgba(21,128,61,0.3);border-color:rgba(21,128,61,0.5)">Active Proposal Support</span>`
      : packetStatus === 'superseded'
        ? `<span class="xpk-status-badge" style="background:rgba(100,116,139,0.3)">Superseded</span>`
        : `<span class="xpk-status-badge">Draft</span>`;

    const narrativeIntro = savedPacket && savedPacket.narrativeIntro ? savedPacket.narrativeIntro : '';
    const narrativeRec = savedPacket && savedPacket.narrativeRecommendation ? savedPacket.narrativeRecommendation : '';
    const narrativeNext = savedPacket && savedPacket.narrativeNextSteps ? savedPacket.narrativeNextSteps : '';

    content.innerHTML = `
      <div class="xpk-toolbar xps-no-print">
        <button class="xps-back-btn" id="xpk-back-btn">&#8592; Back to Planner</button>
        <button class="xps-print-btn" id="xpk-print-btn">&#128438; Print Packet</button>
        <button class="btn btn-sm" id="xpk-export-btn" style="background:var(--teal);color:#fff;border:none;border-radius:var(--radius);cursor:pointer;font-size:12px;font-weight:600;padding:7px 16px">&#8659; Export Packet</button>
        <button class="btn btn-sm" id="xpk-save-btn" style="background:var(--navy);color:#fff;border:none;border-radius:var(--radius);cursor:pointer;font-size:12px;font-weight:600;padding:7px 16px">&#128190; Save Packet</button>
        <span class="xpk-save-status" id="xpk-save-status">${savedPacket ? 'Last saved ' + formatDateShort(savedPacket.updatedAt) : 'Unsaved draft'}</span>
      </div>

      <div class="xpk-header">
        <div class="xpk-header-community">${escapeHtml(PROPERTY_NAME)}</div>
        <h1 class="xpk-header-title" style="display:flex;align-items:center;flex-wrap:wrap;gap:8px">
          <span>${escapeHtml(record.recordName)}</span>
          <span class="xpk-admin-badge">Admin Only &mdash; Internal Use</span>
          ${savedPacket ? statusBadgeHtml : ''}
        </h1>
        <div class="xpk-header-meta">
          <span><strong>Generated:</strong>&nbsp;${genDate}</span>
          <span><strong>Status:</strong>&nbsp;${statusLabel(record.status)}</span>
          <span><strong>Groups:</strong>&nbsp;${groups_data.length}</span>
        </div>
      </div>

      <!-- Narrative block (editable) -->
      <div class="xpk-section xpk-narrative-edit" id="xpk-narrative-section">
        <div class="xpk-section-title">Executive Narrative (Optional — Editable)</div>
        <div style="display:grid;gap:14px">
          <div>
            <label class="xpk-narrative-label">Introduction / Context</label>
            <textarea class="xpk-narrative-area" id="xpk-intro" placeholder="Brief intro or context for the board…" rows="3">${escapeHtml(narrativeIntro)}</textarea>
          </div>
          <div>
            <label class="xpk-narrative-label">Recommendation</label>
            <textarea class="xpk-narrative-area" id="xpk-recommendation" placeholder="Staff recommendation or key takeaways…" rows="3">${escapeHtml(narrativeRec)}</textarea>
          </div>
          <div>
            <label class="xpk-narrative-label">Proposed Next Steps</label>
            <textarea class="xpk-narrative-area" id="xpk-next-steps" placeholder="Proposed actions, timeline, or approvals needed…" rows="3">${escapeHtml(narrativeNext)}</textarea>
          </div>
        </div>
      </div>

      <!-- Narrative display (print only) -->
      <div class="xpk-section xpk-narrative-display" id="xpk-narrative-print">
        ${narrativeIntro ? `<div class="xpk-section-title">Introduction</div><p style="font-size:13px;line-height:1.7;margin:0 0 16px">${escapeHtml(narrativeIntro)}</p>` : ''}
        ${narrativeRec ? `<div class="xpk-section-title">Recommendation</div><p style="font-size:13px;line-height:1.7;margin:0 0 16px">${escapeHtml(narrativeRec)}</p>` : ''}
        ${narrativeNext ? `<div class="xpk-section-title">Next Steps</div><p style="font-size:13px;line-height:1.7;margin:0">${escapeHtml(narrativeNext)}</p>` : ''}
      </div>

      <!-- Executive Summary -->
      <div class="xpk-section">
        <div class="xpk-section-title">Executive Summary</div>
        ${kpiCards}
      </div>

      ${comparisonSection}
      ${groupBreakdownSection}
      ${polygonDetailSection}
      ${assumptionsSection}
      ${disclaimerBlock}
    `;

    overlay.style.display = 'block';
    overlay.scrollTop = 0;

    // Wire toolbar buttons
    document.getElementById('xpk-back-btn').addEventListener('click', closePlanningPacket);
    document.getElementById('xpk-print-btn').addEventListener('click', function() { window.print(); });
    document.getElementById('xpk-export-btn').addEventListener('click', function() { exportPacketJSON(record); });
    document.getElementById('xpk-save-btn').addEventListener('click', function() { savePacketToDB(record); });

    // When narrative edits happen, sync to print display
    ['xpk-intro', 'xpk-recommendation', 'xpk-next-steps'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', syncNarrativePrint);
      }
    });
  }

  function syncNarrativePrint() {
    const intro = document.getElementById('xpk-intro') ? document.getElementById('xpk-intro').value.trim() : '';
    const rec = document.getElementById('xpk-recommendation') ? document.getElementById('xpk-recommendation').value.trim() : '';
    const next = document.getElementById('xpk-next-steps') ? document.getElementById('xpk-next-steps').value.trim() : '';

    const printEl = document.getElementById('xpk-narrative-print');
    if (!printEl) return;

    printEl.innerHTML = [
      intro ? `<div class="xpk-section-title">Introduction</div><p style="font-size:13px;line-height:1.7;margin:0 0 16px">${escapeHtml(intro)}</p>` : '',
      rec ? `<div class="xpk-section-title">Recommendation</div><p style="font-size:13px;line-height:1.7;margin:0 0 16px">${escapeHtml(rec)}</p>` : '',
      next ? `<div class="xpk-section-title">Next Steps</div><p style="font-size:13px;line-height:1.7;margin:0">${escapeHtml(next)}</p>` : '',
    ].join('');
  }

  async function savePacketToDB(record) {
    if (packetIsSaving) return;
    const intro = document.getElementById('xpk-intro') ? document.getElementById('xpk-intro').value.trim() : '';
    const rec = document.getElementById('xpk-recommendation') ? document.getElementById('xpk-recommendation').value.trim() : '';
    const next = document.getElementById('xpk-next-steps') ? document.getElementById('xpk-next-steps').value.trim() : '';
    const title = record.recordName + ' — Planning Packet';

    packetIsSaving = true;
    const saveBtn = document.getElementById('xpk-save-btn');
    const statusEl = document.getElementById('xpk-save-status');
    if (saveBtn) saveBtn.disabled = true;
    if (statusEl) statusEl.textContent = 'Saving…';

    try {
      const payload = {
        packetTitle: title,
        packetSummaryText: null,
        narrativeIntro: intro || null,
        narrativeRecommendation: rec || null,
        narrativeNextSteps: next || null,
      };

      let saved;
      if (currentPacketData && currentPacketData.id) {
        saved = await apiFetch('/api/admin/xeriscape/records/' + record.id + '/packets/' + currentPacketData.id, {
          method: 'PUT',
          body: JSON.stringify({ ...payload, packetStatus: 'active_proposal_support' }),
        });
      } else {
        saved = await apiFetch('/api/admin/xeriscape/records/' + record.id + '/packets', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }

      currentPacketData = saved;
      if (statusEl) statusEl.textContent = 'Saved ' + formatDateShort(saved.updatedAt);
      showToast('Planning packet saved', 'success');
      loadHistory();  // refresh list to show active packet badge
    } catch (err) {
      if (statusEl) statusEl.textContent = 'Save failed';
      showToast('Save failed: ' + err.message, 'error');
    } finally {
      packetIsSaving = false;
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  function exportPacketJSON(record) {
    const payload = buildProposalPayload(record);
    const intro = document.getElementById('xpk-intro') ? document.getElementById('xpk-intro').value.trim() : '';
    const rec = document.getElementById('xpk-recommendation') ? document.getElementById('xpk-recommendation').value.trim() : '';
    const next = document.getElementById('xpk-next-steps') ? document.getElementById('xpk-next-steps').value.trim() : '';
    payload.packetNotes = { intro: intro || null, recommendation: rec || null, nextSteps: next || null };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'planning-packet-' + record.propertyId + '-' + Date.now() + '.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Packet exported', 'success');
  }

  function closePlanningPacket() {
    const overlay = document.getElementById('xp-packet-overlay');
    if (overlay) overlay.style.display = 'none';
    currentPacketRecord = null;
  }

  // ── History panel ──────────────────────────────────────────────────────────
  async function loadHistory() {
    const content = document.getElementById('xp-history-content');
    if (!content) return;
    try {
      const records = await apiFetch('/api/admin/xeriscape/records?propertyId=' + (activeCommunityId || 'huntington-trails'));
      // For each reviewable record, try to load packet status (in parallel, ignore failures)
      const packetStatusMap = {};
      await Promise.all(records
        .filter(r => r.status === 'reviewed' || r.status === 'selected_for_estimate')
        .map(async r => {
          try {
            const packets = await apiFetch('/api/admin/xeriscape/records/' + r.id + '/packets');
            const active = packets.find(p => p.packetStatus === 'active_proposal_support');
            if (active) packetStatusMap[r.id] = active;
          } catch (e) {}
        })
      );
      renderHistory(records, packetStatusMap);
    } catch (err) {
      if (content) content.innerHTML = '<div style="font-size:13px;color:#dc2626;padding:16px 0">Failed to load history: ' + escapeHtml(err.message) + '</div>';
    }
  }

  function renderHistory(records, packetStatusMap) {
    packetStatusMap = packetStatusMap || {};
    const content = document.getElementById('xp-history-content');
    if (!content) return;

    if (!records || records.length === 0) {
      content.innerHTML = '<div style="font-size:13px;color:var(--gray-400);padding:24px 0;text-align:center">No saved records yet. Save a planning session to see it here.</div>';
      return;
    }

    const rows = records.map(r => {
      const isSelected = r.status === 'selected_for_estimate';
      const isArchived = r.status === 'archived';
      const isDraft = r.status === 'draft';
      const isReviewed = r.status === 'reviewed';
      const isReviewable = isSelected || isReviewed;
      const hasActivePacket = !!packetStatusMap[r.id];

      const costStr = r.totalEstimatedCost > 0 ? formatCurrency(r.totalEstimatedCost) : '—';
      const savingsStr = r.totalAnnualSavings > 0 ? formatCurrency(r.totalAnnualSavings) + '/yr' : '—';
      const pb = paybackStr(r.paybackYears);
      const sfStr = r.totalSqft > 0 ? formatNumber(r.totalSqft) + ' SF' : '—';

      const openedClass = loadedRecordId === r.id ? ' style="outline:2px solid var(--teal);outline-offset:1px"' : '';

      return `
        <div class="xp-record-row${isSelected ? ' xp-record-selected' : ''}${isArchived ? ' xp-record-archived' : ''}" data-record-id="${r.id}"${openedClass}>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px">
              <div class="xp-record-name">${escapeHtml(r.recordName)}</div>
              <span class="xp-status-badge xp-status-${r.status}">${escapeHtml(statusLabel(r.status))}</span>
              ${hasActivePacket ? `<span class="xpk-packet-badge">&#128196; Active Packet</span>` : ''}
            </div>
            <div class="xp-record-meta">
              <span>${sfStr}</span>
              <span>Cost: ${costStr}</span>
              <span>Savings: ${savingsStr}</span>
              <span>Payback: ${pb}</span>
              <span>Updated: ${formatDate(r.updatedAt)}</span>
            </div>
            ${r.internalNotes ? `<div style="font-size:11px;color:var(--gray-500);margin-bottom:8px;font-style:italic">${escapeHtml(r.internalNotes)}</div>` : ''}
            <div class="xp-record-actions">
              ${!isArchived ? `<button class="xp-record-btn xp-btn-open" data-action="open" data-id="${r.id}">Open</button>` : ''}
              <button class="xp-record-btn" data-action="duplicate" data-id="${r.id}">Duplicate</button>
              ${!isArchived && !isSelected ? `<button class="xp-record-btn xp-btn-select" data-action="select" data-id="${r.id}">Mark Selected</button>` : ''}
              ${isReviewable ? `<button class="xp-record-btn xp-btn-proposal" data-action="packet" data-id="${r.id}">&#128196; ${hasActivePacket ? 'View Packet' : 'Prepare Proposal Support'}</button>` : ''}
              ${!isArchived ? `<button class="xp-record-btn xp-btn-archive" data-action="archive" data-id="${r.id}">Archive</button>` : ''}
              ${isDraft ? `<button class="xp-record-btn xp-btn-delete" data-action="delete" data-id="${r.id}">Delete</button>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');

    content.innerHTML = `<div style="display:flex;flex-direction:column;gap:10px">${rows}</div>`;

    content.onclick = async function(e) {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      const record = records.find(r => r.id === id);
      if (!record) return;

      if (action === 'open') {
        openRecord(record);
      } else if (action === 'duplicate') {
        try {
          await apiFetch('/api/admin/xeriscape/records/' + id + '/duplicate', { method: 'POST', body: '{}' });
          showToast('Record duplicated', 'success');
          loadHistory();
        } catch (err) {
          showToast('Duplicate failed: ' + err.message, 'error');
        }
      } else if (action === 'select') {
        try {
          await apiFetch('/api/admin/xeriscape/records/' + id, {
            method: 'PUT',
            body: JSON.stringify({ status: 'selected_for_estimate' }),
          });
          showToast('Marked as Selected for Estimate', 'success');
          loadHistory();
        } catch (err) {
          showToast('Update failed: ' + err.message, 'error');
        }
      } else if (action === 'archive') {
        try {
          await apiFetch('/api/admin/xeriscape/records/' + id, {
            method: 'PUT',
            body: JSON.stringify({ status: 'archived' }),
          });
          showToast('Record archived', 'success');
          loadHistory();
        } catch (err) {
          showToast('Archive failed: ' + err.message, 'error');
        }
      } else if (action === 'delete') {
        if (!confirm('Permanently delete this draft record?')) return;
        try {
          await apiFetch('/api/admin/xeriscape/records/' + id, { method: 'DELETE' });
          if (loadedRecordId === id) updateLoadedBadge(null);
          showToast('Record deleted', 'success');
          loadHistory();
        } catch (err) {
          showToast('Delete failed: ' + err.message, 'error');
        }
      } else if (action === 'packet') {
        openPlanningPacket(record);
      }
    };
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

        const layer = L.geoJSON(feature, {
          style: () => getLayerStyle(id),
          onEachFeature: function(feat, lyr) {
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

  document.getElementById('xp-save-record-btn').addEventListener('click', function() {
    const record = loadedRecordId ? { id: loadedRecordId, recordName: document.getElementById('xp-loaded-record-badge').textContent.replace(/^✎\s*/, '') } : null;
    openSaveModal(record);
  });

  document.getElementById('xp-new-session-btn').addEventListener('click', startNewSession);

  document.getElementById('xp-save-modal-cancel').addEventListener('click', closeSaveModal);
  document.getElementById('xp-save-modal-confirm').addEventListener('click', confirmSaveRecord);

  document.getElementById('xp-save-modal').addEventListener('click', function(e) {
    if (e.target === this) closeSaveModal();
  });

  document.getElementById('xp-save-modal').addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeSaveModal();
  });

  document.getElementById('xp-modal-record-name').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') confirmSaveRecord();
  });

  document.getElementById('xp-warn-edit-btn').addEventListener('click', function() {
    if (warnModalRecord) {
      const r = warnModalRecord;
      closeWarnModal();
      loadRecordIntoPlanner(r);
    }
  });

  document.getElementById('xp-warn-duplicate-btn').addEventListener('click', async function() {
    if (!warnModalRecord) return;
    const r = warnModalRecord;
    closeWarnModal();
    try {
      const copy = await apiFetch('/api/admin/xeriscape/records/' + r.id + '/duplicate', { method: 'POST', body: '{}' });
      showToast('Duplicated "' + r.recordName + '" — loading copy', 'success');
      loadHistory();
      loadRecordIntoPlanner(copy);
    } catch (err) {
      showToast('Duplicate failed: ' + err.message, 'error');
    }
  });

  document.getElementById('xp-warn-cancel-btn').addEventListener('click', closeWarnModal);

  document.getElementById('xp-warn-modal').addEventListener('click', function(e) {
    if (e.target === this) closeWarnModal();
  });

  document.getElementById('xp-refresh-history-btn').addEventListener('click', loadHistory);

  // Community selector change
  document.getElementById('xp-community-select').addEventListener('change', async function() {
    const select = this;
    const communityId = select.value;
    const communityName = communityId
      ? select.options[select.selectedIndex].textContent
      : null;
    await onCommunityChange(communityId || null, communityName);
  });
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
    script.onerror = () => showToast('Failed to load map library', 'error');
    document.head.appendChild(script);
  } else {
    const style = document.createElement('style');
    style.textContent = '.xp-tooltip { font-size: 12px; font-weight: 600; background: rgba(12,29,49,0.85); color: #fff; border: none; padding: 3px 8px; border-radius: 4px; }';
    document.head.appendChild(style);
  }

  await loadCommunities();
});
