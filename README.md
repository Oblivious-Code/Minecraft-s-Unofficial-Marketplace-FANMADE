# Free community Minecraft add-on marketplace

This fan-made marketplace lets the community upload and download files for free. Listing metadata is stored in SQLite and uploaded files on disk.

## Run locally

Requires Node.js 20 or newer.

```sh
npm install
npm start
```

Open <http://localhost:3000>. Data is stored in the `data/` directory.

## Enable AdminLogs / GitHub admin sign-in

The **AdminLogs** button is in the top navigation. Admin deletion works only after the backend verifies the authorized GitHub account; the visible button alone grants no privileges.

1. Create a GitHub OAuth App in GitHub settings. Set its Authorization callback URL to the exact callback URL used by this server, for example `http://localhost:3000/api/admin/github/callback` during local development or `https://YOUR-DOMAIN/api/admin/github/callback` in production.
2. Configure these environment variables on the Node server (never put secrets in frontend files or commit them):
   - `GITHUB_CLIENT_ID`
   - `GITHUB_CLIENT_SECRET`
   - `SESSION_SECRET` — a random secret at least 32 characters long
   - `ADMIN_GITHUB_USERNAME` — defaults to `Oblivious-Code`
   - `GITHUB_CALLBACK_URL` — optional; set this to the exact callback URL configured in your OAuth app, especially when behind a proxy
3. Restart the backend. Click **AdminLogs**, sign in to GitHub, and the backend grants admin mode only if the verified username matches `ADMIN_GITHUB_USERNAME`.

Example for macOS/Linux:

```sh
GITHUB_CLIENT_ID='your-client-id' GITHUB_CLIENT_SECRET='your-client-secret' ADMIN_GITHUB_USERNAME='Oblivious-Code' SESSION_SECRET="$(openssl rand -hex 32)" npm start
```

For a reverse-proxy deployment, set `TRUST_PROXY=1` only when the app is actually behind your trusted proxy. Use HTTPS in production; the signed, HTTP-only admin cookie expires after 8 hours. OAuth requests only ask GitHub for `read:user`. Login attempts are rate-limited. Admin deletion is authorized server-side and removes the database record and stored files.

## Deploying and safety

Deploy the Node.js app to a host with persistent disk storage; GitHub Pages cannot run this backend. Set `DATA_DIR` to persistent storage and back up the entire directory. Uploads accept any file extension, are limited to 100 MB, and are rate-limited. Anyone can submit public content, so moderate uploads and review files before making downloads public. Never run uploaded files on the server. This project is fan-made and is not affiliated with Mojang or Microsoft.
