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
const PW = 'correct-horse-9', ENC = (n = 1) => ({ iv: 'iv' + n, ct: 'ct' + n });
const reg = (s, name, extra) => signin(s, name, PW, { mode: 'register', ...extra });
const has = (c, pred) => c.log.some(pred);

describe('room messaging: reply, edit, reactions, pin, mentions', () => {
  let s, a, b, boss; before(async () => {
    s = await startServer({ ADMIN_USERS: 'boss', ADMIN_CODE: 'adm-secret-1' });
    a = await reg(s, 'alice'); b = await reg(s, 'bob'); boss = await reg(s, 'boss', { adminCode: 'adm-secret-1' });
  }); after(async () => { [a, b, boss].forEach(x => x.c.ws.close()); await s.stop(); });
  let first;
  it('reply carries a server-built snippet and notifies the author; @mention notifies', async () => {
    a.c.send({ t: 'msg', room: 'general', text: 'hello there' });
    first = (await b.c.wait(x => x.t === 'msg' && x.m.text === 'hello there')).m;
    b.c.send({ t: 'msg', room: 'general', text: 'hi back @alice', reply: first.id });
    const r = (await a.c.wait(x => x.t === 'msg' && x.m.text === 'hi back @alice')).m;
    assert.deepEqual(r.reply, { id: first.id, from: 'alice', text: 'hello there' });
    await a.c.wait(x => x.t === 'notif' && x.n.type === 'reply' && x.n.from === 'bob');
    a.c.send({ t: 'msg', room: 'general', text: 'ping @bob' });
    await b.c.wait(x => x.t === 'notif' && x.n.type === 'mention' && x.n.from === 'alice');
    assert.ok(!has(a.c, x => x.t === 'notif' && x.n.type === 'mention'), 'a reply does not double-notify the same person');
  });
  it('only the author can edit; edited flag is set', async () => {
    b.c.send({ t: 'edit', room: 'general', id: first.id, text: 'hacked' });
    a.c.send({ t: 'edit', room: 'general', id: first.id, text: 'hello v2' });
    const u = await b.c.wait(x => x.t === 'upd' && x.m.id === first.id);
    assert.equal(u.m.text, 'hello v2'); assert.ok(u.m.edited);
  });
  it('reactions toggle, only allowlisted emoji, author is notified', async () => {
    b.c.send({ t: 'react', room: 'general', id: first.id, emoji: '💩' });
    b.c.send({ t: 'react', room: 'general', id: first.id, emoji: '👍' });
    const u = await a.c.wait(x => x.t === 'upd' && x.m.id === first.id && x.m.reactions);
    assert.deepEqual(u.m.reactions, { '👍': ['bob'] });
    await a.c.wait(x => x.t === 'notif' && x.n.type === 'react');
    b.c.send({ t: 'react', room: 'general', id: first.id, emoji: '👍' });
    await a.c.wait(x => x.t === 'upd' && x.m.id === first.id && !x.m.reactions);
  });
  it('pin is admin-only', async () => {
    b.c.send({ t: 'pin', room: 'general', id: first.id, on: true });
    await b.c.wait(x => x.t === 'err' && /admins can pin/.test(x.text));
    boss.c.send({ t: 'pin', room: 'general', id: first.id, on: true });
    await a.c.wait(x => x.t === 'upd' && x.m.id === first.id && x.m.pinned === true);
  });
});

describe('direct messages: edit, delete, react are limited to participants', () => {
  let s, a, b, c; before(async () => { s = await startServer(); a = await reg(s, 'alice'); b = await reg(s, 'bob'); c = await reg(s, 'carol'); });
  after(async () => { [a, b, c].forEach(x => x.c.ws.close()); await s.stop(); });
  it('works for participants, ignores outsiders and non-authors', async () => {
    a.c.send({ t: 'dm', to: 'bob', enc: ENC(1) });
    const m = (await b.c.wait(x => x.t === 'dm' && x.m.enc.ct === 'ct1')).m;
    b.c.send({ t: 'edit', to: 'alice', id: m.id, enc: ENC(9) });           // not the author
    c.c.send({ t: 'deldm', to: 'bob', id: m.id }); c.c.send({ t: 'react', to: 'bob', id: m.id, emoji: '👍' });   // outsider
    a.c.send({ t: 'edit', to: 'bob', id: m.id, enc: ENC(2) });
    const u = await b.c.wait(x => x.t === 'dmupd' && x.m.id === m.id);
    assert.equal(u.m.enc.ct, 'ct2'); assert.ok(u.m.edited); assert.ok(!u.m.reactions);
    b.c.send({ t: 'react', to: 'alice', id: m.id, emoji: '❤️' });
    const r = await a.c.wait(x => x.t === 'dmupd' && x.m.reactions);
    assert.deepEqual(r.m.reactions, { '❤️': ['bob'] });
    b.c.send({ t: 'deldm', to: 'alice', id: m.id });                       // not the author
    a.c.send({ t: 'deldm', to: 'bob', id: m.id });
    await b.c.wait(x => x.t === 'dmdel' && x.id === m.id);
    const again = await signin(s, 'bob', PW); assert.equal(Object.values(again.m.dms).flat().length, 0); again.c.ws.close();
  });
});

