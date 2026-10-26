'use strict';
/* Desktop shell (>= 1180px): menubar, app launcher, movable/resizable windows and a dock.
   Below that width the existing tabbed layout is used and extra apps open full screen.
   Shares globals with app.js (st, E2E, $, el, icon, send, open, setTab, toast, ask, prefs ...). */
(function () {
  const mq = matchMedia('(min-width:1180px)'), LS = 'cn:wm', desk = $('#desk');
  const os = () => document.body.classList.contains('os');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const APPS = {
    home: { title: tr('Home'), ic: 'home', cat: 'Core', w: 640, h: 560, build: b => Home.build(b) },
    chat: { title: tr('Messages'), ic: 'chat', cat: 'Core', sel: '#center', tab: 'chat' },
    board: { title: tr('Board'), ic: 'board', cat: 'Core', alias: 'chat' },
    terminal: { title: tr('Terminal'), ic: 'term', cat: 'Core', w: 560, h: 340, build: buildTerminal },
    nodes: { title: tr('Network'), ic: 'nodes', cat: 'Network', sel: '#pNodes', tab: 'rooms' },
    files: { title: tr('Files'), ic: 'files', cat: 'Network', sel: '#right', tab: 'files' },
    groups: { title: tr('Groups'), ic: 'chat', cat: 'Network', w: 480, h: 540, build: b => Social.groups(b) },
    music: { title: tr('Music'), ic: 'music', cat: 'Core', w: 460, h: 560, build: b => Music.build(b) },
    people: { title: tr('People'), ic: 'nodes', cat: 'Network', w: 460, h: 520, build: b => Social.people(b) },
    feed: { title: tr('Feed'), ic: 'board', cat: 'Network', w: 460, h: 520, build: b => Social.feed(b) },
    alerts: { title: tr('Alerts'), ic: 'radar', cat: 'Network', w: 420, h: 420, build: b => Social.alerts(b) },
    admin: { title: tr('Admin'), ic: 'shield', cat: 'System', w: 580, h: 560, admin: true, build: b => Admin.build(b) },
    monitor: { title: tr('Monitor'), ic: 'monitor', cat: 'System', w: 460, h: 400, build: buildMonitor },
    security: { title: tr('Security'), ic: 'shield', cat: 'System', w: 540, h: 460, build: buildSecurity },
    settings: { title: tr('Settings'), ic: 'gear', cat: 'System', w: 440, h: 420, build: buildSettings }
  };
  const wins = {}; let sized = false, zTop = 20, focusId = '', term = null, saveT = 0;

  /* ---------- geometry ---------- */
  function defaults() {
    const W = desk.clientWidth || 1200, H = desk.clientHeight || 700, L = 244, g = 16;
    const d = {
      home: { x: L + 12, y: 16, w: clamp(Math.round(W * .52), 520, 720), h: clamp(H - 40, 420, 640) },
      chat: { x: L + 20, y: 28, w: clamp(Math.round(W * .5), 560, 780), h: clamp(H - 80, 380, 620) },
      nodes: { x: L + 70, y: 56, w: 560, h: clamp(H - 130, 340, 520) },
      files: { x: Math.max(L + 40, W - 420 - g), y: 40, w: 400, h: clamp(H - 100, 380, 580) }
    };
    let n = 0; ['terminal', 'monitor', 'security', 'settings'].forEach(id => { d[id] = { x: L + 90 + n * 34, y: 70 + n * 34, w: APPS[id].w, h: APPS[id].h }; n++; });
    return d;
  }
  function save() { clearTimeout(saveT); saveT = setTimeout(() => { try { const o = {}; Object.entries(wins).forEach(([id, w]) => { o[id] = { x: w.x, y: w.y, w: w.w, h: w.h, open: w.open, min: w.min, max: w.max }; }); localStorage.setItem(LS, JSON.stringify(o)); } catch { /* ignore */ } }, 300); }
  function apply(id) {
    const w = wins[id], n = w.node, on = os();
    n.classList.toggle('wclosed', on ? !w.open : (!w.base && !w.open));
    n.classList.toggle('wmin', on && w.open && w.min);
    n.classList.toggle('wmax', on && w.max);
    n.classList.toggle('ov', !on && !w.base && w.open);
    if (on) { n.style.left = w.x + 'px'; n.style.top = w.y + 'px'; n.style.width = w.w + 'px'; n.style.height = w.h + 'px'; }
    else { n.style.left = n.style.top = n.style.width = n.style.height = n.style.zIndex = ''; }
  }
  function focus(id) {
    if (!wins[id]) return; focusId = id; if (os()) { if (zTop > 900) { Object.values(wins).forEach((w, i) => { w.z = 20 + i; w.node.style.zIndex = w.z; }); zTop = 20 + Object.keys(wins).length; } wins[id].z = ++zTop; wins[id].node.style.zIndex = zTop; }
    Object.entries(wins).forEach(([k, w]) => w.node.classList.toggle('focus', k === id)); renderDock(); renderLauncher();
  }

  /* ---------- window chrome ---------- */
  function chrome(id) {
    const w = wins[id], ph = w.node.querySelector('.ph'), c = el('span', 'wc');
    [['min', '\u2013', 'Minimize', () => minimize(id)], ['max', '\u25A1', 'Maximize', () => toggleMax(id)], ['x', '\u00D7', 'Close', () => close(id)]].forEach(([k, t, l, fn]) => {
      const b = el('button', 'wb ' + k, t); b.type = 'button'; b.setAttribute('aria-label', l + ' ' + w.title); b.onclick = e => { e.stopPropagation(); fn(); }; c.append(b);
    });
    ph.append(c); const rz = el('div', 'rz'); rz.setAttribute('aria-hidden', 'true'); w.node.append(rz);
    w.node.addEventListener('pointerdown', () => focus(id), true);
    ph.addEventListener('dblclick', e => { if (os() && !e.target.closest('button,input,select')) toggleMax(id); });
    ph.addEventListener('pointerdown', e => {
      if (!os() || w.max || e.target.closest('button,input,select')) return;
      const sx = e.clientX - w.x, sy = e.clientY - w.y; ph.setPointerCapture(e.pointerId); w.node.classList.add('drag');
      const mv = ev => { w.x = clamp(ev.clientX - sx, 120 - w.w, desk.clientWidth - 120); w.y = clamp(ev.clientY - sy, 0, desk.clientHeight - 36); apply(id); };
      const up = () => { ph.removeEventListener('pointermove', mv); ph.removeEventListener('pointerup', up); w.node.classList.remove('drag'); save(); };
      ph.addEventListener('pointermove', mv); ph.addEventListener('pointerup', up);
    });
    rz.addEventListener('pointerdown', e => {
      if (!os()) return; e.preventDefault(); e.stopPropagation(); focus(id); rz.setPointerCapture(e.pointerId);
      const sx = e.clientX, sy = e.clientY, ow = w.w, oh = w.h;
      const mv = ev => { w.w = clamp(ow + ev.clientX - sx, 260, desk.clientWidth - w.x + 200); w.h = clamp(oh + ev.clientY - sy, 160, desk.clientHeight - w.y + 100); apply(id); };
      const up = () => { rz.removeEventListener('pointermove', mv); rz.removeEventListener('pointerup', up); save(); };
      rz.addEventListener('pointermove', mv); rz.addEventListener('pointerup', up);
    });
  }
  function register(id) {
    const a = APPS[id]; let node;
    if (a.sel) node = $(a.sel);
    else { node = el('section', 'panel app-win wclosed'); node.setAttribute('role', 'dialog'); node.setAttribute('aria-label', a.title); node.append(el('h2', 'ph')); node.firstChild.append(el('span', null, a.title)); node.append(el('div', 'wbody')); desk.append(node); }
    wins[id] = { id, node, title: a.title, base: !!a.sel, open: false, min: false, max: false, built: !!a.sel, x: 0, y: 0, w: 400, h: 300, z: 20 };
    chrome(id);
  }

  /* ---------- window actions ---------- */
  function ensure(id) { const w = wins[id]; if (!w.built) { w.built = true; APPS[id].build(w.node.querySelector('.wbody')); } }
  function launch(id) {
    const a = APPS[id]; closeLauncher();
    if (a.alias) { if (id === 'board') { open('b', 'board'); } return launch(a.alias); }
    const w = wins[id];
    if (!os()) {
      if (w.base) { if (a.tab) { setTab(a.tab); } return; }
      ensure(id); w.open = true; apply(id); emitUI('state'); return;
    }
    ensure(id); if (!w.open && !w.placed) placeNew(w); w.open = true; w.min = false; apply(id); focus(id); save(); emitUI('state');
    if (id === 'terminal' && term) term.focus();
  }
  function placeNew(w) { const k = Object.values(wins).filter(x => x !== w && x.open && !x.min).length; w.x += k * 28; w.y += k * 28; fit(w); w.placed = true; }
  function close(id) { const w = wins[id]; if (!os() && w.base) return; w.open = false; w.min = false; apply(id); renderDock(); renderLauncher(); save(); }
  function minimize(id) { wins[id].min = true; apply(id); const next = Object.values(wins).filter(w => w.open && !w.min).sort((a, b) => b.z - a.z)[0]; if (next) focus(next.id); else renderDock(); save(); }
  function toggleMax(id) { const w = wins[id]; w.max = !w.max; apply(id); focus(id); save(); }
  function tile() {
    const d = defaults(); let k = 0;
    Object.entries(wins).forEach(([id, w]) => { Object.assign(w, d[id], { min: false, max: false }); if (w.open) { w.x += k * 28; w.y += k * 28; k++; fit(w); } w.placed = true; apply(id); });
    save();
  }
  function closeAll() { Object.keys(wins).forEach(id => { wins[id].open = false; apply(id); }); renderDock(); renderLauncher(); save(); }
  function restore() {
    const d = defaults(); let saved = {}; try { saved = JSON.parse(localStorage.getItem(LS)) || {}; } catch { /* ignore */ }
    sized = desk.clientWidth > 0;
    Object.entries(wins).forEach(([id, w]) => { const s = saved[id], g = d[id]; Object.assign(w, g); if (s) { Object.assign(w, { x: s.x, y: s.y, w: s.w, h: s.h, max: !!s.max, min: !!s.min }); w.open = !!s.open; w.placed = true; } else { w.open = false; } fit(w); if (w.open && !w.built) ensure(id); });
    if (os() && !Object.values(wins).some(w => w.open)) { wins.home.open = true; wins.home.placed = true; ensure('home'); }   // first start: begin on the Home page
  }
  function fit(w) { const W = desk.clientWidth, H = desk.clientHeight; w.w = clamp(w.w, 260, Math.max(260, W)); w.h = clamp(w.h, 160, Math.max(160, H)); w.x = clamp(w.x, 120 - w.w, Math.max(0, W - 120)); w.y = clamp(w.y, 0, Math.max(0, H - 36)); }

  /* ---------- launcher, dock, menubar ---------- */
  let launcherOpen = false;
  function closeLauncher() { launcherOpen = false; $('#launcher').classList.remove('ov'); renderLauncher(); }
  let adminSeen = false; document.addEventListener('cn:state', () => { if (!!st.admin !== adminSeen) { adminSeen = !!st.admin; renderLauncher(); } });
  function renderLauncher() {
    const box = $('#launcher'); box.replaceChildren();
    if (box.classList.contains('ov')) { box.append(el('h3', null, tr('Apps'))); const x = el('button', 'icon-btn ov-close'); x.append(icon('x')); x.setAttribute('aria-label', tr('Close apps')); x.onclick = closeLauncher; box.append(x); }
    ['Core', 'Network', 'System'].forEach(cat => {
      box.append(el('div', 'cat', '[ ' + tr(cat) + ' ]')); const row = el('div', 'tiles');
      Object.entries(APPS).filter(([, a]) => a.cat === cat && (!a.admin || st.admin)).forEach(([id, a]) => {
        const real = a.alias || id, w = wins[real], t = el('button', 'tile' + (w && w.open && os() && !w.min ? ' run' : '')); t.type = 'button';
        const ico = el('span', 'ico'); ico.append(icon(a.ic)); t.append(ico, el('span', null, a.title)); t.dataset.app = id; t.setAttribute('aria-label', tr('Open {name}', { name: a.title })); t.onclick = () => launch(id); row.append(t);
      }); box.append(row);
    });
  }
  function renderDock() {
    const d = $('#dock'); d.replaceChildren();
    if (window.NetViz) NetViz.setHint(os() && !Object.values(wins).some(w => w.open && !w.min) ? tr('NO OPEN WINDOWS  /  SELECT AN APP') : '');
    Object.values(wins).filter(w => w.open).forEach(w => {
      const b = el('button', 'dk' + (focusId === w.id && !w.min ? ' on' : '') + (w.min ? ' mn' : ''), w.title); b.type = 'button'; b.setAttribute('aria-label', w.min ? tr('{name} (minimized)', { name: w.title }) : w.title);
      b.onclick = () => { if (w.min) { w.min = false; apply(w.id); focus(w.id); } else if (focusId === w.id) minimize(w.id); else focus(w.id); save(); }; d.append(b);
    });
  }
  const setStatus = s => { $('#statusSel').value = s; send({ t: 'status', status: s }); };
  const togglePref = k => { prefs[k] = !prefs[k]; savePrefs(); applyPrefs(); };
  const MENUS = {
    System: [['About CampusNet OS', () => toast(tr('CampusNet OS: a private mesh network. Windows, apps and encrypted messages run in your browser.'))], ['Lock screen', () => lock()], ['Sign out...', () => $('#outBtn').click()]],
    File: [['Upload files...', () => $('#fileIn').click()]],
    Edit: [['Find in chat', () => { launch('chat'); $('#find').focus(); }], ['Filter files', () => { launch('files'); $('#ffind').focus(); }], ['Clear chat view', () => $('#log').replaceChildren()]],
    View: [['Tile windows', tile], ['Close all windows', closeAll], ['CRT scanlines', () => togglePref('crt'), () => prefs.crt], ['Network mesh', () => togglePref('mesh'), () => prefs.mesh]],
    Network: [['Scan nodes', () => { launch('terminal'); term.run('scan'); }], ['Monitor', () => launch('monitor')], ['Security keys', () => launch('security')], ['Status: online', () => setStatus('online')], ['Status: away', () => setStatus('away')], ['Status: busy', () => setStatus('busy')]],
    Settings: [['Preferences...', () => launch('settings')]],
    Help: [['Commands', () => { launch('terminal'); term.run('help'); }], ['Reset window layout', tile]]
  };
  function buildMenubar() {
    const bar = $('#menubar'); let openName = '';
    const closeMenu = () => { openName = ''; bar.querySelectorAll('.mdd').forEach(m => m.remove()); bar.querySelectorAll('.mb').forEach(b => { b.classList.remove('on'); b.setAttribute('aria-expanded', 'false'); }); };
    const openMenu = (name, wrap) => {
      closeMenu(); openName = name; const dd = el('div', 'mdd'); dd.setAttribute('role', 'menu');
      MENUS[name].forEach(([label, fn, chk]) => { const it = el('button', 'mi'); it.type = 'button'; it.setAttribute('role', 'menuitem'); it.append(el('span', 'ck', chk && chk() ? '\u2713' : ''), label); it.onclick = () => { closeMenu(); fn(); }; dd.append(it); });
      wrap.append(dd); const b = wrap.firstChild; b.classList.add('on'); b.setAttribute('aria-expanded', 'true');
    };
    Object.keys(MENUS).forEach(name => {
      const wrap = el('div', 'mwrap'), b = el('button', 'mb', tr(name)); b.type = 'button'; b.setAttribute('role', 'menuitem'); b.setAttribute('aria-haspopup', 'true'); b.setAttribute('aria-expanded', 'false');
      b.onclick = () => (openName === name ? closeMenu() : openMenu(name, wrap)); b.onmouseenter = () => { if (openName && openName !== name) openMenu(name, wrap); };
      wrap.append(b); bar.append(wrap);
    });
    document.addEventListener('pointerdown', e => { if (openName && !e.target.closest('#menubar')) closeMenu(); });
    bar.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeMenu();
      if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && openName) { const names = Object.keys(MENUS), i = (names.indexOf(openName) + (e.key === 'ArrowRight' ? 1 : -1) + names.length) % names.length; const wrap = bar.children[i]; openMenu(names[i], wrap); wrap.querySelector('.mi').focus(); e.preventDefault(); }
      if (e.key === 'ArrowDown' && openName) { const items = [...bar.querySelectorAll('.mdd .mi')], i = items.indexOf(document.activeElement); (items[i + 1] || items[0]).focus(); e.preventDefault(); }
      if (e.key === 'ArrowUp' && openName) { const items = [...bar.querySelectorAll('.mdd .mi')], i = items.indexOf(document.activeElement); (items[i - 1] || items[items.length - 1]).focus(); e.preventDefault(); }
    });
  }

  /* ---------- system apps ---------- */
  function line(out, text, tag) { const r = el('div', 'tl'); r.dataset.tag = tag || '[*]'; r.append(el('span', 'tt', tag || '[*]'), el('span', null, text)); out.append(r); out.scrollTop = out.scrollHeight; }
  function buildTerminal(body) {
    body.classList.add('term'); body.style.flexDirection = 'column';
    const out = el('div', 'tout'), form = el('form', 'tin'), inp = el('input'); inp.setAttribute('aria-label', 'Terminal command'); inp.autocomplete = 'off'; inp.spellcheck = false; inp.autocapitalize = 'off';
    form.append(el('span', 'prompt', '>'), inp); body.append(out, form);
    const L = (t, g) => line(out, t, g), hist = []; let hi = 0;
    const sz = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
    const CMDS = {
      help() { ['help                 this list', 'whoami               who you are and your link state', 'scan                 list nodes with status and key fingerprints', 'files                list shared files', 'ping                 HTTP and WebSocket round trip to the server', 'diag                 connection diagnostics: server, HTTP, WebSocket, clock, encryption', 'uptime               time since you signed in', 'status <online|away|busy>', 'w <user> <message>   encrypted private message', 'open <#room|user|board>  switch the chat window', 'clear'].forEach(x => L(x)); },
      whoami() { L(`${st.me}${st.admin ? ' (admin)' : ''} | status ${$('#statusSel').value} | link ${$('#stat').textContent} | e2e ${E2E.priv ? 'active' : 'unavailable'}`, '[+]'); },
      async scan() { const names = [...new Set([...st.users, ...st.all])]; L(names.length + ' node(s):'); for (const n of names) { const s = st.users.includes(n) ? (st.status[n] || 'online') : 'offline', k = E2E.keys[n]; L(`${n.padEnd(14)} ${s.padEnd(8)} ${k ? (await CN.fingerprint(k)).slice(0, 14) : 'no key'}`, st.users.includes(n) ? '[+]' : '[-]'); } },
      files() { if (!st.files.length) return L('library is empty'); st.files.forEach(f => L(`${f.name}  ${sz(f.size)}  by ${f.owner}`)); },
      async pingHttp() { const t = []; for (let i = 0; i < 4; i++) { const t0 = performance.now(); try { await fetch('/api/info', { cache: 'no-store' }); t.push(performance.now() - t0); } catch { L('request failed', '[-]'); return; } } L(`HTTP       4 probes: min ${Math.min(...t).toFixed(0)} ms, avg ${(t.reduce((a, b) => a + b) / t.length).toFixed(0)} ms, max ${Math.max(...t).toFixed(0)} ms`, '[+]'); },
      async ping() {
        await CMDS.pingHttp(); const w = []; for (let i = 0; i < 4; i++) { const v = await wsPing(); if (v == null) { L('WebSocket  no reply within 3 s', '[-]'); return; } w.push(v); }
        L(`WebSocket  4 probes: min ${Math.min(...w)} ms, avg ${(w.reduce((a, b) => a + b) / w.length).toFixed(0)} ms, max ${Math.max(...w)} ms`, '[+]');
      },
      async diag() {
        const rs = ['connecting', 'open', 'closing', 'closed'][st.ws ? st.ws.readyState : 3]; L('link        WebSocket ' + rs + (IS_DEMO ? ' (simulated in demo mode)' : ''), rs === 'open' ? '[+]' : '[-]');
        const t = []; let info = null, skew = null;
        for (let i = 0; i < 3; i++) { const t0 = performance.now(); try { const r = await fetch('/healthz', { cache: 'no-store' }); t.push(performance.now() - t0); if (r.ok) { info = await r.json().catch(() => null); const d = r.headers.get('date'); if (d) skew = Date.now() - new Date(d).getTime(); } } catch { L('server      /healthz request failed', '[-]'); break; } }
        if (t.length) L(`server      HTTP /healthz min ${Math.min(...t).toFixed(0)} ms, avg ${(t.reduce((a, b) => a + b) / t.length).toFixed(0)} ms` + (info && info.uptime != null ? `, up ${Math.floor(info.uptime / 3600)}h ${Math.floor(info.uptime % 3600 / 60)}m, ${info.online} connection(s)` : ''), '[+]');
        const w = []; for (let i = 0; i < 3; i++) { const v = await wsPing(); if (v != null) w.push(v); }
        L(w.length ? `websocket   round trip min ${Math.min(...w)} ms, avg ${(w.reduce((a, b) => a + b) / w.length).toFixed(0)} ms (${w.length}/3 replies)` : 'websocket   no reply', w.length ? '[+]' : '[-]');
        if (skew != null) L(`clock       differs from the server by about ${(skew / 1000).toFixed(1)} s (resolution 1 s)`, Math.abs(skew) > 30000 ? '[!]' : '[+]');
        L(`security    secure context ${isSecureContext ? 'yes' : 'NO (end-to-end DMs need HTTPS or localhost)'}, e2e key ${E2E.priv ? 'active' : 'unavailable'}`, isSecureContext && E2E.priv ? '[+]' : '[!]');
        L(`session     ${Math.floor((Date.now() - st.t0) / 60000)} min, ${st.users.length} node(s) online, ${st.files.length} file(s)`);
      },
      uptime() { const s = Math.floor((Date.now() - st.t0) / 1000); L(`${Math.floor(s / 3600)}h ${Math.floor(s % 3600 / 60)}m ${s % 60}s`); },
      status(a) { if (!['online', 'away', 'busy'].includes(a)) return L('usage: status <online|away|busy>', '[!]'); setStatus(a); L('status set to ' + a, '[+]'); },
      w(a) { const [to, ...m] = a.split(' '); if (!to || !m.length) return L('usage: w <user> <message>', '[!]'); sendDM(to, m.join(' ')); L('queued (end-to-end encrypted)', '[+]'); },
      open(a) { const t = a.replace(/^#/, ''); if (t === 'board') open('b', 'board'); else if (st.rooms.includes(t)) open('r', t); else if (canon(t)) open('d', canon(t)); else return L('no such channel or user', '[!]'); launch('chat'); },
      clear() { out.replaceChildren(); }
    };
    async function run(cmdline) {
      const t = cmdline.trim(); if (!t) return; const r = el('div', 'tl cmd'); r.append(el('span', 'tt', '>'), el('span', null, t)); out.append(r);
      const [c, ...rest] = t.split(' '), fn = CMDS[c.toLowerCase()];
      if (!fn) L('command not found: ' + c + ' (try help)', '[-]'); else { try { await fn(rest.join(' ').trim()); } catch { L('command failed', '[-]'); } }
      out.scrollTop = out.scrollHeight;
    }
    form.onsubmit = e => { e.preventDefault(); const v = inp.value; inp.value = ''; if (v.trim()) { hist.push(v); hi = hist.length; } run(v); };
    inp.addEventListener('keydown', e => { if (e.key === 'ArrowUp' && hist.length) { hi = Math.max(0, hi - 1); inp.value = hist[hi]; e.preventDefault(); } if (e.key === 'ArrowDown') { hi = Math.min(hist.length, hi + 1); inp.value = hist[hi] || ''; e.preventDefault(); } });
    term = { run, focus: () => inp.focus() }; L('CampusNet terminal. Type help for commands.'); if (IS_DEMO) L('Demo mode: nodes, replies and latency are simulated in your browser.', '[!]');
  }
  function buildMonitor(body) {
    body.classList.add('mon'); const cards = {}, mk = (k, label, wide) => { const c = el('div', 'stat' + (wide ? ' wide' : '')); c.append(el('small', null, label)); cards[k] = el('b', null, '--'); c.append(cards[k]); body.append(c); return c; };
    if (IS_DEMO) body.append(el('p', 'note wide', tr('Demo mode: nodes and latency below are simulated in your browser.')));
    ['link:Link', 'lat:HTTP latency', 'ws:WebSocket latency', 'nodes:Nodes online', 'files:Library', 'unread:Unread', 'up:Session', 'e2e:Encryption'].forEach(s => { const [k, l] = s.split(':'); mk(k, tr(l)); });
    const sc = mk('spark', tr('Latency history'), true), cv = el('canvas'); cv.setAttribute('aria-label', tr('Latency history graph')); cv.setAttribute('role', 'img'); sc.append(cv); cards.spark.remove();
    const draw = () => {
      const w = cv.clientWidth, h = cv.clientHeight; if (!w) return; cv.width = w * 2; cv.height = h * 2; const g = cv.getContext('2d'); g.scale(2, 2); g.clearRect(0, 0, w, h);
      const v = st.lat.filter(x => x != null); g.strokeStyle = 'rgba(51,255,102,.12)'; for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(0, h * i / 4); g.lineTo(w, h * i / 4); g.stroke(); }
      if (v.length < 2) { g.fillStyle = 'rgba(138,165,149,.9)'; g.font = '11px ui-monospace,monospace'; g.fillText(tr('collecting samples...'), 8, h / 2); return; }
      const mx = Math.max(20, ...v) * 1.15; g.strokeStyle = '#33ff66'; g.lineWidth = 1.5; g.shadowColor = '#33ff66'; g.shadowBlur = 6; g.beginPath();
      v.forEach((x, i) => { const px = i / (v.length - 1) * (w - 4) + 2, py = h - 4 - x / mx * (h - 8); i ? g.lineTo(px, py) : g.moveTo(px, py); }); g.stroke();
    };
    const sz = n => n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
    function render() {
      const v = st.lat.filter(x => x != null), un = Object.values(st.unread).reduce((a, b) => a + b, 0), s = Math.max(0, Math.floor((Date.now() - st.t0) / 1000));
      cards.link.textContent = $('#stat').textContent.toUpperCase(); cards.lat.textContent = v.length ? v[v.length - 1] + ' ms' : '--'; cards.ws.textContent = st.wsLat != null ? st.wsLat + ' ms' : '--';
      cards.nodes.textContent = st.users.length + ' / ' + (st.all.length || st.users.length); cards.files.textContent = st.files.length + ' \u00B7 ' + sz(st.files.reduce((a, f) => a + f.size, 0));
      cards.unread.textContent = un; cards.up.textContent = st.t0 ? `${Math.floor(s / 3600)}h ${Math.floor(s % 3600 / 60)}m ${s % 60}s` : '--';
      cards.e2e.textContent = !CN.supported ? tr('UNAVAILABLE') : E2E.priv ? tr('ACTIVE') : tr('NOT READY'); draw();
    }
    document.addEventListener('cn:state', () => { if (!body.closest('.wclosed')) render(); }); setInterval(() => { if (!body.closest('.wclosed')) render(); }, 1000); render();
  }
  function buildSecurity(body) {
    body.classList.add('sec'); const me = el('div', 'stat'), list = el('div'), fpc = {}, cmpVals = {};
    body.append(me, el('p', 'note', tr('Direct messages are encrypted in your browser (ECDH P-256 + AES-256-GCM). The server only relays ciphertext. Channels, files and notices are not encrypted. Compare safety numbers with your contact over another channel to be sure nobody swapped a key.')), el('small', 'dim', tr('CONTACTS')), list);
    let tok = 0;
    async function render() {
      const my = ++tok; me.replaceChildren(el('small', null, tr('Your safety number')), el('div', 'fp', !CN.supported ? tr('Unavailable: open the site over HTTPS or localhost.') : E2E.priv ? E2E.fp : tr('Key not ready')));
      if (E2E.priv) { const cp = el('button', 'btn', tr('Copy')); cp.type = 'button'; cp.style.cssText = 'margin-top:8px;min-height:30px'; cp.onclick = () => { try { navigator.clipboard.writeText(E2E.fp); toast(tr('Safety number copied')); } catch { toast(tr('Copy failed'), 'bad'); } }; me.append(cp); }
      const rows = []; const names = Object.keys(E2E.keys).filter(n => n !== st.me).sort((a, b) => a.localeCompare(b));
      if (!names.length) rows.push(el('p', 'note', tr('No contacts with keys yet.')));
      for (const n of names) {
        const pub = E2E.keys[n]; if (!fpc[pub.x]) fpc[pub.x] = await CN.fingerprint(pub);
        const s = E2E.state[n] || (tofu[n] ? (tofu[n].fp === fpc[pub.x] ? (tofu[n].v ? 'verified' : 'ok') : 'changed') : 'new');
        const p = el('div', 'peer'); p.append(el('span', 'pn', n), el('span', 'pill ' + s, s === 'changed' ? tr('key changed') : s === 'new' ? tr('not used yet') : tr(s)), el('div', 'fp', fpc[pub.x]));
        const cmp = el('input'), res = el('small', 'cmpres'); cmp.placeholder = tr('Paste their safety number to compare'); cmp.setAttribute('aria-label', tr('Their safety number')); cmp.autocomplete = 'off'; cmp.spellcheck = false;
        cmp.value = cmpVals[n] || ''; cmp.oninput = () => { cmpVals[n] = cmp.value; const norm = x => String(x).replace(/[^0-9a-f]/gi, '').toLowerCase(), v = norm(cmp.value); res.replaceChildren(); res.className = 'cmpres'; if (!v) return; if (v === norm(fpc[pub.x])) { res.classList.add('ok'); res.append('Match. This is the key we use for ' + n + '. '); if (tofu[n] && s !== 'verified') { const b = el('button', 'btn', tr('Mark verified')); b.type = 'button'; b.onclick = () => { cmp.blur(); markVerified(n, true); }; res.append(b); } } else if (v.length >= norm(fpc[pub.x]).length) { res.classList.add('bad'); res.append('Does NOT match. Do not trust this key until you have checked with ' + n + ' in person or by phone.'); } else res.append(tr('Keep typing...')); };
        p.append(cmp, res); if (cmp.value) cmp.oninput();
        if (s === 'changed') { const b = el('button', 'btn', tr('Trust new key')); b.type = 'button'; b.onclick = () => { E2E.pending[n] = E2E.pending[n] || fpc[pub.x]; trustKey(n); }; p.append(b); }
        else if (tofu[n]) { const b = el('button', 'btn', s === 'verified' ? tr('Unmark') : tr('Mark verified')); b.type = 'button'; b.onclick = () => markVerified(n, s !== 'verified'); p.append(b); }
        rows.push(p);
      }
      if (my === tok) list.replaceChildren(...rows);
    }
    document.addEventListener('cn:state', () => { if (!body.closest('.wclosed') && !(document.activeElement && document.activeElement.tagName === 'INPUT' && list.contains(document.activeElement))) render(); }); render();
  }
  function buildSettings(body) {
    body.classList.add('set');
    const tog = (k, label) => { const l = el('label', 'tog'), i = el('input'); i.type = 'checkbox'; i.checked = prefs[k] !== false && !!prefs[k] || (k === 'boot' && prefs.boot !== false); i.onchange = () => { prefs[k] = i.checked; savePrefs(); applyPrefs(); }; l.append(el('span', null, label), i); return l; };
    const btn = (t, fn) => { const b = el('button', 'btn', t); b.type = 'button'; b.onclick = fn; return b; }, row = el('div', 'row');
    row.append(btn(tr('Reset window layout'), () => { if (os()) tile(); else toast(tr('Window layout applies on large screens')); }), btn(tr('Forget trusted keys'), async () => { if (await ask({ title: tr('Forget trusted keys'), text: tr('Safety numbers you saved on this device will be cleared. Contacts are checked again the next time you message them.'), ok: tr('Forget'), danger: true })) { forgetKeys(); toast(tr('Trusted keys cleared')); } }));
    const inst = el('div', 'instbox'), ib = btn(tr('Install app'), () => { if (window.PWA) PWA.install(); }), ih = el('p', 'note');
    const syncInst = () => { const k = window.PWA ? PWA.state() : 'none'; inst.hidden = k !== 'prompt' && k !== 'ios'; ib.hidden = k !== 'prompt'; ih.textContent = k === 'ios' ? tr('On iPhone: tap Share, then Add to Home Screen.') : tr('Install CampusNet on this device so it opens like an app and its screen loads even without a connection.'); };
    inst.append(ib, ih); syncInst(); document.addEventListener('cn:pwa', () => { if (body.isConnected) syncInst(); });
    body.append(langRow(), inst, tog('boot', tr('Boot animation after sign-in')), tog('crt', tr('CRT scanlines and vignette')), tog('mesh', tr('Animated network background')), tog('sound', tr('Sound alerts for DMs and mentions')), row, accountBox(), el('p', 'note', tr('Settings are stored in this browser only.')));
  }

  /* ---------- OS pieces: messages sidebar, start menu, lock screen, boot ---------- */
  function mountSidebar(on) {
    const c = $('#center'); let side = $('#msgSide');
    if (on && !side) { side = el('div', 'msgside'); side.id = 'msgSide'; side.append(el('div', 'sh', tr('Channels')), $('#rooms'), el('div', 'sh', tr('People')), $('#users')); c.insertBefore(side, $('#log')); }
    else if (!on && side) { $('#pChannels').append($('#rooms')); $('#pNodes').append($('#users')); side.remove(); }
  }
  const startMenu = $('#startmenu'), startBtn = $('#startBtn');
  function closeStart() { startMenu.hidden = true; startBtn.setAttribute('aria-expanded', 'false'); }
  function renderStart() {
    startMenu.replaceChildren(); const head = el('div', 'sm-head'); head.append(el('span', 'av', st.me ? st.me[0] : '?'), el('b', null, st.me || 'guest'), el('small', 'dim', st.admin ? 'admin' : 'user')); startMenu.append(head);
    ['Core', 'Network', 'System'].forEach(cat => {
      startMenu.append(el('div', 'cat', '[ ' + tr(cat) + ' ]'));
      Object.entries(APPS).filter(([, a]) => a.cat === cat && (!a.admin || st.admin)).forEach(([id, a]) => { const it = el('button', 'mi'); it.type = 'button'; it.setAttribute('role', 'menuitem'); it.append(icon(a.ic), a.title); it.onclick = () => { closeStart(); launch(id); }; startMenu.append(it); });
    });
    const foot = el('div', 'sm-foot'), lk = el('button', 'btn', tr('Lock')), so = el('button', 'btn', tr('Sign out')); lk.type = so.type = 'button';
    lk.onclick = () => { closeStart(); lock(); }; so.onclick = () => { closeStart(); $('#outBtn').click(); }; foot.append(lk, so); startMenu.append(foot);
  }
  startBtn.onclick = e => { e.stopPropagation(); if (startMenu.hidden) { renderStart(); startMenu.hidden = false; startBtn.setAttribute('aria-expanded', 'true'); const f = startMenu.querySelector('.mi'); if (f) f.focus(); } else closeStart(); };
  document.addEventListener('pointerdown', e => { if (!startMenu.hidden && !e.target.closest('#startmenu') && !e.target.closest('#startBtn')) closeStart(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !startMenu.hidden) { closeStart(); startBtn.focus(); } });
  function lock() {
    $('#lockUser').textContent = st.me; $('#lockPw').value = ''; $('#lockErr').textContent = ''; $('#lock').hidden = false; $('#app').inert = true; setTimeout(() => $('#lockPw').focus(), 30);
  }
  $('#lockForm').onsubmit = e => {
    e.preventDefault();
    if (st.loginPw && $('#lockPw').value === st.loginPw) { $('#lock').hidden = true; $('#app').inert = false; return; }
    $('#lockErr').textContent = tr('Wrong password.'); const f = $('#lockForm'); f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake');
  };
  $('#lockOut').onclick = () => { $('#lock').hidden = true; $('#app').inert = false; $('#outBtn').click(); };
  let booted = false;
  function boot() {
    if (!os() || reduceMotion.matches || prefs.boot === false || st.resume) return;
    const b = $('#osboot'), log = $('#bootlog'), lines = ['CampusNet OS', '[*] initialising desktop...', '[+] link established', '[+] identity: ' + st.me + (st.admin ? ' (admin)' : ''), E2E.priv ? '[+] encryption: active' : '[!] encryption: unavailable', '[+] mounting library: ' + st.files.length + ' file(s)', '[+] nodes online: ' + st.users.length, '[*] starting desktop...'];
    b.hidden = false; b.classList.remove('out'); log.textContent = ''; let i = 0;
    const step = () => { if (i < lines.length) { log.textContent += lines[i++] + '\n'; setTimeout(step, 100); } else setTimeout(() => { b.classList.add('out'); setTimeout(() => { b.hidden = true; }, 450); }, 220); };
    step();
  }
  document.addEventListener('cn:welcome', () => { if (!booted) { booted = true; boot(); } });
  if (window.NetViz) NetViz.onPick = n => { open('d', n); launch('chat'); };

  /* ---------- mode switching ---------- */
  function setMode() {
    document.body.classList.toggle('os', mq.matches); mountSidebar(mq.matches);
    if (mq.matches) restore();
    Object.keys(wins).forEach(apply); renderLauncher(); renderDock(); if (mq.matches && focusId && wins[focusId]) focus(focusId);
  }
  const origSetTab = window.setTab;
  window.setTab = t => { origSetTab(t); if (os()) { if (t === 'chat') launch('chat'); else if (t === 'files') launch('files'); } };
  Object.keys(APPS).forEach(id => { if (!APPS[id].alias) register(id); });
  buildMenubar(); setMode();
  mq.addEventListener('change', () => { closeLauncher(); setMode(); });
  addEventListener('resize', () => { if (os()) { Object.values(wins).forEach(fit); Object.keys(wins).forEach(apply); } });
  $('#appsBtn').setAttribute('aria-label', tr('Apps')); $('#appsBtn').replaceChildren(icon('apps'));
  $('#appsBtn').onclick = () => { launcherOpen = true; $('#launcher').classList.add('ov'); renderLauncher(); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#launcher').classList.contains('ov')) closeLauncher(); });
  document.addEventListener('cn:state', () => { if (os() && !sized && desk.clientWidth > 0) { restore(); Object.keys(wins).forEach(apply); if (focusId) focus(focusId); } renderDock(); });
  window.Shell = { launch, tile };
})();
