'use strict';
/* CampusNet client. Protocol (unchanged): join/welcome, users, files, notices, msg, delmsg, dm, typing, status, admin, err. */
const $ = s => document.querySelector(s);
const el = (t, c, txt) => { const e = document.createElement(t); if (c) e.className = c; if (txt != null) e.textContent = txt; return e; };
const IS_DEMO = /[?&]demo\b/.test(location.search), pingWait = {};
const st = { groups: {}, prefs: { following: [], blocked: [], muted: [], reads: {}, receipts: true }, profiles: {}, myProfile: { d: '', b: '', a: '' }, notifs: [], peerReads: {}, reply: null, editing: null, ws: null, me: '', token: sessionStorage.getItem('cn:token') || '', rooms: [], users: [], status: {}, all: [], hist: {}, dms: {}, notices: [], files: [], cur: { k: 'r', id: 'general' }, unread: {}, typing: {}, admin: false, maxMB: 100, retry: 0, mode: 'login', loginName: '', loginPw: '', loginCode: '', loginAdm: '' };
st.lat = []; st.t0 = 0;
let chain = Promise.resolve();
const key = c => c.k + ':' + c.id;
const emitUI = k => document.dispatchEvent(new CustomEvent('cn:' + k));
const hhmm = ts => { const d = new Date(ts); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const color = n => { let h = 0; for (const c of n) h = (h * 31 + c.charCodeAt(0)) % 360; return `hsl(${80 + h % 130} 75% 68%)`; };
const fmt = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
const ago = ts => { const s = (Date.now() - ts) / 1000; return s < 60 ? tr('now') : s < 3600 ? tr('{n}m ago', { n: Math.floor(s / 60) }) : s < 86400 ? tr('{n}h ago', { n: Math.floor(s / 3600) }) : tr('{n}d ago', { n: Math.floor(s / 86400) }); };
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const prefs = Object.assign({ crt: true, mesh: true, sound: true, boot: true }, (() => { try { return JSON.parse(localStorage.getItem('cn:prefs')) || {}; } catch { return {}; } })());
const savePrefs = () => { try { localStorage.setItem('cn:prefs', JSON.stringify(prefs)); } catch { /* ignore */ } };
function applyPrefs() { document.body.classList.toggle('no-crt', !prefs.crt); document.body.classList.toggle('no-mesh', !prefs.mesh); if (window.NetViz && NetViz.setMesh) NetViz.setMesh(prefs.mesh); }
applyPrefs();

/* ---------- icons (static strings only, never user data) ---------- */
const P = {
  send: '<path d="M3 11.5 21 3l-7.5 18-2.5-7.5z"/><path d="M11 13.5 21 3"/>', clip: '<path d="M20 11.5 12.5 19a5 5 0 0 1-7-7l8-8a3.3 3.3 0 0 1 4.7 4.7l-8 8a1.7 1.7 0 0 1-2.4-2.4l7.3-7.3"/>',
  dl: '<path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 20h14"/>', trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>',
  out: '<path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9"/>', nodes: '<circle cx="12" cy="12" r="2.5"/><circle cx="5" cy="6" r="1.8"/><circle cx="19" cy="7" r="1.8"/><circle cx="6" cy="19" r="1.8"/><circle cx="18" cy="18" r="1.8"/><path d="M10 10.5 6.3 7.2M14 10.7l3.5-2.6M10.2 13.8 7.2 17.5M13.8 13.8l3 3"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9.5h8M8 12.5h5"/>', files: '<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4M9 13h6M9 17h4"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="1"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>', term: '<path d="M4 5h16v14H4z"/><path d="M7 10l3 2-3 2M12 15h5"/>', monitor: '<path d="M3 5h18v11H3zM8 20h8M12 16v4"/><path d="M6 12l3-3 3 2 4-4"/>', shield: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/>', gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>', apps: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/>', hash: '<path d="M9 4 7 20M17 4l-2 16M4 9h16M3 15h16"/>',
  upload: '<path d="M12 16V5m0 0L8 9m4-4 4 4"/><path d="M4 16v4h16v-4"/>', radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12 18.5 5.5"/>', board: '<path d="M4 5h16v12H4zM8 21h8M12 17v4"/><path d="M8 9h8M8 12.5h5"/>', check: '<path d="M5 12.5 10 17.5 19 7"/>'
};
const SV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
const icon = name => { const s = el('span', 'svg'); s.innerHTML = SV + P[name] + '</svg>'; s.style.display = 'contents'; return s; };
const setIcon = (node, name) => { node.replaceChildren(icon(name)); };
setIcon($('#outBtn'), 'out'); setIcon($('#attach'), 'clip'); setIcon($('#form .send'), 'send'); setIcon($('.drop-art'), 'upload');
document.querySelectorAll('.ti').forEach(n => setIcon(n, n.dataset.i));
const emptyState = (art, title, text) => { const d = el('div', 'empty'); const a = el('span'); a.innerHTML = SV + P[art] + '</svg>'; d.append(a, el('b', null, title), el('p', null, text)); return d; };

/* ---------- toasts, modal, sound ---------- */
function toast(text, kind = 'ok', ms = 3600) {
  const t = el('div', 'toast' + (kind === 'ok' ? '' : ' ' + kind), text); $('#toasts').append(t);
  while ($('#toasts').children.length > 4) $('#toasts').firstChild.remove();
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 260); }, ms);
}
function ask({ title, text, ok = tr('Confirm'), danger = false }) {
  return new Promise(res => {
    const m = $('#modal'), okb = $('#mOk'), cb = $('#mCancel'), prev = document.activeElement;
    $('#mTitle').textContent = title; $('#mText').textContent = text; okb.textContent = ok; okb.classList.toggle('danger', danger); m.hidden = false;
    const close = v => { m.hidden = true; document.removeEventListener('keydown', onKey); if (prev && prev.focus) prev.focus(); res(v); };
    const onKey = e => {
      if (e.key === 'Escape') close(false);
      else if (e.key === 'Tab') { const first = cb, last = okb; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } }
    };
    okb.onclick = () => close(true); cb.onclick = () => close(false); m.onclick = e => { if (e.target === m) close(false); };
    document.addEventListener('keydown', onKey); cb.focus();
  });
}
let actx;
function beep(f = 660) { if (!prefs.sound) return; try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = f; g.gain.value = 0.04; o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + 0.08); } catch { /* ignore */ } }