describe('read receipts, unread state, mute and profiles', () => {
  let s, a, b; before(async () => { s = await startServer(); a = await reg(s, 'alice'); b = await reg(s, 'bob'); });
  after(async () => { [a, b].forEach(x => x.c.ws.close()); await s.stop(); });
  it('receipt reaches the sender; reads persist; peerReads shown on next sign-in', async () => {
    a.c.send({ t: 'dm', to: 'bob', enc: ENC(1) }); const m = (await b.c.wait(x => x.t === 'dm')).m;
    b.c.send({ t: 'read', k: 'd:alice', ts: m.ts });
    const r = await a.c.wait(x => x.t === 'receipt'); assert.equal(r.from, 'bob'); assert.equal(r.ts, m.ts);
    b.c.send({ t: 'read', k: 'd:alice', ts: m.ts - 1000 });   // never goes backwards
    b.c.ws.close(); await sleep(400);
    const b2 = await signin(s, 'bob', PW); assert.equal(b2.m.prefs.reads['d:alice'], m.ts); b2.c.ws.close();
    a.c.ws.close(); await sleep(200); const a2 = await signin(s, 'alice', PW); assert.equal(a2.m.peerReads.bob, m.ts); a = a2; b = await signin(s, 'bob', PW);
  });
  it('opting out of receipts stops them and hides peerReads', async () => {
    b.c.send({ t: 'profile', display: 'Bob B', bio: 'hi', receipts: false }); await b.c.wait(x => x.t === 'prefs' && x.receipts === false);
    a.c.send({ t: 'dm', to: 'bob', enc: ENC(2) }); const m = (await b.c.wait(x => x.t === 'dm' && x.m.enc.ct === 'ct2')).m;
    b.c.send({ t: 'read', k: 'd:alice', ts: m.ts }); await sleep(400);
    assert.ok(!has(a.c, x => x.t === 'receipt' && x.ts === m.ts));
  });
  it('mute persists and rejects unknown conversations', async () => {
    a.c.send({ t: 'mute', k: 'r:general', on: true }); a.c.send({ t: 'mute', k: 'r:nope', on: true }); a.c.send({ t: 'mute', k: 'd:ghost', on: true });
    const p = await a.c.wait(x => x.t === 'prefs' && x.muted); assert.deepEqual(p.muted, ['r:general']);
  });
  it('profile: validates avatar, broadcasts, appears in welcome', async () => {
    a.c.send({ t: 'profile', display: 'Alice A', avatar: 'data:image/svg+xml;base64,PHN2Zz4=' });
    await a.c.wait(x => x.t === 'err' && /Avatar/.test(x.text));
    a.c.send({ t: 'profile', display: 'Alice A', bio: 'x'.repeat(500), avatar: 'data:image/jpeg;base64,/9j/4AAQ' });
    const u = await b.c.wait(x => x.t === 'profile' && x.name === 'alice'); assert.equal(u.p.d, 'Alice A'); assert.equal(u.p.b.length, 200);
    a.c.send({ t: 'profile', display: 'Big', avatar: 'data:image/png;base64,' + 'A'.repeat(9000) });
    await a.c.wait(x => x.t === 'err' && /Avatar/.test(x.text) && a.c.log.filter(y => y.t === 'err').length >= 2);
    const w = await signin(s, 'bob', PW); assert.equal(w.m.profiles.alice.d, 'Alice A'); w.c.ws.close();
  });
});

