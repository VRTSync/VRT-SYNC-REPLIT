/**
 * portfolio.js — Boot script for the Branch Portfolio portal.
 *
 * Branching logic:
 *   client_admin → GET /api/portfolio/me to bootstrap PortfolioState (no org param needed)
 *   admin        → reads ?org=<id> from URL
 *     - present  → GET /api/admin/organizations/:id/portfolio for bootstrap; stores organizationId
 *     - absent   → renders an org picker; no further dashboard fetch
 */
(function () {
  'use strict';

  // ── Module-level state ───────────────────────────────────────────────────
  /** @type {{ organization: object, branches: any[], groups: any[], organizationId: string|null, role: string } | null} */
  window.PortfolioState = null;

  var AUTO_REFRESH_MS = 60 * 1000; // 60 s
  var _lastRefreshTs  = Date.now();
  var _refreshTimer   = null;

  // ── Helpers ──────────────────────────────────────────────────────────────
  var esc = (window.VRTUtils && window.VRTUtils.esc) || function (v) { return v == null ? '' : String(v); };

  function apiUrl(path, orgId) {
    var sep = path.indexOf('?') >= 0 ? '&' : '?';
    return orgId ? (path + sep + 'organizationId=' + encodeURIComponent(orgId)) : path;
  }

  function apiFetch(url) {
    return fetch(url, { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + r.statusText);
      return r.json();
    });
  }

  function getOrgIdFromUrl() {
    var params = new URLSearchParams(window.location.search);
    return params.get('org') || null;
  }

  // ── Sidebar render ────────────────────────────────────────────────────────
  var NAV_ITEMS = [
    { route: 'dashboard',    label: 'Dashboard'     },
    { route: 'branches',     label: 'Branches'      },
    { route: 'map',          label: 'Portfolio Map' },
    { route: 'work-orders',  label: 'Work Orders'   },
  ];

  // Cache of pipeline awaiting-approval count for sidebar badge
  var _awaitingApprovalCount = 0;

  // Fetch work-order pipeline counts for the sidebar badge (non-blocking)
  function fetchWorkOrderBadge() {
    var orgSuffix = '';
    if (window.PortfolioState && window.PortfolioState.organizationId) {
      orgSuffix = '?organizationId=' + encodeURIComponent(window.PortfolioState.organizationId);
    }
    fetch('/api/portfolio/work-orders' + orgSuffix, { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.pipeline) return;
        var n = Number(data.pipeline.awaitingApproval || 0);
        if (n !== _awaitingApprovalCount) {
          _awaitingApprovalCount = n;
          // Re-render the nav badge without a full sidebar redraw
          var badge = document.getElementById('wo-nav-badge');
          if (badge) {
            badge.textContent = n > 0 ? String(n) : '';
            badge.style.display = n > 0 ? 'inline-block' : 'none';
          }
        }
      })
      .catch(function () { /* non-critical; ignore */ });
  }

  function renderSidebar(user) {
    // Org name
    var orgNameEl = document.getElementById('org-name-area');
    if (orgNameEl && window.PortfolioState && window.PortfolioState.organization) {
      orgNameEl.textContent = window.PortfolioState.organization.name || '';
    }

    // Admin preview badge
    var sideNoteEl = document.getElementById('side-note-area');
    if (window.PortfolioState && window.PortfolioState.role === 'admin') {
      if (sideNoteEl) {
        sideNoteEl.innerHTML = '<span class="admin-preview-badge">Admin Preview</span>';
      }
    } else if (sideNoteEl) {
      sideNoteEl.innerHTML = '';
    }

    // Nav links
    var navEl = document.getElementById('nav-links');
    if (navEl) {
      var search = window.location.search; // preserves ?org=... for admin
      navEl.innerHTML = NAV_ITEMS.map(function (item) {
        var badge = '';
        if (item.route === 'work-orders' && _awaitingApprovalCount > 0) {
          badge = ' <span id="wo-nav-badge" style="display:inline-block;background:var(--amber);color:var(--navy);border-radius:999px;font-size:10px;font-weight:700;padding:1px 7px;vertical-align:middle;margin-left:4px;">'
            + esc(_awaitingApprovalCount) + '</span>';
        } else if (item.route === 'work-orders') {
          badge = ' <span id="wo-nav-badge" style="display:none;background:var(--amber);color:var(--navy);border-radius:999px;font-size:10px;font-weight:700;padding:1px 7px;vertical-align:middle;margin-left:4px;"></span>';
        }
        return '<a href="/web/portfolio/' + item.route + search
          + '" data-route="' + esc(item.route) + '" class="nav-link">'
          + esc(item.label) + badge + '</a>';
      }).join('');

      navEl.querySelectorAll('a[data-route]').forEach(function (a) {
        a.addEventListener('click', function (e) {
          e.preventDefault();
          PortfolioRouter.navigate(a.dataset.route, true, {});
        });
      });
    }

    // User block
    var userDisplay = document.getElementById('user-display');
    var userAvatar  = document.getElementById('user-avatar');
    var userRole    = document.getElementById('user-role-label');
    if (user) {
      var name = user.displayName || user.username || '';
      if (userDisplay) userDisplay.textContent = name;
      if (userAvatar)  userAvatar.textContent  = name ? name.charAt(0).toUpperCase() : '?';
      if (userRole)    userRole.textContent     = user.role === 'admin' ? 'Admin (preview)' : 'Client Admin';
    }

    // Make the user block interactive (popup menu)
    var sideUser = document.getElementById('side-user');
    if (sideUser) {
      // Wrap content in a button
      var userBtn = document.getElementById('user-menu-btn');
      if (!userBtn) {
        sideUser.style.cursor = 'pointer';
        sideUser.setAttribute('role', 'button');
        sideUser.setAttribute('aria-haspopup', 'true');
        sideUser.setAttribute('aria-expanded', 'false');
        sideUser.setAttribute('tabindex', '0');
        sideUser.id = 'side-user'; // keep id

        // Create popup menu if it doesn't exist
        if (!document.getElementById('user-popup-menu')) {
          var menu = document.createElement('div');
          menu.id = 'user-popup-menu';
          menu.className = 'user-popup-menu';
          menu.setAttribute('role', 'menu');
          menu.innerHTML =
            '<button class="upm-item" id="upm-account" role="menuitem">Account</button>' +
            '<button class="upm-item upm-signout" id="upm-signout" role="menuitem">Sign out</button>';
          sideUser.style.position = 'relative';
          sideUser.appendChild(menu);

          // Account nav
          document.getElementById('upm-account').addEventListener('click', function (e) {
            e.stopPropagation();
            closeUserMenu();
            var search = window.location.search;
            history.pushState({ route: 'account', params: {} }, '', '/web/portfolio/account' + search);
            PortfolioRouter.render('account', {});
          });

          // Sign out
          var signOutBtn = document.getElementById('upm-signout');
          signOutBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            signOutBtn.disabled = true;
            signOutBtn.textContent = 'Signing out…';
            fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
              .then(function () { window.location.replace('/web/login'); })
              .catch(function () { window.location.replace('/web/login'); });
          });
        }

        function openUserMenu() {
          var m = document.getElementById('user-popup-menu');
          if (m) m.classList.add('open');
          sideUser.setAttribute('aria-expanded', 'true');
        }
        function closeUserMenu() {
          var m = document.getElementById('user-popup-menu');
          if (m) m.classList.remove('open');
          sideUser.setAttribute('aria-expanded', 'false');
        }
        function toggleUserMenu() {
          var m = document.getElementById('user-popup-menu');
          if (m && m.classList.contains('open')) { closeUserMenu(); } else { openUserMenu(); }
        }

        // Expose closeUserMenu globally for use by the account page
        window._portfolioCloseUserMenu = closeUserMenu;

        sideUser.addEventListener('click', function (e) {
          // Don't toggle if click originated inside menu buttons (handled above)
          if (e.target.closest && e.target.closest('.user-popup-menu')) return;
          toggleUserMenu();
        });

        sideUser.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleUserMenu(); }
          if (e.key === 'Escape') { closeUserMenu(); }
        });

        document.addEventListener('keydown', function (e) {
          if (e.key === 'Escape') { closeUserMenu(); }
        });

        document.addEventListener('click', function (e) {
          var m = document.getElementById('user-popup-menu');
          if (m && m.classList.contains('open') && !sideUser.contains(e.target)) {
            closeUserMenu();
          }
        });
      }
    }
  }

  // ── Org picker (admin with no ?org= param) ────────────────────────────────
  function renderOrgPicker() {
    var container = document.getElementById('page-content');
    container.innerHTML = '<div class="pf-spinner">Loading organizations\u2026</div>';

    apiFetch('/api/admin/organizations').then(function (orgs) {
      var rows = '';
      if (Array.isArray(orgs) && orgs.length > 0) {
        rows = orgs.map(function (org) {
          return '<a class="org-item" href="/web/portfolio/dashboard?org=' + esc(org.id) + '">'
            + '<div><div class="oi-name">' + esc(org.name) + '</div>'
            + '<div class="oi-meta">' + esc(org.slug || '') + '</div></div>'
            + '<span class="oi-arrow">›</span></a>';
        }).join('');
      } else {
        rows = '<p style="color:var(--gray-400);font-size:13px;">No organizations found.</p>';
      }

      container.innerHTML = '<div class="org-picker">'
        + '<h2>Select an Organization</h2>'
        + '<p>You are previewing the Branch Portfolio as an admin. Choose an organization to open its portfolio dashboard.</p>'
        + '<div class="org-list">' + rows + '</div></div>';

      // Hide nav since there's no org context
      var navEl = document.getElementById('nav-links');
      if (navEl) navEl.innerHTML = '';
      var orgNameEl = document.getElementById('org-name-area');
      if (orgNameEl) orgNameEl.textContent = '';
    }).catch(function (err) {
      console.error('[portfolio] org picker fetch failed:', err);
      container.innerHTML = '<div class="pf-empty">Failed to load organizations. Please refresh.</div>';
    });
  }

  // ── Refresh label ─────────────────────────────────────────────────────────
  function updateRefreshLabel() {
    var el = document.getElementById('pf-refresh-label');
    if (!el) return;
    var elapsedMs  = Date.now() - _lastRefreshTs;
    var elapsedMin = Math.floor(elapsedMs / 60000);
    el.textContent = elapsedMin < 1 ? 'updated just now' : 'updated ' + elapsedMin + 'm ago';
  }

  function scheduleAutoRefresh() {
    if (_refreshTimer) clearInterval(_refreshTimer);
    _refreshTimer = setInterval(function () {
      updateRefreshLabel();
      // Re-dispatch the current route to refresh data
      var route  = PortfolioRouter.getCurrentRoute();
      var params = PortfolioRouter.getParams();
      if (route) {
        _lastRefreshTs = Date.now();
        PortfolioRouter.render(route, params);
      }
    }, AUTO_REFRESH_MS);

    // Update the label every 30 s for display accuracy
    setInterval(updateRefreshLabel, 30000);
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    // 1. Verify session + role
    fetch('/api/auth/me', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        var user = data && data.user;
        var role = user && user.role;

        if (!role || (role !== 'client_admin' && role !== 'admin')) {
          window.location.href = '/web/login';
          return;
        }

        if (role === 'admin') {
          var orgId = getOrgIdFromUrl();
          if (!orgId) {
            // Admin, no ?org= → show org picker; render sidebar without org context
            renderSidebar(user);
            renderOrgPicker();
            return;
          }

          // Admin with ?org= → bootstrap from admin endpoint
          apiFetch('/api/admin/organizations/' + encodeURIComponent(orgId) + '/portfolio')
            .then(function (portfolioData) {
              window.PortfolioState = {
                organization:   portfolioData.organization || {},
                branches:       portfolioData.branches     || [],
                groups:         portfolioData.groups       || [],
                organizationId: orgId,
                role:           'admin',
              };
              renderSidebar(user);
              PortfolioRouter.init();
              scheduleAutoRefresh();
              fetchWorkOrderBadge();
              var route = PortfolioRouter.getRouteFromPath();
              PortfolioRouter.navigate(route, false, PortfolioRouter.getParams());
            })
            .catch(function (err) {
              console.error('[portfolio] admin bootstrap failed:', err);
              var container = document.getElementById('page-content');
              if (container) {
                container.innerHTML = '<div class="pf-empty">Failed to load organization data. Check the org ID in the URL.</div>';
              }
            });
        } else {
          // client_admin → use /api/portfolio/me
          apiFetch('/api/portfolio/me')
            .then(function (portfolioData) {
              window.PortfolioState = {
                organization:   portfolioData.organization || {},
                branches:       portfolioData.branches     || [],
                groups:         portfolioData.groups       || [],
                organizationId: null, // client_admin: server uses session
                role:           'client_admin',
              };
              renderSidebar(user);
              PortfolioRouter.init();
              scheduleAutoRefresh();
              fetchWorkOrderBadge();
              var route = PortfolioRouter.getRouteFromPath();
              PortfolioRouter.navigate(route, false, PortfolioRouter.getParams());
            })
            .catch(function (err) {
              console.error('[portfolio] client_admin bootstrap failed:', err);
              var container = document.getElementById('page-content');
              if (container) {
                container.innerHTML = '<div class="pf-empty">Failed to load portfolio data. Please contact your administrator.</div>';
              }
            });
        }
      })
      .catch(function (err) {
        console.error('[portfolio] /api/auth/me failed:', err);
        window.location.href = '/web/login';
      });
  });

  // Guard against bfcache restoring a stale authenticated page after logout.
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) window.location.reload();
  });
})();
