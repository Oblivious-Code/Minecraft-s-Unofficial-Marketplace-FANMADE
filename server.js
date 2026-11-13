const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const multer = require('multer');
const Database = require('better-sqlite3');
const { rateLimit } = require('express-rate-limit');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const MAX_ADDON_BYTES = 100 * 1024 * 1024;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const categories = new Set(['Adventure', 'Blocks', 'Cosmetics', 'Mobs', 'Tools', 'Other']);
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const ADMIN_ENABLED = ADMIN_PASSWORD.length >= 12 && SESSION_SECRET.length >= 32;
const ADMIN_COOKIE = 'marketplace_admin';
const ADMIN_COOKIE_MAX_AGE = 8 * 60 * 60 * 1000;

if (ADMIN_PASSWORD && ADMIN_PASSWORD.length < 12) console.warn('Admin mode disabled: ADMIN_PASSWORD must be at least 12 characters.');
if (SESSION_SECRET && SESSION_SECRET.length < 32) console.warn('Admin mode disabled: SESSION_SECRET must be at least 32 characters.');
if (!ADMIN_ENABLED) console.warn('Admin mode is disabled. Configure ADMIN_PASSWORD (12+ chars) and SESSION_SECRET (32+ chars).');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'marketplace.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS addons (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    author TEXT NOT NULL,
    version TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_storage_name TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    file_mime TEXT NOT NULL DEFAULT 'application/octet-stream',
    image_storage_name TEXT,
    image_mime TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX IF NOT EXISTS addons_created_at_idx ON addons(created_at DESC);
`);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.static(__dirname, { index: 'index.html', dotfiles: 'ignore' }));

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, UPLOAD_DIR),
  filename: (req, file, callback) => callback(null, `${req.uploadId}-${file.fieldname === 'image' ? 'cover' : 'file'}`)
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_ADDON_BYTES, files: 2, fields: 10, fieldSize: 10_000 },
  fileFilter: (_req, file, callback) => {
    if (file.fieldname === 'image' && !imageTypes.has(file.mimetype)) return callback(new Error('Cover images must be PNG, JPG, or WebP.'));
    if (!['file', 'image'].includes(file.fieldname)) return callback(new Error('Unexpected upload field.'));
    callback(null, true);
  }
});

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Upload limit reached. Please try again in a little while.' }
});
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many admin login attempts. Try again in 15 minutes.' }
});

function cleanOriginalName(value) {
  const basename = path.posix.basename(String(value || '').replace(/\\/g, '/'));
  return basename.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 180) || 'download';
}

function removeUploadedFiles(files) {
  for (const field of Object.values(files || {})) {
    for (const file of field) {
      try { fs.unlinkSync(file.path); } catch { /* File may already be gone. */ }
    }
  }
}

function publicAddon(row) {
  return {
    id: row.id, title: row.title, author: row.author, version: row.version,
    description: row.description, category: row.category, fileName: row.file_name,
    fileSize: row.file_size, hasImage: Boolean(row.image_storage_name), createdAt: row.created_at
  };
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function makeAdminToken(expiresAt) {
  const payload = String(expiresAt);
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function isAdmin(req) {
  if (!ADMIN_ENABLED) return false;
  const token = req.cookies?.[ADMIN_COOKIE] || parseCookies(req.headers.cookie || '')[ADMIN_COOKIE];
  if (!token) return false;
  const [expiresAt, signature, extra] = token.split('.');
  if (extra !== undefined || !/^\d+$/.test(expiresAt) || Number(expiresAt) <= Date.now()) return false;
  return safeEqual(signature, crypto.createHmac('sha256', SESSION_SECRET).update(expiresAt).digest('base64url'));
}

function parseCookies(header) {
  const cookies = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    try { cookies[name] = decodeURIComponent(part.slice(index + 1).trim()); } catch { /* Ignore malformed cookie. */ }
  }
  return cookies;
}

function requireAdmin(req, res, next) {
  if (!ADMIN_ENABLED) return res.status(503).json({ error: 'Admin mode is not configured on this server.' });
  if (!isAdmin(req)) return res.status(401).json({ error: 'Admin login required.' });
  const origin = req.get('origin');
  if (!origin || origin !== `${req.protocol}://${req.get('host')}` || req.get('x-admin-action') !== 'true') {
    return res.status(403).json({ error: 'Request could not be verified. Reload the page and try again.' });
  }
  next();
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/admin/status', (req, res) => res.json({ enabled: ADMIN_ENABLED, authenticated: isAdmin(req) }));

app.post('/api/admin/login', adminLoginLimiter, express.json({ limit: '2kb' }), (req, res) => {
  if (!ADMIN_ENABLED) return res.status(503).json({ error: 'Admin mode is not configured on this server.' });
  if (!req.get('origin') || req.get('origin') !== `${req.protocol}://${req.get('host')}`) {
    return res.status(403).json({ error: 'Request could not be verified.' });
  }
  if (!safeEqual(req.body?.password || '', ADMIN_PASSWORD)) return res.status(401).json({ error: 'Incorrect admin password.' });
  const expiresAt = Date.now() + ADMIN_COOKIE_MAX_AGE;
  res.cookie(ADMIN_COOKIE, makeAdminToken(expiresAt), {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict',
    maxAge: ADMIN_COOKIE_MAX_AGE, path: '/',
  });
  res.json({ authenticated: true });
});

