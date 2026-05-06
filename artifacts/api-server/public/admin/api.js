window.AdminAPI = (function() {
  const DEFAULT_TIMEOUT = 15000;

  async function apiFetch(url, options = {}) {
    const timeout = options.timeout || DEFAULT_TIMEOUT;
    delete options.timeout;

    const config = {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      ...options,
    };
    if (config.body && typeof config.body === 'object' && !(config.body instanceof FormData)) {
      config.body = JSON.stringify(config.body);
    }
    if (config.body instanceof FormData) {
      delete config.headers['Content-Type'];
    }

    const controller = new AbortController();
    config.signal = controller.signal;
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await fetch(url, config);
      clearTimeout(timer);
      if (res.status === 401) {
        window.location.href = '/web/login';
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
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        const timeoutErr = new Error('Request timed out. Please check your connection and try again.');
        timeoutErr.isTimeout = true;
        throw timeoutErr;
      }
      if (err.message !== 'Session expired' && err.message !== 'Not authorized') {
        console.error('API error:', err.message || err);
      }
      throw err;
    }
  }

  async function apiFetchWithRetry(url, options = {}, retries = 2) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await apiFetch(url, { ...options });
      } catch (err) {
        if (err.message === 'Session expired' || err.message === 'Not authorized') {
          throw err;
        }
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
          continue;
        }
        throw err;
      }
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

  return { apiFetch, apiFetchWithRetry, showToast };
})();
