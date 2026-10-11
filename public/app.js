'use strict';
const $ = s => document.querySelector(s);
const el = (t, c, txt) => { const e = document.createElement(t); if (c) e.className = c; if (txt != null) e.textContent = txt; return e; };
const st = { ws: null, me: '', token: sessionStorage.getItem('cn:token') || '', rooms: [], users: [], status: {}, all: [], hist: {}, dms: {}, notices: [], files: [], cur: { k: 'r', id: 'general' }, unread: {}, typing: {}, admin: false, maxMB: 100, retry: 0, loginName: '', loginPw: '', loginCode: '' };
const key = c => c.k + ':' + c.id;
const hhmm = ts => { const d = new Date(ts); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const color = n => { let h = 0; for (const c of n) h = (h * 31 + c.charCodeAt(0)) % 360; return `hsl(${h} 50% 45%)`; };
const fmt = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
const ago = ts => { const s = (Date.now() - ts) / 1000; return s < 60 ? 'now' : s < 3600 ? Math.floor(s / 60) + 'm' : s < 86400 ? Math.floor(s / 3600) + 'h' : Math.floor(s / 86400) + 'd'; };
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

let actx;
function beep(f = 660) { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = f; g.gain.value = 0.04; o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + 0.08); } catch { /* ignore */ } }

/* ---------- rich text: safe links and @mentions (DOM nodes only, never innerHTML) ---------- */
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

/* ---------- connection ---------- */
function connect() {
  const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  st.ws = ws;
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join', name: st.me || st.loginName, password: st.loginPw, code: st.loginCode, token: st.token }));
  ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } handle(m); };
  ws.onclose = () => { if (st.ws !== ws || !st.me) return; setStat('reconnecting', false); st.retry++; setTimeout(connect, Math.min(1000 * st.retry, 5000)); };
}
function setStat(t, ok) { const s = $('#stat'); s.textContent = t; s.className = ok ? 'ok' : 'bad'; }
function send(o) { if (st.ws && st.ws.readyState === 1) st.ws.send(JSON.stringify(o)); }
function setUsers(list, all) { st.users = list.map(u => u.n); st.status = {}; list.forEach(u => { st.status[u.n] = u.s; }); if (all) st.all = all; }

