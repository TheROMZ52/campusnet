'use strict';
/* Integration tests: each group starts a real server on a random port with a temporary DATA_DIR. Run: npm test */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http'), crypto = require('node:crypto');
const WebSocket = require('ws');
const ROOT = path.join(__dirname, '..'), sleep = ms => new Promise(r => setTimeout(r, ms));

function startServer(env = {}, dir) {
  dir = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'campusnet-test-'));
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env: { ...process.env, PORT: '0', DATA_DIR: dir, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = ''; child.stderr.on('data', d => { err += d; });
  return new Promise((resolve, reject) => {
    child.stdout.on('data', d => { out += d; const m = out.match(/listening port=(\d+)/); if (m) resolve({ port: +m[1], dir, child, base: 'http://127.0.0.1:' + m[1], exited: () => child.exitCode !== null, stderr: () => err, stop: sig => new Promise(r => { if (child.exitCode !== null) return r(); child.once('exit', r); child.kill(sig || 'SIGTERM'); }) }); });
    child.once('exit', c => reject(new Error('server exited early: ' + c + ' ' + err + out)));
    setTimeout(() => reject(new Error('server start timeout ' + err)), 8000);
  });
}
function client(port, headers) {
  const ws = new WebSocket('ws://127.0.0.1:' + port, { headers }), log = []; ws.on('message', d => log.push(JSON.parse(d))); ws.on('error', () => {});
  const wait = async (pred, ms = 4000) => { const t = Date.now(); for (;;) { const m = log.find(pred); if (m) return m; if (Date.now() - t > ms) throw new Error('timeout waiting for message; got ' + JSON.stringify(log.map(x => x.t))); await sleep(15); } };
  return { ws, log, wait, send: o => ws.send(JSON.stringify(o)), ready: new Promise((r, j) => { ws.on('open', r); ws.on('error', j); }), closed: new Promise(r => ws.on('close', r)) };
}
async function signin(s, name, password, extra = {}) {
  const c = client(s.port); await c.ready; c.send({ t: 'join', name, password, ...extra });
  const m = await c.wait(x => x.t === 'welcome' || (x.t === 'err' && x.fatal)); return { c, m, token: m.token };
}
const req = (s, method, p, { headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port: s.port, method, path: p, headers }, res => { const ch = []; res.on('data', d => ch.push(d)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(ch) })); });
  r.on('error', e => (e.code === 'ECONNRESET' || e.code === 'EPIPE') ? resolve({ status: 0, headers: {}, body: Buffer.alloc(0), reset: true }) : reject(e));
  if (body && body.chunks) { (async () => { for (const c of body.chunks) { if (r.destroyed) break; r.write(c); await sleep(5); } r.end(); })(); } else r.end(body);
});
const healthy = async s => (await req(s, 'GET', '/healthz')).status === 200;
const upload = (s, token, data, name = 'a.bin', extra = {}) => req(s, 'POST', '/upload', { headers: { 'x-token': token, 'x-filename': name, ...(Buffer.isBuffer(data) ? { 'Content-Length': data.length } : {}), ...extra }, body: data });
const PW = 'correct-horse-9';