/* ---------- rich text: safe links and @mentions (DOM nodes only) ---------- */
function rich(text) {
  const frag = document.createDocumentFragment(); let mention = false;
  text.split(/(https?:\/\/[^\s]+|@[\p{L}\p{N}_.-]{2,20})/gu).forEach(part => {
    if (!part) return;
    if (/^https?:\/\//.test(part)) { const a = el('a', null, part); a.href = part; a.target = '_blank'; a.rel = 'noopener noreferrer nofollow'; frag.append(a); }
    else if (part[0] === '@' && part.length > 2) { const me = same(part.slice(1), st.me); if (me) mention = true; frag.append(el('span', 'at' + (me ? ' me' : ''), part)); }
    else frag.append(part);
  });
  return { frag, mention };
}

/* ---------- end-to-end encrypted direct messages ---------- */
const E2E = { probe: {}, priv: null, pub: null, fp: '', keys: {}, shared: {}, state: {}, pending: {} };
const tofu = (() => { try { return JSON.parse(localStorage.getItem('cn:fp')) || {}; } catch { return {}; } })();
const saveTofu = () => { try { localStorage.setItem('cn:fp', JSON.stringify(tofu)); } catch { /* ignore */ } };
const canon = n => st.all.find(x => same(x, n)) || (same(n, st.me) ? st.me : '');
function dateLabel(d, opt) { return d.toLocaleDateString(I18N.lang === 'fa' ? 'fa-IR-u-ca-persian' : undefined, opt); }
function langRow() { const l = el('label', 'tog'), s = el('select'); s.setAttribute('aria-label', tr('Language')); [['en', 'English'], ['fa', '\u0641\u0627\u0631\u0633\u06CC']].forEach(([c, n]) => s.append(new Option(n, c))); s.value = I18N.lang; s.onchange = () => I18N.setLang(s.value); l.append(el('span', null, tr('Language')), s); return l; }
let pendingPw = null;
/* Settings > Account: change password (the key that locks your private messages is re-locked, not replaced) and delete account */
function accountBox() {
  const box = el('div', 'acct'), field = label => { const i = el('input'); i.type = 'password'; i.autocomplete = 'new-password'; i.placeholder = label; i.setAttribute('aria-label', label); return i; };
  const oldI = field(tr('Current password')), newI = field(tr('New password')), new2 = field(tr('Repeat new password')), delI = field(tr('Password')), msg = el('small', 'note');
  const btn = (t, fn, c) => { const b = el('button', 'btn' + (c ? ' ' + c : ''), t); b.type = 'button'; b.onclick = fn; return b; };
  const change = btn(tr('Change password'), async () => {
    msg.textContent = ''; if (newI.value.length < 8) { msg.textContent = tr('Choose a password of at least 8 characters.'); return; } if (newI.value !== new2.value) { msg.textContent = tr('Passwords do not match.'); return; }
    let blob; if (E2E.blob) { try { blob = await CN.rewrap(E2E.blob, oldI.value, newI.value); } catch { msg.textContent = tr('Wrong password.'); return; } }
    pendingPw = { pw: newI.value, blob }; send({ t: 'chpw', old: oldI.value, new: newI.value, blob });
  });
  const del = btn(tr('Delete my account'), async () => { if (await ask({ title: tr('Delete my account'), text: tr('Your account, files, posts and private messages will be deleted for good.'), ok: tr('Delete'), danger: true })) send({ t: 'delaccount', password: delI.value }); }, 'bad');
  accountReset = () => { [oldI, newI, new2, delI].forEach(i => { i.value = ''; }); msg.textContent = tr('Password changed'); };
  box.append(el('h4', 'sh', tr('Account')), oldI, newI, new2, change, msg, el('h4', 'sh', tr('Delete account')), delI, del); return box;
}
let accountReset = () => {};
function showUnlock(on) { const f = $('#unlockBar'); if (f) f.hidden = !on; }
async function doUnlock(pw) {
  try { E2E.priv = await CN.unlock(E2E.blob, pw); } catch { E2E.priv = null; toast(tr('Wrong password'), 'bad'); return false; }
  st.loginPw = pw; E2E.locked = false; E2E.shared = {}; showUnlock(false); const old = st.ws; connect(); try { old.close(); } catch { /* ignore */ }
  toast(tr('Encrypted messages unlocked'), 'ok', 2500); return true;
}
function endResume(msg) {
  if (!st.resume) return; st.resume = false; st.token = ''; st.loginName = ''; document.body.classList.remove('resuming');
  try { sessionStorage.removeItem('cn:token'); sessionStorage.removeItem('cn:name'); } catch { /* ignore */ }
  if (msg) $('#loginErr').textContent = msg;
}
async function setupKeys(m) {
  E2E.keys = Object.assign({}, m.keys || {}); E2E.shared = {}; E2E.state = {}; E2E.probe = {};
  if (!CN.supported) { E2E.priv = null; return; }
  if (st.resume && !st.loginPw && !E2E.priv) {   // page reload: the session continues, the key stays locked until the password is entered
    E2E.priv = null; if (m.blob && m.pub) { E2E.pub = m.pub; E2E.blob = m.blob; E2E.locked = true; E2E.keys[m.me] = m.pub; try { E2E.fp = await CN.fingerprint(m.pub); } catch { /* ignore */ } showUnlock(true); }
    return;
  }
  try {
    if (m.blob) E2E.blob = m.blob;
    const keep = E2E.priv && m.pub && E2E.pub && m.pub.x === E2E.pub.x && m.pub.y === E2E.pub.y;
    if (!keep) {
      E2E.priv = null;
      if (m.blob && m.pub) { try { E2E.priv = await CN.unlock(m.blob, st.loginPw); E2E.pub = m.pub; } catch { E2E.priv = null; } }
      if (!E2E.priv) { const id = await CN.create(st.loginPw); E2E.priv = id.priv; E2E.pub = id.pub; send({ t: 'setkey', pub: id.pub, blob: id.blob }); E2E.blob = id.blob; if (m.blob) toast(tr('Your encryption key was reset'), 'warn', 6000); }
    }
    E2E.keys[m.me] = E2E.pub; E2E.fp = await CN.fingerprint(E2E.pub); if (E2E.priv) { E2E.locked = false; showUnlock(false); }
  } catch { E2E.priv = null; toast(tr('Encryption setup failed'), 'bad'); }
}
function tofuCheck(name, fp) {
  const t = tofu[name];
  if (!t) { tofu[name] = { fp, v: false }; saveTofu(); E2E.state[name] = 'new'; return; }
  if (t.fp === fp) { E2E.state[name] = t.v ? 'verified' : 'ok'; return; }
  E2E.state[name] = 'changed'; E2E.pending[name] = fp;
  throw new Error(tr('The safety number of {name} changed. Open Security, verify it, then trust the new key.', { name }));
}
function trustKey(name) { if (E2E.pending[name]) { tofu[name] = { fp: E2E.pending[name], v: false }; delete E2E.pending[name]; saveTofu(); } delete E2E.shared[name]; E2E.state[name] = 'ok'; emitUI('state'); }
function markVerified(name, v) { if (tofu[name]) { tofu[name].v = !!v; saveTofu(); E2E.state[name] = v ? 'verified' : 'ok'; emitUI('state'); } }
function forgetKeys() { Object.keys(tofu).forEach(k => delete tofu[k]); saveTofu(); E2E.shared = {}; E2E.state = {}; E2E.pending = {}; emitUI('state'); }
async function sharedFor(name) {
  if (!E2E.priv) throw new Error(E2E.locked ? tr('Encrypted messages are locked. Enter your password in the bar above the chat.') : CN.supported ? tr('Your encryption key is not ready yet') : tr('Encrypted messages need HTTPS or localhost'));
  if (E2E.shared[name] && E2E.state[name] !== 'changed') return E2E.shared[name];
  const pub = E2E.keys[name]; if (!pub) throw new Error(tr('{name} has no encryption key yet. They need to sign in once with this version.', { name }));
  tofuCheck(name, await CN.fingerprint(pub));
  return (E2E.shared[name] = await CN.shared(E2E.priv, pub));
}
async function decDM(m, me = st.me) {
  if (!m.enc) return Object.assign({}, m, { text: tr('[unencrypted message blocked]'), kind: 'sys' });
  const other = m.from === me ? m.to : m.from;
  try { const p = await CN.decrypt(await sharedFor(other), m.from, m.to, m.enc); return Object.assign({}, m, { text: String(p.text || ''), kind: p.kind === 'me' ? 'me' : 'chat', reply: cleanReply(p.reply), e2e: true }); }
  catch { return Object.assign({}, m, { text: tr('[encrypted message: cannot decrypt]'), kind: 'sys' }); }
}
async function sendDM(to, text, kind, reply) {
  const c = canon(to); if (!c) { toast(tr('No user named "{name}"', { name: to }), 'bad'); return; }
  try { const k = await sharedFor(c); send({ t: 'dm', to: c, enc: await CN.encrypt(k, st.me, c, { text, kind: kind === 'me' ? 'me' : 'chat', reply }) }); }
  catch (e) { const t = e.message || tr('Cannot send encrypted message'); local(t, true); toast(t, 'bad', 6000); }
}
function e2eBadge() {
  const b = $('#e2e'); if (!b) return;
  if (st.cur.k !== 'd') { b.hidden = true; return; }
  const n = st.cur.id, s = !CN.supported || !E2E.priv ? 'off' : E2E.state[n] === 'changed' ? 'bad' : !E2E.keys[n] ? 'nokey' : 'ok';
  b.hidden = false; b.className = 'e2e ' + s; b.replaceChildren(icon('lock'), el('span', null, { off: tr('unavailable'), bad: tr('key changed'), nokey: tr('no key yet'), ok: tr(E2E.state[n] === 'verified' ? 'e2e verified' : 'e2e') }[s]));
  b.title = s === 'ok' ? tr('End-to-end encrypted. Verify the safety number in Security.') : s === 'bad' ? tr('The key of this contact changed. Open Security.') : s === 'off' ? tr('Needs HTTPS or localhost') : tr('This contact has no key yet');
  if (s === 'ok' && !E2E.state[n] && !E2E.probe[n]) { E2E.probe[n] = 1; sharedFor(n).then(e2eBadge, e2eBadge); }
}

/* ---------- connection ---------- */
let reconnectTimer = 0, countdownTimer = 0;
function connect() {
  const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  st.ws = ws; if (!st.me) gateLog('[*] opening link...');
  ws.onopen = () => { if (!st.me) gateLog('[*] authenticating...'); ws.send(JSON.stringify({ t: 'join', mode: st.mode, name: st.me || st.loginName, password: st.loginPw, code: st.loginCode, token: st.token, adminCode: st.loginAdm })); };
  ws.binaryType = 'arraybuffer';
  ws.onmessage = e => { if (typeof e.data !== 'string') { if (typeof Call !== 'undefined') Call.onFrame(e.data); return; } let m; try { m = JSON.parse(e.data); } catch { return; } chain = chain.then(() => handle(m)).catch(err => console.error(err)); };
  ws.onerror = () => { if (!st.me) { gateLog('[-] link failed', 'bad'); setBusy(false); $('#loginErr').textContent = tr('Cannot reach the server.'); } };
  ws.onclose = () => {
    if (st.ws === ws && typeof Call !== 'undefined') Call.lost();
    if (st.ws !== ws) return;
    if (!st.me) { endResume(tr('Could not resume your session. Please sign in again.')); setBusy(false); return; }
    st.retry++; const delay = Math.min(1000 * st.retry, 6000); let left = Math.ceil(delay / 1000);
    setLink('reconnecting', 'warn'); clearInterval(countdownTimer);
    const bar = $('#linkbar'); bar.hidden = false; bar.className = ''; void bar.offsetWidth; bar.classList.add('glitch');
    const paint = () => { bar.textContent = tr('LINK LOST \u2014 reconnecting in {left}s (attempt {n})', { left, n: st.retry }); };
    paint(); countdownTimer = setInterval(() => { left = Math.max(0, left - 1); paint(); }, 1000);
    clearTimeout(reconnectTimer); reconnectTimer = setTimeout(() => { clearInterval(countdownTimer); connect(); }, delay);
  };
}
function setLink(text, cls) { emitUI('state'); text = tr(text); $('#stat').textContent = text; $('#led').className = 'led ' + cls; const b = $('#sbLink'); b.textContent = text; b.className = cls === 'ok' ? '' : cls; }
function gateLog(line, cls) { const g = $('#gateLog'); const lines = (g.dataset.l ? JSON.parse(g.dataset.l) : []).concat([[line, cls || '']]).slice(-3); g.dataset.l = JSON.stringify(lines); g.replaceChildren(...lines.map(([t, c]) => { const s = el('div', c, t); return s; })); }
function send(o) { if (st.ws && st.ws.readyState === 1) st.ws.send(JSON.stringify(o)); else toast(tr('Not connected. Message not sent.'), 'bad'); }
function setUsers(list, all) { st.users = list.map(u => u.n); st.status = {}; list.forEach(u => { st.status[u.n] = u.s; }); if (all) st.all = all; viz(); }
const viz = () => { if (window.NetViz) NetViz.update({ me: st.me, users: st.users.map(n => ({ n, s: st.status[n] })) }); };
if (window.NetViz) NetViz.onPick = n => open('d', n);

/* WebSocket round trip: resolves to milliseconds, or null when there is no reply within 3 s */
function wsPing() { return new Promise(res => { if (!st.ws || st.ws.readyState !== 1) return res(null); const id = Math.random().toString(36).slice(2, 10); pingWait[id] = { t0: performance.now(), res }; send({ t: 'ping', id }); setTimeout(() => { if (pingWait[id]) { delete pingWait[id]; res(null); } }, 3000); }); }
/* latency probe: real round trips to the server (HTTP and WebSocket) */
setInterval(async () => {
  if ($('#app').hidden || document.hidden || !st.ws || st.ws.readyState !== 1) return;
  const t0 = performance.now();
  try { await fetch('/api/info', { cache: 'no-store' }); const ms = Math.round(performance.now() - t0); st.lat.push(ms); $('#lat').textContent = ms + ' ms'; } catch { st.lat.push(null); $('#lat').textContent = '-- ms'; }
  st.wsLat = await wsPing(); if (st.lat.length > 60) st.lat.shift(); emitUI('state');
}, 8000);

async function handle(m) {
  switch (m.t) {
    case 'welcome': {
      await setupKeys(m); const dmsDec = {}; for (const [o, arr] of Object.entries(m.dms || {})) { dmsDec[o] = []; for (const x of arr) dmsDec[o].push(await decDM(x, m.me)); }
      const first = !st.me; if (first) st.t0 = Date.now();
      try { await fetch('/api/session', { method: 'POST', headers: { 'x-token': m.token } }); } catch { /* downloads need this cookie */ }
      st.me = m.me; st.token = m.token; sessionStorage.setItem('cn:token', m.token); sessionStorage.setItem('cn:name', m.me); document.body.classList.remove('resuming'); st.admin = m.admin; st.mode = 'login';
      st.rooms = m.rooms; st.hist = m.hist; st.dms = dmsDec; st.notices = m.notices || []; st.files = m.files; st.maxMB = m.maxMB; setUsers(m.users, m.all);
      st.prefs = Object.assign({ following: [], blocked: [], muted: [], reads: {}, receipts: true }, m.prefs || {}); st.profiles = m.profiles || {}; st.myProfile = m.myProfile || { d: '', b: '', a: '' }; st.notifs = m.notifs || []; st.peerReads = m.peerReads || {}; st.reply = null; st.editing = null; st.groups = {}; (m.groups || []).forEach(addGroup); initUnread();
      clearTimeout(reconnectTimer); clearInterval(countdownTimer); $('#linkbar').hidden = true;
      if (st.retry) toast(tr('Link restored'), 'ok', 2200); st.retry = 0;
      gateLog('[+] access granted', 'ok'); setBusy(false); $('#login').hidden = true; $('#app').hidden = false;
      $('#siteBar').textContent = m.site; document.title = m.site; $('#meBar').textContent = m.me + (m.admin ? ' \u00B7 admin' : ''); $('#meAv').textContent = m.me[0];
      $('#limit').textContent = tr('Up to {n} MB per file', { n: m.maxMB }); $('#sbMax').textContent = m.maxMB + ' MB';
      setLink('online', 'ok'); renderAll(); renderReplyBar(); markRead(); viz(); if (m.mustChange) { toast(tr('An administrator reset your password. Choose a new one in Settings > Account.'), 'warn', 12000); if (window.Shell) Shell.launch('settings'); } if (!matchMedia('(pointer:coarse)').matches) $('#inp').focus();
      if (first) local(tr('Welcome, {name}. Type /help for commands.', { name: m.me }));
      emitUI('welcome');
      break;
    }
    case 'users': setUsers(m.users, m.all); renderUsers(); break;
    case 'files': { const added = m.files.length > st.files.length; st.files = m.files; renderFiles(); if (added && document.body.dataset.tab !== 'files') bump('tbFiles'); break; }
    case 'notices': { const more = m.notices.length > st.notices.length; st.notices = m.notices; if (st.cur.k === 'b') renderLog(); else if (more) { st.unread['b:board'] = (st.unread['b:board'] || 0) + 1; renderRooms(); tabBadges(); toast(tr('New notice on the board'), 'warn'); } break; }
    case 'msg': if (!st.hist[m.m.room] || st.hist[m.m.room].some(x => x.id === m.m.id) || (m.m.kind !== 'sys' && isBlocked(m.m.from))) break; (st.hist[m.m.room] = st.hist[m.m.room] || []).push(m.m); clearTyping('r:' + m.m.room, m.m.from); incoming('r:' + m.m.room, m.m, m.m.from); break;
    case 'delmsg': { const a = st.hist[m.room]; if (a) { const i = a.findIndex(x => x.id === m.id); if (i >= 0) a.splice(i, 1); } const row = document.querySelector(`.msg[data-id="${CSS.escape(m.id)}"]`); if (row) row.remove(); break; }
    case 'dm': { if ((st.dms[m.m.from === st.me ? m.m.to : m.m.from] || []).some(x => x.id === m.m.id)) break; const dm = await decDM(m.m), other = dm.from === st.me ? dm.to : dm.from; (st.dms[other] = st.dms[other] || []).push(dm); clearTyping('d:' + other, dm.from); incoming('d:' + other, dm, dm.from); if (dm.from !== st.me && (document.hidden || key(st.cur) !== 'd:' + other) && !isMuted('d:' + other)) beep(); break; }
    case 'key': { E2E.keys[m.name] = m.pub; delete E2E.shared[m.name]; delete E2E.state[m.name]; if (m.name !== st.me) CN.fingerprint(m.pub).then(fp => { const t = tofu[m.name]; if (t && t.fp !== fp) { E2E.state[m.name] = 'changed'; E2E.pending[m.name] = fp; toast(tr('Safety number of {name} changed', { name: m.name }), 'warn', 7000); } emitUI('state'); e2eBadge(); }); break; }
    case 'pong': { const w = pingWait[m.id]; if (w) { delete pingWait[m.id]; w.res(Math.round(performance.now() - w.t0)); } break; }
    case 'group': { addGroup(m.g); renderRooms(); if (key(st.cur) === 'r:g:' + m.g.id) { renderLog(); renderPins(); } break; }
    case 'gleave': { delete st.groups[m.id]; delete st.hist['g:' + m.id]; if (key(st.cur) === 'r:g:' + m.id) open('r', st.rooms[0] || 'general'); else renderRooms(); break; }
    case 'pwchanged': { if (pendingPw) { st.loginPw = pendingPw.pw; if (pendingPw.blob) E2E.blob = pendingPw.blob; pendingPw = null; } accountReset(); toast(tr('Password changed'), 'ok', 3000); break; }
    case 'userdeleted': { delete st.dms[m.name]; delete st.profiles[m.name]; if (st.cur.k === 'd' && same(st.cur.id, m.name)) open('r', st.rooms[0] || 'general'); else renderAll(); break; }
    case 'upd': { const a = st.hist[m.room], i = a ? a.findIndex(x => x.id === m.m.id) : -1; if (i >= 0) a[i] = m.m; if (st.cur.k === 'r' && st.cur.id === m.room) { updateRow(m.m); renderPins(); } break; }
    case 'dmupd': { const dm = await decDM(m.m), other = dm.from === st.me ? dm.to : dm.from, a = st.dms[other], i = a ? a.findIndex(x => x.id === dm.id) : -1; if (i >= 0) a[i] = dm; if (st.cur.k === 'd' && same(st.cur.id, other)) updateRow(dm); break; }
    case 'dmdel': { const other = same(m.a, st.me) ? m.b : m.a, a = st.dms[other], i = a ? a.findIndex(x => x.id === m.id) : -1; if (i >= 0) a.splice(i, 1); const row = document.querySelector(`.msg[data-id="${CSS.escape(m.id)}"]`); if (row) row.remove(); break; }
    case 'receipt': { st.peerReads[m.from] = m.ts; document.querySelectorAll('#log .rc').forEach(r => { if (same(r.dataset.peer, m.from) && +r.dataset.ts <= m.ts) { r.classList.add('seen'); r.textContent = ' \u2713\u2713'; r.title = tr('Seen'); } }); break; }
    case 'prefs': { const { t, ...rest } = m; Object.assign(st.prefs, rest); renderRooms(); renderUsers(); updMute(); tabBadges(); break; }
    case 'profile': { st.profiles[m.name] = m.p; if (m.name === st.me) st.myProfile = m.p; renderUsers(); break; }
    case 'notif': { st.notifs.unshift(m.n); if (!(m.n.conv && isMuted(m.n.conv))) toast(notifText(m.n), 'ok', 4200); break; }
    case 'typing': { const k = m.room ? 'r:' + m.room : 'd:' + m.from; (st.typing[k] = st.typing[k] || {})[m.from] = Date.now() + 4000; showTyping(); break; }
    case 'admin': st.admin = true; $('#meBar').textContent = st.me + ' \u00B7 admin'; toast(tr('Admin mode enabled')); renderFiles(); renderLog(); break;
    case 'err':
      if (m.fatal) {
        endResume(tr('Your session ended. Please sign in again.')); const resumed = $('#loginErr').textContent;
        gateLog('[-] access denied', 'bad'); setBusy(false); $('#loginErr').textContent = resumed || tr(m.text); st.me = ''; if (m.need === 'adminCode') { $('#admRow').hidden = false; $('#admIn').focus(); } try { st.ws.close(); } catch { /* ignore */ }
        if (!$('#app').hidden) { $('#app').hidden = true; $('#login').hidden = false; $('#linkbar').hidden = true; }
        const g = $('.gate'); g.classList.remove('shake'); void g.offsetWidth; g.classList.add('shake');
      } else { local(tr(m.text), true); toast(tr(m.text), 'bad'); }
      break;
  }
  if (typeof Admin !== 'undefined' && /^admin(users|stats|result)$/.test(m.t)) Admin.onMsg(m);
  if (typeof Call !== 'undefined' && (m.t === 'incoming' || m.t === 'callstate')) Call.onMsg(m);
  if (typeof Social !== 'undefined' && /^(prefs|profile|notif|results|feed|post|plike|pdel|group|gleave|gresults)$/.test(m.t)) Social.onMsg(m);
  emitUI('state');
}
function incoming(k, msg, from) {
  if (window.NetViz && from !== st.me) NetViz.pulse(msg.kind === 'sys' ? '' : from);
  const mention = msg.kind !== 'sys' && from !== st.me && new RegExp('@' + st.me.replace(/\./g, '\\.') + '(?![\\p{L}\\p{N}_.-])', 'iu').test(msg.text || '');
  if (key(st.cur) === k) { const stick = nearBottom(); addRow(msg); if (stick) scrollEnd(); markRead(); }
  else if (from !== st.me && msg.kind !== 'sys' && !isMuted(k)) { st.unread[k] = (st.unread[k] || 0) + 1; renderRooms(); renderUsers(); tabBadges(); }
  if (mention && (document.hidden || key(st.cur) !== k) && !isMuted(k)) beep(880);
  updateTitle();
}
function updateTitle() { const n = Object.values(st.unread).reduce((a, b) => a + b, 0); document.title = (n ? `(${n}) ` : '') + $('#siteBar').textContent; }
function tabBadges() { const n = Object.values(st.unread).reduce((a, b) => a + b, 0), b = $('#tbRooms'); b.hidden = !n; b.className = 'tb badge'; b.textContent = n > 99 ? '99+' : n; }
function bump(id) { const b = $('#' + id); b.hidden = false; b.className = 'tb badge'; b.textContent = (+b.textContent || 0) + 1; }

/* ---------- typing indicator ---------- */
function clearTyping(k, name) { if (st.typing[k]) delete st.typing[k][name]; showTyping(); }
function showTyping() {
  const t = st.typing[key(st.cur)] || {}, now = Date.now(), names = Object.keys(t).filter(n => t[n] > now), box = $('#typing');
  box.replaceChildren(); if (!names.length) return;
  const d = el('span', 'dots'); d.append(el('i'), el('i'), el('i')); box.append(d, tr(names.length > 1 ? '{names} are typing' : '{names} is typing', { names: names.join(', ') }));
}
setInterval(showTyping, 1000);
let lastTyp = 0;
$('#inp').addEventListener('input', () => {
  if (Date.now() - lastTyp < 2500 || st.cur.k === 'b') return; lastTyp = Date.now();
  send(st.cur.k === 'r' ? { t: 'typing', room: st.cur.id } : { t: 'typing', to: st.cur.id });
});

/* ---------- rendering ---------- */
const nearBottom = () => { const l = $('#log'); return l.scrollHeight - l.scrollTop - l.clientHeight < 90; };
const scrollEnd = () => { const l = $('#log'); l.scrollTo({ top: l.scrollHeight, behavior: 'auto' }); };
function mkRow(m, cls) {
  const r = el('div', 'msg' + (m.kind === 'sys' ? ' sys' : '') + (cls ? ' ' + cls : '') + (m.to ? ' dm' : '') + (m.from === st.me ? ' own' : '') + (m.pinned ? ' pinned' : '')); if (m.id) r.dataset.id = m.id;
  r.append(el('span', 't', hhmm(m.ts || Date.now())));
  if (m.kind === 'sys') { const b = el('span', 'b', m.text); r.dataset.tag = /disconnected|signed out|left\b/i.test(m.text) ? '[-]' : /connected|shared|restored|welcome/i.test(m.text) ? '[+]' : cls === 'err' ? '[!]' : '[*]'; b.dataset.tag = r.dataset.tag; r.append(b); }
  else {
    const { frag, mention } = rich(m.text); const body = el('span', 'b'); body.dir = 'auto'; body.append(frag);
    if (mention && m.from !== st.me) r.classList.add('mention');
    if (m.kind === 'me') { r.append(el('span', 'w', '*'), (() => { body.prepend(m.from + ' '); return body; })()); }
    else { const w = el('span', 'w', m.from); w.style.color = color(m.from); r.append(w, body); }
    if (m.reply) { const q = el('div', 'rq'); q.append(el('b', null, m.reply.from), ' ' + m.reply.text); q.onclick = () => jumpTo(m.reply.id); body.prepend(q); }
    if (m.edited) body.append(el('small', 'ed', ' ' + tr('(edited)')));
    if (m.to && m.from === st.me) { const seen = (st.peerReads[m.to] || 0) >= m.ts, rc = el('small', 'rc' + (seen ? ' seen' : ''), seen ? ' \u2713\u2713' : ' \u2713'); rc.dataset.peer = m.to; rc.dataset.ts = m.ts; rc.title = seen ? tr('Seen') : tr('Sent'); body.append(rc); }
    if (m.reactions) { const rx = el('div', 'rx'); Object.entries(m.reactions).forEach(([e, who]) => { const c = el('button', 'rxc' + (who.includes(st.me) ? ' me' : ''), e + ' ' + who.length); c.type = 'button'; c.title = who.join(', '); c.onclick = () => send(Object.assign({ t: 'react', id: m.id, emoji: e }, convRef(m))); rx.append(c); }); body.append(rx); }
    if (m.id) r.append(rowActions(m));
  }
  return r;
}
function addRow(m, cls) { const e0 = $('#log .empty'); if (e0) e0.remove(); const r = mkRow(m, cls); $('#log').append(r); applyFind(r); }
function updateRow(m) { const old = document.querySelector(`#log .msg[data-id="${CSS.escape(m.id)}"]`); if (old) { const r = mkRow(m); old.replaceWith(r); applyFind(r); } }
const REACTS = ['\uD83D\uDC4D', '\u2764\uFE0F', '\uD83D\uDE02', '\uD83D\uDE2E', '\uD83D\uDE22', '\uD83C\uDF89'];
const snip = t => String(t || '').replace(/\s+/g, ' ').slice(0, 80);
const convRef = m => m.room ? { room: m.room } : { to: m.from === st.me ? m.to : m.from };
const cleanReply = r => (r && typeof r === 'object' && typeof r.text === 'string') ? { id: String(r.id || '').slice(0, 24), from: String(r.from || '').slice(0, 40), text: snip(r.text) } : undefined;
function addGroup(g) { const { hist, ...meta } = g; st.groups[g.id] = meta; st.hist['g:' + g.id] = hist || []; }
const myRole = room => ((((st.groups[room.slice(2)] || {}).members) || []).find(x => x.n === st.me) || {}).r;
const canMod = room => room.startsWith('g:') ? ['owner', 'mod'].includes(myRole(room)) : !!st.admin;
const isBlocked = n => st.prefs.blocked.includes(String(n).toLowerCase());
const isMuted = k => st.prefs.muted.includes(String(k).toLowerCase());
function notifText(n) { const t = { follow: tr('started following you'), like: tr('liked your post'), react: tr('reacted {text}', { text: n.text }), reply: tr('replied: {text}', { text: n.text }), mention: tr('mentioned you: {text}', { text: n.text }), missed: tr('missed call'), invite: (/^added you to (.+)$/.exec(n.text || '') ? tr('added you to {name}', { name: /^added you to (.+)$/.exec(n.text)[1] }) : n.text) }[n.type]; return n.from + ' ' + (t || n.text || ''); }
function rowActions(m) {
  const box = el('span', 'ra'), add = (txt, label, fn) => { const b = el('button', 'ra-b', txt); b.type = 'button'; b.setAttribute('aria-label', label); b.title = label; b.onclick = e => { e.stopPropagation(); fn(b); }; box.append(b); };
  add('\u21A9', tr('Reply'), () => startReply(m)); add('\u263A', tr('React'), b => reactPicker(m, b));
  if (m.from === st.me) add('\u270E', tr('Edit message'), () => startEdit(m));
  if (m.room && canMod(m.room)) add(m.pinned ? '\u25C6' : '\u25C7', m.pinned ? tr('Unpin message') : tr('Pin message'), () => send({ t: 'pin', room: m.room, id: m.id, on: !m.pinned }));
  if (m.from === st.me || (m.room && canMod(m.room))) add('\u00D7', tr('Delete message'), () => send(m.room ? { t: 'delmsg', room: m.room, id: m.id } : { t: 'deldm', to: m.to === st.me ? m.from : m.to, id: m.id }));
  return box;
}
function reactPicker(m, anchor) {
  const old = document.querySelector('.rpick'); if (old) { const same = old.parentNode === anchor.closest('.msg'); old.remove(); if (same) return; }
  const p = el('div', 'rpick'); REACTS.forEach(e => { const b = el('button', null, e); b.type = 'button'; b.onclick = ev => { ev.stopPropagation(); send(Object.assign({ t: 'react', id: m.id, emoji: e }, convRef(m))); p.remove(); }; p.append(b); });
  anchor.closest('.msg').append(p);
}
document.addEventListener('click', e => { if (!e.target.closest('.rpick')) document.querySelectorAll('.rpick').forEach(x => x.remove()); });
function jumpTo(id) { const r = document.querySelector(`#log .msg[data-id="${CSS.escape(id)}"]`); if (!r) { toast(tr('That message is not loaded'), 'warn'); return; } r.scrollIntoView({ block: 'center' }); r.classList.remove('flash'); void r.offsetWidth; r.classList.add('flash'); }
function startReply(m) { st.editing = null; st.reply = { id: m.id, from: m.from, text: snip(m.text) }; renderReplyBar(); $('#inp').focus(); }
function startEdit(m) { st.reply = null; st.editing = { m }; $('#inp').value = m.text; renderReplyBar(); $('#inp').focus(); }
function renderReplyBar() {
  const bar = $('#replyBar'); if (!bar) return; bar.replaceChildren();
  bar.hidden = !st.reply && !st.editing; if (bar.hidden) return;
  bar.append(el('span', 'rl', st.editing ? tr('Editing message') : tr('Replying to {name}: {text}', { name: st.reply.from, text: st.reply.text })));
  const x = el('button', 'ra-b', '\u00D7'); x.type = 'button'; x.setAttribute('aria-label', tr('Cancel')); x.onclick = cancelCompose; bar.append(x);
}
function cancelCompose() { if (st.editing) $('#inp').value = ''; st.reply = null; st.editing = null; renderReplyBar(); }
async function finishEdit(text) {
  const m = st.editing.m; st.editing = null; renderReplyBar(); if (!text || text === m.text) return;
  if (m.room) return send({ t: 'edit', room: m.room, id: m.id, text });
  const other = m.to === st.me ? m.from : m.to;
  try { const k = await sharedFor(other); send({ t: 'edit', to: other, id: m.id, enc: await CN.encrypt(k, st.me, other, { text, kind: m.kind === 'me' ? 'me' : 'chat', reply: m.reply }) }); } catch (e) { toast(e.message || tr('Edit failed'), 'bad'); }
}
function renderPins() {
  const bar = $('#pinBar'); if (!bar) return; const pins = st.cur.k === 'r' ? (st.hist[st.cur.id] || []).filter(x => x.pinned) : [];
  bar.hidden = !pins.length; bar.replaceChildren();
  pins.forEach(p => { const b = el('button', 'pin'); b.type = 'button'; b.append(el('span', 'pg', '\u25C6'), el('b', null, p.from), ' ' + snip(p.text)); b.onclick = () => jumpTo(p.id); bar.append(b); });
}
function updMute() { const b = $('#muteBtn'); if (!b) return; b.hidden = st.cur.k === 'b'; if (b.hidden) return; const m = isMuted(key(st.cur)); b.textContent = '[' + tr(m ? 'muted' : 'mute') + ']'; b.classList.toggle('on', m); b.title = m ? tr('Unmute this conversation') : tr('Mute notifications for this conversation'); }
$('#muteBtn').onclick = () => { const k = key(st.cur).toLowerCase(), on = !isMuted(k); if (on) delete st.unread[key(st.cur)]; send({ t: 'mute', k, on }); };
$('#inp').addEventListener('keydown', e => { if (e.key === 'Escape' && (st.reply || st.editing)) cancelCompose(); });
/* persistent unread: counted from the server-stored "read up to" timestamp of each conversation */
function initUnread() {
  st.unread = {}; const rd = st.prefs.reads;
  Object.entries(st.hist).forEach(([r, a]) => { const base = rd['r:' + r]; if (base == null || isMuted('r:' + r)) return; const n = a.filter(x => x.ts > base && x.from !== st.me && x.kind !== 'sys' && !isBlocked(x.from)).length; if (n) st.unread['r:' + r] = n; });
  Object.entries(st.dms).forEach(([o, a]) => { if (isMuted('d:' + o)) return; const base = rd['d:' + o.toLowerCase()] || 0, n = a.filter(x => x.ts > base && x.from !== st.me).length; if (n) st.unread['d:' + o] = n; });   // counts messages that could not be decrypted yet too
}
let readT = 0;
function markRead() {
  clearTimeout(readT); readT = setTimeout(() => {
    if (document.hidden || $('#app').hidden || st.cur.k === 'b') return;
    const list = (st.cur.k === 'r' ? st.hist[st.cur.id] : st.dms[st.cur.id]) || [], last = list.filter(x => x.kind !== 'sys').pop(); if (!last) return;
    const k = key(st.cur).toLowerCase(); if ((st.prefs.reads[k] || 0) >= last.ts) return; st.prefs.reads[k] = last.ts; send({ t: 'read', k, ts: last.ts });
  }, 400);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) markRead(); });

