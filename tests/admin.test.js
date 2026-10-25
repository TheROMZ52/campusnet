'use strict';
/* Integration tests: each group starts a real server on a random port with a temporary DATA_DIR. Run: npm test */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http'), crypto = require('node:crypto');
const WebSocket = require('../vendor/ws');
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
const PW = 'correct-horse-9', ADMIN_CODE = 'adm-secret-1';
const { unzip } = require('../lib/zip');
const { spawnSync } = require('node:child_process');
const reg = (s, name, extra) => signin(s, name, PW, { mode: 'register', ...extra });
const adminReg = s => reg(s, 'boss', { adminCode: ADMIN_CODE });
const has = (c, pred) => c.log.some(pred);
const until = async (fn, ms = 3000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('condition not met'); await sleep(15); } };
const get = (s, p, token) => req(s, 'GET', p, { headers: token ? { cookie: 'cn_s=' + token } : {} });
const fail = async (s, name, pw) => (await signin(s, name, pw, { mode: 'login' })).m;

describe('admin tools', () => {
  let s, boss, ann, bob, cy;
  before(async () => { s = await startServer({ ADMIN_USERS: 'boss', ADMIN_CODE, BACKUP_EVERY_HOURS: '0' }); boss = await adminReg(s); ann = await reg(s, 'ann'); bob = await reg(s, 'bob'); cy = await reg(s, 'cy'); });
  after(async () => { [boss, ann, bob, cy].forEach(x => x.c.ws.close()); await s.stop(); });
  it('only administrators can use admin messages', async () => {
    ann.c.send({ t: 'adminusers' }); ann.c.send({ t: 'adminban', name: 'bob', on: true }); ann.c.send({ t: 'adminstats' });
    await until(() => ann.c.log.filter(x => x.t === 'err' && /Only admins/.test(x.text)).length === 3); assert.ok(!has(bob.c, x => x.t === 'err'), 'bob was not affected');
  });
  it('lists users with activity and storage, and shows server statistics', async () => {
    await upload(s, ann.token, Buffer.from('12345'), 'a.txt'); await sleep(200);
    boss.c.send({ t: 'adminusers' }); const u = (await boss.c.wait(x => x.t === 'adminusers')).users;
    assert.deepEqual(u.map(x => x.n), ['ann', 'bob', 'boss', 'cy']); const a = u.find(x => x.n === 'ann'); assert.equal(a.online, true); assert.equal(a.files, 1); assert.equal(a.bytes, 5); assert.equal(u.find(x => x.n === 'boss').admin, true);
    boss.c.send({ t: 'adminstats' }); const st = await boss.c.wait(x => x.t === 'adminstats'); assert.equal(st.users, 4); assert.equal(st.registration, 'open'); assert.ok(st.dataBytes > 0 && st.uptime >= 0 && st.version);
  });
  it('suspending: the session ends at once, sign-in is refused with the right password only, restoring works', async () => {
    boss.c.send({ t: 'adminban', name: 'cy', on: true }); await boss.c.wait(x => x.t === 'adminresult' && x.action === 'ban');
    const e = await cy.c.wait(x => x.t === 'err' && x.fatal); assert.match(e.text, /suspended/);
    assert.match((await fail(s, 'cy', PW)).text, /suspended/); assert.match((await fail(s, 'cy', 'wrong-password-1')).text, /Invalid username or password/, 'a wrong password reveals nothing');
    boss.c.send({ t: 'adminban', name: 'cy', on: false }); await boss.c.wait(x => x.action === 'unban'); const again = await signin(s, 'cy', PW); assert.equal(again.m.t, 'welcome'); cy = again;
  });
  it('refuses to act on administrators, on yourself or on people who do not exist', async () => {
    boss.c.send({ t: 'adminban', name: 'boss', on: true }); boss.c.send({ t: 'admindelete', name: 'nobody' }); boss.c.send({ t: 'adminreset', name: 'BOSS' });
    await until(() => boss.c.log.filter(x => x.t === 'err').length >= 3); boss.c.send({ t: 'adminusers' }); const lst = (await boss.c.wait(x => x.t === 'adminusers' && boss.c.log.filter(y => y.t === 'adminusers').length >= 2)).users; assert.equal(lst.find(u => u.n === 'boss').banned, false);
  });
  it('closing registration blocks new accounts but not sign-in; administrators can still register', async () => {
    boss.c.send({ t: 'adminreg', open: false }); assert.equal((await boss.c.wait(x => x.t === 'adminstats' && x.registration === 'closed')).registration, 'closed');
    assert.match((await signin(s, 'newbie', PW, { mode: 'register' })).m.text, /closed/); assert.equal((await signin(s, 'ann', PW)).m.t, 'welcome');
    boss.c.send({ t: 'adminreg', open: true }); await boss.c.wait(x => x.t === 'adminstats' && x.registration === 'open'); assert.equal((await signin(s, 'newbie', PW, { mode: 'register' })).m.t, 'welcome');
  });
});

