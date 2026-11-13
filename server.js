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

// Files are kept outside the public web root. Only API download routes expose them.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.static(__dirname, { index: 'index.html', dotfiles: 'ignore' }));

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, UPLOAD_DIR),
  filename: (req, file, callback) => {
    const suffix = file.fieldname === 'image' ? 'cover' : 'file';
    callback(null, `${req.uploadId}-${suffix}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_ADDON_BYTES, files: 2, fields: 10, fieldSize: 10_000 },
  fileFilter: (req, file, callback) => {
    if (file.fieldname === 'image' && !imageTypes.has(file.mimetype)) {
      callback(new Error('Cover images must be PNG, JPG, or WebP.'));
      return;
    }
    if (!['file', 'image'].includes(file.fieldname)) {
      callback(new Error('Unexpected upload field.'));
      return;
    }
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

function cleanOriginalName(value) {
  const basename = path.posix.basename(String(value || '').replace(/\\/g, '/'));
  const cleaned = basename.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 180);
  return cleaned || 'download';
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
    id: row.id,
    title: row.title,
    author: row.author,
    version: row.version,
    description: row.description,
    category: row.category,
    fileName: row.file_name,
    fileSize: row.file_size,
    hasImage: Boolean(row.image_storage_name),
    createdAt: row.created_at
  };
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/addons', (_req, res) => {
  const rows = db.prepare('SELECT * FROM addons ORDER BY created_at DESC LIMIT 500').all();
  res.json({ addons: rows.map(publicAddon) });
});

app.post('/api/addons', uploadLimiter, (req, res, next) => {
  req.uploadId = crypto.randomUUID();
  upload.fields([{ name: 'file', maxCount: 1 }, { name: 'image', maxCount: 1 }])(req, res, error => {
    if (error) {
      removeUploadedFiles(req.files);
      next(error);
      return;
    }
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
      if (errors.length) {
        removeUploadedFiles(req.files);
        res.status(400).json({ error: errors.join(' ') });
        return;
      }

      db.prepare(`INSERT INTO addons (
        id, title, author, version, description, category, file_name,
        file_storage_name, file_size, file_mime, image_storage_name, image_mime
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        req.uploadId,
        title,
        author,
        version,
        description,
        category,
        cleanOriginalName(file.originalname),
        path.basename(file.filename),
        file.size,
        file.mimetype || 'application/octet-stream',
        image ? path.basename(image.filename) : null,
        image ? image.mimetype : null
      );
      const row = db.prepare('SELECT * FROM addons WHERE id = ?').get(req.uploadId);
      res.status(201).json({ addon: publicAddon(row) });
    } catch (error) {
      removeUploadedFiles(req.files);
      next(error);
    }
  });
});

app.get('/api/addons/:id/file', (req, res, next) => {
  try {
    const row = db.prepare('SELECT file_name, file_storage_name FROM addons WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Add-on not found.' });
    const filePath = path.join(UPLOAD_DIR, path.basename(row.file_storage_name));
    res.set('X-Content-Type-Options', 'nosniff');
    res.download(filePath, row.file_name, error => { if (error && !res.headersSent) next(error); });
  } catch (error) { next(error); }
});

app.get('/api/addons/:id/image', (req, res, next) => {
  try {
    const row = db.prepare('SELECT image_storage_name, image_mime FROM addons WHERE id = ?').get(req.params.id);
    if (!row || !row.image_storage_name) return res.status(404).json({ error: 'Cover image not found.' });
    const imagePath = path.join(UPLOAD_DIR, path.basename(row.image_storage_name));
    res.set({ 'Content-Type': row.image_mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=3600' });
    res.sendFile(imagePath, error => { if (error && !res.headersSent) next(error); });
  } catch (error) { next(error); }
});

app.use((error, _req, res, _next) => {
  if (res.headersSent) return;
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: 'Files must be 100 MB or smaller.' });
    return;
  }
  if (error.message === 'Cover images must be PNG, JPG, or WebP.' || error.message === 'Unexpected upload field.') {
    res.status(400).json({ error: error.message });
    return;
  }
  console.error(error);
  res.status(500).json({ error: 'The server could not complete that request.' });
});

app.listen(PORT, () => {
  console.log(`Marketplace running at http://localhost:${PORT}`);
  console.log(`Persistent database and uploads: ${DATA_DIR}`);
});
