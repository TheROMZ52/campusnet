'use strict';
/* `npm start` (scripts/start.js): loads .env, HTTPS only on a personal machine, safe on hosting platforms and in the deployment zip. */
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), https = require('node:https');
const { spawn, spawnSync } = require('node:child_process');
const ROOT = path.join(__dirname, '..'), HAS_OPENSSL = spawnSync('openssl', ['version']).status === 0;
const kids = []; afterEach(() => { while (kids.length) kids.pop().kill(); });
function project(files = {}) {   // a minimal copy of the project: what the deployment zip contains
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campusnet-start-')); fs.cpSync(path.join(ROOT, 'vendor'), path.join(dir, 'vendor'), { recursive: true }); fs.cpSync(path.join(ROOT, 'public'), path.join(dir, 'public'), { recursive: true }); fs.cpSync(path.join(ROOT, 'lib'), path.join(dir, 'lib'), { recursive: true }); fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(dir, 'package.json'));
  fs.mkdirSync(path.join(dir, 'scripts')); fs.copyFileSync(path.join(ROOT, 'server.js'), path.join(dir, 'server.js')); fs.copyFileSync(path.join(ROOT, 'scripts', 'start.js'), path.join(dir, 'scripts', 'start.js'));
  for (const [n, c] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), c); return dir;
}
function start(dir, env = {}) {
  const child = spawn(process.execPath, ['scripts/start.js'], { cwd: dir, env: { PATH: process.env.PATH, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }); kids.push(child); let out = '';
  return new Promise((res, rej) => { child.stdout.on('data', d => { out += d; const m = out.match(/listening port=(\d+)/); if (m) res({ port: +m[1], out: () => out }); }); child.stderr.on('data', d => { out += d; }); child.once('exit', c => rej(new Error('exited ' + c + ': ' + out.slice(0, 300)))); setTimeout(() => rej(new Error('timeout: ' + out.slice(0, 300))), 10000); });
}
const getHttps = port => new Promise((res, rej) => https.get({ host: '127.0.0.1', port, path: '/healthz', rejectUnauthorized: false }, r => { let b = ''; r.on('data', d => { b += d; }); r.on('end', () => res(JSON.parse(b))); }).on('error', rej));

describe('npm start script', () => {
  it('hosting platform (PORT is set): plain HTTP, no .env needed (this crashed from the deployment zip)', async () => {
    const dir = project(), s = await start(dir, { PORT: '0', DATA_DIR: path.join(dir, 'data') });
    assert.equal((await (await fetch(`http://127.0.0.1:${s.port}/healthz`)).json()).ok, true); assert.ok(!fs.existsSync(path.join(dir, '.env')), 'does not create .env on a host');
  });
  it('behind a proxy (TRUST_PROXY set) it also stays on plain HTTP', async () => {
    const dir = project({ '.env.example': 'PORT=0\n' }), s = await start(dir, { TRUST_PROXY: '1', DATA_DIR: path.join(dir, 'data') });
    assert.equal((await (await fetch(`http://127.0.0.1:${s.port}/healthz`)).json()).ok, true);
  });
  it('personal machine: creates .env from .env.example, loads it and serves HTTPS', { skip: !HAS_OPENSSL && 'openssl is not installed' }, async () => {
    const dir = project({ '.env.example': `# comment\nPORT=0\nDATA_DIR=${path.join('.', 'mydata')}\nSITE_NAME="My Net"   # inline comment\n` }), s = await start(dir);
    assert.ok(fs.existsSync(path.join(dir, '.env')), '.env was created'); assert.ok(/https:\/\/localhost/.test(s.out()), 'HTTPS banner'); assert.equal((await getHttps(s.port)).ok, true);
    assert.ok(fs.existsSync(path.join(dir, 'mydata')), 'DATA_DIR from the file is used');
  });
  it('HTTPS=0 in .env keeps plain HTTP on a personal machine', async () => {
    const dir = project({ '.env': 'PORT=0\nHTTPS=0\n' }), s = await start(dir, { DATA_DIR: path.join(dir, 'data') });
    assert.equal((await (await fetch(`http://127.0.0.1:${s.port}/healthz`)).json()).ok, true);
  });
  it('real environment variables win over the file', async () => {
    const dir = project({ '.env': 'PORT=0\nHTTPS=0\nDATA_DIR=from-file\n' }), s = await start(dir, { DATA_DIR: path.join(dir, 'from-env') });
    assert.ok(fs.existsSync(path.join(dir, 'from-env')) && !fs.existsSync(path.join(dir, 'from-file')));
    assert.equal((await (await fetch(`http://127.0.0.1:${s.port}/healthz`)).json()).ok, true);
  });
});
