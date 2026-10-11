'use strict';
const $ = s => document.querySelector(s);
const el = (t, c, txt) => { const e = document.createElement(t); if (c) e.className = c; if (txt != null) e.textContent = txt; return e; };
const st = { ws: null, me: '', token: sessionStorage.getItem('cn:token') || '', rooms: [], users: [], hist: {}, dms: {}, files: [], cur: { k: 'r', id: 'general' }, unread: {}, admin: false, maxMB: 100, retry: 0, loginName: '', loginCode: '' };
const key = c => c.k + ':' + c.id;
const hhmm = ts => { const d = new Date(ts); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const color = n => { let h = 0; for (const c of n) h = (h * 31 + c.charCodeAt(0)) % 360; return `hsl(${h} 45% 28%)`; };
const fmt = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
const ago = ts => { const s = (Date.now() - ts) / 1000; return s < 60 ? 'now' : s < 3600 ? Math.floor(s / 60) + 'm' : s < 86400 ? Math.floor(s / 3600) + 'h' : Math.floor(s / 86400) + 'd'; };

let actx;
function beep() { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = 660; g.gain.value = 0.04; o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + 0.08); } catch { /* ignore */ } }

/* ---------- connection ---------- */
function connect() {
  const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  st.ws = ws;
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join', name: st.me || st.loginName, code: st.loginCode, token: st.token }));
  ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } handle(m); };
  ws.onclose = () => {
    if (st.ws !== ws) return;
    if (!st.me) return;
    setStat('reconnecting', false); st.retry++;
    setTimeout(connect, Math.min(1000 * st.retry, 5000));
  };
}
function setStat(t, ok) { const s = $('#stat'); s.textContent = t; s.className = ok ? 'ok' : 'bad'; }
function send(o) { if (st.ws && st.ws.readyState === 1) st.ws.send(JSON.stringify(o)); }

function handle(m) {
  switch (m.t) {
    case 'welcome':
      st.me = m.me; st.token = m.token; sessionStorage.setItem('cn:token', m.token); st.admin = m.admin; st.retry = 0;
      st.rooms = m.rooms; st.hist = m.hist; st.dms = m.dms; st.users = m.users; st.files = m.files; st.maxMB = m.maxMB;
      $('#login').hidden = true; $('#app').hidden = false;
      $('#siteBar').textContent = m.site; document.title = m.site; $('#meBar').textContent = 'user: ' + m.me;
      $('#limit').textContent = 'max ' + m.maxMB + ' MB per file';
      setStat('online', true); renderAll(); $('#inp').focus(); break;
    case 'users': st.users = m.users; renderUsers(); break;
    case 'files': st.files = m.files; renderFiles(); break;
    case 'msg': (st.hist[m.m.room] = st.hist[m.m.room] || []).push(m.m); incoming('r:' + m.m.room, m.m, m.m.from); break;
    case 'dm': { const other = m.m.from === st.me ? m.m.to : m.m.from; (st.dms[other] = st.dms[other] || []).push(m.m); incoming('d:' + other, m.m, m.m.from); if (m.m.from !== st.me && (document.hidden || key(st.cur) !== 'd:' + other)) beep(); break; }
    case 'admin': local('Admin mode on: you can delete any file.'); st.admin = true; renderFiles(); break;
    case 'err':
      if (m.fatal) { $('#loginErr').textContent = m.text; st.me = ''; try { st.ws.close(); } catch { /* ignore */ } }
      else local(m.text, true);
      break;
  }
}
function incoming(k, msg, from) {
  if (key(st.cur) === k) { if (nearBottom()) { addRow(msg); scrollEnd(); } else addRow(msg); }
  else if (from !== st.me && msg.kind !== 'sys') { st.unread[k] = (st.unread[k] || 0) + 1; renderRooms(); renderUsers(); }
  updateTitle();
}
function updateTitle() { const n = Object.values(st.unread).reduce((a, b) => a + b, 0); document.title = (n ? `(${n}) ` : '') + $('#siteBar').textContent; }

