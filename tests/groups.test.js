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
const PW = 'correct-horse-9', reg = (s, name) => signin(s, name, PW, { mode: 'register' });
const has = (c, pred) => c.log.some(pred);

describe('groups and communities', () => {
  let s, o, m, x, out; let gid;
  before(async () => { s = await startServer(); o = await reg(s, 'olga'); m = await reg(s, 'mike'); x = await reg(s, 'nina'); out = await reg(s, 'outsider'); });
  after(async () => { [o, m, x, out].forEach(c => c.c.ws.close()); await s.stop(); });
  it('create: owner gets the group; public group shows up in search and can be joined', async () => {
    o.c.send({ t: 'gcreate', name: 'Chess club', desc: 'weekly games', pub: true });
    const g = (await o.c.wait(z => z.t === 'group')).g; gid = g.id; assert.equal(g.members.length, 1); assert.deepEqual(g.members[0], { n: 'olga', r: 'owner' });
    m.c.send({ t: 'gsearch', q: 'chess' }); const r = await m.c.wait(z => z.t === 'gresults' && z.q === 'chess'); assert.equal(r.groups[0].id, gid); assert.equal(r.groups[0].member, false);
    m.c.send({ t: 'gjoin', id: gid }); const j = (await m.c.wait(z => z.t === 'group')).g; assert.equal(j.members.length, 2);
    await o.c.wait(z => z.t === 'msg' && z.m.room === 'g:' + gid && /mike joined/.test(z.m.text));
  });
  it('messages reach members only; non-members cannot post, read, edit or react', async () => {
    out.c.send({ t: 'msg', room: 'g:' + gid, text: 'intruder' });
    m.c.send({ t: 'msg', room: 'g:' + gid, text: 'hello group' });
    const msg = (await o.c.wait(z => z.t === 'msg' && z.m.text === 'hello group')).m;
    out.c.send({ t: 'react', room: 'g:' + gid, id: msg.id, emoji: '👍' }); out.c.send({ t: 'edit', room: 'g:' + gid, id: msg.id, text: 'x' }); out.c.send({ t: 'delmsg', room: 'g:' + gid, id: msg.id });
    out.c.send({ t: 'read', k: 'r:g:' + gid, ts: Date.now() }); out.c.send({ t: 'mute', k: 'r:g:' + gid, on: true });
    await sleep(500);
    assert.ok(!has(out.c, z => (z.t === 'msg' || z.t === 'upd' || z.t === 'group') && JSON.stringify(z).includes('hello group')));
    assert.ok(!has(o.c, z => z.t === 'msg' && z.m.text === 'intruder'));
    const w = await signin(s, 'outsider', PW); assert.equal(w.m.groups.length, 0); assert.ok(!JSON.stringify(w.m.hist).includes('hello group')); w.c.ws.close();
    m.c.send({ t: 'react', room: 'g:' + gid, id: msg.id, emoji: '🎉' }); const u = await o.c.wait(z => z.t === 'upd' && z.m.reactions);
    assert.deepEqual(u.m.reactions, { '🎉': ['mike'] });
  });
  it('roles: owner promotes a mod; mod can pin and delete but members cannot; mod cannot touch the owner or other mods', async () => {
    m.c.send({ t: 'gkick', id: gid, name: 'olga' }); m.c.send({ t: 'grole', id: gid, name: 'mike', role: 'mod' });
    o.c.send({ t: 'ginvite', id: gid, name: 'nina' }); const inv = (await x.c.wait(z => z.t === 'group')).g; assert.equal(inv.members.length, 3);
    await x.c.wait(z => z.t === 'notif' && z.n.type === 'invite');
    const first = (await o.c.wait(z => z.t === 'msg' && z.m.text === 'hello group')).m;
    x.c.send({ t: 'pin', room: 'g:' + gid, id: first.id, on: true }); await x.c.wait(z => z.t === 'err' && /can pin/.test(z.text));
    o.c.send({ t: 'grole', id: gid, name: 'mike', role: 'mod' }); const g = (await m.c.wait(z => z.t === 'group' && z.g.members.some(q => q.n === 'mike' && q.r === 'mod'))).g;
    m.c.send({ t: 'pin', room: 'g:' + gid, id: first.id, on: true }); await x.c.wait(z => z.t === 'upd' && z.m.pinned === true);
    m.c.send({ t: 'gkick', id: gid, name: 'olga' }); await sleep(300); assert.ok(!has(o.c, z => z.t === 'gleave'), 'the owner cannot be kicked');
    x.c.send({ t: 'msg', room: 'g:' + gid, text: 'to be deleted' }); const del = (await m.c.wait(z => z.t === 'msg' && z.m.text === 'to be deleted')).m;
    m.c.send({ t: 'delmsg', room: 'g:' + gid, id: del.id }); await x.c.wait(z => z.t === 'delmsg' && z.id === del.id);
    x.c.send({ t: 'gkick', id: gid, name: 'mike' }); x.c.send({ t: 'grole', id: gid, name: 'nina', role: 'mod' }); await sleep(300);
    assert.ok(!has(m.c, z => z.t === 'gleave'), 'a plain member cannot kick'); assert.equal(g.members.find(q => q.n === 'nina').r, 'member');
  });
  it('kick, leave, invite-only and delete', async () => {
    m.c.send({ t: 'gkick', id: gid, name: 'nina' }); await x.c.wait(z => z.t === 'gleave' && z.id === gid);
    x.c.send({ t: 'msg', room: 'g:' + gid, text: 'after kick' }); await sleep(300); assert.ok(!has(o.c, z => z.t === 'msg' && z.m.text === 'after kick'));
    o.c.send({ t: 'gedit', id: gid, name: 'Chess club', desc: 'private now', pub: false }); await m.c.wait(z => z.t === 'group' && z.g.pub === false);
    x.c.send({ t: 'gjoin', id: gid }); await x.c.wait(z => z.t === 'err' && /invite-only/.test(z.text));
    x.c.send({ t: 'gsearch', q: 'chess' }); assert.equal((await x.c.wait(z => z.t === 'gresults' && z.q === 'chess' && z.groups.length === 0)).groups.length, 0);
    await sleep(5200); m.c.send({ t: 'gleave', id: gid }); await m.c.wait(z => z.t === 'gleave'); o.c.send({ t: 'gleave', id: gid }); await sleep(300); assert.ok(!has(o.c, z => z.t === 'gleave'), 'owner cannot leave');
    o.c.send({ t: 'gdelete', id: gid }); await o.c.wait(z => z.t === 'gleave'); const w = await signin(s, 'olga', PW); assert.equal(w.m.groups.length, 0); w.c.ws.close();
  });
  it('group limits and persistence across restart', async () => {
    let s2 = await startServer(); const a = await reg(s2, 'amir'), b = await reg(s2, 'bita');
    a.c.send({ t: 'gcreate', name: 'Persist', pub: true }); const gg = (await a.c.wait(z => z.t === 'group')).g; a.c.send({ t: 'msg', room: 'g:' + gg.id, text: 'saved text' }); await a.c.wait(z => z.t === 'msg' && z.m.text === 'saved text');
    b.c.send({ t: 'gjoin', id: gg.id }); await b.c.wait(z => z.t === 'group'); await sleep(500);
    const dir = s2.dir; a.c.ws.close(); b.c.ws.close(); await s2.stop('SIGTERM'); s2 = await startServer({}, dir);
    const b2 = await signin(s2, 'bita', PW); assert.equal(b2.m.groups[0].name, 'Persist'); assert.ok(b2.m.groups[0].hist.some(z => z.text === 'saved text')); assert.equal(b2.m.groups[0].members.length, 2); b2.c.ws.close(); await s2.stop();
  });
});
