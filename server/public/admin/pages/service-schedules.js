AdminRouter.register('service-schedules', async function(container) {
  const { apiFetch, showToast } = AdminAPI;

  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  let communities = [];
  let schedules = [];
  let visits = [];
  let selectedCommunityId = '';

  try {
    communities = await apiFetch('/api/communities');
  } catch { }

  container.innerHTML = `
    <div class="page-header" style="margin-top:16px">
      <h2 style="font-size:16px">Mowing &amp; Service Days</h2>
    </div>
    <div style="margin-bottom:16px">
      <label class="form-label" style="margin-bottom:4px">Community</label>
      <select class="form-select" id="ss-community-select" style="max-width:320px">
        <option value="">Select a community...</option>
        ${communities.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
      </select>
    </div>
    <div id="ss-content" style="display:none">
      <div id="ss-schedule-section"></div>
      <div id="ss-visits-section" style="margin-top:24px"></div>
    </div>
    <div id="ss-empty" style="display:none;padding:40px;text-align:center;color:#6b7280">
      Select a community above to manage its service schedules.
    </div>
  `;

  document.getElementById('ss-empty').style.display = 'block';

  document.getElementById('ss-community-select').addEventListener('change', async (e) => {
    selectedCommunityId = e.target.value;
    if (!selectedCommunityId) {
      document.getElementById('ss-content').style.display = 'none';
      document.getElementById('ss-empty').style.display = 'block';
      return;
    }
    document.getElementById('ss-empty').style.display = 'none';
    document.getElementById('ss-content').style.display = 'block';
    await loadAll();
  });

  async function loadAll() {
    await Promise.all([loadSchedules(), loadVisits()]);
  }

  async function loadSchedules() {
    const section = document.getElementById('ss-schedule-section');
    section.innerHTML = '<div class="loading-spinner" style="padding:20px">Loading schedules...</div>';
    try {
      schedules = await apiFetch(`/api/communities/${selectedCommunityId}/service-schedules`);
      renderSchedules();
    } catch (err) {
      section.innerHTML = '<div style="color:#ef4444;padding:12px">Failed to load schedules</div>';
    }
  }

  async function loadVisits() {
    const section = document.getElementById('ss-visits-section');
    section.innerHTML = '<div class="loading-spinner" style="padding:20px">Loading visit logs...</div>';

    const today = new Date();
    const fromDate = new Date(today);
    fromDate.setDate(fromDate.getDate() - 30);
    const toDate = new Date(today);
    toDate.setDate(toDate.getDate() + 14);

    const fromStr = fmtDateISO(fromDate);
    const toStr = fmtDateISO(toDate);

    try {
      visits = await apiFetch(`/api/communities/${selectedCommunityId}/service-visits?from=${fromStr}&to=${toStr}`);
      renderVisits(fromStr, toStr);
    } catch (err) {
      section.innerHTML = '<div style="color:#ef4444;padding:12px">Failed to load visits</div>';
    }
  }

  function renderSchedules() {
    const section = document.getElementById('ss-schedule-section');

    if (schedules.length === 0) {
      section.innerHTML = `
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:24px;text-align:center">
          <p style="color:#6b7280;margin-bottom:12px">No service schedules for this community yet.</p>
          <button class="btn btn-primary btn-sm" id="ss-add-first-btn">+ Create Schedule</button>
        </div>
      `;
      document.getElementById('ss-add-first-btn').addEventListener('click', () => showScheduleModal());
      return;
    }

    section.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h3 style="font-size:14px;font-weight:600;color:#374151">Schedules</h3>
        <button class="btn btn-primary btn-sm" id="ss-add-btn">+ Add Schedule</button>
      </div>
      <div id="ss-cards" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px"></div>
    `;

    const cardsContainer = document.getElementById('ss-cards');
    schedules.forEach(s => {
      const card = document.createElement('div');
      card.style.cssText = 'background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:16px;position:relative';

      const statusColor = s.isActive ? '#10b981' : '#9ca3af';
      const statusLabel = s.isActive ? 'Active' : 'Inactive';

      let seasonInfo = '';
      if (s.seasonStart || s.seasonEnd) {
        const start = s.seasonStart ? fmtDateShort(s.seasonStart) : 'Year start';
        const end = s.seasonEnd ? fmtDateShort(s.seasonEnd) : 'Year end';
        seasonInfo = `<div style="font-size:12px;color:#6b7280;margin-top:4px">Season: ${start} — ${end}</div>`;
      }

      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div>
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-weight:600;font-size:14px">${esc(formatServiceType(s.serviceType))}</span>
              <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${statusColor}" title="${statusLabel}"></span>
            </div>
            <div style="font-size:13px;color:#6b7280;margin-top:4px">
              <strong>${DAY_NAMES[s.dayOfWeek] || 'Day ' + s.dayOfWeek}</strong>
            </div>
            ${seasonInfo}
            ${s.notes ? `<div style="font-size:12px;color:#9ca3af;margin-top:4px;font-style:italic">${esc(s.notes)}</div>` : ''}
          </div>
          <div style="display:flex;gap:4px">
            <button class="btn btn-sm btn-ghost ss-edit-btn" data-id="${s.id}" title="Edit">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
            </button>
            <button class="btn btn-sm btn-ghost ss-delete-btn" data-id="${s.id}" title="Delete" style="color:#ef4444">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
      `;
      cardsContainer.appendChild(card);
    });

    document.getElementById('ss-add-btn').addEventListener('click', () => showScheduleModal());

    cardsContainer.querySelectorAll('.ss-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const s = schedules.find(x => x.id === btn.dataset.id);
        if (s) showScheduleModal(s);
      });
    });

    cardsContainer.querySelectorAll('.ss-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this schedule and all its visit logs?')) return;
        try {
          await apiFetch(`/api/service-schedules/${btn.dataset.id}`, { method: 'DELETE' });
          showToast('Schedule deleted', 'success');
          await loadAll();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  }

  function renderVisits(fromStr, toStr) {
    const section = document.getElementById('ss-visits-section');

    const scheduleMap = {};
    schedules.forEach(s => { scheduleMap[s.id] = s; });

    section.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
        <h3 style="font-size:14px;font-weight:600;color:#374151">Visit Logs</h3>
        <div style="display:flex;align-items:center;gap:8px">
          <label style="font-size:12px;color:#6b7280">From</label>
          <input type="date" class="form-input" id="ss-visits-from" value="${fromStr}" style="width:auto;padding:4px 8px;font-size:12px">
          <label style="font-size:12px;color:#6b7280">To</label>
          <input type="date" class="form-input" id="ss-visits-to" value="${toStr}" style="width:auto;padding:4px 8px;font-size:12px">
          <button class="btn btn-sm btn-ghost" id="ss-filter-btn">Filter</button>
          <button class="btn btn-sm btn-primary" id="ss-log-visit-btn">+ Log Visit</button>
        </div>
      </div>
      <div class="table-container">
        <table>
          <thead><tr>
            <th>Service Date</th>
            <th>Schedule</th>
            <th>Completed</th>
            <th>Signed Off By</th>
            <th>Notes</th>
            <th class="text-right">Actions</th>
          </tr></thead>
          <tbody id="ss-visits-tbody"></tbody>
        </table>
      </div>
    `;

    const tbody = document.getElementById('ss-visits-tbody');

    if (visits.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No visit logs in this date range</td></tr>';
    } else {
      tbody.innerHTML = visits.map(v => {
        const sched = scheduleMap[v.scheduleId];
        const schedLabel = sched
          ? `${formatServiceType(sched.serviceType)} (${DAY_SHORT[sched.dayOfWeek] || '?'})`
          : v.scheduleId.substring(0, 8);
        return `
          <tr>
            <td><strong>${fmtDateShort(v.serviceDate)}</strong></td>
            <td>${esc(schedLabel)}</td>
            <td class="text-sm">${v.completedAt ? fmtDateTime(v.completedAt) : '<span style="color:#9ca3af">—</span>'}</td>
            <td>${esc(v.employeeSignOffName || '—')}</td>
            <td class="text-sm" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(v.notes || '—')}</td>
            <td class="text-right">
              <button class="btn btn-sm btn-ghost ss-edit-visit-btn" data-id="${v.id}" title="Edit">Edit</button>
            </td>
          </tr>
        `;
      }).join('');

      tbody.querySelectorAll('.ss-edit-visit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const v = visits.find(x => x.id === btn.dataset.id);
          if (v) showVisitModal(v);
        });
      });
    }

    document.getElementById('ss-filter-btn').addEventListener('click', async () => {
      const from = document.getElementById('ss-visits-from').value;
      const to = document.getElementById('ss-visits-to').value;
      if (!from || !to) { showToast('Both dates required', 'error'); return; }
      try {
        visits = await apiFetch(`/api/communities/${selectedCommunityId}/service-visits?from=${from}&to=${to}`);
        renderVisits(from, to);
      } catch (err) {
        showToast('Failed to filter visits', 'error');
      }
    });

    document.getElementById('ss-log-visit-btn').addEventListener('click', () => showVisitModal());
  }

  function showScheduleModal(existing) {
    const isEdit = !!existing;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';

    overlay.innerHTML = `
      <div class="modal" style="max-width:480px">
        <div class="modal-header">
          <h3>${isEdit ? 'Edit' : 'Create'} Service Schedule</h3>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">Service Type</label>
            <select class="form-select" id="ssm-type">
              <option value="mowing_visit" ${(!existing || existing.serviceType === 'mowing_visit') ? 'selected' : ''}>Mowing Visit</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Day of Week *</label>
            <div style="display:flex;gap:6px;flex-wrap:wrap" id="ssm-dow-group">
              ${DAY_NAMES.map((name, i) => `
                <label style="display:flex;align-items:center;gap:4px;cursor:pointer;padding:4px 8px;border:1px solid #e5e7eb;border-radius:6px;font-size:13px;${existing?.dayOfWeek === i ? 'background:#25C1AC20;border-color:#25C1AC' : ''}">
                  <input type="radio" name="ssm-dow" value="${i}" ${existing?.dayOfWeek === i ? 'checked' : ''} style="display:none">
                  ${DAY_SHORT[i]}
                </label>
              `).join('')}
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="form-group">
              <label class="form-label">Season Start</label>
              <input class="form-input" id="ssm-season-start" type="date" value="${existing?.seasonStart || ''}">
            </div>
            <div class="form-group">
              <label class="form-label">Season End</label>
              <input class="form-input" id="ssm-season-end" type="date" value="${existing?.seasonEnd || ''}">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Notes</label>
            <textarea class="form-input" id="ssm-notes" rows="2" placeholder="Optional notes...">${esc(existing?.notes || '')}</textarea>
          </div>
          <div class="form-group">
            <label class="form-label" style="display:flex;align-items:center;gap:6px">
              <input type="checkbox" id="ssm-active" ${(!existing || existing.isActive) ? 'checked' : ''}>
              Active
            </label>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" id="ssm-cancel">Cancel</button>
          <button class="btn btn-primary" id="ssm-save">${isEdit ? 'Update' : 'Create'}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const dowLabels = overlay.querySelectorAll('#ssm-dow-group label');
    dowLabels.forEach(label => {
      label.addEventListener('click', () => {
        dowLabels.forEach(l => { l.style.background = ''; l.style.borderColor = '#e5e7eb'; });
        label.style.background = '#25C1AC20';
        label.style.borderColor = '#25C1AC';
        label.querySelector('input').checked = true;
      });
    });

    function close() { overlay.remove(); }
    overlay.querySelector('.modal-close').addEventListener('click', close);
    overlay.querySelector('#ssm-cancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    overlay.querySelector('#ssm-save').addEventListener('click', async () => {
      const selectedRadio = overlay.querySelector('input[name="ssm-dow"]:checked');
      if (!selectedRadio) {
        showToast('Please select a day of week', 'error');
        return;
      }

      const body = {
        serviceType: overlay.querySelector('#ssm-type').value,
        dayOfWeek: parseInt(selectedRadio.value),
        seasonStart: overlay.querySelector('#ssm-season-start').value || null,
        seasonEnd: overlay.querySelector('#ssm-season-end').value || null,
        notes: overlay.querySelector('#ssm-notes').value || null,
        isActive: overlay.querySelector('#ssm-active').checked,
      };

      try {
        if (isEdit) {
          await apiFetch(`/api/service-schedules/${existing.id}`, { method: 'PATCH', body });
          showToast('Schedule updated', 'success');
        } else {
          body.communityId = selectedCommunityId;
          await apiFetch(`/api/communities/${selectedCommunityId}/service-schedules`, { method: 'POST', body });
          showToast('Schedule created', 'success');
        }
        close();
        await loadAll();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  function showVisitModal(existing) {
    const isEdit = !!existing;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';

    const todayStr = fmtDateISO(new Date());

    overlay.innerHTML = `
      <div class="modal" style="max-width:480px">
        <div class="modal-header">
          <h3>${isEdit ? 'Edit' : 'Log'} Service Visit</h3>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">Schedule *</label>
            <select class="form-select" id="svm-schedule" ${isEdit ? 'disabled' : ''}>
              ${schedules.map(s => `<option value="${s.id}" ${existing?.scheduleId === s.id ? 'selected' : ''}>${formatServiceType(s.serviceType)} (${DAY_SHORT[s.dayOfWeek]})</option>`).join('')}
            </select>
            ${schedules.length === 0 ? '<div style="color:#ef4444;font-size:12px;margin-top:4px">No schedules available. Create one first.</div>' : ''}
          </div>
          <div class="form-group">
            <label class="form-label">Service Date *</label>
            <input class="form-input" id="svm-date" type="date" value="${existing?.serviceDate || todayStr}">
          </div>
          <div class="form-group">
            <label class="form-label">Signed Off By *</label>
            <input class="form-input" id="svm-signoff" type="text" placeholder="Employee name" value="${esc(existing?.employeeSignOffName || '')}">
          </div>
          <div class="form-group">
            <label class="form-label">Notes</label>
            <textarea class="form-input" id="svm-notes" rows="3" placeholder="Optional notes about the visit...">${esc(existing?.notes || '')}</textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" id="svm-cancel">Cancel</button>
          <button class="btn btn-primary" id="svm-save">${isEdit ? 'Update' : 'Log Visit'}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    function close() { overlay.remove(); }
    overlay.querySelector('.modal-close').addEventListener('click', close);
    overlay.querySelector('#svm-cancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    overlay.querySelector('#svm-save').addEventListener('click', async () => {
      const scheduleId = overlay.querySelector('#svm-schedule').value;
      const serviceDate = overlay.querySelector('#svm-date').value;
      const employeeSignOffName = overlay.querySelector('#svm-signoff').value.trim();
      const notes = overlay.querySelector('#svm-notes').value.trim();

      if (!scheduleId || !serviceDate) {
        showToast('Schedule and date are required', 'error');
        return;
      }
      if (!employeeSignOffName) {
        showToast('Sign-off name is required', 'error');
        return;
      }

      const body = {
        serviceDate,
        employeeSignOffName,
        notes: notes || null,
        completedAt: new Date().toISOString(),
      };

      try {
        await apiFetch(`/api/service-schedules/${scheduleId}/log`, { method: 'POST', body });
        showToast(isEdit ? 'Visit updated' : 'Visit logged', 'success');
        close();
        await loadVisits();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  function formatServiceType(type) {
    if (!type) return 'Service';
    return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  function fmtDateISO(d) {
    const dt = new Date(d);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const day = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function fmtDateShort(d) {
    if (!d) return '—';
    const dt = new Date(d + 'T00:00:00');
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function fmtDateTime(d) {
    if (!d) return '—';
    return new Date(d).toLocaleString();
  }

  function esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
  }
});
