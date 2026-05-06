/* VRTSync Portal — Shared Dashboard Module System
 *
 * All functions return HTML strings.
 * Pages call these to compose their layouts.
 * PortalModules is available globally in all portal shells.
 */
window.PortalModules = (function () {

  /* ─── Priority / status maps ─────────────────────────────────────────── */
  const PRIORITY_COLOR = {
    low: '#10b981', medium: '#f59e0b', high: '#ef4444', urgent: '#9c27b0',
  };
  const STATUS_COLOR = {
    pending: '#6b7280', in_progress: '#3b82f6', completed: '#10b981',
    submitted: '#f59e0b', acknowledged: '#8b5cf6',
  };
  const STATUS_LABEL = {
    pending: 'Pending', in_progress: 'In Progress', completed: 'Completed',
    submitted: 'Submitted', acknowledged: 'Acknowledged',
  };

  /* ─── Ticket type bucketing ──────────────────────────────────────────── */
  function getTicketTypeBucket(ticketType) {
    if (!ticketType) return { label: 'Other', bg: '#f3f4f6', color: '#6b7280' };
    var t = ticketType.toLowerCase();
    if (t.includes('request') || t.includes('hoa') || t.includes('complaint')) {
      return { label: 'Request', bg: '#ede7f6', color: '#6a1b9a' };
    }
    if (t.includes('schedule') || t.includes('recurring') || t.includes('mow') || t.includes('irrigation')) {
      return { label: 'Scheduled', bg: '#e3f2fd', color: '#1565c0' };
    }
    if (t.includes('manual') || t.includes('ad-hoc') || t.includes('adhoc')) {
      return { label: 'Manual', bg: '#fff3e0', color: '#e65100' };
    }
    return { label: 'Other', bg: '#f3f4f6', color: '#6b7280' };
  }

  /* ─── Date helpers ───────────────────────────────────────────────────── */
  function localToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function parseDay(str) {
    if (!str) return null;
    return new Date(str + 'T00:00:00');
  }

  function classifyTask(task) {
    if (task.status === 'completed') return 'completed';
    const t = localToday();
    const ws = parseDay(task.windowStart);
    const we = parseDay(task.windowEnd);
    if (ws && we) {
      if (t > we) return 'overdue';
      if (t >= ws && t <= we) return 'active';
      if (t < ws) return 'upcoming';
    }
    return 'other';
  }

  function fmtDate(str) {
    if (!str) return '';
    const d = parseDay(str);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function fmtDateRange(ws, we) {
    if (!ws) return '';
    if (!we || we === ws) return fmtDate(ws);
    return fmtDate(ws) + ' – ' + fmtDate(we);
  }

  /* ─── HTML escaping ──────────────────────────────────────────────────── */
  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ─── Icon micro-helpers ─────────────────────────────────────────────── */
  function _svg(d, size) {
    return `<svg width="${size||16}" height="${size||16}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  }
  const ICONS = {
    check:    () => _svg('<polyline points="20 6 9 17 4 12"/>'),
    alert:    () => _svg('<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'),
    inbox:    () => _svg('<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/>'),
    done:     () => _svg('<path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'),
    map:      () => _svg('<polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/>'),
    task:     () => _svg('<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>'),
    calendar: () => _svg('<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'),
    file:     () => _svg('<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>'),
    dollar:   () => _svg('<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>'),
    bar:      () => _svg('<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/>'),
    users:    () => _svg('<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>'),
    pen:      () => _svg('<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>'),
  };

  /* ═══════════════════════════════════════════════════════════════════════
   * MODULE: Page Header
   * ══════════════════════════════════════════════════════════════════════ */
  function pageHeader(title, community) {
    const communityLine = community
      ? `<div class="pph-community">
           <span class="pph-community-name">${esc(community.name)}</span>
           ${community.address ? `<span class="pph-sep">·</span><span class="pph-address">${esc(community.address)}</span>` : ''}
         </div>`
      : '';
    return `
      <div class="portal-page-header">
        ${communityLine}
        <h1 class="pph-title">${esc(title)}</h1>
      </div>
    `;
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * MODULE: Stats Row
   * ══════════════════════════════════════════════════════════════════════ */
  function statsRow(cards) {
    return `<div class="portal-stats-row">${cards.map(c => statCard(c)).join('')}</div>`;
  }

  function statCard({ icon, label, value, color, note, extraClass }) {
    const c = color || 'var(--teal)';
    const cls = extraClass ? ' ' + extraClass : '';
    return `
      <div class="portal-stat-card${cls}">
        <div class="psc-icon" style="background:${c}18;color:${c}">${icon || ''}</div>
        <div class="psc-body">
          <div class="psc-value">${value != null ? value : '—'}</div>
          <div class="psc-label">${esc(label)}</div>
          ${note ? `<div class="psc-note">${esc(note)}</div>` : ''}
        </div>
      </div>
    `;
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * MODULE: List Module (tasks, requests, invoices, etc.)
   * ══════════════════════════════════════════════════════════════════════ */
  function listModule({ title, rows = [], emptyMsg, viewAllRoute, maxRows, extraClass }) {
    const limit = maxRows || 6;
    const visible = rows.slice(0, limit);
    const body = visible.length > 0
      ? visible.map(r => taskRow(r)).join('')
      : `<div class="module-empty">${esc(emptyMsg || 'Nothing to show.')}</div>`;
    const viewAll = viewAllRoute
      ? `<button class="module-view-all" onclick="PortalRouter.navigate('${viewAllRoute}')">View all</button>`
      : '';
    const cls = extraClass ? ' ' + extraClass : '';
    return `
      <div class="portal-module${cls}">
        <div class="pm-header">
          <span class="pm-title">${esc(title)}</span>
          ${viewAll}
        </div>
        <div class="pm-body pm-body--list">${body}</div>
      </div>
    `;
  }

  function taskRow(task, opts) {
    var priority = task.priority || 'low';
    var isHoa = task.origin === 'hoa_request' || task.origin === 'HOA';
    var cls = classifyTask(task);
    var isOverdue = cls === 'overdue';
    var role = (opts && opts.role) || '';

    var typeBucket = isHoa ? { label: 'Request', bg: '#ede7f6', color: '#6a1b9a' } : getTicketTypeBucket(task.ticketType);
    var typeBadge = `<span class="tr-type-badge" style="background:${typeBucket.bg};color:${typeBucket.color}">${esc(typeBucket.label)}</span>`;

    var statusBadge = '';
    if (isHoa) {
      if (task.status === 'submitted') statusBadge = `<span class="tr-badge tr-new">Submitted</span>`;
      else if (task.status === 'acknowledged') statusBadge = `<span class="tr-badge tr-acked">Acknowledged</span>`;
      else if (task.status === 'in_progress') statusBadge = `<span class="tr-badge tr-active">In Progress</span>`;
      else if (task.status === 'completed') statusBadge = `<span class="tr-badge tr-done">Completed</span>`;
      else statusBadge = `<span class="tr-badge tr-new">${esc(task.status || 'Submitted')}</span>`;
    } else {
      if (isOverdue) statusBadge = `<span class="tr-badge tr-overdue">Overdue</span>`;
      else if (cls === 'active') statusBadge = `<span class="tr-badge tr-active">Active</span>`;
      else if (task.status === 'submitted') statusBadge = `<span class="tr-badge tr-new">New</span>`;
      else if (task.status === 'acknowledged') statusBadge = `<span class="tr-badge tr-acked">Acked</span>`;
      else if (task.status === 'completed') statusBadge = `<span class="tr-badge tr-done">Done</span>`;
    }

    var window = fmtDateRange(task.windowStart, task.windowEnd);

    var snippet = '';
    if (task.description) {
      var desc = String(task.description);
      if (desc.length > 90) desc = desc.substring(0, 90) + '\u2026';
      snippet = `<div class="tr-snippet">${esc(desc)}</div>`;
    }

    var chips = '';
    if (window) chips += `<span class="tr-window">${esc(window)}</span>`;
    if (task.address) chips += `<span class="tr-chip tr-chip--loc"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg> ${esc(task.address)}</span>`;
    if (task.assignedToName) chips += `<span class="tr-chip tr-chip--person"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> ${esc(task.assignedToName)}</span>`;
    if (isHoa && !task.assignedToName) chips += `<span class="tr-hoa-tag">HOA</span>`;

    var actionBtn = '';
    if (task.status !== 'completed') {
      if (isHoa && task.status === 'submitted') {
        actionBtn = `<button class="tr-action-btn tr-action-btn--ack" data-action="acknowledge" data-task-id="${esc(task.id)}">Acknowledge</button>`;
      } else {
        actionBtn = `<button class="tr-action-btn" data-action="view" data-task-id="${esc(task.id)}">View Detail</button>`;
      }
    }

    var accentStyle = isOverdue && !isHoa ? 'border-left:3px solid #dc2626;' : (isHoa ? 'border-left:3px solid #7c3aed;' : '');

    return `
      <div class="task-row" data-task-id="${esc(task.id)}" style="cursor:pointer;${accentStyle}">
        <span class="tr-dot" style="background:${PRIORITY_COLOR[priority] || '#6b7280'}"></span>
        <div class="tr-main">
          <div class="tr-title-row">
            <span class="tr-title">${esc(task.title || 'Untitled')}</span>
            ${typeBadge}
          </div>
          ${snippet}
          <div class="tr-meta">
            ${chips}
          </div>
        </div>
        <div class="tr-right">
          ${statusBadge}
          ${actionBtn}
        </div>
      </div>
    `;
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * MODULE: PM Task Card (property manager oversight view)
   * ══════════════════════════════════════════════════════════════════════ */
  function pmTaskCard(task, opts) {
    opts = opts || {};
    const priority = task.priority || 'low';
    const isRequest = task.origin === 'hoa_request' || task.origin === 'HOA';
    const cls = classifyTask(task);
    const isOverdue = cls === 'overdue';

    let statusBadge = '';
    if (isRequest) {
      if (task.status === 'submitted') statusBadge = `<span class="tr-badge tr-new">Open</span>`;
      else if (task.status === 'acknowledged') statusBadge = `<span class="tr-badge tr-acked">Acknowledged</span>`;
      else if (task.status === 'in_progress') statusBadge = `<span class="tr-badge tr-active">In Progress</span>`;
      else if (task.status === 'completed') statusBadge = `<span class="tr-badge tr-done">Completed</span>`;
      else statusBadge = `<span class="tr-badge tr-new">${esc(task.status || 'Open')}</span>`;
    } else {
      if (isOverdue) statusBadge = `<span class="tr-badge tr-overdue">Overdue</span>`;
      else if (cls === 'active') statusBadge = `<span class="tr-badge tr-active">Active</span>`;
      else if (task.status === 'completed') statusBadge = `<span class="tr-badge tr-done">Completed</span>`;
      else if (cls === 'upcoming') statusBadge = `<span class="tr-badge tr-upcoming">Upcoming</span>`;
      else statusBadge = `<span class="tr-badge tr-new">${esc(task.status || 'Pending')}</span>`;
    }

    const typeTag = isRequest
      ? `<span class="pm-card-type pm-card-type--request">Request</span>`
      : `<span class="pm-card-type pm-card-type--task">Task</span>`;

    const dateRange = fmtDateRange(task.windowStart, task.windowEnd);
    const communityName = opts.showCommunity && task.communityName ? `<span class="pm-card-meta-item pm-card-community">${esc(task.communityName)}</span>` : '';
    const contractorName = task.assignedToName || task.assignedTo
      ? `<span class="pm-card-meta-item pm-card-contractor"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>${esc(task.assignedToName || task.assignedTo)}</span>`
      : `<span class="pm-card-meta-item pm-card-contractor pm-card-contractor--unassigned">Unassigned</span>`;
    const location = task.address ? `<span class="pm-card-meta-item pm-card-location"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>${esc(task.address)}</span>` : '';

    const overdueClass = isOverdue ? ' pm-card--overdue' : '';

    return `
      <div class="pm-task-card${overdueClass}" data-task-id="${esc(task.id)}">
        <div class="pm-card-header">
          <span class="pm-card-dot" style="background:${PRIORITY_COLOR[priority] || '#6b7280'}"></span>
          <div class="pm-card-title-wrap">
            ${typeTag}
            <span class="pm-card-title">${esc(task.title || 'Untitled')}</span>
          </div>
          <div class="pm-card-badges">
            ${statusBadge}
          </div>
        </div>
        <div class="pm-card-meta">
          ${communityName}
          ${contractorName}
          ${dateRange ? `<span class="pm-card-meta-item pm-card-date"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>${dateRange}</span>` : ''}
          ${location}
        </div>
        <div class="pm-card-actions">
          <button class="pm-card-action-btn pm-card-open-btn" data-action="open" data-task-id="${esc(task.id)}">Open Detail</button>
          <button class="pm-card-action-btn pm-card-map-btn" data-action="map" data-task-id="${esc(task.id)}" data-lat="${esc(task.pinLat || '')}" data-lng="${esc(task.pinLng || '')}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>
            View on Map
          </button>
        </div>
      </div>
    `;
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * MODULE: Quick Links
   * ══════════════════════════════════════════════════════════════════════ */
  function quickLinksModule({ title, links = [] }) {
    const items = links.map(l => {
      const action = l.route ? `PortalRouter.navigate('${l.route}')` : (l.action || '');
      return `
        <button class="ql-item" onclick="${action}" ${!action ? 'disabled' : ''}>
          <span class="ql-icon">${l.icon || ''}</span>
          <span class="ql-label">${esc(l.label)}</span>
        </button>
      `;
    }).join('');
    return `
      <div class="portal-module portal-module--links">
        <div class="pm-header"><span class="pm-title">${esc(title)}</span></div>
        <div class="ql-grid">${items}</div>
      </div>
    `;
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * MODULE: Map Preview (placeholder — real embed in later slice)
   * ══════════════════════════════════════════════════════════════════════ */
  function mapPreviewModule({ community, tall }) {
    const h = tall ? '340px' : '200px';
    return `
      <div class="portal-module portal-module--map" style="--map-h:${h}">
        <div class="pm-header">
          <span class="pm-title">Map</span>
          <button class="module-view-all" onclick="PortalRouter.navigate('map')">Open full map</button>
        </div>
        <div class="map-preview-body">
          <iframe id="dash-map-iframe" src="/leaflet-map.html" class="map-preview-iframe" tabindex="-1" aria-hidden="true"></iframe>
        </div>
      </div>
    `;
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * MODULE: Notes (placeholder)
   * ══════════════════════════════════════════════════════════════════════ */
  function notesModule({ title, hint } = {}) {
    return `
      <div class="portal-module portal-module--notes">
        <div class="pm-header"><span class="pm-title">${esc(title || 'Contractor Notes')}</span></div>
        <div class="pm-body" style="padding:24px 0;text-align:center">
          <div style="color:var(--gray-300);margin-bottom:10px">${ICONS.pen()}</div>
          <p style="font-size:13px;color:var(--gray-400)">${esc(hint || 'Field notes for this community will appear here.')}</p>
        </div>
      </div>
    `;
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * MODULE: Graph / Chart (placeholder)
   * ══════════════════════════════════════════════════════════════════════ */
  function graphModule({ title, hint } = {}) {
    return `
      <div class="portal-module portal-module--graph">
        <div class="pm-header"><span class="pm-title">${esc(title || 'Water Usage')}</span></div>
        <div class="graph-placeholder">
          <div style="color:var(--gray-300);margin-bottom:12px">${_svg('<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/>', 28)}</div>
          <p>${esc(hint || 'Water usage data coming in a future update.')}</p>
        </div>
      </div>
    `;
  }

  /* Public exports */
  return {
    pageHeader, statsRow, statCard,
    listModule, taskRow, pmTaskCard,
    quickLinksModule,
    mapPreviewModule,
    notesModule,
    graphModule,
    classifyTask, fmtDate, fmtDateRange,
    PRIORITY_COLOR, STATUS_COLOR, STATUS_LABEL,
    ICONS, esc,
  };
})();
