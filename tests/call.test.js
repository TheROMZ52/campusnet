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
  const ws = new WebSocket('ws://127.0.0.1:' + port, { headers }), log = [], frames = []; ws.on('message', (d, bin) => { if (bin) frames.push(Buffer.from(d)); else log.push(JSON.parse(d)); }); ws.on('error', () => {});
  const wait = async (pred, ms = 4000) => { const t = Date.now(); for (;;) { const m = log.find(pred); if (m) return m; if (Date.now() - t > ms) throw new Error('timeout waiting for message; got ' + JSON.stringify(log.map(x => x.t))); await sleep(15); } };
  return { ws, log, frames, wait, send: o => ws.send(JSON.stringify(o)), ready: new Promise((r, j) => { ws.on('open', r); ws.on('error', j); }), closed: new Promise(r => ws.on('close', r)) };
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
const has = (c, pred) => c.log.some(pred), NONCE = 'AQIDBA==';
const frame = (fill, n = 100) => { const b = Buffer.alloc(5 + n, fill); b[0] = 1; return b; };
const until = async (fn, ms = 3000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('condition not met'); await sleep(15); } };

describe('voice calls: signaling and encrypted-frame relay', () => {
  let s, a, b, c; before(async () => { s = await startServer(); a = await reg(s, 'alice'); b = await reg(s, 'bob'); c = await reg(s, 'carol'); });
  after(async () => { [a, b, c].forEach(x => x.c.ws.close()); await s.stop(); });
  let id;
  it('ring, accept, then audio frames flow both ways and nowhere else', async () => {
    a.c.send({ t: 'call', to: 'bob', nonce: NONCE });
    const inc = await b.c.wait(x => x.t === 'incoming'); id = inc.id; assert.equal(inc.from, 'alice'); assert.equal(inc.nonce, NONCE);
    assert.equal((await a.c.wait(x => x.t === 'callstate' && x.state === 'ringing')).peer, 'bob');
    a.c.ws.send(frame(7), { binary: true }); await sleep(150); assert.equal(b.c.frames.length, 0, 'no audio before the call is accepted');
    b.c.send({ t: 'callans', id, accept: true });
    await a.c.wait(x => x.t === 'callstate' && x.state === 'accepted'); await b.c.wait(x => x.t === 'callstate' && x.state === 'accepted');
    a.c.ws.send(frame(1), { binary: true }); b.c.ws.send(frame(2, 300), { binary: true }); c.c.ws.send(frame(9), { binary: true });
    await until(() => b.c.frames.length === 1 && a.c.frames.length === 1);
    assert.deepEqual(b.c.frames[0], frame(1)); assert.deepEqual(a.c.frames[0], frame(2, 300)); await sleep(150); assert.equal(c.c.frames.length, 0, 'a third person never receives audio');
  });
  it('drops oversize, malformed and too frequent frames', async () => {
    const before = b.c.frames.length;
    a.c.ws.send(frame(3, 3000), { binary: true }); a.c.ws.send(Buffer.from([2, 0, 0, 0, 0, 0, 0]), { binary: true }); a.c.ws.send(Buffer.from([1, 0]), { binary: true });
    await sleep(200); assert.equal(b.c.frames.length, before);
    for (let i = 0; i < 200; i++) a.c.ws.send(frame(4, 20), { binary: true }); await sleep(400);
    const got = b.c.frames.length - before; assert.ok(got > 0 && got <= 80, 'at most 80 frames a second, got ' + got);
  });
  it('someone calling a person who is in a call hears busy; the third person cannot end it', async () => {
    c.c.send({ t: 'call', to: 'bob', nonce: NONCE }); assert.equal((await c.c.wait(x => x.t === 'callstate' && x.state === 'busy')).peer, 'bob');
    c.c.send({ t: 'callend', id }); c.c.send({ t: 'callans', id, accept: false }); await sleep(200); assert.ok(!has(a.c, x => x.t === 'callstate' && x.state === 'ended'));
  });
  it('ending the call stops the relay and tells both sides', async () => {
    b.c.send({ t: 'callend', id });
    await a.c.wait(x => x.t === 'callstate' && x.state === 'ended' && x.reason === 'ended'); await b.c.wait(x => x.t === 'callstate' && x.state === 'ended');
    const n = b.c.frames.length; a.c.ws.send(frame(5), { binary: true }); await sleep(200); assert.equal(b.c.frames.length, n);
  });
  it('rejects calls to yourself, strangers, blocked people and bad nonces; offline people show as offline; decline works', async () => {
    a.c.send({ t: 'call', to: 'alice', nonce: NONCE }); a.c.send({ t: 'call', to: 'nobody', nonce: NONCE }); a.c.send({ t: 'call', to: 'bob', nonce: '<script>' });
    await until(() => a.c.log.filter(x => x.t === 'err' && /could not be started/.test(x.text)).length === 3);
    b.c.send({ t: 'block', name: 'alice', on: true }); await b.c.wait(x => x.t === 'prefs' && x.blocked);
    a.c.send({ t: 'call', to: 'bob', nonce: NONCE }); await until(() => a.c.log.filter(x => x.t === 'err' && /could not be started/.test(x.text)).length === 4);
    b.c.send({ t: 'block', name: 'alice', on: false }); await sleep(100);
    const d = await reg(s, 'dora'); const dws = d.c.ws; dws.close(); await sleep(300);
    a.c.send({ t: 'call', to: 'dora', nonce: NONCE }); assert.equal((await a.c.wait(x => x.t === 'callstate' && x.state === 'offline')).peer, 'dora');
    c.c.send({ t: 'call', to: 'alice', nonce: NONCE }); const inc = await a.c.wait(x => x.t === 'incoming' && x.from === 'carol'); a.c.send({ t: 'callans', id: inc.id, accept: false });
    assert.equal((await c.c.wait(x => x.t === 'callstate' && x.state === 'ended' && x.reason === 'declined')).peer, 'alice');
  });
  it('a dropped connection ends the call for the other person', async () => {
    c.c.send({ t: 'call', to: 'alice', nonce: NONCE }); await until(() => a.c.log.filter(y => y.t === 'incoming').length >= 2); const inc = a.c.log.filter(y => y.t === 'incoming').pop();
    a.c.send({ t: 'callans', id: inc.id, accept: true }); await c.c.wait(x => x.t === 'callstate' && x.state === 'accepted' && x.id === inc.id);
    a.c.ws.terminate(); const e = await c.c.wait(x => x.t === 'callstate' && x.state === 'ended' && x.id === inc.id); assert.equal(e.reason, 'disconnect');
  });
});

