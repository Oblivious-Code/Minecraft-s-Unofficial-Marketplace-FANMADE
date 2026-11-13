(() => {
  'use strict';

  const DB_NAME = 'block-and-bloom';
  const DB_VERSION = 1;
  const STORE = 'addons';
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
  let db;
  let addons = [];
  let toastTimer;

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('This browser does not support local add-on storage. Try a current version of Chrome, Firefox, or Edge.'));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE)) {
          const store = database.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Could not open your browser’s local add-on library.'));
    });
  }

  function getAllAddons() {
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function saveAddon(addon) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).put(addon);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Storage limit reached.'));
    });
  }

  function deleteAddon(id) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).delete(id);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
  }

  function make(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
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
    if (addon.image instanceof Blob) {
      const image = make('img');
      image.src = URL.createObjectURL(addon.image);
      image.alt = `Cover for ${addon.title}`;
      image.onload = () => URL.revokeObjectURL(image.src);
      cover.append(image);
    }
    cover.append(make('span', 'cover-label', category));
    const body = make('div', 'card-body');
    const titleRow = make('div', 'card-title-row');
    const title = make('h3', '', addon.title);
    const version = make('span', 'version', addon.version ? `v${addon.version}` : 'Add-on');
    titleRow.append(title, version);
    body.append(titleRow, make('div', 'author', `by ${addon.author}`));
    const description = make('p', 'description', addon.description);
    description.title = addon.description;
    body.append(description);
    const foot = make('div', 'card-foot');
    const details = make('span', 'category', `${formatBytes(addon.file.size)} · ${addon.fileName}`);
    details.title = `${category} · ${addon.fileName}`;
    const actions = make('div');
    actions.style.display = 'flex';
    actions.style.alignItems = 'center';
    const download = make('button', 'btn btn-primary download', '↓ Download');
    download.type = 'button';
    download.addEventListener('click', () => downloadAddon(addon));
    const remove = make('button', 'delete', '×');
    remove.type = 'button';
    remove.title = 'Remove this add-on from this browser';
    remove.setAttribute('aria-label', `Remove ${addon.title} from this browser`);
    remove.addEventListener('click', async () => {
      if (!window.confirm(`Remove “${addon.title}” from this browser?`)) return;
      try {
        await deleteAddon(addon.id);
        addons = addons.filter(item => item.id !== addon.id);
        render();
        showToast('Add-on removed from this browser.');
      } catch {
        showToast('Could not remove this add-on.');
      }
    });
    actions.append(download, remove);
    foot.append(details, actions);
    body.append(foot);
    card.append(cover, body);
    return card;
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return 'File';
    return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function downloadAddon(addon) {
    const url = URL.createObjectURL(addon.file);
    const link = document.createElement('a');
    link.href = url;
    link.download = addon.fileName;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function showModal() {
    errorBox.textContent = '';
    modal.classList.add('open');
    document.getElementById('addonTitle').focus();
  }

  function closeModal() {
    modal.classList.remove('open');
    form.reset();
    errorBox.textContent = '';
  }

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
    if (!(file instanceof File) || !file.size) {
      errorBox.textContent = 'Choose a file to upload.';
      return;
    }
    if (file.size > MAX_ADDON_BYTES) {
      errorBox.textContent = 'Files must be 100 MB or smaller.';
      return;
    }
    if (image instanceof File && image.size) {
      if (!allowedImageTypes.includes(image.type)) {
        errorBox.textContent = 'Cover images must be PNG, JPG, or WebP.';
        return;
      }
      if (image.size > MAX_IMAGE_BYTES) {
        errorBox.textContent = 'Cover images must be 3 MB or smaller.';
        return;
      }
    }
    const addon = {
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title: String(values.get('title')).trim(),
      author: String(values.get('author')).trim(),
      version: String(values.get('version')).trim(),
      description: String(values.get('description')).trim(),
      category: String(values.get('category')),
      file,
      fileName: file.name,
      image: image instanceof File && image.size ? image : null,
      createdAt: Date.now()
    };
    if (!addon.title || !addon.author || !addon.description) {
      errorBox.textContent = 'Please fill in the required fields.';
      return;
    }
    submitButton.disabled = true;
    submitButton.textContent = 'Saving…';
    try {
      await saveAddon(addon);
      addons.unshift(addon);
      render();
      closeModal();
      showToast('Your add-on is ready to download!');
    } catch (error) {
      errorBox.textContent = error?.name === 'QuotaExceededError'
        ? 'Your browser is out of storage space. Remove some add-ons or choose a smaller file.'
        : 'Could not save this add-on in your browser. Check available storage and try again.';
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = 'Share for free';
    }
  });

  (async () => {
    try {
      db = await openDatabase();
      addons = (await getAllAddons()).sort((a, b) => b.createdAt - a.createdAt);
      render();
    } catch (error) {
      grid.replaceChildren();
      const message = make('div', 'empty');
      message.append(make('div', 'empty-icon', '⚠️'), make('strong', '', 'Local storage unavailable'), make('p', '', error.message));
      grid.append(message);
      document.getElementById('openUpload').disabled = true;
      document.getElementById('heroUpload').disabled = true;
    }
  })();
})();
