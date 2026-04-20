/* VRTSync Portal — Account Settings Page
 * Route: 'account'
 * Allows the current user to update their display name and password.
 */
PortalRouter.register('account', async function (container) {
  const { apiFetch, showToast } = PortalAPI;
  const user = PortalState.getUser();

  if (!user) {
    container.innerHTML = '<div class="empty-state"><p>Not authenticated.</p></div>';
    return;
  }

  const roleMap = {
    admin: 'Admin',
    hoa_admin: 'HOA Admin',
    hoa_member: 'HOA Member',
    contractor: 'Contractor',
    property_manager: 'Property Manager',
  };

  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDate(dateStr) {
    if (!dateStr) return '—';
    try {
      return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    } catch { return dateStr; }
  }

  container.innerHTML = `
    <div class="page-header">
      <h1>Account Settings</h1>
    </div>

    <div style="max-width:600px;">

      <!-- Profile Card -->
      <div class="portal-module" style="margin-bottom:20px;">
        <div class="pm-header">
          <span class="pm-title">Profile</span>
        </div>
        <div class="pm-body" style="padding:20px;">
          <div style="margin-bottom:16px;">
            <label class="form-label" for="acct-display-name">Display Name</label>
            <input
              id="acct-display-name"
              class="form-control"
              type="text"
              value="${esc(user.displayName)}"
              placeholder="Your display name"
              maxlength="80"
              style="max-width:340px;"
            />
          </div>
          <div style="margin-bottom:16px;">
            <label class="form-label">Username</label>
            <div class="form-control" style="max-width:340px;background:var(--gray-50,#f9fafb);color:var(--gray-500,#6b7280);cursor:default;">${esc(user.username)}</div>
          </div>
          <div style="margin-bottom:16px;">
            <label class="form-label">Role</label>
            <div class="form-control" style="max-width:340px;background:var(--gray-50,#f9fafb);color:var(--gray-500,#6b7280);cursor:default;">${esc(roleMap[user.role] || user.role)}</div>
          </div>
          <div style="margin-bottom:20px;">
            <label class="form-label">Member Since</label>
            <div class="form-control" style="max-width:340px;background:var(--gray-50,#f9fafb);color:var(--gray-500,#6b7280);cursor:default;">${esc(formatDate(user.createdAt))}</div>
          </div>
          <div id="acct-profile-msg" style="margin-bottom:12px;display:none;"></div>
          <button class="btn btn-primary" id="acct-save-profile">Save Changes</button>
        </div>
      </div>

      <!-- Change Password Card -->
      <div class="portal-module">
        <div class="pm-header">
          <span class="pm-title">Change Password</span>
        </div>
        <div class="pm-body" style="padding:20px;">
          <div style="margin-bottom:16px;">
            <label class="form-label" for="acct-current-pw">Current Password</label>
            <input
              id="acct-current-pw"
              class="form-control"
              type="password"
              placeholder="Enter current password"
              autocomplete="current-password"
              style="max-width:340px;"
            />
          </div>
          <div style="margin-bottom:16px;">
            <label class="form-label" for="acct-new-pw">New Password</label>
            <input
              id="acct-new-pw"
              class="form-control"
              type="password"
              placeholder="At least 6 characters"
              autocomplete="new-password"
              style="max-width:340px;"
            />
          </div>
          <div style="margin-bottom:20px;">
            <label class="form-label" for="acct-confirm-pw">Confirm New Password</label>
            <input
              id="acct-confirm-pw"
              class="form-control"
              type="password"
              placeholder="Repeat new password"
              autocomplete="new-password"
              style="max-width:340px;"
            />
          </div>
          <div id="acct-pw-msg" style="margin-bottom:12px;display:none;"></div>
          <button class="btn btn-primary" id="acct-save-pw">Update Password</button>
        </div>
      </div>

    </div>
  `;

  function showMsg(el, message, type) {
    el.textContent = message;
    el.style.display = 'block';
    el.style.color = type === 'success' ? 'var(--teal,#0d9488)' : 'var(--red,#dc2626)';
    el.style.fontSize = '13px';
    el.style.fontWeight = '500';
  }

  function hideMsg(el) {
    el.style.display = 'none';
    el.textContent = '';
  }

  function updateTopbarName(newName) {
    const displayEl = document.getElementById('user-display');
    if (displayEl) displayEl.textContent = newName;
    const avatarEl = document.getElementById('user-avatar');
    if (avatarEl) {
      const parts = newName.split(' ').filter(Boolean);
      avatarEl.textContent = parts.length >= 2
        ? (parts[0][0] + parts[1][0]).toUpperCase()
        : newName.slice(0, 2).toUpperCase();
    }
  }

  const saveProfileBtn = container.querySelector('#acct-save-profile');
  const profileMsg = container.querySelector('#acct-profile-msg');

  saveProfileBtn.addEventListener('click', async () => {
    hideMsg(profileMsg);
    const displayName = container.querySelector('#acct-display-name').value.trim();
    if (!displayName) {
      showMsg(profileMsg, 'Display name cannot be empty.', 'error');
      return;
    }
    saveProfileBtn.disabled = true;
    saveProfileBtn.textContent = 'Saving…';
    try {
      const updated = await apiFetch('/api/auth/me', {
        method: 'PATCH',
        body: { displayName },
      });
      user.displayName = updated.displayName;
      updateTopbarName(updated.displayName);
      showMsg(profileMsg, 'Display name updated successfully.', 'success');
      showToast('Profile updated', 'success');
    } catch (err) {
      showMsg(profileMsg, err.message || 'Failed to update profile.', 'error');
    } finally {
      saveProfileBtn.disabled = false;
      saveProfileBtn.textContent = 'Save Changes';
    }
  });

  const savePwBtn = container.querySelector('#acct-save-pw');
  const pwMsg = container.querySelector('#acct-pw-msg');

  savePwBtn.addEventListener('click', async () => {
    hideMsg(pwMsg);
    const currentPassword = container.querySelector('#acct-current-pw').value;
    const newPassword = container.querySelector('#acct-new-pw').value;
    const confirmPassword = container.querySelector('#acct-confirm-pw').value;

    if (!currentPassword) {
      showMsg(pwMsg, 'Please enter your current password.', 'error');
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      showMsg(pwMsg, 'New password must be at least 6 characters.', 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      showMsg(pwMsg, 'New passwords do not match.', 'error');
      return;
    }

    savePwBtn.disabled = true;
    savePwBtn.textContent = 'Updating…';
    try {
      await apiFetch('/api/auth/me', {
        method: 'PATCH',
        body: { currentPassword, newPassword },
      });
      container.querySelector('#acct-current-pw').value = '';
      container.querySelector('#acct-new-pw').value = '';
      container.querySelector('#acct-confirm-pw').value = '';
      showMsg(pwMsg, 'Password updated successfully.', 'success');
      showToast('Password updated', 'success');
    } catch (err) {
      showMsg(pwMsg, err.message || 'Failed to update password.', 'error');
    } finally {
      savePwBtn.disabled = false;
      savePwBtn.textContent = 'Update Password';
    }
  });
});
