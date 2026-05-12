PortalRouter.register('service-schedule', async function (container) {
  var ctx = PortalState.getCommunityContext();
  var community = ctx.activeCommunity;
  var M = PortalModules;

  if (!community) {
    container.innerHTML = M.pageHeader('Service Schedule', null) +
      '<div class="empty-state" style="margin-top:80px"><p>Select a community first.</p></div>';
    return;
  }

  var communityId = community.id;

  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  var DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function seasonStr(sched) {
    if (sched.seasonStart && sched.seasonEnd) {
      var s = new Date(sched.seasonStart + 'T00:00:00');
      var e = new Date(sched.seasonEnd + 'T00:00:00');
      return s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' – ' +
             e.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    return 'Year-round';
  }

  function isInSeason(sched) {
    if (!sched.seasonStart || !sched.seasonEnd) return true;
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var start = new Date(sched.seasonStart + 'T00:00:00');
    var end   = new Date(sched.seasonEnd + 'T00:00:00');
    return today >= start && today <= end;
  }

  function nextOccurrence(dow) {
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var delta = (dow - today.getDay() + 7) % 7;
    var d = new Date(today);
    d.setDate(today.getDate() + delta);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  container.innerHTML = M.pageHeader('Service Schedule', community) +
    '<div class="loading-spinner" style="margin-top:40px">Loading schedules\u2026</div>';

  var schedules = [];
  var visits = [];

  try {
    schedules = await PortalAPI.apiFetch('/api/communities/' + encodeURIComponent(communityId) + '/service-schedules');
    if (!Array.isArray(schedules)) schedules = [];
  } catch (e) { schedules = []; }

  /* Fetch visits for the past 30 days */
  try {
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var from = new Date(today); from.setDate(today.getDate() - 30);
    var to = new Date(today); to.setDate(today.getDate() + 7);
    var fromStr = from.toISOString().slice(0, 10);
    var toStr   = to.toISOString().slice(0, 10);
    visits = await PortalAPI.apiFetch(
      '/api/communities/' + encodeURIComponent(communityId) + '/service-visits?from=' + fromStr + '&to=' + toStr
    );
    if (!Array.isArray(visits)) visits = [];
  } catch (e) { visits = []; }

  if (schedules.length === 0) {
    container.innerHTML = M.pageHeader('Service Schedule', community) +
      '<div class="portal-module"><div class="module-empty">No service schedules have been configured for this community.</div></div>';
    return;
  }

  /* Build schedule cards */
  var active   = schedules.filter(function(s) { return s.isActive; });
  var inactive = schedules.filter(function(s) { return !s.isActive; });

  function renderSchedCard(s) {
    var inSeason = isInSeason(s);
    var seasonBadge = inSeason
      ? '<span style="background:#d1fae5;color:#059669;font-size:10px;font-weight:600;border-radius:999px;padding:2px 8px;text-transform:uppercase">In Season</span>'
      : '<span style="background:#f3f4f6;color:#6b7280;font-size:10px;font-weight:600;border-radius:999px;padding:2px 8px;text-transform:uppercase">Off Season</span>';
    var next = nextOccurrence(s.dayOfWeek);

    /* Recent visits for this schedule */
    var schedVisits = visits.filter(function(v) { return v.scheduleId === s.id; })
      .sort(function(a, b) { return b.serviceDate.localeCompare(a.serviceDate); })
      .slice(0, 5);

    var visitsHtml = '';
    if (schedVisits.length > 0) {
      visitsHtml = '<div style="margin-top:14px"><div style="font-size:11px;font-weight:700;color:var(--gray-500);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Recent Visits</div>';
      schedVisits.forEach(function(v) {
        var d = v.serviceDate ? new Date(v.serviceDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
        var loggedBy = v.employeeSignOffName || '';
        visitsHtml += '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--gray-100);font-size:13px">' +
          '<span style="color:var(--gray-800)">' + esc(d) + '</span>' +
          (loggedBy ? '<span style="color:var(--gray-500);font-size:11px">' + esc(loggedBy) + '</span>' : '<span style="color:var(--teal-dark);font-size:11px;font-weight:500">Logged</span>') +
          '</div>';
      });
      visitsHtml += '</div>';
    } else {
      visitsHtml = '<div style="margin-top:14px;font-size:12px;color:var(--gray-400)">No visits logged recently.</div>';
    }

    return '<div class="portal-module" style="margin-bottom:16px">' +
      '<div class="pm-header">' +
        '<span class="pm-title">' + esc(DAY_NAMES[s.dayOfWeek] || 'Unknown') + 's</span>' +
        seasonBadge +
      '</div>' +
      '<div class="pm-body" style="padding:14px 16px">' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-bottom:4px">' +
          '<div><div style="font-size:11px;font-weight:600;color:var(--gray-400);text-transform:uppercase;margin-bottom:3px">Season</div><div style="font-size:13px;color:var(--gray-800)">' + esc(seasonStr(s)) + '</div></div>' +
          '<div><div style="font-size:11px;font-weight:600;color:var(--gray-400);text-transform:uppercase;margin-bottom:3px">Next Service</div><div style="font-size:13px;color:var(--gray-800)">' + esc(next) + '</div></div>' +
          (s.notes ? '<div><div style="font-size:11px;font-weight:600;color:var(--gray-400);text-transform:uppercase;margin-bottom:3px">Notes</div><div style="font-size:13px;color:var(--gray-800)">' + esc(s.notes) + '</div></div>' : '') +
        '</div>' +
        visitsHtml +
      '</div>' +
    '</div>';
  }

  var html = M.pageHeader('Service Schedule', community);

  if (active.length > 0) {
    html += active.map(renderSchedCard).join('');
  }

  if (inactive.length > 0) {
    html += '<div style="margin-top:24px"><div style="font-size:11px;font-weight:700;color:var(--gray-500);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px">Inactive Schedules</div>';
    html += inactive.map(renderSchedCard).join('');
    html += '</div>';
  }

  container.innerHTML = html;
});