function handle(m) {
  switch (m.t) {
    case 'welcome': {
      const first = !st.me;
      st.me = m.me; st.token = m.token; sessionStorage.setItem('cn:token', m.token); st.admin = m.admin; st.retry = 0;
      st.rooms = m.rooms; st.hist = m.hist; st.dms = m.dms; st.notices = m.notices || []; st.files = m.files; st.maxMB = m.maxMB; setUsers(m.users, m.all);
      $('#login').hidden = true; $('#app').hidden = false;
      $('#siteBar').textContent = m.site; document.title = m.site; $('#meBar').textContent = m.me + (m.admin ? ' (admin)' : '');
      $('#limit').textContent = 'max ' + m.maxMB + ' MB per file';
      setStat('online', true); renderAll(); $('#inp').focus();
      if (first) local('Welcome, ' + m.me + '. Type /help for commands.');
      break;
    }
    case 'users': setUsers(m.users, m.all); renderUsers(); break;
    case 'files': st.files = m.files; renderFiles(); break;
    case 'notices': { const more = m.notices.length > st.notices.length; st.notices = m.notices; if (st.cur.k === 'b') renderLog(); else if (more) { st.unread['b:board'] = (st.unread['b:board'] || 0) + 1; renderRooms(); } break; }
    case 'msg': (st.hist[m.m.room] = st.hist[m.m.room] || []).push(m.m); clearTyping('r:' + m.m.room, m.m.from); incoming('r:' + m.m.room, m.m, m.m.from); break;
    case 'delmsg': { const a = st.hist[m.room]; if (a) { const i = a.findIndex(x => x.id === m.id); if (i >= 0) a.splice(i, 1); } const row = document.querySelector(`.row[data-id="${m.id}"]`); if (row) row.remove(); break; }
    case 'dm': { const other = m.m.from === st.me ? m.m.to : m.m.from; (st.dms[other] = st.dms[other] || []).push(m.m); clearTyping('d:' + other, m.m.from); incoming('d:' + other, m.m, m.m.from); if (m.m.from !== st.me && (document.hidden || key(st.cur) !== 'd:' + other)) beep(); break; }
    case 'typing': { const k = m.room ? 'r:' + m.room : 'd:' + m.from; (st.typing[k] = st.typing[k] || {})[m.from] = Date.now() + 4000; showTyping(); break; }
    case 'admin': st.admin = true; $('#meBar').textContent = st.me + ' (admin)'; local('Admin mode on.'); renderFiles(); if (st.cur.k === 'b') renderLog(); break;
    case 'err':
      if (m.fatal) { $('#loginErr').textContent = m.text; st.me = ''; try { st.ws.close(); } catch { /* ignore */ } }
      else local(m.text, true);
      break;
  }
}
function incoming(k, msg, from) {
  const mention = msg.kind !== 'sys' && from !== st.me && new RegExp('@' + st.me.replace(/\./g, '\\.') + '(?![\\p{L}\\p{N}_.-])', 'iu').test(msg.text || '');
  if (key(st.cur) === k) { const stick = nearBottom(); addRow(msg); if (stick) scrollEnd(); }
  else if (from !== st.me && msg.kind !== 'sys') { st.unread[k] = (st.unread[k] || 0) + 1; renderRooms(); renderUsers(); }
  if (mention && (document.hidden || key(st.cur) !== k)) beep(880);
  updateTitle();
}
function updateTitle() { const n = Object.values(st.unread).reduce((a, b) => a + b, 0); document.title = (n ? `(${n}) ` : '') + $('#siteBar').textContent; }

/* ---------- typing indicator ---------- */
function clearTyping(k, name) { if (st.typing[k]) delete st.typing[k][name]; showTyping(); }
function showTyping() {
  const t = st.typing[key(st.cur)] || {}, now = Date.now();
  const names = Object.keys(t).filter(n => t[n] > now);
  $('#typing').textContent = names.length ? names.join(', ') + (names.length > 1 ? ' are' : ' is') + ' typing...' : '';
}
setInterval(showTyping, 1000);
let lastTyp = 0;
$('#inp').addEventListener('input', () => {
  if (Date.now() - lastTyp < 2500 || st.cur.k === 'b') return; lastTyp = Date.now();
  send(st.cur.k === 'r' ? { t: 'typing', room: st.cur.id } : { t: 'typing', to: st.cur.id });
});

