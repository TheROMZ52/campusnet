# Release notes

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