/* ---------- rendering ---------- */
const nearBottom = () => { const l = $('#log'); return l.scrollHeight - l.scrollTop - l.clientHeight < 80; };
const scrollEnd = () => { const l = $('#log'); l.scrollTop = l.scrollHeight; };
function addRow(m, cls) {
  const r = el('div', 'row' + (m.kind === 'sys' ? ' sys' : '') + (cls ? ' ' + cls : '') + (m.to ? ' dm' : ''));
  r.append(el('span', 't', hhmm(m.ts || Date.now())));
  if (m.kind === 'sys') r.append(el('span', null, m.text));
  else if (m.kind === 'me') r.append(el('span', null, '* ' + m.from + ' ' + m.text));
  else { const w = el('span', 'w', m.from); w.style.color = color(m.from); r.append(w, el('span', null, m.text)); }
  $('#log').append(r);
}
function local(text, bad) { addRow({ kind: 'sys', text, ts: Date.now() }, bad ? '' : 'local'); scrollEnd(); }
function renderLog() {
  const log = $('#log'); log.replaceChildren();
  const list = st.cur.k === 'r' ? (st.hist[st.cur.id] || []) : (st.dms[st.cur.id] || []);
  list.forEach(m => addRow(m)); scrollEnd();
  $('#convTitle').textContent = st.cur.k === 'r' ? '#' + st.cur.id : 'private chat with ' + st.cur.id;
}
function renderRooms() {
  const ul = $('#rooms'); ul.replaceChildren();
  st.rooms.forEach(r => {
    const li = el('li', key(st.cur) === 'r:' + r ? 'on' : ''); li.append(el('span', 'n', '#' + r));
    const u = st.unread['r:' + r]; if (u) li.append(el('span', 'badge', u));
    li.onclick = () => open('r', r); ul.append(li);
  });
}
function renderUsers() {
  const ul = $('#users'); ul.replaceChildren(); $('#ucount').textContent = '(' + st.users.length + ')';
  const names = new Set(st.users); Object.keys(st.dms).forEach(n => names.add(n));
  [...names].sort((a, b) => (st.users.includes(b) - st.users.includes(a)) || a.localeCompare(b)).forEach(n => {
    const live = st.users.includes(n), li = el('li', (key(st.cur) === 'd:' + n ? 'on ' : '') + (n === st.me ? 'me' : ''));
    li.append(el('span', null, live ? '\u25CF' : '\u25CB'), el('span', 'n', n + (n === st.me ? ' (you)' : '')));
    const u = st.unread['d:' + n]; if (u) li.append(el('span', 'badge', u));
    if (n !== st.me) li.onclick = () => open('d', n);
    ul.append(li);
  });
}
function renderFiles() {
  const ul = $('#files'); ul.replaceChildren();
  if (!st.files.length) ul.append(el('li', 'dim', 'No files yet.'));
  st.files.forEach(f => {
    const li = el('li'); li.append(el('span', 'fn', f.name));
    li.append(el('span', 'meta', `${fmt(f.size)} \u00B7 ${f.owner} \u00B7 ${ago(f.ts)}`));
    const a = el('a', null, 'download'); a.href = `/f/${f.id}?t=${encodeURIComponent(st.token)}`; a.rel = 'noopener'; li.append(a);
    if (f.owner === st.me || st.admin) { const d = el('button', null, 'delete'); d.onclick = () => { if (confirm(`Delete "${f.name}"?`)) send({ t: 'delfile', id: f.id }); }; li.append(d); }
    ul.append(li);
  });
}
function renderAll() { renderRooms(); renderUsers(); renderFiles(); renderLog(); }
function open(k, id) { st.cur = { k, id }; delete st.unread[key(st.cur)]; renderAll(); updateTitle(); document.body.dataset.tab = 'chat'; syncTabs(); $('#inp').focus(); }

