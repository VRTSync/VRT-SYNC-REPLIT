/* VRTSync Portal — Role-Based Dashboard
 * Route: 'dashboard'
 * Renders role-specific dashboard using shared PortalModules.
 */
function _wide() { return window.innerWidth >= 1600; }
function _wc(narrow, wide) { return _wide() ? wide : narrow; }

PortalRouter.register('dashboard', async function (container) {
  const ctx = PortalState.getCommunityContext();
  const { role, activeCommunity } = ctx;

  /* Stop any previous dashboard sync */
  if (window._dashSyncManager) {
    window._dashSyncManager.stop();
    window._dashSyncManager = null;
  }
  if (window._dashSyncTicker) {
    clearInterval(window._dashSyncTicker);
    window._dashSyncTicker = null;
  }

  /* Guard: no community selected yet */
  if (!activeCommunity) {
    if (ctx.isMultiCommunityUser) {
      PortalRouter.navigate('communities');
      return;
    }
    container.innerHTML = `
      <div class="empty-state" style="margin-top:80px;">
        <h3 style="color:var(--navy);margin-bottom:8px;">No community assigned</h3>
        <p style="color:var(--gray-500);">Contact your administrator to get access to a community.</p>
      </div>`;
    return;
  }

  container.innerHTML = '<div class="loading-spinner" style="margin-top:80px;">Loading dashboard…</div>';

  try {
    if (role === 'contractor')       await renderContractor(container, ctx);
    else if (role === 'hoa_admin')   await renderHoa(container, ctx);
    else if (role === 'hoa_member')  await renderHoaMember(container, ctx);
    else if (role === 'property_manager') await renderPM(container, ctx);
    else container.innerHTML = `<div class="empty-state"><p>No dashboard for role: ${role}</p></div>`;
  } catch (err) {
    console.error('Dashboard error:', err);
    container.innerHTML = `<div class="empty-state"><p>Dashboard failed to load. Please refresh.</p></div>`;
  }
});

/* ───────────────────────────────────────────────────────────────────────────
 * Helpers
 * ────────────────────────────────────────────────────────────────────────── */
async function _fetchTasks(communityId) {
  try {
    const t = await PortalAPI.apiFetch(`/api/tasks?communityId=${communityId}`);
    return Array.isArray(t) ? t : [];
  } catch { return []; }
}

async function _fetchHoaDashboard() {
  try { return await PortalAPI.apiFetch('/api/hoa/dashboard'); }
  catch { return null; }
}

/* Returns { allowed: bool, requests: [] }.
 * allowed=false when the API returns 403/401 (member role lacks permission).
 * Uses silent:true so that a 403 does not trigger a "Not authorized" toast —
 * the member simply sees no request module rather than an error alert.
 * PortalAPI.apiFetch throws Error('Not authorized') on 403 and
 * Error('Session expired') on 401 — matched by err.message. */
async function _fetchHoaRequests() {
  try {
    const r = await PortalAPI.apiFetch('/api/hoa/requests', { silent: true });
    return { allowed: true, requests: Array.isArray(r) ? r : [] };
  } catch (err) {
    const msg = err && err.message;
    if (msg === 'Not authorized' || msg === 'Session expired') {
      return { allowed: false, requests: [] };
    }
    /* Network / server error — treat as permitted but empty to avoid hiding the module */
    return { allowed: true, requests: [] };
  }
}

function _partition(tasks) {
  const M = PortalModules;
  const active   = tasks.filter(t => !['completed'].includes(t.status) && M.classifyTask(t) === 'active');
  const overdue  = tasks.filter(t => !['completed'].includes(t.status) && M.classifyTask(t) === 'overdue');
  const upcoming = tasks.filter(t => !['completed'].includes(t.status) && M.classifyTask(t) === 'upcoming');
  const completed = tasks.filter(t => t.status === 'completed');
  const hoaReqs  = tasks.filter(t => t.origin === 'hoa_request' || t.origin === 'HOA');
  return { active, overdue, upcoming, completed, hoaReqs };
}

/* ───────────────────────────────────────────────────────────────────────────
 * Sync Badge HTML helper
 * ────────────────────────────────────────────────────────────────────────── */
function _syncBadgeHtml(id) {
  return `<div class="sync-bar sync-bar--inline" id="${id}">
    <span class="sync-label" id="${id}-label">Syncing\u2026</span>
    <button class="sync-refresh-btn" id="${id}-btn" title="Refresh now">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="23 4 23 10 17 10"/>
        <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
      </svg>
    </button>
  </div>`;
}

function _updateDashSyncLabel(container) {
  const label = container.querySelector('#dash-sync-bar-label');
  if (!label || !window._dashSyncManager) return;
  const ts = window._dashSyncManager.lastSynced();
  if (!ts) { label.textContent = 'Syncing\u2026'; return; }
  const secs = Math.round((Date.now() - ts.getTime()) / 1000);
  if (secs < 5)        label.textContent = 'Last synced: just now';
  else if (secs < 60)  label.textContent = 'Last synced: ' + secs + 's ago';
  else                 label.textContent = 'Last synced: ' + Math.round(secs / 60) + 'm ago';
}

/* Wire the sync button after the dashboard has rendered */
function _wireDashSyncBtn(container, sm) {
  const btn = container.querySelector('#dash-sync-bar-btn');
  if (btn) {
    btn.addEventListener('click', function () {
      btn.classList.add('sync-refresh-btn--spinning');
      sm.forceRefresh();
      setTimeout(() => btn.classList.remove('sync-refresh-btn--spinning'), 600);
    });
  }
}

/* ───────────────────────────────────────────────────────────────────────────
 * Contractor Dashboard
 * ────────────────────────────────────────────────────────────────────────── */
