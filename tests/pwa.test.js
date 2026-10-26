'use strict';
/* PWA: manifest, icons, service worker file and the app shell it caches. Run: npm test */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http'), vm = require('node:vm');
const ROOT = path.join(__dirname, '..'), PUB = path.join(ROOT, 'public');

function startServer(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campusnet-pwa-'));
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env: { ...process.env, PORT: '0', DATA_DIR: dir, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  return new Promise((resolve, reject) => {
    child.stdout.on('data', d => { out += d; const m = out.match(/listening port=(\d+)/); if (m) resolve({ port: +m[1], stop: () => child.kill() }); });
    child.once('exit', c => reject(new Error('server exited ' + c))); setTimeout(() => reject(new Error('server start timeout')), 8000);
  });
}
const get = (s, p, method = 'GET') => new Promise((resolve, reject) => { const r = http.request({ host: '127.0.0.1', port: s.port, path: p, method }, res => { const ch = []; res.on('data', d => ch.push(d)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(ch) })); }); r.on('error', reject); r.end(); });
const swSource = fs.readFileSync(path.join(PUB, 'sw.js'), 'utf8');
const sw = (() => { const box = { self: { addEventListener() {}, location: { origin: 'http://x' } }, caches: {}, URL, Request: function () {}, Response: {}, fetch() {}, setTimeout, location: { origin: 'http://x' } }; vm.createContext(box); vm.runInContext(swSource + '\n;this.out = { VERSION, SHELL, CACHE };', box); return box.out; })();
const pngSize = f => { const b = fs.readFileSync(path.join(PUB, f)); assert.equal(b.subarray(1, 4).toString(), 'PNG'); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

describe('PWA', () => {
  let s; before(async () => { s = await startServer({ SITE_NAME: 'Dorm Net' }); }); after(() => s?.stop());

  it('manifest is served with the site name and installable settings, icons exist at the declared sizes', async () => {
    const r = await get(s, '/manifest.webmanifest'); assert.equal(r.status, 200); assert.match(r.headers['content-type'], /^application\/manifest\+json/);
    const m = JSON.parse(r.body);
    assert.equal(m.name, 'Dorm Net'); assert.equal(m.start_url, '/'); assert.equal(m.scope, '/'); assert.equal(m.display, 'standalone');
    assert.ok(m.icons.some(i => i.sizes === '192x192' && i.purpose === 'any') && m.icons.some(i => i.sizes === '512x512' && i.purpose === 'any') && m.icons.some(i => i.purpose === 'maskable'));
    for (const i of m.icons) { const [w, h] = pngSize(i.src.slice(1)), [dw, dh] = i.sizes.split('x').map(Number); assert.deepEqual([w, h], [dw, dh], i.src); const ir = await get(s, i.src); assert.equal(ir.status, 200); assert.equal(ir.headers['content-type'], 'image/png'); }
    assert.equal((await get(s, '/manifest.webmanifest', 'HEAD')).status, 200);
  });
  it('index.html links the manifest and icons and loads pwa.js', () => {
    const h = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
    for (const x of ['rel="manifest" href="manifest.webmanifest"', 'rel="apple-touch-icon"', '<script src="pwa.js"></script>']) assert.ok(h.includes(x), x);
  });
  it('service worker is served from the root, not cached by the browser, and its version equals package.json', async () => {
    const r = await get(s, '/sw.js'); assert.equal(r.status, 200); assert.match(r.headers['content-type'], /javascript/); assert.equal(r.headers['cache-control'], 'no-cache');
    assert.equal(sw.VERSION, require('../package.json').version); assert.equal(sw.CACHE, 'cn-' + sw.VERSION);
  });
  it('every file the service worker precaches is served with 200', async () => { for (const p of sw.SHELL) assert.equal((await get(s, p)).status, 200, p); });
  it('the precache list covers every script, style and font the page loads', () => {
    const h = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8'), want = [...h.matchAll(/<script src="([^"]+)"/g)].map(m => '/' + m[1]).concat([...h.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(m => '/' + m[1]), ['/call-worklet.js']);
    const css = fs.readFileSync(path.join(PUB, 'style.css'), 'utf8'); for (const m of css.matchAll(/url\(["']?(?:\.\/)?(fonts\/[^"')]+)/g)) want.push('/' + m[1]);
    assert.ok(want.length > 14); assert.deepEqual(want.filter(p => !sw.SHELL.includes(p)), []);
  });
  it('the worker leaves uploads, downloads, API and WebSocket traffic alone (it only answers listed shell files)', () => {
    for (const p of ['/f/abc', '/f/backup/now', '/api/info', '/healthz']) assert.ok(!sw.SHELL.includes(p), p);
    assert.match(swSource, /headers\.has\('range'\)/); assert.match(swSource, /method !== 'GET'/);
  });
});
