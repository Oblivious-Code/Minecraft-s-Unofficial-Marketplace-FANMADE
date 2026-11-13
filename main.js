(() => {
  'use strict';

  const MAX_ADDON_BYTES = 100 * 1024 * 1024;
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
  let toastTimer;
  let secretClickCount = 0;
  let secretClickTimer;

  const adminStyle = document.createElement('style');
  adminStyle.textContent = '.admin-trigger{position:fixed;left:8px;bottom:8px;z-index:8;width:27px;height:27px;padding:0;border:1px solid #a4ec6633;border-radius:8px;background:#171e19;color:#a4ec66;font-size:13px;opacity:.1;transition:opacity .2s,transform .2s}.admin-trigger:hover,.admin-trigger:focus-visible{opacity:.95;transform:scale(1.08);outline:2px solid #a4ec66;outline-offset:2px}.admin-trigger[hidden]{display:none}';
  document.head.append(adminStyle);
  const adminButton = document.createElement('button');
  adminButton.type = 'button';
  adminButton.className = 'admin-trigger';
  adminButton.textContent = '▦';
  adminButton.title = 'Marketplace owner sign-in (double-press)';
  adminButton.setAttribute('aria-label', 'Marketplace owner sign-in. Press twice quickly to continue to GitHub.');
  adminButton.hidden = true;
  adminButton.addEventListener('click', () => {
    secretClickCount += 1;
    clearTimeout(secretClickTimer);
    if (secretClickCount >= 2) {
      secretClickCount = 0;
      window.location.assign('/api/admin/github');
      return;
    }
    secretClickTimer = setTimeout(() => { secretClickCount = 0; }, 700);
  });
  document.body.append(adminButton);

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
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
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
      isAdmin = Boolean(status.authenticated);
      adminButton.hidden = !status.enabled;
      adminButton.textContent = isAdmin ? '✓' : '▦';
      adminButton.title = isAdmin ? `Admin signed in as @${status.username}` : 'Marketplace owner sign-in (double-press)';
      adminButton.setAttribute('aria-label', isAdmin ? `Admin signed in as ${status.username}. Double-press to sign out.` : 'Marketplace owner sign-in. Press twice quickly to continue to GitHub.');
      render();
    } catch { adminButton.hidden = true; }
  }

  function render() {
    const query = searchInput.value.trim().toLocaleLowerCase();
    const category = categoryFilter.value;
    const filtered = addons.filter(addon => {
      const searchable = `${addon.title} ${addon.author} ${addon.description} ${addon.category}`.toLocaleLowerCase();
      return (!query || searchable.includes(query)) && (category === 'All' || addon.category === category);
    });
    document.getElementById('listingCount').textContent = addons.length
      ? `${addons.length} free ${addons.length === 1 ? 'add-on' : 'add-ons'} shared by the community`
      : 'Browse what the community has shared';
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

  async function deleteAddon(addon) {
    if (!window.confirm(`Permanently delete “${addon.title}” and its uploaded files?`)) return;
    try {
      await api(`/api/addons/${encodeURIComponent(addon.id)}`, { method: 'DELETE', headers: { 'X-Admin-Action': 'true' } });
      addons = addons.filter(item => item.id !== addon.id);
      render();
      showToast('Add-on deleted.');
    } catch (error) {
      if (error.message.includes('login required')) { isAdmin = false; checkAdminStatus(); }
      showToast(error.message);
    }
  }

  async function logoutAdmin() {
    try {
      await api('/api/admin/logout', { method: 'POST', headers: { 'X-Admin-Action': 'true' } });
      isAdmin = false;
      checkAdminStatus();
      showToast('Logged out of admin mode.');
    } catch (error) { showToast(error.message); }
  }

  adminButton.addEventListener('dblclick', event => {
    event.preventDefault();
    if (isAdmin) logoutAdmin();
  });

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