/* ---------- rendering ---------- */
const nearBottom = () => { const l = $('#log'); return l.scrollHeight - l.scrollTop - l.clientHeight < 80; };
const scrollEnd = () => { const l = $('#log'); l.scrollTop = l.scrollHeight; };
function addRow(m, cls) {
  const r = el('div', 'row' + (m.kind === 'sys' ? ' sys' : '') + (cls ? ' ' + cls : '') + (m.to ? ' dm' : '')); if (m.id) r.dataset.id = m.id;
  r.append(el('span', 't', hhmm(m.ts || Date.now())));
  if (m.kind === 'sys') r.append(el('span', null, m.text));
  else {
    const { frag, mention } = rich(m.text); const body = el('span'); body.append(frag);
    if (mention && m.from !== st.me) r.classList.add('mention');
    if (m.kind === 'me') { const w = el('span', null, '* ' + m.from + ' '); r.append(w, body); }
    else { const w = el('span', 'w', m.from); w.style.color = color(m.from); r.append(w, body); }
    if (m.room && (m.from === st.me || st.admin)) { const x = el('button', 'x', '\u00D7'); x.title = 'Delete message'; x.onclick = () => send({ t: 'delmsg', room: m.room, id: m.id }); r.append(x); }
  }
  $('#log').append(r);
  applyFind(r);
}
function local(text, bad) { addRow({ kind: 'sys', text, ts: Date.now() }, bad ? '' : 'local'); scrollEnd(); }
function renderLog() {
  const log = $('#log'); log.replaceChildren();
  const board = st.cur.k === 'b';
  $('#form').hidden = board && !st.admin; $('#inp').placeholder = board ? 'Post a notice for everyone' : 'Message, or /help';
  if (board) {
    $('#convTitle').textContent = 'Notice board' + (st.admin ? '' : ' (read only)');
    if (!st.notices.length) log.append(el('div', 'empty', 'No notices yet.'));
    st.notices.forEach(n => {
      const c = el('div', 'card'), by = el('div', 'by', `${n.by} \u00B7 ${new Date(n.ts).toLocaleString()}`), p = el('p'); p.append(rich(n.text).frag);
      if (st.admin) { const d = el('button', null, 'remove'); d.onclick = () => send({ t: 'delnotice', id: n.id }); by.append(d); }
      c.append(by, p); log.append(c);
    });
    return;
  }
  const list = st.cur.k === 'r' ? (st.hist[st.cur.id] || []) : (st.dms[st.cur.id] || []);
  list.forEach(m => addRow(m)); scrollEnd();
  $('#convTitle').textContent = st.cur.k === 'r' ? '#' + st.cur.id : 'private chat with ' + st.cur.id;
  showTyping();
}
function applyFind(row) { const q = $('#find').value.trim().toLowerCase(); (row ? [row] : document.querySelectorAll('#log .row')).forEach(r => { r.hidden = !!q && !r.textContent.toLowerCase().includes(q); }); }
$('#find').addEventListener('input', () => applyFind());
function liItem(on, extra, name, badge, fn) {
  const li = el('li', on ? 'on' : ''); if (extra) li.append(extra); li.append(el('span', 'n', name)); if (badge) li.append(el('span', 'badge', badge)); li.onclick = fn; return li;
}
function renderRooms() {
  const ul = $('#rooms'); ul.replaceChildren();
  ul.append(liItem(st.cur.k === 'b', el('span', 'sd', '\u25A4'), 'Notice board', st.unread['b:board'], () => open('b', 'board')));
  st.rooms.forEach(r => ul.append(liItem(key(st.cur) === 'r:' + r, el('span', 'sd', '#'), r, st.unread['r:' + r], () => open('r', r))));
}
function renderUsers() {
  const ul = $('#users'); ul.replaceChildren(); $('#ucount').textContent = '(' + st.users.length + ' online)';
  const names = new Set([...st.users, ...st.all, ...Object.keys(st.dms)]);
  [...names].sort((a, b) => (st.users.includes(b) - st.users.includes(a)) || a.localeCompare(b)).forEach(n => {
    const live = st.users.includes(n), s = live ? (st.status[n] || 'online') : 'off';
    const li = liItem(key(st.cur) === 'd:' + n, el('span', 'sd ' + s, live ? '\u25CF' : '\u25CB'), n + (n === st.me ? ' (you)' : '') + (live && s !== 'online' ? ' [' + s + ']' : ''), st.unread['d:' + n], () => open('d', n));
    if (!live) li.classList.add('off'); if (n === st.me) { li.classList.add('me'); li.onclick = null; }
    ul.append(li);
  });
}
function renderFiles() {
  const ul = $('#files'); ul.replaceChildren(); const q = $('#ffind').value.trim().toLowerCase();
  const list = st.files.filter(f => !q || f.name.toLowerCase().includes(q));
  if (!list.length) ul.append(el('li', 'dim', st.files.length ? 'No match.' : 'No files yet.'));
  list.forEach(f => {
    const li = el('li'), url = `/f/${f.id}?t=${encodeURIComponent(st.token)}`;
    li.append(el('span', 'fn', f.name));
    if (f.img) { const w = el('a', 'th'), i = el('img'); i.loading = 'lazy'; i.alt = f.name; i.src = url + '&inline=1'; w.href = url + '&inline=1'; w.target = '_blank'; w.rel = 'noopener'; w.append(i); li.append(w); }
    li.append(el('span', 'meta', `${fmt(f.size)} \u00B7 ${f.owner} \u00B7 ${ago(f.ts)}`));
    const a = el('a', null, 'download'); a.href = url; a.rel = 'noopener'; li.append(a);
    if (f.owner === st.me || st.admin) { const d = el('button', null, 'delete'); d.onclick = () => { if (confirm(`Delete "${f.name}"?`)) send({ t: 'delfile', id: f.id }); }; li.append(d); }
    ul.append(li);
  });
}
$('#ffind').addEventListener('input', renderFiles);
function renderAll() { renderRooms(); renderUsers(); renderFiles(); renderLog(); }
function open(k, id) { st.cur = { k, id }; delete st.unread[k === 'b' ? 'b:board' : key(st.cur)]; $('#find').value = ''; renderAll(); updateTitle(); document.body.dataset.tab = 'chat'; syncTabs(); if (!$('#form').hidden) $('#inp').focus(); }

