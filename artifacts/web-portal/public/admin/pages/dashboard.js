AdminRouter.register('dashboard', async function(container) {
  const { apiFetchWithRetry } = AdminAPI;
  const esc = VRTUtils.esc;

  const breadcrumb = document.getElementById('breadcrumb-area');
  if (breadcrumb) breadcrumb.innerHTML = '';

  // ── Formatters ────────────────────────────────────────────────────────────
  function fmtNum(n) {
    if (n == null || isNaN(n)) return '—';
    n = Number(n);
    if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (Math.abs(n) >= 100_000) return (n / 1_000).toFixed(0) + 'k';
    return n.toLocaleString();
  }

  function fmtCents(cents) {
    if (cents == null || isNaN(cents)) return '—';
    const dollars = Number(cents) / 100;
    if (Math.abs(dollars) >= 1_000_000) return '$' + (dollars / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'M';
    if (Math.abs(dollars) >= 1_000) return '$' + (dollars / 1_000).toFixed(0) + 'k';
    return '$' + dollars.toFixed(2);
  }

  function fmtDaysAgo(days) {
    if (days == null) return null;
    if (days < 1) return 'today';
    if (days === 1) return '1d ago';
    return days + 'd ago';
  }

  function fmtMinsAgo(ts) {
    const mins = Math.floor((Date.now() - ts) / 60_000);
    if (mins < 1) return 'just now';
    if (mins === 1) return '1m ago';
    return mins + 'm ago';
  }

  // ── Initial scaffold (skeleton while loading) ──────────────────────────────
  container.innerHTML = `
    <div class="dash-header-row">
      <h1 class="dash-title">Platform Dashboard</h1>
      <div class="dash-header-right">
        <div class="dash-search-wrap">
          <input type="text" id="dash-search" class="form-input dash-search-input" placeholder="Search communities…" />
        </div>
        <span class="dash-updated-label" id="dash-updated-label"></span>
      </div>
    </div>

    <div class="dash-kpi-row" id="dash-kpi-row">
      ${[0,1,2,3].map(() => `<div class="dash-kpi-tile dash-skeleton"><div class="dash-skel-line" style="width:60px;height:32px"></div><div class="dash-skel-line" style="width:100px;margin-top:8px;height:14px"></div></div>`).join('')}
    </div>

    <div class="dash-exception-row" id="dash-exception-row">
      ${[0,1,2,3].map(() => `<div class="dash-exception-card dash-skeleton"><div class="dash-skel-line" style="width:28px;height:28px;margin-bottom:6px"></div><div class="dash-skel-line" style="width:50px;height:24px"></div><div class="dash-skel-line" style="width:120px;margin-top:6px;height:12px"></div></div>`).join('')}
    </div>

    <div class="dash-columns" id="dash-columns">
      <div class="dash-col-left">
        <div class="dash-panel" id="dash-activity-panel">
          <div class="dash-panel-title">Platform Activity</div>
          <div class="loading-spinner" style="padding:40px 0">Loading…</div>
        </div>
        <div class="dash-panel" id="dash-reliability-panel">
          <div class="dash-panel-title">Service Reliability</div>
          <div class="loading-spinner" style="padding:20px 0">Loading…</div>
        </div>
      </div>
      <div class="dash-col-right">
        <div class="dash-panel" id="dash-business-panel">
          <div class="dash-panel-title">Business</div>
          <div class="loading-spinner" style="padding:20px 0">Loading…</div>
        </div>
        <div class="dash-panel" id="dash-completeness-panel">
          <div class="dash-panel-title">Mapping Completeness</div>
          <div class="loading-spinner" style="padding:20px 0">Loading…</div>
        </div>
        <div class="dash-panel" id="dash-users-panel">
          <div class="dash-panel-title">Platform Users</div>
          <div class="loading-spinner" style="padding:20px 0">Loading…</div>
        </div>
        <div class="dash-panel" id="dash-migrations-panel">
          <div class="dash-panel-title">Migrations</div>
          <div class="loading-spinner" style="padding:20px 0">Loading…</div>
        </div>
      </div>
    </div>
  `;

  // Search: navigate to communities and pass the query via router params so
  // communities.js can read it synchronously before its first await (no race condition).
  const searchInput = document.getElementById('dash-search');
  if (searchInput) {
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const q = searchInput.value.trim();
        AdminRouter.navigate('communities', true, q ? { q } : {});
      }
    });
  }

  // ── Render helpers ─────────────────────────────────────────────────────────

  function renderKPI(data) {
    const kpiRow = document.getElementById('dash-kpi-row');
    if (!kpiRow) return;
    const t = data.totals || {};
    const tiles = [
      {
        label: 'Communities',
        value: t.communities,
        sub: t.communitiesAddedThisMonth != null ? '+' + fmtNum(t.communitiesAddedThisMonth) + ' this month' : null,
        color: 'blue',
        route: 'communities',
      },
      {
        label: 'Active Assets',
        value: t.activeAssets,
        sub: t.assetsAddedThisMonth != null ? '+' + fmtNum(t.assetsAddedThisMonth) + ' this month' : null,
        color: 'teal',
        route: 'communities',
        // TODO: add filter param for assets on communities page once deep-link to asset view is supported
      },
      {
        label: 'Incomplete Assets',
        value: t.incompleteAssets,
        sub: t.completenessPct != null ? Math.round(t.completenessPct) + '% platform complete' : null,
        color: 'amber',
        route: 'communities',
        // TODO: add filter param for incomplete assets once deep-link is supported
      },
      {
        label: 'Map Layers',
        value: t.mapLayers,
        sub: t.communitiesOnboarding != null ? fmtNum(t.communitiesOnboarding) + ' onboarding' : null,
        color: 'purple',
        route: 'communities',
        // TODO: add filter param for map layers once deep-link to layer view is supported
      },
    ];

    kpiRow.innerHTML = tiles.map((tile, i) => `
      <div class="dash-kpi-tile dash-kpi-${esc(tile.color)}" data-tile-idx="${i}" style="cursor:pointer" role="button" tabindex="0">
        <div class="dash-kpi-value">${fmtNum(tile.value)}</div>
        <div class="dash-kpi-label">${esc(tile.label)}</div>
        ${tile.sub ? `<div class="dash-kpi-sub">${esc(tile.sub)}</div>` : ''}
      </div>
    `).join('');

    kpiRow.querySelectorAll('.dash-kpi-tile').forEach((el) => {
      const idx = parseInt(el.dataset.tileIdx, 10);
      const tile = tiles[idx];
      el.addEventListener('click', () => AdminRouter.navigate(tile.route));
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') AdminRouter.navigate(tile.route); });
    });
  }

  function renderExceptions(data) {
    const row = document.getElementById('dash-exception-row');
    if (!row) return;
    const ex = data.exceptions || {};

    // requestsUnacknowledged48h is { count, oldestDays }
    const unackReq = ex.requestsUnacknowledged48h || {};
    const unackCount = typeof unackReq === 'object' ? unackReq.count : unackReq;
    const unackOldestDays = typeof unackReq === 'object' ? unackReq.oldestDays : null;

    const cards = [
      {
        label: 'Overdue Work',
        value: ex.communitiesWithOverdueWork,
        sub: null,
        icon: '⚠️',
        color: 'red',
        route: 'communities',
        // TODO: add filter param for communities with overdue work on the communities page
      },
      {
        label: 'Unacknowledged Requests',
        value: unackCount,
        sub: unackOldestDays != null ? 'oldest ' + fmtDaysAgo(unackOldestDays) : null,
        icon: '📬',
        color: 'amber',
        route: 'communities',
        // TODO: add filter param for unacknowledged requests on the communities page
      },
      {
        label: 'Quiet Communities',
        value: ex.communitiesQuiet14d,
        sub: '>14d without activity',
        icon: '🔇',
        color: 'navy',
        route: 'communities',
        // TODO: add filter param for quiet communities on the communities page
      },
      {
        label: 'Onboarding Stalled',
        value: ex.onboardingStalled30d,
        sub: null,
        icon: '🚧',
        color: 'gray',
        route: 'communities',
        // TODO: add filter param for stalled onboarding on the communities page
      },
    ];

    row.innerHTML = cards.map((card, i) => `
      <div class="dash-exception-card dash-exc-${esc(card.color)}" data-exc-idx="${i}" style="cursor:pointer" role="button" tabindex="0">
        <div class="dash-exc-icon">${card.icon}</div>
        <div class="dash-exc-value">${fmtNum(card.value)}</div>
        <div class="dash-exc-label">${esc(card.label)}</div>
        ${card.sub ? `<div class="dash-exc-sub">${esc(card.sub)}</div>` : ''}
      </div>
    `).join('');

    row.querySelectorAll('.dash-exception-card').forEach((el) => {
      const idx = parseInt(el.dataset.excIdx, 10);
      const card = cards[idx];
      el.addEventListener('click', () => AdminRouter.navigate(card.route));
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') AdminRouter.navigate(card.route); });
    });
  }

  function renderActivityChart(data) {
    const panel = document.getElementById('dash-activity-panel');
    if (!panel) return;
    // activityTrend: [ { isoWeek: "2026-W24", completedCount: N, openCount: N } ]
    const trend = Array.isArray(data.activityTrend) ? data.activityTrend : [];
    const maxTotal = trend.reduce((m, w) => Math.max(m, (w.completedCount || 0) + (w.openCount || 0)), 1);

    function weekLabel(isoWeek) {
      // isoWeek format: "2026-W24" — show just the week number for brevity
      if (!isoWeek) return '';
      const parts = isoWeek.split('-W');
      return parts[1] ? 'W' + parts[1] : isoWeek;
    }

    const barsHtml = trend.map(w => {
      const completedPct = Math.round(((w.completedCount || 0) / maxTotal) * 100);
      const openPct = Math.round(((w.openCount || 0) / maxTotal) * 100);
      return `
        <div class="dash-bar-col">
          <div class="dash-bar-stack">
            <div class="dash-bar-segment dash-bar-open" style="height:${openPct}%" title="${esc(String(w.openCount || 0))} still open"></div>
            <div class="dash-bar-segment dash-bar-completed" style="height:${completedPct}%" title="${esc(String(w.completedCount || 0))} completed"></div>
          </div>
          <div class="dash-bar-label">${esc(weekLabel(w.isoWeek))}</div>
        </div>
      `;
    }).join('');

    panel.innerHTML = `
      <div class="dash-panel-title">Platform Activity
        <span class="dash-panel-legend">
          <span class="dash-legend-dot dash-legend-completed"></span>Completed
          <span class="dash-legend-dot dash-legend-open" style="margin-left:8px"></span>Still open
        </span>
      </div>
      <div class="dash-bar-chart">
        ${barsHtml || '<div class="text-muted text-sm" style="padding:24px 0;text-align:center">No activity data</div>'}
      </div>
    `;
  }

  function renderReliability(data) {
    const panel = document.getElementById('dash-reliability-panel');
    if (!panel) return;
    const rel = data.reliability || {};

    // Lines whose value is null are hidden entirely.
    // photoProofPct30d is already 0–100 (a percentage, not a 0–1 fraction).
    const lines = [
      { label: 'On-time service rate (30d)', value: rel.onTimeServicePct30d, format: v => Number(v).toFixed(1) + '%' },
      { label: 'Missed services (30d)', value: rel.missedServices30d, format: v => fmtNum(v) },
      { label: 'Photo proof rate (30d)', value: rel.photoProofPct30d, format: v => Number(v).toFixed(1) + '%' },
    ].filter(l => l.value != null);

    panel.innerHTML = `
      <div class="dash-panel-title">Service Reliability</div>
      ${lines.length === 0
        ? '<div class="text-muted text-sm" style="padding:8px 0">Reliability metrics not yet available</div>'
        : lines.map(l => `
          <div class="dash-stat-line">
            <span class="dash-stat-label">${esc(l.label)}</span>
            <span class="dash-stat-value">${esc(l.format(l.value))}</span>
          </div>
        `).join('')}
    `;
  }

  function renderBusiness(data) {
    const panel = document.getElementById('dash-business-panel');
    if (!panel) return;
    const biz = data.business || {};

    // null values are hidden
    const lines = [
      { label: 'Invoiced this month', value: biz.invoicedThisMonthCents, format: fmtCents },
      { label: 'Unpaid over 30d', value: biz.unpaidOver30dCents, format: fmtCents },
      { label: 'Unpaid invoices (count)', value: biz.unpaidOver30dCount, format: fmtNum },
      { label: 'Contracts expiring (60d)', value: biz.contractsExpiring60d, format: fmtNum },
      { label: 'Expired & unrenewed', value: biz.contractsExpiredUnrenewed, format: fmtNum },
    ].filter(l => l.value != null);

    panel.innerHTML = `
      <div class="dash-panel-title">Business</div>
      ${lines.length === 0
        ? '<div class="text-muted text-sm" style="padding:8px 0">No business data available</div>'
        : lines.map(l => `
          <div class="dash-stat-line">
            <span class="dash-stat-label">${esc(l.label)}</span>
            <span class="dash-stat-value">${esc(l.format(l.value))}</span>
          </div>
        `).join('')}
    `;
  }

  function renderCompleteness(data) {
    const panel = document.getElementById('dash-completeness-panel');
    if (!panel) return;
    // completenessDistribution is an object: { pct98to100, pct90to98, pct70to90, pctBelow70 }
    const d = data.completenessDistribution || {};
    const buckets = [
      { label: '98–100%', value: d.pct98to100, color: 'teal' },
      { label: '90–98%',  value: d.pct90to98,  color: 'blue' },
      { label: '70–90%',  value: d.pct70to90,  color: 'amber' },
      { label: '<70%',    value: d.pctBelow70,  color: 'red' },
    ];
    const hasAny = buckets.some(b => b.value != null);
    const maxVal = buckets.reduce((m, b) => Math.max(m, b.value || 0), 1);

    panel.innerHTML = `
      <div class="dash-panel-title">Mapping Completeness</div>
      ${!hasAny
        ? '<div class="text-muted text-sm" style="padding:8px 0">No completeness data</div>'
        : buckets.map(b => {
            const pct = Math.round(((b.value || 0) / maxVal) * 100);
            return `
              <div class="dash-dist-row">
                <div class="dash-dist-label">${esc(b.label)}</div>
                <div class="dash-dist-track">
                  <div class="dash-dist-bar dash-dist-${esc(b.color)}" style="width:${pct}%"></div>
                </div>
                <div class="dash-dist-count">${fmtNum(b.value)}</div>
              </div>
            `;
          }).join('')}
    `;
  }

  function renderUsers(data) {
    const panel = document.getElementById('dash-users-panel');
    if (!panel) return;
    const u = data.users || {};

    // null values are hidden
    const lines = [
      { label: 'Active users (30d)', value: u.active30d, format: fmtNum },
      { label: 'Active contractors (7d)', value: u.contractorsActive7d, format: fmtNum },
      { label: 'HOA members added (month)', value: u.hoaMembersAddedThisMonth, format: fmtNum },
    ].filter(l => l.value != null);

    panel.innerHTML = `
      <div class="dash-panel-title">Platform Users</div>
      ${lines.length === 0
        ? '<div class="text-muted text-sm" style="padding:8px 0">User activity data not yet available</div>'
        : lines.map(l => `
          <div class="dash-stat-line">
            <span class="dash-stat-label">${esc(l.label)}</span>
            <span class="dash-stat-value">${esc(l.format(l.value))}</span>
          </div>
        `).join('')}
    `;
  }

  function renderMigrations(mig) {
    const panel = document.getElementById('dash-migrations-panel');
    if (!panel) return;

    if (!mig) {
      panel.innerHTML = `
        <div class="dash-panel-title">Migrations</div>
        <div class="text-muted text-sm" style="padding:8px 0">Migration status unavailable</div>
      `;
      return;
    }

    const appliedCount = Array.isArray(mig.applied) ? mig.applied.length : 0;
    const pendingCount = Array.isArray(mig.pending) ? mig.pending.length : 0;
    const driftCount = Array.isArray(mig.drift) ? mig.drift.length : 0;
    const inSync = !!mig.inSync;

    const statusBadge = inSync
      ? `<span style="color:var(--green);font-weight:600">✓ In sync</span>`
      : `<span style="color:var(--red);font-weight:600">⚠ Out of sync</span>`;

    const pendingLines = pendingCount > 0
      ? mig.pending.map(tag => `
          <div class="dash-stat-line" style="padding-left:12px">
            <span class="dash-stat-label" style="color:var(--red);font-size:12px">↳ ${esc(tag)}</span>
          </div>
        `).join('')
      : '';

    const driftLines = driftCount > 0
      ? mig.drift.map(d => `
          <div class="dash-stat-line" style="padding-left:12px">
            <span class="dash-stat-label" style="color:var(--amber);font-size:12px">↳ unknown row id=${esc(String(d.id))}</span>
          </div>
        `).join('')
      : '';

    panel.innerHTML = `
      <div class="dash-panel-title">Migrations</div>
      <div class="dash-stat-line">
        <span class="dash-stat-label">Status</span>
        <span class="dash-stat-value">${statusBadge}</span>
      </div>
      <div class="dash-stat-line">
        <span class="dash-stat-label">Applied</span>
        <span class="dash-stat-value">${esc(String(appliedCount))}</span>
      </div>
      <div class="dash-stat-line">
        <span class="dash-stat-label">Pending</span>
        <span class="dash-stat-value" style="${pendingCount > 0 ? 'color:var(--red);font-weight:600' : ''}">${esc(String(pendingCount))}</span>
      </div>
      ${pendingLines}
      ${driftCount > 0 ? `
      <div class="dash-stat-line">
        <span class="dash-stat-label">Drift rows</span>
        <span class="dash-stat-value" style="color:var(--amber);font-weight:600">${esc(String(driftCount))}</span>
      </div>
      ${driftLines}` : ''}
    `;
  }

  function renderData(data) {
    renderKPI(data);
    renderExceptions(data);
    renderActivityChart(data);
    renderReliability(data);
    renderBusiness(data);
    renderCompleteness(data);
    renderUsers(data);
  }

  function showError(message) {
    const kpiRow = document.getElementById('dash-kpi-row');
    const excRow = document.getElementById('dash-exception-row');
    const cols = document.getElementById('dash-columns');
    if (kpiRow) kpiRow.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 2rem;">
        <p style="color: var(--gray-500); margin-bottom: 1rem;">${esc(message)}</p>
        <button id="dash-retry-btn" class="btn btn-primary">Retry</button>
      </div>
    `;
    if (excRow) excRow.innerHTML = '';
    if (cols) cols.innerHTML = '';
    const retryBtn = document.getElementById('dash-retry-btn');
    if (retryBtn) retryBtn.addEventListener('click', () => loadDashboard());
  }

  // ── Main load + auto-refresh ────────────────────────────────────────────────
  // Use a module-level interval ref so repeated visits never stack up pollers.
  // Keyed on the window object to survive hot-reload in development.
  if (window.__dashInterval) {
    clearInterval(window.__dashInterval);
    window.__dashInterval = null;
  }

  let lastFetch = null;

  function updateAgeLabel() {
    const label = document.getElementById('dash-updated-label');
    if (label && lastFetch) {
      label.textContent = 'updated ' + fmtMinsAgo(lastFetch);
    }
  }

  async function loadDashboard() {
    try {
      const [data, migData] = await Promise.all([
        apiFetchWithRetry('/api/admin/dashboard'),
        apiFetchWithRetry('/api/admin/migrations').catch(() => null),
      ]);
      lastFetch = Date.now();
      renderData(data);
      renderMigrations(migData);
      updateAgeLabel();

      // Start auto-refresh; clear any prior interval first (defensive)
      if (window.__dashInterval) clearInterval(window.__dashInterval);
      window.__dashInterval = setInterval(() => {
        // Stop polling whenever the user has navigated away from the dashboard
        if (AdminRouter.getCurrentRoute() !== 'dashboard') {
          clearInterval(window.__dashInterval);
          window.__dashInterval = null;
          return;
        }
        updateAgeLabel();
        Promise.all([
          apiFetchWithRetry('/api/admin/dashboard'),
          apiFetchWithRetry('/api/admin/migrations').catch(() => null),
        ]).then(([freshData, freshMig]) => {
          if (AdminRouter.getCurrentRoute() !== 'dashboard') return;
          lastFetch = Date.now();
          renderData(freshData);
          renderMigrations(freshMig);
          updateAgeLabel();
        }).catch(() => {
          // Silent fail on background refresh — keep showing stale data
        });
      }, 60_000);
    } catch (err) {
      const message = err.isTimeout
        ? 'The request timed out. The server may be busy.'
        : (err.message || 'Could not connect to the server.');
      showError(message);
    }
  }

  await loadDashboard();
});