describe('passwords: reset by an administrator, change, delete own account', () => {
  let s, boss, dee; before(async () => { s = await startServer({ ADMIN_USERS: 'boss', ADMIN_CODE, BACKUP_EVERY_HOURS: '0' }); boss = await adminReg(s); dee = await reg(s, 'dee'); dee.c.send({ t: 'setkey', pub: { kty: 'EC', crv: 'P-256', x: 'xx', y: 'yy' }, blob: { s: 'ss', iv: 'ii', ct: 'cc' } }); await sleep(100); });
  after(async () => { boss.c.ws.close(); await s.stop(); });
  let temp;
  it('reset gives a temporary password once, ends the session, drops the old key and flags the account', async () => {
    boss.c.send({ t: 'adminreset', name: 'dee' }); const r = await boss.c.wait(x => x.t === 'adminresult' && x.action === 'reset'); temp = r.temp; assert.match(temp, /^[a-z2-9]{12}$/);
    assert.match((await dee.c.wait(x => x.t === 'err' && x.fatal)).text, /reset by an administrator/);
    assert.match((await fail(s, 'dee', PW)).text, /Invalid username or password/); const w = await signin(s, 'dee', temp); assert.equal(w.m.t, 'welcome'); assert.equal(w.m.mustChange, true); assert.equal(w.m.pub, null); assert.equal(w.m.blob, null); dee = w;
  });
  it('change password: wrong old password, weak new password and bad key blob are refused', async () => {
    dee.c.send({ t: 'setkey', pub: { kty: 'EC', crv: 'P-256', x: 'xx', y: 'yy' }, blob: { s: 'ss', iv: 'ii', ct: 'cc' } }); await sleep(100);
    dee.c.send({ t: 'chpw', old: 'not-the-password', new: 'brand-new-pass-1', blob: { s: 's2', iv: 'i2', ct: 'c2' } }); await dee.c.wait(x => x.t === 'err' && /Wrong password/.test(x.text));
    dee.c.send({ t: 'chpw', old: temp, new: 'short' }); await dee.c.wait(x => x.t === 'err' && /at least 8/.test(x.text));
    dee.c.send({ t: 'chpw', old: temp, new: 'password1' }); await dee.c.wait(x => x.t === 'err' && /too easy/.test(x.text));
    dee.c.send({ t: 'chpw', old: temp, new: 'brand-new-pass-1', blob: { s: 1 } }); await dee.c.wait(x => x.t === 'err' && /Invalid key/.test(x.text));
  });
  it('change password works, replaces the key blob, clears the flag and the old password stops working', async () => {
    dee.c.send({ t: 'chpw', old: temp, new: 'brand-new-pass-1', blob: { s: 's2', iv: 'i2', ct: 'c2' } }); await dee.c.wait(x => x.t === 'pwchanged'); dee.c.ws.close(); await sleep(200);
    assert.match((await fail(s, 'dee', temp)).text, /Invalid username or password/); const w = await signin(s, 'dee', 'brand-new-pass-1'); assert.equal(w.m.mustChange, false); assert.deepEqual(w.m.blob, { s: 's2', iv: 'i2', ct: 'c2' }); dee = w;
  });
  it('delete own account needs the password; administrators cannot delete theirs', async () => {
    dee.c.send({ t: 'delaccount', password: 'wrong-password-1' }); await dee.c.wait(x => x.t === 'err' && /Wrong password/.test(x.text));
    boss.c.send({ t: 'delaccount', password: PW }); await boss.c.wait(x => x.t === 'err' && /Administrators cannot/.test(x.text));
    dee.c.send({ t: 'delaccount', password: 'brand-new-pass-1' }); assert.match((await dee.c.wait(x => x.t === 'err' && x.fatal)).text, /was deleted/); await sleep(150);
    assert.match((await fail(s, 'dee', 'brand-new-pass-1')).text, /Invalid username or password/);
  });
});