describe('accounts, passwords and request hardening', () => {
  let s; before(async () => { s = await startServer({ ADMIN_USERS: 'boss', ADMIN_CODE: 'adm-secret-1' }); }); after(() => s.stop());
  it('registers, rejects weak/short/reserved passwords and names', async () => {
    const ok = await signin(s, 'alice', PW, { mode: 'register' }); assert.equal(ok.m.t, 'welcome'); assert.equal(ok.m.admin, false);
    assert.match((await signin(s, 'weak1', 'short')).m.text, /8 characters/);
    assert.match((await signin(s, 'weak2', 'password1')).m.text, /too easy/);
    assert.match((await signin(s, 'system', PW)).m.text, /reserved/);
    assert.match((await signin(s, 'Admin', PW)).m.text, /reserved/);
  });
  it('uses one generic message for unknown user and wrong password', async () => {
    const a = await signin(s, 'nobody-here', PW, { mode: 'login' }), b = await signin(s, 'alice', 'wrong-password-1', { mode: 'login' });
    assert.equal(a.m.text, 'Invalid username or password.'); assert.equal(b.m.text, a.m.text);
  });
  it('locks a name after repeated failures, even for the right password', async () => {
    await signin(s, 'carol', PW, { mode: 'register' });
    for (let i = 0; i < 5; i++) await signin(s, 'carol', 'bad-guess-' + i, { mode: 'login' });
    assert.match((await signin(s, 'carol', PW, { mode: 'login' })).m.text, /Too many attempts/);
  });
  it('protects admin names: registering needs the admin code', async () => {
    const no = await signin(s, 'boss', PW); assert.equal(no.m.need, 'adminCode');
    const yes = await signin(s, 'boss', PW, { adminCode: 'adm-secret-1' }); assert.equal(yes.m.admin, true);
    const al = await signin(s, 'alice', PW, { mode: 'login' }); al.c.send({ t: 'notice', text: 'hi' });
    assert.match((await al.c.wait(x => x.t === 'err')).text, /Only admins/);
  });
  it('does not crash on prototype-pollution style input (regression)', async () => {
    const p = await signin(s, '__proto__', PW); assert.equal(p.m.t, 'welcome');
    const { c } = await signin(s, 'alice', PW, { mode: 'login' });
    c.send({ t: 'delmsg', room: '__proto__', id: 'x' }); c.send({ t: 'dm', to: 'constructor', enc: { iv: 'a', ct: 'b' } }); c.send({ t: 'msg', room: ['x'], text: 'y' }); c.send({ t: 'delfile', id: { a: 1 } });
    c.ws.send('not json'); c.ws.send(JSON.stringify([1, 2])); c.ws.send(JSON.stringify({ t: 5 }));
    await sleep(300); assert.equal(await healthy(s), true); assert.equal(s.exited(), false);
  });
  it('ignores everything before sign-in and rejects bad setkey', async () => {
    const c = client(s.port); await c.ready; c.send({ t: 'msg', room: 'general', text: 'anon' }); await sleep(150);
    const { c: a } = await signin(s, 'alice', PW, { mode: 'login' }); assert.equal(a.log.some(m => m.t === 'msg' && m.m.text === 'anon'), false);
    a.send({ t: 'setkey', pub: { kty: 'RSA' }, blob: {} }); assert.match((await a.wait(x => x.t === 'err' && !x.fatal)).text, /Invalid key/);
  });
  it('sends security headers and a health endpoint', async () => {
    const r = await req(s, 'GET', '/'); assert.equal(r.status, 200);
    assert.match(r.headers['content-security-policy'], /default-src 'self'/); assert.equal(r.headers['x-content-type-options'], 'nosniff'); assert.equal(r.headers['x-frame-options'], 'DENY'); assert.equal(r.headers['referrer-policy'], 'no-referrer');
  });
  it('blocks path traversal and does not expose the data directory', async () => {
    for (const p of ['/../server.js', '/%2e%2e/server.js', '/..%2fserver.js', '/data/users.json', '/%00']) { const r = await req(s, 'GET', p); assert.notEqual(r.status, 200, p); assert.equal(r.body.toString().includes('CampusNet server'), false, p); }
  });
  it('rejects cross-origin WebSocket connections', async () => {
    const c = client(s.port, { Origin: 'http://evil.example' }); const r = await Promise.race([c.ready.then(() => 'open', () => 'rejected'), sleep(2000).then(() => 'timeout')]); assert.equal(r, 'rejected');
  });
});

describe('sessions', () => {
  it('logout invalidates the session token server-side', async () => {
    const s = await startServer(); try {
      const { c, token } = await signin(s, 'dave', PW); assert.equal((await req(s, 'POST', '/api/session', { headers: { 'x-token': token } })).status, 200);
      c.send({ t: 'bye' }); await sleep(200);
      assert.equal((await req(s, 'POST', '/api/session', { headers: { 'x-token': token } })).status, 401);
      assert.equal((await upload(s, token, Buffer.from('x'))).status, 401);
      const re = client(s.port); await re.ready; re.send({ t: 'join', token }); assert.equal((await re.wait(m => m.t === 'err')).fatal, true);
    } finally { await s.stop(); }
  });
  it('expires idle sessions', async () => {
    const s = await startServer({ SESSION_IDLE_HOURS: '0.0003' }); try {
      const { token } = await signin(s, 'erin', PW); assert.equal((await req(s, 'POST', '/api/session', { headers: { 'x-token': token } })).status, 200);
      await sleep(1500); assert.equal((await req(s, 'POST', '/api/session', { headers: { 'x-token': token } })).status, 401);
    } finally { await s.stop(); }
  });
  it('closes sockets that never sign in', async () => {
    const s = await startServer({ JOIN_TIMEOUT_MS: '300' }); try { const c = client(s.port); await c.ready; await Promise.race([c.closed, sleep(2500).then(() => { throw new Error('socket stayed open'); })]); } finally { await s.stop(); }
  });
  it('limits connections per address', async () => {
    const s = await startServer({ MAX_CONNECTIONS_PER_IP: '3' }); try {
      const cs = []; for (let i = 0; i < 4; i++) { const c = client(s.port); await c.ready.catch(() => {}); cs.push(c); }
      assert.equal(await Promise.race([cs[3].closed.then(() => true), sleep(1500).then(() => false)]), true);
    } finally { await s.stop(); }
  });
});

