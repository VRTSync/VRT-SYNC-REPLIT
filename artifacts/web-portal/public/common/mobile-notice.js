document.getElementById('mobile-logout').addEventListener('click', async function () {
  const button = this;
  button.disabled = true;
  document.getElementById('logout-error').textContent = '';
  try {
    const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    if (!response.ok) throw new Error('Logout failed');
    window.location.replace('/web/login');
  } catch {
    document.getElementById('logout-error').textContent = 'Unable to log out. Please try again.';
    button.disabled = false;
  }
});
