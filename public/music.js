'use strict';
/* Music: the library is every audio file shared on the network. One global player keeps playing when its window is closed.
   Streaming uses /f/<id>?audio=1 (HTTP byte ranges, so seeking works). */
const Music = (function () {
  Object.assign(P, {
    music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
    home: '<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>',
    play: '<path d="M7 4l13 8-13 8z"/>', pause: '<path d="M8 4v16M16 4v16"/>',
    next: '<path d="M5 5l10 7-10 7zM19 5v14"/>', prev: '<path d="M19 5 9 12l10 7zM5 5v14"/>'
  });
  const A = new Audio(); A.preload = 'metadata';
  const S = { id: null, shuffle: false, repeat: 'off', vol: 0.8 };
  try { const o = JSON.parse(localStorage.getItem('cn:music')) || {}; if (typeof o.vol === 'number') S.vol = Math.min(1, Math.max(0, o.vol)); S.shuffle = !!o.shuffle; if (['off', 'all', 'one'].includes(o.repeat)) S.repeat = o.repeat; } catch { /* ignore */ }
  A.volume = S.vol;
  const subs = new Set(); let tt = 0;
  const tick = () => { clearTimeout(tt); tt = setTimeout(() => subs.forEach(f => { try { f(); } catch (e) { console.error(e); } }), 60); };
  const save = () => { try { localStorage.setItem('cn:music', JSON.stringify({ vol: S.vol, shuffle: S.shuffle, repeat: S.repeat })); } catch { /* ignore */ } };
  const tracks = () => (st.files || []).filter(f => f.aud);
  const byId = id => (st.files || []).find(f => f.id === id);
  const label = f => { const n = f.name.replace(/\.[a-z0-9]+$/i, ''), m = /^(.+?)\s+-\s+(.+)$/.exec(n); return m ? { artist: m[1], title: m[2] } : { artist: f.owner, title: n }; };
  const fmt = s => { if (!isFinite(s)) return '0:00'; s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  function meta(f) {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    try {
      const l = label(f); navigator.mediaSession.metadata = new MediaMetadata({ title: l.title, artist: l.artist });
      navigator.mediaSession.setActionHandler('play', () => toggle()); navigator.mediaSession.setActionHandler('pause', () => toggle());
      navigator.mediaSession.setActionHandler('nexttrack', () => step(1)); navigator.mediaSession.setActionHandler('previoustrack', () => step(-1));
    } catch { /* optional API */ }
  }
  function play(id) {
    const f = byId(id); if (!f || !f.aud) { toast('That track is no longer available', 'warn'); return; }
    if (S.id !== id) { S.id = id; A.src = `/f/${encodeURIComponent(id)}?audio=1`; }
    meta(f); A.play().catch(() => toast('Playback was blocked or the file cannot be played', 'bad')); tick();
  }
  function toggle() { if (!S.id) { const t = tracks(); if (t.length) play(t[0].id); return; } if (A.paused) A.play().catch(() => toast('Playback blocked', 'bad')); else A.pause(); }
  function step(d) {
    const t = tracks(); if (!t.length) return; let i = t.findIndex(x => x.id === S.id);
    if (S.shuffle && t.length > 1) { let j; do { j = Math.floor(Math.random() * t.length); } while (j === i); i = j; } else i = i < 0 ? 0 : (i + d + t.length) % t.length;
    play(t[i].id);
  }
  A.addEventListener('ended', () => { if (S.repeat === 'one') { A.currentTime = 0; A.play().catch(() => {}); return; } const t = tracks(), i = t.findIndex(x => x.id === S.id); if (S.repeat === 'all' || S.shuffle || i < t.length - 1) step(1); else tick(); });
  A.addEventListener('error', () => { if (S.id) toast('This audio file cannot be played in your browser', 'bad'); tick(); });
  ['play', 'pause', 'timeupdate', 'durationchange', 'loadedmetadata', 'volumechange', 'emptied'].forEach(ev => A.addEventListener(ev, tick));
  document.addEventListener('cn:state', () => { if (S.id && !byId(S.id) && st.files) { A.pause(); S.id = null; A.removeAttribute('src'); A.load(); } tick(); });

  const ib = (name, lab, fn) => { const b = el('button', 'btn sm ic'); b.type = 'button'; b.append(icon(name)); b.setAttribute('aria-label', lab); b.title = lab; b.onclick = fn; return b; };
  const setSong = id => send({ t: 'profile', display: st.myProfile.d || '', bio: st.myProfile.b || '', receipts: st.prefs.receipts !== false, music: id });

  function build(body) {
    body.classList.add('soc', 'music');
    const title = el('div', 'mt'), sub = el('div', 'ms'), seek = el('input'), tc = el('small', null, '0:00'), td = el('small', null, '0:00'), list = el('ul', 'tlist');
    seek.type = 'range'; seek.min = 0; seek.max = 1000; seek.value = 0; seek.setAttribute('aria-label', 'Seek'); let drag = false;
    seek.oninput = () => { drag = true; tc.textContent = fmt(seek.value / 1000 * A.duration); };
    seek.onchange = () => { if (isFinite(A.duration)) A.currentTime = seek.value / 1000 * A.duration; drag = false; };
    const pp = ib('play', 'Play', toggle), sh = el('button', 'btn sm', 'Shuffle'), rp = el('button', 'btn sm'), vol = el('input');
    sh.type = rp.type = 'button'; sh.onclick = () => { S.shuffle = !S.shuffle; save(); tick(); };
    rp.onclick = () => { S.repeat = { off: 'all', all: 'one', one: 'off' }[S.repeat]; save(); tick(); };
    vol.type = 'range'; vol.min = 0; vol.max = 100; vol.value = Math.round(S.vol * 100); vol.setAttribute('aria-label', 'Volume'); vol.oninput = () => { S.vol = vol.value / 100; A.volume = S.vol; save(); };
    const file = el('input'); file.type = 'file'; file.multiple = true; file.hidden = true; file.accept = 'audio/*,.mp3,.ogg,.oga,.opus,.wav,.m4a,.aac,.flac,.weba';
    file.onchange = () => { const ok = [...file.files].filter(f => /\.(mp3|ogg|oga|opus|wav|m4a|aac|flac|weba)$/i.test(f.name)); if (ok.length < file.files.length) toast('Only audio files can be added here', 'warn'); if (ok.length) { enqueue(ok); toast('Uploading ' + ok.length + ' track' + (ok.length > 1 ? 's' : '') + '...', 'ok'); } file.value = ''; };
    const up = el('button', 'btn sm', 'Upload music'); up.type = 'button'; up.onclick = () => file.click();
    const bar = el('div', 'row'); bar.append(ib('prev', 'Previous track', () => step(-1)), pp, ib('next', 'Next track', () => step(1)), sh, rp);
    const now = el('div', 'sbox'), tm = el('div', 'tm'); tm.append(tc, seek, td); now.append(title, sub, tm, bar, el('label', 'chk', 'Volume'), vol);
    body.append(now, up, file, list);
    let sig = '';
    function update() {
      const f = S.id && byId(S.id), l = f ? label(f) : null;
      title.textContent = l ? l.title : 'Nothing playing'; sub.textContent = l ? l.artist + ' \u00B7 shared by ' + f.owner : 'Pick a track below or upload one';
      pp.replaceChildren(icon(A.paused ? 'play' : 'pause')); pp.setAttribute('aria-label', A.paused ? 'Play' : 'Pause');
      if (!drag) { seek.value = isFinite(A.duration) && A.duration ? Math.round(A.currentTime / A.duration * 1000) : 0; tc.textContent = fmt(A.currentTime); } td.textContent = fmt(A.duration);
      sh.classList.toggle('on', S.shuffle); rp.textContent = 'Repeat: ' + S.repeat; rp.classList.toggle('on', S.repeat !== 'off');
      const t = tracks(), mine = st.myProfile.m && st.myProfile.m.id, s2 = t.map(x => x.id).join() + '|' + S.id + '|' + A.paused + '|' + mine + '|' + st.me;
      if (s2 === sig) return; sig = s2; list.replaceChildren();
      if (!t.length) { list.append(el('li', 'empty', 'No music yet. Upload the first track.')); return; }
      t.forEach(x => {
        const li = el('li', x.id === S.id ? 'new' : ''), lb = label(x), info = el('div', 'pi'), a = el('div', 'acts');
        const pb = ib(x.id === S.id && !A.paused ? 'pause' : 'play', x.id === S.id && !A.paused ? 'Pause ' + lb.title : 'Play ' + lb.title, () => (x.id === S.id ? toggle() : play(x.id)));
        info.append(el('b', null, lb.title), el('small', null, lb.artist + ' \u00B7 ' + fmtSize(x.size) + ' \u00B7 ' + x.owner));
        const on = mine === x.id; a.append(btn2(on ? 'Remove from profile' : 'Profile song', () => setSong(on ? '' : x.id)));
        if (x.owner === st.me || st.admin) a.append(btn2('Delete', async () => { if (await ask({ title: 'Delete track', text: `"${x.name}" will be removed for everyone.`, ok: 'Delete', danger: true })) send({ t: 'delfile', id: x.id }); }, 'bad'));
        li.append(pb, info, a); list.append(li);
      });
    }
    const fmtSize = n => n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
    const btn2 = (t, fn, c) => { const b = el('button', 'btn sm' + (c ? ' ' + c : ''), t); b.type = 'button'; b.onclick = fn; return b; };
    subs.add(update); update();
  }
  /* compact player for the Home page */
  function mini() {
    const box = el('div', 'mini'), t = el('div', 'pi'), nm = el('b'), sb = el('small'), pp = ib('play', 'Play', toggle);
    t.append(nm, sb); box.append(ib('prev', 'Previous track', () => step(-1)), pp, ib('next', 'Next track', () => step(1)), t);
    const upd = () => { const f = S.id && byId(S.id), l = f ? label(f) : null; nm.textContent = l ? l.title : 'Nothing playing'; sb.textContent = l ? l.artist : (tracks().length ? tracks().length + ' tracks in the library' : 'No music yet'); pp.replaceChildren(icon(A.paused ? 'play' : 'pause')); };
    subs.add(upd); upd(); box.dispose = () => subs.delete(upd); return box;
  }
  return { build, mini, play, toggle, step, label, tracks, on: f => { subs.add(f); return () => subs.delete(f); }, state: () => ({ id: S.id, paused: A.paused, time: A.currentTime, duration: A.duration, src: A.currentSrc }) };
})();
