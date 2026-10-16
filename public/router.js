'use strict';
/* In-app navigation history: Back/Forward move between conversations and Home, they never leave the app.
   Also remembers the current conversation for a reload (sessionStorage), and supports links like #/c/d/bob. */
(function () {
  let started = false, applying = false;
  const parse = h => { const m = /^#\/c\/([rdb])\/(.+)$/.exec(h || ''); return m ? { k: m[1], id: decodeURIComponent(m[2]) } : null; };
  const valid = c => !!c && (c.k === 'b' || (c.k === 'r' && ((st.rooms || []).includes(c.id) || !!(c.id.startsWith('g:') && st.groups[c.id.slice(2)]))) || (c.k === 'd' && !!canon(c.id)));
  const href = () => st.cur.k === 'b' ? '#/c/b/board' : '#/c/' + st.cur.k + '/' + encodeURIComponent(st.cur.id);
  const remember = () => { try { sessionStorage.setItem('cn:cur', JSON.stringify({ k: st.cur.k, id: st.cur.id })); } catch { /* ignore */ } };
  const _open = open;
  open = function (k, id) {
    _open.apply(this, arguments); if (!started) return; remember();
    if (!applying && location.hash !== href()) history.pushState({ r: 'c', k: st.cur.k, id: st.cur.id }, '', href());
  };
  function start() {
    if (started) return; started = true;
    let want = parse(location.hash); if (!valid(want)) { try { want = JSON.parse(sessionStorage.getItem('cn:cur')); } catch { want = null; } }
    history.replaceState({ r: 'home' }, '', '#/home'); history.pushState({ r: 'app' }, '', '#/app');
    if (valid(want)) { _open(want.k, want.id === undefined ? '' : (want.k === 'd' ? canon(want.id) : want.id)); if (window.Shell) Shell.launch('chat'); history.pushState({ r: 'c', k: st.cur.k, id: st.cur.id }, '', href()); }
    remember();
  }
  document.addEventListener('cn:state', () => { if (!$('#app').hidden && st.me) start(); });
  window.addEventListener('popstate', e => {
    if (!started || $('#app').hidden) return; const s = e.state || {}; applying = true;
    try {
      if (s.r === 'c' && valid(s)) { _open(s.k, s.k === 'd' ? canon(s.id) : s.id); remember(); if (window.Shell) Shell.launch('chat'); }
      else { if (window.Shell) Shell.launch('home'); if (s.r !== 'app') history.pushState({ r: 'app' }, '', '#/app'); }
    } finally { applying = false; }
  });
})();
