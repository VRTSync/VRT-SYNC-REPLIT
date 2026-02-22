window.AdminRouter = (function() {
  const routes = {};
  let currentRoute = null;

  function register(name, renderFn) {
    routes[name] = renderFn;
  }

  function navigate(routeName, pushState = true) {
    const path = '/web/admin/' + routeName;
    if (pushState) {
      history.pushState({ route: routeName }, '', path);
    }
    render(routeName);
  }

  function render(routeName) {
    currentRoute = routeName;
    const container = document.getElementById('page-content');
    document.querySelectorAll('.nav-link').forEach(link => {
      link.classList.toggle('active', link.dataset.route === routeName);
    });
    if (routes[routeName]) {
      container.innerHTML = '<div class="loading-spinner">Loading...</div>';
      try {
        routes[routeName](container);
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

  function init() {
    document.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const route = link.dataset.route;
        navigate(route);
      });
    });

    window.addEventListener('popstate', (e) => {
      const route = e.state?.route || getRouteFromPath();
      render(route);
    });
  }

  function getRouteFromPath() {
    const path = window.location.pathname;
    const match = path.match(/\/web\/admin\/?(.*)$/);
    return (match && match[1]) || 'dashboard';
  }

  return { register, navigate, render, init, getRouteFromPath, getCurrentRoute };
})();
