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
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';
const ADMIN_GITHUB_USERNAME = (process.env.ADMIN_GITHUB_USERNAME || 'Oblivious-Code').replace(/^@/, '').toLowerCase();
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const ADMIN_ENABLED = Boolean(GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET && SESSION_SECRET.length >= 32 && ADMIN_GITHUB_USERNAME);
const ADMIN_COOKIE = 'marketplace_admin';
const OAUTH_STATE_COOKIE = 'marketplace_oauth_state';
const ADMIN_COOKIE_MAX_AGE = 8 * 60 * 60 * 1000;
const OAUTH_STATE_MAX_AGE = 10 * 60 * 1000;

if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
if (!ADMIN_ENABLED) console.warn('Admin mode is disabled. Configure GitHub OAuth credentials and SESSION_SECRET (32+ characters).');

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

const uploadLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Upload limit reached. Please try again in a little while.' } });
const oauthLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many admin login attempts. Try again in a little while.' } });

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
  return { id: row.id, title: row.title, author: row.author, version: row.version, description: row.description, category: row.category, fileName: row.file_name, fileSize: row.file_size, hasImage: Boolean(row.image_storage_name), createdAt: row.created_at };
}

function parseCookies(header) {
  const cookies = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    try { cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim()); } catch { /* Ignore malformed cookies. */ }
  }
  return cookies;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function signature(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
}

function signedValue(value) { return `${value}.${signature(value)}`; }

function verifySignedValue(value) {
  if (!value) return null;
  const separator = value.lastIndexOf('.');
  if (separator < 1) return null;
  const payload = value.slice(0, separator);
  return safeEqual(value.slice(separator + 1), signature(payload)) ? payload : null;
}

function sessionFor(req) {
  if (!ADMIN_ENABLED) return null;
  const signed = parseCookies(req.headers.cookie || '')[ADMIN_COOKIE];
  const payload = verifySignedValue(signed);
  if (!payload) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (session.username !== ADMIN_GITHUB_USERNAME || !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()) return null;
    return session;
  } catch { return null; }
}

function isAdmin(req) { return Boolean(sessionFor(req)); }

function requestOriginMatches(req) {
  const origin = req.get('origin');
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    return parsed.host === req.get('host') && parsed.protocol === `${req.protocol}:`;
  } catch { return false; }
}

function requireAdmin(req, res, next) {
  if (!ADMIN_ENABLED) return res.status(503).json({ error: 'GitHub admin login is not configured on this server.' });
  if (!isAdmin(req)) return res.status(401).json({ error: 'Admin login required.' });
  if (!requestOriginMatches(req) || req.get('x-admin-action') !== 'true') return res.status(403).json({ error: 'Request could not be verified. Reload the page and try again.' });
  next();
}

function cookieOptions(maxAge, sameSite = 'lax') {
  return { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite, maxAge, path: '/' };
}

function oauthCallbackUrl(req) {
  return process.env.GITHUB_CALLBACK_URL || `${req.protocol}://${req.get('host')}/api/admin/github/callback`;
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/admin/status', (req, res) => {
  const session = sessionFor(req);
  res.json({ enabled: ADMIN_ENABLED, authenticated: Boolean(session), username: session?.username || null });
});

app.get('/api/admin/github', oauthLimiter, (req, res) => {
  if (!ADMIN_ENABLED) return res.status(503).send('GitHub admin sign-in is not configured on this server.');
  const state = crypto.randomBytes(32).toString('base64url');
  res.cookie(OAUTH_STATE_COOKIE, signedValue(state), cookieOptions(OAUTH_STATE_MAX_AGE));
  const authorizeUrl = new URL('https://github.com/login/oauth/authorize');
  authorizeUrl.searchParams.set('client_id', GITHUB_CLIENT_ID);
  authorizeUrl.searchParams.set('redirect_uri', oauthCallbackUrl(req));
  authorizeUrl.searchParams.set('scope', 'read:user');
  authorizeUrl.searchParams.set('state', state);
  res.redirect(authorizeUrl.toString());
});

app.get('/api/admin/github/callback', oauthLimiter, async (req, res) => {
  const stateCookie = parseCookies(req.headers.cookie || '')[OAUTH_STATE_COOKIE];
  const expectedState = verifySignedValue(stateCookie);
  const returnedState = String(req.query.state || '');
  res.clearCookie(OAUTH_STATE_COOKIE, cookieOptions(0));
  if (!expectedState || !returnedState || !safeEqual(expectedState, returnedState) || req.query.error || typeof req.query.code !== 'string') {
    return res.status(400).send('GitHub sign-in was cancelled or could not be verified. Return to the marketplace and try again.');
  }
  if (!ADMIN_ENABLED) return res.status(503).send('GitHub admin sign-in is not configured on this server.');

  try {
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'Minecraft-Addon-Marketplace' },
      body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, client_secret: GITHUB_CLIENT_SECRET, code: req.query.code, redirect_uri: oauthCallbackUrl(req) })
    });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token) return res.status(401).send('GitHub sign-in could not be completed. Please try again.');

    const userResponse = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Minecraft-Addon-Marketplace' }
    });
    if (!userResponse.ok) return res.status(401).send('GitHub could not verify the signed-in account. Please try again.');
    const githubUser = await userResponse.json();
    const username = String(githubUser.login || '').toLowerCase();
    if (username !== ADMIN_GITHUB_USERNAME) return res.status(403).send('This GitHub account is not authorized to administer this marketplace.');

    const sessionPayload = Buffer.from(JSON.stringify({ username, expiresAt: Date.now() + ADMIN_COOKIE_MAX_AGE })).toString('base64url');
    res.cookie(ADMIN_COOKIE, signedValue(sessionPayload), cookieOptions(ADMIN_COOKIE_MAX_AGE, 'strict'));
    res.redirect('/');
  } catch (error) {
    console.error('GitHub OAuth request failed:', error);
    res.status(502).send('Could not reach GitHub to complete sign-in. Please try again later.');
  }
});

app.post('/api/admin/logout', requireAdmin, (_req, res) => {
  res.clearCookie(ADMIN_COOKIE, cookieOptions(0, 'strict'));
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

      db.prepare(`INSERT INTO addons (id, title, author, version, description, category, file_name, file_storage_name, file_size, file_mime, image_storage_name, image_mime)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        req.uploadId, title, author, version, description, category, cleanOriginalName(file.originalname), path.basename(file.filename), file.size,
        file.mimetype || 'application/octet-stream', image ? path.basename(image.filename) : null, image ? image.mimetype : null
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
    for (const storedName of [row.file_storage_name, row.image_storage_name]) {
      if (!storedName) continue;
      try { fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(storedName))); } catch (error) {
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
