'use strict';
/* CampusNet server: static files + WebSocket chat + streamed file uploads. Only dependency: ws.
   Security model: see README ("Security"). Persistence: atomic JSON files in DATA_DIR with .bak fallback. */
const http = require('http'), https = require('https'), fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const { execFileSync } = require('child_process');
const { WebSocketServer } = require('./vendor/ws');

const log = (lvl, msg) => console.log(`${new Date().toISOString()} ${lvl} ${msg}`);
const bail = m => { console.error('\n  configuration error: ' + m + '\n'); process.exit(1); };
const num = (name, def, min = 0.001) => {
  const v = process.env[name]; if (v === undefined || v === '') return def;
  const n = Number(v); if (!Number.isFinite(n) || n < min) bail(`${name}="${v}" must be a number >= ${min}`); return n;
};

/* ---------- configuration (validated at startup) ---------- */
const PORT = num('PORT', 3000, 0);
const DATA = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const UP = path.join(DATA, 'uploads');
const PUB = path.join(__dirname, 'public');
const SITE = String(process.env.SITE_NAME || 'CampusNet').slice(0, 40);
const CODE = process.env.ACCESS_CODE || '';       // optional shared code required to join
const ADMIN = process.env.ADMIN_CODE || '';       // admin bootstrap: /admin <code>, and registering ADMIN_USERS names
const ADMIN_USERS = (process.env.ADMIN_USERS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
const MAX_FILE = num('MAX_FILE_MB', 100) * 1048576;
const MAX_TOTAL = num('MAX_STORAGE_MB', 2000) * 1048576;
const MAX_USER = num('MAX_USER_MB', 500) * 1048576;
const SESSION_MS = num('SESSION_HOURS', 168) * 3600e3;       // absolute session lifetime
const IDLE_MS = num('SESSION_IDLE_HOURS', 24, 0.0001) * 3600e3;       // inactivity timeout
const JOIN_TIMEOUT = num('JOIN_TIMEOUT_MS', 15000, 100);
const MAX_CONN_IP = num('MAX_CONNECTIONS_PER_IP', 20, 1);
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
if (ADMIN_USERS.length && !ADMIN) bail('ADMIN_USERS requires ADMIN_CODE (an admin name can only be registered with that code, so nobody can claim it first).');
const ROOMS = ['general', 'random', 'help'];
const RESERVED = new Set(['system', 'admin', 'administrator', 'root', 'server', 'campusnet', 'moderator', 'mod', 'null', 'undefined']);
const WEAK = new Set(['password', 'password1', '12345678', '123456789', '1234567890', 'qwertyui', 'qwerty123', '11111111', '00000000', 'iloveyou', 'abcdefgh', 'letmein1']);
const AUDIOT = { mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', weba: 'audio/webm' };
const AUD = /\.(mp3|ogg|oga|opus|wav|m4a|aac|flac|weba)$/i;
const IMGT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const IMG = /\.(png|jpe?g|gif|webp)$/i;
const NAME_RE = /^[\p{L}\p{N}_.-]{2,20}$/u;
try { fs.mkdirSync(UP, { recursive: true }); fs.accessSync(DATA, fs.constants.W_OK); } catch (e) { bail(`DATA_DIR "${DATA}" is not writable (${e.message})`); }

/* ---------- optional HTTPS (browsers only allow Web Crypto on HTTPS or localhost) ---------- */
function tlsOptions() {
  let cert = process.env.TLS_CERT, key = process.env.TLS_KEY;
  if (!cert && process.env.HTTPS === '1') {
    cert = path.join(DATA, 'cert.pem'); key = path.join(DATA, 'key.pem');
    if (!fs.existsSync(cert) || !fs.existsSync(key)) {
      const ips = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4').map(i => 'IP:' + i.address);
      try { execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '825', '-subj', '/CN=campusnet', '-addext', 'subjectAltName=DNS:localhost,' + ips.join(',')], { stdio: 'ignore' }); log('INFO', 'created a self-signed certificate in ' + DATA); }
      catch { bail('HTTPS=1 needs openssl to create a certificate (or set TLS_CERT and TLS_KEY).'); }
    }
  }
  if (!cert || !key) return null;
  try { return { cert: fs.readFileSync(cert), key: fs.readFileSync(key) }; } catch (e) { bail('cannot read TLS_CERT/TLS_KEY: ' + e.message); }
}
const TLS = tlsOptions();

