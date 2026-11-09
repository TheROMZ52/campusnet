'use strict';
/* The Pufferland zip must run with the platform's defaults: start file index.js, only PORT in the environment, behind one proxy. */
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), zlib = require('node:zlib');
const { spawn } = require('node:child_process');
const { build, parseArgs } = require('../scripts/pack');

function unzip(buf, dir) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])), n = buf.readUInt16LE(end + 10); let p = buf.readUInt32LE(end + 16); const names = [];
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl), ln = buf.readUInt16LE(off + 26), le = buf.readUInt16LE(off + 28), start = off + 30 + ln + le;
    const data = method === 8 ? zlib.inflateRawSync(buf.subarray(start, start + csize)) : buf.subarray(start, start + csize);
    const out = path.join(dir, name); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, data); names.push(name); p += 46 + nl + el + cl;
  }
  return names;
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campusnet-pf-')); let child;
after(() => { child?.kill(); });

describe('Pufferland package', () => {
  const r = build({ pufferland: { admin: 'mahbod', site: 'Dorm Net' } }); let names;
  it('has the default start file, a private .env with a random admin code and the guide, and the plain pack does not', () => {
    names = unzip(r.zip, dir);
    for (const f of ['index.js', '.env', 'PUFFERLAND.fa.md', 'server.js', 'scripts/start.js', 'vendor/ws/index.js']) assert.ok(names.includes(f), f);
    assert.ok(!build().names.includes('.env') && build().names.includes('index.js'));
    assert.equal(build({ pufferland: { adminCode: 'fixed-code-123456789012' } }).adminCode, 'fixed-code-123456789012');
    const env = fs.readFileSync(path.join(dir, '.env'), 'utf8');
    assert.match(env, /^SITE_NAME=Dorm Net$/m); assert.match(env, /^TRUST_PROXY=1$/m); assert.match(env, /^ADMIN_USERS=mahbod$/m);
    assert.match(env, /^ADMIN_CODE=[A-Za-z0-9_-]{20,}$/m); assert.ok(r.adminCode.length >= 20 && env.includes(r.adminCode));
    assert.notEqual(build({ pufferland: {} }).adminCode, build({ pufferland: {} }).adminCode);
    assert.deepEqual(parseArgs(['--pufferland', '--admin', 'x', '--site', 'S', 'o.zip']), { pufferland: { admin: 'x', site: 'S' }, out: 'o.zip' });
  });
  it('index.js with only PORT in the environment loads the .env, stays on plain HTTP, and keeps admin names reserved', async () => {
    child = spawn(process.execPath, ['index.js'], { cwd: dir, env: { PATH: process.env.PATH, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; const port = await new Promise((res, rej) => { child.stdout.on('data', d => { out += d; const m = out.match(/listening port=(\d+)/); if (m) res(+m[1]); }); child.once('exit', c => rej(new Error('exited ' + c + out))); setTimeout(() => rej(new Error('timeout ' + out)), 8000); });
    const base = 'http://127.0.0.1:' + port;
    assert.equal((await (await fetch(base + '/api/info')).json()).name, 'Dorm Net');
    const health = await (await fetch(base + '/healthz')).json(); assert.equal(health.ok, true); assert.equal(health.version, require('../package.json').version, 'the running version is visible at /healthz');
    const WebSocket = require(path.join(dir, 'vendor/ws')), join = (name, extra = {}) => new Promise((res, rej) => { const ws = new WebSocket('ws://127.0.0.1:' + port, { headers: { 'x-forwarded-for': '203.0.113.' + Math.floor(Math.random() * 200 + 1) } }); ws.on('open', () => ws.send(JSON.stringify({ t: 'join', name, password: 'correct-horse-9', mode: 'register', ...extra }))); ws.on('message', d => { const x = JSON.parse(d); if (x.t === 'welcome' || x.t === 'err') { ws.close(); res(x); } }); ws.on('error', rej); });
    assert.equal((await join('mahbod')).t, 'err');
    assert.equal((await join('mahbod', { adminCode: r.adminCode })).t, 'welcome');
  });
});
