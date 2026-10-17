# Release notes

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
