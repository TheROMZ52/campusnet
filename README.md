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

## Persian (v0.10)
The whole interface is available in Persian (فارسی) and English. The language follows your browser the first time; change it with the button on the sign-in screen or in Settings > Language (the page reloads and your session continues). In Persian the content of windows and chat is right-to-left with the Vazirmatn font (served from `public/fonts/`, SIL Open Font License, see `Vazirmatn-OFL.txt`), messages use automatic text direction so mixed Persian/English lines read correctly, and dates use the Persian calendar. The window frame (title bars, launcher, taskbar) keeps its left-to-right layout. The terminal intentionally keeps English commands and output.

Adding or changing text: wrap UI text in `tr('English text {name}', { name })` (or `trn(n, 'one', 'many')`) and add the Persian version to `FA` in `public/i18n.js`. English is the key and the fallback. `npm test` fails if a `tr()` text, a page text in `index.html` or a server message has no Persian entry, or if a translation loses a `{placeholder}`.

## Home, Music, reload and Back (v0.9)
- **Home** is the first window on a fresh desktop: greeting, live counters, shortcuts to every app, the player, unread conversations, alerts, latest posts and the newest announcement. It is also what Back lands on.
- **Music** is a separate app. Every audio file shared on the network (mp3, ogg, opus, wav, m4a, aac, flac) is in the library; upload from the Music window, play, seek, shuffle, repeat, volume. The player keeps playing when the window is closed and the track shows in the system media controls. Playback streams from the server with HTTP byte ranges. Pick a **profile song** (Music or People > Your profile): others see it on your profile in People search and can play it. A deleted file disappears from profiles.
- **Reload:** the session survives a page reload (the token lives in the tab's sessionStorage). Your encryption key does not: after a reload a bar asks for your password to unlock encrypted messages, until then DMs show as locked and are still counted as unread. The open conversation is restored. If the server restarted, you are asked to sign in again.
- **Back/Forward** move between conversations and Home and never leave the app; links like `#/c/d/alice` or `#/c/r/general` open that conversation.
- Blocked people never reach you in channels: the server filters live messages and history for you.

## Messaging and social (v0.7)
- **Messages:** reply, edit (own), delete (own; admins can delete channel messages), emoji reactions, pinned channel messages (admins, max 5 per channel), per-conversation mute. Hover a message (always visible on touch screens) for its actions. `Esc` cancels reply/edit. Replies and edits in direct messages are encrypted like the message itself.
- **Read receipts and unread:** each conversation stores a "read up to" time on the server, so unread badges survive reloads and other devices. Direct messages show a check mark when sent and two when the other person has read them. You can turn receipts off in People > Your profile (then you neither send nor see them).
- **People:** display name, bio and a small avatar (resized in the browser to 64x64), search by name, follow/unfollow and block. Blocking stops direct messages both ways, removes follows and hides the person from your lists, search and feed.
- **Feed:** posts up to 500 characters from everyone or only people you follow, newest first, 20 per page with "Load more", likes, delete own posts.
- **Alerts:** follows, likes, reactions, replies and @mentions, stored on the server until you read them.
- Channels, the feed, profiles and reactions are **not** end-to-end encrypted. Reactions on direct messages are visible to the server (which emoji, by whom), the message text is not.

## Groups and communities (v0.8)
Open the Groups window to create a group (public: anyone can find and join; or invite-only), discover public groups, and manage members. Roles are enforced by the server: **owner** (everything, including roles, rename, delete), **moderator** (invite, remove members, delete messages, pin) and **member** (post, react, reply, edit own). Group messages go only to members and have the same features as channels (reply, edit, reactions, pins, mute, unread). Groups are **not end-to-end encrypted**: the server stores their messages in `groups.json`. An owner cannot leave (delete the group instead), a group has at most 200 members and a user can own at most 10 groups.

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
- **Direct messages:** end-to-end encrypted in the browser (ECDH P-256 + AES-GCM). The private key is stored locked with your password. The server stores and forwards ciphertext only. Keys are trusted on first use (TOFU); in Security, paste your contact's safety number into the compare box to verify them. Public rooms, the board and files are **not** end-to-end encrypted.
- **Music:** audio files are ordinary shared files, readable by every signed-in user; the audio stream endpoint checks the same session cookie and never serves non-audio files inline.
- **Social data:** profiles, posts, follows, blocks, read positions and notifications are stored in plain JSON on the server and visible to the operator. Avatars are accepted only as small png/jpeg/webp data URLs (never SVG). All user text is inserted as plain text, never as HTML. Blocks are enforced on the server for direct messages and feed; hiding blocked people's channel messages is done in your browser.
- Anyone signed in can download any shared file. Set `ACCESS_CODE` when the server is public and do not share secrets in files.
- Use HTTPS when online, otherwise passwords travel unencrypted.

## Backup and restore
All state is in `DATA_DIR` (default `./data`): `users.json` (accounts, profiles, follows, blocks, read positions, mutes), `messages.json`, `dms.json` (ciphertext), `notices.json`, `posts.json`, `notifs.json`, `groups.json`, `files.json`, `uploads/`, plus a `.bak` copy of each JSON file from the previous write.
- **Backup:** stop the server (or use a filesystem snapshot), then copy the whole `DATA_DIR`. Copying while it runs can capture `files.json` and `uploads/` at slightly different moments.
- **Restore:** stop the server, replace `DATA_DIR` with the backup, start it again. If a JSON file is corrupt the server falls back to its `.bak` and keeps the corrupt file for inspection.
- Back up `users.json` together with `dms.json`: DMs can only be read with the users' passwords, which unlock their keys.

## Terminal and monitor
Every terminal command is real: `ping` (HTTP and WebSocket round trip), `diag` (server uptime and connections from `/healthz`, HTTP and WebSocket latency, clock difference to the server, secure-context and encryption state), `scan`, `files`, `whoami`, `uptime`, `status`, `w`, `open`. The Monitor shows only live values from your session. In `?demo` mode nodes, replies and latency are simulated in the browser and both windows say so.

## Tests
GitHub Actions (`.github/workflows/ci.yml`) runs both suites on every push.
`npm test` runs the server integration tests (55, no browser). `npm run test:e2e` (24 tests) drives the real UI in Chromium with Playwright (needs a Chromium: set `PW_CHROMIUM=/path/to/chrome` or run `npx playwright-core install chromium`). Both start their own server on a temp data dir.

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