app.post('/api/admin/logout', requireAdmin, (_req, res) => {
  res.clearCookie(ADMIN_COOKIE, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/' });
  res.json({ authenticated: false });
});

app.get('/api/addons', (_req, res) => {
  const rows = db.prepare('SELECT * FROM addons ORDER BY created_at DESC LIMIT 500').all();
  res.json({ addons: rows.map(publicAddon) });
});

app.post('/api/addons', uploadLimiter, (req, res, next) => {
  req.uploadId = crypto.randomUUID();
  upload.fields([{ name: 'file', maxCount: 1 }, { name: 'image', maxCount: 1 }])(req, res, error => {
    if (error) { removeUploadedFiles(req.files); next(error); return; }
    try {
      const fields = req.body || {};
      const file = req.files?.file?.[0];
      const image = req.files?.image?.[0];
      const title = String(fields.title || '').trim();
      const author = String(fields.author || '').trim();
      const description = String(fields.description || '').trim();
      const version = String(fields.version || '').trim();
      const category = String(fields.category || 'Other');
      const errors = [];
      if (!file) errors.push('Choose a file to upload.');
      if (!title || title.length > 60) errors.push('Add-on name is required and must be 60 characters or fewer.');
      if (!author || author.length > 32) errors.push('Creator name is required and must be 32 characters or fewer.');
      if (!description || description.length > 240) errors.push('Description is required and must be 240 characters or fewer.');
      if (version.length > 20) errors.push('Minecraft version must be 20 characters or fewer.');
      if (!categories.has(category)) errors.push('Choose a valid category.');
      if (image && image.size > MAX_IMAGE_BYTES) errors.push('Cover images must be 3 MB or smaller.');
      if (errors.length) { removeUploadedFiles(req.files); res.status(400).json({ error: errors.join(' ') }); return; }

      db.prepare(`INSERT INTO addons (
        id, title, author, version, description, category, file_name,
        file_storage_name, file_size, file_mime, image_storage_name, image_mime
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        req.uploadId, title, author, version, description, category,
        cleanOriginalName(file.originalname), path.basename(file.filename), file.size,
        file.mimetype || 'application/octet-stream', image ? path.basename(image.filename) : null,
        image ? image.mimetype : null
      );
      res.status(201).json({ addon: publicAddon(db.prepare('SELECT * FROM addons WHERE id = ?').get(req.uploadId)) });
    } catch (error) { removeUploadedFiles(req.files); next(error); }
  });
});

app.delete('/api/addons/:id', requireAdmin, (req, res, next) => {
  try {
    const row = db.prepare('SELECT file_storage_name, image_storage_name FROM addons WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Add-on not found.' });
    db.prepare('DELETE FROM addons WHERE id = ?').run(req.params.id);
    for (const name of [row.file_storage_name, row.image_storage_name]) {
      if (!name) continue;
      try { fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(name))); } catch (error) {
        if (error.code !== 'ENOENT') console.error('Could not remove uploaded file:', error.message);
      }
    }
    res.json({ deleted: true });
  } catch (error) { next(error); }
});

app.get('/api/addons/:id/file', (req, res, next) => {
  try {
    const row = db.prepare('SELECT file_name, file_storage_name FROM addons WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Add-on not found.' });
    res.set('X-Content-Type-Options', 'nosniff');
    res.download(path.join(UPLOAD_DIR, path.basename(row.file_storage_name)), row.file_name, error => { if (error && !res.headersSent) next(error); });
  } catch (error) { next(error); }
});

app.get('/api/addons/:id/image', (req, res, next) => {
  try {
    const row = db.prepare('SELECT image_storage_name, image_mime FROM addons WHERE id = ?').get(req.params.id);
    if (!row || !row.image_storage_name) return res.status(404).json({ error: 'Cover image not found.' });
    res.set({ 'Content-Type': row.image_mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=3600' });
    res.sendFile(path.join(UPLOAD_DIR, path.basename(row.image_storage_name)), error => { if (error && !res.headersSent) next(error); });
  } catch (error) { next(error); }
});

app.use((error, _req, res, _next) => {
  if (res.headersSent) return;
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Files must be 100 MB or smaller.' });
  if (error.message === 'Cover images must be PNG, JPG, or WebP.' || error.message === 'Unexpected upload field.') return res.status(400).json({ error: error.message });
  console.error(error);
  res.status(500).json({ error: 'The server could not complete that request.' });
});

app.listen(PORT, () => {
  console.log(`Marketplace running at http://localhost:${PORT}`);
  console.log(`Persistent database and uploads: ${DATA_DIR}`);
});
