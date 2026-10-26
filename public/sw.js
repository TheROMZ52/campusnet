'use strict';
/* CampusNet service worker: the app shell (page, scripts, styles, fonts, icons) opens without a connection.
   Chat data is never cached here: uploads, downloads, WebSocket traffic and /api/* always go to the server.
   Change VERSION with every release (tests/pwa.test.js checks it equals package.json): a new VERSION installs a fresh cache. */
const VERSION = '0.14.0', CACHE = 'cn-' + VERSION;
const SHELL = ['/', '/style.css', '/net.js', '/crypto.js', '/demo.js', '/i18n.js', '/app.js', '/music.js', '/social.js', '/home.js', '/call.js', '/call-worklet.js',
  '/admin.js', '/shell.js', '/router.js', '/pwa.js', '/fonts/Vazirmatn-Regular.woff2', '/fonts/Vazirmatn-Bold.woff2', '/icon.svg', '/icon-192.png', '/icon-512.png',
  '/icon-maskable-512.png', '/apple-touch-icon.png', '/manifest.webmanifest'];
const KNOWN = new Set(SHELL), NAV_WAIT = 3500;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(p => new Request(p, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('cn-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

/* page loads: the network first (so a new version arrives at once), the cached page when the network is down or slower than NAV_WAIT */
async function navigate(req) {
  const c = await caches.open(CACHE), cached = () => c.match('/');
  try {
    const res = await Promise.race([fetch(req), new Promise((_, no) => setTimeout(() => no(new Error('slow')), NAV_WAIT))]);
    if (res.ok && new URL(req.url).pathname === '/') c.put('/', res.clone());
    return res;
  } catch (err) { return (await cached()) || Response.error(); }
}
/* shell files: answer from the cache and refresh it in the background */
async function shellFile(e) {
  const c = await caches.open(CACHE), hit = await c.match(e.request, { ignoreSearch: true });
  const fresh = fetch(e.request).then(res => { if (res.ok) c.put(e.request, res.clone()); return res; });
  if (hit) { e.waitUntil(fresh.catch(() => {})); return hit; }
  return fresh;
}
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET' || r.headers.has('range')) return;
  const u = new URL(r.url); if (u.origin !== self.location.origin) return;
  if (r.mode === 'navigate') return e.respondWith(navigate(r));
  if (KNOWN.has(u.pathname)) e.respondWith(shellFile(e));
});
