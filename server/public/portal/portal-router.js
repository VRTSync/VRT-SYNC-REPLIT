window.PortalRouter = (function() {
  const routes = {};
  let currentRoute = null;
  let currentParams = {};
  const BASE = '/web/portal';

  function register(name, renderFn) {
    routes[name] = renderFn;
  }

  function navigate(routeName, pushState = true, params = {}) {
    currentParams = params;
    let path = BASE + '/' + routeName;
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
    currentRoute = routeName;
    currentParams = params || {};
    const container = document.getElementById('page-content');

    document.querySelectorAll('.nav-link').forEach(link => {
      link.classList.toggle('active', link.dataset.route === routeName);
    });

    if (routes[routeName]) {
      container.innerHTML = '<div class="loading-spinner">Loading...</div>';
      try {
        routes[routeName](container, currentParams);
      } catch (err) {
        console.error('Page render error:', err);
        container.innerHTML = `<div class="empty-state"><p>Error loading page</p></div>`;
      }
    } else {
      container.innerHTML = `<div class="empty-state"><p>Page not found: ${routeName}</p></div>`;
    }
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
    const path = window.location.pathname;
    const match = path.match(/\/web\/portal\/?(.*)$/);
    const rest = (match && match[1]) || 'dashboard';
    const parts = rest.split('/').filter(Boolean);

    if (!parts.length || parts[0] === '') return { route: 'dashboard', params: {} };

    if (parts[1]) {
      return { route: parts[0], params: { id: parts[1], tab: parts[2] || 'overview' } };
    }

    return { route: parts[0], params: {} };
  }

  function getRouteFromPath() {
    const parsed = parseRoute();
    currentParams = parsed.params;
    return parsed.route;
  }

  return { register, navigate, render, init, getRouteFromPath, getCurrentRoute, getParams, parseRoute };
})();
