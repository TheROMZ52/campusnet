'use strict';
/* CampusNet server: static files + WebSocket chat + raw-stream file uploads. Only dependency: ws */
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = +process.env.PORT || 3000;
const DATA = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const UP = path.join(DATA, 'uploads');
const PUB = path.join(__dirname, 'public');
const SITE = process.env.SITE_NAME || 'CampusNet';
const CODE = process.env.ACCESS_CODE || '';      // optional shared code to join
const ADMIN = process.env.ADMIN_CODE || '';      // optional: /admin <code> lets a user delete any file
const MAX_FILE = (+process.env.MAX_FILE_MB || 100) * 1048576;
const MAX_TOTAL = (+process.env.MAX_STORAGE_MB || 2000) * 1048576;
const ROOMS = ['general', 'random', 'help'];
const NAME_RE = /^[\p{L}\p{N}_.-]{2,20}$/u;
fs.mkdirSync(UP, { recursive: true });

/* ---------- persistence ---------- */
const rd = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch { return d; } };
const hist = rd('messages.json', {}); ROOMS.forEach(r => { hist[r] = Array.isArray(hist[r]) ? hist[r] : []; });
let files = rd('files.json', []).filter(f => fs.existsSync(path.join(UP, f.id)));
const timers = {};
const save = (f, v) => { clearTimeout(timers[f]); timers[f] = setTimeout(() => fs.writeFile(path.join(DATA, f), JSON.stringify(v), () => {}), 400); };

/* ---------- state ---------- */
const sessions = new Map();               // token -> { token, name, admin, ws }
const dms = new Map();                    // "a|b" -> [msg]  (memory only, never written to disk)
const dmKey = (a, b) => [a.toLowerCase(), b.toLowerCase()].sort().join('|');
const online = () => [...sessions.values()].filter(s => s.ws && s.ws.readyState === 1);
const findByName = n => [...sessions.values()].find(s => s.name.toLowerCase() === String(n).toLowerCase());
const uid = () => crypto.randomBytes(6).toString('hex');
const safeEq = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const clean = t => String(t || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, 1000);
const fmt = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';