describe('private messages and persistence', () => {
  it('accepts only encrypted DMs, relays ciphertext, and survives a restart', async () => {
    let s = await startServer(); const dir = s.dir;
    try {
      const a = await signin(s, 'alice', PW), b = await signin(s, 'bob', PW);
      a.c.send({ t: 'dm', to: 'bob', text: 'plaintext attempt' }); assert.match((await a.c.wait(x => x.t === 'err' && !x.fatal)).text, /end-to-end/);
      a.c.send({ t: 'dm', to: 'bob', enc: { iv: 'AAAAAAAAAAAAAAAA', ct: 'Y2lwaGVydGV4dA==' } });
      const got = await b.c.wait(x => x.t === 'dm'); assert.equal(got.m.text, undefined); assert.equal(got.m.enc.ct, 'Y2lwaGVydGV4dA==');
      a.c.send({ t: 'msg', room: 'general', text: 'persisted room message' }); await b.c.wait(x => x.t === 'msg' && x.m.text === 'persisted room message');
      await s.stop('SIGTERM');   // shutdown must flush the debounced writes
      s = await startServer({}, dir);
      const b2 = await signin(s, 'bob', PW, { mode: 'login' }); assert.equal(b2.m.t, 'welcome');
      assert.equal(b2.m.dms.alice.length, 1); assert.equal(b2.m.dms.alice[0].enc.ct, 'Y2lwaGVydGV4dA==');
      assert.ok(b2.m.hist.general.some(m => m.text === 'persisted room message'));
      assert.ok(b2.m.all.includes('alice'));
    } finally { await s.stop(); }
  });
  it('keeps no plaintext of DMs on disk', async () => {
    const s = await startServer(); try {
      const a = await signin(s, 'alice', PW); await signin(s, 'bob', PW); a.c.send({ t: 'dm', to: 'bob', enc: { iv: 'AAAAAAAAAAAAAAAA', ct: 'c2VjcmV0' } }); await sleep(700);
      assert.ok(fs.existsSync(path.join(s.dir, 'dms.json'))); assert.equal(/"text"/.test(fs.readFileSync(path.join(s.dir, 'dms.json'), 'utf8')), false);
    } finally { await s.stop(); }
  });
});