describe('deleting an account removes what only it owned', () => {
  it('files, direct messages, posts, likes, groups, follows and alerts; the name starts clean when registered again', async () => {
    const s = await startServer({ ADMIN_USERS: 'boss', ADMIN_CODE, BACKUP_EVERY_HOURS: '0' }); const boss = await adminReg(s), ed = await reg(s, 'ed'), flo = await reg(s, 'flo');
    try {
      await upload(s, ed.token, Buffer.from('mine'), 'mine.txt'); await sleep(150);
      ed.c.send({ t: 'dm', to: 'flo', enc: { iv: 'a', ct: 'b' } }); await flo.c.wait(x => x.t === 'dm');
      ed.c.send({ t: 'post', text: 'ed post' }); const post = (await flo.c.wait(x => x.t === 'post')).p; flo.c.send({ t: 'like', id: post.id }); await ed.c.wait(x => x.t === 'plike');
      ed.c.send({ t: 'gcreate', name: 'Ed club', pub: true }); const g = (await ed.c.wait(x => x.t === 'group')).g; flo.c.send({ t: 'gjoin', id: g.id }); await flo.c.wait(x => x.t === 'group');
      flo.c.send({ t: 'follow', name: 'ed', on: true }); await flo.c.wait(x => x.t === 'prefs' && x.following); await ed.c.wait(x => x.t === 'notif' && x.n.type === 'like');
      boss.c.send({ t: 'admindelete', name: 'ed' }); await boss.c.wait(x => x.t === 'adminresult' && x.action === 'delete');
      await flo.c.wait(x => x.t === 'userdeleted' && x.name === 'ed'); await flo.c.wait(x => x.t === 'pdel' && x.id === post.id); await flo.c.wait(x => x.t === 'gleave' && x.id === g.id); await flo.c.wait(x => x.t === 'files' && x.files.length === 0);
      await sleep(200); const w = await signin(s, 'flo', PW); assert.deepEqual(w.m.prefs.following, [], 'follow of the deleted user is gone'); assert.deepEqual(Object.values(w.m.dms).flat(), [], 'no direct messages with a deleted user'); assert.equal(w.m.groups.length, 0); w.c.ws.close();
      assert.deepEqual(fs.readdirSync(path.join(s.dir, 'uploads')), [], 'uploaded file removed from disk');
      const ed2 = await reg(s, 'ed'); assert.equal(ed2.m.t, 'welcome'); assert.deepEqual(ed2.m.prefs.following, []); assert.equal(ed2.m.files.length, 0); ed2.c.ws.close();
    } finally { [boss, ed, flo].forEach(x => x.c.ws.close()); await s.stop(); }
  });
});