const send = (ws, o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
const bcast = o => online().forEach(s => send(s.ws, o));
const userList = () => online().map(s => s.name).sort((a, b) => a.localeCompare(b));
const publicFiles = () => files.map(({ id, name, size, owner, ts }) => ({ id, name, size, owner, ts }));
function addRoomMsg(room, from, text, kind) {
  const m = { id: uid(), room, from, text, ts: Date.now(), kind };
  hist[room].push(m); if (hist[room].length > 300) hist[room].shift();
  save('messages.json', hist); bcast({ t: 'msg', m });
}

/* ---------- HTTP ---------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
const SEC = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; img-src 'self' data:; frame-ancestors 'none'"
};
const json = (res, code, o) => { res.writeHead(code, { 'Content-Type': 'application/json', ...SEC }); res.end(JSON.stringify(o)); };

const server = http.createServer((req, res) => {
  let url; try { url = new URL(req.url, 'http://x'); } catch { return json(res, 400, { error: 'bad url' }); }

  if (url.pathname === '/api/info') return json(res, 200, { name: SITE, needCode: !!CODE, maxMB: Math.round(MAX_FILE / 1048576) });

  if (req.method === 'POST' && url.pathname === '/upload') {
    const s = sessions.get(req.headers['x-token']);
    if (!s) return json(res, 401, { error: 'not signed in' });
    let name = 'file'; try { name = decodeURIComponent(req.headers['x-filename'] || 'file'); } catch { /* keep default */ }
    name = path.basename(name).replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').slice(0, 120) || 'file';
    const len = +req.headers['content-length'] || 0;
    const used = files.reduce((a, f) => a + f.size, 0);
    if (len > MAX_FILE) return json(res, 413, { error: `File too big (max ${fmt(MAX_FILE)})` });
    if (used + len > MAX_TOTAL) return json(res, 507, { error: 'Server storage is full' });
    const id = crypto.randomBytes(8).toString('hex'), fp = path.join(UP, id);
    const out = fs.createWriteStream(fp); let n = 0, dead = false;
    const kill = (code, msg) => { if (dead) return; dead = true; req.unpipe(out); out.destroy(); fs.unlink(fp, () => {}); if (!res.headersSent) { res.writeHead(code, { 'Content-Type': 'application/json', Connection: 'close', ...SEC }); res.end(JSON.stringify({ error: msg })); } };
    req.on('data', c => { n += c.length; if (n > MAX_FILE) kill(413, `File too big (max ${fmt(MAX_FILE)})`); });
    req.on('aborted', () => kill(499, 'aborted'));
    out.on('error', () => kill(500, 'write failed'));
    out.on('finish', () => {
      if (dead) return;
      files.unshift({ id, name, size: n, owner: s.name, ts: Date.now() }); save('files.json', files);
      bcast({ t: 'files', files: publicFiles() });
      addRoomMsg('general', 'system', `${s.name} shared "${name}" (${fmt(n)})`, 'sys');
      json(res, 200, { ok: true });
    });
    return req.pipe(out);
  }

  const dl = url.pathname.match(/^\/f\/([a-f0-9]{16})$/);
  if (req.method === 'GET' && dl) {
    if (!sessions.has(url.searchParams.get('t'))) return json(res, 401, { error: 'not signed in' });
    const f = files.find(x => x.id === dl[1]);
    if (!f) return json(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': f.size, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`, ...SEC });
    return fs.createReadStream(path.join(UP, f.id)).pipe(res);
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method not allowed' });
  let rel; try { rel = decodeURIComponent(url.pathname); } catch { return json(res, 400, { error: 'bad path' }); }
  const fp = path.join(PUB, path.normalize(rel === '/' ? '/index.html' : rel));
  if (!fp.startsWith(PUB + path.sep)) return json(res, 403, { error: 'forbidden' });
  fs.readFile(fp, (err, buf) => {
    if (err) return json(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...SEC });
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
});

/* ---------- WebSocket ---------- */
const wss = new WebSocketServer({
  server, maxPayload: 16 * 1024,
  verifyClient: ({ origin, req }) => { if (!origin) return true; try { return new URL(origin).host === req.headers.host; } catch { return false; } }
});

function dmsFor(name) {
  const out = {}, k = name.toLowerCase();
  for (const [key, arr] of dms) if (key.split('|').includes(k)) arr.forEach(m => { const other = m.from.toLowerCase() === k ? m.to : m.from; (out[other] = out[other] || []).push(m); });
  return out;
}
function join(ws, m) {
  if (ws.s) return;
  if (CODE && !safeEq(String(m.code || ''), CODE)) return send(ws, { t: 'err', fatal: true, text: 'Wrong access code.' });
  let s = m.token && sessions.get(m.token);
  if (s) { if (s.ws && s.ws !== ws) { const old = s.ws; s.ws = null; try { old.close(); } catch { /* ignore */ } } }
  else {
    const name = String(m.name || '').trim();
    if (!NAME_RE.test(name)) return send(ws, { t: 'err', fatal: true, text: 'Name must be 2-20 letters, digits, _ . or -' });
    const clash = findByName(name);
    if (clash && clash.ws && clash.ws.readyState === 1) return send(ws, { t: 'err', fatal: true, text: 'That name is already online.' });
    if (clash) sessions.delete(clash.token);
    s = { token: crypto.randomBytes(16).toString('hex'), name, admin: false, ws: null };
    sessions.set(s.token, s);
  }
  s.ws = ws; ws.s = s;
  send(ws, { t: 'welcome', me: s.name, token: s.token, admin: s.admin, site: SITE, rooms: ROOMS, hist, dms: dmsFor(s.name), users: userList(), files: publicFiles(), maxMB: Math.round(MAX_FILE / 1048576) });
  bcast({ t: 'users', users: userList() });
  addRoomMsg('general', 'system', `${s.name} connected`, 'sys');
}

wss.on('connection', ws => {
  ws.alive = true; ws.hits = []; ws.on('pong', () => { ws.alive = true; });
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    if (m.t === 'join') return join(ws, m);
    const s = ws.s; if (!s) return;
    const now = Date.now(); ws.hits = ws.hits.filter(t => now - t < 5000);
    if (ws.hits.length >= 10) return send(ws, { t: 'err', text: 'Slow down a little.' });
    ws.hits.push(now);

    if (m.t === 'msg') {
      const text = clean(m.text); if (!text || !ROOMS.includes(m.room)) return;
      addRoomMsg(m.room, s.name, text, m.kind === 'me' ? 'me' : 'chat');
    } else if (m.t === 'dm') {
      const text = clean(m.text), to = findByName(m.to);
      if (!text) return;
      if (!to) return send(ws, { t: 'err', text: `No user named "${String(m.to).slice(0, 20)}".` });
      const msg = { id: uid(), from: s.name, to: to.name, text, ts: Date.now(), kind: m.kind === 'me' ? 'me' : 'chat' };
      const k = dmKey(s.name, to.name), arr = dms.get(k) || []; arr.push(msg); if (arr.length > 100) arr.shift(); dms.set(k, arr);
      send(ws, { t: 'dm', m: msg }); if (to !== s) send(to.ws, { t: 'dm', m: msg });
    } else if (m.t === 'delfile') {
      const f = files.find(x => x.id === m.id);
      if (!f || (f.owner !== s.name && !s.admin)) return send(ws, { t: 'err', text: 'You can only delete your own files.' });
      files = files.filter(x => x !== f); fs.unlink(path.join(UP, f.id), () => {}); save('files.json', files);
      bcast({ t: 'files', files: publicFiles() });
    } else if (m.t === 'admin') {
      if (ADMIN && safeEq(String(m.code || ''), ADMIN)) { s.admin = true; send(ws, { t: 'admin', ok: true }); }
      else send(ws, { t: 'err', text: 'Admin is not enabled or the code is wrong.' });
    }
  });
  ws.on('close', () => {
    const s = ws.s;
    if (s && s.ws === ws) { s.ws = null; bcast({ t: 'users', users: userList() }); addRoomMsg('general', 'system', `${s.name} disconnected`, 'sys'); }
  });
  ws.on('error', () => {});
});
setInterval(() => wss.clients.forEach(ws => { if (!ws.alive) return ws.terminate(); ws.alive = false; ws.ping(); }), 30000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  ${SITE} is running\n  local:   http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) if (i.family === 'IPv4' && !i.internal) console.log(`  network: http://${i.address}:${PORT}   <- share this on your LAN`);
  console.log(`  access code: ${CODE ? 'ON' : 'off'}   max file: ${fmt(MAX_FILE)}\n`);
});