async function renderContractor(container, ctx) {
  const M   = PortalModules;
  const C   = PortalRoleCopy.get('contractor');
  const { activeCommunity } = ctx;
  const I   = M.ICONS;

  const tasks = await _fetchTasks(activeCommunity.id);
  const { active, overdue, upcoming, completed, hoaReqs } = _partition(tasks);
  const todayWork = [...overdue, ...active].slice(0, 6);
  const pendingReqs = hoaReqs.filter(t => t.status !== 'completed');

  container.innerHTML = `
    ${M.pageHeader('Dashboard', activeCommunity)}

    ${M.statsRow([
      { icon: I.task(), label: C.summaryLabels.activeTasks,  value: active.length,      color: 'var(--teal)' },
      { icon: I.alert(), label: C.summaryLabels.overdue,     value: overdue.length,     color: 'var(--red)' },
      { icon: I.inbox(), label: C.summaryLabels.openRequests, value: pendingReqs.length, color: 'var(--amber)' },
      { icon: I.done(), label: C.summaryLabels.upcoming,     value: upcoming.length,    color: 'var(--blue)' },
    ])}

    <div class="dash-tasks-header">
      <span class="dash-tasks-title">${M.esc(C.sectionHeaders.tasksPanel)}</span>
      ${_syncBadgeHtml('dash-sync-bar')}
    </div>

    <div class="dash-grid" id="dash-task-grid">
      <div class="dash-col-8" id="dash-todays-work-col">
        ${M.listModule({
          title: C.sectionHeaders.today,
          rows: todayWork,
          emptyMsg: C.emptyStates.noTodayWork,
          viewAllRoute: 'tasks',
        })}
      </div>
      <div class="dash-col-4" style="display:flex;flex-direction:column;gap:20px">
        ${M.quickLinksModule({
          title: 'Quick Links',
          links: [
            { icon: I.map(),      label: C.buttonLabels.openMap,        route: 'map' },
            { icon: I.task(),     label: C.buttonLabels.allTasks,       route: 'tasks' },
            { icon: I.calendar(), label: C.buttonLabels.serviceSchedule, route: 'service-schedule' },
          ],
        })}
        ${M.mapPreviewModule({ community: activeCommunity })}
      </div>
    </div>

    <div class="dash-grid" style="margin-top:20px" id="dash-hoa-grid">
      <div class="${_wc('dash-col-6', 'dash-col-4w')}" id="dash-hoa-reqs-col">
        ${M.listModule({
          title: C.sectionHeaders.requests,
          rows: pendingReqs.slice(0, 5),
          emptyMsg: C.emptyStates.noRequests,
          viewAllRoute: 'tasks',
        })}
      </div>
      <div class="${_wc('dash-col-6', 'dash-col-4w')}">
        ${M.notesModule({ title: 'Contractor Notes', hint: C.helperText.notesHint })}
      </div>
      ${_wide() ? `<div class="dash-col-4w" id="dash-completed-col">
        ${M.listModule({
          title: C.sectionHeaders.recentWork,
          rows: completed.slice(0, 5),
          emptyMsg: C.emptyStates.noCompleted,
          viewAllRoute: 'tasks',
        })}
      </div>` : ''}
    </div>
  `;
  requestAnimationFrame(function() { _initMapPreview(activeCommunity.id); });

  /* Start sync for contractor dashboard */
  if (window.SyncManager) {
    const sm = SyncManager.create();
    window._dashSyncManager = sm;
    sm.start(
      () => _fetchTasks(activeCommunity.id),
      function (newTasks, changed) {
        const { active: a, overdue: od, upcoming: up, completed: comp, hoaReqs: hr } = _partition(newTasks);
        const todayW = [...od, ...a].slice(0, 6);
        const pending = hr.filter(t => t.status !== 'completed');

        /* Patch stats row */
        _updateStatsRow(container, [a.length, od.length, pending.length, up.length]);

        /* Patch task lists in-place */
        _patchListModule(container, '#dash-todays-work-col', todayW, C.emptyStates.noTodayWork);
        _patchListModule(container, '#dash-hoa-reqs-col', pending.slice(0, 5), C.emptyStates.noRequests);
        if (_wide()) {
          _patchListModule(container, '#dash-completed-col', comp.slice(0, 5), C.emptyStates.noCompleted);
        }

        _updateDashSyncLabel(container);
        if (changed) PortalAPI.showToast('Tasks updated', 'info');
      },
      30000
    );
    _wireDashSyncBtn(container, sm);
    window._dashSyncTicker = setInterval(() => _updateDashSyncLabel(container), 5000);
  }
}

/* ───────────────────────────────────────────────────────────────────────────
 * Command Center fetch helpers
 * ────────────────────────────────────────────────────────────────────────── */
async function _fetchServiceSchedules(communityId) {
  try {
    const s = await PortalAPI.apiFetch(`/api/communities/${encodeURIComponent(communityId)}/service-schedules`);
    return Array.isArray(s) ? s : [];
  } catch { return []; }
}

async function _fetchServiceVisitsThisWeek(communityId) {
  try {
    /* Fetch visits for this week using the community visits endpoint */
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const mon = new Date(today);
    mon.setDate(today.getDate() - today.getDay()); /* start of week (Sun) */
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    const from = mon.toISOString().slice(0, 10);
    const to   = sun.toISOString().slice(0, 10);
    const visits = await PortalAPI.apiFetch(
      `/api/communities/${encodeURIComponent(communityId)}/service-visits?from=${from}&to=${to}`
    );
    return Array.isArray(visits) ? visits : [];
  } catch { return []; }
}

async function _fetchWaterUsage(communityId) {
  try {
    const rows = await PortalAPI.apiFetch(`/api/reports/water-usage?communityId=${encodeURIComponent(communityId)}`);
    return Array.isArray(rows) ? rows : [];
  } catch { return []; }
}

/* ── Service Day widget renderer ──
 * opts.memberMode = true  → community-facing copy, non-interactive (no Manage link)
 * opts.memberMode = false → admin copy with "Manage →" link (default) */
