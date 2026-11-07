'use strict';
/* HTTP and HTTPS together: PORT serves plain HTTP, HTTPS_PORT serves HTTPS, one shared server behind both. */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http'), https = require('node:https');
const WebSocket = require('../vendor/ws');
const ROOT = path.join(__dirname, '..'), HAS_OPENSSL = spawnSync('openssl', ['version']).status === 0, PW = 'correct-horse-9';

function start(env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campusnet-dual-'));
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env: { PATH: process.env.PATH, DATA_DIR: dir, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  return new Promise((resolve, reject) => {
    child.stdout.on('data', d => { out += d; const m = out.match(/listening port=(\d+)/); if (m) resolve({ port: +m[1], securePort: +((out.match(/secure port=(\d+)/) || [])[1] || 0), out: () => out, stop: () => child.kill() }); });
    child.stderr.on('data', d => { out += d; }); child.once('exit', c => reject(new Error('exit ' + c + ': ' + out.slice(0, 300)))); setTimeout(() => reject(new Error('timeout ' + out.slice(0, 300))), 10000);
  });
}
const request = (mod, port, p, method = 'GET', headers = {}) => new Promise((res, rej) => { const r = mod.request({ host: '127.0.0.1', port, path: p, method, headers, rejectUnauthorized: false }, x => { let b = ''; x.on('data', d => { b += d; }); x.on('end', () => res({ status: x.statusCode, headers: x.headers, body: b })); }); r.on('error', rej); r.end(); });
const open = (url, name) => new Promise((res, rej) => {
  const ws = new WebSocket(url, { rejectUnauthorized: false }), got = [];
  ws.on('message', d => { const m = JSON.parse(d); got.push(m); if (m.t === 'welcome') res({ ws, got, welcome: m }); else if (m.t === 'err') rej(new Error(m.text)); });
  ws.on('open', () => ws.send(JSON.stringify({ t: 'join', name, password: PW, mode: 'register' }))); ws.on('error', rej);
});
const until = async (f, ms = 5000) => { const t = Date.now(); while (Date.now() - t < ms) { if (f()) return true; await new Promise(r => setTimeout(r, 25)); } return false; };

describe('HTTP and HTTPS together', { skip: !HAS_OPENSSL && 'openssl is not installed' }, () => {
  let s; before(async () => { s = await start({ PORT: '0', HTTPS_PORT: '0' }); }); after(() => s?.stop());

  it('answers on both ports and prints both addresses', async () => {
    assert.ok(s.securePort > 0 && s.securePort !== s.port);
    assert.equal(JSON.parse((await request(http, s.port, '/healthz')).body).ok, true);
    assert.equal(JSON.parse((await request(https, s.securePort, '/healthz')).body).ok, true);
    assert.match(s.out(), new RegExp(`http://localhost:${s.port}`)); assert.match(s.out(), new RegExp(`https://localhost:${s.securePort}`));
  });
  it('plain HTTP is not upgraded and HTTPS is not served on the HTTP port', async () => {
    await assert.rejects(request(https, s.port, '/healthz')); await assert.rejects(request(http, s.securePort, '/healthz'));
  });
  it('both ports are one server: a user on ws:// and a user on wss:// see each other and chat', async () => {
    const a = await open(`ws://127.0.0.1:${s.port}`, 'anna'), b = await open(`wss://127.0.0.1:${s.securePort}`, 'ben');
    assert.ok(JSON.stringify(b.welcome.users).includes('anna'), 'ben sees anna');
    b.ws.send(JSON.stringify({ t: 'msg', room: 'general', text: 'hello across schemes' }));
    assert.ok(await until(() => a.got.some(m => JSON.stringify(m).includes('hello across schemes'))), 'anna receives ben\'s message');
    a.ws.close(); b.ws.close();
  });
  it('the download cookie is Secure only over HTTPS', async () => {
    const a = await open(`ws://127.0.0.1:${s.port}`, 'cora'), tok = a.welcome.token;
    const viaHttp = await request(http, s.port, '/api/session', 'POST', { 'x-token': tok }), viaHttps = await request(https, s.securePort, '/api/session', 'POST', { 'x-token': tok });
    assert.ok(!/;\s*Secure/i.test(viaHttp.headers['set-cookie'][0]), 'no Secure over http'); assert.match(viaHttps.headers['set-cookie'][0], /;\s*Secure/i); a.ws.close();
  });
  it('a wrong Origin is still refused on the HTTPS port', async () => {
    await assert.rejects(new Promise((res, rej) => { const ws = new WebSocket(`wss://127.0.0.1:${s.securePort}`, { rejectUnauthorized: false, headers: { Origin: 'https://evil.example' } }); ws.on('open', () => res()); ws.on('error', rej); }));
  });
});

describe('port settings', () => {
  it('PORT and HTTPS_PORT must differ', async () => {
    await assert.rejects(start({ PORT: '45871', HTTPS_PORT: '45871' }), /PORT and HTTPS_PORT must be different/);
  });
  it('without HTTPS_PORT nothing changes: plain HTTP only, one port', async () => {
    const x = await start({ PORT: '0' }); assert.equal(x.securePort, 0); assert.equal(JSON.parse((await request(http, x.port, '/healthz')).body).ok, true); x.stop();
  });
  it('HTTPS=1 alone still means HTTPS only, on PORT', { skip: !HAS_OPENSSL && 'openssl is not installed' }, async () => {
    const x = await start({ PORT: '0', HTTPS: '1' }); assert.equal(x.securePort, 0); assert.equal(JSON.parse((await request(https, x.port, '/healthz')).body).ok, true); x.stop();
  });
});
