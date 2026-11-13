# Free community Minecraft add-on marketplace

This fan-made marketplace lets the community upload and download files for free. Listing details are stored in SQLite and uploaded files on disk.

## Run locally

Requires Node.js 20 or newer.

```sh
npm install
npm start
```

Open <http://localhost:3000>. Data is stored in the `data/` directory.

## Owner admin login with GitHub

A small, low-visibility button sits at the bottom-left of the marketplace. Press it twice quickly to sign in through GitHub. Admin access is granted only when GitHub confirms the account username matches `ADMIN_GITHUB_USERNAME` (defaults to `Oblivious-Code`). A successful login shows Delete buttons; deletion is also enforced by the backend.

To enable it:

1. Create a GitHub OAuth App in your GitHub account settings. Set its Authorization callback URL to the exact URL `https://YOUR-DOMAIN/api/admin/github/callback` (for local development, use `http://localhost:3000/api/admin/github/callback`).
2. Configure these environment variables on the server. Never commit the client secret:
   - `GITHUB_CLIENT_ID`
   - `GITHUB_CLIENT_SECRET`
   - `SESSION_SECRET` (at least 32 characters; use a random value)
   - optionally `ADMIN_GITHUB_USERNAME` (defaults to `Oblivious-Code`)
   - optionally `GITHUB_CALLBACK_URL` if the app is behind a proxy or has a fixed public callback URL
3. Restart the backend. The login button appears when the OAuth settings are valid.

Example for macOS/Linux:

```sh
GITHUB_CLIENT_ID='your-client-id' GITHUB_CLIENT_SECRET='your-client-secret' ADMIN_GITHUB_USERNAME='Oblivious-Code' SESSION_SECRET="$(openssl rand -hex 32)" npm start
```

Use HTTPS in production; the admin session cookie is HTTP-only, signed, and expires after 8 hours. GitHub authorization requests only the `read:user` scope. GitHub login only works when the OAuth app and callback URL are configured; it does not detect a GitHub account already signed in to the browser without that OAuth verification.

## Deploying and safety

Deploy the Node.js app to a host with persistent disk storage; GitHub Pages cannot run this backend. Set `DATA_DIR` to persistent storage and back up the entire directory. Uploads accept any file extension, are limited to 100 MB, and are rate-limited. Anyone can submit public content, so moderate uploads and review files before making downloads public. Never run uploaded files on the server. This project is fan-made and is not affiliated with Mojang or Microsoft.
