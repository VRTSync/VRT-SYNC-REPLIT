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
          <div style="margin-bottom:20px;">
            <label class="form-label">Profile Photo</label>
            <div style="display:flex;align-items:center;gap:16px;margin-top:6px;">
              <div id="acct-avatar-preview" style="width:72px;height:72px;border-radius:50%;background:linear-gradient(135deg,var(--teal,#14b8a6),var(--teal-dark,#0d9488));display:flex;align-items:center;justify-content:center;color:#fff;font-size:22px;font-weight:700;overflow:hidden;flex-shrink:0;">
                ${user.avatarUrl ? `<img src="${esc(user.avatarUrl)}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;" />` : esc(initials(user.displayName))}
              </div>
              <div style="display:flex;flex-direction:column;gap:8px;">
                <div style="display:flex;gap:8px;">
                  <button class="btn btn-secondary btn-sm" id="acct-avatar-upload-btn" type="button">Upload Photo</button>
                  <button class="btn btn-ghost btn-sm" id="acct-avatar-remove-btn" type="button" style="${user.avatarUrl ? '' : 'display:none;'}">Remove</button>
                </div>
                <div style="font-size:12px;color:var(--gray-500,#6b7280);">JPG, PNG, or WebP — up to 5 MB.</div>
              </div>
              <input type="file" id="acct-avatar-input" accept="image/jpeg,image/png,image/webp" style="display:none;" />
            </div>
            <div id="acct-avatar-msg" style="margin-top:10px;display:none;"></div>
          </div>
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

  function initials(name) {
    const n = (name || '').trim();
    if (!n) return '?';
    const parts = n.split(' ').filter(Boolean);
    return parts.length >= 2
      ? (parts[0][0] + parts[1][0]).toUpperCase()
      : n.slice(0, 2).toUpperCase();
  }

  function updateTopbarName(newName) {
    const displayEl = document.getElementById('user-display');
    if (displayEl) displayEl.textContent = newName;
    renderTopbarAvatar();
  }

  function renderTopbarAvatar() {
    const avatarEl = document.getElementById('user-avatar');
    if (!avatarEl) return;
    if (user.avatarUrl) {
      avatarEl.innerHTML = `<img src="${esc(user.avatarUrl)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;" />`;
    } else {
      avatarEl.textContent = initials(user.displayName);
    }
  }

  function renderAccountAvatar() {
    const previewEl = container.querySelector('#acct-avatar-preview');
    const removeBtn = container.querySelector('#acct-avatar-remove-btn');
    if (!previewEl) return;
    if (user.avatarUrl) {
      previewEl.innerHTML = `<img src="${esc(user.avatarUrl)}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;" />`;
      if (removeBtn) removeBtn.style.display = '';
    } else {
      previewEl.textContent = initials(user.displayName);
      if (removeBtn) removeBtn.style.display = 'none';
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

  const avatarBtn = container.querySelector('#acct-avatar-upload-btn');
  const avatarInput = container.querySelector('#acct-avatar-input');
  const avatarRemoveBtn = container.querySelector('#acct-avatar-remove-btn');
  const avatarMsg = container.querySelector('#acct-avatar-msg');

  avatarBtn.addEventListener('click', () => avatarInput.click());

  avatarInput.addEventListener('change', async () => {
    hideMsg(avatarMsg);
    const file = avatarInput.files && avatarInput.files[0];
    avatarInput.value = '';
    if (!file) return;

    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) {
      showMsg(avatarMsg, 'Please choose a JPG, PNG, or WebP image.', 'error');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showMsg(avatarMsg, 'Image must be 5 MB or smaller.', 'error');
      return;
    }

    avatarBtn.disabled = true;
    const originalText = avatarBtn.textContent;
    avatarBtn.textContent = 'Uploading…';
    try {
      const uploadData = await apiFetch('/api/objects/upload', { method: 'POST' });
      const putRes = await fetch(uploadData.uploadURL, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      });
      if (!putRes.ok) throw new Error('Upload failed (status ' + putRes.status + ')');

      const updated = await apiFetch('/api/auth/me', {
        method: 'PATCH',
        body: { avatarUrl: uploadData.uploadURL },
      });
      user.avatarUrl = updated.avatarUrl;
      renderAccountAvatar();
      renderTopbarAvatar();
      showMsg(avatarMsg, 'Profile photo updated.', 'success');
      showToast('Profile photo updated', 'success');
    } catch (err) {
      showMsg(avatarMsg, err.message || 'Failed to upload photo.', 'error');
    } finally {
      avatarBtn.disabled = false;
      avatarBtn.textContent = originalText;
    }
  });

  avatarRemoveBtn.addEventListener('click', async () => {
    hideMsg(avatarMsg);
    avatarRemoveBtn.disabled = true;
    try {
      const updated = await apiFetch('/api/auth/me', {
        method: 'PATCH',
        body: { avatarUrl: null },
      });
      user.avatarUrl = updated.avatarUrl;
      renderAccountAvatar();
      renderTopbarAvatar();
      showMsg(avatarMsg, 'Profile photo removed.', 'success');
      showToast('Profile photo removed', 'success');
    } catch (err) {
      showMsg(avatarMsg, err.message || 'Failed to remove photo.', 'error');
    } finally {
      avatarRemoveBtn.disabled = false;
    }
  });

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
