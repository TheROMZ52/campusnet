# CampusNet

A private, futuristic file-and-chat network for a LAN or the internet. Netrunner-style interface (black glass panels, neon green, live node map), accounts, channels, private chat, a broadcast board and fast file sharing. Node.js + WebSocket, one dependency.

## Features
- Accounts: pick a username and password the first time; that name is yours (passwords are hashed with scrypt)
- Channels (`#general`, `#random`, `#help`) with history, plus a notice board that only admins can post to
- Private 1:1 chat, end-to-end encrypted in the browser (see below), also to people who are offline (kept in server memory only, never on disk)
- Desktop shell on large screens: menubar, app launcher, movable/resizable windows, dock, plus Terminal, Monitor, Security and Settings apps
- Status (online / away / busy), "is typing...", unread badges, sound on DMs and @mentions
- File sharing: drag and drop or paste, progress bar, image previews, search, download, delete
- Links become clickable, `@name` highlights mentions, you can delete your own messages
- Search inside a chat, light/dark theme, phone-friendly tabs
- Slash commands: `/help`, `/me`, `/w user msg`, `/users`, `/admin code`, `/clear`
- Live node map: a real-time topology of who is online (click a node to open a private chat)
- Transfers with progress, speed, ETA, cancel, and a library with previews
- Connection state with measured latency, automatic reconnect with countdown
- Mobile-first: bottom navigation on phones, two-column layout on tablets, three panes on desktop
- Respects `prefers-reduced-motion`; keyboard friendly (`/` focuses the message box, `Esc` closes dialogs)
- One dependency (`ws`)

## Desktop (screens 1180px and wider)
After sign-in you land on an empty desktop whose wallpaper is the live map of online nodes. Apps open as windows from the icons on the left or the Start menu: Messages (channels and people inside), Network, Files, Board. Windows can be dragged, resize, minimize, maximize (double-click the title) and close; reopen them from the launcher on the left or the dock at the bottom. The layout is remembered in your browser (View > Tile windows resets it). Extra apps:
- **Terminal**: `help`, `whoami`, `scan`, `files`, `ping`, `uptime`, `status`, `w <user> <msg>`, `open <#room|user|board>`
- **Monitor**: live link state, measured latency graph, nodes, library size, unread, session time
- **Security**: your safety number, your contacts' safety numbers and trust state
- **Settings**: CRT effect, animated background, sounds, forget trusted keys
On phones and tablets the tabbed layout is used and the apps open full screen from the grid button in the top bar.

## Encrypted direct messages
Direct messages are encrypted in your browser with ECDH (P-256) + AES-256-GCM (Web Crypto, no dependencies). Each account has a key pair created on first sign-in; the private key is wrapped with a key derived from your password (PBKDF2) and stored on the server only as an opaque blob, so you can sign in from any device. The server relays ciphertext and rejects plaintext DMs.

Browsers only offer Web Crypto on **HTTPS or localhost**. On a LAN over plain `http://192.168...` encrypted DMs are disabled (the UI says so). Fix: start with `HTTPS=1 npm start` (creates a self-signed certificate with openssl, then open the `https://` address and accept the browser warning once), or set `TLS_CERT` and `TLS_KEY`, or put it behind a TLS proxy.

What it protects, and what it does not:
- Protects DM content from other users, server logs, memory dumps and network sniffing.
- Does not hide who talks to whom, when, or how much. Channels, files and notices are not encrypted.
- A malicious server operator could swap a public key or serve modified code. Compare **safety numbers** (Security app) with your contact over another channel; the app warns and blocks sending if a contact's key changes.
- There is no password reset: the key is protected by your password. If the stored key cannot be unlocked a new one is created and your contacts see a key change.

## Preview the look (no server needed)
Open `public/index.html?demo` in a browser (double-click works, or use the GitHub Pages link of the repo). The real interface runs against a simulated in-browser network: any username and password work, bots chat, uploads and notices are simulated, and a yellow DEMO badge is always shown. Nothing is stored and downloads are disabled. Without `?demo` the page talks to the real server.

## Run on your LAN
```bash
npm install
npm start
```
The console prints a `network:` address like `http://192.168.1.20:3000`. Anyone on the same network opens it. If they cannot connect, allow Node.js through your firewall (port 3000).

## Settings (environment variables)
| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | Port |
| `SITE_NAME` | `CampusNet` | Name shown in the UI |
| `ACCESS_CODE` | none | Shared code required to join (recommended when online) |
| `ADMIN_USERS` | none | Comma-separated usernames that are admins (post notices, delete anything) |
| `ADMIN_CODE` | none | `/admin <code>` makes a signed-in user admin for the session |
| `HTTPS` | off | Set to `1` to serve HTTPS with an auto-created self-signed certificate (needs openssl) |
| `TLS_CERT`, `TLS_KEY` | none | Paths to your own certificate and key |
| `TRUST_PROXY` | off | Set to `1` behind a reverse proxy so login throttling sees real IPs |
| `MAX_FILE_MB` | `100` | Max size per file |
| `MAX_STORAGE_MB` | `2000` | Max total upload storage |
| `DATA_DIR` | `./data` | Where chat history and uploads are kept |