function _renderServiceDayWidget(schedules, thisWeekVisits, opts) {
  const memberMode = opts && opts.memberMode;
  const M = PortalModules;
  const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const calIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;

  const title     = memberMode ? "Your community's service day" : 'Service Day';
  const emptyMsg  = memberMode ? 'Service schedule not yet configured' : 'No service schedule configured';
  const nextLabel = memberMode ? 'Next visit:' : 'Next:';
  const wrapAttrs = memberMode
    ? ''
    : `onclick="PortalRouter.navigate('service-schedule')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();PortalRouter.navigate('service-schedule');}" role="button" tabindex="0"`;

  const active = schedules.filter(s => s.isActive);
  if (active.length === 0) {
    return `
      <div class="cc-widget cc-widget--service" ${wrapAttrs}>
        <div class="cc-widget-header">
          <span class="cc-widget-icon" style="color:var(--teal)">${calIcon}</span>
          <span class="cc-widget-title">${M.esc(title)}</span>
          ${!memberMode ? '<span class="cc-widget-link">Manage \u2192</span>' : ''}
        </div>
        <div class="cc-widget-empty">${M.esc(emptyMsg)}</div>
      </div>`;
  }

  const sched = active[0];
  const dowName = DOW[sched.dayOfWeek] || 'Unknown';

  /* Season status */
  let seasonLabel = 'In Season';
  let seasonClass = 'cc-badge--green';
  if (sched.seasonStart && sched.seasonEnd) {
    const start = new Date(sched.seasonStart + 'T00:00:00');
    const end   = new Date(sched.seasonEnd + 'T00:00:00');
    if (today < start || today > end) {
      seasonLabel = 'Off Season';
      seasonClass = 'cc-badge--gray';
    }
  }

  /* Next service date: next occurrence of dayOfWeek on or after today */
  const nextDate = (function() {
    const d = new Date(today);
    const delta = (sched.dayOfWeek - d.getDay() + 7) % 7;
    /* delta === 0 means today is the service day — show today, not next week */
    d.setDate(d.getDate() + delta);
    return d;
  })();
  const nextStr = nextDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  /* This-week service date: the service day within the CURRENT week (may be in the past) */
  const thisWeekServiceDate = (function() {
    const d = new Date(today);
    /* Offset from Sunday (start of week) to the service dayOfWeek */
    const sundayOffset = today.getDay(); /* days since Sunday */
    const serviceDayOffset = sched.dayOfWeek;
    d.setDate(today.getDate() - sundayOffset + serviceDayOffset);
    return d.toISOString().slice(0, 10);
  })();

  const visits = Array.isArray(thisWeekVisits) ? thisWeekVisits : [];
  const visitLoggedThisWeek = visits.some(function(v) {
    return v.serviceDate === thisWeekServiceDate;
  });
  const visitLabel = visitLoggedThisWeek
    ? (memberMode ? 'This week: Crew visited' : 'This week: Logged')
    : (memberMode ? 'This week: Visit pending' : 'This week: Not yet');
  const visitClass = visitLoggedThisWeek ? 'cc-svc-visit--logged' : 'cc-svc-visit--pending';

  return `
    <div class="cc-widget cc-widget--service" ${wrapAttrs}>
      <div class="cc-widget-header">
        <span class="cc-widget-icon" style="color:var(--teal)">${calIcon}</span>
        <span class="cc-widget-title">${M.esc(title)}</span>
        ${!memberMode ? '<span class="cc-widget-link">Manage \u2192</span>' : ''}
      </div>
      <div class="cc-widget-body">
        <div class="cc-svc-day">${M.esc(dowName)}</div>
        <div class="cc-svc-meta">
          <span class="cc-badge ${seasonClass}">${seasonLabel}</span>
          <span class="cc-svc-next">${M.esc(nextLabel)} ${M.esc(nextStr)}</span>
        </div>
        <div class="cc-svc-visit ${visitClass}">${M.esc(visitLabel)}</div>
      </div>
    </div>`;
}

/* ── Water Usage widget renderer ── */
function _renderWaterUsageWidget(rows) {
  const M = PortalModules;
  const sorted = rows.slice().sort(function(a, b) {
    if (a.year !== b.year) return a.year - b.year;
    return a.month - b.month;
  });

  const MONTH_ABBR = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  if (sorted.length === 0) {
    return `
      <div class="cc-widget cc-widget--water">
        <div class="cc-widget-header">
          <span class="cc-widget-icon" style="color:var(--blue)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2C6 8 4 12 4 15a8 8 0 0016 0c0-3-2-7-8-13z"/></svg>
          </span>
          <span class="cc-widget-title">Water Usage</span>
          <button class="cc-widget-link" onclick="event.stopPropagation();PortalRouter.navigate('reports',true,{report:'water-usage'})">View Report →</button>
        </div>
        <div class="cc-widget-empty">No water usage data recorded yet</div>
      </div>`;
  }

  const last6   = sorted.slice(-6);
  const latest  = sorted[sorted.length - 1];
  const maxAmt  = Math.max.apply(null, last6.map(r => r.usage_amount));
  const latestStr = latest.usage_amount.toLocaleString() + ' ' + M.esc(latest.unit || '');
  const latestLabel = MONTH_ABBR[latest.month] + ' ' + latest.year;

  /* Inline sparkline bars */
  const sparkBars = last6.map(function(r) {
    const pct = maxAmt > 0 ? (r.usage_amount / maxAmt) : 0;
    const h   = Math.max(4, Math.round(pct * 40));
    const isLatest = (r.year === latest.year && r.month === latest.month);
    return `<div class="cc-spark-col" title="${MONTH_ABBR[r.month]} ${r.year}: ${r.usage_amount.toLocaleString()} ${M.esc(r.unit || '')}">
      <div class="cc-spark-bar${isLatest ? ' cc-spark-bar--hi' : ''}" style="height:${h}px"></div>
      <div class="cc-spark-label">${MONTH_ABBR[r.month]}</div>
    </div>`;
  }).join('');

  return `
    <div class="cc-widget cc-widget--water">
      <div class="cc-widget-header">
        <span class="cc-widget-icon" style="color:var(--blue)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2C6 8 4 12 4 15a8 8 0 0016 0c0-3-2-7-8-13z"/></svg>
        </span>
        <span class="cc-widget-title">Water Usage</span>
        <button class="cc-widget-link" onclick="event.stopPropagation();PortalRouter.navigate('reports',true,{report:'water-usage'})">View Report →</button>
      </div>
      <div class="cc-widget-body">
        <div class="cc-water-latest">
          <span class="cc-water-value">${M.esc(latestStr)}</span>
          <span class="cc-water-period">${M.esc(latestLabel)}</span>
        </div>
        <div class="cc-sparkline">${sparkBars}</div>
      </div>
    </div>`;
}

/* ── Attention Required: build item list ── */
function _buildAttentionItems(overdue, pendingReqs) {
  const items = [];
  const now = Date.now();
  const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

  overdue.forEach(function(t) {
    items.push({ type: 'task', id: t.id, label: t.title || 'Untitled task', reason: 'Overdue', color: 'var(--red)' });
  });

  pendingReqs.forEach(function(r) {
    if (r.priority === 'urgent') {
      items.push({ type: 'request', id: r.id, label: r.title || 'Untitled request', reason: 'Urgent priority', color: '#9c27b0' });
      return;
    }
    const created = r.createdAt ? new Date(r.createdAt).getTime() : 0;
    const unassigned = !r.assignedTo;
    if (unassigned && created && (now - created) > THREE_DAYS_MS) {
      items.push({ type: 'request', id: r.id, label: r.title || 'Untitled request', reason: 'Unassigned 3+ days', color: 'var(--amber)' });
    }
  });

  return items;
}

