/* VRTSync Portal — Role-Based Dashboard
 * Route: 'dashboard'
 * Renders role-specific dashboard using shared PortalModules.
 */
function _wide() { return window.innerWidth >= 1600; }
function _wc(narrow, wide) { return _wide() ? wide : narrow; }

PortalRouter.register('dashboard', async function (container) {
  const ctx = PortalState.getCommunityContext();
  const { role, activeCommunity } = ctx;

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

    <div class="dash-grid">
      <div class="dash-col-8">
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

    <div class="dash-grid" style="margin-top:20px">
      <div class="${_wc('dash-col-6', 'dash-col-4w')}">
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
      ${_wide() ? `<div class="dash-col-4w">
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

    ${M.statsRow([
      { icon: I.task(),  label: 'Active Tasks',  value: active.length,      color: 'var(--teal)' },
      { icon: I.alert(), label: 'Overdue',        value: overdue.length,    color: 'var(--red)' },
      { icon: I.inbox(), label: 'Open Requests',  value: pendingReqs.length, color: 'var(--amber)' },
      { icon: I.done(),  label: 'Upcoming',       value: upcoming.length,   color: 'var(--blue)' },
    ])}

    <div class="dash-grid">
      <div class="dash-col-8">
        ${M.mapPreviewModule({ community: activeCommunity, tall: true })}
      </div>
      <div class="dash-col-4">
        ${M.listModule({
          title: 'Recent Requests',
          rows: requests.slice(0, 5),
          emptyMsg: 'No recent requests.',
          viewAllRoute: 'requests',
        })}
      </div>
    </div>

    <div class="dash-grid" style="margin-top:20px">
      <div class="${_wc('dash-col-6', 'dash-col-4w')}">
        ${M.listModule({
          title: 'Recent Work',
          rows: recentDone.slice(0, 5),
          emptyMsg: 'No recent completions.',
          viewAllRoute: 'tasks',
        })}
      </div>
      <div class="${_wc('dash-col-6', 'dash-col-4w')}">
        ${M.listModule({
          title: 'Upcoming Work',
          rows: upcoming.slice(0, 5),
          emptyMsg: 'No upcoming work scheduled.',
          viewAllRoute: 'tasks',
        })}
      </div>
      ${_wide() ? `<div class="dash-col-4w">
        ${M.listModule({
          title: 'Open Requests',
          rows: pendingReqs.slice(0, 5),
          emptyMsg: 'No open requests.',
          viewAllRoute: 'requests',
        })}
      </div>` : ''}
    </div>

    <div class="dash-grid" style="margin-top:20px">
      <div class="dash-col-4">
        ${M.quickLinksModule({
          title: 'Quick Links',
          links: [
            { icon: I.map(),  label: 'Community Map',  route: 'map' },
            { icon: I.file(), label: 'Documents',       route: 'documents' },
            { icon: I.bar(),  label: 'Reports',         route: 'reports' },
            { icon: I.users(), label: 'Contacts',       route: 'contacts' },
          ],
        })}
      </div>
      <div class="dash-col-8">
        ${M.graphModule({ title: 'Water Usage', hint: 'Water usage reporting coming in a future update.' })}
      </div>
    </div>
  `;
  requestAnimationFrame(function() { _initMapPreview(activeCommunity.id); });
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

    <div class="dash-grid">
      <div class="${_wc('dash-col-6', 'dash-col-4w')}">
        ${M.listModule({
          title: 'Recently Completed',
          rows: recentDone,
          emptyMsg: 'No completed tasks yet.',
          viewAllRoute: 'tasks',
        })}
      </div>
      <div class="${_wc('dash-col-6', 'dash-col-4w')}">
        ${M.listModule({
          title: 'Recent Requests',
          rows: pendingReqs.slice(0, 5),
          emptyMsg: 'No open requests.',
          viewAllRoute: 'tasks',
        })}
      </div>
      ${_wide() ? `<div class="dash-col-4w">
        ${M.listModule({
          title: 'Overdue Tasks',
          rows: overdue.slice(0, 5),
          emptyMsg: 'No overdue tasks.',
          viewAllRoute: 'tasks',
        })}
      </div>` : ''}
    </div>

    <div class="dash-grid" style="margin-top:20px">
      <div class="dash-col-6">
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