/* ---------- input & commands ---------- */
$('#form').onsubmit = e => {
  e.preventDefault();
  const inp = $('#inp'); let text = inp.value.trim(); if (!text) return; inp.value = '';
  if (text[0] === '/') return command(text);
  say(text, 'chat');
};
function say(text, kind) {
  if (st.cur.k === 'r') send({ t: 'msg', room: st.cur.id, text, kind });
  else send({ t: 'dm', to: st.cur.id, text, kind });
}
function command(line) {
  const [cmd, ...rest] = line.slice(1).split(' '), arg = rest.join(' ').trim();
  switch (cmd.toLowerCase()) {
    case 'help': ['/help          this list', '/me <action>   action message', '/w <user> <msg>  private message', '/users         who is online', '/admin <code>  admin mode (if enabled)', '/clear         clear this screen (local)'].forEach(l => local(l)); break;
    case 'me': if (arg) say(arg, 'me'); break;
    case 'w': { const [to, ...m] = arg.split(' '); if (!to || !m.length) return local('Usage: /w <user> <message>', true); open('d', to); send({ t: 'dm', to, text: m.join(' ') }); break; }
    case 'users': local('Online: ' + st.users.join(', ')); break;
    case 'admin': send({ t: 'admin', code: arg }); break;
    case 'clear': $('#log').replaceChildren(); break;
    default: local('Unknown command. Try /help', true);
  }
}

/* ---------- uploads ---------- */
const queue = []; let busy = false;
function enqueue(list) { [...list].forEach(f => { if (f.size > st.maxMB * 1048576) local(`"${f.name}" is bigger than ${st.maxMB} MB.`, true); else queue.push(f); }); next(); }
function next() {
  if (busy || !queue.length) return; busy = true;
  const f = queue.shift(), p = el('div', 'p'), bar = el('div', 'bar'), fill = el('i'), label = el('div', null, f.name);
  bar.append(fill); p.append(label, bar); $('#prog').append(p);
  const x = new XMLHttpRequest(); x.open('POST', '/upload');
  x.setRequestHeader('x-token', st.token); x.setRequestHeader('x-filename', encodeURIComponent(f.name));
  x.upload.onprogress = e => { if (e.lengthComputable) fill.style.width = (e.loaded / e.total * 100) + '%'; };
  const done = ok => { if (!ok) { let msg = 'upload failed'; try { msg = JSON.parse(x.responseText).error || msg; } catch { /* ignore */ } local(`"${f.name}": ${msg}`, true); } p.remove(); busy = false; next(); };
  x.onload = () => done(x.status === 200); x.onerror = () => done(false);
  x.send(f);
}
$('#pick').onclick = () => $('#fileIn').click();
$('#fileIn').onchange = e => { enqueue(e.target.files); e.target.value = ''; };
const drop = $('#drop');
['dragenter', 'dragover'].forEach(ev => document.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => document.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
document.addEventListener('drop', e => { if (e.dataTransfer && e.dataTransfer.files.length) enqueue(e.dataTransfer.files); });

/* ---------- login, tabs, clock ---------- */
fetch('/api/info').then(r => r.json()).then(i => { $('#siteName').textContent = i.name; $('#codeRow').hidden = !i.needCode; document.title = i.name; }).catch(() => {});
$('#loginForm').onsubmit = e => {
  e.preventDefault(); $('#loginErr').textContent = '';
  st.loginName = $('#nameIn').value.trim(); st.loginCode = $('#codeIn').value; st.me = ''; st.token = '';
  connect();
};
function syncTabs() { document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === document.body.dataset.tab || (b.dataset.t === 'chat' && document.body.dataset.tab === 'chat'))); }
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => { document.body.dataset.tab = b.dataset.t; syncTabs(); });
const tick = () => { const d = new Date(); $('#clock').textContent = d.toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short' }) + '  ' + hhmm(d); };
tick(); setInterval(tick, 20000); setInterval(() => { if (!$('#app').hidden) renderFiles(); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { delete st.unread[key(st.cur)]; renderRooms(); renderUsers(); updateTitle(); } });