/* ── Attention Required widget renderer ── */
function _renderAttentionRequired(items, copyObj) {
  const M = PortalModules;
  const allClearMsg = (copyObj && copyObj.emptyStates && copyObj.emptyStates.allClear) || 'All clear';
  const alertIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;

  let body;
  if (items.length === 0) {
    body = `<div class="cc-attention-clear">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      ${M.esc(allClearMsg)}
    </div>`;
  } else {
    const rows = items.slice(0, 8).map(function(item) {
      /* Both tasks and requests use openTaskDetail — they share the same side panel */
      const onclick = `typeof window.openTaskDetail==='function'&&window.openTaskDetail('${M.esc(item.id)}')`;
      const onkeydown = `if(event.key==='Enter'||event.key===' '){event.preventDefault();${onclick};}`;
      return `<div class="cc-attn-row" onclick="${onclick}" onkeydown="${onkeydown}" role="button" tabindex="0" title="${M.esc(item.reason)}">
        <span class="cc-attn-dot" style="background:${item.color}"></span>
        <span class="cc-attn-label">${M.esc(item.label)}</span>
        <span class="cc-attn-reason">${M.esc(item.reason)}</span>
      </div>`;
    }).join('');
    body = `<div class="cc-attn-list">${rows}</div>`;
  }

  return `
    <div class="cc-widget cc-widget--attention">
      <div class="cc-widget-header">
        <span class="cc-widget-icon" style="color:var(--red)">${alertIcon}</span>
        <span class="cc-widget-title">Attention Required</span>
        ${items.length > 0 ? `<span class="cc-badge cc-badge--red">${items.length}</span>` : ''}
      </div>
      ${body}
    </div>`;
}

/* ───────────────────────────────────────────────────────────────────────────
 * HOA Admin Dashboard
 * ────────────────────────────────────────────────────────────────────────── */
async function renderHoa(container, ctx) {
  const M   = PortalModules;
  const C   = PortalRoleCopy.get('hoa_admin');
  const { activeCommunity } = ctx;
  const I   = M.ICONS;

  const [dashData, reqResult, schedules, waterUsage, thisWeekVisits] = await Promise.all([
    _fetchHoaDashboard(),
    _fetchHoaRequests(),
    _fetchServiceSchedules(activeCommunity.id),
    _fetchWaterUsage(activeCommunity.id),
    _fetchServiceVisitsThisWeek(activeCommunity.id),
  ]);
  /* Admin always has access; extract raw array from result object */
  const requests = reqResult.requests;

  /* Normalize what the HOA dashboard returns
   * upcomingTasks = all non-completed tasks (limit 10)
   * recentCompletions = recently completed tasks (limit 8)
   */
  const nonCompleted = (dashData && dashData.upcomingTasks) || [];
  const recentDone   = (dashData && dashData.recentCompletions) || [];
  const upcoming     = nonCompleted.filter(t => M.classifyTask(t) === 'upcoming');
  const active       = nonCompleted.filter(t => M.classifyTask(t) === 'active');
  const overdue      = nonCompleted.filter(t => M.classifyTask(t) === 'overdue');
  const pendingReqs  = requests.filter(r => r.status !== 'completed');

  /* Attention Required items */
  const attentionItems = _buildAttentionItems(overdue, pendingReqs);

  container.innerHTML = `
    ${M.pageHeader('Dashboard', activeCommunity)}

    <!-- Panel 1: Command Center -->
    <div class="dash-panel dash-panel--command">
      <div class="dash-panel-body">
        ${M.statsRow([
          { icon: I.task(),  label: C.summaryLabels.activeTasks,  value: active.length,      color: 'var(--teal)' },
          { icon: I.alert(), label: C.summaryLabels.overdue,      value: overdue.length,     color: 'var(--red)' },
          { icon: I.inbox(), label: C.summaryLabels.openRequests, value: pendingReqs.length, color: 'var(--amber)' },
          { icon: I.done(),  label: C.summaryLabels.upcoming,     value: upcoming.length,    color: 'var(--blue)' },
        ])}
        <div class="cc-sections">
          <div class="cc-section cc-section--service">
            ${_renderServiceDayWidget(schedules, thisWeekVisits)}
          </div>
          <div class="cc-section cc-section--water">
            ${_renderWaterUsageWidget(waterUsage)}
          </div>
          <div class="cc-section cc-section--attention">
            ${_renderAttentionRequired(attentionItems, C)}
          </div>
        </div>
      </div>
    </div>

    <!-- Panel 2: Tasks -->
    <div class="dash-panel dash-panel--tasks">
      <div class="dash-panel-header">
        <span class="dash-panel-label">${M.esc(C.sectionHeaders.tasksPanel)}</span>
        ${_syncBadgeHtml('dash-sync-bar')}
      </div>
      <div class="dash-panel-body">
        <div id="dash-open-reqs-col">
          ${M.listModule({
            title: C.sectionHeaders.requests,
            rows: pendingReqs.slice(0, 5),
            emptyMsg: C.emptyStates.noRequests,
            viewAllRoute: 'requests',
          })}
        </div>
        <div id="dash-upcoming-work-col">
          ${M.listModule({
            title: C.sectionHeaders.upcomingTasks,
            rows: upcoming.slice(0, 5),
            emptyMsg: C.noDataMessages.noUpcoming,
            viewAllRoute: 'tasks',
          })}
        </div>
        <div id="dash-recent-work-col">
          ${M.listModule({
            title: C.sectionHeaders.recentWork,
            rows: recentDone.slice(0, 5),
            emptyMsg: C.emptyStates.noCompleted,
            viewAllRoute: 'tasks',
          })}
        </div>
      </div>
    </div>

    <!-- Panel 3: Map -->
    <div class="dash-panel dash-panel--map">
      <div class="dash-panel-header">
        <span class="dash-panel-label">${M.esc(C.sectionHeaders.mapSection)}</span>
        <button class="module-view-all" onclick="PortalRouter.navigate('map')">Open full map</button>
      </div>
      <div class="dash-panel-body">
        <div class="map-preview-body">
          <iframe id="dash-map-iframe" src="/leaflet-map.html" class="map-preview-iframe" tabindex="-1" aria-hidden="true"></iframe>
        </div>
      </div>
    </div>
  `;
  requestAnimationFrame(function() { _initMapPreview(activeCommunity.id); });

  /* Start sync for HOA dashboard — re-fetches HOA dashboard + requests.
   * The fetch function returns a normalized array of {id, status} entries
   * so SyncManager's snapshot compares task/request identity + status only,
   * avoiding false-positive "changed" toasts from irrelevant field changes.
   * The raw data is stored in _hoaLatest for the onResult callback to use. */
  if (window.SyncManager) {
    const sm = SyncManager.create();
    window._dashSyncManager = sm;
    let _hoaLatest = { dashData: null, requests: [] };

    sm.start(
      async function () {
        const [dd, reqRes] = await Promise.all([_fetchHoaDashboard(), _fetchHoaRequests()]);
        const reqs = reqRes.requests;
        _hoaLatest = { dashData: dd, requests: reqs };
        /* Build a normalized array for snapshot comparison */
        const tasks = ((dd && dd.upcomingTasks) || []).concat((dd && dd.recentCompletions) || []);
        return tasks.map(t => ({ id: t.id, status: t.status }))
          .concat(reqs.map(r => ({ id: r.id, status: r.status })));
      },
      function (_normalizedArr, changed) {
        const dd    = _hoaLatest.dashData;
        const reqs  = _hoaLatest.requests;
        const nc    = (dd && dd.upcomingTasks) || [];
        const rd    = (dd && dd.recentCompletions) || [];
        const up    = nc.filter(t => M.classifyTask(t) === 'upcoming');
        const ac    = nc.filter(t => M.classifyTask(t) === 'active');
        const od    = nc.filter(t => M.classifyTask(t) === 'overdue');
        const pReqs = reqs.filter(r => r.status !== 'completed');

        _updateStatsRow(container, [ac.length, od.length, pReqs.length, up.length]);
        _patchListModule(container, '#dash-open-reqs-col', pReqs.slice(0, 5), C.emptyStates.noRequests);
        _patchListModule(container, '#dash-upcoming-work-col', up.slice(0, 5), C.noDataMessages.noUpcoming);
        _patchListModule(container, '#dash-recent-work-col', rd.slice(0, 5), C.emptyStates.noCompleted);

        _updateDashSyncLabel(container);
        if (changed) PortalAPI.showToast('Tasks updated', 'info');
      },
      30000
    );
    _wireDashSyncBtn(container, sm);
    window._dashSyncTicker = setInterval(() => _updateDashSyncLabel(container), 5000);
  }
}

