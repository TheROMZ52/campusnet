# Release notes

## v0.16.2 - older WebViews, and the running version is visible
- **`/healthz` and `/api/info` now include `version`.** Open `https://<your-domain>/healthz` in any browser to see which version the server is really running: a phone that still shows the collapsed chat strip (tabs under the top bar, empty space below) is talking to a server older than 0.15.5.
- Reproduced the collapsed-chat bug with real old Chromium builds (86, 92, 103: no `dvh`): the 0.15.4 layout collapses to half the screen with a 79px chat strip in all of them, the current layout fills the screen in all of them.
- Older WebViews (Android System WebView below 86, e.g. 80) failed at start-up because `replaceChildren` does not exist there, which left the app half initialised. `public/net.js` now provides small fallbacks for `replaceChildren`, `String.replaceAll`, `Array.at` and `Object.hasOwn`; in Chromium 80 the app now signs in, has no script errors and lays out correctly. New e2e test removes those four APIs and checks that sign-in works.
- Not done: nothing older than Chromium 80 was checked, and no real phone was available.

## v0.16.1 - Android: self-signed HTTPS with a pinned certificate
- The connect check no longer trusts every certificate blindly: it first tries normal system validation, and only if that fails does it accept the server's certificate, remembering its **SHA-256 fingerprint** (trust on first use). The pin is stored per server.
- The WebView proceeds past a certificate error only when the certificate's fingerprint equals the pin for that host (page, subresources and the WebSocket); anything else is refused as before.
- If a pinned server later presents a different certificate, connecting shows "Server certificate changed" (Persian: گواهی سرور عوض شده) and fails; removing the server chip (×) forgets the pin. A server that later gets a real certificate simply clears its pin.
- Typing `192.168.1.5:3443` is enough: https is tried first, then http (existing behaviour). Together with `HTTPS_PORT` (v0.16.0) calls and encrypted DMs now work in the app over a LAN.
- Android version 0.16.1. Unit tests (CI): new `PinTest` (SHA-256 vector, fingerprint of a real PEM equals openssl's, first use records, matching pin accepted, different pin rejected and flagged).
- CI: the web workflow runs on `ubuntu-24.04` because `ubuntu-latest` became Ubuntu 26.04, which Playwright 1.56 cannot install Chromium on (every browser-test run failed at the install step); it now also reports a failing unit, install or browser step as an annotation.
- **Not verified on a phone:** this was compiled and unit-tested only by CI. Unknown until tried: whether this WebView accepts the pinned certificate for the WebSocket (`wss://`) as well, and the first-use trust is only as good as the network at that moment. Not done: downloads from a self-signed server (the system download manager does not trust the certificate).

## v0.16.0 - plain HTTP and HTTPS at the same time
- New `HTTPS_PORT`: when set, the server listens on `PORT` for plain **HTTP** and on `HTTPS_PORT` for **HTTPS**, one process, one data folder, one WebSocket hub (a user on `ws://` and a user on `wss://` see each other and chat). The certificate is the openssl self-signed one (`DATA_DIR/cert.pem`) or `TLS_CERT` / `TLS_KEY`. `PORT` and `HTTPS_PORT` must differ. The banner prints both addresses plus an extra `secure port=` line.
- `npm start` on a personal machine now serves HTTP on `PORT` (3000) and HTTPS on `PORT+443` (3443) instead of HTTPS only on 3000, so existing `http://` bookmarks and the Android app keep working while calls, encrypted DMs and installing the app use the `https://` address. **Behaviour change:** an old `https://host:3000` bookmark now needs `:3443`. `HTTPS=0` still means plain HTTP only and `HTTPS=1` still means HTTPS only on `PORT`.
- The download cookie's `Secure` flag is decided per connection (`socket.encrypted` or `X-Forwarded-Proto` behind a trusted proxy) instead of "TLS is configured", so the HTTP listener never sets a `Secure` cookie. The WebSocket origin check applies on both ports.
- Hosting platforms (Pufferland) are unchanged: one platform-assigned `PORT`, TLS ends at the platform, leave `HTTPS_PORT` unset.
- Tests: new `tests/dual.test.js` (8): both ports answer, no scheme mixing, cross-scheme chat, `Secure` cookie only over HTTPS (fails with the old per-process check), wrong Origin refused on HTTPS, `PORT` equals `HTTPS_PORT` rejected, old modes unchanged; `tests/start.test.js` updated for the new personal-machine default and the explicit `HTTPS=1` mode.
- Not done: the Android app still rejects a self-signed LAN certificate (use `http://` there, or a real certificate); in a browser that has used both origins the download cookie is shared by host, so open the downloads from the origin you signed in on.

## v0.15.6 - ready-made Pufferland package
- `npm run pack:pufferland` (options `--admin NAME --site NAME --access CODE`, output `dist/campusnet-pufferland-<version>.zip`) builds a zip made for Pufferland's "manual upload" form: files at the zip root, **`index.js` (the form's default start file)**, a generated private `.env` (`SITE_NAME`, `TRUST_PROXY=1`, `ADMIN_USERS`, a random 24-character `ADMIN_CODE`, backups on) and the Persian guide `PUFFERLAND.fa.md` with the value for every field of the form. The plain `npm run pack` zip is unchanged (no `.env`).
- `scripts/start.js`: a `.env` that sets `TRUST_PROXY` (or `NODE_ENV=production`) now also counts as a hosted copy, so the self-signed HTTPS that is meant for a LAN is never switched on behind a platform proxy even if the platform gives only `PORT`.
- **Git deploy:** `index.js` (a two-line shim for `scripts/start.js`) is now in the repo root and in every zip, so Pufferland's default start file works for the "Git repository" source too; `PUFFERLAND.fa.md` describes that route first (updates become a restart), config through environment variables or a `.env` in a private repo. `npm run pack:pufferland` also takes `--admin-code CODE` to keep an existing admin code.
- **Mobile layout, second part:** the app height now falls back to the real window height in pixels (`--app-h`, set from `innerHeight` on load, resize and rotation) when the WebView has no `dvh`, so the chat area cannot collapse on old WebViews even when percentage heights misbehave; new test `without dvh support the app height follows the real window height, also when it shrinks (keyboard)`. If the phone still shows the tabs at the top and the chat as a thin strip, the server it talks to is not running this version yet.
- Checked on Node 25.9 (Pufferland's newest option): all unit tests (99) pass, idle memory about 55 MB (the smallest plan is enough), and sign-ups behind a proxy are counted per `X-Forwarded-For` address.
- New `tests/pufferland.test.js`: the zip starts with `node index.js` and only `PORT` set, reads the `.env`, stays on plain HTTP, and keeps the admin name reserved until the admin code is given.
- Not verified here: that Pufferland's proxy passes WebSockets, has exactly one proxy hop (`TRUST_PROXY=1`) and keeps `data/` when a new zip is uploaded. The guide says how to check each.

## v0.15.5 - mobile layout fix (server side, no new APK needed)
- **Fixed: on some phones (WebViews without `dvh` support) the chat area collapsed to a thin strip with the tabs jammed under the top bar and empty space below.** `#app` now has a `height:100%` fallback before `100dvh`, an explicit single grid column (`minmax(0,1fr)`, which also removes a 34px sideways overflow at 320px that the previous grid change introduced) and fixed grid rows for header, desk, status bar and tabs. Redeploy the server zip; the app picks it up on the next load.
- Tests: new `chat still fills the screen on a WebView without dvh support` in `tests/e2e/layout.test.js` (strips every `dvh` declaration from the stylesheet, measures the app, chat area and tabs); it fails on the previous CSS. The 320px sideways-scroll test is green again.
- `public/sw.js` `VERSION` and `package.json` are 0.15.5 so installed copies drop the old stylesheet.

## v0.15.0 - Android app
- **Native Android app** in `android/` (Kotlin, Jetpack Compose, minSdk 26): animated intro (the hexagon draws itself over a drifting network), address field that accepts `ip:port`, domain or full URL (LAN addresses default to `http`, domains try `https` then `http`), connect button that morphs into a spinner and a check mark, shake on errors, expanding ring into the site. After the first connection the app opens straight into the site; recent servers are chips; back from the first page offers Change server / Exit. Persian and English.
- WebView host: microphone permission for calls, file chooser for uploads, downloads through the system download manager with the session cookie, links to other sites open in the browser, offline/error screen with Retry.
- Background: foreground service with a quiet notification plus a partial wake lock keeps the connection open; first launch asks for notification permission and battery-optimisation exemption. Messages that arrive while the app is not visible become Android notifications.
- Web side: `window.CampusNetApp.notify(title, text)` is called for DMs and mentions while the page is hidden (decrypted text, sender as title); inside the app (`CampusNetApp` in the user agent) the service worker and the Install button are off. Server and web version bumped to 0.15.0 (`public/sw.js` too).
- CI: `.github/workflows/android.yml` runs the Android unit tests (address parsing) and builds a signed release APK, published as `CampusNet.apk` on the `android-latest` (main) or `android-dev` release.
- Tests: `npm test` 97, `npm run test:e2e` 49 (2 new in `tests/e2e/pwa.test.js`: in-app user agent disables the worker and install button; a DM received while hidden reaches the native bridge decrypted). Android: 8 unit tests for address handling.
- Not done / unverified: the app has been compiled and tested only by CI, not yet run on a real phone: animations, background survival with the screen off, battery use, voice calls and uploads need a real-device pass. Self-signed HTTPS is rejected. The signing key is committed (sideloading only).

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
