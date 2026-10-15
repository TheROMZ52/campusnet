'use strict';
/* Social windows: People (profile, search, follow/block), Feed (real posts, pagination, likes), Alerts (notifications).
   Uses the globals of app.js (st, send, el, ago, toast, open, canon, same). All text is inserted as plain text. */
const Social = (function () {
  const views = {};
  const av = name => {
    const p = same(name, st.me) ? st.myProfile : (st.profiles[name] || null), s = el('span', 'av');
    if (p && p.a) { const i = el('img'); i.alt = ''; i.src = p.a; s.append(i); } else s.textContent = String(name || '?')[0].toUpperCase();
    return s;
  };
  const btn = (txt, fn, cls) => { const b = el('button', 'btn sm' + (cls ? ' ' + cls : ''), txt); b.type = 'button'; b.onclick = fn; return b; };
  const head = (t, extra) => { const h = el('h3', 'sh', t); if (extra) h.append(extra); return h; };
  const readFile = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Cannot read file')); r.readAsDataURL(f); });
  async function fitAvatar(file) {
    const url = await readFile(file), img = new Image(); await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('That is not an image')); img.src = url; });
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'), n = Math.min(img.width, img.height);
    x.drawImage(img, (img.width - n) / 2, (img.height - n) / 2, n, n, 0, 0, 64, 64);
    let q = 0.8, d = c.toDataURL('image/jpeg', q); while (d.length > 7500 && q > 0.2) { q -= 0.15; d = c.toDataURL('image/jpeg', q); }
    if (d.length > 8000) throw new Error('Image is too complex'); return d;
  }

  /* ---------- People ---------- */
  function people(body) {
    body.classList.add('soc'); let avatar; // undefined = keep, '' = remove, data URL = new
    const pv = el('div', 'avbig'), name = el('input'), bio = el('textarea'), rc = el('input'), file = el('input'), msg = el('small', 'note');
    name.maxLength = 30; name.placeholder = 'Display name'; name.setAttribute('aria-label', 'Display name');
    bio.maxLength = 200; bio.rows = 2; bio.placeholder = 'Short bio'; bio.setAttribute('aria-label', 'Bio');
    rc.type = 'checkbox'; rc.id = 'rcpt'; file.type = 'file'; file.accept = 'image/png,image/jpeg,image/webp'; file.hidden = true;
    const rl = el('label', 'chk'); rl.htmlFor = 'rcpt'; rl.append(rc, ' Let others see when I have read their messages');
    const fillMine = () => { pv.replaceChildren(av(st.me)); name.value = st.myProfile.d || ''; bio.value = st.myProfile.b || ''; rc.checked = st.prefs.receipts !== false; avatar = undefined; };
    file.onchange = async () => { try { avatar = await fitAvatar(file.files[0]); pv.replaceChildren(Object.assign(el('span', 'av'), {})); const i = el('img'); i.alt = ''; i.src = avatar; pv.firstChild.append(i); } catch (e) { toast(e.message, 'bad'); } file.value = ''; };
    const save = btn('Save profile', () => { const o = { t: 'profile', display: name.value, bio: bio.value, receipts: rc.checked }; if (avatar !== undefined) o.avatar = avatar; send(o); msg.textContent = 'Saved'; });
    const row = el('div', 'row'); row.append(btn('Change photo', () => file.click()), btn('Remove photo', () => { avatar = ''; pv.replaceChildren(Object.assign(el('span', 'av'), { textContent: st.me[0].toUpperCase() })); }), file);
    const mine = el('div', 'sbox'); mine.append(pv, name, bio, row, rl, save, msg);
    const q = el('input'); q.type = 'search'; q.placeholder = 'Find people by name'; q.setAttribute('aria-label', 'Find people'); const out = el('ul', 'plist');
    let t = 0; q.oninput = () => { clearTimeout(t); t = setTimeout(() => send({ t: 'search', q: q.value }), 250); };
    function render(list) {
      out.replaceChildren(); if (!list.length) { out.append(el('li', 'empty', q.value.trim() ? 'No one found' : 'Type a name to search')); return; }
      list.forEach(u => {
        const li = el('li'), info = el('div', 'pi'); info.append(el('b', null, u.n + (u.d ? ' \u00B7 ' + u.d : '')), el('small', null, (u.b || '') + (u.b ? ' \u00B7 ' : '') + u.fo + ' follower' + (u.fo === 1 ? '' : 's')));
        const acts = el('div', 'acts');
        if (!same(u.n, st.me)) {
          acts.append(btn('Message', () => open('d', u.n)),
            btn(st.prefs.following.includes(u.n.toLowerCase()) ? 'Unfollow' : 'Follow', () => send({ t: 'follow', name: u.n, on: !st.prefs.following.includes(u.n.toLowerCase()) })),
            btn(st.prefs.blocked.includes(u.n.toLowerCase()) ? 'Unblock' : 'Block', () => send({ t: 'block', name: u.n, on: !st.prefs.blocked.includes(u.n.toLowerCase()) }), 'bad'));
        }
        li.append(av(u.n), info, acts); out.append(li);
      });
    }
    let last = [];
    body.append(head('Your profile'), mine, head('Find people'), q, out); fillMine(); render([]);
    views.people = { update(m) { if (m.t === 'results' && m.q === q.value.trim().toLowerCase()) { last = m.users; render(last); } else if (m.t === 'prefs') { if (m.receipts !== undefined) rc.checked = m.receipts; if (q.value.trim()) send({ t: 'search', q: q.value }); } else if (m.t === 'profile' && same(m.name, st.me)) { fillMine(); msg.textContent = 'Saved'; } } };
  }

  /* ---------- Feed ---------- */
  function feed(body) {
    body.classList.add('soc'); const box = { all: { posts: [], more: false, loaded: false }, following: { posts: [], more: false, loaded: false } }; let scope = 'all';
    const ta = el('textarea'); ta.maxLength = 500; ta.rows = 2; ta.placeholder = 'Share something with the network'; ta.setAttribute('aria-label', 'New post');
    const post = btn('Post', () => { const v = ta.value.trim(); if (!v) return; send({ t: 'post', text: v }); ta.value = ''; });
    const tabs = el('div', 'row'), tAll = btn('Everyone', () => pick('all')), tFol = btn('Following', () => pick('following')), list = el('div', 'posts'), more = btn('Load more', () => { const b = box[scope]; send({ t: 'feed', scope, before: b.posts.length ? b.posts[b.posts.length - 1].ts : undefined }); });
    tabs.append(tAll, tFol);
    function pick(s) { scope = s; tAll.classList.toggle('on', s === 'all'); tFol.classList.toggle('on', s === 'following'); if (!box[s].loaded) send({ t: 'feed', scope: s }); render(); }
    function render() {
      const b = box[scope]; list.replaceChildren();
      if (!b.posts.length) list.append(el('p', 'empty', b.loaded ? (scope === 'following' ? 'Nothing yet. Follow people from the People window.' : 'No posts yet. Write the first one.') : 'Loading...'));
      b.posts.forEach(p => {
        const a = el('article', 'post'), h = el('div', 'ph2'); h.append(av(p.by), el('b', null, p.by), el('small', null, ago(p.ts))); a.append(h, el('p', null, p.text));
        const f = el('div', 'row'), liked = p.likes.includes(st.me), l = btn('\u2665 ' + p.likes.length, () => send({ t: 'like', id: p.id }), liked ? 'on' : ''); l.title = p.likes.join(', ') || 'Like'; l.setAttribute('aria-label', 'Like post'); f.append(l);
        if (p.by === st.me || st.admin) f.append(btn('Delete', () => send({ t: 'delpost', id: p.id }), 'bad')); a.append(f); list.append(a);
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
    top.append(btn('Mark all read', () => { st.notifs.forEach(n => { n.read = true; }); send({ t: 'notifread' }); render(); }));
    function render() {
      list.replaceChildren(); if (!st.notifs.length) { list.append(el('li', 'empty', 'No alerts yet')); return; }
      st.notifs.forEach(n => {
        const li = el('li', n.read ? '' : 'new'); li.append(av(n.from), el('div', 'pi', null)); const i = li.querySelector('.pi'); i.append(el('b', null, notifText(n)), el('small', null, ago(n.ts)));
        if (n.conv) { li.tabIndex = 0; li.onclick = () => { n.read = true; send({ t: 'notifread' }); const [k, id] = [n.conv[0], n.conv.slice(2)]; open(k === 'r' ? 'r' : 'd', k === 'r' ? id : (canon(id) || id)); render(); }; }
        list.append(li);
      });
    }
    body.append(top, list); render(); views.alerts = { update: render };
  }

  return { people, feed, alerts, onMsg(m) { Object.values(views).forEach(v => v.update(m)); } };
})();
