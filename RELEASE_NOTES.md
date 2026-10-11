# Release notes

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
