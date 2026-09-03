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

    // Preserve only the admin-preview organization context. Other route filters
    // are opt-in so a group drill-down cannot leak into unrelated pages.
    const searchParams = new URLSearchParams();
    const currentSearch = new URLSearchParams(window.location.search);
    if (currentSearch.get('org')) searchParams.set('org', currentSearch.get('org'));
    if (params.group) searchParams.set('group', params.group);
    const search = searchParams.toString() ? '?' + searchParams.toString() : '';
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
    var params = {};
    var group = new URLSearchParams(window.location.search).get('group');
    if (group) params.group = group;
    if (parts[0] && parts[1]) {
      params.id = parts[1];
      return { route: parts[0], params: params };
    }
    return { route: parts[0] || 'dashboard', params: params };
  }

  function getRouteFromPath() {
    var parsed = parseRoute();
    currentParams = parsed.params;
    return parsed.route;
  }

  // Update the current route's query without rerendering or disturbing
  // page-local controls such as status and search filters.
  function replaceQuery(changes) {
    const searchParams = new URLSearchParams(window.location.search);
    Object.keys(changes || {}).forEach(function (key) {
      const value = changes[key];
      if (value == null || value === '') searchParams.delete(key);
      else searchParams.set(key, value);
    });
    const search = searchParams.toString() ? '?' + searchParams.toString() : '';
    currentParams = Object.assign({}, currentParams);
    if (Object.prototype.hasOwnProperty.call(changes || {}, 'group')) {
      if (changes.group == null || changes.group === '') delete currentParams.group;
      else currentParams.group = changes.group;
    }
    history.replaceState({ route: currentRoute, params: currentParams }, '', window.location.pathname + search);
  }

  function getCurrentRoute() { return currentRoute; }
  function getParams() { return currentParams; }

  return { register, navigate, render, init, parseRoute, getRouteFromPath, getCurrentRoute, getParams, replaceQuery };
})();