describe('backups', () => {
  it('manual backup contains valid data files; old ones are pruned; only administrators can download', async () => {
    const s = await startServer({ ADMIN_USERS: 'boss', ADMIN_CODE, BACKUP_EVERY_HOURS: '0', BACKUP_KEEP: '2' }); const boss = await adminReg(s), ann = await reg(s, 'ann');
    try {
      ann.c.send({ t: 'msg', room: 'general', text: 'remember me' }); await sleep(500);
      for (let i = 0; i < 3; i++) { boss.c.send({ t: 'adminbackup' }); await sleep(1150); }
      boss.c.send({ t: 'adminstats' }); const st = await boss.c.wait(x => x.t === 'adminstats' && x.backups.length === 2 && boss.c.log.filter(y => y.t === 'adminstats').length >= 2); assert.equal(st.backups.length, 2, 'BACKUP_KEEP=2');
      const name = st.backups[0].name, d = await get(s, '/f/backup/' + name, boss.token); assert.equal(d.status, 200); assert.equal(d.headers['content-type'], 'application/zip'); assert.match(d.headers['content-disposition'], /attachment/);
      const files = Object.fromEntries(unzip(d.body).map(e => [e.name, e.data])); assert.ok(files['manifest.json'] && files['users.json'] && files['messages.json'] && files['settings.json']);
      assert.ok(JSON.parse(files['users.json']).ann && JSON.stringify(JSON.parse(files['messages.json'])).includes('remember me')); assert.equal(JSON.parse(files['manifest.json']).app, 'CampusNet');
      assert.equal((await get(s, '/f/backup/' + name, ann.token)).status, 403); assert.equal((await get(s, '/f/backup/' + name)).status, 403);
      assert.equal((await get(s, '/f/backup/..%2f..%2fusers.json', boss.token)).status, 404); assert.equal((await get(s, '/f/backup/evil.zip', boss.token)).status, 404);
      assert.equal((await get(s, '/f/backup/now', boss.token)).status, 200);
      boss.c.send({ t: 'adminrmbackup', file: name }); await boss.c.wait(x => x.t === 'adminstats' && !x.backups.some(b => b.name === name));
      assert.ok(fs.statSync(path.join(s.dir, 'backups')).isDirectory()); if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(s.dir, 'backups', fs.readdirSync(path.join(s.dir, 'backups'))[0])).mode & 0o077, 0, 'backups are private to the server user');
    } finally { [boss, ann].forEach(x => x.c.ws.close()); await s.stop(); }
  });
  it('automatic backup runs by itself when none exists', async () => {
    const s = await startServer({ BACKUP_EVERY_HOURS: '24', BACKUP_FIRST_DELAY_MS: '300' });
    try { await until(() => fs.existsSync(path.join(s.dir, 'backups')) && fs.readdirSync(path.join(s.dir, 'backups')).some(n => /^campusnet-backup-\d{8}-\d{6}\.zip$/.test(n)), 5000); } finally { await s.stop(); }
  });
  it('restore script: a backup brings accounts and messages back on a fresh data folder, and refuses damaged or foreign files', async () => {
    const a = await startServer({ ADMIN_USERS: 'boss', ADMIN_CODE, BACKUP_EVERY_HOURS: '0' }); const boss = await adminReg(a), ann = await reg(a, 'ann'); let zipBuf;
    try { ann.c.send({ t: 'msg', room: 'general', text: 'survives the restore' }); ann.c.send({ t: 'post', text: 'a post' }); await sleep(500); const d = await get(a, '/f/backup/now', boss.token); assert.equal(d.status, 200); zipBuf = d.body; } finally { [boss, ann].forEach(x => x.c.ws.close()); await a.stop(); }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-restore-')), zp = path.join(tmp, 'b.zip'), data = path.join(tmp, 'newdata'); fs.writeFileSync(zp, zipBuf);
    const run = (...args) => spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'restore.js'), ...args], { encoding: 'utf8' });
    const dry = run(zp, '--data', data); assert.equal(dry.status, 0); assert.match(dry.stdout, /Nothing was changed/); assert.ok(!fs.existsSync(path.join(data, 'users.json')));
    fs.mkdirSync(data); fs.writeFileSync(path.join(data, 'users.json'), '{"old":1}'); const ok = run(zp, '--data', data, '--yes'); assert.equal(ok.status, 0, ok.stderr); assert.match(ok.stdout, /Restored/);
    assert.ok(fs.readdirSync(data).some(n => n.startsWith('before-restore-')), 'the previous data was kept');
    const damaged = Buffer.from(zipBuf); damaged[60] ^= 0xff; fs.writeFileSync(path.join(tmp, 'bad.zip'), damaged); assert.notEqual(run(path.join(tmp, 'bad.zip'), '--data', data, '--yes').status, 0);
    const { zip } = require('../lib/zip'); fs.writeFileSync(path.join(tmp, 'evil.zip'), zip([{ name: 'manifest.json', data: '{"app":"CampusNet"}' }, { name: '../evil.txt', data: 'x' }])); assert.notEqual(run(path.join(tmp, 'evil.zip'), '--data', data, '--yes').status, 0); assert.ok(!fs.existsSync(path.join(tmp, 'evil.txt')));
    fs.writeFileSync(path.join(tmp, 'foreign.zip'), zip([{ name: 'readme.txt', data: 'hi' }])); assert.notEqual(run(path.join(tmp, 'foreign.zip'), '--data', data, '--yes').status, 0);
    const b = await startServer({}, data); try { const w = await signin(b, 'ann', PW); assert.equal(w.m.t, 'welcome'); assert.ok(JSON.stringify(w.m.hist).includes('survives the restore')); w.c.send({ t: 'feed', scope: 'all' }); assert.equal((await w.c.wait(x => x.t === 'feed')).posts[0].text, 'a post'); w.c.ws.close(); } finally { await b.stop(); }
  });
});
