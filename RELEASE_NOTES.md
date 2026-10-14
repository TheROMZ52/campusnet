# Release notes

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