Example (Linux/macOS): `ACCESS_CODE=secret MAX_FILE_MB=200 npm start`
Windows (PowerShell): `$env:ACCESS_CODE="secret"; npm start`

## Run online
You need a host that runs Node.js with a persistent disk: a VPS, Railway, Render, Fly.io, or any Docker host. Static-only hosts (GitHub Pages, InfinityFree) cannot run it.

```bash
docker build -t campusnet .
docker run -d -p 3000:3000 -e ACCESS_CODE=secret -v campusnet-data:/data campusnet
```
Put it behind HTTPS (Caddy, nginx, or your host's built-in TLS). The client automatically uses `wss://` on HTTPS pages.

## Security
**Threat model.** CampusNet is built for a trusted-ish LAN or a small public server run by someone you know. It defends against: other users trying to crash the server, claim the admin name, read other people's files or DMs, exhaust disk space, or brute-force logins; and against passive network observers (when HTTPS is used). It does **not** defend against a malicious server operator (they serve the client code and receive your password at sign-in), a compromised browser or device, or traffic analysis (who talks to whom and when is visible to the server).

What is in place:
- **Accounts:** scrypt hashes (versioned, old hashes upgrade on login), 8+ character passwords for new accounts, generic login error (no account enumeration), per-name and per-IP throttling. No password reset: delete the user from `data/users.json` while the server is stopped.
- **Admin:** names listed in `ADMIN_USERS` can only be registered with `ADMIN_CODE` (the server refuses to start with `ADMIN_USERS` but no `ADMIN_CODE`). Names like `system` and `admin` are reserved.
- **Sessions:** random tokens, absolute (`SESSION_HOURS`) and idle (`SESSION_IDLE_HOURS`) expiry, revoked on sign-out. Sessions live in server memory, so a restart signs everyone out.
- **Downloads:** served with an HttpOnly, SameSite=Strict cookie, so the token is never in a URL. Files are sent as downloads; only png/jpg/gif/webp preview inline (SVG is never rendered).
- **Uploads:** size and per-user and total quotas are enforced while streaming (also for concurrent uploads), stalled uploads are cut, partial files are removed.
- **Server robustness:** WebSocket origin check, per-IP connection limit, sign-in timeout, message rate limit, handler errors contained, `/healthz`, graceful shutdown (data flushed on SIGTERM).
- **Direct messages:** end-to-end encrypted in the browser (ECDH P-256 + AES-GCM). The private key is stored locked with your password. The server stores and forwards ciphertext only. Keys are trusted on first use (TOFU); compare the safety number in Security to verify a contact. Public rooms, the board and files are **not** end-to-end encrypted.
- Anyone signed in can download any shared file. Set `ACCESS_CODE` when the server is public and do not share secrets in files.
- Use HTTPS when online, otherwise passwords travel unencrypted.

## Backup and restore
All state is in `DATA_DIR` (default `./data`): `users.json`, `messages.json`, `dms.json` (ciphertext), `notices.json`, `files.json`, `uploads/`, plus a `.bak` copy of each JSON file from the previous write.
- **Backup:** stop the server (or use a filesystem snapshot), then copy the whole `DATA_DIR`. Copying while it runs can capture `files.json` and `uploads/` at slightly different moments.
- **Restore:** stop the server, replace `DATA_DIR` with the backup, start it again. If a JSON file is corrupt the server falls back to its `.bak` and keeps the corrupt file for inspection.
- Back up `users.json` together with `dms.json`: DMs can only be read with the users' passwords, which unlock their keys.

## Tests
`npm test` runs the server integration tests (no browser). `npm run test:e2e` drives the real UI in Chromium with Playwright (needs a Chromium: set `PW_CHROMIUM=/path/to/chrome` or run `npx playwright-core install chromium`). Both start their own server on a temp data dir.

## Files
| File | Purpose |
| --- | --- |
| `server.js` | HTTP, WebSocket, uploads, persistence |
| `public/index.html` | Markup (gate, shell, dialogs) |
| `public/style.css` | Design system: tokens, primitives, layout, motion |
| `public/app.js` | UI logic and WebSocket protocol |
| `public/net.js` | Background mesh and live topology canvas |
| `public/crypto.js` | End-to-end encryption helpers (Web Crypto) |
| `public/shell.js` | Desktop shell: windows, launcher, menubar, dock, system apps |
| `public/demo.js` | Preview mode with a simulated network |
| `Dockerfile` | Container build |

## License
MIT
