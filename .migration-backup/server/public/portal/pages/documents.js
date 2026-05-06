PortalRouter.register('documents', async function (container) {
  const ctx = PortalState.getCommunityContext();
  const { role, activeCommunity } = ctx;
  const M = PortalModules;

  if (!activeCommunity) {
    if (ctx.isMultiCommunityUser) {
      PortalRouter.navigate('communities');
      return;
    }
    container.innerHTML = `
      <div class="empty-state" style="margin-top:80px;">
        <h3 style="color:var(--navy);margin-bottom:8px;">No community assigned</h3>
        <p style="color:var(--gray-500);">Contact your administrator to get access to a community.</p>
      </div>`;
    return;
  }

  const canEdit = ['property_manager', 'hoa_admin', 'admin'].includes(role);
  let currentFolderId = null;
  let breadcrumbs = [];

  container.innerHTML = M.pageHeader('Documents', activeCommunity) + '<div id="drive-root"></div>';
  const root = container.querySelector('#drive-root');

  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function formatSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function formatDate(str) {
    if (!str) return '';
    const d = new Date(str);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function fileIcon(mimeType) {
    if (!mimeType) return '\u{1F4C4}';
    if (mimeType.startsWith('image/')) return '\u{1F5BC}';
    if (mimeType.includes('pdf')) return '\u{1F4D1}';
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType.includes('csv')) return '\u{1F4CA}';
    if (mimeType.includes('word') || mimeType.includes('document')) return '\u{1F4DD}';
    if (mimeType.startsWith('video/')) return '\u{1F3AC}';
    return '\u{1F4C4}';
  }

  function renderBreadcrumbs() {
    let html = '<nav class="drive-breadcrumbs" style="display:flex;align-items:center;gap:6px;padding:8px 0;font-size:14px;">';
    html += `<a href="#" class="drive-bc-link" data-id="" style="color:var(--primary);cursor:pointer;text-decoration:none;font-weight:500;">Documents</a>`;
    for (let i = 0; i < breadcrumbs.length; i++) {
      const bc = breadcrumbs[i];
      html += `<span style="color:var(--gray-400);">/</span>`;
      if (i < breadcrumbs.length - 1) {
        html += `<a href="#" class="drive-bc-link" data-id="${esc(bc.id)}" style="color:var(--primary);cursor:pointer;text-decoration:none;">${esc(bc.name)}</a>`;
      } else {
        html += `<span style="color:var(--navy);font-weight:500;">${esc(bc.name)}</span>`;
      }
    }
    html += '</nav>';
    return html;
  }

  function renderActionBar() {
    if (!canEdit) return '';
    return `
      <div class="drive-actions" style="display:flex;gap:8px;margin-bottom:16px;">
        <button class="btn btn-primary btn-sm" id="drive-new-folder-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;vertical-align:-2px;">
            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
            <line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/>
          </svg>
          New Folder
        </button>
        <button class="btn btn-secondary btn-sm" id="drive-upload-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;vertical-align:-2px;">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          Upload File
        </button>
      </div>`;
  }

  function renderList(data) {
    const { folders, files } = data;

    let html = renderBreadcrumbs();
    html += renderActionBar();

    if (folders.length === 0 && files.length === 0) {
      html += `
        <div class="empty-state" style="margin-top:40px;text-align:center;">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--gray-300)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:12px;">
            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
          </svg>
          <p style="color:var(--gray-500);margin:0;">${canEdit ? 'This folder is empty. Create a folder or upload a file to get started.' : 'No documents available.'}</p>
        </div>`;
      root.innerHTML = html;
      bindActions();
      return;
    }

    html += `<div class="table-responsive"><table class="admin-table" style="width:100%;">
      <thead><tr>
        <th style="width:35%;">Name</th>
        <th>Type</th>
        <th>Uploaded By</th>
        <th>Date</th>
        <th>Size</th>
        <th style="width:120px;">Actions</th>
      </tr></thead><tbody>`;

    for (const folder of folders) {
      html += `<tr class="drive-folder-row" data-id="${esc(folder.id)}" data-name="${esc(folder.name)}" style="cursor:pointer;">
        <td style="font-weight:500;">
          <span style="margin-right:6px;font-size:16px;">\u{1F4C1}</span>${esc(folder.name)}
        </td>
        <td style="color:var(--gray-500);">Folder</td>
        <td style="color:var(--gray-500);font-size:13px;">${esc(folder.creatorName || '')}</td>
        <td style="color:var(--gray-500);font-size:13px;">${formatDate(folder.createdAt)}</td>
        <td></td>
        ${canEdit ? `<td>
          <button class="btn btn-ghost btn-xs drive-rename-folder" data-id="${esc(folder.id)}" data-name="${esc(folder.name)}" title="Rename">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn btn-ghost btn-xs drive-delete-folder" data-id="${esc(folder.id)}" data-name="${esc(folder.name)}" title="Delete">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
        </td>` : '<td></td>'}
      </tr>`;
    }

    for (const file of files) {
      html += `<tr>
        <td>
          <span style="margin-right:6px;font-size:16px;">${fileIcon(file.mimeType)}</span>${esc(file.name)}
        </td>
        <td style="color:var(--gray-500);font-size:13px;">${esc(file.mimeType || 'File')}</td>
        <td style="color:var(--gray-500);font-size:13px;">${esc(file.uploaderName || '')}</td>
        <td style="color:var(--gray-500);font-size:13px;">${formatDate(file.createdAt)}</td>
        <td style="color:var(--gray-500);font-size:13px;">${formatSize(file.sizeBytes)}</td>
        ${canEdit ? `<td>
          <a href="/api/drive/files/${esc(file.id)}/download" class="btn btn-ghost btn-xs" title="Download" target="_blank">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </a>
          <button class="btn btn-ghost btn-xs drive-rename-file" data-id="${esc(file.id)}" data-name="${esc(file.name)}" title="Rename">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn btn-ghost btn-xs drive-delete-file" data-id="${esc(file.id)}" data-name="${esc(file.name)}" title="Delete">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
        </td>` : `<td>
          <a href="/api/drive/files/${esc(file.id)}/download" class="btn btn-ghost btn-xs" title="Download" target="_blank">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </a>
        </td>`}
      </tr>`;
    }

    html += '</tbody></table></div>';
    root.innerHTML = html;
    bindActions();
  }

  function bindActions() {
    root.querySelectorAll('.drive-folder-row').forEach(function (row) {
      row.addEventListener('click', function (e) {
        if (e.target.closest('button')) return;
        var id = row.dataset.id;
        var name = row.dataset.name;
        breadcrumbs.push({ id: id, name: name });
        currentFolderId = id;
        loadFolder(id);
      });
    });

    root.querySelectorAll('.drive-bc-link').forEach(function (link) {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        var id = link.dataset.id;
        if (!id) {
          currentFolderId = null;
          breadcrumbs = [];
        } else {
          var idx = breadcrumbs.findIndex(function (b) { return b.id === id; });
          if (idx >= 0) breadcrumbs = breadcrumbs.slice(0, idx + 1);
          currentFolderId = id;
        }
        loadFolder(currentFolderId);
      });
    });

    var newFolderBtn = root.querySelector('#drive-new-folder-btn');
    if (newFolderBtn) {
      newFolderBtn.addEventListener('click', function () { showNewFolderModal(); });
    }
    var uploadBtn = root.querySelector('#drive-upload-btn');
    if (uploadBtn) {
      uploadBtn.addEventListener('click', function () { showUploadModal(); });
    }

    root.querySelectorAll('.drive-rename-folder').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        showRenameModal('folder', btn.dataset.id, btn.dataset.name);
      });
    });
    root.querySelectorAll('.drive-rename-file').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        showRenameModal('file', btn.dataset.id, btn.dataset.name);
      });
    });
    root.querySelectorAll('.drive-delete-folder').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        confirmDelete('folder', btn.dataset.id, btn.dataset.name);
      });
    });
    root.querySelectorAll('.drive-delete-file').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        confirmDelete('file', btn.dataset.id, btn.dataset.name);
      });
    });
  }

  async function loadFolder(folderId) {
    root.innerHTML = '<div class="loading-spinner" style="margin-top:40px;">Loading...</div>';
    try {
      var url = '/api/drive?communityId=' + encodeURIComponent(activeCommunity.id);
      if (folderId) url += '&folderId=' + encodeURIComponent(folderId);
      var data = await PortalAPI.apiFetch(url);
      renderList(data);
    } catch (err) {
      console.error('Drive load error:', err);
      root.innerHTML = '<div class="empty-state" style="margin-top:40px;"><p>Failed to load documents. Please refresh.</p></div>';
    }
  }

  function showModal(title, bodyHtml, onSave) {
    var existing = document.querySelector('.modal-overlay');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:440px;">
        <div class="modal-header">
          <h3 class="modal-title">${title}</h3>
          <button class="modal-close" id="drive-modal-close">&times;</button>
        </div>
        <div class="modal-body">${bodyHtml}</div>
        <div class="modal-footer">
          <button class="btn btn-ghost btn-sm" id="drive-modal-cancel">Cancel</button>
          <button class="btn btn-primary btn-sm" id="drive-modal-save">Save</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector('#drive-modal-close').addEventListener('click', function () { overlay.remove(); });
    overlay.querySelector('#drive-modal-cancel').addEventListener('click', function () { overlay.remove(); });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('#drive-modal-save').addEventListener('click', async function () {
      var saveBtn = overlay.querySelector('#drive-modal-save');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
      try {
        await onSave(overlay);
        overlay.remove();
        loadFolder(currentFolderId);
      } catch (err) {
        PortalAPI.showToast(err.message || 'Operation failed', 'error');
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
      }
    });
  }

  function showNewFolderModal() {
    showModal('New Folder',
      '<label style="display:block;margin-bottom:6px;font-weight:500;font-size:14px;">Folder Name</label><input type="text" id="drive-folder-name" class="form-input" placeholder="Enter folder name" style="width:100%;" autofocus>',
      async function (overlay) {
        var name = overlay.querySelector('#drive-folder-name').value.trim();
        if (!name) throw new Error('Folder name is required');
        await PortalAPI.apiFetch('/api/drive/folders', {
          method: 'POST',
          body: { communityId: activeCommunity.id, parentId: currentFolderId, name: name }
        });
        PortalAPI.showToast('Folder created', 'success');
      }
    );
    setTimeout(function () {
      var inp = document.querySelector('#drive-folder-name');
      if (inp) inp.focus();
    }, 100);
  }

  function showUploadModal() {
    var existing = document.querySelector('.modal-overlay');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:480px;">
        <div class="modal-header">
          <h3 class="modal-title">Upload File</h3>
          <button class="modal-close" id="drive-upload-close">&times;</button>
        </div>
        <div class="modal-body">
          <div id="drive-upload-area" style="border:2px dashed var(--gray-300);border-radius:8px;padding:32px;text-align:center;cursor:pointer;">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:8px;">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <p style="color:var(--gray-500);margin:0;">Click to select a file or drag & drop</p>
            <input type="file" id="drive-file-input" style="display:none;">
          </div>
          <div id="drive-upload-progress" style="display:none;margin-top:12px;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
              <span id="drive-upload-filename" style="font-weight:500;font-size:14px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></span>
            </div>
            <div style="background:var(--gray-200);border-radius:4px;height:6px;overflow:hidden;">
              <div id="drive-upload-bar" style="background:var(--primary);height:100%;width:0%;transition:width 0.3s;"></div>
            </div>
            <p id="drive-upload-status" style="font-size:13px;color:var(--gray-500);margin-top:6px;">Uploading...</p>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    var fileInput = overlay.querySelector('#drive-file-input');
    var uploadArea = overlay.querySelector('#drive-upload-area');

    overlay.querySelector('#drive-upload-close').addEventListener('click', function () { overlay.remove(); });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });

    uploadArea.addEventListener('click', function () { fileInput.click(); });
    uploadArea.addEventListener('dragover', function (e) { e.preventDefault(); uploadArea.style.borderColor = 'var(--primary)'; });
    uploadArea.addEventListener('dragleave', function () { uploadArea.style.borderColor = 'var(--gray-300)'; });
    uploadArea.addEventListener('drop', function (e) {
      e.preventDefault();
      uploadArea.style.borderColor = 'var(--gray-300)';
      if (e.dataTransfer.files.length > 0) doUpload(e.dataTransfer.files[0], overlay);
    });

    fileInput.addEventListener('change', function () {
      if (fileInput.files.length > 0) doUpload(fileInput.files[0], overlay);
    });
  }

  async function doUpload(file, overlay) {
    var progressDiv = overlay.querySelector('#drive-upload-progress');
    var uploadArea = overlay.querySelector('#drive-upload-area');
    var filenameEl = overlay.querySelector('#drive-upload-filename');
    var barEl = overlay.querySelector('#drive-upload-bar');
    var statusEl = overlay.querySelector('#drive-upload-status');

    uploadArea.style.display = 'none';
    progressDiv.style.display = 'block';
    filenameEl.textContent = file.name;
    barEl.style.width = '10%';
    statusEl.textContent = 'Getting upload URL...';

    try {
      var uploadData = await PortalAPI.apiFetch('/api/objects/upload', { method: 'POST' });
      barEl.style.width = '30%';
      statusEl.textContent = 'Uploading file...';

      var putRes = await fetch(uploadData.uploadURL, { method: 'PUT', body: file });
      if (!putRes.ok) throw new Error('File upload failed (status ' + putRes.status + ')');
      barEl.style.width = '60%';
      statusEl.textContent = 'Confirming upload...';

      var confirmData = await PortalAPI.apiFetch('/api/objects/confirm', {
        method: 'POST',
        body: { uploadURL: uploadData.uploadURL }
      });
      var fileRef = confirmData.objectPath;
      barEl.style.width = '80%';
      statusEl.textContent = 'Saving record...';

      await PortalAPI.apiFetch('/api/drive/files', {
        method: 'POST',
        body: {
          communityId: activeCommunity.id,
          folderId: currentFolderId,
          name: file.name,
          fileRef: fileRef,
          mimeType: file.type || null,
          sizeBytes: file.size || null
        }
      });

      barEl.style.width = '100%';
      statusEl.textContent = 'Upload complete!';
      PortalAPI.showToast('File uploaded successfully', 'success');
      setTimeout(function () {
        overlay.remove();
        loadFolder(currentFolderId);
      }, 500);
    } catch (err) {
      console.error('Upload error:', err);
      statusEl.textContent = 'Upload failed: ' + (err.message || 'Unknown error');
      statusEl.style.color = 'var(--red-500, #ef4444)';
      PortalAPI.showToast('Upload failed', 'error');
    }
  }

  function showRenameModal(type, id, currentName) {
    var label = type === 'folder' ? 'Folder' : 'File';
    showModal('Rename ' + label,
      '<label style="display:block;margin-bottom:6px;font-weight:500;font-size:14px;">' + label + ' Name</label><input type="text" id="drive-rename-input" class="form-input" value="' + esc(currentName) + '" style="width:100%;">',
      async function (overlay) {
        var name = overlay.querySelector('#drive-rename-input').value.trim();
        if (!name) throw new Error('Name is required');
        if (name === currentName) { return; }
        var endpoint = type === 'folder' ? '/api/drive/folders/' : '/api/drive/files/';
        await PortalAPI.apiFetch(endpoint + id, {
          method: 'PATCH',
          body: { name: name }
        });
        PortalAPI.showToast(label + ' renamed', 'success');
      }
    );
    setTimeout(function () {
      var inp = document.querySelector('#drive-rename-input');
      if (inp) { inp.focus(); inp.select(); }
    }, 100);
  }

  function confirmDelete(type, id, name) {
    var label = type === 'folder' ? 'folder' : 'file';
    var existing = document.querySelector('.modal-overlay');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:400px;">
        <div class="modal-header">
          <h3 class="modal-title">Delete ${label}?</h3>
          <button class="modal-close" id="drive-del-close">&times;</button>
        </div>
        <div class="modal-body">
          <p style="margin:0;">Are you sure you want to delete <strong>${esc(name)}</strong>? This action cannot be undone.</p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost btn-sm" id="drive-del-cancel">Cancel</button>
          <button class="btn btn-sm" id="drive-del-confirm" style="background:var(--red-500, #ef4444);color:#fff;">Delete</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector('#drive-del-close').addEventListener('click', function () { overlay.remove(); });
    overlay.querySelector('#drive-del-cancel').addEventListener('click', function () { overlay.remove(); });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('#drive-del-confirm').addEventListener('click', async function () {
      var btn = overlay.querySelector('#drive-del-confirm');
      btn.disabled = true;
      btn.textContent = 'Deleting...';
      try {
        var endpoint = type === 'folder' ? '/api/drive/folders/' : '/api/drive/files/';
        await PortalAPI.apiFetch(endpoint + id, { method: 'DELETE' });
        PortalAPI.showToast(label.charAt(0).toUpperCase() + label.slice(1) + ' deleted', 'success');
        overlay.remove();
        loadFolder(currentFolderId);
      } catch (err) {
        PortalAPI.showToast(err.message || 'Delete failed', 'error');
        btn.disabled = false;
        btn.textContent = 'Delete';
      }
    });
  }

  loadFolder(null);
});