/* ───────────────────────────────────────────────────────────────────────────
 * HOA Member Community Visibility Dashboard
 * Purpose-built for transparency and community confidence — no admin framing.
 * Module order: Activity summary → Recent completions → Upcoming work →
 *               Map quick-view → Service schedule → Request status summary
 * ────────────────────────────────────────────────────────────────────────── */
async function renderHoaMember(container, ctx) {
  const M   = PortalModules;
  const { activeCommunity } = ctx;
  const I   = M.ICONS;

  const [dashData, reqResult, schedules, thisWeekVisits] = await Promise.all([
    _fetchHoaDashboard(),
    _fetchHoaRequests(),
    _fetchServiceSchedules(activeCommunity.id),
    _fetchServiceVisitsThisWeek(activeCommunity.id),
  ]);
  /* Distinguish permission-denied (allowed=false) from empty-but-allowed */
  const requestsAllowed = reqResult.allowed;
  const requests        = reqResult.requests;

  const nonCompleted  = (dashData && dashData.upcomingTasks) || [];
  const recentDone    = (dashData && dashData.recentCompletions) || [];
  const upcoming      = nonCompleted.filter(t => M.classifyTask(t) === 'upcoming');
  const completed     = recentDone;
  /* allRequests = all submitted requests for the member panel (show full history + status).
   * activeRequests = open/non-completed subset used for the stats card count. */
  const allRequests    = requestsAllowed ? requests : [];
  const activeRequests = allRequests.filter(r => r.status !== 'completed');

  /* Community narrative block: what's happening, what was done, what's next */
  const narrativeParts = [];
  if (upcoming.length > 0) {
    narrativeParts.push(`${upcoming.length} item${upcoming.length !== 1 ? 's' : ''} scheduled for your community.`);
  }
  if (completed.length > 0) {
    narrativeParts.push(`${completed.length} task${completed.length !== 1 ? 's' : ''} recently completed.`);
  }
  if (activeRequests.length > 0) {
    narrativeParts.push(`${activeRequests.length} open service request${activeRequests.length !== 1 ? 's' : ''} on file.`);
  }
  const narrative = narrativeParts.length > 0
    ? narrativeParts.join(' ')
    : 'Your community is up to date. Check back soon for activity updates.';

  /* Member-friendly service widget — community-facing copy, no Manage link */
  const serviceDayHtml = _renderServiceDayWidget(schedules, thisWeekVisits, { memberMode: true });

  container.innerHTML = `
    ${M.pageHeader('Community Dashboard', activeCommunity)}

    <!-- Panel 1: Community Activity Summary -->
    <div class="dash-panel dash-panel--command">
      <div class="dash-panel-body">
        ${M.statsRow([
          { icon: I.done(),     label: 'Completed this month', value: completed.length,      color: 'var(--teal)' },
          { icon: I.task(),     label: 'Scheduled upcoming',   value: upcoming.length,        color: 'var(--blue)' },
          ...(requestsAllowed ? [{ icon: I.inbox(), label: 'Active requests', value: activeRequests.length, color: 'var(--amber)' }] : []),
          { icon: I.calendar(), label: 'Service visits',        value: thisWeekVisits.length, color: 'var(--green)' },
        ])}
        <div class="cc-member-narrative">
          <p class="cc-member-narrative-text">${M.esc(narrative)}</p>
        </div>
      </div>
    </div>

    <!-- Panel 2: Recent work + Upcoming work -->
    <div class="dash-panel dash-panel--tasks dash-panel--member">
      <div class="dash-panel-header">
        <span class="dash-panel-label">Community Activity</span>
        ${_syncBadgeHtml('dash-sync-bar')}
      </div>
      <div class="dash-panel-body">
        <div id="dash-member-completed-col">
          ${M.listModule({
            title: 'Recent work in your community',
            rows: completed.slice(0, 5),
            emptyMsg: 'No recent completions to show.',
            viewAllRoute: 'tasks',
          })}
        </div>
        <div id="dash-member-upcoming-col">
          ${M.listModule({
            title: 'Scheduled next',
            rows: upcoming.slice(0, 5),
            emptyMsg: 'No upcoming work scheduled.',
            viewAllRoute: 'tasks',
          })}
        </div>
      </div>
    </div>

    <!-- Panel 3: Map quick-view -->
    <div class="dash-panel dash-panel--map">
      <div class="dash-panel-header">
        <span class="dash-panel-label">Community Map</span>
        <button class="module-view-all" onclick="PortalRouter.navigate('map')">View community map</button>
      </div>
      <div class="dash-panel-body">
        <div class="map-preview-body">
          <iframe id="dash-map-iframe" src="/leaflet-map.html" class="map-preview-iframe" tabindex="-1" aria-hidden="true"></iframe>
        </div>
      </div>
    </div>

    <!-- Panel 4: Service schedule widget -->
    <div class="dash-panel">
      <div class="dash-panel-header">
        <span class="dash-panel-label">Service Schedule</span>
      </div>
      <div class="dash-panel-body dash-panel-body--widgets">
        ${serviceDayHtml}
      </div>
    </div>

    ${requestsAllowed ? `
    <!-- Panel 5: Request status summary — gated by API permission (allowed=true).
         Shows all submitted requests and their status so members can track history.
         Sync patches this list in place every 30s. -->
    <div class="dash-panel">
      <div class="dash-panel-header">
        <span class="dash-panel-label">Your Requests</span>
      </div>
      <div class="dash-panel-body">
        <div id="dash-member-requests-col">
          ${M.listModule({
            title: '',
            rows: allRequests.slice(0, 5),
            emptyMsg: 'No requests on file.',
            viewAllRoute: 'requests',
          })}
        </div>
      </div>
    </div>` : ''}
  `;

  requestAnimationFrame(function() { _initMapPreview(activeCommunity.id); });

  /* 30-second sync wiring — updates completions, upcoming, and request status.
   * Stats row preserves service visits count from initial load (not re-fetched
   * on sync since service visits are fetched weekly and don't change on 30s interval). */
  if (window.SyncManager) {
    const sm = SyncManager.create();
    window._dashSyncManager = sm;
    /* Capture initial service visits count so sync doesn't zero it out */
    const initialVisitCount = thisWeekVisits.length;
    let _memberLatest = { dashData: null, requests: [] };

    sm.start(
      async function () {
        /* Skip request fetch for members without permission to avoid repeated
         * "Not authorized" toasts during the 30s sync interval */
        const [dd, reqRes] = await Promise.all([
          _fetchHoaDashboard(),
          requestsAllowed ? _fetchHoaRequests() : Promise.resolve({ allowed: false, requests: [] }),
        ]);
        const reqs = reqRes.requests;
        _memberLatest = { dashData: dd, requests: reqs };
        const tasks = ((dd && dd.upcomingTasks) || []).concat((dd && dd.recentCompletions) || []);
        return tasks.map(t => ({ id: t.id, status: t.status }))
          .concat(reqs.map(r => ({ id: r.id, status: r.status })));
      },
      function (_normalizedArr, changed) {
        const dd      = _memberLatest.dashData;
        const reqs    = _memberLatest.requests;
        const nc      = (dd && dd.upcomingTasks) || [];
        const rd      = (dd && dd.recentCompletions) || [];
        const up      = nc.filter(t => M.classifyTask(t) === 'upcoming');
        const comp    = rd;
        /* allReqs = full request list for panel display; actReqs = open only for stat count */
        const allReqs  = requestsAllowed ? reqs : [];
        const actReqs  = allReqs.filter(r => r.status !== 'completed');

        /* Stats row: service visits card uses the initial count (unchanged on 30s sync).
         * Request stat card only included when member has permission (same as initial render). */
        const statValues = requestsAllowed
          ? [comp.length, up.length, actReqs.length, initialVisitCount]
          : [comp.length, up.length, initialVisitCount];
        _updateStatsRow(container, statValues);
        _patchListModule(container, '#dash-member-completed-col', comp.slice(0, 5), 'No recent completions to show.');
        _patchListModule(container, '#dash-member-upcoming-col', up.slice(0, 5), 'No upcoming work scheduled.');
        if (requestsAllowed) {
          _patchListModule(container, '#dash-member-requests-col', allReqs.slice(0, 5), 'No requests on file.');
        }

        _updateDashSyncLabel(container);
        if (changed) PortalAPI.showToast('Community activity updated', 'info');
      },
      30000
    );
    _wireDashSyncBtn(container, sm);
    window._dashSyncTicker = setInterval(() => _updateDashSyncLabel(container), 5000);
  }
}