function local(text, bad) { addRow({ kind: 'sys', text, ts: Date.now() }, bad ? 'err' : 'local'); scrollEnd(); }
function renderLog() {
  const log = $('#log'); log.replaceChildren();
  const board = st.cur.k === 'b'; e2eBadge();
  $('#form').hidden = board && !st.admin; $('#inp').placeholder = board ? tr('Broadcast a notice to everyone') : tr('Message, or /help');
  if (board) {
    $('#convTitle').textContent = tr('Broadcast board') + (st.admin ? '' : ' \u00B7 ' + tr('read only'));
    if (!st.notices.length) log.append(emptyState('board', tr('Nothing broadcast yet'), st.admin ? tr('Post the first notice below.') : tr('Admins can pin announcements here.')));
    st.notices.forEach(n => {
      const c = el('div', 'card'), by = el('div', 'by'), p = el('p'); by.append(el('b', null, n.by), el('span', null, new Date(n.ts).toLocaleString())); p.append(rich(n.text).frag);
      if (st.admin) { const d = el('button', 'icon-btn bad rm'); d.append(icon('trash')); d.setAttribute('aria-label', tr('Remove notice')); d.onclick = () => send({ t: 'delnotice', id: n.id }); by.append(d); }
      c.append(by, p); log.append(c);
    });
    return;
  }
  const list = st.cur.k === 'r' ? (st.hist[st.cur.id] || []) : (st.dms[st.cur.id] || []);
  $('#convTitle').textContent = st.cur.k === 'r' ? (st.cur.id.startsWith('g:') ? '\u25C7 ' + ((st.groups[st.cur.id.slice(2)] || {}).name || 'group') + ' \u00B7 group \u00B7 not end-to-end encrypted' : '# ' + st.cur.id) : 'private \u00B7 ' + st.cur.id;
  if (!list.length) log.append(emptyState('radar', tr('Quiet on this channel'), st.cur.k === 'r' ? tr('No transmissions yet. Say something.') : tr('End-to-end encrypted: only you and {name} can read this.', { name: st.cur.id })));
  list.filter(m => m.kind === 'sys' || !isBlocked(m.from)).forEach(m => addRow(m)); scrollEnd(); showTyping();
}
function applyFind(row) { const q = $('#find').value.trim().toLowerCase(); (row ? [row] : document.querySelectorAll('#log .msg')).forEach(r => { r.hidden = !!q && !r.textContent.toLowerCase().includes(q); }); }
$('#find').addEventListener('input', () => applyFind());
function item(on, glyph, name, badge, fn, extra) {
  const li = el('li', on ? 'on' : ''); li.append(glyph, el('span', 'n', name)); if (extra) li.querySelector('.n').append(extra);
  if (badge) li.append(el('span', 'badge', badge)); if (fn) { li.tabIndex = 0; li.onclick = fn; li.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } }; } return li;
}
function renderRooms() {
  const ul = $('#rooms'); ul.replaceChildren();
  ul.append(item(st.cur.k === 'b', el('span', 'g', '\u25C8'), tr('Broadcast board'), st.unread['b:board'], () => open('b', 'board')));
  st.rooms.forEach(r => ul.append(item(key(st.cur) === 'r:' + r, el('span', 'g', '#'), r, st.unread['r:' + r], () => open('r', r))));
  Object.values(st.groups).forEach(g => ul.append(item(key(st.cur) === 'r:g:' + g.id, el('span', 'g', '\u25C7'), g.name, st.unread['r:g:' + g.id], () => open('r', 'g:' + g.id))));
}
function renderUsers() {
  const ul = $('#users'); ul.replaceChildren(); $('#ucount').textContent = tr('{n} online', { n: st.users.length }); $('#sbNodes').textContent = st.users.length;
  const names = new Set([...st.users, ...st.all, ...Object.keys(st.dms)]);
  [...names].filter(n => !isBlocked(n)).sort((a, b) => (st.users.includes(b) - st.users.includes(a)) || a.localeCompare(b)).forEach(n => {
    const live = st.users.includes(n), s = live ? (st.status[n] || 'online') : 'off', led = el('span', 'led ' + (s === 'online' ? 'ok' : s === 'away' ? 'warn' : s === 'busy' ? 'bad' : ''));
    const li = item(key(st.cur) === 'd:' + n, led, n + (n === st.me ? ' ' + tr('(you)') : ''), st.unread['d:' + n], n === st.me ? null : () => open('d', n), live && s !== 'online' ? el('small', null, tr(s)) : null);
    if (!live) li.classList.add('off'); if (n === st.me) li.classList.add('self');
    const pr = st.profiles[n]; if (pr && pr.d) { li.querySelector('.n').append(el('small', 'dn', ' ' + pr.d)); li.title = pr.b || pr.d; }
    ul.append(li);
  });
}
const extOf = n => { const m = n.match(/\.([a-z0-9]{1,4})$/i); return m ? m[1] : 'file'; };
function renderFiles() {
  const ul = $('#files'); ul.replaceChildren(); const q = $('#ffind').value.trim().toLowerCase();
  const list = st.files.filter(f => !q || f.name.toLowerCase().includes(q));
  $('#sbFiles').textContent = st.files.length; $('#fcount').textContent = st.files.length ? st.files.length + ' file' + (st.files.length > 1 ? 's' : '') : '';
  if (!list.length) { const li = el('li'); li.style.cssText = 'cursor:default;border:0;background:none;justify-content:center'; li.append(emptyState('files', st.files.length ? tr('No match') : tr('Library is empty'), st.files.length ? tr('Try a different filter.') : tr('Files shared by anyone on the network show up here.'))); ul.append(li); return; }
  list.forEach(f => {
    const li = el('li'), url = `/f/${f.id}`;
    li.append(el('span', 'ext', extOf(f.name)));
    const info = el('div', 'info'); info.append(el('div', 'fn', f.name), el('div', 'meta', `${fmt(f.size)} \u00B7 ${f.owner} \u00B7 ${ago(f.ts)}`)); li.append(info);
    const acts = el('div', 'acts'), a = el('a', 'icon-btn'); a.href = url; a.rel = 'noopener'; a.setAttribute('aria-label', tr('Download {name}', { name: f.name })); a.title = tr('Download'); a.append(icon('dl')); acts.append(a);
    if (f.owner === st.me || st.admin) { const d = el('button', 'icon-btn bad'); d.append(icon('trash')); d.setAttribute('aria-label', tr('Delete {name}', { name: f.name })); d.title = tr('Delete'); d.onclick = async () => { if (await ask({ title: tr('Delete file'), text: tr('"{name}" will be removed for everyone.', { name: f.name }), ok: tr('Delete'), danger: true })) send({ t: 'delfile', id: f.id }); }; acts.append(d); }
    li.append(acts);
    if (f.img) { const w = el('a', 'th'), i = el('img'); i.loading = 'lazy'; i.alt = tr('Preview of {name}', { name: f.name }); i.src = url + '?inline=1'; w.href = url + '?inline=1'; w.target = '_blank'; w.rel = 'noopener'; w.append(i); li.append(w); }
    ul.append(li);
  });
}
$('#ffind').addEventListener('input', renderFiles);
function renderAll() { renderRooms(); renderUsers(); renderFiles(); renderLog(); renderPins(); updMute(); if (typeof Call !== 'undefined') Call.btn(); tabBadges(); }
function open(k, id) { st.cur = { k, id }; delete st.unread[k === 'b' ? 'b:board' : key(st.cur)]; $('#find').value = ''; st.reply = null; st.editing = null; renderReplyBar(); renderAll(); markRead(); updateTitle(); setTab('chat'); if (!$('#form').hidden && !matchMedia('(pointer:coarse)').matches) $('#inp').focus(); }

