# Release notes

## v0.14.0 - installable app, opens offline
- **PWA:** web app manifest (served by the server so the name follows `SITE_NAME`), icons (192, 512, maskable, Apple touch, SVG), and a service worker (`public/sw.js`) that precaches the app shell. With no network the page opens styled and working (sign-in screen, language switch); chat reconnects when the network returns. The worker only answers listed shell files: uploads, downloads, range requests, `/api/*` and WebSocket traffic are never touched.
- Page loads are network-first with a 3.5 s limit, then the saved copy; shell files come from the cache and refresh in the background. The cache name is `cn-<version>`, old caches are deleted on activation, and a toast says when a new version has taken over.
- Settings > **Install app** (when the browser offers installation) and iPhone steps; Persian texts added.
- Needs HTTPS or `localhost` (browser rule). Over plain `http://` on a LAN nothing changes and the app is not installable.
- Docs: README (English and Persian), `DEPLOY.md` / `DEPLOY.fa.md` (HTTPS also enables install, how updates arrive). **Remember to bump `VERSION` in `public/sw.js` with every release**: a test fails if it differs from `package.json`.
- Tests: `npm test` 97 (6 new in `tests/pwa.test.js`: manifest and icon sizes, every precached file is served, the precache covers every script/style/font the page loads, version match), `npm run test:e2e` 47 (6 new in `tests/e2e/pwa.test.js`: worker installs and fills the versioned cache, the page opens offline styled and interactive, it does not without the worker, signed-in offline reload has no script errors, install button appears only when offered and opens the prompt).
- Not done: push notifications and background sync (needs the Android app), offline reading of old messages, testing installation on real phones and in Iranian networks.

## v0.13.0 - admin tools, account settings, backups
- **Admin app** (administrators only, hidden from everyone else, every action re-checked on the server): users (search, suspend / restore, reset password with a one-time temporary password and a new encryption identity, delete with cleanup of files, messages, posts and owned groups), server status with **close / open registration**, and backups.
- **Settings > Account:** change your password (the private-message key is re-locked with the new password instead of being replaced, so old private messages stay readable) and delete your own account (password required; administrators cannot delete theirs). After an administrator reset you are asked to choose a new password at sign-in.
- **Backups:** automatic zip backups in `DATA_DIR/backups` (`BACKUP_EVERY_HOURS`, default 24, `0` = off; `BACKUP_KEEP`, default 7), manual backup and download from the Admin app, download only for administrators (`/f/backup/<name>`), and `scripts/restore.js` (stop the server first; old files are moved aside, not deleted). Backups do not include uploaded files: copy `DATA_DIR/uploads` separately.
- New: `lib/zip.js` (zip writer and reader, no dependencies), Persian and English texts for all new screens.
- Docs: README (Admin and backups, `BACKUP_*`), `DEPLOY.md` and `DEPLOY.fa.md` (backup, restore, copying `uploads`).
- Tests: `npm test` 91 (13 new in `tests/admin.test.js`), `npm run test:e2e` 41 (9 new in `tests/e2e/admin.test.js`: Admin tile only for administrators, suspend / restore, reset password and temporary password then forced change, closing registration, backup download only for administrators, **private messages still readable after changing the password and signing in again**, wrong password / mismatch, deleting your own account). That last test was checked against a deliberately broken version (old key blob sent) and fails there.
- Not done: restoring from the Admin window (use the script), backing up uploaded files, testing the Admin window on a phone-sized screen.

## v0.12.1 - debugging pass
Found with static analysis (ESLint), a protocol fuzzer (about 25 000 hostile messages), an HTTP path/method/range probe and small-screen layout checks. Every fix below has a test that fails without it.
- **Security: rate limits could be bypassed behind a proxy.** `TRUST_PROXY` used the *first* `X-Forwarded-For` entry, which a client can forge, so the per-address limits on sign-ups and logins could be sidestepped. It now counts trusted proxies from the end of the header (`TRUST_PROXY=1` one proxy, `2` two). See DEPLOY.md
- **`npm start` (your change) made safe for hosting.** It now runs `scripts/start.js`: same behaviour on a personal machine (creates and loads `.env`, HTTPS with a self-signed certificate), but on a host (`PORT`/`TRUST_PROXY` set, or `NODE_ENV=production`) it stays on plain HTTP behind the platform proxy. Before, from the deployment zip it crashed with `.env: not found`, and with a platform-provided `PORT` it served HTTPS where the proxy expects HTTP. `.env.example` and `scripts/start.js` are in the zip
- **Calls:** signing in again with the same name, or resuming the session with its token, during a call left the other person in a call that could never carry audio; it now ends with "disconnect"
- **Hostile values:** objects without `toString` in message fields made handlers throw (`gkick`, `gleave` and others logged errors); all string coercion of client data now goes through one safe helper
- **Layout:** the top bar pushed the page sideways on narrow screens (Persian at 390 px by 11 px, English at 320 px by 65 px); it now shrinks. A layout test checks 10 apps at 320/390 px in both languages
- **Profile photo race:** pressing Save right after choosing a photo could send the profile without the photo (the photo is resized asynchronously); Save now waits for it. Found because a browser test failed under load
- Cleanup: duplicate translation key removed
- Checked and fine: no path traversal or hidden-file exposure over HTTP, uploads are stored under random ids, odd byte ranges and methods are handled, no undefined variables or cross-file redeclarations in the client, the server stayed up under the fuzzer with no error logged
- Tests: `npm test` 78 (13 new), `npm run test:e2e` 32 (4 new)
- Not fixed: three unused variables in client code (harmless)