/* ---------- input & commands ---------- */
$('#form').onsubmit = e => {
  e.preventDefault();
  const inp = $('#inp'); const text = inp.value.trim(); if (!text) return; inp.value = '';
  if (st.cur.k === 'b') return send({ t: 'notice', text });
  if (text[0] === '/') return command(text);
  say(text, 'chat');
};
function say(text, kind) { send(st.cur.k === 'r' ? { t: 'msg', room: st.cur.id, text, kind } : { t: 'dm', to: st.cur.id, text, kind }); }
function command(line) {
  const [cmd, ...rest] = line.slice(1).split(' '), arg = rest.join(' ').trim();
  switch (cmd.toLowerCase()) {
    case 'help': ['/help             this list', '/me <action>      action message', '/w <user> <msg>   private message', '/users            who is online', '/admin <code>     admin mode (if enabled)', '/clear            clear this screen (local)', 'Tip: @name mentions someone. Hover a message to delete your own.'].forEach(l => local(l)); break;
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
document.addEventListener('paste', e => { const fs = [...(e.clipboardData ? e.clipboardData.files : [])]; if (fs.length && !$('#app').hidden) enqueue(fs); });

/* ---------- login, theme, status, tabs, clock ---------- */
fetch('/api/info').then(r => r.json()).then(i => { $('#siteName').textContent = i.name; $('#codeRow').hidden = !i.needCode; document.title = i.name; }).catch(() => {});
$('#loginForm').onsubmit = e => {
  e.preventDefault(); $('#loginErr').textContent = '';
  st.loginName = $('#nameIn').value.trim(); st.loginPw = $('#pwIn').value; st.loginCode = $('#codeIn').value; st.me = ''; st.token = '';
  connect();
};
$('#outBtn').onclick = () => { send({ t: 'bye' }); sessionStorage.removeItem('cn:token'); st.me = ''; st.token = ''; st.loginPw = ''; try { st.ws.close(); } catch { /* ignore */ } location.reload(); };
$('#statusSel').onchange = e => send({ t: 'status', status: e.target.value });
$('#themeBtn').onclick = () => { const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = t; try { localStorage.setItem('cn:theme', t); } catch { /* ignore */ } };
function syncTabs() { document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === document.body.dataset.tab)); }
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => { document.body.dataset.tab = b.dataset.t; syncTabs(); });
const tick = () => { const d = new Date(); $('#clock').textContent = d.toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short' }) + '  ' + hhmm(d); };
tick(); setInterval(tick, 20000); setInterval(() => { if (!$('#app').hidden) renderFiles(); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { delete st.unread[key(st.cur)]; renderRooms(); renderUsers(); updateTitle(); } });
