window.AdminRouter = (function() {
  const routes = {};
  let currentRoute = null;
  let currentParams = {};

  function register(name, renderFn) {
    routes[name] = renderFn;
  }

  function navigate(routeName, pushState = true, params = {}) {
    currentParams = params;
    let path = '/web/admin/' + routeName;
    if (params.id) {
      path = '/web/admin/' + routeName + '/' + params.id;
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
      container.innerHTML = `<div class="empty-state"><p>Page not found</p></div>`;
    }
  }

  function getCurrentRoute() {
    return currentRoute;
  }

  function getParams() {
    return currentParams;
  }

  function init() {
    document.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const route = link.dataset.route;
        navigate(route);
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
    const match = path.match(/\/web\/admin\/?(.*)$/);
    const rest = (match && match[1]) || 'dashboard';
    const parts = rest.split('/').filter(Boolean);

    if (parts[0] === 'community' && parts[1]) {
      return {
        route: 'community-detail',
        params: { id: parts[1], tab: parts[2] || 'overview' }
      };
    }

    return { route: parts[0] || 'dashboard', params: {} };
  }

  function getRouteFromPath() {
    const parsed = parseRoute();
    currentParams = parsed.params;
    return parsed.route;
  }

  return { register, navigate, render, init, getRouteFromPath, getCurrentRoute, getParams, parseRoute };
})();
