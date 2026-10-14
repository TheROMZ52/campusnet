'use strict';
/* Preview mode: open index.html?demo (no server needed). Replaces WebSocket, /api/info and /upload with an in-browser simulation.
   The real UI code runs unchanged. Nothing here is loaded into behaviour unless the URL contains "demo". */
(function () {
  if (!/[?&]demo\b/.test(location.search)) return;
  const now = () => Date.now(), uid = () => Math.random().toString(16).slice(2, 10) + Math.random().toString(16).slice(2, 10);
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const BOTS = { trin: 'online', morpheus: 'away', cypher: 'busy' };
  const LINES = ['anyone seen the new lab schedule?', 'uploaded the slides, grab them from the library', 'the north wing wifi is down again', 'who is up for a study session at 6?', 'reminder: submissions close tonight', 'nice, thanks for sharing', 'I can host the next meetup', 'check the board, there is a new notice'];
  const REPLIES = ['got it', 'sounds good to me', 'lol yes', 'on my way', 'let me check and get back to you', 'thanks, that helps'];
  const botKeys = {}; let myPub = null;
  try { localStorage.removeItem('cn:fp'); } catch { /* ignore */ }
  const keysReady = (window.CN && CN.supported) ? Promise.all(Object.keys(BOTS).map(async n => { botKeys[n] = await CN.genPair(); })) : Promise.resolve();
  const pubs = () => { const o = {}; Object.keys(botKeys).forEach(n => { o[n] = botKeys[n].pub; }); return o; };
  let myBlob = null, me = '', admin = false, myStatus = 'online', ws = null, timer = 0;
  const hist = { general: [], random: [], help: [] }, dms = {};
  let files = [
    { id: 'a1b2c3d4e5f60718', name: 'week3-slides.pdf', size: 2411724, owner: 'trin', ts: now() - 3600e3, img: false },
    { id: 'b2c3d4e5f6071829', name: 'lab-notes.txt', size: 18240, owner: 'morpheus', ts: now() - 5400e3, img: false }
  ];
  let notices = [{ id: uid(), text: 'Welcome to CampusNet. This is a simulated preview, nothing here is stored.', by: 'morpheus', ts: now() - 7200e3 }];
  const seed = (room, from, text, ago) => hist[room].push({ id: uid(), room, from, text, ts: now() - ago, kind: 'chat' });
  seed('general', 'trin', 'morning everyone', 3300e3); seed('general', 'morpheus', 'the uplink is stable today', 3000e3); seed('general', 'cypher', 'anyone has the lab schedule?', 1500e3); seed('general', 'trin', '@cypher it is in the library, week3-slides.pdf', 1400e3);
  seed('random', 'cypher', 'hot take: tabs over spaces', 2600e3); seed('help', 'morpheus', 'ask your questions here', 4000e3);
  const names = () => [me, ...Object.keys(BOTS)];
  const userList = () => [{ n: me, s: myStatus }, ...Object.entries(BOTS).map(([n, s]) => ({ n, s }))];
  const emit = o => setTimeout(() => { if (ws && ws.readyState === 1 && ws.onmessage) ws.onmessage({ data: JSON.stringify(o) }); }, 0);
  const roomMsg = (room, from, text, kind) => { const m = { id: uid(), room, from, text, ts: now(), kind: kind || 'chat' }; hist[room].push(m); emit({ t: 'msg', m }); };
  const botSays = (room, from, text) => { emit({ t: 'typing', from, room }); setTimeout(() => roomMsg(room, from, text), 1400); };
  async function botDm(from, text) {
    if (!myPub || !botKeys[from]) return;
    const key = await CN.shared(botKeys[from].kp.privateKey, myPub), enc = await CN.encrypt(key, from, me, { text, kind: 'chat' });
    const m = { id: uid(), from, to: me, enc, ts: now() }; (dms[from] = dms[from] || []).push(m); emit({ t: 'dm', m });
  }

  function handle(m) {
    if (m.t === 'join') {
      me = String(m.name || 'guest').slice(0, 20); admin = false;
      keysReady.then(() => { emit({ t: 'welcome', me, token: 'demo-' + uid(), admin, site: 'CampusNet', rooms: ['general', 'random', 'help'], hist, dms, users: userList(), all: names(), notices, files, maxMB: 100, pub: myPub, blob: myBlob, keys: Object.assign(pubs(), myPub ? { [me]: myPub } : {}) }); roomMsg('general', 'system', me + ' connected', 'sys'); });
      clearInterval(timer); timer = setInterval(() => botSays('general', pick(Object.keys(BOTS)), pick(LINES)), 11000);
    } else if (m.t === 'msg') {
      const text = String(m.text || '').trim(); if (!text) return;
      roomMsg(m.room, me, text, m.kind === 'me' ? 'me' : 'chat');
      setTimeout(() => botSays(m.room, pick(Object.keys(BOTS)), (new RegExp('@' + me, 'i').test(text) ? '@' + me + ' ' : '') + pick(REPLIES)), 700);
    } else if (m.t === 'dm') {
      const to = Object.keys(BOTS).find(n => n === String(m.to).toLowerCase());
      if (!to) return emit({ t: 'err', text: 'No user named "' + String(m.to).slice(0, 20) + '".' });
      if (!m.enc) return emit({ t: 'err', text: 'Direct messages must be end-to-end encrypted.' });
      const msg = { id: uid(), from: me, to, enc: m.enc, ts: now() };
      (dms[to] = dms[to] || []).push(msg); emit({ t: 'dm', m: msg });
      setTimeout(() => { emit({ t: 'typing', from: to }); setTimeout(() => botDm(to, pick(REPLIES)), 1200); }, 600);
    } else if (m.t === 'setkey') { myPub = m.pub; myBlob = m.blob; emit({ t: 'key', name: me, pub: myPub });
    } else if (m.t === 'status') { if (['online', 'away', 'busy'].includes(m.status)) { myStatus = m.status; emit({ t: 'users', users: userList(), all: names() }); } }
    else if (m.t === 'delmsg') { const a = hist[m.room]; const i = a ? a.findIndex(x => x.id === m.id) : -1; if (i >= 0 && (a[i].from === me || admin)) { a.splice(i, 1); emit({ t: 'delmsg', room: m.room, id: m.id }); } }
    else if (m.t === 'delfile') { const f = files.find(x => x.id === m.id); if (f && (f.owner === me || admin)) { files = files.filter(x => x !== f); emit({ t: 'files', files }); } }
    else if (m.t === 'admin') { admin = true; emit({ t: 'admin', ok: true }); }
    else if (m.t === 'notice') { if (!admin) return emit({ t: 'err', text: 'Only admins can post notices. (Demo: type /admin anything)' }); notices = [{ id: uid(), text: String(m.text).slice(0, 1000), by: me, ts: now() }, ...notices]; emit({ t: 'notices', notices }); }
    else if (m.t === 'delnotice') { if (admin) { notices = notices.filter(n => n.id !== m.id); emit({ t: 'notices', notices }); } }
  }

  class FakeWS {
    constructor() { this.readyState = 0; ws = this; setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 250); }
    send(raw) { let m; try { m = JSON.parse(raw); } catch { return; } if (m.t === 'bye') { clearInterval(timer); return; } handle(m); }
    close() { if (this.readyState === 3) return; this.readyState = 3; clearInterval(timer); setTimeout(() => this.onclose && this.onclose(), 0); }
  }
  window.WebSocket = FakeWS;

  const realFetch = window.fetch;
  window.fetch = (u, o) => String(u).split('?')[0] === '/api/session' ? Promise.resolve(new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } })) : String(u).split('?')[0] === '/api/info' ? Promise.resolve(new Response(JSON.stringify({ name: 'CampusNet', needCode: false, maxMB: 100 }), { headers: { 'Content-Type': 'application/json' } })) : realFetch(u, o);

  class FakeXHR {
    constructor() { this.upload = {}; this.status = 0; this.responseText = ''; }
    open() {} setRequestHeader() {}
    abort() { clearInterval(this.iv); this.onabort && this.onabort(); }
    send(f) {
      let loaded = 0; const total = f.size, step = Math.max(1, Math.ceil(total / 14));
      this.iv = setInterval(() => {
        loaded = Math.min(total, loaded + step); this.upload.onprogress && this.upload.onprogress({ lengthComputable: true, loaded, total });
        if (loaded >= total) {
          clearInterval(this.iv); files = [{ id: uid(), name: f.name, size: f.size, owner: me, ts: now(), img: false }, ...files];
          emit({ t: 'files', files }); roomMsg('general', 'system', me + ' shared "' + f.name + '"', 'sys');
          this.status = 200; this.responseText = '{"ok":true}'; this.onload && this.onload();
        }
      }, 120);
    }
  }
  window.XMLHttpRequest = FakeXHR;

  document.addEventListener('click', e => { const a = e.target.closest && e.target.closest('a[href*="/f/"]'); if (a) { e.preventDefault(); if (window.toast) toast('Demo mode: downloads are disabled', 'warn'); } }, true);
  document.addEventListener('DOMContentLoaded', () => {
    const b = document.createElement('div'); b.textContent = 'DEMO \u00B7 simulated data, no server';
    b.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);top:0;z-index:100;padding:2px 12px;background:#ffb020;color:#1a1000;font:700 10px ui-monospace,Consolas,monospace;letter-spacing:.14em;text-transform:uppercase;border-radius:0 0 4px 4px;pointer-events:none';
    document.body.append(b);
    const h = document.getElementById('gateHint'); if (h) h.textContent = 'Demo mode: use any username and password. Everything is simulated in your browser.';
  });
})();
