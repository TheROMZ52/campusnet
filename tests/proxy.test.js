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
const PW = 'correct-horse-9';
const join = async (s, i, xff) => { const c = client(s.port, { 'x-forwarded-for': xff(i) }); await c.ready; c.send({ t: 'join', name: 'user' + i, password: PW, mode: 'register' }); const m = await c.wait(x => x.t === 'welcome' || (x.t === 'err' && x.fatal)); c.ws.close(); return m; };

describe('client address behind a reverse proxy (TRUST_PROXY)', () => {
  it('one proxy: forged leading entries are ignored, so the per-address account limit still holds', async () => {
    const s = await startServer({ TRUST_PROXY: '1' }); const res = [];
    for (let i = 0; i < 12; i++) res.push((await join(s, i, k => `1.1.1.${k}, 9.9.9.9`)).t);   // a different forged first entry each time, the same real address
    assert.equal(res.filter(t => t === 'welcome').length, 10); assert.equal(res.filter(t => t === 'err').length, 2);
    assert.match((await join(s, 99, k => `1.1.1.${k}, 9.9.9.9`)).text, /Too many accounts/);
    assert.equal((await join(s, 100, () => '2.2.2.2')).t, 'welcome', 'a different real address is not limited');
    await s.stop();
  });
  it('two proxies: the entry two places from the end is the client', async () => {
    const s = await startServer({ TRUST_PROXY: '2' }); const res = [];
    for (let i = 0; i < 12; i++) res.push((await join(s, i, k => `${k}.0.0.1, 5.5.5.5, 9.9.9.9`)).t);   // the second entry from the end is constant
    assert.equal(res.filter(t => t === 'welcome').length, 10);
    assert.equal((await join(s, 50, k => `7.7.7.7, 6.6.6.${k}, 9.9.9.9`)).t, 'welcome', 'a different client address is not limited');
    await s.stop();
  });
  it('without TRUST_PROXY the header is ignored completely', async () => {
    const s = await startServer(); const res = [];
    for (let i = 0; i < 12; i++) res.push((await join(s, i, k => `8.8.8.${k}`)).t);   // forged headers cannot help: all connections come from 127.0.0.1
    assert.equal(res.filter(t => t === 'welcome').length, 10); await s.stop();
  });
});

describe('hostile message values', () => {
  it('objects without toString never throw inside handlers (no ERROR lines in the log)', async () => {
    const s = await startServer(); let log = ''; s.child.stdout.on('data', d => { log += d; }); s.child.stderr.on('data', d => { log += d; }); const a = await signin(s, 'alice', PW, { mode: 'register' });
    try {
      const evil = [{ toString: 1 }, JSON.parse('{"__proto__":{"x":1}}'), [[]], { valueOf: 1, toString: 1 }];
      for (const v of evil) for (const t of ['gkick', 'gleave', 'gsearch', 'profile', 'post', 'grole', 'gjoin', 'gedit', 'gdelete', 'admin', 'ping', 'dm', 'search']) { a.c.send({ t, id: v, name: v, text: v, q: v, display: v, code: v, to: v }); await sleep(t === 'ping' ? 42 : 2); }
      await sleep(300); assert.ok(!/ERROR/.test(log), 'no errors logged by the server: ' + log.split('\n').filter(l => /ERROR/.test(l)).slice(0, 3).join(' | '));
      assert.equal((await (await fetch(s.base + '/healthz')).json()).ok, true);
    } finally { a.c.ws.close(); await s.stop(); }
  });
});
