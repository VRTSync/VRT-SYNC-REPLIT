/* VRTSync Branch Portfolio — Account Settings Page
 * Route: 'account'
 * Reached only from the sidebar user menu. Not listed in main nav.
 */
(function () {
  'use strict';

  var esc = (window.VRTUtils && window.VRTUtils.esc) || function (v) { return v == null ? '' : String(v); };

  function apiFetch(url, opts) {
    var options = opts || {};
    var fetchOpts = {
      method: options.method || 'GET',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
    };
    if (options.body) {
      fetchOpts.body = JSON.stringify(options.body);
    }
    return fetch(url, fetchOpts).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok) {
          var msg = (data && (data.error || data.message)) || ('HTTP ' + r.status);
          throw new Error(msg);
        }
        return data;
      });
    });
  }

  var roleMap = {
    admin:            'Admin',
    client_admin:     'Client Admin',
    hoa_admin:        'HOA Admin',
    hoa_member:       'HOA Member',
    contractor:       'Contractor',
    property_manager: 'Property Manager',
  };

  PortfolioRouter.register('account', function (container) {
    // Get current user from the bootstrap fetch result stored in a closure
    fetch('/api/auth/me', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        var user = data && data.user;
        if (!user) {
          container.innerHTML = '<div class="pf-empty"><p>Not authenticated.</p></div>';
          return;
        }
        renderPage(container, user);
      })
      .catch(function () {
        container.innerHTML = '<div class="pf-empty"><p>Failed to load account data.</p></div>';
      });
  });

  function renderPage(container, user) {
    var orgName = (window.PortfolioState && window.PortfolioState.organization && window.PortfolioState.organization.name) || '';
    var roleLabel = esc(roleMap[user.role] || user.role);
    var displayName = user.displayName || '';

    container.innerHTML =
      '<div class="ctx" style="margin-bottom:20px;">' +
        '<h1 style="font-family:\'Outfit\',sans-serif;font-size:22px;font-weight:700;color:var(--navy);">Account Settings</h1>' +
      '</div>' +

      '<div style="max-width:600px;">' +

        /* ── Profile panel ── */
        '<div class="panel" style="margin-bottom:20px;">' +
          '<div class="panel-head">' +
            '<h2>Profile</h2>' +
          '</div>' +
          '<div style="padding:22px 24px;">' +
            '<div style="margin-bottom:18px;">' +
              '<label class="acct-label" for="pf-display-name">Display Name</label>' +
              '<input id="pf-display-name" class="acct-input" type="text"' +
                ' value="' + esc(displayName) + '"' +
                ' placeholder="Your display name" maxlength="80" />' +
            '</div>' +
            '<div style="margin-bottom:18px;">' +
              '<label class="acct-label">Username</label>' +
              '<div class="acct-readonly">' + esc(user.username) + '</div>' +
            '</div>' +
            '<div style="margin-bottom:18px;">' +
              '<label class="acct-label">Role</label>' +
              '<div class="acct-readonly">' + roleLabel + (user.role === 'admin' ? ' <span class="admin-preview-badge" style="margin-left:6px;">Admin Preview</span>' : '') + '</div>' +
            '</div>' +
            (orgName ? (
              '<div style="margin-bottom:20px;">' +
                '<label class="acct-label">Organization</label>' +
                '<div class="acct-readonly">' + esc(orgName) + '</div>' +
              '</div>'
            ) : '') +
            '<div style="margin-bottom:16px;">' +
              '<label class="acct-label" for="pf-current-pw">Current Password</label>' +
              '<input id="pf-current-pw" class="acct-input" type="password"' +
                ' placeholder="Required to save changes" autocomplete="current-password" />' +
              '<div style="font-size:12px;color:var(--gray-500);margin-top:4px;">Required to confirm your identity before saving.</div>' +
            '</div>' +
            '<div id="pf-msg" style="display:none;margin-bottom:12px;font-size:13px;font-weight:500;"></div>' +
            '<button class="pf-btn-primary" id="pf-save">Save Changes</button>' +
          '</div>' +
        '</div>' +

        /* ── Change Password panel ── */
        '<div class="panel">' +
          '<div class="panel-head p-navy">' +
            '<h2>Change Password</h2>' +
          '</div>' +
          '<div style="padding:22px 24px;">' +
            '<div style="margin-bottom:18px;">' +
              '<label class="acct-label" for="cp-current">Current Password</label>' +
              '<input id="cp-current" class="acct-input" type="password"' +
                ' placeholder="Enter current password" autocomplete="current-password" />' +
            '</div>' +
            '<div style="margin-bottom:18px;">' +
              '<label class="acct-label" for="cp-new">New Password</label>' +
              '<input id="cp-new" class="acct-input" type="password"' +
                ' placeholder="At least 6 characters" autocomplete="new-password" />' +
            '</div>' +
            '<div style="margin-bottom:20px;">' +
              '<label class="acct-label" for="cp-confirm">Confirm New Password</label>' +
              '<input id="cp-confirm" class="acct-input" type="password"' +
                ' placeholder="Repeat new password" autocomplete="new-password" />' +
            '</div>' +
            '<div id="cp-msg" style="display:none;margin-bottom:12px;font-size:13px;font-weight:500;"></div>' +
            '<button class="pf-btn-primary" id="cp-save">Update Password</button>' +
          '</div>' +
        '</div>' +

      '</div>';

    function showMsg(id, message, type) {
      var el = container.querySelector('#' + id);
      if (!el) return;
      el.textContent = message;
      el.style.display = 'block';
      el.style.color = type === 'success' ? 'var(--teal-dark)' : 'var(--red)';
    }
    function hideMsg(id) {
      var el = container.querySelector('#' + id);
      if (el) { el.style.display = 'none'; el.textContent = ''; }
    }

    // ── Profile save ─────────────────────────────────────────────────────────
    var saveBtn = container.querySelector('#pf-save');
    saveBtn.addEventListener('click', function () {
      hideMsg('pf-msg');
      var newName = container.querySelector('#pf-display-name').value.trim();
      var currentPassword = container.querySelector('#pf-current-pw').value;
      if (!newName) {
        showMsg('pf-msg', 'Display name cannot be empty.', 'error');
        return;
      }
      if (!currentPassword) {
        showMsg('pf-msg', 'Please enter your current password to save changes.', 'error');
        return;
      }
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving\u2026';
      apiFetch('/api/auth/me', {
        method: 'PATCH',
        body: { displayName: newName, currentPassword: currentPassword },
      }).then(function (updated) {
        // Update sidebar label in place
        var displayEl = document.getElementById('user-display');
        if (displayEl) displayEl.textContent = updated.displayName || newName;
        var avatarEl = document.getElementById('user-avatar');
        if (avatarEl && !avatarEl.querySelector('img')) {
          var n = updated.displayName || newName;
          avatarEl.textContent = n ? n.charAt(0).toUpperCase() : '?';
        }
        container.querySelector('#pf-current-pw').value = '';
        showMsg('pf-msg', 'Display name updated successfully.', 'success');
        // Update local user reference so subsequent saves show correct value
        user.displayName = updated.displayName || newName;
      }).catch(function (err) {
        showMsg('pf-msg', err.message || 'Failed to update profile.', 'error');
      }).finally(function () {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Changes';
      });
    });

    // ── Password save ────────────────────────────────────────────────────────
    var cpSaveBtn = container.querySelector('#cp-save');
    cpSaveBtn.addEventListener('click', function () {
      hideMsg('cp-msg');
      var currentPassword = container.querySelector('#cp-current').value;
      var newPassword     = container.querySelector('#cp-new').value;
      var confirmPassword = container.querySelector('#cp-confirm').value;
      if (!currentPassword) {
        showMsg('cp-msg', 'Please enter your current password.', 'error');
        return;
      }
      if (!newPassword || newPassword.length < 6) {
        showMsg('cp-msg', 'New password must be at least 6 characters.', 'error');
        return;
      }
      if (newPassword !== confirmPassword) {
        showMsg('cp-msg', 'New passwords do not match.', 'error');
        return;
      }
      cpSaveBtn.disabled = true;
      cpSaveBtn.textContent = 'Updating\u2026';
      apiFetch('/api/auth/me', {
        method: 'PATCH',
        body: { currentPassword: currentPassword, newPassword: newPassword },
      }).then(function () {
        container.querySelector('#cp-current').value = '';
        container.querySelector('#cp-new').value = '';
        container.querySelector('#cp-confirm').value = '';
        showMsg('cp-msg', 'Password updated successfully.', 'success');
      }).catch(function (err) {
        showMsg('cp-msg', err.message || 'Failed to update password.', 'error');
      }).finally(function () {
        cpSaveBtn.disabled = false;
        cpSaveBtn.textContent = 'Update Password';
      });
    });
  }

})();
