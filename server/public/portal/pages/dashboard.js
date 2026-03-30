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
    else if (role === 'hoa_admin')   await renderHoa(container, ctx, false);
    else if (role === 'hoa_member')  await renderHoa(container, ctx, true);
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

async function _fetchHoaRequests() {
  try {
    const r = await PortalAPI.apiFetch('/api/hoa/requests');
    return Array.isArray(r) ? r : [];
  } catch { return []; }
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
  const { activeCommunity } = ctx;
  const I   = M.ICONS;

  const tasks = await _fetchTasks(activeCommunity.id);
  const { active, overdue, upcoming, completed, hoaReqs } = _partition(tasks);
  const todayWork = [...overdue, ...active].slice(0, 6);
  const pendingReqs = hoaReqs.filter(t => t.status !== 'completed');

  container.innerHTML = `
    ${M.pageHeader('Dashboard', activeCommunity)}

    ${M.statsRow([
      { icon: I.task(), label: 'Active Tasks',  value: active.length,    color: 'var(--teal)' },
      { icon: I.alert(), label: 'Overdue',      value: overdue.length,   color: 'var(--red)' },
      { icon: I.inbox(), label: 'HOA Requests', value: pendingReqs.length, color: 'var(--amber)' },
      { icon: I.done(), label: 'Upcoming',      value: upcoming.length,  color: 'var(--blue)' },
    ])}

    <div class="dash-tasks-header">
      <span class="dash-tasks-title">Tasks</span>
      ${_syncBadgeHtml('dash-sync-bar')}
    </div>

    <div class="dash-grid" id="dash-task-grid">
      <div class="dash-col-8" id="dash-todays-work-col">
        ${M.listModule({
          title: "Today's Work",
          rows: todayWork,
          emptyMsg: 'No active or overdue tasks right now.',
          viewAllRoute: 'tasks',
        })}
      </div>
      <div class="dash-col-4" style="display:flex;flex-direction:column;gap:20px">
        ${M.quickLinksModule({
          title: 'Quick Links',
          links: [
            { icon: I.map(),      label: 'Open Map',        route: 'map' },
            { icon: I.task(),     label: 'All Tasks',       route: 'tasks' },
            { icon: I.calendar(), label: 'Service Schedule', route: 'service-schedule' },
          ],
        })}
        ${M.mapPreviewModule({ community: activeCommunity })}
      </div>
    </div>

    <div class="dash-grid" style="margin-top:20px" id="dash-hoa-grid">
      <div class="${_wc('dash-col-6', 'dash-col-4w')}" id="dash-hoa-reqs-col">
        ${M.listModule({
          title: 'HOA Requests',
          rows: pendingReqs.slice(0, 5),
          emptyMsg: 'No pending HOA requests.',
          viewAllRoute: 'tasks',
        })}
      </div>
      <div class="${_wc('dash-col-6', 'dash-col-4w')}">
        ${M.notesModule({ title: 'Contractor Notes' })}
      </div>
      ${_wide() ? `<div class="dash-col-4w" id="dash-completed-col">
        ${M.listModule({
          title: 'Completed Tasks',
          rows: completed.slice(0, 5),
          emptyMsg: 'No completed tasks yet.',
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
        _patchListModule(container, '#dash-todays-work-col', todayW, 'No active or overdue tasks right now.');
        _patchListModule(container, '#dash-hoa-reqs-col', pending.slice(0, 5), 'No pending HOA requests.');
        if (_wide()) {
          _patchListModule(container, '#dash-completed-col', comp.slice(0, 5), 'No completed tasks yet.');
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
 * HOA Admin + HOA Member Dashboard  (readOnly = member)
 * ────────────────────────────────────────────────────────────────────────── */
async function renderHoa(container, ctx, readOnly) {
  const M   = PortalModules;
  const { activeCommunity } = ctx;
  const I   = M.ICONS;

  const [dashData, requests] = await Promise.all([
    _fetchHoaDashboard(),
    _fetchHoaRequests(),
  ]);

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

  container.innerHTML = `
    ${M.pageHeader('Dashboard', activeCommunity)}

    <!-- Panel 1: Command Center -->
    <div class="dash-panel dash-panel--command">
      <div class="dash-panel-body">
        ${M.statsRow([
          { icon: I.task(),  label: 'Active Tasks',  value: active.length,      color: 'var(--teal)' },
          { icon: I.alert(), label: 'Overdue',        value: overdue.length,    color: 'var(--red)' },
          { icon: I.inbox(), label: 'Open Requests',  value: pendingReqs.length, color: 'var(--amber)' },
          { icon: I.done(),  label: 'Upcoming',       value: upcoming.length,   color: 'var(--blue)' },
        ])}
      </div>
    </div>

    <!-- Panel 2: Tasks -->
    <div class="dash-panel dash-panel--tasks">
      <div class="dash-panel-header">
        <span class="dash-panel-label">Tasks</span>
        ${_syncBadgeHtml('dash-sync-bar')}
      </div>
      <div class="dash-panel-body">
        <div id="dash-open-reqs-col">
          ${M.listModule({
            title: 'Requests',
            rows: pendingReqs.slice(0, 5),
            emptyMsg: 'No open requests.',
            viewAllRoute: 'requests',
          })}
        </div>
        <div id="dash-upcoming-work-col">
          ${M.listModule({
            title: 'Upcoming',
            rows: upcoming.slice(0, 5),
            emptyMsg: 'No upcoming work scheduled.',
            viewAllRoute: 'tasks',
          })}
        </div>
        <div id="dash-recent-work-col">
          ${M.listModule({
            title: 'Recently Completed',
            rows: recentDone.slice(0, 5),
            emptyMsg: 'No recent completions.',
            viewAllRoute: 'tasks',
          })}
        </div>
      </div>
    </div>

    <!-- Panel 3: Map -->
    <div class="dash-panel dash-panel--map">
      <div class="dash-panel-header">
        <span class="dash-panel-label">Community Map</span>
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
        const [dd, reqs] = await Promise.all([_fetchHoaDashboard(), _fetchHoaRequests()]);
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
        _patchListModule(container, '#dash-open-reqs-col', pReqs.slice(0, 5), 'No open requests.');
        _patchListModule(container, '#dash-upcoming-work-col', up.slice(0, 5), 'No upcoming work scheduled.');
        _patchListModule(container, '#dash-recent-work-col', rd.slice(0, 5), 'No recent completions.');

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
 * Property Manager Dashboard
 * ────────────────────────────────────────────────────────────────────────── */
async function renderPM(container, ctx) {
  const M   = PortalModules;
  const { activeCommunity } = ctx;
  const I   = M.ICONS;

  const tasks = await _fetchTasks(activeCommunity.id);
  const { active, overdue, upcoming, completed, hoaReqs } = _partition(tasks);
  const pendingReqs = hoaReqs.filter(t => t.status !== 'completed');
  const recentDone  = completed.slice(0, 5);

  container.innerHTML = `
    ${M.pageHeader('Dashboard', activeCommunity)}

    ${M.statsRow([
      { icon: I.task(),  label: 'Active Tasks',    value: active.length,      color: 'var(--teal)' },
      { icon: I.alert(), label: 'Overdue',          value: overdue.length,    color: 'var(--red)' },
      { icon: I.inbox(), label: 'Open Requests',    value: pendingReqs.length, color: 'var(--amber)' },
      { icon: I.done(),  label: 'Completed Tasks',  value: completed.length,  color: 'var(--green)' },
    ])}

    <div class="dash-tasks-header">
      <span class="dash-tasks-title">Tasks</span>
      ${_syncBadgeHtml('dash-sync-bar')}
    </div>

    <div class="dash-grid" style="margin-top:0">
      <div class="${_wc('dash-col-6', 'dash-col-4w')}" id="dash-recently-completed-col">
        ${M.listModule({
          title: 'Recently Completed',
          rows: recentDone,
          emptyMsg: 'No completed tasks yet.',
          viewAllRoute: 'tasks',
        })}
      </div>
      <div class="${_wc('dash-col-6', 'dash-col-4w')}" id="dash-recent-reqs-col">
        ${M.listModule({
          title: 'Recent Requests',
          rows: pendingReqs.slice(0, 5),
          emptyMsg: 'No open requests.',
          viewAllRoute: 'tasks',
        })}
      </div>
      ${_wide() ? `<div class="dash-col-4w" id="dash-overdue-col">
        ${M.listModule({
          title: 'Overdue Tasks',
          rows: overdue.slice(0, 5),
          emptyMsg: 'No overdue tasks.',
          viewAllRoute: 'tasks',
        })}
      </div>` : ''}
    </div>

    <div class="dash-grid" style="margin-top:20px">
      <div class="dash-col-6" id="dash-upcoming-col">
        ${M.listModule({
          title: 'Upcoming Work',
          rows: upcoming.slice(0, 5),
          emptyMsg: 'No upcoming work scheduled.',
          viewAllRoute: 'tasks',
        })}
      </div>
      <div class="dash-col-6">
        ${M.listModule({
          title: 'Recent Invoices',
          rows: [],
          emptyMsg: 'Invoice data coming in a future update.',
          viewAllRoute: 'invoices',
        })}
      </div>
    </div>

    <div class="dash-grid" style="margin-top:20px">
      <div class="dash-col-12">
        ${M.graphModule({ title: 'Water Usage', hint: 'Water usage reporting coming in a future update.' })}
      </div>
    </div>
  `;

  /* Start sync for PM dashboard */
  if (window.SyncManager) {
    const sm = SyncManager.create();
    window._dashSyncManager = sm;
    sm.start(
      () => _fetchTasks(activeCommunity.id),
      function (newTasks, changed) {
        const { active: a, overdue: od, upcoming: up, completed: comp, hoaReqs: hr } = _partition(newTasks);
        const pending   = hr.filter(t => t.status !== 'completed');
        const recentD   = comp.slice(0, 5);

        _updateStatsRow(container, [a.length, od.length, pending.length, comp.length]);
        _patchListModule(container, '#dash-recently-completed-col', recentD, 'No completed tasks yet.');
        _patchListModule(container, '#dash-recent-reqs-col', pending.slice(0, 5), 'No open requests.');
        if (_wide()) {
          _patchListModule(container, '#dash-overdue-col', od.slice(0, 5), 'No overdue tasks.');
        }
        _patchListModule(container, '#dash-upcoming-col', up.slice(0, 5), 'No upcoming work scheduled.');

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
