AdminRouter.register('reports', async function(container) {
  var { apiFetch, showToast } = AdminAPI;
  var communities = AdminState.getCommunities();
  var user = AdminState.getUser();

  var selectedCommunityId = communities.length === 1 ? communities[0].id : '';
  var activeReport = null;

  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function formatCurrency(val) {
    if (val == null) return '$0.00';
    return '$' + Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function monthName(m) {
    return ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m] || '';
  }

  function renderShell() {
    container.innerHTML = `
      <div class="page-header">
        <h1>Reports</h1>
      </div>
      <div class="card" style="margin-bottom:20px;padding:16px 20px">
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
          <label style="font-size:13px;font-weight:600;color:var(--gray-700)">Community:</label>
          <select id="rpt-community-select" class="form-select" style="max-width:260px">
            <option value="">Select community...</option>
            ${communities.map(c => '<option value="' + c.id + '"' + (c.id === selectedCommunityId ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('')}
          </select>
        </div>
      </div>
      <div id="rpt-body"></div>
    `;

    document.getElementById('rpt-community-select').addEventListener('change', function() {
      selectedCommunityId = this.value;
      activeReport = null;
      renderReportBody();
    });

    renderReportBody();
  }

  function renderReportBody() {
    var body = document.getElementById('rpt-body');
    if (!selectedCommunityId) {
      body.innerHTML = '<div class="empty-state" style="margin-top:40px;"><p style="color:var(--gray-500)">Select a community to view reports.</p></div>';
      return;
    }

    if (!activeReport) {
      renderLanding(body);
    } else if (activeReport === 'water-usage') {
      renderWaterUsageReport(body);
    } else if (activeReport === 'tree-inventory') {
      renderTreeInventoryReport(body);
    } else if (activeReport === 'monthly-invoice') {
      renderMonthlyInvoiceReport(body);
    }
  }

  function renderLanding(body) {
    var communityName = (communities.find(c => c.id === selectedCommunityId) || {}).name || '';
    body.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:20px">
        ${reportCard('water-usage', 'Water Usage',
          '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" stroke-width="1.5"><path d="M12 2C6 8 4 12 4 15a8 8 0 0016 0c0-3-2-7-8-13z"/></svg>',
          'Monthly water consumption trend by usage amount.',
          'var(--blue)')}
        ${reportCard('tree-inventory', 'Tree Inventory',
          '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="1.5"><path d="M12 22V12"/><path d="M5 12l7-10 7 10"/><path d="M3 18l9-6 9 6"/></svg>',
          'Summary of tree counts grouped by species.',
          'var(--green)')}
        ${reportCard('monthly-invoice', 'Monthly Invoice',
          '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" stroke-width="1.5"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>',
          'Invoice summary grouped by service type for a selected month.',
          'var(--teal)')}
      </div>
    `;

    body.querySelectorAll('.rpt-card').forEach(function(card) {
      card.addEventListener('click', function() {
        activeReport = card.dataset.report;
        renderReportBody();
      });
    });
  }

  function reportCard(id, title, iconHtml, desc, color) {
    return `
      <div class="rpt-card card" data-report="${id}" style="padding:28px 24px;cursor:pointer;border-top:3px solid ${esc(color)};transition:all 0.2s ease;">
        <div style="margin-bottom:14px">${iconHtml}</div>
        <div style="font-size:16px;font-weight:700;color:var(--navy);margin-bottom:6px">${esc(title)}</div>
        <div style="font-size:13px;color:var(--gray-500);line-height:1.5">${esc(desc)}</div>
        <div style="margin-top:16px">
          <span class="btn btn-secondary btn-sm">View Report →</span>
        </div>
      </div>
    `;
  }

  function backBtn() {
    return '<button class="btn btn-ghost btn-sm" id="rpt-back-btn" style="margin-bottom:20px">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;vertical-align:-2px"><polyline points="15 18 9 12 15 6"/></svg>' +
      'Back to Reports</button>';
  }

  /* ── Water Usage Report ─────────────────────────────────────────────── */
  async function renderWaterUsageReport(body) {
    body.innerHTML = backBtn() + '<div class="loading-spinner">Loading...</div>';
    document.getElementById('rpt-back-btn').addEventListener('click', function() { activeReport = null; renderReportBody(); });

    try {
      var rows = await apiFetch('/api/reports/water-usage?communityId=' + encodeURIComponent(selectedCommunityId));
      if (!Array.isArray(rows)) rows = [];

      var csvBtn = rows.length > 0
        ? '<button class="btn btn-secondary btn-sm" id="rpt-wu-csv">Export CSV</button>'
        : '';

      var chartHtml = '';
      if (rows.length === 0) {
        chartHtml = '<div class="empty-state" style="margin-top:20px;"><p style="color:var(--gray-500)">No water usage data recorded yet.</p></div>';
      } else {
        var sorted = rows.slice().sort(function(a, b) {
          if (a.year !== b.year) return a.year - b.year;
          return a.month - b.month;
        });
        var maxAmt = Math.max.apply(null, sorted.map(function(r) { return r.usage_amount; }));
        chartHtml = '<div style="overflow-x:auto;margin-top:8px"><div style="display:flex;align-items:flex-end;gap:10px;min-width:' + (sorted.length * 60) + 'px;height:180px;padding-bottom:28px;position:relative">';
        sorted.forEach(function(row) {
          var pct = maxAmt > 0 ? (row.usage_amount / maxAmt) : 0;
          var barH = Math.round(pct * 140);
          var label = monthName(row.month).slice(0, 3) + ' ' + String(row.year).slice(2);
          chartHtml += '<div style="display:flex;flex-direction:column;align-items:center;flex:1;min-width:44px">' +
            '<div title="' + esc(row.usage_amount.toLocaleString()) + ' ' + esc(row.unit) + '" style="width:100%;background:var(--blue);border-radius:4px 4px 0 0;height:' + barH + 'px;min-height:4px;transition:height 0.3s;cursor:default"></div>' +
            '<div style="font-size:10px;color:var(--gray-500);margin-top:6px;white-space:nowrap">' + esc(label) + '</div>' +
            '</div>';
        });
        chartHtml += '</div></div>';

        chartHtml += '<div class="table-container" style="margin-top:20px"><table><thead><tr><th>Month</th><th>Year</th><th>Usage</th><th>Unit</th><th>Notes</th></tr></thead><tbody>';
        sorted.slice().reverse().forEach(function(row) {
          chartHtml += '<tr><td>' + esc(monthName(row.month)) + '</td><td>' + esc(row.year) + '</td><td style="font-weight:600">' + esc(row.usage_amount.toLocaleString()) + '</td><td>' + esc(row.unit) + '</td><td style="color:var(--gray-500)">' + esc(row.notes || '') + '</td></tr>';
        });
        chartHtml += '</tbody></table></div>';
      }

      body.innerHTML = backBtn() +
        '<div class="page-header" style="margin-bottom:16px"><h2>Water Usage Report</h2>' +
        '<div style="display:flex;gap:8px">' + csvBtn + '</div></div>' +
        '<div class="card" style="padding:20px">' + chartHtml + '</div>';

      document.getElementById('rpt-back-btn').addEventListener('click', function() { activeReport = null; renderReportBody(); });

      if (rows.length > 0) {
        document.getElementById('rpt-wu-csv').addEventListener('click', function() {
          var csv = 'Month,Year,Usage Amount,Unit,Notes\n';
          rows.forEach(function(r) {
            csv += [monthName(r.month), r.year, r.usage_amount, r.unit, r.notes || ''].map(function(v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(',') + '\n';
          });
          downloadCsv(csv, 'water-usage-report.csv');
        });
      }
    } catch (err) {
      body.innerHTML = backBtn() + '<div class="empty-state"><p style="color:var(--red)">Failed to load report: ' + esc(err.message) + '</p></div>';
      document.getElementById('rpt-back-btn').addEventListener('click', function() { activeReport = null; renderReportBody(); });
    }
  }

  /* ── Tree Inventory Report ──────────────────────────────────────────── */
  async function renderTreeInventoryReport(body) {
    body.innerHTML = backBtn() + '<div class="loading-spinner">Loading...</div>';
    document.getElementById('rpt-back-btn').addEventListener('click', function() { activeReport = null; renderReportBody(); });

    try {
      var data = await apiFetch('/api/reports/tree-inventory?communityId=' + encodeURIComponent(selectedCommunityId));
      var groups = data.groups || [];
      var total = data.total || 0;

      var csvBtn = groups.length > 0
        ? '<button class="btn btn-secondary btn-sm" id="rpt-ti-csv">Export CSV</button>'
        : '';

      var bodyHtml = '';
      if (groups.length === 0) {
        bodyHtml = '<div class="empty-state" style="margin-top:20px;"><p style="color:var(--gray-500)">No trees recorded for this community.</p></div>';
      } else {
        var maxCount = Math.max.apply(null, groups.map(function(g) { return g.count; }));
        bodyHtml = '<div style="display:flex;gap:8px;align-items:center;margin-bottom:16px">' +
          '<div class="stat-card teal" style="padding:16px 20px;min-width:120px;text-align:center">' +
          '<div class="stat-label">Total Trees</div><div class="stat-value">' + total + '</div></div>' +
          '<div class="stat-card" style="padding:16px 20px;min-width:120px;text-align:center">' +
          '<div class="stat-label">Species</div><div class="stat-value">' + groups.filter(function(g) { return g.species; }).length + '</div></div>' +
          '</div>';

        bodyHtml += '<div class="table-container"><table><thead><tr><th>Species</th><th>Count</th><th style="width:300px">Distribution</th></tr></thead><tbody>';
        groups.forEach(function(g) {
          var pct = maxCount > 0 ? Math.round((g.count / maxCount) * 100) : 0;
          var speciesLabel = g.species || '<span style="color:var(--gray-400);font-style:italic">Unspecified</span>';
          bodyHtml += '<tr>' +
            '<td>' + (g.species ? esc(g.species) : '<span style="color:var(--gray-400);font-style:italic">Unspecified</span>') + '</td>' +
            '<td style="font-weight:600">' + g.count + '</td>' +
            '<td><div style="display:flex;align-items:center;gap:8px">' +
            '<div style="flex:1;height:8px;background:var(--gray-100);border-radius:4px;overflow:hidden">' +
            '<div style="width:' + pct + '%;height:100%;background:var(--green);border-radius:4px;"></div>' +
            '</div><span style="font-size:12px;color:var(--gray-500);min-width:40px">' + Math.round((g.count / total) * 100) + '%</span>' +
            '</div></td>' +
            '</tr>';
        });
        bodyHtml += '</tbody></table></div>';
      }

      body.innerHTML = backBtn() +
        '<div class="page-header" style="margin-bottom:16px"><h2>Tree Inventory Report</h2>' +
        '<div style="display:flex;gap:8px">' + csvBtn + '</div></div>' +
        '<div class="card" style="padding:20px">' + bodyHtml + '</div>';

      document.getElementById('rpt-back-btn').addEventListener('click', function() { activeReport = null; renderReportBody(); });

      if (groups.length > 0) {
        document.getElementById('rpt-ti-csv').addEventListener('click', function() {
          var csv = 'Species,Count,Percentage\n';
          groups.forEach(function(g) {
            var pct = total > 0 ? ((g.count / total) * 100).toFixed(1) : '0.0';
            csv += [g.species || 'Unspecified', g.count, pct + '%'].map(function(v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(',') + '\n';
          });
          downloadCsv(csv, 'tree-inventory-report.csv');
        });
      }
    } catch (err) {
      body.innerHTML = backBtn() + '<div class="empty-state"><p style="color:var(--red)">Failed to load report: ' + esc(err.message) + '</p></div>';
      document.getElementById('rpt-back-btn').addEventListener('click', function() { activeReport = null; renderReportBody(); });
    }
  }

  /* ── Monthly Invoice Report ─────────────────────────────────────────── */
  function renderMonthlyInvoiceReport(body) {
    var now = new Date();
    var selMonth = now.getMonth() + 1;
    var selYear = now.getFullYear();

    function renderControls() {
      var yearOpts = '';
      for (var y = selYear; y >= selYear - 3; y--) {
        yearOpts += '<option value="' + y + '"' + (y === selYear ? ' selected' : '') + '>' + y + '</option>';
      }
      var monthOpts = '';
      for (var m = 1; m <= 12; m++) {
        monthOpts += '<option value="' + m + '"' + (m === selMonth ? ' selected' : '') + '>' + monthName(m) + '</option>';
      }
      return '<div class="card" style="padding:16px 20px;margin-bottom:20px"><div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">' +
        '<label style="font-size:13px;font-weight:600;color:var(--gray-700)">Month:</label>' +
        '<select id="rpt-mi-month" class="form-select" style="max-width:160px">' + monthOpts + '</select>' +
        '<label style="font-size:13px;font-weight:600;color:var(--gray-700)">Year:</label>' +
        '<select id="rpt-mi-year" class="form-select" style="max-width:100px">' + yearOpts + '</select>' +
        '<button class="btn btn-primary btn-sm" id="rpt-mi-load">View Report</button>' +
        '</div></div>';
    }

    body.innerHTML = backBtn() +
      '<div class="page-header" style="margin-bottom:16px"><h2>Monthly Invoice Report</h2><div id="rpt-mi-actions" style="display:flex;gap:8px"></div></div>' +
      renderControls() +
      '<div id="rpt-mi-results"></div>';

    document.getElementById('rpt-back-btn').addEventListener('click', function() { activeReport = null; renderReportBody(); });

    function bindControls() {
      document.getElementById('rpt-mi-month').addEventListener('change', function() { selMonth = parseInt(this.value, 10); });
      document.getElementById('rpt-mi-year').addEventListener('change', function() { selYear = parseInt(this.value, 10); });
      document.getElementById('rpt-mi-load').addEventListener('click', loadMonthlyData);
    }

    bindControls();
    loadMonthlyData();

    async function loadMonthlyData() {
      var results = document.getElementById('rpt-mi-results');
      results.innerHTML = '<div class="loading-spinner">Loading...</div>';
      document.getElementById('rpt-mi-actions').innerHTML = '';

      try {
        var data = await apiFetch('/api/reports/invoices/monthly?communityId=' + encodeURIComponent(selectedCommunityId) + '&month=' + selMonth + '&year=' + selYear);
        var groups = data.groups || [];
        var total = data.total || 0;

        if (groups.length === 0) {
          results.innerHTML = '<div class="empty-state" style="margin-top:20px;"><p style="color:var(--gray-500)">No invoices for ' + monthName(selMonth) + ' ' + selYear + '.</p></div>';
          return;
        }

        var html = '';
        groups.forEach(function(g) {
          html += '<div style="margin-bottom:20px">';
          html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">' +
            '<span style="font-size:14px;font-weight:700;color:var(--navy)">' + esc(g.serviceType) + '</span>' +
            '<span style="font-size:13px;font-weight:600;color:var(--teal-dark)">' + formatCurrency(g.subtotal) + '</span>' +
            '</div>';
          html += '<div class="table-container"><table><thead><tr><th>Date</th><th>Contractor</th><th>Notes</th><th>Cost</th><th style="width:50px">PDF</th></tr></thead><tbody>';
          g.invoices.forEach(function(inv) {
            var dateStr = inv.completionDate ? new Date(inv.completionDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
            var pdfCell = inv.pdfObjectKey
              ? '<a href="' + esc(inv.pdfObjectKey) + '" target="_blank" style="color:var(--teal)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></a>'
              : '<span style="color:var(--gray-300)">—</span>';
            html += '<tr><td>' + esc(dateStr) + '</td><td>' + esc(inv.contractor) + '</td><td style="color:var(--gray-500);font-size:13px">' + esc(inv.notes || '') + '</td><td style="font-weight:600">' + formatCurrency(inv.cost) + '</td><td style="text-align:center">' + pdfCell + '</td></tr>';
          });
          html += '</tbody></table></div></div>';
        });

        html += '<div class="card" style="padding:16px 20px;margin-top:8px;background:var(--navy);border-color:var(--navy)">' +
          '<div style="display:flex;justify-content:space-between;align-items:center">' +
          '<span style="font-size:14px;font-weight:700;color:rgba(255,255,255,0.7)">Total — ' + monthName(selMonth) + ' ' + selYear + '</span>' +
          '<span style="font-size:22px;font-weight:700;color:var(--teal)">' + formatCurrency(total) + '</span>' +
          '</div></div>';

        results.innerHTML = html;

        document.getElementById('rpt-mi-actions').innerHTML =
          '<button class="btn btn-secondary btn-sm" id="rpt-mi-csv">Export CSV</button>' +
          '<button class="btn btn-secondary btn-sm" id="rpt-mi-print">Print / PDF</button>';

        document.getElementById('rpt-mi-csv').addEventListener('click', function() {
          var csv = 'Service Type,Date,Contractor,Notes,Cost\n';
          groups.forEach(function(g) {
            g.invoices.forEach(function(inv) {
              var dateStr = inv.completionDate ? new Date(inv.completionDate + 'T00:00:00').toLocaleDateString('en-US') : '';
              csv += [g.serviceType, dateStr, inv.contractor, inv.notes || '', inv.cost].map(function(v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(',') + '\n';
            });
          });
          csv += '\n"TOTAL","","","","' + total.toFixed(2) + '"\n';
          downloadCsv(csv, 'invoice-report-' + selYear + '-' + String(selMonth).padStart(2, '0') + '.csv');
        });

        document.getElementById('rpt-mi-print').addEventListener('click', function() { window.print(); });

      } catch (err) {
        results.innerHTML = '<div class="empty-state"><p style="color:var(--red)">Failed to load report: ' + esc(err.message) + '</p></div>';
      }
    }
  }

  /* ── CSV download helper ─────────────────────────────────────────────── */
  function downloadCsv(csv, filename) {
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  renderShell();
});
