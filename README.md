# Free community Minecraft add-on marketplace

This fan-made marketplace lets the community upload and download files for free. The Node.js backend stores listing details in SQLite and uploaded files on disk.

## Run locally

Requires Node.js 20 or newer.

```sh
npm install
npm start
```

Open <http://localhost:3000>. Listing data and uploaded files are stored in the `data/` directory, created automatically and excluded from Git.

## Admin mode

Admin deletion is protected on the server; hiding or showing buttons in the browser is not the security boundary. Configure two environment variables before starting the server:

- `ADMIN_PASSWORD`: a strong password at least 12 characters long.
- `SESSION_SECRET`: a random secret at least 32 characters long, used to sign the admin login cookie.

Example for macOS/Linux:

```sh
ADMIN_PASSWORD='use-a-long-unique-password-here' SESSION_SECRET="$(openssl rand -hex 32)" npm start
```

On Windows PowerShell, set them for the current terminal before running `npm start`:

```powershell
$env:ADMIN_PASSWORD = 'use-a-long-unique-password-here'
$env:SESSION_SECRET = 'paste-a-random-secret-at-least-32-characters'
npm start
```

Open the site, choose **Admin login**, and enter `ADMIN_PASSWORD`. The browser receives a signed, HTTP-only, same-site cookie that expires after 8 hours. Admin mode then adds a Delete button to each listing; deleting removes its database record and uploaded files. Admin login is hidden and disabled if the variables are not configured. Never commit secrets to the repository. Use HTTPS in production; secure cookies are enabled when `NODE_ENV=production`.

## Deploying

Deploy the Node.js app to a host that supports persistent disk storage. Set `DATA_DIR` to a persistent mounted directory and `PORT` if required. Configure `ADMIN_PASSWORD` and `SESSION_SECRET` as private host environment variables, not in source files. Back up the entire data directory, including the SQLite database and uploads. GitHub Pages cannot run this backend; use a Node.js host instead.

Uploads accept any file extension and are limited to 100 MB. Optional cover images are PNG, JPEG, or WebP and limited to 3 MB. Uploads are rate-limited to 10 per IP per 15 minutes. Admin login attempts are rate-limited. Anyone can submit public content, so only expose the marketplace publicly if you are prepared to moderate uploads and manage storage. Review files before opening downloads; never run uploaded files on the server.

SQLite and local disk are suitable for a small deployment. For larger traffic or multiple app instances, use a managed database and object storage with persistent shared services. This project is fan-made and is not affiliated with Mojang or Microsoft.