/* ---------- input & commands ---------- */
$('#form').onsubmit = e => {
  e.preventDefault();
  const inp = $('#inp'), text = inp.value.trim(); if (st.editing) { inp.value = ''; return finishEdit(text); } if (!text) return; inp.value = '';
  if (st.cur.k === 'b') return send({ t: 'notice', text });
  if (text[0] === '/') return command(text);
  say(text, 'chat');
};
function say(text, kind) {
  const reply = st.reply && kind !== 'me' ? { id: st.reply.id, from: st.reply.from, text: st.reply.text } : undefined; st.reply = null; renderReplyBar();
  if (st.cur.k === 'r') send({ t: 'msg', room: st.cur.id, text, kind, reply: reply && reply.id }); else sendDM(st.cur.id, text, kind, reply);
}
function command(line) {
  const [cmd, ...rest] = line.slice(1).split(' '), arg = rest.join(' ').trim();
  switch (cmd.toLowerCase()) {
    case 'help': ['/help             this list', '/me <action>      action message', '/w <user> <msg>   private message', '/users            who is online', '/admin <code>     admin mode (if enabled)', '/clear            clear this screen (local)', tr('Tip: @name mentions someone. Hover a message to delete your own. Press / to focus the input.')].forEach(l => local(l)); break;
    case 'me': if (arg) say(arg, 'me'); break;
    case 'w': { const [to, ...m] = arg.split(' '); if (!to || !m.length) return local('Usage: /w <user> <message>', true); { const c = canon(to) || to; open('d', c); sendDM(c, m.join(' ')); } break; }
    case 'users': local('Online: ' + st.users.join(', ')); break;
    case 'admin': send({ t: 'admin', code: arg }); break;
    case 'clear': $('#log').replaceChildren(); break;
    default: local('Unknown command. Try /help', true);
  }
}
document.addEventListener('keydown', e => { if (e.key === '/' && !$('#app').hidden && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && !$('#form').hidden && $('#modal').hidden) { e.preventDefault(); $('#inp').focus(); } });

