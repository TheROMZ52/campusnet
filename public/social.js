'use strict';
/* Social windows: People (profile, search, follow/block), Feed (real posts, pagination, likes), Alerts (notifications).
   Uses the globals of app.js (st, send, el, ago, toast, open, canon, same). All text is inserted as plain text. */
const Social = (function () {
  const views = {};
  const av = name => {
    const p = same(name, st.me) ? st.myProfile : (st.profiles[name] || null), s = el('span', 'pav');
    if (p && p.a) { const i = el('img'); i.alt = ''; i.src = p.a; s.append(i); } else s.textContent = String(name || '?')[0].toUpperCase();
    return s;
  };
  const btn = (txt, fn, cls) => { const b = el('button', 'btn sm' + (cls ? ' ' + cls : ''), txt); b.type = 'button'; b.onclick = fn; return b; };
  const head = (t, extra) => { const h = el('h3', 'sh', t); if (extra) h.append(extra); return h; };
  const readFile = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error(tr('Cannot read file'))); r.readAsDataURL(f); });
  async function fitAvatar(file) {
    const url = await readFile(file), img = new Image(); await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error(tr('That is not an image'))); img.src = url; });
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'), n = Math.min(img.width, img.height);
    x.drawImage(img, (img.width - n) / 2, (img.height - n) / 2, n, n, 0, 0, 64, 64);
    let q = 0.8, d = c.toDataURL('image/jpeg', q); while (d.length > 7500 && q > 0.2) { q -= 0.15; d = c.toDataURL('image/jpeg', q); }
    if (d.length > 8000) throw new Error(tr('Image is too complex')); return d;
  }

  /* ---------- People ---------- */
  function people(body) {
    body.classList.add('soc'); let avatar; // undefined = keep, '' = remove, data URL = new
    const pv = el('div', 'avbig'), name = el('input'), bio = el('textarea'), rc = el('input'), file = el('input'), msg = el('small', 'note');
    name.maxLength = 30; name.placeholder = tr('Display name'); name.setAttribute('aria-label', tr('Display name'));
    bio.maxLength = 200; bio.rows = 2; bio.placeholder = tr('Short bio'); bio.setAttribute('aria-label', tr('Bio'));
    rc.type = 'checkbox'; rc.id = 'rcpt'; file.type = 'file'; file.accept = 'image/png,image/jpeg,image/webp'; file.hidden = true;
    const rl = el('label', 'chk'); rl.htmlFor = 'rcpt'; rl.append(rc, ' ' + tr('Let others see when I have read their messages'));
    const fillMine = () => { fillSongs(); pv.replaceChildren(av(st.me)); name.value = st.myProfile.d || ''; bio.value = st.myProfile.b || ''; rc.checked = st.prefs.receipts !== false; avatar = undefined; };
    file.onchange = async () => { try { avatar = await fitAvatar(file.files[0]); pv.replaceChildren(Object.assign(el('span', 'pav'), {})); const i = el('img'); i.alt = ''; i.src = avatar; pv.firstChild.append(i); } catch (e) { toast(e.message, 'bad'); } file.value = ''; };
    const save = btn(tr('Save profile'), () => { const o = { t: 'profile', display: name.value, bio: bio.value, receipts: rc.checked, music: song.value }; if (avatar !== undefined) o.avatar = avatar; send(o); msg.textContent = tr('Saved'); });
    const row = el('div', 'row'); row.append(btn(tr('Change photo'), () => file.click()), btn(tr('Remove photo'), () => { avatar = ''; pv.replaceChildren(Object.assign(el('span', 'pav'), { textContent: st.me[0].toUpperCase() })); }), file);
    const song = el('select'); song.setAttribute('aria-label', tr('Profile song')); const sl = el('label', 'chk', tr('Profile song')); sl.append(song);
    const fillSongs = () => { const cur = (st.myProfile.m || {}).id || '', want = ['', ...Music.tracks().map(t => t.id)].join(), have = [...song.options].map(o => o.value).join(); if (want === have && song.value === cur) return; song.replaceChildren(new Option(tr('None'), '')); Music.tracks().forEach(t => song.append(new Option(Music.label(t).artist + ' - ' + Music.label(t).title, t.id))); song.value = cur; };
    document.addEventListener('cn:state', () => { if (document.activeElement !== song && song.isConnected) fillSongs(); });
    const mine = el('div', 'sbox'); mine.append(pv, name, bio, sl, row, rl, save, msg);
    const q = el('input'); q.type = 'search'; q.placeholder = tr('Find people by name'); q.setAttribute('aria-label', tr('Find people')); const out = el('ul', 'plist');
    let t = 0; q.oninput = () => { clearTimeout(t); t = setTimeout(() => send({ t: 'search', q: q.value }), 250); };
    function render(list) {
      out.replaceChildren(); if (!list.length) { out.append(el('li', 'empty', q.value.trim() ? tr('No one found') : tr('Type a name to search'))); return; }
      list.forEach(u => {
        const li = el('li'), info = el('div', 'pi'); info.append(el('b', null, u.n + (u.d ? ' \u00B7 ' + u.d : '')), el('small', null, (u.b || '') + (u.b ? ' \u00B7 ' : '') + trn(u.fo, '{n} follower', '{n} followers'))); if (u.m) { const lb = Music.label({ name: u.m.n, owner: u.n }); const mrow = el('div', 'row'); mrow.append(btn('\u25B6 ' + lb.artist + ' - ' + lb.title, () => Music.play(u.m.id))); info.append(mrow); }
        const acts = el('div', 'acts');
        if (!same(u.n, st.me)) {
          acts.append(btn(tr('Message'), () => open('d', u.n)),
            btn(st.prefs.following.includes(u.n.toLowerCase()) ? tr('Unfollow') : tr('Follow'), () => send({ t: 'follow', name: u.n, on: !st.prefs.following.includes(u.n.toLowerCase()) })),
            btn(st.prefs.blocked.includes(u.n.toLowerCase()) ? tr('Unblock') : tr('Block'), () => send({ t: 'block', name: u.n, on: !st.prefs.blocked.includes(u.n.toLowerCase()) }), 'bad'));
        }
        li.append(av(u.n), info, acts); out.append(li);
      });
    }
    let last = [];
    body.append(head(tr('Your profile')), mine, head(tr('Find people')), q, out); fillMine(); render([]);
    views.people = { update(m) { if (m.t === 'results' && m.q === q.value.trim().toLowerCase()) { last = m.users; render(last); } else if (m.t === 'prefs') { if (m.receipts !== undefined) rc.checked = m.receipts; if (q.value.trim()) send({ t: 'search', q: q.value }); } else if (m.t === 'profile' && same(m.name, st.me)) { fillMine(); msg.textContent = tr('Saved'); } } };
  }

  /* ---------- Feed ---------- */
  function feed(body) {
    body.classList.add('soc'); const box = { all: { posts: [], more: false, loaded: false }, following: { posts: [], more: false, loaded: false } }; let scope = 'all';
    const ta = el('textarea'); ta.maxLength = 500; ta.rows = 2; ta.placeholder = tr('Share something with the network'); ta.setAttribute('aria-label', tr('New post'));
    const post = btn(tr('Post'), () => { const v = ta.value.trim(); if (!v) return; send({ t: 'post', text: v }); ta.value = ''; });
    const tabs = el('div', 'row'), tAll = btn(tr('Everyone'), () => pick('all')), tFol = btn(tr('Following'), () => pick('following')), list = el('div', 'posts'), more = btn(tr('Load more'), () => { const b = box[scope]; send({ t: 'feed', scope, before: b.posts.length ? b.posts[b.posts.length - 1].ts : undefined }); });
    tabs.append(tAll, tFol);
    function pick(s) { scope = s; tAll.classList.toggle('on', s === 'all'); tFol.classList.toggle('on', s === 'following'); if (!box[s].loaded) send({ t: 'feed', scope: s }); render(); }
    function render() {
      const b = box[scope]; list.replaceChildren();
      if (!b.posts.length) list.append(el('p', 'empty', b.loaded ? (scope === 'following' ? tr('Nothing yet. Follow people from the People window.') : tr('No posts yet. Write the first one.')) : tr('Loading...')));
      b.posts.forEach(p => {
        const a = el('article', 'post'), h = el('div', 'ph2'); h.append(av(p.by), el('b', null, p.by), el('small', null, ago(p.ts))); a.append(h, el('p', null, p.text));
        const f = el('div', 'row'), liked = p.likes.includes(st.me), l = btn('\u2665 ' + p.likes.length, () => send({ t: 'like', id: p.id }), liked ? 'on' : ''); l.title = p.likes.join(', ') || tr('Like'); l.setAttribute('aria-label', tr('Like post')); f.append(l);
        if (p.by === st.me || st.admin) f.append(btn(tr('Delete'), () => send({ t: 'delpost', id: p.id }), 'bad')); a.append(f); list.append(a);
      });
      more.hidden = !b.more; tAll.classList.toggle('on', scope === 'all'); tFol.classList.toggle('on', scope === 'following');
    }
    body.append(ta, post, tabs, list, more); pick('all');
    views.feed = { update(m) {
      if (m.t === 'feed') { const b = box[m.scope]; b.posts = m.before === null ? m.posts : b.posts.concat(m.posts.filter(p => !b.posts.some(x => x.id === p.id))); b.more = m.more; b.loaded = true; }
      else if (m.t === 'post') { if (box.all.loaded) box.all.posts.unshift(m.p); if (m.f && box.following.loaded) box.following.posts.unshift(m.p); }
      else if (m.t === 'plike') { Object.values(box).forEach(b => b.posts.forEach(p => { if (p.id === m.id) p.likes = m.likes; })); }
      else if (m.t === 'pdel') { Object.values(box).forEach(b => { b.posts = b.posts.filter(p => p.id !== m.id); }); }
      else if (m.t === 'prefs' && (m.following || m.blocked)) { box.following.loaded = false; box.all.loaded = false; send({ t: 'feed', scope }); }
      render();
    } };
  }

  /* ---------- Alerts ---------- */
  function alerts(body) {
    body.classList.add('soc'); const list = el('ul', 'nlist'), top = el('div', 'row');
    top.append(btn(tr('Mark all read'), () => { st.notifs.forEach(n => { n.read = true; }); send({ t: 'notifread' }); render(); }));
    function render() {
      list.replaceChildren(); if (!st.notifs.length) { list.append(el('li', 'empty', tr('No alerts yet'))); return; }
      st.notifs.forEach(n => {
        const li = el('li', n.read ? '' : 'new'); li.append(av(n.from), el('div', 'pi', null)); const i = li.querySelector('.pi'); i.append(el('b', null, notifText(n)), el('small', null, ago(n.ts)));
        if (n.conv) { li.tabIndex = 0; li.onclick = () => { n.read = true; send({ t: 'notifread' }); const [k, id] = [n.conv[0], n.conv.slice(2)]; open(k === 'r' ? 'r' : 'd', k === 'r' ? id : (canon(id) || id)); render(); }; }
        list.append(li);
      });
    }
    body.append(top, list); render(); views.alerts = { update: render };
  }

  /* ---------- Groups ---------- */
  function groups(body) {
    body.classList.add('soc'); const manage = new Set(), arm = {};
    const gname = el('input'), gdesc = el('input'), gpub = el('input'), msg = el('small', 'note'); gname.maxLength = 40; gname.placeholder = tr('Group name'); gname.setAttribute('aria-label', tr('Group name')); gdesc.maxLength = 200; gdesc.placeholder = tr('Description (optional)'); gdesc.setAttribute('aria-label', tr('Group description')); gpub.type = 'checkbox'; gpub.checked = true; gpub.id = 'gpub';
    const pl = el('label', 'chk'); pl.htmlFor = 'gpub'; pl.append(gpub, ' ' + tr('Public: anyone can find and join'));
    const create = el('div', 'sbox'); create.append(gname, gdesc, pl, btn(tr('Create group'), () => { if (!gname.value.trim()) return; send({ t: 'gcreate', name: gname.value, desc: gdesc.value, pub: gpub.checked }); gname.value = ''; gdesc.value = ''; }), el('small', 'note', tr('Groups are managed by the server and are not end-to-end encrypted.')));
    const mine = el('div', 'glist'), q = el('input'), found = el('ul', 'plist'); q.type = 'search'; q.placeholder = tr('Discover public groups'); q.setAttribute('aria-label', tr('Find groups'));
    let t = 0; q.oninput = () => { clearTimeout(t); t = setTimeout(() => send({ t: 'gsearch', q: q.value }), 250); };
    const confirmBtn = (key, txt, fn, cls) => { const b = btn(arm[key] ? tr('Click again to confirm') : txt, () => { if (arm[key]) { delete arm[key]; fn(); } else { arm[key] = 1; renderMine(); setTimeout(() => { delete arm[key]; renderMine(); }, 4000); } }, cls); return b; };
    function renderMine() {
      mine.replaceChildren(); const list = Object.values(st.groups); if (!list.length) mine.append(el('p', 'empty', tr('You are not in any group yet')));
      list.forEach(g => {
        const role = myRole('g:' + g.id), box = el('div', 'sbox'), top = el('div', 'row'), isMod = role === 'owner' || role === 'mod';
        top.append(el('b', null, g.name), el('small', 'note', tr(role) + ' \u00B7 ' + trn(g.members.length, '{n} member', '{n} members') + ' \u00B7 ' + tr(g.pub ? 'public' : 'invite-only')));
        const acts = el('div', 'row'); acts.append(btn(tr('Open'), () => open('r', 'g:' + g.id)));
        if (isMod) acts.append(btn(manage.has(g.id) ? tr('Close manager') : tr('Manage'), () => { manage.has(g.id) ? manage.delete(g.id) : manage.add(g.id); renderMine(); }));
        if (role !== 'owner') acts.append(confirmBtn('l' + g.id, tr('Leave'), () => send({ t: 'gleave', id: g.id }), 'bad'));
        box.append(top); if (g.desc) box.append(el('small', 'note', g.desc)); box.append(acts);
        if (isMod && manage.has(g.id)) {
          const inv = el('input'); inv.placeholder = tr('Invite by username'); inv.setAttribute('aria-label', tr('Invite user')); const ir = el('div', 'row'); ir.append(inv, btn(tr('Invite'), () => { if (inv.value.trim()) { send({ t: 'ginvite', id: g.id, name: inv.value.trim() }); inv.value = ''; } })); box.append(ir);
          const ul = el('ul'); g.members.forEach(m => {
            const li = el('li'), info = el('div', 'pi'); info.append(el('b', null, m.n), el('small', null, tr(m.r))); const a = el('div', 'acts');
            if (m.r !== 'owner' && m.n !== st.me) {
              if (role === 'owner') a.append(btn(m.r === 'mod' ? tr('Make member') : tr('Make mod'), () => send({ t: 'grole', id: g.id, name: m.n, role: m.r === 'mod' ? 'member' : 'mod' })));
              if (role === 'owner' || m.r === 'member') a.append(btn(tr('Remove'), () => send({ t: 'gkick', id: g.id, name: m.n }), 'bad'));
            }
            li.append(av(m.n), info, a); ul.append(li);
          }); box.append(ul);
          if (role === 'owner') {
            const en = el('input'), ed = el('input'), ep = el('input'); en.value = g.name; ed.value = g.desc || ''; ep.type = 'checkbox'; ep.checked = g.pub; en.maxLength = 40; ed.maxLength = 200; en.setAttribute('aria-label', tr('Rename group')); ed.setAttribute('aria-label', tr('Group description')); const pr = el('label', 'chk'); pr.append(ep, ' ' + tr('Public'));
            const er = el('div', 'row'); er.append(btn(tr('Save changes'), () => send({ t: 'gedit', id: g.id, name: en.value, desc: ed.value, pub: ep.checked })), confirmBtn('d' + g.id, tr('Delete group'), () => send({ t: 'gdelete', id: g.id }), 'bad')); box.append(en, ed, pr, er);
          }
        }
        mine.append(box);
      });
    }
    function renderFound(list) {
      found.replaceChildren(); if (!list.length) { found.append(el('li', 'empty', tr('No public groups found'))); return; }
      list.forEach(g => { const li = el('li'), info = el('div', 'pi'); info.append(el('b', null, g.name), el('small', null, (g.desc ? g.desc + ' \u00B7 ' : '') + trn(g.n, '{n} member', '{n} members')));
        li.append(info, g.member ? btn(tr('Open'), () => open('r', 'g:' + g.id)) : btn(tr('Join'), () => send({ t: 'gjoin', id: g.id }))); found.append(li); });
    }
    body.append(head(tr('New group')), create, head(tr('My groups')), mine, head(tr('Discover'), btn(tr('Refresh'), () => send({ t: 'gsearch', q: q.value }))), q, found); renderMine(); renderFound([]); send({ t: 'gsearch', q: '' });
    views.groups = { update(m) { if (m.t === 'gresults') renderFound(m.groups); else if (m.t === 'group' || m.t === 'gleave') { renderMine(); send({ t: 'gsearch', q: q.value }); } } };
  }

  return { people, feed, alerts, groups, onMsg(m) { Object.values(views).forEach(v => v.update(m)); if (typeof Home !== 'undefined') Home.onMsg(m); } };
})();