describe('search, follow, block, notifications, feed', () => {
  let s, a, b, c; before(async () => { s = await startServer(); a = await reg(s, 'alice'); b = await reg(s, 'bobby'); c = await reg(s, 'carol'); });
  after(async () => { [a, b, c].forEach(x => x.c.ws.close()); await s.stop(); });
  it('search finds by name or display name, prefix first', async () => {
    b.c.send({ t: 'profile', display: 'Robert' }); await b.c.wait(x => x.t === 'prefs');
    a.c.send({ t: 'search', q: 'rob' }); const r = await a.c.wait(x => x.t === 'results' && x.q === 'rob');
    assert.deepEqual(r.users.map(u => u.n), ['bobby']);
    a.c.send({ t: 'search', q: 'ca' }); assert.deepEqual((await a.c.wait(x => x.t === 'results' && x.q === 'ca')).users.map(u => u.n), ['carol']);
  });
  it('follow notifies; follower count shows in search', async () => {
    a.c.send({ t: 'follow', name: 'bobby', on: true });
    const n = await b.c.wait(x => x.t === 'notif' && x.n.type === 'follow'); assert.equal(n.n.from, 'alice');
    a.c.send({ t: 'search', q: 'bobby' }); const r = await a.c.wait(x => x.t === 'results' && x.q === 'bobby' && x.users[0]);
    assert.equal(r.users[0].fo, 1); assert.equal(r.users[0].f, true);
  });
  it('block: refuses DMs both ways, removes follows, hides the user', async () => {
    b.c.send({ t: 'block', name: 'alice', on: true });
    const p = await b.c.wait(x => x.t === 'prefs' && x.blocked); assert.deepEqual(p.blocked, ['alice']);
    a.c.send({ t: 'dm', to: 'bobby', enc: ENC(1) }); await a.c.wait(x => x.t === 'err' && /could not be delivered/.test(x.text));
    b.c.send({ t: 'dm', to: 'alice', enc: ENC(1) }); await b.c.wait(x => x.t === 'err' && /could not be delivered/.test(x.text));
    a.c.send({ t: 'search', q: 'bobb' }); const r = await a.c.wait(x => x.t === 'results' && x.q === 'bobb'); assert.equal(r.users.length, 0);
    a.c.send({ t: 'follow', name: 'bobby', on: true }); await a.c.wait(x => x.t === 'err' && /cannot follow/.test(x.text));
  });
  it('feed: pagination with cursor, scopes, likes, delete rules, block filtering', async () => {
    await sleep(5200);   // the per-socket rate limit window (10 messages / 5 s) must be empty
    for (let i = 0; i < 9; i++) a.c.send({ t: 'post', text: 'alice post ' + i });
    for (let i = 0; i < 8; i++) c.c.send({ t: 'post', text: 'carol post ' + i });
    for (let i = 0; i < 9; i++) b.c.send({ t: 'post', text: 'bobby post ' + i });
    await sleep(800);
    c.c.send({ t: 'feed', scope: 'all' }); const p1 = await c.c.wait(x => x.t === 'feed' && x.before === null);
    assert.equal(p1.posts.length, 20); assert.equal(p1.more, true);
    assert.ok(p1.posts.every((p, i, arr) => !i || arr[i - 1].ts > p.ts), 'newest first, strictly ordered');
    c.c.send({ t: 'feed', scope: 'all', before: p1.posts[19].ts }); const p2 = await c.c.wait(x => x.t === 'feed' && x.before === p1.posts[19].ts);
    assert.equal(p2.posts.length, 6); assert.equal(p2.more, false);   // 26 posts in total
    await sleep(5200);   // rate-limit window again
    a.c.send({ t: 'feed', scope: 'all' }); const fa = await a.c.wait(x => x.t === 'feed' && x.before === null);
    assert.ok(!fa.posts.some(p => p.by === 'bobby'), 'blocked user is hidden');
    c.c.send({ t: 'follow', name: 'alice', on: true }); await c.c.wait(x => x.t === 'prefs' && x.following);
    c.c.send({ t: 'feed', scope: 'following' }); const ff = await c.c.wait(x => x.t === 'feed' && x.scope === 'following');
    assert.ok(ff.posts.length === 17 && ff.posts.every(p => p.by === 'alice' || p.by === 'carol'));
    const target = p1.posts.find(p => p.by === 'alice');
    c.c.send({ t: 'like', id: target.id }); const lk = await a.c.wait(x => x.t === 'plike' && x.id === target.id); assert.deepEqual(lk.likes, ['carol']);
    await a.c.wait(x => x.t === 'notif' && x.n.type === 'like');
    c.c.send({ t: 'delpost', id: target.id }); await sleep(300); assert.ok(!has(c.c, x => x.t === 'pdel'));
    a.c.send({ t: 'delpost', id: target.id }); await c.c.wait(x => x.t === 'pdel' && x.id === target.id);
  });
});

describe('persistence across restart', () => {
  it('posts, notifications, reads, follows and profile survive SIGTERM', async () => {
    let s = await startServer(); const a = await reg(s, 'alice'), b = await reg(s, 'bob');
    a.c.send({ t: 'follow', name: 'bob', on: true }); await b.c.wait(x => x.t === 'notif');
    a.c.send({ t: 'post', text: 'persist me' }); await a.c.wait(x => x.t === 'post');
    a.c.send({ t: 'profile', display: 'Alice P' }); await a.c.wait(x => x.t === 'prefs');
    a.c.send({ t: 'read', k: 'r:general', ts: Date.now() }); await sleep(500);
    const dir = s.dir; a.c.ws.close(); b.c.ws.close(); await s.stop('SIGTERM');
    s = await startServer({}, dir); const b2 = await signin(s, 'bob', PW), a2 = await signin(s, 'alice', PW);
    assert.equal(b2.m.notifs[0].type, 'follow'); assert.deepEqual(a2.m.prefs.following, ['bob']); assert.ok(a2.m.prefs.reads['r:general']); assert.equal(a2.m.myProfile.d, 'Alice P');
    a2.c.send({ t: 'feed', scope: 'all' }); assert.equal((await a2.c.wait(x => x.t === 'feed')).posts[0].text, 'persist me');
    a2.c.ws.close(); b2.c.ws.close(); await s.stop();
  });
});
