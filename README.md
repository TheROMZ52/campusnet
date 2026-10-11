# CampusNet

A tiny campus-style intranet that runs in the browser: public rooms, private chat, file sharing and a live "who is online" list. Flat, text-first workstation look (no windows, no emoji icons).

Runs on a LAN (everyone on the same Wi-Fi/network) or online on any host that can run Node.js.

## Features
- Public rooms (`#general`, `#random`, `#help`) with history
- Private 1:1 chat (click a user). DMs live in server memory only and are never written to disk
- File sharing: drag and drop, progress bar, download, delete (own files)
- Live online list, unread badges, sound on new DM
- Slash commands: `/help`, `/me`, `/w user msg`, `/users`, `/admin code`, `/clear`
- Works on phones (tabbed layout)
- One dependency (`ws`)

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
| `ADMIN_CODE` | none | `/admin <code>` lets a user delete any file |
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

## Security notes
- Usernames are not passwords. Anyone who knows the access code can join with any free name. Keep it for friends/class use, set `ACCESS_CODE` when it is public.
- Anyone signed in can download any shared file. Do not share secrets.
- Uploaded files are always served as downloads (never rendered), names are sanitised, WebSocket origin is checked, messages are rate limited, and all text is inserted as plain text (no HTML injection).
- If a user reconnects with the same name after a restart, the name is simply free again.

## Files
| File | Purpose |
| --- | --- |
| `server.js` | HTTP, WebSocket, uploads, persistence |
| `public/index.html`, `style.css`, `app.js` | The UI |
| `Dockerfile` | Container build |

## License
MIT