/* ───────────────────────────────────────────────────────────────────────────
 * Property Manager Dashboard
 * ────────────────────────────────────────────────────────────────────────── */

/* Fetch map layers for a community (lightweight — no geojson needed here) */
async function _fetchMapLayers(communityId) {
  try {
    const layers = await PortalAPI.apiFetch(`/api/map-layers?communityId=${encodeURIComponent(communityId)}`);
    return Array.isArray(layers) ? layers : [];
  } catch { return []; }
}

/* Completions this calendar week */
function _completionsThisWeek(tasks) {
  const now = new Date();
  const dayOfWeek = now.getDay(); /* 0=Sun */
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - dayOfWeek);
  weekStart.setHours(0, 0, 0, 0);
  return tasks.filter(function(t) {
    if (t.status !== 'completed') return false;
    const ca = t.completedAt ? new Date(t.completedAt) : null;
    return ca && ca >= weekStart;
  });
}

/* Format a next service window as a short label: "Mowing · Thu" */
function _nextServiceLabel(schedules) {
  const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const active = (schedules || []).filter(function(s) { return s.isActive; });
  if (active.length === 0) return null;
  const s = active[0];
  const day = DOW_SHORT[s.dayOfWeek] || '?';
  const name = s.name || s.serviceName || 'Service';
  return name + ' \u00B7 ' + day;
}

/* Render the PM community context header */
function _renderPMContextHeader(activeCommunity, isMultiCommunity) {
  const M = PortalModules;
  const homeIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;
  const switchCta = isMultiCommunity
    ? `<button class="pm-ctx-switch-btn" onclick="PortalRouter.navigate('communities')">Switch Community
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
      </button>`
    : '';
  return `
    <div class="pm-ctx-header">
      <div class="pm-ctx-left">
        <span class="pm-ctx-icon">${homeIcon}</span>
        <div class="pm-ctx-info">
          <span class="pm-ctx-role">Property Manager Dashboard</span>
          <span class="pm-ctx-name">${M.esc(activeCommunity.name)}</span>
        </div>
      </div>
      ${switchCta}
    </div>`;
}

