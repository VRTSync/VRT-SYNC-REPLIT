AdminRouter.register('imports/contract-tasks', async function(container) {
  const { apiFetch, showToast } = AdminAPI;

  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const PRIORITY_OPTIONS = ['low', 'medium', 'high', 'urgent'];

  let communities = [];
  let selectedCommunityId = '';
  let currentStep = 1;
  let parseResult = null;
  let allParsedRows = [];
  let previewResult = null;

  try {
    communities = await apiFetch('/api/communities');
  } catch { }

  function render() {
    container.innerHTML = `
      <div class="page-header" style="margin-top:16px">
        <h2 style="font-size:16px">Import Contract Task List</h2>
      </div>
      <div style="margin-bottom:16px">
        <label class="form-label" style="margin-bottom:4px">Community *</label>
        <select class="form-select" id="ci-community" style="max-width:320px">
          <option value="">Select a community...</option>
          ${communities.map(c => `<option value="${c.id}" ${c.id === selectedCommunityId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select>
      </div>
      ${selectedCommunityId ? renderStepper() : '<div style="padding:40px;text-align:center;color:#6b7280">Select a community to begin importing.</div>'}
    `;

    document.getElementById('ci-community').addEventListener('change', (e) => {
      selectedCommunityId = e.target.value;
      currentStep = 1;
      parseResult = null;
      allParsedRows = [];
      previewResult = null;
      render();
    });

    bindStepHandlers();
  }

  function renderStepper() {
    const steps = [
      { num: 1, label: 'Upload' },
      { num: 2, label: 'Map Columns' },
      { num: 3, label: 'Preview' },
      { num: 4, label: 'Import' },
    ];

    return `
      <div style="display:flex;gap:4px;margin-bottom:20px;border-bottom:1px solid #e5e7eb;padding-bottom:12px">
        ${steps.map(s => `
          <div style="flex:1;text-align:center;padding:8px 4px;border-radius:6px 6px 0 0;font-size:13px;font-weight:${currentStep === s.num ? '600' : '400'};color:${currentStep === s.num ? '#25C1AC' : currentStep > s.num ? '#10b981' : '#9ca3af'};border-bottom:2px solid ${currentStep === s.num ? '#25C1AC' : currentStep > s.num ? '#10b981' : 'transparent'}">
            <span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;font-size:11px;margin-right:4px;${currentStep > s.num ? 'background:#10b981;color:#fff' : currentStep === s.num ? 'background:#25C1AC;color:#fff' : 'background:#e5e7eb;color:#6b7280'}">${currentStep > s.num ? '✓' : s.num}</span>
            ${s.label}
          </div>
        `).join('')}
      </div>
      <div id="ci-step-content">${renderCurrentStep()}</div>
    `;
  }

  function renderCurrentStep() {
    switch (currentStep) {
      case 1: return renderStep1();
      case 2: return renderStep2();
      case 3: return renderStep3();
      case 4: return renderStep4();
      default: return '';
    }
  }

  function renderStep1() {
    return `
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:24px;max-width:500px">
        <h3 style="font-size:14px;font-weight:600;margin-bottom:12px">Upload Spreadsheet</h3>
        <p style="font-size:13px;color:#6b7280;margin-bottom:16px">Upload a .xlsx or .csv file containing your contract task list.</p>
        <div style="border:2px dashed #d1d5db;border-radius:8px;padding:32px;text-align:center;cursor:pointer;transition:border-color 0.2s" id="ci-dropzone">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="1.5" style="margin:0 auto 8px">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          <p style="color:#6b7280;font-size:13px;margin-bottom:8px">Drag & drop or click to browse</p>
          <p style="color:#9ca3af;font-size:11px">.xlsx, .csv — Max 50MB</p>
          <input type="file" id="ci-file-input" accept=".xlsx,.csv,.xls" style="display:none">
        </div>
        <div id="ci-file-info" style="display:none;margin-top:12px;padding:12px;background:#fff;border:1px solid #e5e7eb;border-radius:6px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span id="ci-filename" style="font-size:13px;font-weight:500"></span>
            <button class="btn btn-ghost btn-sm" id="ci-clear-file" style="color:#ef4444">Remove</button>
          </div>
        </div>
        <div id="ci-sheet-select-area" style="display:none;margin-top:12px">
          <label class="form-label">Select Sheet</label>
          <select class="form-select" id="ci-sheet-select"></select>
        </div>
        <div style="margin-top:16px;text-align:right">
          <button class="btn btn-primary" id="ci-upload-btn" disabled>Parse & Continue</button>
        </div>
        <div id="ci-upload-error" style="display:none;margin-top:12px;color:#ef4444;font-size:13px"></div>
      </div>
    `;
  }

  function renderStep2() {
    if (!parseResult) return '<p>No data parsed yet.</p>';

    const cols = parseResult.columns;
    const mappings = parseResult.inferredMappings || {};

    return `
      <div style="max-width:700px">
        <h3 style="font-size:14px;font-weight:600;margin-bottom:4px">Map Columns</h3>
        <p style="font-size:13px;color:#6b7280;margin-bottom:16px">Match spreadsheet columns to required fields. ${parseResult.totalRows} data rows detected.</p>

        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:16px">
          <h4 style="font-size:13px;font-weight:600;margin-bottom:12px">Task Fields</h4>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="form-group">
              <label class="form-label">Task Name / Title *</label>
              <select class="form-select ci-mapping" data-field="title">
                <option value="">— Select column —</option>
                ${cols.map(c => `<option value="${esc(c)}" ${mappings.title === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Window Start *</label>
              <select class="form-select ci-mapping" data-field="windowStart">
                <option value="">— Select column —</option>
                ${cols.map(c => `<option value="${esc(c)}" ${mappings.windowStart === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Window End *</label>
              <select class="form-select ci-mapping" data-field="windowEnd">
                <option value="">— Select column —</option>
                ${cols.map(c => `<option value="${esc(c)}" ${mappings.windowEnd === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Description / Notes</label>
              <select class="form-select ci-mapping" data-field="description">
                <option value="">— None —</option>
                ${cols.map(c => `<option value="${esc(c)}" ${mappings.description === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Priority</label>
              <select class="form-select ci-mapping" data-field="priority">
                <option value="">— Use default —</option>
                ${cols.map(c => `<option value="${esc(c)}" ${mappings.priority === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Category / Section</label>
              <select class="form-select ci-mapping" data-field="category">
                <option value="">— None —</option>
                ${cols.map(c => `<option value="${esc(c)}" ${mappings.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-group" style="margin-top:8px">
            <label class="form-label">Default Priority</label>
            <select class="form-select" id="ci-default-priority" style="max-width:200px">
              ${PRIORITY_OPTIONS.map(p => `<option value="${p}" ${p === 'medium' ? 'selected' : ''}>${p.charAt(0).toUpperCase() + p.slice(1)}</option>`).join('')}
            </select>
          </div>
        </div>

        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:16px">
          <h4 style="font-size:13px;font-weight:600;margin-bottom:8px">Mowing Schedule Detection</h4>
          <p style="font-size:12px;color:#6b7280;margin-bottom:12px">Identify which row(s) represent recurring mowing/landscape visits. These will become a service schedule instead of windowed tasks.</p>

          <div style="margin-bottom:12px">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px">
              <input type="radio" name="ci-mow-mode" value="keyword" checked> Auto-detect by keywords
            </label>
            <div id="ci-mow-keywords-area" style="margin-left:24px;margin-top:6px">
              <input class="form-input" id="ci-mow-keywords" type="text" value="mow, mowing, weekly maintenance, weekly service, landscape visit, weekly landscape" style="font-size:12px" placeholder="Comma-separated keywords">
            </div>
          </div>
          <div style="margin-bottom:12px">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px">
              <input type="radio" name="ci-mow-mode" value="manual"> Manually select rows
            </label>
            <div id="ci-mow-manual-area" style="display:none;margin-left:24px;margin-top:6px;max-height:200px;overflow-y:auto;border:1px solid #e5e7eb;border-radius:6px;padding:8px;background:#fff">
              ${allParsedRows.map((row, i) => {
                const titleCol = mappings.title || cols[0];
                const title = row[titleCol] || `Row ${i + 1}`;
                return `<label style="display:flex;align-items:center;gap:6px;padding:4px 0;font-size:12px;cursor:pointer;border-bottom:1px solid #f3f4f6">
                  <input type="checkbox" class="ci-mow-row-check" value="${i}"> ${esc(String(title))}
                </label>`;
              }).join('')}
            </div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:12px">
            <div class="form-group">
              <label class="form-label">Mowing Day *</label>
              <select class="form-select" id="ci-mow-dow">
                ${DAY_NAMES.map((name, i) => `<option value="${i}">${name}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Season Start</label>
              <input class="form-input" id="ci-mow-season-start" type="date">
            </div>
            <div class="form-group">
              <label class="form-label">Season End</label>
              <input class="form-input" id="ci-mow-season-end" type="date">
            </div>
          </div>
        </div>

        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:16px">
          <h4 style="font-size:13px;font-weight:600;margin-bottom:8px">Import Mode</h4>
          <div style="display:flex;gap:16px">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px">
              <input type="radio" name="ci-import-mode" value="create" checked> Create only (skip existing)
            </label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px">
              <input type="radio" name="ci-import-mode" value="upsert"> Upsert (update if existing)
            </label>
          </div>
        </div>

        <div id="ci-preview-area" style="margin-bottom:16px">
          <h4 style="font-size:13px;font-weight:600;margin-bottom:8px">Data Preview (first 10 rows)</h4>
          <div class="table-container" style="max-height:300px;overflow:auto">
            <table style="font-size:12px">
              <thead><tr>${cols.map(c => `<th style="white-space:nowrap">${esc(c)}</th>`).join('')}</tr></thead>
              <tbody>
                ${parseResult.rowsPreview.slice(0, 10).map(row => `<tr>${cols.map(c => `<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(String(row[c] ?? ''))}</td>`).join('')}</tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div style="display:flex;justify-content:space-between">
          <button class="btn btn-ghost" id="ci-back-step1">Back</button>
          <button class="btn btn-primary" id="ci-generate-preview">Generate Preview</button>
        </div>
        <div id="ci-step2-error" style="display:none;margin-top:12px;color:#ef4444;font-size:13px"></div>
      </div>
    `;
  }

  function renderStep3() {
    if (!previewResult) return '<p>No preview generated.</p>';

    const p = previewResult;

    return `
      <div style="max-width:800px">
        <h3 style="font-size:14px;font-weight:600;margin-bottom:12px">Import Preview</h3>

        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;margin-bottom:16px">
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px;text-align:center">
            <div style="font-size:20px;font-weight:700;color:#16a34a">${p.counts.toCreate}</div>
            <div style="font-size:11px;color:#6b7280">To Create</div>
          </div>
          <div style="background:#fefce8;border:1px solid #fde68a;border-radius:8px;padding:12px;text-align:center">
            <div style="font-size:20px;font-weight:700;color:#ca8a04">${p.counts.toUpdate}</div>
            <div style="font-size:11px;color:#6b7280">To Update</div>
          </div>
          <div style="background:#f5f5f4;border:1px solid #d6d3d1;border-radius:8px;padding:12px;text-align:center">
            <div style="font-size:20px;font-weight:700;color:#78716c">${p.counts.toSkip}</div>
            <div style="font-size:11px;color:#6b7280">To Skip</div>
          </div>
          <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px;text-align:center">
            <div style="font-size:20px;font-weight:700;color:#dc2626">${p.counts.errors}</div>
            <div style="font-size:11px;color:#6b7280">Errors</div>
          </div>
          <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px;text-align:center">
            <div style="font-size:20px;font-weight:700;color:#2563eb">${p.counts.mowingRows}</div>
            <div style="font-size:11px;color:#6b7280">Mowing Rows</div>
          </div>
        </div>

        ${p.mowingSchedulePreview ? `
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin-bottom:16px">
            <h4 style="font-size:13px;font-weight:600;margin-bottom:6px">Mowing Schedule — ${p.mowingSchedulePreview.action === 'update' ? 'Will UPDATE existing' : 'Will CREATE new'}</h4>
            <div style="font-size:13px;color:#374151">
              <strong>Day:</strong> ${DAY_NAMES[p.mowingSchedulePreview.dayOfWeek]}
              ${p.mowingSchedulePreview.seasonStart ? ` | <strong>Season:</strong> ${p.mowingSchedulePreview.seasonStart} to ${p.mowingSchedulePreview.seasonEnd || 'year end'}` : ''}
            </div>
          </div>
        ` : ''}

        <div style="margin-bottom:16px">
          <h4 style="font-size:13px;font-weight:600;margin-bottom:8px">Tasks Preview</h4>
          <div class="table-container" style="max-height:400px;overflow:auto">
            <table style="font-size:12px">
              <thead><tr>
                <th>Title</th>
                <th>Window Start</th>
                <th>Window End</th>
                <th>Priority</th>
                <th>Action</th>
              </tr></thead>
              <tbody>
                ${p.tasksPreview.map(t => {
                  const actionColors = {
                    create: '#10b981',
                    update: '#f59e0b',
                    skip: '#9ca3af',
                    error: '#ef4444',
                  };
                  return `<tr style="${t.action === 'error' ? 'background:#fef2f2' : ''}">
                    <td style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(t.title)}">${esc(t.title)}</td>
                    <td>${t.windowStart || '<span style="color:#ef4444">—</span>'}</td>
                    <td>${t.windowEnd || '<span style="color:#ef4444">—</span>'}</td>
                    <td><span style="text-transform:capitalize">${esc(t.priority)}</span></td>
                    <td>
                      <span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:500;color:#fff;background:${actionColors[t.action] || '#6b7280'}">${t.action}</span>
                      ${t.error ? `<div style="font-size:11px;color:#ef4444;margin-top:2px">${esc(t.error)}</div>` : ''}
                    </td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div style="display:flex;justify-content:space-between">
          <button class="btn btn-ghost" id="ci-back-step2">Back to Mapping</button>
          <button class="btn btn-primary" id="ci-commit-btn" ${(p.counts.toCreate + p.counts.toUpdate) === 0 ? 'disabled' : ''}>
            Confirm Import (${p.counts.toCreate + p.counts.toUpdate} tasks)
          </button>
        </div>
      </div>
    `;
  }

  function renderStep4() {
    return `<div id="ci-results"></div>`;
  }

  function bindStepHandlers() {
    const fileInput = document.getElementById('ci-file-input');
    const dropzone = document.getElementById('ci-dropzone');
    const uploadBtn = document.getElementById('ci-upload-btn');

    if (dropzone && fileInput) {
      dropzone.addEventListener('click', () => fileInput.click());
      dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.style.borderColor = '#25C1AC';
      });
      dropzone.addEventListener('dragleave', () => {
        dropzone.style.borderColor = '#d1d5db';
      });
      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.style.borderColor = '#d1d5db';
        if (e.dataTransfer.files.length > 0) {
          fileInput.files = e.dataTransfer.files;
          handleFileSelected(e.dataTransfer.files[0]);
        }
      });
      fileInput.addEventListener('change', () => {
        if (fileInput.files.length > 0) handleFileSelected(fileInput.files[0]);
      });
    }

    const clearBtn = document.getElementById('ci-clear-file');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        document.getElementById('ci-file-info').style.display = 'none';
        document.getElementById('ci-sheet-select-area').style.display = 'none';
        document.getElementById('ci-upload-btn').disabled = true;
        if (fileInput) fileInput.value = '';
      });
    }

    if (uploadBtn) {
      uploadBtn.addEventListener('click', handleUpload);
    }

    const backStep1 = document.getElementById('ci-back-step1');
    if (backStep1) {
      backStep1.addEventListener('click', () => { currentStep = 1; render(); });
    }

    const previewBtn = document.getElementById('ci-generate-preview');
    if (previewBtn) {
      previewBtn.addEventListener('click', handleGeneratePreview);
    }

    const backStep2 = document.getElementById('ci-back-step2');
    if (backStep2) {
      backStep2.addEventListener('click', () => { currentStep = 2; render(); });
    }

    const commitBtn = document.getElementById('ci-commit-btn');
    if (commitBtn) {
      commitBtn.addEventListener('click', handleCommit);
    }

    const mowModeRadios = document.querySelectorAll('input[name="ci-mow-mode"]');
    mowModeRadios.forEach(radio => {
      radio.addEventListener('change', () => {
        const mode = document.querySelector('input[name="ci-mow-mode"]:checked')?.value;
        const keywordsArea = document.getElementById('ci-mow-keywords-area');
        const manualArea = document.getElementById('ci-mow-manual-area');
        if (keywordsArea) keywordsArea.style.display = mode === 'keyword' ? 'block' : 'none';
        if (manualArea) manualArea.style.display = mode === 'manual' ? 'block' : 'none';
      });
    });
  }

  function handleFileSelected(file) {
    const info = document.getElementById('ci-file-info');
    const nameEl = document.getElementById('ci-filename');
    const btn = document.getElementById('ci-upload-btn');
    const errEl = document.getElementById('ci-upload-error');

    if (errEl) errEl.style.display = 'none';

    const ext = file.name.split('.').pop().toLowerCase();
    if (!['xlsx', 'csv', 'xls'].includes(ext)) {
      if (errEl) { errEl.textContent = 'Unsupported file type. Please use .xlsx or .csv'; errEl.style.display = 'block'; }
      return;
    }

    if (info) info.style.display = 'block';
    if (nameEl) nameEl.textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
    if (btn) btn.disabled = false;
  }

  async function handleUpload() {
    const fileInput = document.getElementById('ci-file-input');
    const btn = document.getElementById('ci-upload-btn');
    const errEl = document.getElementById('ci-upload-error');

    if (!fileInput?.files?.length) return;
    const file = fileInput.files[0];

    btn.disabled = true;
    btn.textContent = 'Parsing...';
    if (errEl) errEl.style.display = 'none';

    const formData = new FormData();
    formData.append('file', file);

    const sheetSelect = document.getElementById('ci-sheet-select');
    if (sheetSelect && sheetSelect.value) {
      formData.append('sheetName', sheetSelect.value);
    }

    try {
      const result = await apiFetch('/api/admin/import/contract-tasks/parse', {
        method: 'POST',
        body: formData,
        timeout: 60000,
      });

      parseResult = result;
      allParsedRows = result.rowsPreview;

      if (result.sheetNames && result.sheetNames.length > 1 && !sheetSelect?.value) {
        const area = document.getElementById('ci-sheet-select-area');
        const sel = document.getElementById('ci-sheet-select');
        if (area && sel) {
          area.style.display = 'block';
          sel.innerHTML = result.sheetNames.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
          btn.disabled = false;
          btn.textContent = 'Parse & Continue';
          showToast('Multiple sheets detected. Select one and click Parse again.', 'info');
          return;
        }
      }

      currentStep = 2;
      render();
      showToast(`Parsed ${result.totalRows} rows with ${result.columns.length} columns`, 'success');
    } catch (err) {
      if (errEl) { errEl.textContent = err.message; errEl.style.display = 'block'; }
      btn.disabled = false;
      btn.textContent = 'Parse & Continue';
    }
  }

  async function handleGeneratePreview() {
    const btn = document.getElementById('ci-generate-preview');
    const errEl = document.getElementById('ci-step2-error');
    if (errEl) errEl.style.display = 'none';

    const mappings = {};
    document.querySelectorAll('.ci-mapping').forEach(sel => {
      mappings[sel.dataset.field] = sel.value || null;
    });

    if (!mappings.title || !mappings.windowStart || !mappings.windowEnd) {
      if (errEl) { errEl.textContent = 'Title, Window Start, and Window End are required mappings.'; errEl.style.display = 'block'; }
      return;
    }

    const mowMode = document.querySelector('input[name="ci-mow-mode"]:checked')?.value || 'keyword';
    const mowingConfig = {
      mode: mowMode,
      dayOfWeek: parseInt(document.getElementById('ci-mow-dow')?.value || '1'),
      seasonStart: document.getElementById('ci-mow-season-start')?.value || null,
      seasonEnd: document.getElementById('ci-mow-season-end')?.value || null,
    };

    if (mowMode === 'keyword') {
      const kwInput = document.getElementById('ci-mow-keywords')?.value || '';
      mowingConfig.keywords = kwInput.split(',').map(k => k.trim()).filter(Boolean);
    } else {
      const checked = document.querySelectorAll('.ci-mow-row-check:checked');
      mowingConfig.manualRowIndices = Array.from(checked).map(cb => parseInt(cb.value));
    }

    const defaultPriority = document.getElementById('ci-default-priority')?.value || 'medium';
    const importMode = document.querySelector('input[name="ci-import-mode"]:checked')?.value || 'create';

    btn.disabled = true;
    btn.textContent = 'Generating Preview...';

    try {
      previewResult = await apiFetch('/api/admin/import/contract-tasks/preview', {
        method: 'POST',
        body: {
          communityId: selectedCommunityId,
          mappings,
          mowingConfig,
          defaultPriority,
          importMode,
          parsedData: allParsedRows,
        },
        timeout: 30000,
      });

      currentStep = 3;
      render();
    } catch (err) {
      if (errEl) { errEl.textContent = err.message; errEl.style.display = 'block'; }
      btn.disabled = false;
      btn.textContent = 'Generate Preview';
    }
  }

  async function handleCommit() {
    const btn = document.getElementById('ci-commit-btn');
    btn.disabled = true;
    btn.textContent = 'Importing...';

    try {
      const result = await apiFetch('/api/admin/import/contract-tasks/commit', {
        method: 'POST',
        body: {
          communityId: selectedCommunityId,
          tasksPreview: previewResult.tasksPreview,
          mowingSchedulePreview: previewResult.mowingSchedulePreview,
          defaultPriority: 'medium',
        },
        timeout: 120000,
      });

      currentStep = 4;
      render();

      const resultsEl = document.getElementById('ci-results');
      if (resultsEl) {
        resultsEl.innerHTML = `
          <div style="max-width:600px;margin:0 auto;text-align:center;padding:40px 0">
            <div style="width:56px;height:56px;border-radius:50%;background:#10b981;display:flex;align-items:center;justify-content:center;margin:0 auto 16px">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <h3 style="font-size:18px;font-weight:600;margin-bottom:8px">Import Complete</h3>
            <p style="color:#6b7280;margin-bottom:24px">Your contract task list has been imported successfully.</p>

            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:12px;margin-bottom:24px">
              <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px">
                <div style="font-size:20px;font-weight:700;color:#16a34a">${result.createdCount}</div>
                <div style="font-size:11px;color:#6b7280">Created</div>
              </div>
              <div style="background:#fefce8;border:1px solid #fde68a;border-radius:8px;padding:12px">
                <div style="font-size:20px;font-weight:700;color:#ca8a04">${result.updatedCount}</div>
                <div style="font-size:11px;color:#6b7280">Updated</div>
              </div>
              <div style="background:#f5f5f4;border:1px solid #d6d3d1;border-radius:8px;padding:12px">
                <div style="font-size:20px;font-weight:700;color:#78716c">${result.skippedCount}</div>
                <div style="font-size:11px;color:#6b7280">Skipped</div>
              </div>
              <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px">
                <div style="font-size:20px;font-weight:700;color:#dc2626">${result.errorCount}</div>
                <div style="font-size:11px;color:#6b7280">Errors</div>
              </div>
            </div>

            ${result.scheduleResult ? `
              <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px;margin-bottom:24px;text-align:left">
                <strong style="font-size:13px">Mowing Schedule:</strong>
                <span style="font-size:13px;color:#374151">${result.scheduleResult.action === 'created' ? 'Created new' : 'Updated existing'} schedule</span>
              </div>
            ` : ''}

            <button class="btn btn-primary" id="ci-import-another">Import Another File</button>
          </div>
        `;

        document.getElementById('ci-import-another')?.addEventListener('click', () => {
          currentStep = 1;
          parseResult = null;
          allParsedRows = [];
          previewResult = null;
          render();
        });
      }

    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Retry Import';
      showToast('Import failed: ' + err.message, 'error');
    }
  }

  function esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
  }

  render();
});
