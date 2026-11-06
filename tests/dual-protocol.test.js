'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http'), https = require('node:https');
const WebSocket = require('../vendor/ws');
const ROOT = path.join(__dirname, '..'), HAS_OPENSSL = spawnSync('openssl', ['version']).status === 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
function request(port, secure) {
  const mod = secure ? https : http;
  return new Promise((resolve, reject) => mod.get({ host: '127.0.0.1', port, path: '/healthz', ...(secure ? { rejectUnauthorized: false } : {}) }, r => { let b = ''; r.on('data', d => b += d); r.on('end', () => resolve({ status: r.statusCode, headers: r.headers, body: JSON.parse(b) })); }).on('error', reject));
}
function wsConnect(port, secure) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket((secure ? 'wss' : 'ws') + '://127.0.0.1:' + port, secure ? { rejectUnauthorized: false } : {});
    ws.once('open', () => { ws.close(); resolve(true); }); ws.once('error', reject);
  });
}
describe('simultaneous HTTP and HTTPS listeners', () => {
  it('serves both protocols and WebSocket on dynamically assigned ports without redirecting HTTP', { skip: !HAS_OPENSSL && 'openssl is not installed' }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campusnet-dual-'));
    const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env: { ...process.env, PORT: '0', HTTPS_PORT: '0', HTTPS: '1', DATA_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    try {
      const ports = await new Promise((resolve, reject) => {
        const check = () => { const h = out.match(/listening port=(\d+)/), s = out.match(/https listening port=(\d+)/); if (h && s) resolve({ http: +h[1], https: +s[1] }); };
        child.stdout.on('data', d => { out += d; check(); }); child.stderr.on('data', d => { err += d; });
        child.once('exit', c => reject(new Error('server exited ' + c + ': ' + err + out)));
        setTimeout(() => reject(new Error('startup timeout: ' + err + out)), 10000);
      });
      const plain = await request(ports.http, false), encrypted = await request(ports.https, true);
      assert.equal(plain.status, 200); assert.equal(encrypted.status, 200);
      assert.equal(plain.body.ok, true); assert.equal(encrypted.body.ok, true);
      assert.equal(plain.headers.location, undefined, 'HTTP must not redirect');
      assert.equal(plain.headers['strict-transport-security'], undefined, 'HSTS must not be sent over HTTP');
      assert.ok(encrypted.headers['strict-transport-security'], 'HSTS is only sent over HTTPS');
      await wsConnect(ports.http, false); await wsConnect(ports.https, true);
    } finally {
      if (child.exitCode === null) { child.kill('SIGTERM'); await Promise.race([new Promise(r => child.once('exit', r)), sleep(5000)]); }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  it('honors the hosting panel PORT when HTTPS is not enabled', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campusnet-panel-'));
    const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env: { ...process.env, PORT: '0', DATA_DIR: dir, HTTPS: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    try {
      const port = await new Promise((resolve, reject) => {
        child.stdout.on('data', d => { out += d; const m = out.match(/listening port=(\d+)/); if (m) resolve(+m[1]); }); child.stderr.on('data', d => err += d);
        child.once('exit', c => reject(new Error('server exited ' + c + ': ' + err + out)));
        setTimeout(() => reject(new Error('startup timeout: ' + err + out)), 10000);
      });
      assert.equal((await request(port, false)).status, 200);
    } finally {
      if (child.exitCode === null) { child.kill('SIGTERM'); await Promise.race([new Promise(r => child.once('exit', r)), sleep(5000)]); }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
