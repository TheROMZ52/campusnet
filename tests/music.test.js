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
const PW = 'correct-horse-9', reg = (s, name) => signin(s, name, PW, { mode: 'register' });
const get = (s, p, token, headers = {}) => req(s, 'GET', p, { headers: { ...(token ? { cookie: 'cn_s=' + token } : {}), ...headers } });

describe('music: audio files stream with byte ranges, profile song', () => {
  let s, a, b, song, doc; const bytes = Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 251));
  before(async () => {
    s = await startServer(); a = await reg(s, 'alice'); b = await reg(s, 'bob');
    await req(s, 'POST', '/api/session', { headers: { 'x-token': a.token } });
    assert.equal((await upload(s, a.token, bytes, 'Daft Punk - Around.mp3')).status, 200);
    assert.equal((await upload(s, a.token, Buffer.from('hello'), 'notes.txt')).status, 200);
    const fl = await a.c.wait(x => x.t === 'files' && x.files.length >= 2); song = fl.files.find(f => f.name.endsWith('.mp3')); doc = fl.files.find(f => f.name === 'notes.txt');
  });
  after(async () => { a.c.ws.close(); b.c.ws.close(); await s.stop(); });
  it('marks audio files in the library', () => { assert.equal(song.aud, true); assert.equal(doc.aud, false); });
  it('requires sign-in, serves audio inline with the right type and Accept-Ranges', async () => {
    assert.equal((await get(s, `/f/${song.id}?audio=1`)).status, 401);
    const r = await get(s, `/f/${song.id}?audio=1`, a.token);
    assert.equal(r.status, 200); assert.equal(r.headers['content-type'], 'audio/mpeg'); assert.equal(r.headers['accept-ranges'], 'bytes'); assert.match(r.headers['content-disposition'], /^inline/); assert.deepEqual(r.body, bytes);
  });
  it('supports byte ranges (206), suffix ranges and rejects impossible ones (416)', async () => {
    const r = await get(s, `/f/${song.id}?audio=1`, a.token, { range: 'bytes=10-19' });
    assert.equal(r.status, 206); assert.equal(r.headers['content-range'], 'bytes 10-19/5000'); assert.deepEqual(r.body, bytes.subarray(10, 20));
    const tail = await get(s, `/f/${song.id}?audio=1`, a.token, { range: 'bytes=-100' }); assert.equal(tail.status, 206); assert.deepEqual(tail.body, bytes.subarray(4900));
    const open = await get(s, `/f/${song.id}?audio=1`, a.token, { range: 'bytes=4990-' }); assert.equal(open.status, 206); assert.equal(open.body.length, 10);
    assert.equal((await get(s, `/f/${song.id}?audio=1`, a.token, { range: 'bytes=9000-9100' })).status, 416);
  });
  it('non-audio files never get the audio treatment, plain downloads stay attachments', async () => {
    const d = await get(s, `/f/${doc.id}?audio=1`, a.token); assert.equal(d.headers['content-type'], 'application/octet-stream'); assert.match(d.headers['content-disposition'], /^attachment/);
    const p = await get(s, `/f/${song.id}`, a.token); assert.equal(p.headers['content-type'], 'application/octet-stream'); assert.match(p.headers['content-disposition'], /^attachment/);
  });
  it('profile song: only existing audio files are accepted, shown to others, cleared when the file is deleted', async () => {
    a.c.send({ t: 'profile', display: 'Al', music: doc.id }); const p0 = await b.c.wait(x => x.t === 'profile' && x.name === 'alice'); assert.equal(p0.p.m, null);
    a.c.send({ t: 'profile', display: 'Al', music: 'f'.repeat(16) }); await sleep(300);
    a.c.send({ t: 'profile', display: 'Al', music: song.id }); const p1 = await b.c.wait(x => x.t === 'profile' && x.name === 'alice' && x.p.m); assert.deepEqual(p1.p.m, { id: song.id, n: 'Daft Punk - Around.mp3' });
    a.c.send({ t: 'profile', display: 'Al renamed' }); const p2 = await b.c.wait(x => x.t === 'profile' && x.p.d === 'Al renamed'); assert.equal(p2.p.m.id, song.id, 'profile edits without music keep the song');
    const w = await signin(s, 'bob', PW); assert.equal(w.m.profiles.alice.m.id, song.id); w.c.ws.close();
    a.c.send({ t: 'delfile', id: song.id }); await sleep(400);
    const w2 = await signin(s, 'bob', PW); assert.ok(!w2.m.profiles.alice || !w2.m.profiles.alice.m, 'deleted song disappears from the profile'); w2.c.ws.close();
  });
});