/* Render requests-by-status breakdown widget */
function _renderRequestsBreakdown(hoaReqs) {
  const M = PortalModules;
  const pending    = hoaReqs.filter(function(r) { return r.status === 'pending' || r.status === 'new'; });
  const inProgress = hoaReqs.filter(function(r) { return r.status === 'in_progress' || r.status === 'in-progress' || r.status === 'assigned'; });
  const doneThisWk = _completionsThisWeek(hoaReqs);

  const buckets = [
    { label: 'Pending',     count: pending.length,    color: 'var(--amber)',  cls: 'pm-rb-amber' },
    { label: 'In Progress', count: inProgress.length, color: 'var(--blue)',   cls: 'pm-rb-blue' },
    { label: 'Done This Wk', count: doneThisWk.length, color: 'var(--green)', cls: 'pm-rb-green' },
  ];

  const inboxIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/></svg>`;

  const rows = buckets.map(function(b) {
    return `<div class="pm-rb-row">
      <span class="pm-rb-dot ${b.cls}"></span>
      <span class="pm-rb-label">${M.esc(b.label)}</span>
      <span class="pm-rb-count" style="color:${b.color}">${b.count}</span>
    </div>`;
  }).join('');

  return `
    <div class="pm-widget pm-widget--requests">
      <div class="pm-widget-header">
        <span class="pm-widget-icon" style="color:var(--amber)">${inboxIcon}</span>
        <span class="pm-widget-title">Requests by Status</span>
        <button class="cc-widget-link" onclick="PortalRouter.navigate('tasks')">View all →</button>
      </div>
      <div class="pm-rb-body">${rows}</div>
    </div>`;
}

/* Render the quick map layers panel */
function _renderMapLayersPanel(layers, communityId) {
  const M = PortalModules;
  const layerIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`;

  const displayable = layers.filter(function(l) {
    return l.isActive !== false && l.layerKey !== 'outline';
  });

  let body;
  if (displayable.length === 0) {
    body = `<div class="pm-widget-empty">No active map layers</div>`;
  } else {
    const items = displayable.slice(0, 8).map(function(l) {
      const color = l.color || '#25C1AC';
      const name  = M.esc(l.displayName || l.name || l.layerKey || 'Layer');
      const onclick = `PortalRouter.navigate('map')`;
      return `<div class="pm-ml-row" onclick="${onclick}" role="button" tabindex="0" title="Open ${name} on map">
        <span class="pm-ml-dot" style="background:${color}"></span>
        <span class="pm-ml-name">${name}</span>
        <svg class="pm-ml-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </div>`;
    }).join('');
    body = `<div class="pm-ml-list">${items}</div>`;
  }

  return `
    <div class="pm-widget pm-widget--layers">
      <div class="pm-widget-header">
        <span class="pm-widget-icon" style="color:var(--teal)">${layerIcon}</span>
        <span class="pm-widget-title">Map Layers</span>
        <button class="cc-widget-link" onclick="PortalRouter.navigate('map')">Open map →</button>
      </div>
      ${body}
    </div>`;
}

/* Render the service schedule widget */
function _renderPMServiceSchedule(schedules) {
  const M = PortalModules;
  const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const calIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;

  const active = (schedules || []).filter(function(s) { return s.isActive; }).slice(0, 3);

  let body;
  if (active.length === 0) {
    body = `<div class="pm-widget-empty">No service schedule on file</div>`;
  } else {
    const items = active.map(function(s) {
      const dayName = DOW[s.dayOfWeek] || 'Unknown';
      const name = M.esc(s.name || s.serviceName || 'Service');
      /* Next occurrence on or after today */
      const d = new Date(today);
      const delta = (s.dayOfWeek - d.getDay() + 7) % 7;
      d.setDate(d.getDate() + delta);
      const nextStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const cadence = s.frequency ? M.esc(s.frequency) : 'Weekly';
      return `<div class="pm-ss-row">
        <div class="pm-ss-name">${name}</div>
        <div class="pm-ss-meta">
          <span class="pm-ss-day">${M.esc(dayName)}</span>
          <span class="pm-ss-sep">·</span>
          <span class="pm-ss-next">Next: ${M.esc(nextStr)}</span>
          <span class="pm-ss-sep">·</span>
          <span class="pm-ss-cadence">${cadence}</span>
        </div>
      </div>`;
    }).join('');
    body = `<div class="pm-ss-list">${items}</div>`;
  }

  return `
    <div class="pm-widget pm-widget--schedule">
      <div class="pm-widget-header">
        <span class="pm-widget-icon" style="color:var(--teal)">${calIcon}</span>
        <span class="pm-widget-title">Service Schedule</span>
        <button class="cc-widget-link" onclick="PortalRouter.navigate('service-schedule')">Manage →</button>
      </div>
      ${body}
    </div>`;
}

async function renderPM(container, ctx) {
  const M   = PortalModules;
  const { activeCommunity, isMultiCommunityUser } = ctx;
  const I   = M.ICONS;

  const [tasks, schedules, mapLayers] = await Promise.all([
    _fetchTasks(activeCommunity.id),
    _fetchServiceSchedules(activeCommunity.id),
    _fetchMapLayers(activeCommunity.id),
  ]);

  const { overdue, upcoming, completed, hoaReqs } = _partition(tasks);
  const openReqs       = hoaReqs.filter(function(t) { return t.status !== 'completed'; });
  const completionsWk  = _completionsThisWeek(tasks);
  const recentDone     = completed.slice().sort(function(a, b) {
    return new Date(b.completedAt || 0) - new Date(a.completedAt || 0);
  }).slice(0, 5);
  const upcomingSorted = upcoming.slice().sort(function(a, b) {
    return new Date(a.dueDate || '9999') - new Date(b.dueDate || '9999');
  }).slice(0, 5);
  const nextSvcLabel   = _nextServiceLabel(schedules) || '—';

  container.innerHTML = `
    ${_renderPMContextHeader(activeCommunity, isMultiCommunityUser)}

    ${M.statsRow([
      { icon: I.inbox(), label: 'Open Requests',       value: openReqs.length,      color: 'var(--amber)' },
      { icon: I.alert(), label: 'Overdue Tasks',        value: overdue.length,       color: 'var(--red)' },
      { icon: I.done(),  label: 'Completions This Wk', value: completionsWk.length, color: 'var(--green)' },
      { icon: I.calendar(), label: 'Next Service', value: nextSvcLabel, color: 'var(--teal)' },
    ])}

    <!-- Row 1: Requests breakdown + Service schedule + Map layers -->
    <div class="dash-grid" style="margin-top:20px">
      <div class="dash-col-4" id="dash-pm-reqs-breakdown">
        ${_renderRequestsBreakdown(hoaReqs)}
      </div>
      <div class="dash-col-4" id="dash-pm-schedule">
        ${_renderPMServiceSchedule(schedules)}
      </div>
      <div class="dash-col-4" id="dash-pm-layers">
        ${_renderMapLayersPanel(mapLayers, activeCommunity.id)}
      </div>
    </div>

    <!-- Row 2: Recent completions + Upcoming tasks -->
    <div class="dash-panel dash-panel--tasks" style="margin-top:20px">
      <div class="dash-panel-header">
        <span class="dash-panel-label">Tasks</span>
        ${_syncBadgeHtml('dash-sync-bar')}
      </div>
      <div class="dash-panel-body">
        <div id="dash-pm-completed-col">
          ${M.listModule({
            title: 'Recent Completions',
            rows: recentDone,
            emptyMsg: 'No completed tasks yet.',
            viewAllRoute: 'tasks',
          })}
        </div>
        <div id="dash-pm-upcoming-col">
          ${M.listModule({
            title: 'Upcoming Tasks',
            rows: upcomingSorted,
            emptyMsg: 'No upcoming tasks scheduled.',
            viewAllRoute: 'tasks',
          })}
        </div>
      </div>
    </div>
  `;

  /* Start sync for PM dashboard */
  if (window.SyncManager) {
    const sm = SyncManager.create();
    window._dashSyncManager = sm;
    sm.start(
      function() { return _fetchTasks(activeCommunity.id); },
      function (newTasks, changed) {
        const { overdue: od, upcoming: up, completed: comp, hoaReqs: hr } = _partition(newTasks);
        const openR     = hr.filter(function(t) { return t.status !== 'completed'; });
        const compWk    = _completionsThisWeek(newTasks);
        const recentD   = comp.slice().sort(function(a, b) {
          return new Date(b.completedAt || 0) - new Date(a.completedAt || 0);
        }).slice(0, 5);
        const upSorted  = up.slice().sort(function(a, b) {
          return new Date(a.dueDate || '9999') - new Date(b.dueDate || '9999');
        }).slice(0, 5);

        _updateStatsRow(container, [openR.length, od.length, compWk.length, nextSvcLabel]);
        _patchListModule(container, '#dash-pm-completed-col', recentD, 'No completed tasks yet.');
        _patchListModule(container, '#dash-pm-upcoming-col', upSorted, 'No upcoming tasks scheduled.');

        /* Patch requests breakdown */
        const rbEl = container.querySelector('#dash-pm-reqs-breakdown');
        if (rbEl) rbEl.innerHTML = _renderRequestsBreakdown(hr);

        _updateDashSyncLabel(container);
        if (changed) PortalAPI.showToast('Tasks updated', 'info');
      },
      30000
    );
    _wireDashSyncBtn(container, sm);
    window._dashSyncTicker = setInterval(function() { _updateDashSyncLabel(container); }, 5000);
  }
}