describe('files: limits, quotas, authorization', () => {
  let s, a, b; before(async () => { s = await startServer({ MAX_FILE_MB: '1', MAX_STORAGE_MB: '1' }); a = await signin(s, 'alice', PW); b = await signin(s, 'bob', PW); }); after(() => s.stop());
  const stored = () => fs.readdirSync(path.join(s.dir, 'uploads')).map(n => fs.statSync(path.join(s.dir, 'uploads', n)).size);
  it('stores a small upload and announces it', async () => {
    assert.equal((await upload(s, a.token, Buffer.from('hello file'), 'hello.txt')).status, 200);
    const f = await a.c.wait(m => m.t === 'files' && m.files.length); assert.equal(f.files[0].name, 'hello.txt');
  });
  it('rejects empty uploads and declared oversize uploads', async () => {
    assert.equal((await upload(s, a.token, Buffer.alloc(0), 'e.bin')).status, 400);
    const r = await upload(s, a.token, Buffer.alloc(2 * 1048576), 'big.bin'); assert.ok(r.status === 413 || r.reset, 'status ' + r.status);
  });
  it('enforces the size limit while streaming (no Content-Length) and cleans up partial files', async () => {
    const before = stored().length, chunk = Buffer.alloc(512 * 1024);
    const r = await req(s, 'POST', '/upload', { headers: { 'x-token': a.token, 'x-filename': 'chunked.bin' }, body: { chunks: [chunk, chunk, chunk, chunk] } });
    assert.ok([413, 507].includes(r.status) || r.reset, 'status ' + r.status); await sleep(300); assert.equal(stored().length, before);   // 413 (file limit) or 507 (storage quota) both stop the stream
  });
  it('cannot exceed total storage with concurrent uploads', async () => {
    const results = await Promise.all([1, 2, 3, 4].map(i => upload(s, i % 2 ? a.token : b.token, Buffer.alloc(400000, i), 'c' + i + '.bin')));
    const okCount = results.filter(r => r.status === 200).length; assert.ok(okCount <= 2, 'accepted ' + okCount); assert.ok(results.some(r => r.status === 507), 'expected a 507');
    await sleep(300); assert.ok(stored().reduce((x, y) => x + y, 0) <= 1048576, 'storage exceeded');
  });
  it('requires the HttpOnly session cookie to download and never accepts tokens in URLs', async () => {
    const f = (await a.c.wait(m => m.t === 'files' && m.files.some(x => x.name === 'hello.txt'))).files.find(x => x.name === 'hello.txt');
    assert.equal((await req(s, 'GET', '/f/' + f.id)).status, 401); assert.equal((await req(s, 'GET', `/f/${f.id}?t=${a.token}`)).status, 401);
    const ses = await req(s, 'POST', '/api/session', { headers: { 'x-token': a.token } }); const ck = ses.headers['set-cookie'][0]; assert.match(ck, /HttpOnly/); assert.match(ck, /SameSite=Strict/); assert.match(ck, /Path=\/f\//);
    const r = await req(s, 'GET', '/f/' + f.id, { headers: { cookie: ck.split(';')[0] } }); assert.equal(r.status, 200); assert.equal(r.body.toString(), 'hello file'); assert.match(r.headers['content-disposition'], /^attachment/); assert.equal(r.headers['content-type'], 'application/octet-stream');
  });
  it('never serves SVG/HTML inline and sandboxes image previews', async () => {
    const ck = (await req(s, 'POST', '/api/session', { headers: { 'x-token': a.token } })).headers['set-cookie'][0].split(';')[0];
    await upload(s, a.token, Buffer.from('<svg onload=alert(1)>'), 'x.svg'); await upload(s, a.token, Buffer.from('89504e470d0a1a0a', 'hex'), 'p.png');
    const list = (await a.c.wait(m => m.t === 'files' && m.files.some(x => x.name === 'p.png'))).files;
    const svg = await req(s, 'GET', '/f/' + list.find(x => x.name === 'x.svg').id + '?inline=1', { headers: { cookie: ck } }); assert.equal(svg.headers['content-type'], 'application/octet-stream'); assert.match(svg.headers['content-disposition'], /^attachment/);
    const png = await req(s, 'GET', '/f/' + list.find(x => x.name === 'p.png').id + '?inline=1', { headers: { cookie: ck } }); assert.equal(png.headers['content-type'], 'image/png'); assert.match(png.headers['content-security-policy'], /sandbox/);
  });
  it('lets only the owner (or an admin) delete a file', async () => {
    const f = (await a.c.wait(m => m.t === 'files')).files[0]; b.c.send({ t: 'delfile', id: f.id }); assert.match((await b.c.wait(m => m.t === 'err' && !m.fatal)).text, /only delete your own/);
    a.c.send({ t: 'delfile', id: f.id }); await a.c.wait(m => m.t === 'files' && !m.files.some(x => x.id === f.id));
  });
});

describe('migration and data safety', () => {
  it('upgrades legacy scrypt hashes on login without locking the user out', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campusnet-mig-')), salt = crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(path.join(dir, 'users.json'), JSON.stringify({ legacy: { name: 'Legacy', salt, hash: crypto.scryptSync('old-password-1', salt, 32).toString('hex') } }));
    let s = await startServer({}, dir);
    try {
      assert.equal((await signin(s, 'legacy', 'old-password-1', { mode: 'login' })).m.t, 'welcome'); await s.stop();
      const u = JSON.parse(fs.readFileSync(path.join(dir, 'users.json'), 'utf8')).legacy; assert.equal(u.v, 2); assert.notEqual(u.salt, salt);
      assert.ok(fs.existsSync(path.join(dir, 'users.json.bak')), 'backup of previous file kept');
      s = await startServer({}, dir); assert.equal((await signin(s, 'Legacy', 'old-password-1', { mode: 'login' })).m.t, 'welcome'); assert.equal((await signin(s, 'legacy', 'wrong-password-1', { mode: 'login' })).m.t, 'err');
    } finally { await s.stop(); }
  });
  it('recovers from a corrupt data file using the backup and preserves the corrupt copy', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campusnet-bak-'));
    fs.writeFileSync(path.join(dir, 'messages.json'), '{ this is not json'); fs.writeFileSync(path.join(dir, 'messages.json.bak'), JSON.stringify({ general: [{ id: 'm1', room: 'general', from: 'x', text: 'from backup', ts: 1, kind: 'chat' }] }));
    const s = await startServer({}, dir); try {
      const { m } = await signin(s, 'frank', PW); assert.ok(m.hist.general.some(x => x.text === 'from backup'));
      assert.ok(fs.readdirSync(dir).some(n => n.startsWith('messages.json.corrupt-')), 'corrupt file preserved');
    } finally { await s.stop(); }
  });
  it('refuses to start with invalid configuration', async () => {
    for (const env of [{ MAX_FILE_MB: 'abc' }, { ADMIN_USERS: 'boss' }]) { await assert.rejects(() => startServer(env), /configuration error|exited early/); }
  });
});