describe('voice calls: no answer', () => {
  it('rings out, tells both sides and leaves a missed-call alert; cancelling also leaves one', async () => {
    const s = await startServer({ CALL_RING_MS: '300' }); const a = await reg(s, 'alice'), b = await reg(s, 'bob');
    a.c.send({ t: 'call', to: 'bob', nonce: NONCE }); await b.c.wait(x => x.t === 'incoming');
    assert.equal((await a.c.wait(x => x.t === 'callstate' && x.reason === 'noanswer')).state, 'ended'); await b.c.wait(x => x.t === 'callstate' && x.reason === 'noanswer');
    const n = await b.c.wait(x => x.t === 'notif' && x.n.type === 'missed'); assert.equal(n.n.from, 'alice');
    await s.stop(); a.c.ws.close(); b.c.ws.close();
    const s2 = await startServer(); const a2 = await reg(s2, 'alice'), b2 = await reg(s2, 'bob');
    a2.c.send({ t: 'call', to: 'bob', nonce: NONCE }); const inc = await b2.c.wait(x => x.t === 'incoming'); a2.c.send({ t: 'callend', id: inc.id });
    await b2.c.wait(x => x.t === 'callstate' && x.reason === 'cancelled'); await b2.c.wait(x => x.t === 'notif' && x.n.type === 'missed');
    a2.c.ws.close(); b2.c.ws.close(); await s2.stop();
  });
});

describe('voice calls: connections that go away or get replaced', () => {
  let s; before(async () => { s = await startServer(); }); after(async () => { await s.stop(); });
  it('caller drops while ringing: the callee is told and neither person is stuck "busy"', async () => {
    const a = await reg(s, 'amy'), b = await reg(s, 'ben');
    a.c.send({ t: 'call', to: 'ben', nonce: NONCE }); await b.c.wait(x => x.t === 'incoming'); a.c.ws.terminate();
    await b.c.wait(x => x.t === 'callstate' && x.state === 'ended' && x.reason === 'disconnect'); await sleep(100);
    const a2 = await signin(s, 'amy', PW); b.c.send({ t: 'call', to: 'amy', nonce: NONCE }); await a2.c.wait(x => x.t === 'incoming');   // ben can call again: nobody is stuck
    a2.c.send({ t: 'callans', id: (await a2.c.wait(x => x.t === 'incoming')).id, accept: false }); await b.c.wait(x => x.reason === 'declined'); a2.c.ws.close(); b.c.ws.close();
  });
  it('callee drops while ringing: the caller is told', async () => {
    const a = await reg(s, 'cat'), b = await reg(s, 'dan');
    a.c.send({ t: 'call', to: 'dan', nonce: NONCE }); await b.c.wait(x => x.t === 'incoming'); b.c.ws.terminate();
    await a.c.wait(x => x.t === 'callstate' && x.state === 'ended' && x.reason === 'disconnect'); a.c.ws.close();
  });
  it('signing in again with the same name during a call ends the old call for the other person', async () => {
    const a = await reg(s, 'eve'), b = await reg(s, 'fay');
    a.c.send({ t: 'call', to: 'fay', nonce: NONCE }); const inc = await b.c.wait(x => x.t === 'incoming'); b.c.send({ t: 'callans', id: inc.id, accept: true }); await a.c.wait(x => x.state === 'accepted');
    const a2 = await signin(s, 'eve', PW);
    await b.c.wait(x => x.t === 'callstate' && x.state === 'ended' && x.reason === 'disconnect'); a.c.ws.close(); a2.c.ws.close(); b.c.ws.close();
  });
  it('resuming the session with its token (a page reload racing the old socket) ends the call too', async () => {
    const a = await reg(s, 'gus'), b = await reg(s, 'hal');
    a.c.send({ t: 'call', to: 'hal', nonce: NONCE }); const inc = await b.c.wait(x => x.t === 'incoming'); b.c.send({ t: 'callans', id: inc.id, accept: true }); await a.c.wait(x => x.state === 'accepted');
    const c2 = client(s.port); await c2.ready; c2.send({ t: 'join', name: 'gus', token: a.token }); await c2.wait(x => x.t === 'welcome');
    await b.c.wait(x => x.t === 'callstate' && x.state === 'ended' && x.reason === 'disconnect'); a.c.ws.close(); c2.ws.close(); b.c.ws.close();
  });
});
