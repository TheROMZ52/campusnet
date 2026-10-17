'use strict';
/* Home: the landing page of the desktop. Everything shown is live data from the session (unread, alerts, announcement, feed, player). */
const Home = (function () {
  let body = null, timer = 0, posts = [], mini = null;
  const TILES = [['chat', tr('Messages'), 'chat'], ['feed', tr('Feed'), 'board'], ['groups', tr('Groups'), 'chat'], ['people', tr('People'), 'nodes'], ['music', tr('Music'), 'music'], ['files', tr('Files'), 'files'], ['terminal', tr('Terminal'), 'term'], ['security', tr('Security'), 'shield']];
  const sec = (t, ...kids) => { const s = el('section', 'hsec'); s.append(el('h3', 'sh', t), ...kids); return s; };
  const row = (a, b, fn) => { const li = el('li'); li.append(el('b', null, a), el('small', null, b)); if (fn) { li.tabIndex = 0; li.onclick = fn; li.onkeydown = e => { if (e.key === 'Enter') fn(); }; } return li; };
  const convLabel = k => { if (k === 'b:board') return tr('Board'); if (k.startsWith('r:g:')) return '\u25C7 ' + ((st.groups[k.slice(4)] || {}).name || 'group'); if (k.startsWith('r:')) return '#' + k.slice(2); return k.slice(2); };
  function go(k) { const kind = k[0], id = k.slice(2); open(kind === 'b' ? 'b' : kind, kind === 'b' ? 'board' : id); if (window.Shell) Shell.launch('chat'); }
  function render() {
    if (!body || !body.isConnected) return; if (mini) mini.dispose(); const f = document.activeElement; if (f && body.contains(f) && f.tagName === 'INPUT') return;
    const h = new Date().getHours(), hi = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    const unread = Object.entries(st.unread || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]), total = unread.reduce((a, [, n]) => a + n, 0), alerts = (st.notifs || []).filter(n => !n.read).length;
    const top = el('div', 'hero'); top.append(el('h2', null, tr(hi + ', {name}', { name: st.myProfile.d || st.me })), el('small', null, dateLabel(new Date(), { weekday: 'long', month: 'long', day: 'numeric' })));
    const stats = el('div', 'stats'); [[(st.users || []).length, 'online'], [total, 'unread'], [alerts, 'alerts'], [Object.keys(st.groups || {}).length, 'groups'], [(st.files || []).length, 'files']].forEach(([n, l]) => { const c = el('div', 'stat2'); c.append(el('b', null, String(n)), el('small', null, tr(l))); stats.append(c); });
    const tiles = el('div', 'tiles'); TILES.forEach(([id, t, ic]) => { const b = el('button', 'tile2'); b.type = 'button'; b.append(icon(ic), el('span', null, t)); b.onclick = () => Shell.launch(id); tiles.append(b); });
    mini = Music.mini();
    const ul1 = el('ul', 'hl'); if (unread.length) unread.slice(0, 5).forEach(([k, n]) => ul1.append(row(convLabel(k), tr('{n} new', { n }), () => go(k)))); else ul1.append(el('li', 'empty', tr('You are all caught up')));
    const ul2 = el('ul', 'hl'), nl = (st.notifs || []).slice(0, 4); if (nl.length) nl.forEach(n => ul2.append(row(notifText(n), ago(n.ts), () => Shell.launch('alerts')))); else ul2.append(el('li', 'empty', tr('No alerts yet')));
    const ul3 = el('ul', 'hl'); if (posts.length) posts.forEach(p => ul3.append(row(p.by, p.text.slice(0, 90), () => Shell.launch('feed')))); else ul3.append(el('li', 'empty', tr('No posts yet')));
    const nt = (st.notices || [])[0], ann = nt ? row(nt.by || 'admin', (nt.text || '').slice(0, 160) + ' \u00B7 ' + ago(nt.ts), () => open('b', 'board')) : el('li', 'empty', tr('No announcements'));
    const ul4 = el('ul', 'hl'); ul4.append(ann);
    body.replaceChildren(top, stats, tiles, sec(tr('Now playing'), mini), sec(tr('Continue'), ul1), sec(tr('Alerts'), ul2), sec(tr('Latest posts'), ul3), sec(tr('Announcement'), ul4));
  }
  const later = () => { clearTimeout(timer); timer = setTimeout(render, 150); };
  let asked = false;
  const askFeed = () => { if (!asked && st.me && st.ws && st.ws.readyState === 1) { asked = true; send({ t: 'feed', scope: 'all' }); } };
  function build(b) { body = b; b.classList.add('soc', 'home'); document.addEventListener('cn:state', () => { askFeed(); later(); }); askFeed(); render(); }
  function onMsg(m) {
    if (m.t === 'feed' && m.scope === 'all' && m.before === null) posts = m.posts.slice(0, 4);
    else if (m.t === 'post') posts = [m.p, ...posts].slice(0, 4); else if (m.t === 'pdel') posts = posts.filter(p => p.id !== m.id); else if (!['notif', 'group', 'gleave', 'prefs', 'profile'].includes(m.t)) return;
    later();
  }
  return { build, onMsg };
})();
