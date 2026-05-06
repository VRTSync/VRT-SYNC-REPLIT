AdminRouter.register('schedules', async function(container) {
  const { apiFetch, showToast } = AdminAPI;

  container.innerHTML = `
    <div class="page-header" style="margin-top:16px">
      <h2 style="font-size:16px">Task Auto-Generate</h2>
      <div style="display:flex;gap:8px">
        <button class="btn btn-ghost btn-sm" id="run-now-btn">Run Now</button>
        <button class="btn btn-primary btn-sm" id="add-schedule-btn">+ New Schedule</button>
      </div>
    </div>
    <div class="table-container">
      <table>
        <thead><tr>
          <th>Template</th>
          <th>Community</th>
          <th>Frequency</th>
          <th>Days</th>
          <th>Date Range</th>
          <th>Next Run</th>
          <th>Enabled</th>
          <th class="text-right">Actions</th>
        </tr></thead>
        <tbody id="schedules-tbody">
          <tr><td colspan="8" class="loading-spinner">Loading...</td></tr>
        </tbody>
      </table>
    </div>
    <div id="run-history-panel" style="display:none;margin-top:24px">
      <div class="page-header">
        <h3 style="font-size:14px" id="run-history-title">Run History</h3>
        <button class="btn btn-ghost btn-sm" id="close-history-btn">Close</button>
      </div>
      <div class="table-container">
        <table>
          <thead><tr>
            <th>Run At</th>
            <th>Window</th>
            <th>Created</th>
            <th>Skipped</th>
            <th>Status</th>
            <th>Error</th>
          </tr></thead>
          <tbody id="runs-tbody"></tbody>
        </table>
      </div>
    </div>
  `;

  let schedules = [];
  let templates = [];
  let communities = [];
  let contractors = [];

  try {
    [templates, communities, contractors] = await Promise.all([
      apiFetch('/api/task-templates'),
      apiFetch('/api/communities'),
      apiFetch('/api/contractors'),
    ]);
  } catch {}

  const templateMap = {};
  templates.forEach(t => templateMap[t.id] = t);
  const communityMap = {};
  communities.forEach(c => communityMap[c.id] = c);

  document.getElementById('add-schedule-btn').addEventListener('click', () => showScheduleModal());
  document.getElementById('close-history-btn').addEventListener('click', () => {
    document.getElementById('run-history-panel').style.display = 'none';
  });

  document.getElementById('run-now-btn').addEventListener('click', async () => {
    const btn = document.getElementById('run-now-btn');
    btn.disabled = true;
    btn.textContent = 'Running...';
    try {
      const result = await apiFetch('/api/task-schedules/run-now', { method: 'POST' });
      if (result.processed === 0) {
        showToast('No schedules are due right now', 'info');
      } else {
        const total = result.reports.reduce((s, r) => s + r.createdCount, 0);
        const skipped = result.reports.reduce((s, r) => s + r.skippedCount, 0);
        showToast(`Processed ${result.processed} schedule(s): ${total} created, ${skipped} skipped`, 'success');
      }
      await loadSchedules();
    } catch (err) {
      showToast(err.message, 'error');
    }
    btn.disabled = false;
    btn.textContent = 'Run Now';
  });

  await loadSchedules();

  async function loadSchedules() {
    try {
      schedules = await apiFetch('/api/task-schedules');
      renderSchedules();
    } catch (err) {
      showToast('Failed to load schedules', 'error');
    }
  }

  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function formatDays(schedule) {
    if (schedule.frequency === 'weekly' && schedule.daysOfWeek) {
      return schedule.daysOfWeek.split(',').map(d => DAY_NAMES[parseInt(d)] || d).join(', ');
    }
    if (schedule.frequency === 'monthly' && schedule.dayOfMonth) {
      return 'Day ' + schedule.dayOfMonth;
    }
    return '—';
  }

  function fmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString();
  }

  function fmtDateTime(d) {
    if (!d) return '—';
    return new Date(d).toLocaleString();
  }

  function renderSchedules() {
    const tbody = document.getElementById('schedules-tbody');
    if (schedules.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No schedules yet</td></tr>';
      return;
    }
    tbody.innerHTML = schedules.map(s => {
      const tmpl = templateMap[s.templateId];
      const comm = communityMap[s.communityId];
      const dateRange = fmtDate(s.startDate) + (s.endDate ? ' — ' + fmtDate(s.endDate) : ' — ongoing');
      return `
        <tr>
          <td><strong>${esc(tmpl?.name || s.templateId.substring(0, 8))}</strong></td>
          <td>${esc(comm?.name || s.communityId.substring(0, 8))}</td>
          <td><span class="badge badge-blue">${esc(s.frequency)}</span></td>
          <td>${formatDays(s)}</td>
          <td class="text-sm">${dateRange}</td>
          <td class="text-sm">${fmtDateTime(s.nextRunAt)}</td>
          <td>
            <label style="display:flex;align-items:center;cursor:pointer">
              <input type="checkbox" class="toggle-enabled" data-id="${s.id}" ${s.isEnabled ? 'checked' : ''}>
            </label>
          </td>
          <td class="text-right">
            <button class="btn btn-sm btn-ghost history-btn" data-id="${s.id}">History</button>
            <button class="btn btn-sm btn-ghost edit-sched-btn" data-id="${s.id}">Edit</button>
            <button class="btn btn-sm btn-danger delete-sched-btn" data-id="${s.id}">Delete</button>
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('.toggle-enabled').forEach(cb => {
      cb.addEventListener('change', async () => {
        try {
          await apiFetch(`/api/task-schedules/${cb.dataset.id}`, {
            method: 'PATCH', body: { isEnabled: cb.checked },
          });
          showToast(cb.checked ? 'Schedule enabled' : 'Schedule disabled', 'success');
          await loadSchedules();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    tbody.querySelectorAll('.edit-sched-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const s = schedules.find(x => x.id === btn.dataset.id);
        if (s) showScheduleModal(s);
      });
    });

    tbody.querySelectorAll('.history-btn').forEach(btn => {
      btn.addEventListener('click', () => showRunHistory(btn.dataset.id));
    });

    tbody.querySelectorAll('.delete-sched-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this schedule and its run history?')) return;
        try {
          await apiFetch(`/api/task-schedules/${btn.dataset.id}`, { method: 'DELETE' });
          showToast('Schedule deleted', 'success');
          await loadSchedules();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  }

  async function showRunHistory(scheduleId) {
    const panel = document.getElementById('run-history-panel');
    const tmpl = templateMap[schedules.find(s => s.id === scheduleId)?.templateId];
    document.getElementById('run-history-title').textContent = `Run History — ${tmpl?.name || 'Schedule'}`;
    panel.style.display = 'block';

    const tbody = document.getElementById('runs-tbody');
    tbody.innerHTML = '<tr><td colspan="6" class="loading-spinner">Loading...</td></tr>';

    try {
      const runs = await apiFetch(`/api/task-schedules/${scheduleId}/runs`);
      if (runs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No runs yet</td></tr>';
        return;
      }
      tbody.innerHTML = runs.map(r => `
        <tr>
          <td class="text-sm">${fmtDateTime(r.runAt)}</td>
          <td class="text-sm">${fmtDate(r.windowStart)} — ${fmtDate(r.windowEnd)}</td>
          <td><strong>${r.createdCount}</strong></td>
          <td>${r.skippedCount}</td>
          <td><span class="badge ${r.status === 'success' ? 'badge-green' : 'badge-red'}">${r.status}</span></td>
          <td class="text-sm text-muted">${esc(r.errorMessage || '')}</td>
        </tr>
      `).join('');
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Failed to load</td></tr>';
    }
  }

  function showScheduleModal(existing) {
    const isEdit = !!existing;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';

    const startVal = existing?.startDate ? new Date(existing.startDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
    const endVal = existing?.endDate ? new Date(existing.endDate).toISOString().split('T')[0] : '';
    const selectedDays = existing?.daysOfWeek ? existing.daysOfWeek.split(',') : ['1'];

    overlay.innerHTML = `
      <div class="modal" style="max-width:540px">
        <div class="modal-header">
          <h3>${isEdit ? 'Edit' : 'Create'} Schedule</h3>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">Template *</label>
            <select class="form-select" id="sched-template">
              <option value="">Select template...</option>
              ${templates.map(t => `<option value="${t.id}" ${existing?.templateId === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Community *</label>
            <select class="form-select" id="sched-community">
              <option value="">Select community...</option>
              ${communities.map(c => `<option value="${c.id}" ${existing?.communityId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Frequency</label>
            <select class="form-select" id="sched-frequency">
              <option value="weekly" ${(!existing || existing?.frequency === 'weekly') ? 'selected' : ''}>Weekly</option>
              <option value="monthly" ${existing?.frequency === 'monthly' ? 'selected' : ''}>Monthly</option>
              <option value="once" ${existing?.frequency === 'once' ? 'selected' : ''}>Once</option>
            </select>
          </div>
          <div class="form-group" id="sched-dow-group">
            <label class="form-label">Days of Week</label>
            <div style="display:flex;gap:8px;flex-wrap:wrap" id="sched-dow-checks">
              ${DAY_NAMES.map((name, i) => `
                <label style="display:flex;align-items:center;gap:4px;cursor:pointer">
                  <input type="checkbox" value="${i}" class="dow-check" ${selectedDays.includes(String(i)) ? 'checked' : ''}>
                  ${name}
                </label>
              `).join('')}
            </div>
          </div>
          <div class="form-group" id="sched-dom-group" style="display:none">
            <label class="form-label">Day of Month</label>
            <input class="form-input" id="sched-dom" type="number" min="1" max="31" value="${existing?.dayOfMonth || 1}">
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="form-group">
              <label class="form-label">Start Date *</label>
              <input class="form-input" id="sched-start" type="date" value="${startVal}">
            </div>
            <div class="form-group">
              <label class="form-label">End Date</label>
              <input class="form-input" id="sched-end" type="date" value="${endVal}">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Assign To (optional)</label>
            <select class="form-select" id="sched-assign">
              <option value="">Unassigned</option>
              ${contractors.map(u => `<option value="${u.id}" ${existing?.assignToUserId === u.id ? 'selected' : ''}>${esc(u.displayName || u.username)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" style="display:flex;align-items:center;gap:6px">
              <input type="checkbox" id="sched-enabled" ${(!existing || existing?.isEnabled) ? 'checked' : ''}>
              Enabled
            </label>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" id="sched-cancel-btn">Cancel</button>
          <button class="btn btn-primary" id="sched-save-btn">${isEdit ? 'Update' : 'Create'}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const freqSelect = overlay.querySelector('#sched-frequency');
    const dowGroup = overlay.querySelector('#sched-dow-group');
    const domGroup = overlay.querySelector('#sched-dom-group');

    function updateFreqUI() {
      const f = freqSelect.value;
      dowGroup.style.display = f === 'weekly' ? 'block' : 'none';
      domGroup.style.display = f === 'monthly' ? 'block' : 'none';
    }
    freqSelect.addEventListener('change', updateFreqUI);
    updateFreqUI();

    function close() { overlay.remove(); }
    overlay.querySelector('.modal-close').addEventListener('click', close);
    overlay.querySelector('#sched-cancel-btn').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    overlay.querySelector('#sched-save-btn').addEventListener('click', async () => {
      const templateId = overlay.querySelector('#sched-template').value;
      const communityId = overlay.querySelector('#sched-community').value;
      if (!templateId || !communityId) { showToast('Template and community are required', 'error'); return; }

      const frequency = freqSelect.value;
      const checkedDays = [...overlay.querySelectorAll('.dow-check:checked')].map(c => c.value);
      const startDate = overlay.querySelector('#sched-start').value;
      const endDate = overlay.querySelector('#sched-end').value;

      if (!startDate) { showToast('Start date is required', 'error'); return; }

      const body = {
        templateId,
        communityId,
        frequency,
        daysOfWeek: frequency === 'weekly' ? (checkedDays.length ? checkedDays.join(',') : '1') : null,
        dayOfMonth: frequency === 'monthly' ? parseInt(overlay.querySelector('#sched-dom').value) || 1 : null,
        timezone: 'America/Denver',
        startDate,
        endDate: endDate || null,
        assignToUserId: overlay.querySelector('#sched-assign').value || null,
        isEnabled: overlay.querySelector('#sched-enabled').checked,
      };

      try {
        if (isEdit) {
          await apiFetch(`/api/task-schedules/${existing.id}`, { method: 'PATCH', body });
          showToast('Schedule updated', 'success');
        } else {
          await apiFetch('/api/task-schedules', { method: 'POST', body });
          showToast('Schedule created', 'success');
        }
        close();
        await loadSchedules();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  function esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
  }
});
