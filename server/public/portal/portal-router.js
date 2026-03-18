/* VRTSync Portal Router
 * Reads window.PORTAL_CONFIG.base to determine the URL base path.
 * Identical pattern to admin router.js — just configurable per portal.
 */
window.PortalRouter = (function () {
  const routes = {};
  let currentRoute = null;
  let currentParams = {};

  function getBase() {
    return (window.PORTAL_CONFIG && window.PORTAL_CONFIG.base) || '/web/portal';
  }

  function register(name, renderFn) {
    routes[name] = renderFn;
  }

  function navigate(routeName, pushState = true, params = {}) {
    currentParams = params;
    const base = getBase();
    let path = base + '/' + routeName;
    if (params.id) {
      path += '/' + params.id;
      if (params.tab) path += '/' + params.tab;
    }
    if (pushState) {
      history.pushState({ route: routeName, params }, '', path);
    }
    render(routeName, params);
  }

  function render(routeName, params) {
    if (typeof window._dashMapCleanup === 'function') {
      window._dashMapCleanup();
    }
    /* Stop any active SyncManager instances when navigating away */
    if (window._dashSyncManager) {
      window._dashSyncManager.stop();
      window._dashSyncManager = null;
    }
    if (window._dashSyncTicker) {
      clearInterval(window._dashSyncTicker);
      window._dashSyncTicker = null;
    }
    if (window._tasksSyncManager) {
      window._tasksSyncManager.stop();
      window._tasksSyncManager = null;
    }
    if (window._tasksSyncTicker) {
      clearInterval(window._tasksSyncTicker);
      window._tasksSyncTicker = null;
    }
    currentRoute = routeName;
    currentParams = params || {};
    const container = document.getElementById('page-content');
    if (!container) return;

    document.querySelectorAll('.nav-link[data-route]').forEach(link => {
      link.classList.toggle('active', link.dataset.route === routeName);
    });

    if (routes[routeName]) {
      container.innerHTML = '<div class="loading-spinner">Loading...</div>';
      try {
        Promise.resolve(routes[routeName](container, currentParams)).catch(err => {
          console.error('Page render error (async):', err);
          container.innerHTML = `<div class="empty-state"><p>Error loading page. Please refresh.</p></div>`;
        });
      } catch (err) {
        console.error('Page render error:', err);
        container.innerHTML = `<div class="empty-state"><p>Error loading page. Please refresh.</p></div>`;
      }
    } else {
      /* Generic coming-soon placeholder for unbuilt pages */
      container.innerHTML = `
        <div class="page-header"><h1>${capitalize(routeName.replace(/-/g, ' '))}</h1></div>
        <div class="empty-state" style="margin-top:60px;">
          <div style="font-size:40px;margin-bottom:16px;">🏗️</div>
          <h3 style="color:var(--navy);margin-bottom:8px;">Coming Soon</h3>
          <p style="color:var(--gray-500);">This section is being built.</p>
        </div>
      `;
    }
  }

  function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function getCurrentRoute() { return currentRoute; }
  function getParams() { return currentParams; }

  function init() {
    document.querySelectorAll('.nav-link[data-route]').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        navigate(link.dataset.route);
      });
    });

    window.addEventListener('popstate', (e) => {
      if (e.state) {
        render(e.state.route, e.state.params || {});
      } else {
        const parsed = parseRoute();
        render(parsed.route, parsed.params);
      }
    });
  }

  function parseRoute() {
    const base = getBase();
    const path = window.location.pathname;
    const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = path.match(new RegExp(escaped + '\\/?(.*)$'));
    const rest = (match && match[1]) || 'dashboard';
    const parts = rest.split('/').filter(Boolean);

    if (!parts.length) return { route: 'dashboard', params: {} };

    if (parts[1]) {
      return { route: parts[0], params: { id: parts[1], tab: parts[2] || 'overview' } };
    }

    return { route: parts[0] || 'dashboard', params: {} };
  }

  function getRouteFromPath() {
    const parsed = parseRoute();
    currentParams = parsed.params;
    return parsed.route;
  }

  function refresh() {
    if (currentRoute) {
      render(currentRoute, currentParams);
    }
  }

  return { register, navigate, render, refresh, init, getRouteFromPath, getCurrentRoute, getParams, parseRoute };
})();