/* ───────────────────────────────────────────────────────────────────────────
 * Partial DOM patch helpers
 * ────────────────────────────────────────────────────────────────────────── */

/* Update stat card values without full re-render
 * values = [val0, val1, val2, val3] matching statsRow order
 */
function _updateStatsRow(container, values) {
  const cards = container.querySelectorAll('.portal-stat-card');
  cards.forEach(function (card, i) {
    if (i >= values.length) return;
    const valEl = card.querySelector('.psc-value');
    if (valEl) valEl.textContent = values[i];
  });
}

/* Re-render a listModule's body in place without touching surrounding columns.
 * rows should already be sliced to the desired display limit by the caller. */
function _patchListModule(container, colSelector, rows, emptyMsg) {
  const col = container.querySelector(colSelector);
  if (!col) return;
  const M = PortalModules;
  const body = rows.length > 0
    ? rows.map(r => M.taskRow(r)).join('')
    : `<div class="module-empty">${M.esc(emptyMsg || 'Nothing to show.')}</div>`;

  const bodyEl = col.querySelector('.pm-body');
  if (bodyEl) {
    bodyEl.innerHTML = body;
    bodyEl.querySelectorAll('[data-task-id]').forEach(function (row) {
      row.addEventListener('click', function () {
        if (typeof window.openTaskDetail === 'function') {
          window.openTaskDetail(row.dataset.taskId);
        }
      });
    });
  }
}

/* ───────────────────────────────────────────────────────────────────────────
 * Dashboard Map Preview — Leaflet bridge
 * ────────────────────────────────────────────────────────────────────────── */
async function _initMapPreview(communityId) {
  if (typeof window._dashMapCleanup === 'function') {
    window._dashMapCleanup();
    window._dashMapCleanup = null;
  }

  const iframe = document.getElementById('dash-map-iframe');
  if (!iframe) return;

  let ready = false;
  const pending = [];

  function send(fn) {
    const args = Array.prototype.slice.call(arguments, 1);
    if (!ready) { pending.push({ fn, args }); return; }
    if (iframe.contentWindow) {
      iframe.contentWindow.postMessage({ type: 'cmd', fn, args }, '*');
    }
  }

  function handler(e) {
    if (e.source !== iframe.contentWindow) return;
    if (!e.data || typeof e.data !== 'string') return;
    var msg;
    try { msg = JSON.parse(e.data); } catch (_) { return; }
    if (msg.type !== 'mapReady') return;
    ready = true;
    var cmds = pending.splice(0);
    cmds.forEach(function(c) {
      if (iframe.contentWindow) {
        iframe.contentWindow.postMessage({ type: 'cmd', fn: c.fn, args: c.args }, '*');
      }
    });
    _loadPreviewCommunity(communityId, send);
  }

  window.addEventListener('message', handler);
  window._dashMapCleanup = function() {
    window.removeEventListener('message', handler);
    window._dashMapCleanup = null;
  };
  return window._dashMapCleanup;
}

async function _loadPreviewCommunity(communityId, send) {
  try {
    const layers = await PortalAPI.apiFetch(`/api/map-layers?communityId=${communityId}`);
    const mapLayers = Array.isArray(layers) ? layers : [];

    for (const layer of mapLayers) {
      try {
        const geojson = await PortalAPI.apiFetch(`/api/map-layers/${layer.id}/geojson`);
        if (geojson) layer._geojson = geojson;
      } catch (_) {}
    }

    const communitySubKeys = ['bluegrass_area', 'native_area', 'landscape_bed', 'pet_station'];
    const layerData = mapLayers
      .filter(function(l) { return l._geojson && l.layerKey !== 'outline'; })
      .map(function(l) {
        return {
          id: l.id,
          layerKey: l.layerKey,
          subLayerKey: l.subLayerKey,
          displayName: l.displayName,
          color: l.color || '#25C1AC',
          geojson: l._geojson,
          controllerColorMap: l.controllerColorMap || {},
        };
      });

    if (layerData.length > 0) send('addLayers', layerData);

    const visibleIds = mapLayers
      .filter(function(l) { return l.layerKey === 'community' && communitySubKeys.indexOf(l.subLayerKey) !== -1; })
      .map(function(l) { return l.id; });
    send('showLayerIds', visibleIds);

    const outlineLayer = mapLayers.find(function(l) { return l.layerKey === 'outline' && l._geojson; });
    if (outlineLayer) {
      send('setCommunityOutline', outlineLayer._geojson);
      send('fitToOutline');
    }
  } catch (err) {
    console.error('Dashboard map preview failed:', err);
  }
}
