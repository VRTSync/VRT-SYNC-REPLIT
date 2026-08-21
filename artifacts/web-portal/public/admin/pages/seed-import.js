AdminRouter.register('imports/seed', async function(container) {
  const { apiFetch, showToast } = AdminAPI;
  const esc = VRTUtils.esc;

  // ── State ──────────────────────────────────────────────────────────────────
  let mode         = 'master_bill';   // 'master_bill' | 'seasonal'
  let currentStep  = 1;

  // Master Bill state
  let mbFile         = null;
  let mbParseResult  = null;   // returned from /parse
  let mbPreviewResult = null;  // returned from /preview
  let mbFileToken    = 0;      // increments on new upload, resets commit availability

  // Seasonal state
  let seFile       = null;
  let seParseResult = null;
  let seAllRows    = null;
  let seMappings   = null;
  let sePreviewResult = null;
  let seFileToken  = 0;

  const PERIOD_OPTIONS = [
    { value: 'master_bill_2026_05', label: 'May 2026 (master_bill_2026_05)' },
    { value: 'master_bill_2026_06', label: 'June 2026 (master_bill_2026_06)' },
    { value: 'master_bill_2026_07', label: 'July 2026 (master_bill_2026_07)' },
  ];

  // ── Main render ────────────────────────────────────────────────────────────
  function render() {
    container.innerHTML = `
      <div class="page-header" style="margin-top:16px">
        <h2 style="font-size:16px">Data Import</h2>
      </div>

      <div style="display:flex;gap:8px;margin-bottom:20px">
        <button class="btn ${mode==='master_bill'?'btn-primary':'btn-secondary'}" id="si-mode-mb">
          Master Bill
        </button>
        <button class="btn ${mode==='seasonal'?'btn-primary':'btn-secondary'}" id="si-mode-se">
          Seasonal Contract
        </button>
      </div>

      <div id="si-stepper">${renderStepper()}</div>

      <div id="si-history-panel" style="margin-top:40px">${renderHistoryPanel()}</div>
    `;

    document.getElementById('si-mode-mb').addEventListener('click', () => {
      mode = 'master_bill'; currentStep = 1;
      mbParseResult = null; mbPreviewResult = null;
      render();
    });
    document.getElementById('si-mode-se').addEventListener('click', () => {
      mode = 'seasonal'; currentStep = 1;
      seParseResult = null; sePreviewResult = null;
      render();
    });

    bindStepHandlers();
    loadHistory();
  }

  // ── Stepper ────────────────────────────────────────────────────────────────
  function renderStepper() {
    const steps = mode === 'master_bill'
      ? [{num:1,label:'Upload'},{num:2,label:'Preview'},{num:3,label:'Commit'}]
      : [{num:1,label:'Upload'},{num:2,label:'Map Columns'},{num:3,label:'Preview'},{num:4,label:'Commit'}];

    return `
      <div style="display:flex;gap:4px;margin-bottom:20px;border-bottom:1px solid #e5e7eb;padding-bottom:12px">
        ${steps.map(s => `
          <div style="flex:1;text-align:center;padding:8px 4px;border-radius:6px 6px 0 0;font-size:13px;
               font-weight:${currentStep===s.num?'600':'400'};
               color:${currentStep===s.num?'#25C1AC':currentStep>s.num?'#10b981':'#9ca3af'};
               border-bottom:2px solid ${currentStep===s.num?'#25C1AC':currentStep>s.num?'#10b981':'transparent'}">
            <span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;font-size:11px;margin-right:4px;
                 ${currentStep>s.num?'background:#10b981;color:#fff':currentStep===s.num?'background:#25C1AC;color:#fff':'background:#e5e7eb;color:#6b7280'}">
              ${currentStep>s.num?'✓':s.num}
            </span>
            ${s.label}
          </div>
        `).join('')}
      </div>
      <div id="si-step-content">${renderCurrentStep()}</div>
    `;
  }

  function renderCurrentStep() {
    if (mode === 'master_bill') {
      if (currentStep===1) return renderMbStep1();
      if (currentStep===2) return renderMbStep2();
      if (currentStep===3) return renderMbStep3();
    } else {
      if (currentStep===1) return renderSeStep1();
      if (currentStep===2) return renderSeStep2();
      if (currentStep===3) return renderSeStep3();
      if (currentStep===4) return renderSeStep4();
    }
    return '';
  }

  // ── Master Bill Step 1 — Upload ───────────────────────────────────────────
  function renderMbStep1() {
    return `
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:24px;max-width:560px">
        <h3 style="font-size:14px;font-weight:600;margin-bottom:4px">Upload Master Bill Workbook</h3>
        <p style="font-size:13px;color:#6b7280;margin-bottom:16px">
          Upload one of the three High Plains Property Maintenance master-bill .xlsx workbooks.
          The workbook must contain a "Service Detail" sheet.
        </p>

        <div class="form-group">
          <label class="form-label">Billing Period *</label>
          <select class="form-select" id="mb-period" style="max-width:320px">
            <option value="">— Select billing period —</option>
            ${PERIOD_OPTIONS.map(p => `<option value="${p.value}">${esc(p.label)}</option>`).join('')}
          </select>
        </div>

        <div style="border:2px dashed #d1d5db;border-radius:8px;padding:32px;text-align:center;cursor:pointer;transition:border-color 0.2s" id="mb-dropzone">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="1.5" style="margin:0 auto 8px">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          <p style="color:#6b7280;font-size:13px;margin-bottom:8px">Drag & drop or click to browse</p>
          <p style="color:#9ca3af;font-size:11px">.xlsx — Max 50MB</p>
          <input type="file" id="mb-file-input" accept=".xlsx,.xls" style="display:none">
        </div>
        <div id="mb-file-info" style="display:none;margin-top:12px;padding:12px;background:#fff;border:1px solid #e5e7eb;border-radius:6px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span id="mb-filename" style="font-size:13px;font-weight:500"></span>
            <button class="btn btn-ghost btn-sm" id="mb-clear-file" style="color:#ef4444">Remove</button>
          </div>
        </div>
        <div style="margin-top:16px;text-align:right">
          <button class="btn btn-primary" id="mb-parse-btn" disabled>Parse & Preview →</button>
        </div>
        <div id="mb-parse-error" style="display:none;margin-top:12px;color:#ef4444;font-size:13px;background:#fef2f2;padding:8px 12px;border-radius:6px"></div>
      </div>
    `;
  }

  // ── Master Bill Step 2 — Preview ──────────────────────────────────────────
  function renderMbStep2() {
    if (!mbPreviewResult) return '<p style="color:#6b7280">Generating preview…</p>';
    const p = mbPreviewResult;

    const hasErrors = p.blockingErrors && p.blockingErrors.length > 0;

    return `
      <div style="max-width:860px">
        <h3 style="font-size:14px;font-weight:600;margin-bottom:16px">Import Preview — ${esc(mbParseResult?.batchLabel ?? '')}</h3>

        ${hasErrors ? `
          <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin-bottom:16px">
            <div style="font-weight:600;color:#dc2626;margin-bottom:8px;font-size:13px">⛔ Blocking Errors — Commit is disabled</div>
            ${p.blockingErrors.map(e => `<div style="color:#dc2626;font-size:13px;margin-bottom:4px">• ${esc(e)}</div>`).join('')}
          </div>
        ` : `
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px;margin-bottom:16px;font-size:13px;color:#15803d">
            ✓ All validations passed — ready to commit
          </div>
        `}

        <!-- Community Mapping Table — always visible, prominent -->
        <div style="background:#fff;border:2px solid #25C1AC;border-radius:8px;padding:16px;margin-bottom:16px">
          <h4 style="font-size:13px;font-weight:700;margin-bottom:10px;color:#0C1D31">PNC Code → Community Mapping</h4>
          <div class="table-container" style="box-shadow:none;border:none">
            <table style="font-size:13px">
              <thead><tr>
                <th>PNC Code</th><th>Community Name</th><th>Community ID</th><th>Org ID</th>
              </tr></thead>
              <tbody>
                ${(p.communityMapping ?? []).map(c => `<tr>
                  <td><strong>${esc(c.code)}</strong></td>
                  <td>${esc(c.name)}</td>
                  <td style="font-family:monospace;font-size:11px;color:#6b7280">${esc(c.id)}</td>
                  <td style="font-family:monospace;font-size:11px;color:#6b7280">${esc(c.orgId)}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Counts -->
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:12px;margin-bottom:16px">
          ${[
            {label:'Invoice Rows', val: p.totals?.invoiceRows ?? 0, color:'#2563eb', bg:'#eff6ff', border:'#bfdbfe'},
            {label:'Completion Rows', val: p.totals?.completionRows ?? 0, color:'#16a34a', bg:'#f0fdf4', border:'#bbf7d0'},
            {label:'Contract-Only', val: p.totals?.contractOnlyCount ?? p.totals?.contractRows ?? 0, color:'#d97706', bg:'#fefce8', border:'#fde68a'},
            {label:'Skipped Rows', val: (p.skippedRows ?? []).length, color:'#6b7280', bg:'#f5f5f4', border:'#d6d3d1'},
            {label:'Date-Clamped', val: (p.clampedRows ?? []).length, color:'#7c3aed', bg:'#f3e8ff', border:'#ddd6fe'},
          ].map(c => `
            <div style="background:${c.bg};border:1px solid ${c.border};border-radius:8px;padding:12px;text-align:center">
              <div style="font-size:20px;font-weight:700;color:${c.color}">${c.val}</div>
              <div style="font-size:11px;color:#6b7280">${c.label}</div>
            </div>
          `).join('')}
        </div>

        <!-- Service Account Resolution -->
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin-bottom:16px;font-size:13px">
          <strong>Service Account:</strong>
          ${p.serviceAccountResolution?.exists
            ? `<span style="color:#16a34a">✓ Existing — "${esc(p.serviceAccountResolution.displayName)}" (${esc(p.serviceAccountResolution.id ?? '')})</span>`
            : `<span style="color:#d97706">⚠ Will create new: "${esc(p.serviceAccountResolution?.displayName ?? '')}"</span>`
          }
        </div>

        <!-- Per-Branch Counts -->
        ${Object.keys(p.perBranchCounts ?? {}).length > 0 ? `
          <div style="margin-bottom:16px">
            <h4 style="font-size:13px;font-weight:600;margin-bottom:8px">Per-Branch Counts</h4>
            <div class="table-container">
              <table style="font-size:12px">
                <thead><tr><th>PNC Code</th><th>Community</th><th>Invoices</th><th>Completions</th><th>Contracts</th></tr></thead>
                <tbody>
                  ${Object.entries(p.perBranchCounts).sort().map(([code, counts]) => {
                    const com = (p.communityMapping ?? []).find(c => c.code === code);
                    return `<tr>
                      <td><strong>${esc(code)}</strong></td>
                      <td>${com ? esc(com.name) : '<span style="color:#ef4444">—</span>'}</td>
                      <td>${counts.invoices}</td>
                      <td>${counts.completions}</td>
                      <td>${counts.contracts}</td>
                    </tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}

        <!-- Skipped Rows -->
        ${(p.skippedRows ?? []).length > 0 ? `
          <details style="margin-bottom:16px">
            <summary style="font-size:13px;font-weight:600;cursor:pointer;padding:8px 0">
              Skipped Rows (${p.skippedRows.length})
            </summary>
            <div class="table-container" style="margin-top:8px;max-height:300px;overflow:auto">
              <table style="font-size:12px">
                <thead><tr><th>Excel Row</th><th>Reason</th></tr></thead>
                <tbody>
                  ${p.skippedRows.map(s => `<tr><td>${s.excelRow}</td><td>${esc(s.reason)}</td></tr>`).join('')}
                </tbody>
              </table>
            </div>
          </details>
        ` : ''}

        <!-- Date-Clamped Rows -->
        ${(p.clampedRows ?? []).length > 0 ? `
          <details style="margin-bottom:16px">
            <summary style="font-size:13px;font-weight:600;cursor:pointer;padding:8px 0">
              Date-Clamped Rows (${p.clampedRows.length}) — dates adjusted to billing period boundary
            </summary>
            <div class="table-container" style="margin-top:8px;max-height:300px;overflow:auto">
              <table style="font-size:12px">
                <thead><tr><th>Excel Row</th><th>Original Date</th><th>Clamped To</th><th>Service Type</th></tr></thead>
                <tbody>
                  ${p.clampedRows.map(c => `<tr>
                    <td>${c.excelRow}</td>
                    <td>${esc(c.before)}</td>
                    <td style="color:#d97706">${esc(c.after)}</td>
                    <td>${esc(c.serviceType)}</td>
                  </tr>`).join('')}
                </tbody>
              </table>
            </div>
          </details>
        ` : ''}

        <!-- Totals -->
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin-bottom:16px;font-size:13px">
          <strong>Total Amount:</strong> $${((p.totals?.totalAmount ?? 0)).toFixed(2)}
          &nbsp;|&nbsp;
          <strong>Invoice Rows:</strong> ${p.totals?.invoiceRows ?? 0}
          &nbsp;|&nbsp;
          <strong>Completion Rows:</strong> ${p.totals?.completionRows ?? 0}
        </div>

        <div style="display:flex;justify-content:space-between">
          <button class="btn btn-ghost" id="mb-back-step1">← Back to Upload</button>
          <button class="btn btn-primary" id="mb-commit-btn" ${hasErrors?'disabled':''}>
            ${hasErrors ? 'Fix Errors Before Committing' : 'Commit to Production →'}
          </button>
        </div>
      </div>
    `;
  }

  // ── Master Bill Step 3 — Commit result ────────────────────────────────────
  function renderMbStep3() {
    return `<div id="mb-commit-result">Loading…</div>`;
  }

  // ── Seasonal Step 1 — Upload ──────────────────────────────────────────────
  function renderSeStep1() {
    return `
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:24px;max-width:560px">
        <h3 style="font-size:14px;font-weight:600;margin-bottom:4px">Upload Seasonal Contract File</h3>
        <p style="font-size:13px;color:#6b7280;margin-bottom:16px">
          Upload a .xlsx or .csv file containing the seasonal task list.
          Column mapping will be configured in the next step.
        </p>
        <div style="border:2px dashed #d1d5db;border-radius:8px;padding:32px;text-align:center;cursor:pointer;transition:border-color 0.2s" id="se-dropzone">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="1.5" style="margin:0 auto 8px">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          <p style="color:#6b7280;font-size:13px;margin-bottom:8px">Drag & drop or click to browse</p>
          <p style="color:#9ca3af;font-size:11px">.xlsx, .csv — Max 50MB</p>
          <input type="file" id="se-file-input" accept=".xlsx,.csv,.xls" style="display:none">
        </div>
        <div id="se-file-info" style="display:none;margin-top:12px;padding:12px;background:#fff;border:1px solid #e5e7eb;border-radius:6px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span id="se-filename" style="font-size:13px;font-weight:500"></span>
            <button class="btn btn-ghost btn-sm" id="se-clear-file" style="color:#ef4444">Remove</button>
          </div>
        </div>
        <div style="margin-top:16px;text-align:right">
          <button class="btn btn-primary" id="se-parse-btn" disabled>Parse & Continue →</button>
        </div>
        <div id="se-parse-error" style="display:none;margin-top:12px;color:#ef4444;font-size:13px;background:#fef2f2;padding:8px 12px;border-radius:6px"></div>
      </div>
    `;
  }

  // ── Seasonal Step 2 — Map Columns ─────────────────────────────────────────
  function renderSeStep2() {
    if (!seParseResult) return '<p>No data parsed yet.</p>';
    const cols = seParseResult.columns;

    function colOpts(selected) {
      return `<option value="">— Select column —</option>` +
        cols.map(c => `<option value="${esc(c)}" ${c===selected?'selected':''}>${esc(c)}</option>`).join('');
    }
    function optOpts(selected) {
      return `<option value="">— None —</option>` +
        cols.map(c => `<option value="${esc(c)}" ${c===selected?'selected':''}>${esc(c)}</option>`).join('');
    }

    return `
      <div style="max-width:700px">
        <h3 style="font-size:14px;font-weight:600;margin-bottom:4px">Map Columns</h3>
        <p style="font-size:13px;color:#6b7280;margin-bottom:16px">${seParseResult.totalRows} data rows detected. Map spreadsheet columns to import fields.</p>

        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:16px">
          <h4 style="font-size:13px;font-weight:600;margin-bottom:12px">Required Columns</h4>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="form-group">
              <label class="form-label">Community Code *</label>
              <select class="form-select se-map" data-field="communityCode">${colOpts('')}</select>
              <p style="font-size:11px;color:#9ca3af;margin-top:3px">e.g. FB01, FB02 (must match community codes in DB)</p>
            </div>
            <div class="form-group">
              <label class="form-label">Service Date *</label>
              <select class="form-select se-map" data-field="serviceDate">${colOpts('')}</select>
              <p style="font-size:11px;color:#9ca3af;margin-top:3px">All dates must be 2026 Wednesdays</p>
            </div>
            <div class="form-group">
              <label class="form-label">Service Type *</label>
              <select class="form-select se-map" data-field="serviceType">${colOpts('')}</select>
              <p style="font-size:11px;color:#9ca3af;margin-top:3px">Used to group schedules</p>
            </div>
            <div class="form-group">
              <label class="form-label">Task Title *</label>
              <select class="form-select se-map" data-field="taskTitle">${colOpts('')}</select>
            </div>
          </div>
        </div>

        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:16px">
          <h4 style="font-size:13px;font-weight:600;margin-bottom:12px">Optional Columns</h4>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="form-group">
              <label class="form-label">Description / Notes</label>
              <select class="form-select se-map" data-field="description">${optOpts('')}</select>
            </div>
            <div class="form-group">
              <label class="form-label">Status</label>
              <select class="form-select se-map" data-field="status">${optOpts('')}</select>
              <p style="font-size:11px;color:#9ca3af;margin-top:3px">Rows with "completed" create task_completions</p>
            </div>
          </div>
        </div>

        <div style="margin-bottom:16px">
          <h4 style="font-size:13px;font-weight:600;margin-bottom:8px">Data Preview (first 10 rows)</h4>
          <div class="table-container" style="max-height:280px;overflow:auto">
            <table style="font-size:12px">
              <thead><tr>${cols.map(c => `<th style="white-space:nowrap">${esc(c)}</th>`).join('')}</tr></thead>
              <tbody>
                ${seParseResult.rowsPreview.slice(0,10).map(row => `<tr>${cols.map(c => `<td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(String(row[c]??''))}</td>`).join('')}</tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div style="display:flex;justify-content:space-between">
          <button class="btn btn-ghost" id="se-back-step1">← Back</button>
          <button class="btn btn-primary" id="se-preview-btn">Generate Preview →</button>
        </div>
        <div id="se-map-error" style="display:none;margin-top:12px;color:#ef4444;font-size:13px;background:#fef2f2;padding:8px 12px;border-radius:6px"></div>
      </div>
    `;
  }

  // ── Seasonal Step 3 — Preview ─────────────────────────────────────────────
  function renderSeStep3() {
    if (!sePreviewResult) return '<p>Generating preview…</p>';
    const p = sePreviewResult;
    const hasErrors = p.blockingErrors && p.blockingErrors.length > 0;

    return `
      <div style="max-width:800px">
        <h3 style="font-size:14px;font-weight:600;margin-bottom:16px">Seasonal Import Preview</h3>

        ${hasErrors ? `
          <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin-bottom:16px">
            <div style="font-weight:600;color:#dc2626;margin-bottom:8px;font-size:13px">⛔ Blocking Errors — Commit is disabled</div>
            ${p.blockingErrors.map(e => `<div style="color:#dc2626;font-size:13px;margin-bottom:4px">• ${esc(e)}</div>`).join('')}
          </div>
        ` : `
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px;margin-bottom:16px;font-size:13px;color:#15803d">
            ✓ All validations passed — ready to commit
          </div>
        `}

        <!-- Counts -->
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:12px;margin-bottom:16px">
          ${[
            {label:'Schedules to Create', val: p.counts.schedulesToCreate, color:'#25C1AC', bg:'#f0fdfa', border:'#99f6e4'},
            {label:'Existing Schedules',  val: p.counts.schedulesExisting,  color:'#6b7280', bg:'#f9fafb', border:'#e5e7eb'},
            {label:'Visits to Insert',    val: p.counts.visitsToInsert,    color:'#2563eb', bg:'#eff6ff', border:'#bfdbfe'},
            {label:'Tasks to Insert',     val: p.counts.tasksToInsert,     color:'#16a34a', bg:'#f0fdf4', border:'#bbf7d0'},
            {label:'Completions',         val: p.counts.completionsToInsert, color:'#7c3aed', bg:'#f3e8ff', border:'#ddd6fe'},
            {label:'Skipped Rows',        val: p.counts.skippedRows,        color:'#dc2626', bg:'#fef2f2', border:'#fecaca'},
          ].map(c => `
            <div style="background:${c.bg};border:1px solid ${c.border};border-radius:8px;padding:12px;text-align:center">
              <div style="font-size:20px;font-weight:700;color:${c.color}">${c.val}</div>
              <div style="font-size:11px;color:#6b7280">${c.label}</div>
            </div>
          `).join('')}
        </div>

        <!-- Schedule Plans -->
        ${p.schedulePlans.length > 0 ? `
          <div style="margin-bottom:16px">
            <h4 style="font-size:13px;font-weight:600;margin-bottom:8px">Schedule Plans</h4>
            <div class="table-container">
              <table style="font-size:12px">
                <thead><tr><th>Community</th><th>Code</th><th>Service Type</th><th>Action</th><th>Visits</th><th>Tasks</th></tr></thead>
                <tbody>
                  ${p.schedulePlans.map(sp => `<tr>
                    <td>${esc(sp.communityName)}</td>
                    <td>${esc(sp.communityCode)}</td>
                    <td>${esc(sp.serviceType)}</td>
                    <td>
                      <span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:500;color:#fff;
                           background:${sp.action==='create'?'#25C1AC':'#9ca3af'}">${sp.action}</span>
                    </td>
                    <td>${sp.visitCount}</td>
                    <td>${sp.taskCount}</td>
                  </tr>`).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}

        <div style="display:flex;justify-content:space-between">
          <button class="btn btn-ghost" id="se-back-step2">← Back to Mapping</button>
          <button class="btn btn-primary" id="se-commit-btn" ${hasErrors?'disabled':''}>
            ${hasErrors ? 'Fix Errors Before Committing' : 'Commit to Production →'}
          </button>
        </div>
      </div>
    `;
  }

  // ── Seasonal Step 4 — Commit result ──────────────────────────────────────
  function renderSeStep4() {
    return `<div id="se-commit-result">Loading…</div>`;
  }

  // ── History Panel ─────────────────────────────────────────────────────────
  function renderHistoryPanel() {
    return `
      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:20px">
        <h3 style="font-size:14px;font-weight:600;margin-bottom:12px">Import History</h3>
        <div id="si-history-content">
          <div style="color:#9ca3af;font-size:13px">Loading history…</div>
        </div>
      </div>
    `;
  }

  async function loadHistory() {
    const el = document.getElementById('si-history-content');
    if (!el) return;
    try {
      const batches = await apiFetch('/api/admin/import/batches');
      if (!batches || batches.length === 0) {
        el.innerHTML = '<div style="color:#9ca3af;font-size:13px">No import batches found.</div>';
        return;
      }
      el.innerHTML = `
        <div class="table-container" style="max-height:400px;overflow:auto">
          <table style="font-size:13px">
            <thead><tr>
              <th>Mode</th><th>Batch Label</th><th>Run By</th><th>Run At</th>
              <th>Invoices</th><th>Tasks</th><th>Completions</th><th>Schedules</th><th>Visits</th>
              <th></th>
            </tr></thead>
            <tbody>
              ${batches.map(b => `
                <tr>
                  <td><span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:500;color:#fff;
                       background:${b.mode==='master_bill'?'#2563eb':'#25C1AC'}">${b.mode==='master_bill'?'Master Bill':'Seasonal'}</span></td>
                  <td><code style="font-size:11px">${esc(b.batch_label)}</code></td>
                  <td>${esc(b.runner_name??b.run_by??'—')}</td>
                  <td style="white-space:nowrap">${new Date(b.run_at).toLocaleDateString()} ${new Date(b.run_at).toLocaleTimeString()}</td>
                  <td>${b.invoice_count??'—'}</td>
                  <td>${b.task_count??'—'}</td>
                  <td>${b.completion_count??'—'}</td>
                  <td>${b.schedule_count??'—'}</td>
                  <td>${b.visit_count??'—'}</td>
                  <td>
                    <button class="btn btn-danger btn-xs si-undo-btn" data-id="${esc(b.id)}" data-label="${esc(b.batch_label)}">
                      Undo
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
      el.querySelectorAll('.si-undo-btn').forEach(btn => {
        btn.addEventListener('click', () => handleUndo(btn.dataset.id, btn.dataset.label));
      });
    } catch (err) {
      el.innerHTML = `<div style="color:#ef4444;font-size:13px">Failed to load history: ${esc(err.message)}</div>`;
    }
  }

  async function handleUndo(batchId, batchLabel) {
    const confirm = window.prompt(
      `Type UNDO to confirm deleting all data from batch "${batchLabel}".\n` +
      `This targets PRODUCTION data and cannot be undone.`
    );
    if (confirm !== 'UNDO') {
      showToast('Undo cancelled.', 'info');
      return;
    }
    try {
      const result = await apiFetch(`/api/admin/import/batches/${batchId}`, { method: 'DELETE' });
      showToast(`Batch undone — ${result.invoicesDeleted??0} invoices, ${result.tasksDeleted??0} tasks removed.`, 'success');
      loadHistory();
    } catch (err) {
      showToast(`Undo failed: ${err.message}`, 'error');
    }
  }

  // ── Event Handlers ─────────────────────────────────────────────────────────
  function bindStepHandlers() {
    // ── Master Bill handlers ──
    if (mode === 'master_bill') {
      const dropzone  = document.getElementById('mb-dropzone');
      const fileInput = document.getElementById('mb-file-input');
      const parseBtn  = document.getElementById('mb-parse-btn');
      const clearBtn  = document.getElementById('mb-clear-file');

      if (dropzone && fileInput) {
        dropzone.addEventListener('click', () => fileInput.click());
        dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.style.borderColor = '#25C1AC'; });
        dropzone.addEventListener('dragleave', () => { dropzone.style.borderColor = '#d1d5db'; });
        dropzone.addEventListener('drop', e => {
          e.preventDefault(); dropzone.style.borderColor = '#d1d5db';
          if (e.dataTransfer.files.length > 0) { fileInput.files = e.dataTransfer.files; handleMbFileSelected(e.dataTransfer.files[0]); }
        });
        fileInput.addEventListener('change', () => { if (fileInput.files.length > 0) handleMbFileSelected(fileInput.files[0]); });
      }
      if (clearBtn) clearBtn.addEventListener('click', () => {
        mbFile = null;
        document.getElementById('mb-file-info').style.display = 'none';
        document.getElementById('mb-parse-btn').disabled = true;
        if (fileInput) fileInput.value = '';
      });
      if (parseBtn) parseBtn.addEventListener('click', handleMbParse);

      const periodSel = document.getElementById('mb-period');
      if (periodSel) periodSel.addEventListener('change', updateMbParseBtn);

      const backStep1 = document.getElementById('mb-back-step1');
      if (backStep1) backStep1.addEventListener('click', () => {
        currentStep = 1; mbParseResult = null; mbPreviewResult = null;
        document.getElementById('si-stepper').innerHTML = renderStepper();
        bindStepHandlers();
      });

      const commitBtn = document.getElementById('mb-commit-btn');
      if (commitBtn) commitBtn.addEventListener('click', handleMbCommit);
    }

    // ── Seasonal handlers ──
    if (mode === 'seasonal') {
      const dropzone  = document.getElementById('se-dropzone');
      const fileInput = document.getElementById('se-file-input');
      const parseBtn  = document.getElementById('se-parse-btn');
      const clearBtn  = document.getElementById('se-clear-file');

      if (dropzone && fileInput) {
        dropzone.addEventListener('click', () => fileInput.click());
        dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.style.borderColor = '#25C1AC'; });
        dropzone.addEventListener('dragleave', () => { dropzone.style.borderColor = '#d1d5db'; });
        dropzone.addEventListener('drop', e => {
          e.preventDefault(); dropzone.style.borderColor = '#d1d5db';
          if (e.dataTransfer.files.length > 0) { fileInput.files = e.dataTransfer.files; handleSeFileSelected(e.dataTransfer.files[0]); }
        });
        fileInput.addEventListener('change', () => { if (fileInput.files.length > 0) handleSeFileSelected(fileInput.files[0]); });
      }
      if (clearBtn) clearBtn.addEventListener('click', () => {
        seFile = null;
        document.getElementById('se-file-info').style.display = 'none';
        document.getElementById('se-parse-btn').disabled = true;
        if (fileInput) fileInput.value = '';
      });
      if (parseBtn) parseBtn.addEventListener('click', handleSeParse);

      const backStep1 = document.getElementById('se-back-step1');
      if (backStep1) backStep1.addEventListener('click', () => {
        currentStep = 1; seParseResult = null; sePreviewResult = null;
        document.getElementById('si-stepper').innerHTML = renderStepper();
        bindStepHandlers();
      });

      const backStep2 = document.getElementById('se-back-step2');
      if (backStep2) backStep2.addEventListener('click', () => {
        currentStep = 2; sePreviewResult = null;
        document.getElementById('si-stepper').innerHTML = renderStepper();
        bindStepHandlers();
      });

      const previewBtn = document.getElementById('se-preview-btn');
      if (previewBtn) previewBtn.addEventListener('click', handleSeGeneratePreview);

      const commitBtn = document.getElementById('se-commit-btn');
      if (commitBtn) commitBtn.addEventListener('click', handleSeCommit);
    }
  }

  // ── Master Bill file selection ────────────────────────────────────────────
  function handleMbFileSelected(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    const errEl = document.getElementById('mb-parse-error');
    if (!['xlsx','xls'].includes(ext)) {
      if (errEl) { errEl.textContent = 'Only .xlsx files are supported for Master Bill import.'; errEl.style.display = 'block'; }
      return;
    }
    mbFile = file;
    const info = document.getElementById('mb-file-info');
    const nameEl = document.getElementById('mb-filename');
    if (info) info.style.display = 'block';
    if (nameEl) nameEl.textContent = `${file.name} (${(file.size/1024).toFixed(1)} KB)`;
    updateMbParseBtn();
    // Reset preview/commit when new file selected
    mbParseResult = null; mbPreviewResult = null;
    mbFileToken++;
  }

  function updateMbParseBtn() {
    const btn    = document.getElementById('mb-parse-btn');
    const period = document.getElementById('mb-period');
    if (btn) btn.disabled = !(mbFile && period?.value);
  }

  // ── Master Bill parse ─────────────────────────────────────────────────────
  async function handleMbParse() {
    const btn     = document.getElementById('mb-parse-btn');
    const errEl   = document.getElementById('mb-parse-error');
    const period  = document.getElementById('mb-period');
    if (errEl) errEl.style.display = 'none';

    if (!mbFile || !period?.value) return;

    btn.disabled = true;
    btn.textContent = 'Parsing…';

    const formData = new FormData();
    formData.append('file', mbFile);
    formData.append('batchLabel', period.value);

    try {
      mbParseResult = await apiFetch('/api/admin/import/master-bill/parse', {
        method: 'POST', body: formData, timeout: 60000,
      });

      // Auto-run preview
      btn.textContent = 'Generating preview…';
      mbPreviewResult = await apiFetch('/api/admin/import/master-bill/preview', {
        method: 'POST',
        body: JSON.stringify(mbParseResult),
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000,
      });

      currentStep = 2;
      document.getElementById('si-stepper').innerHTML = renderStepper();
      bindStepHandlers();
      showToast(`Parsed ${mbParseResult.rows.length} rows`, 'success');
    } catch (err) {
      if (errEl) { errEl.textContent = err.message; errEl.style.display = 'block'; }
      btn.disabled = false;
      btn.textContent = 'Parse & Preview →';
    }
  }

  // ── Master Bill commit ────────────────────────────────────────────────────
  async function handleMbCommit() {
    if (!mbParseResult || !mbPreviewResult) return;
    if (mbPreviewResult.blockingErrors?.length > 0) return;

    const totalRows = (mbPreviewResult.totals?.invoiceRows ?? 0);
    const confirmed = window.confirm(
      `This will write ${totalRows} invoice rows and ${mbPreviewResult.totals?.completionRows ?? 0} task rows ` +
      `to PRODUCTION for billing period "${mbParseResult.batchLabel}".\n\nProceed?`
    );
    if (!confirmed) return;

    const commitBtn = document.getElementById('mb-commit-btn');
    if (commitBtn) { commitBtn.disabled = true; commitBtn.textContent = 'Committing…'; }

    try {
      const result = await apiFetch('/api/admin/import/master-bill/commit', {
        method: 'POST',
        body: JSON.stringify({ parsed: mbParseResult, preview: mbPreviewResult }),
        headers: { 'Content-Type': 'application/json' },
        timeout: 120000,
      });

      currentStep = 3;
      document.getElementById('si-stepper').innerHTML = renderStepper();

      const resultEl = document.getElementById('mb-commit-result');
      if (resultEl) {
        resultEl.innerHTML = `
          <div style="max-width:700px">
            <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:20px;margin-bottom:16px">
              <h4 style="color:#16a34a;font-weight:700;margin-bottom:8px">✓ Import Complete — ${esc(result.batchLabel)}</h4>
              <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:8px">
                <div><strong>Invoices inserted:</strong> ${result.invoicesInserted}</div>
                <div><strong>Invoices skipped:</strong> ${result.invoicesSkipped}</div>
                <div></div>
                <div><strong>Tasks inserted:</strong> ${result.tasksInserted}</div>
                <div><strong>Tasks skipped:</strong> ${result.tasksSkipped}</div>
                <div><strong>Batch ID:</strong> <code style="font-size:11px">${esc(result.batchId)}</code></div>
              </div>
            </div>
            <div>
              <h4 style="font-size:13px;font-weight:600;margin-bottom:8px">Undo SQL (copy before leaving this page)</h4>
              <div style="position:relative">
                <pre style="background:#1e293b;color:#e2e8f0;padding:16px;border-radius:8px;font-size:12px;overflow:auto;line-height:1.6">${esc(result.undoSQL)}</pre>
                <button class="btn btn-secondary btn-xs" id="mb-copy-undo" style="position:absolute;top:8px;right:8px">Copy</button>
              </div>
            </div>
            <div style="margin-top:16px">
              <button class="btn btn-ghost" id="mb-new-import">Import another bill</button>
            </div>
          </div>
        `;
        document.getElementById('mb-copy-undo')?.addEventListener('click', () => {
          navigator.clipboard.writeText(result.undoSQL).then(() => showToast('Copied to clipboard', 'success'));
        });
        document.getElementById('mb-new-import')?.addEventListener('click', () => {
          currentStep = 1; mbParseResult = null; mbPreviewResult = null; mbFile = null;
          document.getElementById('si-stepper').innerHTML = renderStepper();
          bindStepHandlers();
        });
      }

      showToast('Master Bill import committed successfully.', 'success');
      loadHistory();
    } catch (err) {
      showToast(`Commit failed: ${err.message}`, 'error');
      if (commitBtn) { commitBtn.disabled = false; commitBtn.textContent = 'Commit to Production →'; }
    }
  }

  // ── Seasonal file selection ───────────────────────────────────────────────
  function handleSeFileSelected(file) {
    seFile = file;
    const info = document.getElementById('se-file-info');
    const nameEl = document.getElementById('se-filename');
    if (info) info.style.display = 'block';
    if (nameEl) nameEl.textContent = `${file.name} (${(file.size/1024).toFixed(1)} KB)`;
    const btn = document.getElementById('se-parse-btn');
    if (btn) btn.disabled = false;
    seParseResult = null; sePreviewResult = null; seFileToken++;
  }

  // ── Seasonal parse ────────────────────────────────────────────────────────
  async function handleSeParse() {
    const btn   = document.getElementById('se-parse-btn');
    const errEl = document.getElementById('se-parse-error');
    if (!seFile) return;
    btn.disabled = true; btn.textContent = 'Parsing…';
    if (errEl) errEl.style.display = 'none';

    const formData = new FormData();
    formData.append('file', seFile);

    try {
      seParseResult = await apiFetch('/api/admin/import/seasonal/parse', {
        method: 'POST', body: formData, timeout: 60000,
      });
      seAllRows = seParseResult.allRows;
      currentStep = 2;
      document.getElementById('si-stepper').innerHTML = renderStepper();
      bindStepHandlers();
      showToast(`Parsed ${seParseResult.totalRows} rows with ${seParseResult.columns.length} columns`, 'success');
    } catch (err) {
      if (errEl) { errEl.textContent = err.message; errEl.style.display = 'block'; }
      btn.disabled = false; btn.textContent = 'Parse & Continue →';
    }
  }

  // ── Seasonal generate preview ─────────────────────────────────────────────
  async function handleSeGeneratePreview() {
    const btn   = document.getElementById('se-preview-btn');
    const errEl = document.getElementById('se-map-error');
    if (errEl) errEl.style.display = 'none';

    const mappings = {};
    document.querySelectorAll('.se-map').forEach(sel => {
      mappings[sel.dataset.field] = sel.value || null;
    });

    if (!mappings.communityCode || !mappings.serviceDate || !mappings.serviceType || !mappings.taskTitle) {
      if (errEl) { errEl.textContent = 'Community Code, Service Date, Service Type, and Task Title are required.'; errEl.style.display = 'block'; }
      return;
    }

    seMappings = mappings;
    btn.disabled = true; btn.textContent = 'Generating preview…';

    try {
      sePreviewResult = await apiFetch('/api/admin/import/seasonal/preview', {
        method: 'POST',
        body: JSON.stringify({ allRows: seAllRows, mappings }),
        headers: { 'Content-Type': 'application/json' },
        timeout: 60000,
      });

      currentStep = 3;
      document.getElementById('si-stepper').innerHTML = renderStepper();
      bindStepHandlers();
    } catch (err) {
      if (errEl) { errEl.textContent = err.message; errEl.style.display = 'block'; }
      btn.disabled = false; btn.textContent = 'Generate Preview →';
    }
  }

  // ── Seasonal commit ───────────────────────────────────────────────────────
  async function handleSeCommit() {
    if (!sePreviewResult || !seMappings || !seAllRows) return;
    if (sePreviewResult.blockingErrors?.length > 0) return;

    const c = sePreviewResult.counts;
    const confirmed = window.confirm(
      `This will write ${c.schedulesToCreate} schedules, ${c.visitsToInsert} visits, ` +
      `${c.tasksToInsert} tasks, and ${c.completionsToInsert} completions to PRODUCTION.\n\nProceed?`
    );
    if (!confirmed) return;

    const commitBtn = document.getElementById('se-commit-btn');
    if (commitBtn) { commitBtn.disabled = true; commitBtn.textContent = 'Committing…'; }

    try {
      const result = await apiFetch('/api/admin/import/seasonal/commit', {
        method: 'POST',
        body: JSON.stringify({ allRows: seAllRows, mappings: seMappings }),
        headers: { 'Content-Type': 'application/json' },
        timeout: 120000,
      });

      currentStep = 4;
      document.getElementById('si-stepper').innerHTML = renderStepper();

      const resultEl = document.getElementById('se-commit-result');
      if (resultEl) {
        resultEl.innerHTML = `
          <div style="max-width:700px">
            <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:20px;margin-bottom:16px">
              <h4 style="color:#16a34a;font-weight:700;margin-bottom:8px">✓ Seasonal Import Complete</h4>
              <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
                <div><strong>Schedules created:</strong> ${result.schedulesCreated}</div>
                <div><strong>Visits inserted:</strong> ${result.visitsInserted}</div>
                <div><strong>Visits skipped:</strong> ${result.visitsSkipped}</div>
                <div><strong>Tasks inserted:</strong> ${result.tasksInserted}</div>
                <div><strong>Tasks skipped:</strong> ${result.tasksSkipped}</div>
                <div><strong>Completions:</strong> ${result.completionsInserted}</div>
              </div>
              <div style="margin-top:8px;font-size:12px;color:#6b7280">Batch ID: <code>${esc(result.batchId)}</code></div>
            </div>
            <div>
              <h4 style="font-size:13px;font-weight:600;margin-bottom:8px">Undo SQL (copy before leaving this page)</h4>
              <div style="position:relative">
                <pre style="background:#1e293b;color:#e2e8f0;padding:16px;border-radius:8px;font-size:12px;overflow:auto;line-height:1.6">${esc(result.undoSQL)}</pre>
                <button class="btn btn-secondary btn-xs" id="se-copy-undo" style="position:absolute;top:8px;right:8px">Copy</button>
              </div>
            </div>
            <div style="margin-top:16px">
              <button class="btn btn-ghost" id="se-new-import">Import another file</button>
            </div>
          </div>
        `;
        document.getElementById('se-copy-undo')?.addEventListener('click', () => {
          navigator.clipboard.writeText(result.undoSQL).then(() => showToast('Copied to clipboard', 'success'));
        });
        document.getElementById('se-new-import')?.addEventListener('click', () => {
          currentStep = 1; seParseResult = null; sePreviewResult = null; seFile = null; seMappings = null;
          document.getElementById('si-stepper').innerHTML = renderStepper();
          bindStepHandlers();
        });
      }

      showToast('Seasonal import committed successfully.', 'success');
      loadHistory();
    } catch (err) {
      showToast(`Commit failed: ${err.message}`, 'error');
      if (commitBtn) { commitBtn.disabled = false; commitBtn.textContent = 'Commit to Production →'; }
    }
  }

  // ── Initial render ─────────────────────────────────────────────────────────
  render();
});
