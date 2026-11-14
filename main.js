(() => {
  'use strict';

  const MAX_ADDON_BYTES = 100 * 1024 * 1024 * 514;
  const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
  const allowedImageTypes = ['image/jpeg', 'image/png', 'image/webp'];
  const categoryIcons = { Adventure: '🧭', Blocks: '🧱', Cosmetics: '✨', Mobs: '🐾', Tools: '⚒️', Other: '🌿' };
  const grid = document.getElementById('addonGrid');
  const searchInput = document.getElementById('searchInput');
  const categoryFilter = document.getElementById('categoryFilter');
  const modal = document.getElementById('uploadModal');
  const form = document.getElementById('uploadForm');
  const errorBox = document.getElementById('formError');
  const submitButton = document.getElementById('submitUpload');
  const toast = document.getElementById('toast');
  const addonFileInput = document.getElementById('addonFile');
  addonFileInput.removeAttribute('accept');
  addonFileInput.nextElementSibling.textContent = 'Minecraft packs/worlds and other file types · Max 100 MB';
  let addons = [];
  let isAdmin = false;
  let adminLoginAvailable = false;
  let toastTimer;

  const adminButton = document.getElementById('adminButton') || document.createElement('button');
  adminButton.type = 'button';
  adminButton.className = 'btn btn-quiet';
  adminButton.textContent = 'AdminLogs';
  adminButton.title = 'Sign in with the server-configured admin password';
  adminButton.setAttribute('aria-label', 'AdminLogs: sign in for admin access');
  adminButton.style.padding = '10px 12px';
  if (!adminButton.isConnected) document.querySelector('.nav-right').prepend(adminButton);
  adminButton.addEventListener('click', () => {
    if (isAdmin) logoutAdmin();
    else if (adminLoginAvailable) showAdminLogin();
    else showToast('Admin login is not configured or the backend is unavailable.');
  });

  function make(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
  }

  async function api(path, options) {
    const response = await fetch(path, { credentials: 'same-origin', ...options });
    if (!response.ok) {
      let message = `Request failed (${response.status}).`;
      try { const body = await response.json(); if (body.error) message = body.error; } catch { /* May not be JSON. */ }
      throw new Error(message);
    }
    return response.json();
  }

  async function checkAdminStatus() {
    try {
      const status = await api('/api/admin/status');
      adminLoginAvailable = Boolean(status.enabled);
      isAdmin = Boolean(status.authenticated);
      adminButton.textContent = isAdmin ? 'AdminLogs · Signed in' : 'AdminLogs';
      adminButton.className = isAdmin ? 'btn btn-primary' : 'btn btn-quiet';
      adminButton.title = isAdmin ? 'Click to sign out of admin mode' : adminLoginAvailable ? 'Enter the server-configured admin password' : 'Admin password is not configured on the backend';
      render();
    } catch {
      adminLoginAvailable = false;
      adminButton.title = 'Admin button is visible; backend status is unavailable';
    }
  }

  function showAdminLogin() {
    const backdrop = make('div', 'modal-backdrop');
    backdrop.classList.add('open');
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.setAttribute('aria-labelledby', 'adminLoginTitle');
    const loginForm = make('form', 'modal');
    const heading = make('div', 'modal-head');
    const headingText = make('div');
    headingText.append(make('h2', '', 'Admin login'), make('p', '', 'Enter the admin password to manage marketplace add-ons.'));
    const close = make('button', 'close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => backdrop.remove());
    heading.append(headingText, close);
    const field = make('div', 'field');
    const label = make('label', '', 'Admin password');
    label.htmlFor = 'adminPassword';
    const password = make('input');
    password.id = 'adminPassword';
    password.type = 'password';
    password.name = 'password';
    password.autocomplete = 'current-password';
    password.required = true;
    password.maxLength = 256;
    field.append(label, password);
    const error = make('p', 'form-error');
    error.setAttribute('role', 'alert');
    const actions = make('div', 'modal-actions');
    const cancel = make('button', 'btn btn-quiet', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', () => backdrop.remove());
    const submit = make('button', 'btn btn-primary', 'Log in');
    submit.type = 'submit';
    actions.append(cancel, submit);
    loginForm.append(heading, field, error, actions);
    backdrop.append(loginForm);
    backdrop.addEventListener('click', event => { if (event.target === backdrop) backdrop.remove(); });
    loginForm.addEventListener('submit', async event => {
      event.preventDefault();
      error.textContent = '';
      submit.disabled = true;
      try {
        await api('/api/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: password.value })
        });
        isAdmin = true;
        backdrop.remove();
        await checkAdminStatus();
        showToast('Admin mode enabled. You can now delete add-ons.');
      } catch (loginError) {
        error.textContent = loginError.message;
      } finally { submit.disabled = false; }
    });
    document.body.append(backdrop);
    password.focus();
  }

  async function logoutAdmin() {
    try {
      await api('/api/admin/logout', { method: 'POST', headers: { 'X-Admin-Action': 'true' } });
      isAdmin = false;
      await checkAdminStatus();
      showToast('Logged out of admin mode.');
    } catch (error) { showToast(error.message); }
  }

  async function deleteAddon(addon) {
    if (!window.confirm(`Permanently delete “${addon.title}” and its uploaded files?`)) return;
    try {
      await api(`/api/addons/${encodeURIComponent(addon.id)}`, { method: 'DELETE', headers: { 'X-Admin-Action': 'true' } });
      addons = addons.filter(item => item.id !== addon.id);
      render();
      showToast('Add-on deleted.');
    } catch (error) {
      if (error.message.includes('login required')) { isAdmin = false; await checkAdminStatus(); }
      showToast(error.message);
    }
  }

  async function loadAddons() {
    try {
      const result = await api('/api/addons');
      addons = result.addons;
      render();
    } catch (error) {
      grid.replaceChildren();
      const message = make('div', 'empty');
      message.append(make('div', 'empty-icon', '⚠️'), make('strong', '', 'Marketplace backend unavailable'), make('p', '', `${error.message} Start the app with npm start to connect to the shared database.`));
      grid.append(message);
    }
  }

  function render() {
    const query = searchInput.value.trim().toLocaleLowerCase();
    const category = categoryFilter.value;
    const filtered = addons.filter(addon => {
      const searchable = `${addon.title} ${addon.author} ${addon.description} ${addon.category}`.toLocaleLowerCase();
      return (!query || searchable.includes(query)) && (category === 'All' || addon.category === category);
    });
    document.getElementById('listingCount').textContent = addons.length ? `${addons.length} free ${addons.length === 1 ? 'add-on' : 'add-ons'} shared by the community` : 'Browse what the community has shared';
    grid.replaceChildren();
    if (!filtered.length) {
      const empty = make('div', 'empty');
      empty.append(make('div', 'empty-icon', addons.length ? '⌕' : '🌿'));
      empty.append(make('strong', '', addons.length ? 'No add-ons found' : 'Be the first to share'));
      empty.append(make('p', '', addons.length ? 'Try another search or category.' : 'Upload an add-on and help this little community grow.'));
      grid.append(empty);
      return;
    }
    filtered.forEach(addon => grid.append(createCard(addon)));
  }

  function createCard(addon) {
    const card = make('article', 'card');
    const cover = make('div', 'cover');
    const category = addon.category || 'Other';
    cover.append(make('span', 'cover-emoji', categoryIcons[category] || '🌿'));
    if (addon.hasImage) {
      const image = make('img');
      image.src = `/api/addons/${encodeURIComponent(addon.id)}/image`;
      image.alt = `Cover for ${addon.title}`;
      cover.append(image);
    }
    cover.append(make('span', 'cover-label', category));
    const body = make('div', 'card-body');
    const titleRow = make('div', 'card-title-row');
    titleRow.append(make('h3', '', addon.title), make('span', 'version', addon.version ? `v${addon.version}` : 'Add-on'));
    body.append(titleRow, make('div', 'author', `by ${addon.author}`));
    const description = make('p', 'description', addon.description);
    description.title = addon.description;
    body.append(description);
    const foot = make('div', 'card-foot');
    const details = make('span', 'category', `${formatBytes(addon.fileSize)} · ${addon.fileName}`);
    details.title = `${category} · ${addon.fileName}`;
    const actions = make('div');
    actions.style.display = 'flex';
    actions.style.alignItems = 'center';
    actions.style.gap = '6px';
    const download = make('a', 'btn btn-primary download', '↓ Download');
    download.href = `/api/addons/${encodeURIComponent(addon.id)}/file`;
    download.setAttribute('aria-label', `Download ${addon.title}`);
    actions.append(download);
    if (isAdmin) {
      const remove = make('button', 'btn btn-quiet download', 'Delete');
      remove.type = 'button';
      remove.setAttribute('aria-label', `Delete ${addon.title}`);
      remove.addEventListener('click', () => deleteAddon(addon));
      actions.append(remove);
    }
    foot.append(details, actions);
    body.append(foot);
    card.append(cover, body);
    return card;
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return 'File';
    return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function showModal() { errorBox.textContent = ''; modal.classList.add('open'); document.getElementById('addonTitle').focus(); }
  function closeModal() { modal.classList.remove('open'); form.reset(); errorBox.textContent = ''; }
  document.getElementById('openUpload').addEventListener('click', showModal);
  document.getElementById('heroUpload').addEventListener('click', showModal);
  document.getElementById('closeModal').addEventListener('click', closeModal);
  document.getElementById('cancelUpload').addEventListener('click', closeModal);
  modal.addEventListener('click', event => { if (event.target === modal) closeModal(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && modal.classList.contains('open')) closeModal(); });
  searchInput.addEventListener('input', render);
  categoryFilter.addEventListener('change', render);

  form.addEventListener('submit', async event => {
    event.preventDefault();
    errorBox.textContent = '';
    const values = new FormData(form);
    const file = values.get('file');
    const image = values.get('image');
    if (!(file instanceof File) || !file.size) { errorBox.textContent = 'Choose a file to upload.'; return; }
    if (file.size > MAX_ADDON_BYTES) { errorBox.textContent = 'Files must be 100 MB or smaller.'; return; }
    if (image instanceof File && image.size) {
      if (!allowedImageTypes.includes(image.type)) { errorBox.textContent = 'Cover images must be PNG, JPG, or WebP.'; return; }
      if (image.size > MAX_IMAGE_BYTES) { errorBox.textContent = 'Cover images must be 3 MB or smaller.'; return; }
    }
    const upload = new FormData();
    for (const name of ['title', 'author', 'version', 'description', 'category']) upload.append(name, String(values.get(name) || '').trim());
    upload.append('file', file, file.name);
    if (image instanceof File && image.size) upload.append('image', image, image.name);
    submitButton.disabled = true;
    submitButton.textContent = 'Uploading…';
    try {
      await api('/api/addons', { method: 'POST', body: upload });
      await loadAddons();
      closeModal();
      showToast('Your add-on is now shared with everyone!');
    } catch (error) { errorBox.textContent = error.message || 'Upload failed. Please try again.'; }
    finally { submitButton.disabled = false; submitButton.textContent = 'Share for free'; }
  });

  checkAdminStatus();
  loadAddons();
})();