/* ---------- uploads: queued, with speed, ETA, cancel ---------- */
const queue = []; let active = null;
function enqueue(list) {
  [...list].forEach(f => {
    if (f.size > st.maxMB * 1048576) return toast(tr('"{name}" is larger than {n} MB', { name: f.name, n: st.maxMB }), 'bad', 5000);
    if (!f.size) return toast(tr('"{name}" is empty', { name: f.name }), 'bad');
    const card = el('div', 'xfer queued'), nm = el('span', 'nm', f.name), s = el('span', 'st', 'queued'), x = el('button', 'icon-btn'), bar = el('div', 'bar'), fill = el('i'), meta = el('div', 'meta', fmt(f.size));
    x.append(icon('x')); x.setAttribute('aria-label', tr('Cancel upload of {name}', { name: f.name })); x.style.cssText = 'width:30px;height:30px;min-height:0';
    const top = el('div', 'top'); top.append(nm, s, x); bar.append(fill); card.append(top, bar, meta); $('#prog').append(card);
    const t = { f, card, s, fill, meta, x, xhr: null, dead: false };
    x.onclick = () => { t.dead = true; if (t.xhr) t.xhr.abort(); else { card.remove(); const i = queue.indexOf(t); if (i >= 0) queue.splice(i, 1); } };
    queue.push(t);
  });
  pump();
}
function pump() {
  if (active || !queue.length) return;
  const t = active = queue.shift(), { f } = t; t.card.className = 'xfer'; t.s.textContent = 'uploading';
  const x = t.xhr = new XMLHttpRequest(); x.open('POST', '/upload');
  x.setRequestHeader('x-token', st.token); x.setRequestHeader('x-filename', encodeURIComponent(f.name));
  const t0 = performance.now(); let lastT = t0, lastL = 0, speed = 0;
  x.upload.onprogress = e => {
    if (!e.lengthComputable) return; const now = performance.now();
    if (now - lastT > 250) { speed = speed ? speed * .6 + ((e.loaded - lastL) / ((now - lastT) / 1000)) * .4 : (e.loaded - lastL) / ((now - lastT) / 1000); lastT = now; lastL = e.loaded; }
    t.fill.style.width = (e.loaded / e.total * 100) + '%';
    const left = speed > 0 ? Math.ceil((e.total - e.loaded) / speed) : 0;
    t.meta.textContent = `${Math.round(e.loaded / e.total * 100)}% \u00B7 ${fmt(e.loaded)} / ${fmt(e.total)}` + (speed ? ' \u00B7 ' + tr('{speed}/s \u00B7 {left}s left', { speed: fmt(Math.round(speed)), left }) : '');
  };
  const finish = (state, msg) => {
    t.xhr = null; t.card.className = 'xfer ' + (state === 'done' ? 'done' : 'fail'); t.s.textContent = state === 'done' ? 'complete' : state; t.meta.textContent = msg; t.x.replaceChildren(icon('x')); t.x.setAttribute('aria-label', tr('Dismiss')); t.x.onclick = () => t.card.remove();
    if (state === 'done') { t.fill.style.width = '100%'; toast(tr('Uploaded "{name}" ({size})', { name: f.name, size: fmt(f.size) })); setTimeout(() => t.card.remove(), 2500); } else if (state !== 'cancelled') toast(`"${f.name}": ${msg}`, 'bad', 6000); else setTimeout(() => t.card.remove(), 1200);
    active = null; pump();
  };
  x.onload = () => { if (x.status === 200) finish('done', fmt(f.size) + tr(' shared with everyone')); else { let msg = 'upload failed (' + x.status + ')'; try { msg = JSON.parse(x.responseText).error || msg; } catch { /* ignore */ } finish('failed', msg); } };
  x.onerror = () => finish('failed', tr('connection lost during transfer')); x.onabort = () => finish('cancelled', 'cancelled');
  x.send(f);
}
$('#pick').onclick = () => $('#fileIn').click(); $('#attach').onclick = () => $('#fileIn').click();
$('#fileIn').onchange = e => { enqueue(e.target.files); e.target.value = ''; if (document.body.dataset.tab === 'chat' && matchMedia('(max-width:1179px)').matches) setTab('files'); };
const drop = $('#drop'); let dragDepth = 0;
document.addEventListener('dragenter', e => { if ($('#app').hidden) return; e.preventDefault(); dragDepth++; drop.classList.add('over'); });
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; drop.classList.remove('over'); } });
document.addEventListener('drop', e => { e.preventDefault(); dragDepth = 0; drop.classList.remove('over'); if (!$('#app').hidden && e.dataTransfer && e.dataTransfer.files.length) enqueue(e.dataTransfer.files); });
document.addEventListener('paste', e => { const fs = [...(e.clipboardData ? e.clipboardData.files : [])]; if (fs.length && !$('#app').hidden) enqueue(fs); });

