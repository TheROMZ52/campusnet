# Deploying CampusNet

CampusNet is one Node.js process with **no runtime dependencies to install** (the only library, `ws`, is vendored in `vendor/ws`).
Deploying needs no npm registry, no git host and no build step, so it also works when the international internet is unreachable.

## 1. What the host must provide
- Node.js 20 or newer (22 recommended) and the ability to run a long-lived process (it must not be killed after a few minutes).
- **WebSocket** support (live chat does not work without it). Ask the provider if unsure.
- A **persistent writable directory** that survives restarts and redeploys (see `DATA_DIR`).
- HTTPS (a free certificate on the provider's subdomain is fine). Without HTTPS the browser disables the encryption used for direct messages.

## 2. Build the package
```
npm run pack
```
This writes `dist/campusnet-<version>.zip` (about 250 KB). Files are at the zip root and `server.js` is the start file. You do not need Node to be installed on your machine to unzip it, and the server needs no `npm install`.

## 3. Upload and configure
Upload the zip (or point the platform at the repository). Start file: `server.js`. Leave "extra packages" and "build command" empty.

| Variable | Meaning |
|---|---|
| `PORT` | Set by most platforms. The server must listen on it (it does). |
| `DATA_DIR` | **Set this to a persistent path.** Accounts, messages and uploaded files live here. If it points inside the app folder and the platform replaces that folder on each start, everything is lost. |
| `TRUST_PROXY=1` | Set when the platform puts a reverse proxy in front (almost always). Needed to see real client addresses for rate limits. Only safe if the proxy overwrites `X-Forwarded-For`. |
| `ADMIN_USERS`, `ADMIN_CODE` | Names that may only be registered with the code, and the code. Set both. |
| `ACCESS_CODE` | Optional code every new user must enter. Set it on a public server. |
| `CALL_RING_MS` | How long a call rings before it counts as missed (default 45000). |
| `SITE_NAME` | Name shown in the UI. |
| `MAX_STORAGE_MB`, `MAX_USER_MB`, `MAX_FILE_MB` | Upload limits. Keep `MAX_STORAGE_MB` below the real disk size. |

Voice calls relay audio through the server (about 16 KB/s per active call), so they use bandwidth but need no extra ports.

## 4. First-run checklist
1. Open the site over `https://`. The sign-in page should load.
2. Register an account. The link indicator must say **online** (that proves WebSocket works).
3. Restart the app from the control panel and sign in again. **The account must still exist**, otherwise `DATA_DIR` is not persistent.
4. `https://<your-address>/healthz` returns `{"ok":true,...}`.
5. Try the same from a phone on mobile data.

## 5. Updating and backups
- Update: build a new zip and upload it. Data stays as long as `DATA_DIR` is outside the uploaded folder.
- Backup: copy the whole `DATA_DIR` (see "Backup and restore" in the README).

## 6. If the international internet is cut
- Everything is served from your server; the page loads no third-party scripts, fonts or images.
- Redeploys and restarts work because nothing is downloaded.
- Certificates and domain DNS are managed by the provider; ask how renewal works when outbound internet is limited and renew early.
- Users on the domestic network reach the site as usual. Remember the server is in the hands of its host: direct messages are end-to-end encrypted, channels, groups, feed, profiles and files are not.

## Docker
`docker build -t campusnet . && docker run -p 3000:3000 -v campusnet-data:/data -e TRUST_PROXY=1 -e ADMIN_USERS=you -e ADMIN_CODE=... campusnet`
