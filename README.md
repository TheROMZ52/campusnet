# CampusNet

A private, futuristic file-and-chat network for a LAN or the internet. Netrunner-style interface (black glass panels, neon green, live node map), accounts, channels, private chat, a broadcast board and fast file sharing. Node.js + WebSocket, one dependency.

## Features
- Accounts: pick a username and password the first time; that name is yours (passwords are hashed with scrypt)
- Channels (`#general`, `#random`, `#help`) with history, plus a notice board that only admins can post to
- Private 1:1 chat, also to people who are offline (delivered when they come back; DMs live in server memory only, never on disk)
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

## Security notes
- Accounts are stored in `data/users.json` (scrypt hashes, no plain passwords). Five wrong passwords for a name from one IP locks that name for a minute. There is no password reset: delete the user from `data/users.json` while the server is stopped.
- Anyone signed in can download any shared file. Do not share secrets. Set `ACCESS_CODE` when the server is public.
- Files are served as downloads; only png/jpg/gif/webp can be previewed inline (sandboxed, SVG is never rendered). Names are sanitised, WebSocket origin is checked, messages are rate limited, and all text is inserted as plain text.
- Use HTTPS when online, otherwise passwords travel unencrypted.

## Files
| File | Purpose |
| --- | --- |
| `server.js` | HTTP, WebSocket, uploads, persistence |
| `public/index.html` | Markup (gate, shell, dialogs) |
| `public/style.css` | Design system: tokens, primitives, layout, motion |
| `public/app.js` | UI logic and WebSocket protocol |
| `public/net.js` | Background mesh and live topology canvas |
| `Dockerfile` | Container build |

## License
MIT