## v0.12.0 - voice calls
- One-to-one voice calls from the header of a direct message: ring, Accept / Decline, mute, end, call timer, missed-call alert. Works over the existing WebSocket (no UDP, STUN or TURN), so it runs on any host with WebSocket support
- 8 kHz telephone-quality voice (about 8 KB/s each way) captured and played with AudioWorklet processors and a small jitter buffer (`public/call-worklet.js`)
- Every audio frame is encrypted in the browser (AES-256-GCM, the pairwise DM key, per-call nonce and direction, replay protection by sequence number); the server relays ciphertext only. Calls refuse to start if the key is locked or the contact's key changed
- Server: `call`, `callans`, `callend` signaling, `incoming` / `callstate` events, binary relay with size, rate (80 frames/s) and backpressure limits, cleanup on disconnect, `CALL_RING_MS`. `Permissions-Policy` now allows the microphone for the app itself
- Fixed while testing: calling a user whose connection had dropped rang for 45 s instead of reporting "offline"
- Persian translations for all call texts. The browser E2E suite now runs two test files at a time (`--test-concurrency=2`) to avoid timing flakiness
- Tests: `npm test` 65 (7 new for signaling and relay), `npm run test:e2e` 28 (4 new with a fake microphone: encrypted audio flows both ways and is played, mute stops frames, decline/cancel/offline, locked key refuses to call)
- Not done: group calls, Opus codec (higher quality at lower bandwidth), reconnecting a call after a network drop, testing on real phones, networks and echo conditions

## v0.11.0 - deployment that works offline
- **No runtime dependencies to install:** `ws` is vendored in `vendor/ws` (MIT, version in its package.json) and `package.json` has an empty `dependencies`. A host that runs `npm install` on every start no longer needs the npm registry
- `npm run pack` builds `dist/campusnet-<version>.zip` (about 250 KB, files at the root, start file `server.js`) with a built-in zip writer, no external tools. Tests, data, CI files and `node_modules` are left out
- New `DEPLOY.md` and `DEPLOY.fa.md`: host requirements (WebSocket, persistent `DATA_DIR`, HTTPS), environment variables, first-run checklist (including "restart and check the account is still there"), updates, backups, and notes for when the international internet is cut
- Tests: `npm test` 58 (3 new: the zip has the right files at its root, no runtime dependencies, and the extracted zip starts with no `node_modules`, serves the page, answers `/healthz` and accepts a WebSocket sign-up). The 55 server tests also pass with `node_modules` removed
- Not done: voice calls, PWA/service worker caching

## v0.10.0 - Persian interface
- Full Persian translation of the UI (sign-in, desktop, Home, Messages, Groups, Music, People, Feed, Alerts, Files, Monitor, Security, Settings, dialogs, toasts) and of the server's error messages. Language: browser default, button on the sign-in screen, Settings > Language
- Right-to-left content with the Vazirmatn font (bundled, OFL), automatic direction for each chat message, Persian calendar and digits for dates. Window chrome stays left-to-right. The terminal stays English on purpose
- New `public/i18n.js` (`tr()`, `trn()`, dictionary) and `data-app` on launcher tiles
- Fixes: Home asked the server for the feed before sign-in (an error toast on the sign-in screen), the server's "session ended" text is now fixed text plus a `reason` field so it can be translated
- Tests: `npm test` 55 (5 new translation-integrity tests: every `tr()` text, page text and server message must have a Persian entry with matching placeholders), `npm run test:e2e` 24 (4 new: Persian gate/Home/chat, Persian server errors, language switch)
- Not done: right-to-left mirroring of the window frame, plural rules beyond one/many, translating the terminal

