PortalRouter.register('invoices', async function(container) {
  var ctx = PortalState.getCommunityContext();
  var role = ctx.role;
  var community = ctx.activeCommunity;
  var M = PortalModules;

  if (!community) {
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

  container.innerHTML = M.pageHeader('Invoices', community) + '<div id="invoices-root"></div>';
  var root = container.querySelector('#invoices-root');

  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function formatDate(str) {
    if (!str) return '';
    var d = new Date(str + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function formatCurrency(val) {
    if (val == null) return '';
    return '$' + Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  async function loadInvoices() {
    root.innerHTML = '<div class="loading-spinner" style="margin-top:40px;">Loading invoices...</div>';
    try {
      var invoices = await PortalAPI.apiFetch('/api/invoices?communityId=' + encodeURIComponent(community.id));
      if (!Array.isArray(invoices)) invoices = [];
      renderTable(invoices);
    } catch (err) {
      console.error('Invoices load error:', err);
      root.innerHTML = '<div class="empty-state" style="margin-top:40px;"><p style="color:var(--red)">Failed to load invoices. <button class="module-view-all" onclick="PortalRouter.refresh()">Retry</button></p></div>';
    }
  }

  function renderTable(invoices) {
    if (invoices.length === 0) {
      root.innerHTML = `
        <div class="empty-state" style="margin-top:60px;text-align:center;">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--gray-300)" stroke-width="1.5" style="margin-bottom:12px">
            <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
          </svg>
          <p style="color:var(--gray-500);margin:0;">No invoices available for this community.</p>
        </div>`;
      return;
    }

    var html = '<div class="table-responsive"><table class="admin-table" style="width:100%;">';
    html += '<thead><tr>';
    html += '<th>Completion Date</th>';
    html += '<th>Contractor</th>';
    html += '<th>Service Type</th>';
    html += '<th>Attachment Target</th>';
    html += '<th>Cost</th>';
    html += '<th style="width:60px">PDF</th>';
    html += '</tr></thead><tbody>';

    invoices.forEach(function(inv) {
      var pdfIcon = inv.pdfObjectKey
        ? '<span title="PDF attached" style="color:var(--teal)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></span>'
        : '<span style="color:var(--gray-300)">\u2014</span>';
      html += '<tr class="inv-row" data-id="' + esc(inv.id) + '" style="cursor:pointer">';
      html += '<td>' + formatDate(inv.completionDate) + '</td>';
      html += '<td>' + esc(inv.contractor) + '</td>';
      html += '<td><span class="badge badge-teal">' + esc(inv.serviceType) + '</span></td>';
      html += '<td>' + (inv.attachmentLabel ? '<span style="font-size:13px;color:var(--gray-600)">' + esc(inv.attachmentLabel) + '</span>' : '<span style="color:var(--gray-300)">\u2014</span>') + '</td>';
      html += '<td style="font-weight:600">' + formatCurrency(inv.cost) + '</td>';
      html += '<td style="text-align:center">' + pdfIcon + '</td>';
      html += '</tr>';
    });

    html += '</tbody></table></div>';
    root.innerHTML = html;

    root.querySelectorAll('.inv-row').forEach(function(row) {
      row.addEventListener('click', function() {
        showInvoiceDetail(row.dataset.id);
      });
    });
  }

  async function showInvoiceDetail(id) {
    try {
      var invoice = await PortalAPI.apiFetch('/api/invoices/' + id);

      var existing = document.querySelector('.modal-overlay');
      if (existing) existing.remove();

      var overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal" style="max-width:520px">
          <div class="modal-header">
            <h3 class="modal-title">Invoice Details</h3>
            <button class="modal-close" id="inv-detail-close">&times;</button>
          </div>
          <div class="modal-body">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
              <div>
                <div style="font-size:12px;color:var(--gray-400);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Contractor</div>
                <div style="font-weight:600;color:var(--navy)">${esc(invoice.contractor)}</div>
              </div>
              <div>
                <div style="font-size:12px;color:var(--gray-400);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Completion Date</div>
                <div style="font-weight:600;color:var(--navy)">${formatDate(invoice.completionDate)}</div>
              </div>
              <div>
                <div style="font-size:12px;color:var(--gray-400);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Service Type</div>
                <div><span class="badge badge-teal">${esc(invoice.serviceType)}</span></div>
              </div>
              <div>
                <div style="font-size:12px;color:var(--gray-400);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Cost</div>
                <div style="font-size:20px;font-weight:700;color:var(--teal)">${formatCurrency(invoice.cost)}</div>
              </div>
            </div>
            ${invoice.attachmentLabel ? `
              <div style="margin-top:16px;padding:12px 16px;background:var(--gray-50);border-radius:8px;border:1px solid var(--gray-200)">
                <div style="font-size:12px;color:var(--gray-400);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Attachment Target</div>
                <div style="font-size:14px;font-weight:500;color:var(--navy)">${esc(invoice.attachmentLabel)}</div>
              </div>
            ` : ''}
            ${invoice.notes ? `
              <div style="margin-top:16px">
                <div style="font-size:12px;color:var(--gray-400);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Notes</div>
                <div style="color:var(--gray-700);white-space:pre-wrap">${esc(invoice.notes)}</div>
              </div>
            ` : ''}
            <div style="margin-top:16px">
              <div style="font-size:12px;color:var(--gray-400);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">PDF</div>
              ${invoice.pdfObjectKey
                ? '<a href="' + esc(invoice.pdfObjectKey) + '" target="_blank" class="btn btn-secondary btn-sm" style="margin-top:2px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;vertical-align:-2px"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>View / Download PDF</a>'
                : '<span style="color:var(--gray-400)">No PDF attached</span>'}
            </div>
          </div>
          <div class="modal-footer" style="padding:16px 24px;border-top:1px solid var(--gray-200);text-align:right">
            <button class="btn btn-ghost" id="inv-detail-done">Close</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      overlay.querySelector('#inv-detail-close').addEventListener('click', function() { overlay.remove(); });
      overlay.querySelector('#inv-detail-done').addEventListener('click', function() { overlay.remove(); });
      overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
    } catch (err) {
      PortalAPI.showToast(err.message || 'Failed to load invoice', 'error');
    }
  }

  loadInvoices();
});
