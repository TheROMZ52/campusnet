'use strict';
/* CampusNet server: static files + WebSocket chat + streamed file uploads. Only dependency: ws.
   Security model: see README ("Security"). Persistence: atomic JSON files in DATA_DIR with .bak fallback. */
const http = require('http'), https = require('https'), fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const { execFileSync } = require('child_process');
const { WebSocketServer } = require('ws');

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
const publicFiles = () => files.map(({ id, name, size, owner, ts }) => ({ id, name, size, owner, ts, img: IMG.test(name) }));
function addRoomMsg(room, from, text, kind) {
  if (!ROOMS.includes(room)) return;
  const m = { id: uid(), room, from, text, ts: Date.now(), kind };
  hist[room].push(m); if (hist[room].length > 300) hist[room].shift();
  save('messages.json', hist); bcast({ t: 'msg', m });
}
function dropSession(s, why) {
  sessions.delete(s.token); const w = s.ws;
  if (w) { s.ws = null; w.s = null; send(w, { t: 'err', fatal: true, text: 'Session ended (' + why + '). Sign in again.' }); try { w.close(); } catch { /* ignore */ } pushUsers(); }
  log('INFO', `session of ${s.name} dropped: ${why}`);
}
function authToken(t) {
  if (typeof t !== 'string') return null; const s = sessions.get(t); if (!s) return null;
  const now = Date.now(); if (now - s.created > SESSION_MS) { dropSession(s, 'expired'); return null; } if (now - s.seen > IDLE_MS) { dropSession(s, 'idle'); return null; }
  s.seen = now; return s;
}

/* ---------- HTTP ---------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
const SEC = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
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
  const inline = url.searchParams.get('inline') === '1' && IMGT[ext];
  const st = fs.createReadStream(path.join(UP, f.id));
  st.on('error', e => { log('ERROR', 'download failed: ' + e.message); if (!res.headersSent) json(res, 410, { error: 'file is no longer available' }); else res.destroy(); });
  st.on('open', () => {
    res.writeHead(200, { 'Content-Type': inline ? IMGT[ext] : 'application/octet-stream', 'Content-Length': f.size, 'Cache-Control': 'private, no-store', 'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`, ...SEC, ...(inline ? { 'Content-Security-Policy': "default-src 'none'; sandbox" } : {}) });
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
  if (typeof m.room === 'string' && ROOMS.includes(m.room)) { o.room = m.room; online().forEach(x => { if (x !== s) send(x.ws, o); }); }
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
  send(ws, { t: 'welcome', me: s.name, token: s.token, admin: s.admin, site: SITE, rooms: ROOMS, hist, dms: dmsFor(s.name), users: userList(), all: allNames(), notices, files: publicFiles(), pub: rec.pub || null, blob: rec.blob || null, keys: publicKeys(), maxMB: Math.round(MAX_FILE / 1048576) });
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
    const text = clean(m.text); if (!text || !str(m.room) || !ROOMS.includes(m.room)) return;
    addRoomMsg(m.room, s.name, text, m.kind === 'me' ? 'me' : 'chat');
  } else if (m.t === 'dm') {
    const rec = str(m.to) ? users[m.to.toLowerCase()] : null, e = m.enc;
    if (!rec) return send(ws, { t: 'err', text: `No user named "${String(m.to).slice(0, 20)}".` });
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
    if (!str(m.room) || !ROOMS.includes(m.room) || !str(m.id)) return;
    const arr = hist[m.room], i = arr.findIndex(x => x.id === m.id); if (i < 0) return;
    if (arr[i].from !== s.name && !s.admin) return;
    arr.splice(i, 1); save('messages.json', hist); bcast({ t: 'delmsg', room: m.room, id: m.id });
  } else if (m.t === 'notice') {
    if (!s.admin) return send(ws, { t: 'err', text: 'Only admins can post notices.' });
    const text = clean(m.text); if (!text) return;
    notices = [{ id: uid(), text, by: s.name, ts: Date.now() }, ...notices].slice(0, 50); save('notices.json', notices); bcast({ t: 'notices', notices });
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
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
    try { onMessage(ws, m); } catch (e) { log('ERROR', `handler "${String(m.t).slice(0, 20)}" failed: ${e.stack || e.message}`); send(ws, { t: 'err', text: 'Server error.' }); }
  });
  ws.on('close', () => {
    clearTimeout(ws.joinTimer); const s = ws.s;
    if (s && s.ws === ws) { s.ws = null; pushUsers(); addRoomMsg('general', 'system', `${s.name} disconnected`, 'sys'); }
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