## v0.9.0 - Home, Music, reload and Back
- New **Home** page (first window of a fresh desktop and the target of Back): live counters, shortcuts, now playing, unread, alerts, latest posts, announcement
- New **Music** app: shared audio library, upload, streaming with HTTP byte ranges (seek), shuffle/repeat/volume, system media controls, keeps playing when closed. **Profile song** shown to others in People
- **Reload fixed**: the session continues after a refresh, the open conversation is restored, only the encryption key asks for the password again (unlock bar). Unread counts include still-locked DMs. Boot animation is skipped on resume. A stale session falls back to the login screen with a message
- **Back/Forward fixed**: in-app history (conversations and Home), the browser never leaves the app; deep links `#/c/d/<user>`, `#/c/r/<room>`
- Fixes: my avatar style clashed with the header avatar (5 px sideways scroll on phones), blocked users' channel messages are now filtered on the server (live and history), Groups > Discover has a Refresh button
- CI: GitHub Actions runs `npm test` and `npm run test:e2e`
- Server: `?audio=1` downloads (206/416 ranges, audio content types, inline), `aud` flag on files, `music` in profiles
- Tests: `npm test` 50, `npm run test:e2e` 20 (new: Home content, music upload/playback/profile song, reload + unlock + Back)
- Not done: QR code key verification (needs an encoder library), end-to-end encrypted groups (needs a protocol design), a Home layout for phones that opens by default

