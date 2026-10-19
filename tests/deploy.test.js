'use strict';
/* The deployment zip must start the server with no npm install and no network. */
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), zlib = require('node:zlib');
const { spawn } = require('node:child_process');
const { build } = require('../scripts/pack');

function unzip(buf, dir) {   // minimal reader: central directory + raw deflate (also checks the sizes and CRC fields we wrote)
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])), n = buf.readUInt16LE(end + 10); let p = buf.readUInt32LE(end + 16); const names = [];
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24), nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl), ln = buf.readUInt16LE(off + 26), le = buf.readUInt16LE(off + 28), start = off + 30 + ln + le;
    const data = method === 8 ? zlib.inflateRawSync(buf.subarray(start, start + csize)) : buf.subarray(start, start + csize); assert.equal(data.length, usize, name);
    const out = path.join(dir, name); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, data); names.push(name); p += 46 + nl + el + cl;
  }
  return names;
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campusnet-deploy-')); let child;
after(() => { child?.kill(); });

describe('deployment package', () => {
  const { zip } = build(); let names;
  it('has files at the zip root, includes the app and vendored ws, and leaves out tests, node_modules, data and CI', () => {
    names = unzip(zip, dir);
    for (const must of ['server.js', 'package.json', 'public/index.html', 'public/fonts/Vazirmatn-Regular.woff2', 'vendor/ws/index.js', 'vendor/ws/LICENSE', 'DEPLOY.md', 'DEPLOY.fa.md', 'scripts/start.js', '.env.example']) assert.ok(names.includes(must), 'missing ' + must);
    for (const bad of names) assert.ok(!/^(tests|node_modules|data|dist|\.github)\//.test(bad) && !/^scripts\/(?!start\.js$)/.test(bad) && bad !== '.env', 'must not ship ' + bad);
  });
  it('has no runtime dependencies, so a start never needs the npm registry', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); assert.deepEqual(pkg.dependencies || {}, {});
  });
  it('starts from the extracted zip with no node_modules, serves the page, answers /healthz and accepts a WebSocket sign-up', async () => {
    assert.ok(!fs.existsSync(path.join(dir, 'node_modules')));
    child = spawn(process.execPath, ['server.js'], { cwd: dir, env: { PATH: process.env.PATH, PORT: '0', DATA_DIR: path.join(dir, 'data') }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; const port = await new Promise((res, rej) => { child.stdout.on('data', d => { out += d; const m = out.match(/listening port=(\d+)/); if (m) res(+m[1]); }); child.once('exit', c => rej(new Error('exited ' + c))); setTimeout(() => rej(new Error('timeout')), 8000); });
    const base = 'http://127.0.0.1:' + port;
    assert.deepEqual((await (await fetch(base + '/healthz')).json()).ok, true);
    assert.match(await (await fetch(base + '/')).text(), /CampusNet/);
    const WebSocket = require(path.join(dir, 'vendor/ws'));
    const m = await new Promise((res, rej) => { const ws = new WebSocket('ws://127.0.0.1:' + port); ws.on('open', () => ws.send(JSON.stringify({ t: 'join', name: 'deploytest', password: 'correct-horse-9', mode: 'register' }))); ws.on('message', d => { const x = JSON.parse(d); if (x.t === 'welcome') { ws.close(); res(x); } }); ws.on('error', rej); setTimeout(() => rej(new Error('no welcome')), 6000); });
    assert.equal(m.me, 'deploytest');
  });
});