/* ---------- persistence: atomic writes, .bak fallback, corrupt files are preserved ---------- */
function rd(f, d) {
  const p = path.join(DATA, f);
  for (const file of [p, p + '.bak']) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) {
      if (e.code === 'ENOENT') continue;
      log('WARN', `${path.basename(file)} is unreadable (${e.message}); ${file === p ? 'trying the backup' : 'no usable backup'}`);
      try { fs.copyFileSync(file, `${file}.corrupt-${Date.now()}`); } catch { /* best effort */ }
    }
  }
  return d;
}
function writeAtomic(f, data) {
  const p = path.join(DATA, f), tmp = `${p}.${process.pid}.tmp`, fd = fs.openSync(tmp, 'w', 0o600);
  try { fs.writeSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try { if (fs.existsSync(p)) fs.copyFileSync(p, p + '.bak'); } catch { /* backup is best effort */ }
  fs.renameSync(tmp, p);
}
const pending = {}, timers = {};
function flush(f) {
  clearTimeout(timers[f]); if (!(f in pending)) return;
  try { writeAtomic(f, JSON.stringify(pending[f])); delete pending[f]; }
  catch (e) { log('ERROR', `could not write ${f}: ${e.message} (will retry)`); timers[f] = setTimeout(() => flush(f), 5000); }
}
const flushAll = () => Object.keys(pending).forEach(flush);
const save = (f, v) => { pending[f] = v; clearTimeout(timers[f]); timers[f] = setTimeout(() => flush(f), 300); };

const hist = rd('messages.json', {}); ROOMS.forEach(r => { hist[r] = Array.isArray(hist[r]) ? hist[r] : []; });
let files = (rd('files.json', []) || []).filter(f => f && /^[a-f0-9]{16}$/.test(f.id) && fs.existsSync(path.join(UP, f.id)));
const users = Object.assign(Object.create(null), rd('users.json', {}));   // lowercase name -> { name, salt, hash, v?, pub?, blob? }
let notices = rd('notices.json', []);
const dms = new Map(Object.entries(rd('dms.json', {})).filter(([, a]) => Array.isArray(a)).map(([k, a]) => [k, a.filter(m => m && m.enc && m.from && m.to)]));
const persistDms = () => save('dms.json', Object.fromEntries(dms));   // ciphertext only (end-to-end encrypted)

/* ---------- messaging + social state (v0.7): reactions, reads, profiles, follow/block, feed, notifications ---------- */
const REACTS = ['👍', '❤️', '😂', '😮', '😢', '🎉'];
const posts = (rd('posts.json', []) || []).filter(p => p && typeof p.id === 'string' && typeof p.by === 'string' && typeof p.text === 'string' && Array.isArray(p.likes));
const notifs = Object.assign(Object.create(null), rd('notifs.json', {}));
const ukey = n => String(n).toLowerCase();
const urec = n => (typeof n === 'string' && n) ? users[ukey(n)] : undefined;
const line = (t, n) => clean(t).replace(/\s+/g, ' ').slice(0, n);
const snippet = t => line(t, 80);
const encValid = e => !!e && typeof e.iv === 'string' && typeof e.ct === 'string' && e.iv.length <= 32 && e.ct.length <= 6000 && e.ct.length > 0;
const blocksEither = (a, b) => { const x = urec(a), y = urec(b); return !!((x && (x.blocked || []).includes(ukey(b))) || (y && (y.blocked || []).includes(ukey(a)))); };
function toggle(arr, v) { const i = arr.indexOf(v); if (i < 0) { arr.push(v); return true; } arr.splice(i, 1); return false; }
/* groups / communities (v0.8): server-side membership and roles; room id is 'g:<id>'. Not end-to-end encrypted. */
const groups = Object.assign(Object.create(null), rd('groups.json', {}));
const groupOf = room => (typeof room === 'string' && room.startsWith('g:')) ? groups[room.slice(2)] : undefined;
const roleOf = (g, name) => (g && typeof name === 'string') ? g.members[ukey(name)] : undefined;
const roomOk = (room, who) => (typeof room === 'string' && ROOMS.includes(room)) || !!(who && roleOf(groupOf(room), who));
const histOf = room => groupOf(room) ? groupOf(room).hist : hist[room];
const saveRoom = room => groupOf(room) ? save('groups.json', groups) : save('messages.json', hist);
const hidesFrom = (u, from) => !!(u && from && (u.blocked || []).includes(ukey(from)));   // people you blocked never reach you in channels
const histFor = u => { const b = u.blocked || []; if (!b.length) return hist; return Object.fromEntries(Object.entries(hist).map(([r, a]) => [r, a.filter(x => !b.includes(ukey(x.from)))])); };
const toRoom = (room, o) => { const g = groupOf(room); if (!g) { if ((o.t === 'msg' || o.t === 'upd') && o.m) { online().forEach(x => { if (!hidesFrom(urec(x.name), o.m.from)) send(x.ws, o); }); return; } return bcast(o); } Object.keys(g.members).forEach(k => { if (users[k]) toUser(users[k].name, o); }); };
const canMod = (room, s) => { const g = groupOf(room); if (!g) return !!s.admin; const r = roleOf(g, s.name); return r === 'owner' || r === 'mod'; };
const gview = g => ({ id: g.id, name: g.name, desc: g.desc, pub: g.pub, owner: (users[g.owner] || {}).name || '', members: Object.entries(g.members).filter(([k]) => users[k]).map(([k, r]) => ({ n: users[k].name, r })), hist: g.hist });
const pushGroup = g => Object.keys(g.members).forEach(k => { if (users[k]) toUser(users[k].name, { t: 'group', g: gview(g) }); });
const myGroups = name => Object.values(groups).filter(g => roleOf(g, name)).map(gview);
const msgOf = (room, id, who) => (typeof id === 'string' && roomOk(room, who)) ? histOf(room).find(x => x.id === id && x.kind !== 'sys') : undefined;
const dmOf = (a, b, id) => (typeof a === 'string' && typeof b === 'string' && typeof id === 'string') ? (dms.get(dmKey(a, b)) || []).find(x => x.id === id) : undefined;
const convKey = (k, who) => { k = typeof k === 'string' ? k.toLowerCase() : ''; return (k.startsWith('r:') ? roomOk(k.slice(2), who) : k.startsWith('d:') && !!users[k.slice(2)]) ? k : ''; };
function notify(to, o) {
  const u = urec(to); if (!u || ukey(to) === ukey(o.from) || blocksEither(to, o.from)) return;
  const arr = notifs[ukey(to)] = notifs[ukey(to)] || [], n = { id: uid(), ts: Date.now(), read: false, ...o };
  arr.unshift(n); if (arr.length > 100) arr.length = 100; save('notifs.json', notifs);
  const t = findByName(u.name); if (t) send(t.ws, { t: 'notif', n });
}
const musicOf = id => { const f = id && files.find(x => x.id === id); return f && AUD.test(f.name) ? { id: f.id, n: f.name } : null; };
const pubProfile = u => { const p = u.profile || {}; return { d: p.display || '', b: p.bio || '', a: p.avatar || '', m: musicOf(p.music) }; };
const profilesMap = () => { const o = {}; Object.values(users).forEach(u => { if (u.profile && (u.profile.display || u.profile.bio || u.profile.avatar || musicOf(u.profile.music))) o[u.name] = pubProfile(u); }); return o; };
const prefsOf = u => ({ following: u.following || [], blocked: u.blocked || [], muted: u.muted || [], reads: u.reads || {}, receipts: !(u.profile && u.profile.receipts === false) });
function peerReadsFor(name) {
  const o = {}, me = ukey(name); for (const other of Object.keys(dmsFor(name))) { const r = urec(other); if (r && !(r.profile && r.profile.receipts === false) && r.reads && r.reads['d:' + me]) o[r.name] = r.reads['d:' + me]; } return o;
}
const toUser = (name, o) => { const t = findByName(name); if (t) send(t.ws, o); };
/* voice calls (v0.12): the server only signals and relays encrypted audio frames between the two people; nothing is stored */
const RING_MS = num('CALL_RING_MS', 45000), calls = new Map(), inCall = new Map();
function endCall(id, reason) {
  const c = calls.get(id); if (!c) return; clearTimeout(c.timer); calls.delete(id); inCall.delete(ukey(c.a)); inCall.delete(ukey(c.b));
  toUser(c.a, { t: 'callstate', id, state: 'ended', reason, peer: c.b }); toUser(c.b, { t: 'callstate', id, state: 'ended', reason, peer: c.a });
  if (reason === 'noanswer' || (reason === 'cancelled' && c.state === 'ringing')) notify(c.b, { type: 'missed', from: c.a, text: 'missed call' });
}
const endCallOf = (name, reason) => { const id = inCall.get(ukey(name)); if (id) endCall(id, reason); };
function relayAudio(ws, buf) {
  const s = ws.s; if (!s || buf.length < 6 || buf.length > 2048 || buf[0] !== 1) return;
  const c = calls.get(inCall.get(ukey(s.name))); if (!c || c.state !== 'active') return;
  const now = Date.now(); if (now - (ws.fr0 || 0) > 1000) { ws.fr0 = now; ws.fn = 0; } if (++ws.fn > 80) return;   // at most 80 frames a second
  const o = findByName(ukey(c.a) === ukey(s.name) ? c.b : c.a); if (o && o.ws && o.ws.readyState === 1 && o.ws.bufferedAmount < 262144) o.ws.send(buf, { binary: true });
}
const toBoth = (msg, o) => { [msg.from, msg.to].forEach(n => { const t = findByName(n); if (t) send(t.ws, o); }); };

/* orphan cleanup: upload files that no record points to (crashed uploads) */
try { const known = new Set(files.map(f => f.id)); for (const n of fs.readdirSync(UP)) { const p = path.join(UP, n); if (!known.has(n) && Date.now() - fs.statSync(p).mtimeMs > 3600e3) { fs.unlinkSync(p); log('INFO', 'removed orphan upload ' + n); } } } catch { /* ignore */ }

/* ---------- passwords: scrypt, versioned parameters, legacy hashes are upgraded on login ---------- */
const HASH_V2 = { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
const hashPw = (pw, salt, v) => new Promise((res, rej) => crypto.scrypt(pw, salt, 32, v === 2 ? HASH_V2 : {}, (e, k) => e ? rej(e) : res(k.toString('hex'))));
const DUMMY_SALT = crypto.randomBytes(16).toString('hex');

/* ---------- throttling ---------- */
const fails = new Map();   // key -> { n, until, t }
const blocked = k => { const f = fails.get(k); return !!f && f.until > Date.now(); };
function strike(k, limit, ms) { const now = Date.now(); let f = fails.get(k); if (!f || now - f.t > 600000) f = { n: 0, until: 0, t: now }; f.n++; f.t = now; if (f.n >= limit) f.until = now + ms; fails.set(k, f); }

/* ---------- state ---------- */
const sessions = new Map();   // token -> { token, name, admin, status, created, seen, ws }
const dmKey = (a, b) => [a.toLowerCase(), b.toLowerCase()].sort().join('|');
const online = () => [...sessions.values()].filter(s => s.ws && s.ws.readyState === 1);
const findByName = n => [...sessions.values()].find(s => s.name.toLowerCase() === String(n).toLowerCase());
const uid = () => crypto.randomBytes(6).toString('hex');
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const clean = t => String(t || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, 1000);
const fmt = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
const send = (ws, o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
const bcast = o => online().forEach(s => send(s.ws, o));
const userList = () => online().map(s => ({ n: s.name, s: s.status || 'online' })).sort((a, b) => a.n.localeCompare(b.n));
const allNames = () => Object.values(users).map(u => u.name).sort((a, b) => a.localeCompare(b));
const publicKeys = () => { const o = {}; Object.values(users).forEach(u => { if (u.pub) o[u.name] = u.pub; }); return o; };
const pushUsers = () => bcast({ t: 'users', users: userList(), all: allNames() });
const publicFiles = () => files.map(({ id, name, size, owner, ts }) => ({ id, name, size, owner, ts, img: IMG.test(name), aud: AUD.test(name) }));
function addRoomMsg(room, from, text, kind, extra) {
  const g = groupOf(room); if (!g && !ROOMS.includes(room)) return;
  const m = { id: uid(), room, from, text, ts: Date.now(), kind, ...extra }, arr = histOf(room);
  arr.push(m); if (arr.length > 300) arr.shift();
  saveRoom(room); toRoom(room, { t: 'msg', m }); return m;
}
function dropSession(s, why) {
  endCallOf(s.name, 'disconnect'); sessions.delete(s.token); const w = s.ws;
  if (w) { s.ws = null; w.s = null; send(w, { t: 'err', fatal: true, text: 'Session ended. Sign in again.', reason: why }); try { w.close(); } catch { /* ignore */ } pushUsers(); }
  log('INFO', `session of ${s.name} dropped: ${why}`);
}
function authToken(t) {
  if (typeof t !== 'string') return null; const s = sessions.get(t); if (!s) return null;
  const now = Date.now(); if (now - s.created > SESSION_MS) { dropSession(s, 'expired'); return null; } if (now - s.seen > IDLE_MS) { dropSession(s, 'idle'); return null; }
  s.seen = now; return s;
}

/* ---------- HTTP ---------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2' };
const SEC = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(self), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  ...(TLS ? { 'Strict-Transport-Security': 'max-age=15552000' } : {})
};
const json = (res, code, o, extra) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SEC, ...extra }); res.end(JSON.stringify(o)); };
const cookie = (req, n) => { const c = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(n + '=')); return c ? c.slice(n.length + 1) : ''; };
const isSecure = req => !!TLS || (TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https');
const usedTotal = () => files.reduce((a, f) => a + f.size, 0);
const usedBy = name => files.reduce((a, f) => a + (f.owner === name ? f.size : 0), 0);
let inflightTotal = 0; const inflightUser = new Map(), activeUploads = new Map();

function handleUpload(req, res) {
  const s = authToken(req.headers['x-token']);
  if (!s) return json(res, 401, { error: 'not signed in' });
  if ((activeUploads.get(s.name) || 0) >= 3) return json(res, 429, { error: 'Too many uploads at once' });
  let name = 'file'; try { name = decodeURIComponent(String(req.headers['x-filename'] || 'file')); } catch { /* keep default */ }
  name = path.basename(name).replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').slice(0, 120) || 'file';
  const len = /^\d+$/.test(String(req.headers['content-length'] || '')) ? +req.headers['content-length'] : 0;
  const userIn = () => inflightUser.get(s.name) || 0;
  const over = extra => (extra > MAX_FILE) ? [413, `File too big (max ${fmt(MAX_FILE)})`] : (usedTotal() + inflightTotal > MAX_TOTAL) ? [507, 'Server storage is full'] : (usedBy(s.name) + userIn() > MAX_USER) ? [507, `Your storage quota is full (${fmt(MAX_USER)})`] : null;
  let claim = 0;   // bytes reserved for this upload (declared length first, actual bytes while streaming)
  const reserve = to => { const d = to - claim; claim = to; inflightTotal += d; inflightUser.set(s.name, userIn() + d); };
  reserve(len); let bad = over(len);
  if (bad) { reserve(0); res.on('finish', () => req.destroy()); return json(res, bad[0], { error: bad[1] }, { Connection: 'close' }); }
  activeUploads.set(s.name, (activeUploads.get(s.name) || 0) + 1);
  const id = crypto.randomBytes(8).toString('hex'), fp = path.join(UP, id);
  const out = fs.createWriteStream(fp, { flags: 'wx', mode: 0o600 }); let n = 0, done = false;
  const release = () => { reserve(0); activeUploads.set(s.name, Math.max(0, (activeUploads.get(s.name) || 1) - 1)); };
  const kill = (code, msg) => {
    if (done) return; done = true; req.unpipe(out); out.destroy(); fs.unlink(fp, () => {}); release();
    if (!res.headersSent) { res.on('finish', () => req.destroy()); json(res, code, { error: msg }, { Connection: 'close' }); } else req.destroy();
  };
  req.setTimeout(60000, () => kill(408, 'Upload stalled'));
  req.on('data', c => { n += c.length; if (n > claim) { reserve(n); const b = over(n); if (b) kill(b[0], b[1]); } });
  req.on('aborted', () => kill(499, 'aborted')); req.on('error', () => kill(400, 'bad request'));
  out.on('error', e => { log('ERROR', 'upload write failed: ' + e.message); kill(500, 'write failed'); });
  out.on('finish', () => {
    if (done) return; if (!n) return kill(400, 'Empty file');
    done = true; release();
    files.unshift({ id, name, size: n, owner: s.name, ts: Date.now() }); save('files.json', files);
    bcast({ t: 'files', files: publicFiles() });
    addRoomMsg('general', 'system', `${s.name} shared "${name}" (${fmt(n)})`, 'sys');
    json(res, 200, { ok: true });
  });
  req.pipe(out);
}

function handleDownload(req, res, url, id) {
  const s = authToken(cookie(req, 'cn_s'));
  if (!s) return json(res, 401, { error: 'not signed in' });
  const f = files.find(x => x.id === id);
  if (!f) return json(res, 404, { error: 'not found' });
  const ext = ((f.name.match(/\.([a-z0-9]+)$/i) || [])[1] || '').toLowerCase();
  const inline = url.searchParams.get('inline') === '1' && IMGT[ext], audio = url.searchParams.get('audio') === '1' && AUDIOT[ext];
  let start = 0, end = f.size - 1, code = 200;
  if (audio && req.headers.range) {   // streaming playback needs byte ranges for seeking
    const mm = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (mm && (mm[1] || mm[2])) {
      if (mm[1]) { start = +mm[1]; if (mm[2]) end = Math.min(end, +mm[2]); } else start = Math.max(0, f.size - +mm[2]);
      if (start > end || start >= f.size) { res.writeHead(416, { 'Content-Range': 'bytes */' + f.size, ...SEC }); return res.end(); }
      code = 206;
    }
  }
  const st = fs.createReadStream(path.join(UP, f.id), audio ? { start, end } : undefined);
  st.on('error', e => { log('ERROR', 'download failed: ' + e.message); if (!res.headersSent) json(res, 410, { error: 'file is no longer available' }); else res.destroy(); });
  st.on('open', () => {
    const disp = `${inline || audio ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`;
    res.writeHead(code, { 'Content-Type': audio ? AUDIOT[ext] : inline ? IMGT[ext] : 'application/octet-stream', 'Content-Length': audio ? end - start + 1 : f.size, ...(audio ? { 'Accept-Ranges': 'bytes' } : {}), ...(code === 206 ? { 'Content-Range': `bytes ${start}-${end}/${f.size}` } : {}), 'Cache-Control': 'private, no-store', 'Content-Disposition': disp, ...SEC, ...(inline || audio ? { 'Content-Security-Policy': "default-src 'none'; sandbox" } : {}) });
    st.pipe(res);
  });
  res.on('close', () => st.destroy());
}

const server = (TLS ? h => https.createServer(TLS, h) : h => http.createServer(h))((req, res) => {
  let url; try { url = new URL(req.url, 'http://x'); } catch { return json(res, 400, { error: 'bad url' }); }
  if (url.pathname === '/healthz') return json(res, 200, { ok: true, uptime: Math.round(process.uptime()), online: online().length });
  if (url.pathname === '/api/info') return json(res, 200, { name: SITE, needCode: !!CODE, maxMB: Math.round(MAX_FILE / 1048576) });
  if (req.method === 'POST' && url.pathname === '/api/session') {   // sets the HttpOnly cookie used only for downloads/previews (token never goes in a URL)
    const s = authToken(req.headers['x-token']); if (!s) return json(res, 401, { error: 'not signed in' });
    return json(res, 200, { ok: true }, { 'Set-Cookie': `cn_s=${s.token}; HttpOnly; SameSite=Strict; Path=/f/; Max-Age=${Math.floor(SESSION_MS / 1000)}${isSecure(req) ? '; Secure' : ''}` });
  }
  if (req.method === 'POST' && url.pathname === '/upload') return handleUpload(req, res);
  const dl = url.pathname.match(/^\/f\/([a-f0-9]{16})$/);
  if (req.method === 'GET' && dl) return handleDownload(req, res, url, dl[1]);
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method not allowed' });
  let rel; try { rel = decodeURIComponent(url.pathname); } catch { return json(res, 400, { error: 'bad path' }); }
  if (rel.includes('\0')) return json(res, 400, { error: 'bad path' });
  const fp = path.join(PUB, path.normalize(rel === '/' ? '/index.html' : rel));
  if (!fp.startsWith(PUB + path.sep)) return json(res, 403, { error: 'forbidden' });
  fs.readFile(fp, (err, buf) => {
    if (err) return json(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...SEC });
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
});
server.requestTimeout = 0;      // uploads may take long; stalled bodies are cut by the per-upload inactivity timeout
server.headersTimeout = 30000; server.keepAliveTimeout = 5000;

/* ---------- WebSocket ---------- */
const wss = new WebSocketServer({
  server, maxPayload: 16 * 1024,
  verifyClient: ({ origin, req }) => { if (!origin) return true; try { return new URL(origin).host === req.headers.host; } catch { return false; } }
});
const conns = new Map();

function dmsFor(name) {
  const out = {}, k = name.toLowerCase();
  for (const [key, arr] of dms) if (key.split('|').includes(k)) arr.forEach(m => { const other = m.from.toLowerCase() === k ? m.to : m.from; (out[other] = out[other] || []).push(m); });
  return out;
}
function relayTyping(s, m) {
  const o = { t: 'typing', from: s.name };
  if (typeof m.room === 'string' && roomOk(m.room, s.name)) { o.room = m.room; const g = groupOf(m.room); online().forEach(x => { if (x !== s && (!g || roleOf(g, x.name))) send(x.ws, o); }); }
  else if (typeof m.to === 'string') { const to = findByName(m.to); if (to && to.ws) send(to.ws, o); }
}
async function join(ws, m) {
  if (ws.s || ws.joining) return; ws.joining = true;
  try { await doJoin(ws, m); } catch (e) { log('ERROR', 'join failed: ' + e.message); send(ws, { t: 'err', fatal: true, text: 'Sign-in failed. Try again.' }); }
  finally { ws.joining = false; }
}
async function doJoin(ws, m) {
  const fail = (text, extra) => send(ws, { t: 'err', fatal: true, text, ...extra });
  if (CODE) { if (blocked(ws.ip)) return fail('Too many attempts. Wait a minute.'); if (!safeEq(String(m.code || ''), CODE)) { strike(ws.ip, 30, 120000); return fail('Wrong access code.'); } }
  let s = authToken(m.token);
  if (s) { if (s.ws && s.ws !== ws) { const old = s.ws; s.ws = null; old.s = null; try { old.close(); } catch { /* ignore */ } } }
  else {
    const name = String(m.name || '').trim(), pw = String(m.password || ''), key = name.toLowerCase(), fk = ws.ip + '|' + key;
    if (!NAME_RE.test(name)) return fail('Name must be 2-20 letters, digits, _ . or -');
    if (pw.length > 128) return fail('Password too long.');
    if (blocked(fk) || blocked(ws.ip)) return fail('Too many attempts. Wait a minute.');
    let u = users[key];
    if (u && m.mode === 'register') return fail('That username is already taken. Sign in instead.');
    if (u) {
      const ok = safeEq(await hashPw(pw, u.salt, u.v), u.hash);
      if (!ok) { strike(fk, 5, 60000); strike(ws.ip, 30, 120000); log('WARN', `failed sign-in for "${name}" from ${ws.ip}`); return fail('Invalid username or password.'); }
      if (u.v !== 2) { u.salt = crypto.randomBytes(16).toString('hex'); u.hash = await hashPw(pw, u.salt, 2); u.v = 2; save('users.json', users); log('INFO', `upgraded password hash of "${u.name}"`); }
    } else {
      if (m.mode === 'login') { await hashPw(pw, DUMMY_SALT, 2); strike(fk, 5, 60000); strike(ws.ip, 30, 120000); return fail('Invalid username or password.'); }   // same cost and message as a wrong password
      if (blocked('reg|' + ws.ip)) return fail('Too many accounts created from this address. Try later.');
      if (RESERVED.has(key)) return fail('That name is reserved.');
      if (ADMIN_USERS.includes(key) && !(ADMIN && safeEq(String(m.adminCode || ''), ADMIN))) return fail('This name is reserved for an administrator. Enter the admin code.', { need: 'adminCode' });
      if (pw.length < 8) return fail('Choose a password of at least 8 characters.');
      if (WEAK.has(pw.toLowerCase()) || pw.toLowerCase() === key) return fail('That password is too easy to guess.');
      const salt = crypto.randomBytes(16).toString('hex');
      u = users[key] = { name, salt, hash: await hashPw(pw, salt, 2), v: 2, created: Date.now() }; save('users.json', users); strike('reg|' + ws.ip, 10, 3600000);
    }
    fails.delete(fk);
    const clash = findByName(u.name);
    if (clash) { const old = clash.ws; sessions.delete(clash.token); if (old) { old.s = null; try { old.close(); } catch { /* ignore */ } } }
    const now = Date.now(); s = { token: crypto.randomBytes(16).toString('hex'), name: u.name, admin: ADMIN_USERS.includes(key), status: 'online', created: now, seen: now, ws: null };
    sessions.set(s.token, s);
  }
  if (ws.readyState !== 1) { return; }
  clearTimeout(ws.joinTimer); s.ws = ws; ws.s = s;
  const rec = users[s.name.toLowerCase()] || {};
  send(ws, { t: 'welcome', me: s.name, token: s.token, admin: s.admin, site: SITE, rooms: ROOMS, hist: histFor(rec), dms: dmsFor(s.name), users: userList(), all: allNames(), notices, files: publicFiles(), pub: rec.pub || null, blob: rec.blob || null, keys: publicKeys(), maxMB: Math.round(MAX_FILE / 1048576), prefs: prefsOf(rec), myProfile: rec.profile ? pubProfile(rec) : { d: '', b: '', a: '' }, groups: myGroups(s.name), profiles: profilesMap(), notifs: (notifs[ukey(s.name)] || []).slice(0, 50), peerReads: peerReadsFor(s.name) });
  pushUsers();
  addRoomMsg('general', 'system', `${s.name} connected`, 'sys');
}

function onMessage(ws, m) {
  if (m.t === 'join') return join(ws, m);
  const s = ws.s; if (!s) return;
  if (!authToken(s.token)) return;
  if (m.t === 'typing') return relayTyping(s, m);
  if (m.t === 'bye') { sessions.delete(s.token); ws.s = null; s.ws = null; try { ws.close(); } catch { /* ignore */ } pushUsers(); return addRoomMsg('general', 'system', `${s.name} signed out`, 'sys'); }
  const now = Date.now(); ws.hits = ws.hits.filter(t => now - t < 5000);
  if (ws.hits.length >= 10) return send(ws, { t: 'err', text: 'Slow down a little.' });
  ws.hits.push(now);
  const str = v => typeof v === 'string';

  if (m.t === 'msg') {
    const text = clean(m.text); if (!text || !str(m.room) || !roomOk(m.room, s.name)) return;
    let reply; if (m.reply) { const r = msgOf(m.room, m.reply, s.name); if (r) reply = { id: r.id, from: r.from, text: snippet(r.text) }; }
    const sent = addRoomMsg(m.room, s.name, text, m.kind === 'me' ? 'me' : 'chat', reply ? { reply } : undefined);
    if (sent) {
      const told = new Set([ukey(s.name)]);
      if (reply) { told.add(ukey(reply.from)); if (reply.from !== 'system') notify(reply.from, { type: 'reply', from: s.name, text: snippet(text), conv: 'r:' + m.room }); }
      for (const mm of text.matchAll(/@([\p{L}\p{N}_.-]{1,30})/gu)) { const u = urec(mm[1]); if (u && !told.has(ukey(u.name)) && roomOk(m.room, u.name)) { told.add(ukey(u.name)); notify(u.name, { type: 'mention', from: s.name, text: snippet(text), conv: 'r:' + m.room }); } }
    }
  } else if (m.t === 'dm') {
    const rec = str(m.to) ? users[m.to.toLowerCase()] : null, e = m.enc;
    if (!rec) return send(ws, { t: 'err', text: `No user named "${String(m.to).slice(0, 20)}".` });
    if (blocksEither(s.name, rec.name)) return send(ws, { t: 'err', text: 'This message could not be delivered.' });
    if (!e || !str(e.iv) || !str(e.ct) || e.iv.length > 32 || e.ct.length > 6000 || !e.ct.length) return send(ws, { t: 'err', text: 'Direct messages must be end-to-end encrypted.' });
    const to = findByName(rec.name);
    const msg = { id: uid(), from: s.name, to: rec.name, enc: { iv: e.iv, ct: e.ct }, ts: Date.now() };
    const k = dmKey(s.name, rec.name), arr = dms.get(k) || []; arr.push(msg); if (arr.length > 300) arr.shift(); dms.set(k, arr); persistDms();
    send(ws, { t: 'dm', m: msg }); if (to && to !== s) send(to.ws, { t: 'dm', m: msg });
  } else if (m.t === 'setkey') {
    const p = m.pub, b = m.blob, ok = (v, n) => str(v) && v.length > 0 && v.length <= n;
    if (!p || p.kty !== 'EC' || p.crv !== 'P-256' || !ok(p.x, 100) || !ok(p.y, 100) || !b || !ok(b.s, 100) || !ok(b.iv, 100) || !ok(b.ct, 3000)) return send(ws, { t: 'err', text: 'Invalid key.' });
    const u = users[s.name.toLowerCase()]; if (!u) return;
    u.pub = { kty: p.kty, crv: p.crv, x: p.x, y: p.y }; u.blob = { s: b.s, iv: b.iv, ct: b.ct }; save('users.json', users);
    bcast({ t: 'key', name: u.name, pub: u.pub });
  } else if (m.t === 'delfile') {
    const f = str(m.id) ? files.find(x => x.id === m.id) : null;
    if (!f || (f.owner !== s.name && !s.admin)) return send(ws, { t: 'err', text: 'You can only delete your own files.' });
    files = files.filter(x => x !== f); fs.unlink(path.join(UP, f.id), () => {}); save('files.json', files);
    bcast({ t: 'files', files: publicFiles() });
  } else if (m.t === 'admin') {
    const k = 'adm|' + s.name; if (blocked(k)) return send(ws, { t: 'err', text: 'Too many attempts. Wait a few minutes.' });
    if (ADMIN && safeEq(String(m.code || ''), ADMIN)) { s.admin = true; send(ws, { t: 'admin', ok: true }); log('INFO', `${s.name} enabled admin mode`); }
    else { strike(k, 5, 300000); send(ws, { t: 'err', text: 'Admin is not enabled or the code is wrong.' }); }
  } else if (m.t === 'status') {
    if (['online', 'away', 'busy'].includes(m.status)) { s.status = m.status; pushUsers(); }
  } else if (m.t === 'delmsg') {
    if (!str(m.room) || !roomOk(m.room, s.name) || !str(m.id)) return;
    const arr = histOf(m.room), i = arr.findIndex(x => x.id === m.id); if (i < 0) return;
    if (arr[i].from !== s.name && !canMod(m.room, s)) return;
    arr.splice(i, 1); saveRoom(m.room); toRoom(m.room, { t: 'delmsg', room: m.room, id: m.id });
  } else if (m.t === 'notice') {
    if (!s.admin) return send(ws, { t: 'err', text: 'Only admins can post notices.' });
    const text = clean(m.text); if (!text) return;
    notices = [{ id: uid(), text, by: s.name, ts: Date.now() }, ...notices].slice(0, 50); save('notices.json', notices); bcast({ t: 'notices', notices });
  } else if (m.t === 'edit') {
    if (m.room) { const x = msgOf(m.room, m.id, s.name), text = clean(m.text); if (!x || x.from !== s.name || !text) return; x.text = text; x.edited = Date.now(); saveRoom(m.room); toRoom(m.room, { t: 'upd', room: m.room, m: x }); }
    else { const x = dmOf(s.name, m.to, m.id); if (!x || x.from !== s.name || !encValid(m.enc)) return; x.enc = { iv: m.enc.iv, ct: m.enc.ct }; x.edited = Date.now(); persistDms(); toBoth(x, { t: 'dmupd', m: x }); }
  } else if (m.t === 'deldm') {
    const x = dmOf(s.name, m.to, m.id); if (!x || x.from !== s.name) return;
    const k = dmKey(s.name, m.to); dms.set(k, dms.get(k).filter(y => y !== x)); persistDms(); toBoth(x, { t: 'dmdel', a: x.from, b: x.to, id: x.id });
  } else if (m.t === 'react') {
    if (!REACTS.includes(m.emoji)) return;
    const x = m.room ? msgOf(m.room, m.id, s.name) : dmOf(s.name, m.to, m.id); if (!x) return;
    if (x.reactions && !Object.prototype.hasOwnProperty.call(x.reactions, m.emoji) && Object.keys(x.reactions).length >= 12) return;
    x.reactions = x.reactions || {}; const arr = x.reactions[m.emoji] = x.reactions[m.emoji] || [], on = toggle(arr, s.name);
    if (!arr.length) delete x.reactions[m.emoji]; if (!Object.keys(x.reactions).length) delete x.reactions;
    if (m.room) { saveRoom(m.room); toRoom(m.room, { t: 'upd', room: m.room, m: x }); } else { persistDms(); toBoth(x, { t: 'dmupd', m: x }); }
    if (on && x.from !== s.name && x.from !== 'system') notify(x.from, { type: 'react', from: s.name, text: m.emoji + ' ' + (m.room ? snippet(x.text) : 'your private message'), conv: m.room ? 'r:' + m.room : 'd:' + ukey(s.name) });
  } else if (m.t === 'pin') {
    if (!canMod(m.room, s)) return send(ws, { t: 'err', text: 'Only admins and moderators can pin messages.' });
    const x = msgOf(m.room, m.id, s.name); if (!x) return;
    if (m.on && (histOf(m.room) || []).filter(y => y.pinned).length >= 5 && !x.pinned) return send(ws, { t: 'err', text: 'At most 5 pinned messages per channel.' });
    if (m.on) x.pinned = true; else delete x.pinned; saveRoom(m.room); toRoom(m.room, { t: 'upd', room: m.room, m: x });
  } else if (m.t === 'read') {
    const k = convKey(m.k, s.name), u = urec(s.name), ts = Number(m.ts); if (!k || !u || !Number.isFinite(ts) || ts > Date.now() + 5000) return;
    u.reads = u.reads || {}; if ((u.reads[k] || 0) >= ts || (!u.reads[k] && Object.keys(u.reads).length >= 500)) return;
    u.reads[k] = ts; save('users.json', users);
    if (k.startsWith('d:') && !(u.profile && u.profile.receipts === false)) toUser(users[k.slice(2)].name, { t: 'receipt', from: s.name, ts });
  } else if (m.t === 'mute') {
    const k = convKey(m.k, s.name), u = urec(s.name); if (!k || !u) return;
    u.muted = u.muted || []; const has = u.muted.includes(k); if (!!m.on !== has) { if (m.on) u.muted.push(k); else u.muted = u.muted.filter(x => x !== k); }
    save('users.json', users); send(ws, { t: 'prefs', muted: u.muted });
  } else if (m.t === 'profile') {
    const u = urec(s.name); if (!u) return; const av = m.avatar === undefined ? (u.profile || {}).avatar || '' : m.avatar;
    if (typeof av !== 'string' || (av && (av.length > 8000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(av)))) return send(ws, { t: 'err', text: 'Avatar must be a small png/jpeg/webp image.' });
    const music = m.music === undefined ? (u.profile || {}).music || '' : (typeof m.music === 'string' && musicOf(m.music) ? m.music : '');
    u.profile = { display: line(m.display, 30), bio: line(m.bio, 200), avatar: av, receipts: m.receipts !== false, music };
    save('users.json', users); bcast({ t: 'profile', name: u.name, p: pubProfile(u) }); send(ws, { t: 'prefs', receipts: u.profile.receipts });
  } else if (m.t === 'search') {
    const q = line(m.q, 30).toLowerCase(), me = urec(s.name); if (!q) return send(ws, { t: 'results', q: '', users: [] });
    const out = Object.values(users).filter(u => !blocksEither(u.name, s.name) || u.name === s.name).filter(u => u.name.toLowerCase().includes(q) || ((u.profile || {}).display || '').toLowerCase().includes(q))
      .sort((a, b) => (b.name.toLowerCase().startsWith(q) - a.name.toLowerCase().startsWith(q)) || a.name.localeCompare(b.name)).slice(0, 20)
      .map(u => ({ n: u.name, ...pubProfile(u), fo: Object.values(users).filter(x => (x.following || []).includes(ukey(u.name))).length, f: (me.following || []).includes(ukey(u.name)), bl: (me.blocked || []).includes(ukey(u.name)) }));
    send(ws, { t: 'results', q, users: out });
  } else if (m.t === 'follow' || m.t === 'block') {
    const me = urec(s.name), tg = urec(m.name); if (!me || !tg || tg === me) return;
    const f = m.t === 'follow' ? 'following' : 'blocked', k = ukey(tg.name); me[f] = me[f] || [];
    if (f === 'following' && m.on && blocksEither(me.name, tg.name)) return send(ws, { t: 'err', text: 'You cannot follow this user.' });
    const has = me[f].includes(k); if (!!m.on !== has) { if (m.on) me[f].push(k); else me[f] = me[f].filter(x => x !== k); if (m.on && f === 'following') notify(tg.name, { type: 'follow', from: s.name, text: 'started following you' }); }
    if (f === 'blocked' && m.on) { me.following = (me.following || []).filter(x => x !== k); tg.following = (tg.following || []).filter(x => x !== ukey(me.name)); }
    save('users.json', users); send(ws, { t: 'prefs', following: me.following || [], blocked: me.blocked || [] });
  } else if (m.t === 'post') {
    const text = clean(m.text).slice(0, 500); if (!text) return;
    const p = { id: uid(), by: s.name, text, ts: Math.max(Date.now(), ((posts[0] || {}).ts || 0) + 1), likes: [] }; posts.unshift(p); if (posts.length > 2000) posts.pop(); save('posts.json', posts);
    online().forEach(o => { if (!blocksEither(o.name, s.name)) send(o.ws, { t: 'post', p, f: o.name === s.name || ((urec(o.name) || {}).following || []).includes(ukey(s.name)) }); });
  } else if (m.t === 'feed') {
    const scope = m.scope === 'following' ? 'following' : 'all', me = urec(s.name), fol = new Set(me.following || []), before = Number.isFinite(m.before) ? m.before : Infinity;
    const list = posts.filter(p => p.ts < before && !blocksEither(s.name, p.by) && (scope === 'all' || p.by === s.name || fol.has(ukey(p.by))));
    send(ws, { t: 'feed', scope, before: Number.isFinite(m.before) ? m.before : null, posts: list.slice(0, 20), more: list.length > 20 });
  } else if (m.t === 'like') {
    const p = posts.find(x => x.id === m.id); if (!p || blocksEither(s.name, p.by)) return;
    const on = toggle(p.likes, s.name); save('posts.json', posts); bcast({ t: 'plike', id: p.id, likes: p.likes });
    if (on && p.by !== s.name) notify(p.by, { type: 'like', from: s.name, text: snippet(p.text) });
  } else if (m.t === 'delpost') {
    const p = posts.find(x => x.id === m.id); if (!p || (p.by !== s.name && !s.admin)) return;
    posts.splice(posts.indexOf(p), 1); save('posts.json', posts); bcast({ t: 'pdel', id: p.id });
  } else if (m.t === 'call') {
    const tg = urec(m.to), me = urec(s.name);
    if (!tg || tg === me || blocksEither(s.name, tg.name) || typeof m.nonce !== 'string' || !/^[A-Za-z0-9+/=]{4,12}$/.test(m.nonce)) return send(ws, { t: 'err', text: 'This call could not be started.' });
    if (inCall.has(ukey(s.name))) return send(ws, { t: 'err', text: 'You are already in a call.' });
    const id = uid(), target = findByName(tg.name);
    if (!target || !target.ws) return send(ws, { t: 'callstate', id, state: 'offline', peer: tg.name });
    if (inCall.has(ukey(tg.name))) return send(ws, { t: 'callstate', id, state: 'busy', peer: tg.name });
    calls.set(id, { id, a: s.name, b: tg.name, state: 'ringing', timer: setTimeout(() => endCall(id, 'noanswer'), RING_MS) }); inCall.set(ukey(s.name), id); inCall.set(ukey(tg.name), id);
    send(ws, { t: 'callstate', id, state: 'ringing', peer: tg.name }); send(target.ws, { t: 'incoming', id, from: s.name, nonce: m.nonce });
  } else if (m.t === 'callans') {
    const c = calls.get(m.id); if (!c || c.state !== 'ringing' || ukey(c.b) !== ukey(s.name)) return;
    if (!m.accept) return endCall(c.id, 'declined');
    clearTimeout(c.timer); c.state = 'active'; toUser(c.a, { t: 'callstate', id: c.id, state: 'accepted', peer: c.b }); send(ws, { t: 'callstate', id: c.id, state: 'accepted', peer: c.a });
  } else if (m.t === 'callend') {
    const c = calls.get(m.id); if (!c || ukey(c.a) !== ukey(s.name) && ukey(c.b) !== ukey(s.name)) return; endCall(c.id, c.state === 'ringing' && ukey(c.a) === ukey(s.name) ? 'cancelled' : 'ended');
  } else if (m.t === 'ping') {
    send(ws, { t: 'pong', id: String(m.id || '').slice(0, 32) });
  } else if (m.t === 'gcreate') {
    const name = line(m.name, 40); if (!name) return;
    if (Object.values(groups).filter(g => g.owner === ukey(s.name)).length >= 10) return send(ws, { t: 'err', text: 'You can own at most 10 groups.' });
    let id; do { id = Math.random().toString(36).slice(2, 10); } while (!id || groups[id]);
    const g = groups[id] = { id, name, desc: line(m.desc, 200), pub: !!m.pub, owner: ukey(s.name), members: { [ukey(s.name)]: 'owner' }, created: Date.now(), hist: [] };
    save('groups.json', groups); pushGroup(g);
  } else if (m.t === 'gjoin' || m.t === 'ginvite') {
    const g = groups[String(m.id)]; if (!g) return;
    const who = m.t === 'gjoin' ? urec(s.name) : urec(m.name);
    if (!who || roleOf(g, who.name) || Object.keys(g.members).length >= 200) return;
    if (m.t === 'gjoin' ? !g.pub : (!['owner', 'mod'].includes(roleOf(g, s.name)) || blocksEither(s.name, who.name))) return send(ws, { t: 'err', text: m.t === 'gjoin' ? 'This group is invite-only.' : 'You cannot invite this user.' });
    g.members[ukey(who.name)] = 'member'; save('groups.json', groups); pushGroup(g);
    addRoomMsg('g:' + g.id, 'system', who.name + (m.t === 'gjoin' ? ' joined' : ' was invited by ' + s.name), 'sys');
    if (m.t === 'ginvite') notify(who.name, { type: 'invite', from: s.name, text: 'added you to ' + g.name, conv: 'r:g:' + g.id });
  } else if (m.t === 'gkick' || m.t === 'grole' || m.t === 'gleave') {
    const g = groups[String(m.id)], me = roleOf(g, s.name); if (!g || !me) return;
    const tg = m.t === 'gleave' ? urec(s.name) : urec(m.name), tr = tg && roleOf(g, tg.name); if (!tg || !tr || tr === 'owner') return;
    if (m.t === 'grole') { if (me !== 'owner' || !['mod', 'member'].includes(m.role)) return; g.members[ukey(tg.name)] = m.role; save('groups.json', groups); return pushGroup(g); }
    if (m.t === 'gkick' && !(me === 'owner' || (me === 'mod' && tr === 'member'))) return send(ws, { t: 'err', text: 'You do not have permission to remove this member.' });
    delete g.members[ukey(tg.name)]; save('groups.json', groups); toUser(tg.name, { t: 'gleave', id: g.id });
    addRoomMsg('g:' + g.id, 'system', tg.name + (m.t === 'gleave' ? ' left' : ' was removed by ' + s.name), 'sys'); pushGroup(g);
  } else if (m.t === 'gedit' || m.t === 'gdelete') {
    const g = groups[String(m.id)]; if (!g || g.owner !== ukey(s.name)) return;
    if (m.t === 'gedit') { g.name = line(m.name, 40) || g.name; g.desc = line(m.desc, 200); g.pub = !!m.pub; save('groups.json', groups); pushGroup(g); }
    else { Object.keys(g.members).forEach(k => { if (users[k]) toUser(users[k].name, { t: 'gleave', id: g.id }); }); delete groups[g.id]; save('groups.json', groups); }
  } else if (m.t === 'gsearch') {
    const q = line(m.q, 40).toLowerCase(), list = Object.values(groups).filter(g => g.pub && (!q || g.name.toLowerCase().includes(q))).sort((a, b) => b.created - a.created).slice(0, 20);
    send(ws, { t: 'gresults', q, groups: list.map(g => ({ id: g.id, name: g.name, desc: g.desc, n: Object.keys(g.members).length, member: !!roleOf(g, s.name) })) });
  } else if (m.t === 'notifread') {
    (notifs[ukey(s.name)] || []).forEach(n => { n.read = true; }); save('notifs.json', notifs);
  } else if (m.t === 'delnotice') {
    if (!s.admin || !str(m.id)) return;
    notices = notices.filter(n => n.id !== m.id); save('notices.json', notices); bcast({ t: 'notices', notices });
  }
}

wss.on('connection', (ws, req) => {
  ws.ip = (TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '?';
  const c = (conns.get(ws.ip) || 0) + 1; conns.set(ws.ip, c);
  ws.on('close', () => { const n = (conns.get(ws.ip) || 1) - 1; if (n <= 0) conns.delete(ws.ip); else conns.set(ws.ip, n); });
  if (c > MAX_CONN_IP) { ws.close(1013, 'too many connections'); return; }
  ws.alive = true; ws.hits = []; ws.on('pong', () => { ws.alive = true; });
  ws.joinTimer = setTimeout(() => { if (!ws.s) ws.terminate(); }, JOIN_TIMEOUT);
  ws.on('message', (raw, isBinary) => {
    if (isBinary) return relayAudio(ws, raw);
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
    try { onMessage(ws, m); } catch (e) { log('ERROR', `handler "${String(m.t).slice(0, 20)}" failed: ${e.stack || e.message}`); send(ws, { t: 'err', text: 'Server error.' }); }
  });
  ws.on('close', () => {
    clearTimeout(ws.joinTimer); const s = ws.s;
    if (s && s.ws === ws) { s.ws = null; endCallOf(s.name, 'disconnect'); pushUsers(); addRoomMsg('general', 'system', `${s.name} disconnected`, 'sys'); }
  });
  ws.on('error', () => {});
});
setInterval(() => wss.clients.forEach(ws => { if (!ws.alive) return ws.terminate(); ws.alive = false; ws.ping(); }), 30000).unref();
setInterval(() => {   // housekeeping: expired sessions and stale throttle entries
  const now = Date.now(); for (const s of [...sessions.values()]) authToken(s.token) || 0;
  for (const [k, f] of fails) if (f.until < now && now - f.t > 600000) fails.delete(k);
}, 60000).unref();

/* ---------- lifecycle ---------- */
let closing = false;
function shutdown(sig) {
  if (closing) return; closing = true; log('INFO', `${sig} received, flushing data and shutting down`);
  flushAll(); wss.clients.forEach(ws => { try { ws.close(1001, 'server restarting'); } catch { /* ignore */ } });
  server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 4000).unref();
}
['SIGINT', 'SIGTERM'].forEach(sig => process.on(sig, () => shutdown(sig)));
process.on('exit', flushAll);
process.on('uncaughtException', e => { console.error('FATAL uncaught exception:', e); try { flushAll(); } catch { /* ignore */ } process.exit(1); });
process.on('unhandledRejection', e => log('ERROR', 'unhandled rejection: ' + (e && e.stack || e)));

server.on('error', e => bail(e.code === 'EADDRINUSE' ? `port ${PORT} is already in use` : e.message));
server.listen(PORT, '0.0.0.0', () => {
  const port = server.address().port, proto = TLS ? 'https' : 'http';
  console.log(`\n  ${SITE} is running\n  local:   ${proto}://localhost:${port}`);
  for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) if (i.family === 'IPv4' && !i.internal) console.log(`  network: ${proto}://${i.address}:${port}   <- share this on your LAN`);
  if (!TLS) console.log('  note: encrypted DMs need HTTPS or localhost. On a LAN start with HTTPS=1 (self-signed) or put it behind TLS.');
  console.log(`  access code: ${CODE ? 'ON' : 'off'}   max file: ${fmt(MAX_FILE)}   data: ${DATA}\n  listening port=${port}\n`);
});