## v0.8.0 - groups, diagnostics, key verification
- Groups and communities: public or invite-only, roles owner / moderator / member enforced on the server, invite, remove, promote, rename, delete, discover and join; same message features as channels (reply, edit, reactions, pins, mute, persistent unread). Not end-to-end encrypted, labelled in the UI. Stored in `groups.json`
- Terminal: all commands are real; new `diag` (server /healthz, HTTP and WebSocket latency, clock difference, secure context, key state), `ping` now also measures the WebSocket (new `ping`/`pong` protocol message). Monitor gets a WebSocket latency card and is labelled "simulated" in demo mode
- Key verification: compare box in Security (paste the contact's safety number; match, mismatch or typing state; mark verified from the result). QR codes are not included (would need an extra library)
- Tests: `npm test` 44, `npm run test:e2e` 16 (new: groups lifecycle in a browser, terminal diag/ping, safety number compare)
- Not done: end-to-end encrypted groups (needs its own protocol), QR code key verification

## v0.7.0 - messaging and social
- Messages: reply (server-built quote in channels, encrypted inside DMs), edit own, delete own DMs, emoji reactions (6 allowed), pinned channel messages (admin), per-conversation mute
- Read receipts (can be turned off), persistent unread counts stored per conversation on the server
- Profiles (display name, bio, 64x64 avatar), user search, follow/unfollow, block (DMs refused both ways, hidden from search/feed/lists)
- Real feed: posts, Everyone/Following, cursor pagination (20 per page), likes, delete; Alerts for follows, likes, reactions, replies, mentions
- New desktop windows: People, Feed, Alerts (also work from the Apps menu on small screens)
- Server: new protocol messages `edit`, `deldm`, `react`, `pin`, `read`, `mute`, `profile`, `search`, `follow`, `block`, `post`, `feed`, `like`, `delpost`, `notifread`; new files `posts.json`, `notifs.json`; all inputs validated, avatars limited to small png/jpeg/webp data URLs
- Tests: `npm test` now 39 (14 new for messaging/social/persistence), `npm run test:e2e` 13 (6 new real-browser flows incl. checks that profile and post text is never rendered as HTML)
- Not done yet: groups and communities with roles, terminal command review/diagnostics, QR / side-by-side key verification, hiding blocked users' channel messages is client-side only

## v0.6.0 - security, persistence, tests
- Fixed: one WebSocket message (`delmsg` with room `__proto__`) could crash the whole server
- Fixed: anyone could register an ADMIN_USERS name first; now needs ADMIN_CODE. Reserved names (system, admin, ...) blocked
- Downloads use an HttpOnly SameSite=Strict cookie (token no longer in URLs); sessions expire (absolute + idle) and logout revokes them
- Upload quotas enforced while streaming, including concurrent uploads; per-user quota; stalled uploads cut; partial files cleaned
- Atomic JSON writes with .bak fallback, corrupt files preserved, flush on SIGTERM; DMs (ciphertext only) now persist across restarts
- Login: generic error (no account enumeration), per-name and per-IP throttling, scrypt cost raised with automatic hash upgrade on login, 8+ char passwords for new accounts
- WebSocket: connection limit per IP, sign-in timeout, handler errors contained; `/healthz`, graceful shutdown, env validation, `.env.example`
- `npm test`: 25 integration tests (node:test, no extra dependencies)
- `npm run test:e2e`: 7 real-browser tests (Playwright + Chromium): password rule, public chat without duplicates, E2E DM (no plaintext on server disk), cookie downloads with no token in URL, admin-code gate, reload/sign-out. Client changes (cookie downloads, admin code field, 8+ char passwords, dedupe) are now verified in a real browser
- Added an empty favicon link (removes a 404 console error). README: Security + threat model, Backup and restore, Tests
- Not yet done: social features, groups, edit/reply/reactions, read receipts, notifications, terminal diagnostics review, better key verification

## v0.5.0 - CampusNet OS desktop
- Sign-in lands on an empty desktop: the wallpaper is the live topology of the nodes that are online (click a node to open its private chat)
- Windows only open when you launch an app: Messages (channels and people live inside it), Network, Files, Board, Terminal, Monitor, Security, Settings
- Start menu and taskbar (dock, status tray, clock), Lock screen (local password re-entry), boot sequence built from real session data (can be turned off in Settings), System menu
- Panes renamed to app names (Transfers -> Files, Nodes -> Network); tabbed layout on phones/tablets unchanged

## v0.4.0 - desktop shell and end-to-end encrypted DMs
- Desktop shell (>= 1180px): menubar (File, Edit, View, Network, Settings, Help), app launcher with `[ CORE ] [ SOCIAL ] [ SYSTEM ]` tiles, draggable/resizable/minimizable/maximizable windows, dock, remembered layout
- New apps: Terminal, Monitor (live latency graph), Security (safety numbers), Settings (CRT, mesh, sound)
- Phones/tablets keep the tabbed layout; apps open full screen from the top-bar grid button
- End-to-end encrypted direct messages: ECDH P-256 + AES-256-GCM, password-wrapped private key stored as an opaque blob, trust-on-first-use safety numbers with key-change blocking
- Server rejects plaintext DMs; new `setkey` event and `key` broadcast; `welcome` carries `pub`, `blob`, `keys`
- Optional HTTPS: `HTTPS=1` (auto self-signed via openssl), `TLS_CERT`, `TLS_KEY`; clear message when the browser context is insecure
- Demo mode now simulates encrypted bot DMs
- Breaking: old clients cannot send DMs (they must be encrypted). DM history is still memory-only on the server


## v0.3.3 - demo preview
- `public/index.html?demo` runs the real UI against a simulated in-browser network (no server): bots, chat, DMs, uploads, notices, status, admin
- Clear DEMO badge; downloads disabled; inactive unless the URL contains `demo`
- Root `index.html` redirects to the preview, so GitHub Pages can host it

## v0.3.2 - reference details
- Panel titles are bracketed (`[ CHANNELS ]`), replacing the square marker
- File type badges use corner-bracket frames
- Bottom navigation on phones/tablets is a boxed, bracketed dock


## v0.3.1 - terminal refinements
- Pure terminal green palette, deeper black panels, double technical borders and a soft glow on headings
- CRT layer: scanlines over the whole UI, light vignette and one slow scan bar
- Terminal log prefixes in chat events: `[+]` joins/shares, `[-]` leaves, `[*]` info, `[!]` errors
- Prompt (`>`) and block caret in the message box
- Bottom status bar (link, nodes, files, limit) with a boxed HH:MM:SS clock on desktop
- Live gate log (`[*] opening link...`, `[+] access granted`) driven by the real connection steps
- Controlled glitch only on the brand (load/hover) and when the link is lost; disabled with reduced motion
- Node map peers drawn as square terminals

## v0.3.0 - Netrunner redesign
- Complete visual identity: black/charcoal glass panels, thin technical borders with corner brackets, neon green accents, monospace labels
- Live topology map of online nodes (real data, click to DM, packets animate on incoming messages) and an ambient network mesh
- New gate: Sign in / Register tabs, password show/hide, strength meter, confirm password, clear errors
- Transfers: queue with progress, speed, ETA, cancel, failure states; library cards with type badges and previews
- Connection chip with measured latency, reconnect banner with countdown, toasts, accessible confirm dialogs
- Mobile-first layout with bottom navigation and unread badges; tablet two-column layout; 44px touch targets
- Reduced-motion support, focus rings, labelled controls
- Server: optional `mode` (`login` / `register`) on `join` so a mistyped username is never silently registered (old clients still work)
- Fix: a fatal error during reconnect now returns to the sign-in screen instead of leaving a dead UI
- Removed: the light theme (the identity is dark-only)


## v0.2.0 - big update
- Accounts with passwords (scrypt) so names cannot be taken over; per-name login throttling
- Notice board (admin only), `ADMIN_USERS` env var
- Status (online/away/busy), typing indicator, offline users listed and reachable by DM
- Image previews (safe types only), file filter, paste-to-upload
- Clickable links, @mentions with sound, delete your own messages, find-in-chat
- Light/dark theme, sign out button, refreshed layout and mobile bar
- Fix: per-IP lockout replaced by per-name lockout so shared networks are not blocked

## v0.1.0 - first release
- Public rooms with persisted history, private chat (memory only)
- File sharing with progress, size and storage limits
- Online list, unread badges, slash commands, mobile tabs
- Optional access code and admin code, Docker support
- Security basics: origin check, rate limit, sanitised names, download-only files, CSP
