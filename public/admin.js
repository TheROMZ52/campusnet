'use strict';
/* Admin window (administrators only): users (suspend, reset password, delete), server status and registration, backups.
   Every action is checked again on the server, hiding the window is only a convenience. */
const Admin = (function () {
  let users = [], stats = null, tab = 'users', result = null, rendered = false;
  const views = {}, btn = (t, fn, cls) => { const b = el('button', 'btn sm' + (cls ? ' ' + cls : ''), t); b.type = 'button'; b.onclick = fn; return b; };
  const refresh = () => { send({ t: 'adminusers' }); send({ t: 'adminstats' }); };
  const dt = ts => ts ? new Date(ts).toLocaleString(I18N.lang === 'fa' ? 'fa-IR-u-ca-persian' : undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '-';
  const dur = s => { const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return (d ? d + 'd ' : '') + (h || d ? h + 'h ' : '') + m + 'm'; };

  function renderUsers() {
    const v = views.users; if (!v) return; const q = v.search.value.trim().toLowerCase(); v.list.replaceChildren();
    const shown = users.filter(u => !q || u.n.toLowerCase().includes(q));
    if (!shown.length) { v.list.append(el('li', 'empty', tr('No one found'))); return; }
    shown.forEach(u => {
      const li = el('li'), info = el('div', 'pi'), flags = [u.admin ? tr('admin') : '', u.online ? tr('online') : '', u.banned ? tr('suspended') : ''].filter(Boolean).join(' \u00B7 ');
      info.append(el('b', null, u.n + (flags ? '  \u00B7 ' + flags : '')), el('small', null, tr('Last seen {time}', { time: u.online ? tr('now') : dt(u.last) }) + ' \u00B7 ' + trn(u.files, '{n} file', '{n} files') + ' (' + fmt(u.bytes) + ')'));
      const a = el('div', 'acts');
      if (!u.admin) {
        a.append(btn(tr(u.banned ? 'Restore' : 'Suspend'), async () => { if (u.banned || await ask({ title: tr('Suspend {name}?', { name: u.n }), text: tr('They are signed out and cannot sign in until restored.'), ok: tr('Suspend'), danger: true })) send({ t: 'adminban', name: u.n, on: !u.banned }); }),
          btn(tr('Reset password'), async () => { if (await ask({ title: tr('Reset the password of {name}?', { name: u.n }), text: tr('They get a temporary password and a new encryption identity, so they cannot read their old private messages.'), ok: tr('Reset password'), danger: true })) send({ t: 'adminreset', name: u.n }); }),
          btn(tr('Delete'), async () => { if (await ask({ title: tr('Delete {name}?', { name: u.n }), text: tr('Their account, files, posts, groups they own and private messages are deleted for good. This cannot be undone.'), ok: tr('Delete'), danger: true })) send({ t: 'admindelete', name: u.n }); }, 'bad'));
      }
      li.append(info, a); v.list.append(li);
    });
  }
  function renderResult() {
    const r = views.users && views.users.result; if (!r) return; r.replaceChildren(); r.hidden = !result; if (!result) return;
    const code = el('code', 'temp', result.temp); code.dir = 'ltr';
    r.append(el('b', null, tr('Temporary password for {name}', { name: result.name })), code, el('small', 'note', tr('Give it to them in person. It is shown only once.')),
      btn(tr('Copy'), async () => { try { await navigator.clipboard.writeText(result.temp); toast(tr('Copied'), 'ok', 1500); } catch { toast(tr('Copy failed'), 'warn'); } }), btn(tr('Dismiss'), () => { result = null; renderResult(); }));
  }
  function renderServer() {
    const v = views.server; if (!v) return; v.replaceChildren(); if (!stats) { v.append(el('p', 'empty', tr('Loading...'))); return; }
    const grid = el('div', 'stats'); [[stats.users, tr('Users')], [stats.online, tr('Online now')], [stats.files, tr('Files')], [fmt(stats.bytes) + ' / ' + fmt(stats.quota), tr('Storage')], [fmt(stats.dataBytes), tr('Data folder')], [dur(stats.uptime), tr('Uptime')], ['v' + stats.version, tr('Version')], [stats.node, 'Node.js']].forEach(([n, l]) => { const c = el('div', 'stat2'); c.append(el('b', null, String(n)), el('small', null, l)); grid.append(c); });
    const open = stats.registration !== 'closed', box = el('div', 'sbox'); box.append(el('b', null, tr(open ? 'New accounts are allowed' : 'New accounts are closed')), el('small', 'note', tr('Closing registration does not affect people who already have an account.')), btn(tr(open ? 'Close registration' : 'Open registration'), () => send({ t: 'adminreg', open: !open }), open ? 'bad' : ''));
    v.append(grid, box);
  }
  function renderBackups() {
    const v = views.backups; if (!v) return; v.replaceChildren(); if (!stats) { v.append(el('p', 'empty', tr('Loading...'))); return; }
    const top = el('div', 'row'), snap = el('a', 'btn sm', tr('Download snapshot')); snap.href = '/f/backup/now'; snap.download = ''; snap.onclick = () => setTimeout(() => send({ t: 'adminstats' }), 2500);
    top.append(btn(tr('Back up now'), () => send({ t: 'adminbackup' })), snap);
    const info = el('p', 'note', stats.backupHours > 0 ? tr('Automatic backup every {n} h, keeping the last {k}.', { n: stats.backupHours, k: stats.backupKeep }) : tr('Automatic backups are off.'));
    const ul = el('ul'); if (!stats.backups.length) ul.append(el('li', 'empty', tr('No backups yet')));
    stats.backups.forEach(b => { const li = el('li'), i = el('div', 'pi'), dl = el('a', 'btn sm', tr('Download')); dl.href = '/f/backup/' + encodeURIComponent(b.name); dl.download = b.name; i.append(el('b', null, b.name), el('small', null, dt(b.ts) + ' \u00B7 ' + fmt(b.size))); const a = el('div', 'acts'); a.append(dl, btn(tr('Delete'), async () => { if (await ask({ title: tr('Delete backup'), text: b.name, ok: tr('Delete'), danger: true })) send({ t: 'adminrmbackup', file: b.name }); }, 'bad')); li.append(i, a); ul.append(li); });
    v.append(top, info, ul, el('p', 'note', tr('A backup holds accounts, messages and settings but not uploaded files: copy the uploads folder separately. To restore, stop the server and run: node scripts/restore.js <file> --yes')));
  }
  function show() { ['users', 'server', 'backups'].forEach(k => { const v = views[k]; if (v) (v.root || v).hidden = k !== tab; }); [...views.tabs.children].forEach(b => b.classList.toggle('on', b.dataset.tab === tab)); }
  function build(body) {
    body.classList.add('soc', 'admin'); const tabs = el('div', 'row'); views.tabs = tabs;
    [['users', tr('Users')], ['server', tr('Server')], ['backups', tr('Backups')]].forEach(([k, l]) => { const b = btn(l, () => { tab = k; show(); if (k !== 'users') send({ t: 'adminstats' }); }); b.dataset.tab = k; tabs.append(b); });
    const uroot = el('div', 'glist'), search = el('input'), list = el('ul'), res = el('div', 'sbox temp-box'); search.type = 'search'; search.placeholder = tr('Search users'); search.setAttribute('aria-label', tr('Search users')); search.oninput = renderUsers; res.hidden = true;
    uroot.append(search, res, list); views.users = { root: uroot, search, list, result: res }; views.server = el('div', 'glist'); views.backups = el('div', 'glist');
    body.append(tabs, uroot, views.server, views.backups); rendered = true; show(); renderUsers(); renderServer(); renderBackups(); refresh();
  }
  function onMsg(m) {
    if (!rendered) return;
    if (m.t === 'adminusers') { users = m.users; renderUsers(); }
    else if (m.t === 'adminstats') { stats = m; renderServer(); renderBackups(); }
    else if (m.t === 'adminresult') { if (m.action === 'reset') { result = m; renderResult(); } toast(tr({ ban: 'Account suspended', unban: 'Account restored', reset: 'Password reset', delete: 'Account deleted' }[m.action] || 'Done'), 'ok', 2500); send({ t: 'adminusers' }); }
  }
  return { build, onMsg };
})();
