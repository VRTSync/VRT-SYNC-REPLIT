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

  function statCard({ icon, label, value, color, note }) {
    const c = color || 'var(--teal)';
    return `
      <div class="portal-stat-card">
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
  function listModule({ title, rows = [], emptyMsg, viewAllRoute, maxRows }) {
    const limit = maxRows || 6;
    const visible = rows.slice(0, limit);
    const body = visible.length > 0
      ? visible.map(r => taskRow(r)).join('')
      : `<div class="module-empty">${esc(emptyMsg || 'Nothing to show.')}</div>`;
    const viewAll = viewAllRoute
      ? `<button class="module-view-all" onclick="PortalRouter.navigate('${viewAllRoute}')">View all</button>`
      : '';
    return `
      <div class="portal-module">
        <div class="pm-header">
          <span class="pm-title">${esc(title)}</span>
          ${viewAll}
        </div>
        <div class="pm-body pm-body--list">${body}</div>
      </div>
    `;
  }

  function taskRow(task) {
    const cls = classifyTask(task);
    const priority = task.priority || 'low';
    const isHoa = task.origin === 'hoa_request' || task.origin === 'HOA';

    let badge = '';
    if (cls === 'overdue')  badge = `<span class="tr-badge tr-overdue">Overdue</span>`;
    else if (cls === 'active') badge = `<span class="tr-badge tr-active">Active</span>`;
    else if (task.status === 'submitted') badge = `<span class="tr-badge tr-new">New</span>`;
    else if (task.status === 'acknowledged') badge = `<span class="tr-badge tr-acked">Acked</span>`;
    else if (task.status === 'completed') badge = `<span class="tr-badge tr-done">Done</span>`;

    const window = fmtDateRange(task.windowStart, task.windowEnd);

    return `
      <div class="task-row">
        <span class="tr-dot" style="background:${PRIORITY_COLOR[priority] || '#6b7280'}"></span>
        <div class="tr-main">
          <span class="tr-title">${esc(task.title || 'Untitled')}</span>
          <div class="tr-meta">
            ${window ? `<span class="tr-window">${window}</span>` : ''}
            ${isHoa ? `<span class="tr-hoa-tag">HOA</span>` : ''}
          </div>
        </div>
        <div class="tr-right">${badge}</div>
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
    const name = community ? community.name : 'Community Map';
    const h = tall ? '340px' : '200px';
    return `
      <div class="portal-module portal-module--map" style="--map-h:${h}">
        <div class="pm-header">
          <span class="pm-title">Map</span>
          <button class="module-view-all" onclick="PortalRouter.navigate('map')">Open full map</button>
        </div>
        <div class="map-preview-body">
          <div class="map-preview-bg">
            ${_svg('<polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/>', 40)}
            <span class="map-preview-lbl">${esc(name)}</span>
          </div>
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
    listModule, taskRow,
    quickLinksModule,
    mapPreviewModule,
    notesModule,
    graphModule,
    classifyTask, fmtDate, fmtDateRange,
    PRIORITY_COLOR, STATUS_COLOR, STATUS_LABEL,
    ICONS, esc,
  };
})();
