# Free community Minecraft add-on marketplace

This fan-made marketplace lets the community upload and download files for free. Listing metadata is stored in SQLite and uploaded files on disk.

## Run not locally

Copy this |
          v

```sh
npm install
npm start
```

Open <https://ominous-winner-vp6qwj5q6gqxh6669.github.dev/>. Data is stored in the `data/` directory.
Enter 
```sh
npm install && npm start
```
In the terminal…
Then set the visibility to public by clicking … that’s right next to Terminal and press

```sh
port
```

 It should be running at https://ominous-winner-vp6qwj5q6gqxh6669-3000.app.github.dev/
Then change the visibility to public or if you can’t. Ask copilot to change it.
Otherwise run it at Localhost3000

< ## AdminLogs password login

The **AdminLogs** button is in the top navigation. Admin actions are authorized by the backend, not by the visible button. Configure the admin password as a private environment variable on the machine/host running Node:

- `ADMIN_PASSWORD` — choose a long, unique password of at least 16 characters. Do not put it in `main.js`, `index.html`, or any committed file.
- Optional `SESSION_SECRET` — a random secret of at least 32 characters. If omitted, the server generates one at startup, which means admin sessions end when the server restarts.

For local development in macOS/Linux:

```sh
export ADMIN_PASSWORD='your-long-unique-password-here'
npm start
```

In PowerShell:

```powershell
$env:ADMIN_PASSWORD = 'your-long-unique-password-here'
npm start
```

For Codespaces, add `ADMIN_PASSWORD` under your Codespaces/repository secrets, restart the Codespace, then restart the Node server. Keep the password private; anyone who can inspect the running server's environment or manage the Codespace can access it. The login endpoint is rate-limited, compares passwords safely, and issues a signed, HTTP-only session cookie that expires after 8 hours. In production, use HTTPS. Set `TRUST_PROXY=1` only when running behind a trusted reverse proxy so secure cookies work correctly.>

## Deployment and safety

Deploy the Node.js app to a host with persistent disk storage; GitHub Pages cannot run this backend. Set `DATA_DIR` to persistent storage and back up the entire directory. Uploads accept any file extension, are limited to 100 MB, and are rate-limited. Anyone can submit public content, so moderate uploads and review files before making downloads public. Never run uploaded files on the server. This project is fan-made and is not affiliated with Mojang or Microsoft.
