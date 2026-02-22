window.AdminAPI = (function() {
  async function apiFetch(url, options = {}) {
    const config = {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      ...options,
    };
    if (config.body && typeof config.body === 'object' && !(config.body instanceof FormData)) {
      config.body = JSON.stringify(config.body);
    }
    try {
      const res = await fetch(url, config);
      if (res.status === 401) {
        window.location.href = '/web/admin/login';
        throw new Error('Session expired');
      }
      if (res.status === 403) {
        showToast('Not authorized', 'error');
        throw new Error('Not authorized');
      }
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const msg = errData.error || errData.message || `Request failed (${res.status})`;
        throw new Error(msg);
      }
      if (res.status === 204) return null;
      return await res.json();
    } catch (err) {
      if (err.message !== 'Session expired' && err.message !== 'Not authorized') {
        console.error('API error:', err);
      }
      throw err;
    }
  }

  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  return { apiFetch, showToast };
})();