/* ---------- gate: sign in / register ---------- */
function setBusy(b) { const g = $('#goBtn'); g.classList.toggle('busy', b); g.disabled = b; }
function setMode(m) {
  st.mode = m; const up = m === 'register';
  $('#tabIn').setAttribute('aria-selected', String(!up)); $('#tabUp').setAttribute('aria-selected', String(up));
  $('#pw2Row').hidden = !up; $('#meter').hidden = !up; $('#loginErr').textContent = '';
  $('#goBtn .lbl').textContent = up ? tr('Create account') : tr('Connect');
  $('#pwIn').autocomplete = up ? 'new-password' : 'current-password';
  $('#gateHint').textContent = up ? tr('Pick a username and a password (8+ characters). Passwords are hashed on the server; there is no reset, so remember it.') : tr('New here? Open the Register tab, pick a username and a password. That name becomes yours.');
}
$('#tabIn').onclick = () => setMode('login'); $('#tabUp').onclick = () => setMode('register');
$('#pwShow').onclick = e => { const p = $('#pwIn'), show = p.type === 'password'; p.type = show ? 'text' : 'password'; e.target.textContent = show ? tr('hide') : tr('show'); e.target.setAttribute('aria-pressed', String(show)); };
$('#pwIn').addEventListener('input', () => { const v = $('#pwIn').value; $('#meter').dataset.s = v.length < 8 ? 0 : 1 + (v.length >= 12) + (/[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v)) + (/[^\w\s]/.test(v) && v.length >= 12); });
fetch('/api/info').then(r => r.json()).then(i => { $('#siteName').textContent = i.name; $('#codeRow').hidden = !i.needCode; document.title = i.name; }).catch(() => { $('#loginErr').textContent = tr('Server unreachable.'); });
$('#loginForm').onsubmit = e => {
  e.preventDefault(); const err = $('#loginErr'); err.textContent = '';
  const name = $('#nameIn').value.trim(), pw = $('#pwIn').value;
  const fail = t => { err.textContent = t; const g = $('.gate'); g.classList.remove('shake'); void g.offsetWidth; g.classList.add('shake'); };
  if (!/^[\p{L}\p{N}_.-]{2,20}$/u.test(name)) return fail(tr('Username: 2-20 letters, digits, _ . or -'));
  if (pw.length < (st.mode === 'register' ? 8 : 4)) return fail(st.mode === 'register' ? tr('Choose a password of at least 8 characters.') : tr('Enter your password.'));
  if (st.mode === 'register' && pw !== $('#pw2In').value) return fail(tr('Passwords do not match.'));
  st.loginName = name; st.loginPw = pw; st.loginCode = $('#codeIn').value; st.loginAdm = $('#admIn').value; st.me = ''; st.token = ''; setBusy(true); connect();
};
$('#outBtn').onclick = async () => { if (await ask({ title: tr('Sign out'), text: tr('You will leave the network. Your account stays.'), ok: tr('Sign out') })) { send({ t: 'bye' }); sessionStorage.removeItem('cn:token'); sessionStorage.removeItem('cn:name'); sessionStorage.removeItem('cn:cur'); st.me = ''; st.token = ''; st.loginPw = ''; try { st.ws.close(); } catch { /* ignore */ } location.reload(); } };
$('#statusSel').onchange = e => send({ t: 'status', status: e.target.value });

