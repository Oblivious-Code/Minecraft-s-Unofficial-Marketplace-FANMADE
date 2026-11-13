# Free community Minecraft add-on marketplace

This is a fan-made community marketplace for sharing and downloading files for free. The Node.js backend serves the site, stores listing details in SQLite, and saves uploaded files on disk so visitors to the same deployed instance can see and download them.

## Run locally

Requires Node.js 20 or newer.

```sh
npm install
npm start
```

Open <http://localhost:3000>. Uploaded listing data and files are stored in the `data/` directory, which is created automatically and excluded from Git.

## Deploying

Deploy the Node.js app to a host that supports persistent disk storage. Set `DATA_DIR` to a persistent mounted directory and `PORT` if your host requires it. Back up the entire data directory: it contains both `marketplace.sqlite` and the uploaded files. GitHub Pages is static hosting and cannot run this backend; use a Node.js host instead.

The API supports listing add-ons (`GET /api/addons`), uploading (`POST /api/addons`, multipart form fields), and downloading (`GET /api/addons/:id/file`). Uploads accept any file extension and are limited to 100 MB; optional cover images are PNG, JPEG, or WebP and limited to 3 MB. Uploads are rate-limited to 10 per IP per 15 minutes. Files are stored outside the public web directory and only made available through the download endpoint.

## Important notes

- This starter does not include user accounts, moderation, or an admin deletion interface. Anyone can submit public content, so only expose it publicly if you are prepared to moderate uploads and manage storage.
- The rate limit is a basic abuse guard, not a complete spam or malware defense. Review files before opening downloads to the public; do not run uploaded files on the server.
- SQLite and local disk are appropriate for a small deployment. For larger traffic or multiple app instances, use a managed database and object storage with persistent shared services.
- This project is fan-made and is not affiliated with Mojang or Microsoft.
