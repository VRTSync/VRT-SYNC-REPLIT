/**
 * PortfolioRouter — client-side router for the Branch Portfolio portal.
 * Mirrors the AdminRouter pattern.
 */
window.PortfolioRouter = (function () {
  const routes = {};
  let currentRoute = null;
  let currentParams = {};

  function register(name, renderFn) {
    routes[name] = renderFn;
  }

  function navigate(routeName, pushState, params) {
    if (pushState === undefined) pushState = true;
    if (params === undefined) params = {};
    currentParams = params;

    const base = '/web/portfolio/';
    let path = base + routeName;
    if (params.id) {
      path = base + routeName + '/' + params.id;
    }

    // Preserve ?org= query param for admin preview
    const search = window.location.search;
    if (pushState) {
      history.pushState({ route: routeName, params: params }, '', path + search);
    }
    render(routeName, params);
  }

  function render(routeName, params) {
    currentRoute = routeName;
    currentParams = params || {};
    const container = document.getElementById('page-content');
    if (!container) return;

    // Update nav active state
    document.querySelectorAll('.side-nav a[data-route]').forEach(function (link) {
      var activeRoute = routeName === 'water-savings-location' ? 'water-savings' : routeName;
      link.classList.toggle('active', link.dataset.route === activeRoute);
    });

    // Run any page-level teardown registered by the outgoing route (e.g. map ResizeObserver)
    if (typeof window._portfolioMapCleanup === 'function') {
      window._portfolioMapCleanup();
    }

    if (routes[routeName]) {
      container.innerHTML = '<div class="pf-spinner">Loading\u2026</div>';
      try {
        routes[routeName](container, currentParams);
      } catch (err) {
        console.error('[PortfolioRouter] Page render error:', err);
        container.innerHTML = '<div class="pf-empty"><p>Error loading page. Please refresh.</p></div>';
      }
    } else {
      container.innerHTML = '<div class="pf-empty"><p>Page not found.</p></div>';
    }
  }

  function init() {
    window.addEventListener('popstate', function (e) {
      if (e.state) {
        render(e.state.route, e.state.params || {});
      } else {
        var parsed = parseRoute();
        render(parsed.route, parsed.params);
      }
    });
  }

  function parseRoute() {
    var pathname = window.location.pathname;
    var match = pathname.match(/\/web\/portfolio\/?(.*)$/);
    var rest = (match && match[1]) || 'dashboard';
    var parts = rest.split('/').filter(Boolean);
    if (parts[0] && parts[1]) {
      return { route: parts[0], params: { id: parts[1] } };
    }
    return { route: parts[0] || 'dashboard', params: {} };
  }

  function getRouteFromPath() {
    var parsed = parseRoute();
    currentParams = parsed.params;
    return parsed.route;
  }

  function getCurrentRoute() { return currentRoute; }
  function getParams() { return currentParams; }

  return { register, navigate, render, init, parseRoute, getRouteFromPath, getCurrentRoute, getParams };
})();