/* ---------- tabs, clock ---------- */
function setTab(t) { document.body.dataset.tab = t; document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t)); if (t === 'files') { $('#tbFiles').hidden = true; $('#tbFiles').textContent = ''; } }
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => setTab(b.dataset.t));
const tick = () => { $('#clock').textContent = new Date().toLocaleTimeString([], { hour12: false }); };
tick(); setInterval(tick, 1000); setInterval(() => { if (!$('#app').hidden) renderFiles(); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { delete st.unread[key(st.cur)]; renderRooms(); renderUsers(); tabBadges(); updateTitle(); } });

setTimeout(() => { const h = document.querySelector('.gate .brand h1'); if (h) h.classList.add('glitch'); }, 350);

if (!CN.supported) gateLog(tr('[!] encrypted DMs need HTTPS or localhost'), 'bad');

$('#langBtn').textContent = I18N.lang === 'fa' ? 'English' : '\u0641\u0627\u0631\u0633\u06CC'; $('#langBtn').onclick = () => I18N.setLang(I18N.lang === 'fa' ? 'en' : 'fa');
I18N.applyStatic();
$('#unlockBar').onsubmit = async e => { e.preventDefault(); const i = $('#unlockPw'); if (await doUnlock(i.value)) i.value = ''; else i.select(); };
/* page reload: continue the session with the token kept in this tab, only the encryption key needs the password again */
(function resumeSession() {
  let t = '', n = '';
  try { t = sessionStorage.getItem('cn:token') || ''; n = sessionStorage.getItem('cn:name') || ''; } catch { /* ignore */ }
  if (!t || !n || IS_DEMO) return;
  st.resume = true; st.token = t; st.me = ''; st.loginName = n; st.loginPw = ''; st.mode = 'login'; document.body.classList.add('resuming'); connect();
})();
