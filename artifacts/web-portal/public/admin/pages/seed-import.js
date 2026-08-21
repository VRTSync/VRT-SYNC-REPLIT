AdminRouter.register('imports/seed', async function(container) {
  const { apiFetch, showToast } = AdminAPI;
  const esc = VRTUtils.esc;

  // ── State ──────────────────────────────────────────────────────────────────
  let mode         = 'master_bill';   // 'master_bill' | 'seasonal'
  let currentStep  = 1;

  // Master Bill state
  let mbFile            = null;
  let mbParseResult     = null;   // returned from /parse
  let mbPreviewResult   = null;   // returned from /preview
  let mbFileToken       = 0;      // increments on new upload, resets commit availability
  let mbAcknowledgedSet = new Set(); // codes explicitly acknowledged by the admin

  // Seasonal state
  let seFile          = null;
  let seParseResult   = null;
  let seAllRows       = null;
  let sePreviewResult = null;
  let seFileToken     = 0;

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
      mbParseResult = null; mbPreviewResult = null; mbAcknowledgedSet = new Set();
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
    const steps = [{num:1,label:'Upload'},{num:2,label:'Preview'},{num:3,label:'Commit'}];

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
      if (currentStep===2) return renderSeStep2();  // Preview
      if (currentStep===3) return renderSeStep3();  // Commit result
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

  // Every figure the admin sees before committing must reflect the rows that
  // will actually be written — acknowledged codes are subtracted from the
  // invoice, completion, contract and dollar figures alike, and added to the
  // skip count. Per-code completion/contract splits come from perBranchCounts,
  // which is populated for every known PNC code that has rows (including
  // unmatched ones).
  function mbCalcEffectiveTotals() {
    const p = mbPreviewResult;
    if (!p) {
      return { invoiceRows: 0, completionRows: 0, contractRows: 0, totalAmount: 0, skippedRows: 0 };
    }
    const branch = p.perBranchCounts ?? {};
    let subRows = 0, subCompletions = 0, subContracts = 0, subAmount = 0;
    for (const u of p.unmatchedCodes ?? []) {
      if (!mbAcknowledgedSet.has(u.code)) continue;
      subRows   += u.rowCount;
      subAmount += u.totalAmount;
      const b = branch[u.code];
      if (b) {
        subCompletions += b.completions ?? 0;
        subContracts   += b.contracts ?? 0;
      }
    }
    return {
      invoiceRows:    (p.totals?.invoiceRows    ?? 0) - subRows,
      completionRows: (p.totals?.completionRows ?? 0) - subCompletions,
      contractRows:   (p.totals?.contractOnlyCount ?? p.totals?.contractRows ?? 0) - subContracts,
      totalAmount:    (p.totals?.totalAmount    ?? 0) - subAmount,
      skippedRows:    (p.skippedRows ?? []).length + subRows,
    };
  }

  // Parse-stage skips merged with the rows the acknowledged codes will skip —
  // the same unified view the post-import summary shows.
  function mbUnifiedPreviewSkips() {
    const p = mbPreviewResult;
    if (!p) return [];
    const all = (p.skippedRows ?? []).slice();
    for (const u of p.unmatchedCodes ?? []) {
      if (!mbAcknowledgedSet.has(u.code)) continue;
      for (const r of u.excelRows ?? []) {
        all.push({ excelRow: r, reason: 'acknowledged_unmatched' });
      }
    }
    return all.sort((a, b) => a.excelRow - b.excelRow);
  }

  function mbRenderCountCards() {
    const p = mbPreviewResult;
    if (!p) return '';
    const eff = mbCalcEffectiveTotals();
    return [
      {label:'Invoice Rows',    val: eff.invoiceRows,    color:'#2563eb', bg:'#eff6ff', border:'#bfdbfe'},
      {label:'Completion Rows', val: eff.completionRows, color:'#16a34a', bg:'#f0fdf4', border:'#bbf7d0'},
      {label:'Contract-Only',   val: eff.contractRows,   color:'#d97706', bg:'#fefce8', border:'#fde68a'},
      {label:'Skipped Rows',    val: eff.skippedRows,    color:'#6b7280', bg:'#f5f5f4', border:'#d6d3d1'},
      {label:'Date-Clamped',    val: (p.clampedRows ?? []).length, color:'#7c3aed', bg:'#f3e8ff', border:'#ddd6fe'},
    ].map(c => `
      <div style="background:${c.bg};border:1px solid ${c.border};border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:20px;font-weight:700;color:${c.color}">${c.val}</div>
        <div style="font-size:11px;color:#6b7280">${c.label}</div>
      </div>
    `).join('');
  }

  function mbRenderSkippedRowsBody() {
    const skips = mbUnifiedPreviewSkips();
    if (skips.length === 0) {
      return '<p style="font-size:12px;color:#6b7280;padding:8px 0">No rows skipped.</p>';
    }
    return `<table style="font-size:12px">
      <thead><tr><th>Excel Row</th><th>Reason</th></tr></thead>
      <tbody>
        ${skips.map(s => `<tr><td>${s.excelRow}</td><td>${esc(s.reason)}</td></tr>`).join('')}
      </tbody>
    </table>`;
  }

  function mbRenderEffectiveTotals() {
    const eff = mbCalcEffectiveTotals();
    return `<strong>Total Amount:</strong> $${eff.totalAmount.toFixed(2)}
      &nbsp;|&nbsp;
      <strong>Invoice Rows:</strong> ${eff.invoiceRows}
      &nbsp;|&nbsp;
      <strong>Completion Rows:</strong> ${eff.completionRows}`;
  }

  function mbUpdateCommitGate() {
    const p = mbPreviewResult;
    if (!p) return;
    const hasBlockingErrors = (p.blockingErrors ?? []).length > 0;
    const unmatchedCodes    = p.unmatchedCodes ?? [];
    const allAcknowledged   = unmatchedCodes.every(u => mbAcknowledgedSet.has(u.code));
    const canCommit         = !hasBlockingErrors && allAcknowledged;
    const btn = document.getElementById('mb-commit-btn');
    if (btn) {
      btn.disabled = !canCommit;
      btn.textContent = hasBlockingErrors
        ? 'Fix Errors Before Committing'
        : !allAcknowledged
          ? 'Acknowledge All Unmatched Codes to Commit'
          : 'Commit to Production →';
    }
    // Refresh every derived figure together so the cards, the skip table and
    // the totals bar can never disagree with each other.
    const totalsEl = document.getElementById('mb-effective-totals');
    if (totalsEl) totalsEl.innerHTML = mbRenderEffectiveTotals();
    const cardsEl = document.getElementById('mb-count-cards');
    if (cardsEl) cardsEl.innerHTML = mbRenderCountCards();
    const skipCountEl = document.getElementById('mb-skipped-count');
    if (skipCountEl) skipCountEl.textContent = String(mbUnifiedPreviewSkips().length);
    const skipBodyEl = document.getElementById('mb-skipped-body');
    if (skipBodyEl) skipBodyEl.innerHTML = mbRenderSkippedRowsBody();
  }

  function renderMbStep2() {
    if (!mbPreviewResult) return '<p style="color:#6b7280">Generating preview…</p>';
    const p = mbPreviewResult;

    const hasBlockingErrors = (p.blockingErrors ?? []).length > 0;
    const unmatchedCodes    = p.unmatchedCodes ?? [];
    const hasUnmatched      = unmatchedCodes.length > 0;
    const allAcknowledged   = !hasUnmatched || unmatchedCodes.every(u => mbAcknowledgedSet.has(u.code));
    const canCommit         = !hasBlockingErrors && allAcknowledged;

    return `
      <div style="max-width:860px">
        <h3 style="font-size:14px;font-weight:600;margin-bottom:16px">Import Preview — ${esc(mbParseResult?.batchLabel ?? '')}</h3>

        ${hasBlockingErrors ? `
          <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin-bottom:16px">
            <div style="font-weight:600;color:#dc2626;margin-bottom:8px;font-size:13px">⛔ Blocking Errors — Commit is disabled</div>
            ${p.blockingErrors.map(e => `<div style="color:#dc2626;font-size:13px;margin-bottom:4px">• ${esc(e)}</div>`).join('')}
          </div>
        ` : (!hasUnmatched ? `
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px;margin-bottom:16px;font-size:13px;color:#15803d">
            ✓ All validations passed — ready to commit
          </div>
        ` : '')}

        ${hasUnmatched ? `
          <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px;margin-bottom:16px">
            <div style="font-weight:600;color:#92400e;margin-bottom:10px;font-size:13px">
              ⚠ Unmatched PNC Codes — acknowledge each to enable Commit
            </div>
            ${unmatchedCodes.map(u => `
              <label style="display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:13px;cursor:pointer">
                <input type="checkbox" class="mb-ack-checkbox" data-code="${esc(u.code)}"
                       ${mbAcknowledgedSet.has(u.code) ? 'checked' : ''}>
                <strong>${esc(u.code)}</strong>
                <span style="color:#374151">${u.rowCount} row${u.rowCount !== 1 ? 's' : ''} / $${u.totalAmount.toFixed(2)}</span>
                <span style="color:#9ca3af;font-size:12px">— no matching community; rows will be skipped</span>
              </label>
            `).join('')}
          </div>
        ` : ''}

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

        <!-- Counts (recalculated as codes are acknowledged) -->
        <div id="mb-count-cards" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:12px;margin-bottom:16px">
          ${mbRenderCountCards()}
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

        <!-- Skipped Rows — parse-stage skips plus acknowledged codes.
             Rendered whenever either source could contribute, so the container
             exists for in-place updates when a checkbox is ticked. -->
        ${((p.skippedRows ?? []).length > 0 || hasUnmatched) ? `
          <details style="margin-bottom:16px">
            <summary style="font-size:13px;font-weight:600;cursor:pointer;padding:8px 0">
              Skipped Rows (<span id="mb-skipped-count">${mbUnifiedPreviewSkips().length}</span>)
            </summary>
            <div id="mb-skipped-body" class="table-container" style="margin-top:8px;max-height:300px;overflow:auto">
              ${mbRenderSkippedRowsBody()}
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

        <!-- Effective Totals (updates dynamically as codes are acknowledged) -->
        <div id="mb-effective-totals" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin-bottom:16px;font-size:13px">
          ${mbRenderEffectiveTotals()}
        </div>

        <div style="display:flex;justify-content:space-between">
          <button class="btn btn-ghost" id="mb-back-step1">← Back to Upload</button>
          <button class="btn btn-primary" id="mb-commit-btn" ${canCommit ? '' : 'disabled'}>
            ${hasBlockingErrors ? 'Fix Errors Before Committing' : !allAcknowledged ? 'Acknowledge All Unmatched Codes to Commit' : 'Commit to Production →'}
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
        <h3 style="font-size:14px;font-weight:600;margin-bottom:4px">Upload Contract Task List</h3>
        <p style="font-size:13px;color:#6b7280;margin-bottom:16px">
          Upload the <strong>Contract Task List - VRT.xlsx</strong> file. The importer uses a
          fixed layout (8 columns, 18 rows) and applies the programme to all 11 pilot-org
          branches automatically — no column mapping required.
        </p>
        <div style="border:2px dashed #d1d5db;border-radius:8px;padding:32px;text-align:center;cursor:pointer;transition:border-color 0.2s" id="se-dropzone">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="1.5" style="margin:0 auto 8px">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          <p style="color:#6b7280;font-size:13px;margin-bottom:8px">Drag & drop or click to browse</p>
          <p style="color:#9ca3af;font-size:11px">.xlsx — Max 50MB</p>
          <input type="file" id="se-file-input" accept=".xlsx,.xls" style="display:none">
        </div>
        <div id="se-file-info" style="display:none;margin-top:12px;padding:12px;background:#fff;border:1px solid #e5e7eb;border-radius:6px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span id="se-filename" style="font-size:13px;font-weight:500"></span>
            <button class="btn btn-ghost btn-sm" id="se-clear-file" style="color:#ef4444">Remove</button>
          </div>
        </div>
        <div style="margin-top:16px;text-align:right">
          <button class="btn btn-primary" id="se-parse-btn" disabled>Parse & Preview →</button>
        </div>
        <div id="se-parse-error" style="display:none;margin-top:12px;color:#ef4444;font-size:13px;background:#fef2f2;padding:8px 12px;border-radius:6px"></div>
      </div>
    `;
  }

  // ── Seasonal Step 2 — Preview ─────────────────────────────────────────────
  function renderSeStep2() {
    if (!sePreviewResult) return '<p style="color:#6b7280">Generating preview…</p>';
    const p = sePreviewResult;
    const hasErrors = (p.blockingErrors && p.blockingErrors.length > 0);

    // Build unique list of schedules grouped by community for the per-branch table
    const communitySchedules = {};
    (p.schedulePlans || []).forEach(sp => {
      if (!communitySchedules[sp.communityCode]) {
        communitySchedules[sp.communityCode] = {
          code: sp.communityCode, name: sp.communityName, id: sp.communityId,
          schedules: 0, visits: 0, completed: 0, scheduled: 0,
        };
      }
      const c = communitySchedules[sp.communityCode];
      c.schedules++;
      c.visits    += sp.visitCount;
      c.completed += sp.completedVisits;
      c.scheduled += sp.scheduledVisits;
    });

    const branchRows = Object.values(communitySchedules).sort((a, b) => a.code.localeCompare(b.code));
    const oneTimePerBranch  = p.counts.oneTimeRows   || 0;
    const completionsPerBranch = Math.round((p.counts.completionsToInsert || 0) / Math.max(1, (p.counts.communities || 11)));

    return `
      <div style="max-width:860px">
        <h3 style="font-size:14px;font-weight:600;margin-bottom:16px">
          Contract Import Preview — ${esc(seParseResult?.totalRows ?? 0)} rows parsed
        </h3>

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

        ${p.warnings && p.warnings.length > 0 ? `
          <div style="background:#fefce8;border:1px solid #fde68a;border-radius:8px;padding:12px;margin-bottom:16px;font-size:13px;color:#92400e">
            ${p.warnings.map(w => `<div>⚠ ${esc(w)}</div>`).join('')}
          </div>
        ` : ''}

        <!-- Community Mapping Table — prominent, same style as Master Bill -->
        <div style="background:#fff;border:2px solid #25C1AC;border-radius:8px;padding:16px;margin-bottom:16px">
          <h4 style="font-size:13px;font-weight:700;margin-bottom:10px;color:#0C1D31">Pilot Community Mapping (${(p.communityMapping||[]).length} branches)</h4>
          <div class="table-container" style="box-shadow:none;border:none">
            <table style="font-size:13px">
              <thead><tr>
                <th>Code</th><th>Community Name</th><th>Community ID</th><th>Org ID</th>
              </tr></thead>
              <tbody>
                ${(p.communityMapping || []).map(c => `<tr>
                  <td><strong>${esc(c.code)}</strong></td>
                  <td>${esc(c.name)}</td>
                  <td style="font-family:monospace;font-size:11px;color:#6b7280">${esc(c.id)}</td>
                  <td style="font-family:monospace;font-size:11px;color:#6b7280">${esc(c.orgId)}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Service Account -->
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin-bottom:16px;font-size:13px">
          <strong>Attribution:</strong>
          ${p.serviceAccountResolution?.exists
            ? `<span style="color:#16a34a">✓ Existing service account — "${esc(p.serviceAccountResolution.displayName)}"</span>`
            : `<span style="color:#d97706">⚠ Will create: "${esc(p.serviceAccountResolution?.displayName ?? '')}"</span>`
          }
        </div>

        <!-- Org-level totals -->
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:12px;margin-bottom:16px">
          ${[
            {label:'Schedules',         val: p.counts.schedulesToCreate + p.counts.schedulesExisting, color:'#25C1AC', bg:'#f0fdfa', border:'#99f6e4'},
            {label:'Total Visits',      val: p.counts.visitsToInsert,     color:'#2563eb', bg:'#eff6ff', border:'#bfdbfe'},
            {label:'Completed Visits',  val: p.counts.completedVisits,    color:'#16a34a', bg:'#f0fdf4', border:'#bbf7d0'},
            {label:'Scheduled Visits',  val: p.counts.scheduledVisits,    color:'#0369a1', bg:'#e0f2fe', border:'#bae6fd'},
            {label:'Tasks',             val: p.counts.tasksToInsert,      color:'#7c3aed', bg:'#f3e8ff', border:'#ddd6fe'},
            {label:'Completions',       val: p.counts.completionsToInsert,color:'#059669', bg:'#d1fae5', border:'#6ee7b7'},
            {label:'Skipped Rows',      val: p.counts.skippedRows,        color:'#dc2626', bg:'#fef2f2', border:'#fecaca'},
            {label:'Communities',       val: p.counts.communities,        color:'#6b7280', bg:'#f9fafb', border:'#e5e7eb'},
          ].map(c => `
            <div style="background:${c.bg};border:1px solid ${c.border};border-radius:8px;padding:12px;text-align:center">
              <div style="font-size:20px;font-weight:700;color:${c.color}">${c.val ?? 0}</div>
              <div style="font-size:11px;color:#6b7280">${c.label}</div>
            </div>
          `).join('')}
        </div>

        <!-- Per-branch projected counts -->
        ${branchRows.length > 0 ? `
          <div style="margin-bottom:16px">
            <h4 style="font-size:13px;font-weight:600;margin-bottom:8px">Per-Branch Projected Counts</h4>
            <div class="table-container">
              <table style="font-size:12px">
                <thead><tr>
                  <th>Code</th><th>Community</th><th>Schedules</th>
                  <th>Total Visits</th><th>Completed</th><th>Scheduled</th>
                  <th>Tasks</th><th>Completions</th>
                </tr></thead>
                <tbody>
                  ${branchRows.map(br => `<tr>
                    <td><strong>${esc(br.code)}</strong></td>
                    <td>${esc(br.name)}</td>
                    <td>${br.schedules}</td>
                    <td>${br.visits}</td>
                    <td style="color:#16a34a">${br.completed}</td>
                    <td style="color:#0369a1">${br.scheduled}</td>
                    <td>${oneTimePerBranch}</td>
                    <td>${completionsPerBranch}</td>
                  </tr>`).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}

        <div style="display:flex;justify-content:space-between">
          <button class="btn btn-ghost" id="se-back-step1">← Back to Upload</button>
          <button class="btn btn-primary" id="se-commit-btn" ${hasErrors?'disabled':''}>
            ${hasErrors ? 'Fix Errors Before Committing' : 'Commit to Production →'}
          </button>
        </div>
      </div>
    `;
  }

  // ── Seasonal Step 3 — Commit result ───────────────────────────────────────
  function renderSeStep3() {
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
        currentStep = 1; mbParseResult = null; mbPreviewResult = null; mbAcknowledgedSet = new Set();
        document.getElementById('si-stepper').innerHTML = renderStepper();
        bindStepHandlers();
      });

      const commitBtn = document.getElementById('mb-commit-btn');
      if (commitBtn) commitBtn.addEventListener('click', handleMbCommit);

      // Bind acknowledgement checkboxes for unmatched codes
      document.querySelectorAll('.mb-ack-checkbox').forEach(cb => {
        cb.addEventListener('change', () => {
          const code = cb.dataset.code;
          if (!code) return;
          if (cb.checked) mbAcknowledgedSet.add(code);
          else mbAcknowledgedSet.delete(code);
          mbUpdateCommitGate();
        });
      });
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
    // Reset preview/commit/acknowledgements when new file selected
    mbParseResult = null; mbPreviewResult = null; mbAcknowledgedSet = new Set();
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

    // Hard guard: all unmatched codes must be acknowledged before commit
    const unmatchedCodes = mbPreviewResult.unmatchedCodes ?? [];
    if (unmatchedCodes.some(u => !mbAcknowledgedSet.has(u.code))) return;

    const eff = mbCalcEffectiveTotals();
    const skippedCodes = unmatchedCodes.filter(u => mbAcknowledgedSet.has(u.code));
    const skipNote = skippedCodes.length > 0
      ? `\n\nSkipping ${skippedCodes.map(u => u.code).join(', ')} ` +
        `(${skippedCodes.reduce((s,u)=>s+u.rowCount,0)} rows, ` +
        `$${skippedCodes.reduce((s,u)=>s+u.totalAmount,0).toFixed(2)}) as acknowledged unmatched.`
      : '';
    const confirmed = window.confirm(
      `This will write ${eff.invoiceRows} invoice rows and ${eff.completionRows} task rows ` +
      `to PRODUCTION for billing period "${mbParseResult.batchLabel}".${skipNote}\n\nProceed?`
    );
    if (!confirmed) return;

    const commitBtn = document.getElementById('mb-commit-btn');
    if (commitBtn) { commitBtn.disabled = true; commitBtn.textContent = 'Committing…'; }

    try {
      const result = await apiFetch('/api/admin/import/master-bill/commit', {
        method: 'POST',
        body: JSON.stringify({
          parsed: mbParseResult,
          preview: mbPreviewResult,
          acknowledgedCodes: [...mbAcknowledgedSet],
        }),
        headers: { 'Content-Type': 'application/json' },
        timeout: 120000,
      });

      currentStep = 3;
      document.getElementById('si-stepper').innerHTML = renderStepper();

      const resultEl = document.getElementById('mb-commit-result');
      if (resultEl) {
        const skippedRows = result.skippedRows ?? [];
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
            ${skippedRows.length > 0 ? `
              <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px;margin-bottom:16px">
                <h4 style="font-size:13px;font-weight:600;margin-bottom:8px;color:#92400e">Skipped Rows (${skippedRows.length})</h4>
                ${(result.acknowledgedCodes ?? []).length > 0 ? `
                  <p style="font-size:12px;color:#92400e;margin-bottom:8px">
                    ${result.acknowledgedSkipCount ?? 0} row(s) skipped by explicit acknowledgement of unmatched
                    PNC code(s): <strong>${esc((result.acknowledgedCodes ?? []).join(', '))}</strong>.
                    Recorded on batch <code style="font-size:11px">${esc(result.batchId)}</code>.
                  </p>
                ` : ''}
                <div class="table-container" style="max-height:200px;overflow:auto">
                  <table style="font-size:12px">
                    <thead><tr><th>Excel Row</th><th>Reason</th></tr></thead>
                    <tbody>
                      ${skippedRows.map(s => `<tr><td>${s.excelRow}</td><td>${esc(s.reason)}</td></tr>`).join('')}
                    </tbody>
                  </table>
                </div>
              </div>
            ` : ''}
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
          mbAcknowledgedSet = new Set();
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

  // ── Seasonal parse + auto-preview ────────────────────────────────────────
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

      // If parse-level errors, show them immediately on the upload step
      if (seParseResult.parseErrors && seParseResult.parseErrors.length > 0) {
        const msgs = seParseResult.parseErrors.join('\n• ');
        if (errEl) {
          errEl.innerHTML = `<strong>File rejected:</strong><br>• ${msgs.split('\n').map(l => l).join('<br>')}`;
          errEl.style.display = 'block';
        }
        btn.disabled = false; btn.textContent = 'Parse & Preview →';
        return;
      }

      // Auto-run preview
      btn.textContent = 'Generating preview…';
      sePreviewResult = await apiFetch('/api/admin/import/seasonal/preview', {
        method: 'POST',
        body: JSON.stringify({ allRows: seAllRows }),
        headers: { 'Content-Type': 'application/json' },
        timeout: 60000,
      });

      currentStep = 2;
      document.getElementById('si-stepper').innerHTML = renderStepper();
      bindStepHandlers();
      showToast(`Parsed ${seParseResult.totalRows} rows — preview ready`, 'success');
    } catch (err) {
      if (errEl) { errEl.textContent = err.message; errEl.style.display = 'block'; }
      btn.disabled = false; btn.textContent = 'Parse & Preview →';
    }
  }

  // ── Seasonal commit ───────────────────────────────────────────────────────
  async function handleSeCommit() {
    if (!sePreviewResult || !seAllRows) return;
    if (sePreviewResult.blockingErrors?.length > 0) return;

    const c = sePreviewResult.counts;
    const confirmed = window.confirm(
      `This will write ${c.schedulesToCreate} schedule(s), ${c.visitsToInsert} visits, ` +
      `${c.tasksToInsert} tasks, and ${c.completionsToInsert} completions to PRODUCTION ` +
      `across ${c.communities} communities.\n\nProceed?`
    );
    if (!confirmed) return;

    const commitBtn = document.getElementById('se-commit-btn');
    if (commitBtn) { commitBtn.disabled = true; commitBtn.textContent = 'Committing…'; }

    try {
      const result = await apiFetch('/api/admin/import/seasonal/commit', {
        method: 'POST',
        body: JSON.stringify({ allRows: seAllRows }),
        headers: { 'Content-Type': 'application/json' },
        timeout: 120000,
      });

      currentStep = 3;
      document.getElementById('si-stepper').innerHTML = renderStepper();

      const resultEl = document.getElementById('se-commit-result');
      if (resultEl) {
        resultEl.innerHTML = `
          <div style="max-width:700px">
            <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:20px;margin-bottom:16px">
              <h4 style="color:#16a34a;font-weight:700;margin-bottom:8px">✓ Contract Import Complete</h4>
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
          currentStep = 1; seParseResult = null; sePreviewResult = null; seFile = null;
          document.getElementById('si-stepper').innerHTML = renderStepper();
          bindStepHandlers();
        });
      }

      showToast('Contract import committed successfully.', 'success');
      loadHistory();
    } catch (err) {
      showToast(`Commit failed: ${err.message}`, 'error');
      if (commitBtn) { commitBtn.disabled = false; commitBtn.textContent = 'Commit to Production →'; }
    }
  }

  // ── Initial render ─────────────────────────────────────────────────────────
  render();
});
