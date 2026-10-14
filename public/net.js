'use strict';
/* Visual layer: ambient mesh (decorative) and live topology of the real online users.
   The topology is drawn twice: a small map in the Network window and a large one as the desktop wallpaper. */
(function () {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const COL = { online: '51,255,102', away: '255,176,32', busy: '255,77,109' };
  const mesh = document.getElementById('mesh'), mg = mesh.getContext('2d');
  const topo = document.getElementById('topo'), tg = topo ? topo.getContext('2d') : null;
  const wall = document.getElementById('wall'), wg = wall ? wall.getContext('2d') : null;
  let meshOn = true, W = 0, H = 0, dpr = 1, nodes = [], peers = [], me = '', packets = [], hitsT = [], hitsW = [], hint = '', running = false, last = 0;
  const api = {
    onPick: null,
    setMesh(v) { meshOn = !!v; if (!meshOn) mg.clearRect(0, 0, W, H); else drawMesh(0); },
    setHint(t) { hint = t || ''; if (reduce.matches) drawAll(performance.now()); },
    update(o) { me = o.me; peers = o.users.filter(u => u.n !== o.me).map(u => ({ n: u.n, s: u.s })); if (reduce.matches) drawAll(performance.now()); else wake(); },
    pulse(name) { if (reduce.matches || !peers.some(p => p.n === name)) return; packets.push({ n: name, t0: performance.now() }); wake(); }
  };
  window.NetViz = api;

  function size() {
    dpr = Math.min(window.devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight;
    mesh.width = W * dpr; mesh.height = H * dpr; mg.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.round(Math.min(48, Math.max(16, W * H / 30000)));
    nodes = Array.from({ length: n }, () => ({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - .5) * .22, vy: (Math.random() - .5) * .22, r: Math.random() * 1.1 + .6, p: Math.random() * 6.28 }));
    if (meshOn) drawMesh(0); drawAll(performance.now());
  }
  function drawMesh(t) {
    mg.clearRect(0, 0, W, H);
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      if (!reduce.matches) { a.x += a.vx; a.y += a.vy; if (a.x < -20) a.x = W + 20; if (a.x > W + 20) a.x = -20; if (a.y < -20) a.y = H + 20; if (a.y > H + 20) a.y = -20; }
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j], dx = a.x - b.x, dy = a.y - b.y, d = dx * dx + dy * dy;
        if (d < 22500) { mg.strokeStyle = `rgba(51,255,102,${(1 - d / 22500) * 0.16})`; mg.lineWidth = 1; mg.beginPath(); mg.moveTo(a.x, a.y); mg.lineTo(b.x, b.y); mg.stroke(); }
      }
      mg.fillStyle = `rgba(51,255,102,${0.35 + 0.25 * Math.sin(t / 900 + a.p)})`; mg.beginPath(); mg.arc(a.x, a.y, a.r, 0, 6.283); mg.fill();
    }
  }
  /* one renderer for both maps; big = wallpaper */
  function drawGraph(cv, g, now, big, hits) {
    const w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const left = big ? Math.min(250, w * .3) : 0, cx = left + (w - left) / 2, cy = big ? h / 2 - 6 : h / 2 - 4;
    const rx = big ? Math.max(110, (w - left) / 2 - 110) : Math.max(30, w / 2 - 38), ry = big ? Math.max(80, h / 2 - 120) : Math.max(22, h / 2 - 24), s = big ? 8 : 6;
    const mono = big ? '12px ui-monospace,Consolas,monospace' : '10px ui-monospace,Consolas,monospace';
    g.lineWidth = 1; g.strokeStyle = `rgba(51,255,102,${big ? .1 : .1})`;
    (big ? [1, .72, .44] : [1, .55]).forEach(k => { g.beginPath(); g.ellipse(cx, cy, rx * k, ry * k, 0, 0, 6.283); g.stroke(); });
    if (big) { g.strokeStyle = 'rgba(51,255,102,.05)'; g.beginPath(); g.moveTo(cx - rx - 40, cy); g.lineTo(cx + rx + 40, cy); g.moveTo(cx, cy - ry - 30); g.lineTo(cx, cy + ry + 30); g.stroke(); }
    const n = peers.length, rot = reduce.matches ? 0 : now / (big ? 22000 : 14000); hits.length = 0;
    peers.forEach((p, i) => {
      const a = rot + i / n * 6.283 - 1.5708, x = cx + Math.cos(a) * rx, y = cy + Math.sin(a) * ry, c = COL[p.s] || COL.online;
      hits.push({ n: p.n, x, y });
      g.strokeStyle = `rgba(${c},.35)`; g.setLineDash([3, 4]); g.lineDashOffset = reduce.matches ? 0 : -now / 80; g.beginPath(); g.moveTo(x, y); g.lineTo(cx, cy); g.stroke(); g.setLineDash([]);
      g.fillStyle = `rgba(${c},.16)`; g.strokeStyle = `rgb(${c})`; g.fillRect(x - s, y - s, s * 2, s * 2); g.strokeRect(x - s - .5, y - s - .5, s * 2 + 1, s * 2 + 1);
      g.fillStyle = `rgb(${c})`; g.fillRect(x - s / 3, y - s / 3, s * 2 / 3, s * 2 / 3);
      g.fillStyle = 'rgba(216,245,227,.85)'; g.font = mono; g.textAlign = 'center';
      const nm = p.n.length > 12 ? p.n.slice(0, 11) + '\u2026' : p.n, ty = y + (y > cy ? s + 16 : -s - 8);
      g.fillText(nm, x, ty); if (big) { g.fillStyle = `rgba(${c},.8)`; g.font = '10px ui-monospace,Consolas,monospace'; g.fillText(p.s, x, ty + (y > cy ? 13 : -13)); }
    });
    packets = packets.filter(k => now - k.t0 < 900);
    packets.forEach(k => { const q = hits.find(z => z.n === k.n); if (!q) return; const f = (now - k.t0) / 900; g.fillStyle = '#e8fff0'; g.shadowColor = '#33ff66'; g.shadowBlur = 10; g.beginPath(); g.arc(q.x + (cx - q.x) * f, q.y + (cy - q.y) * f, big ? 3 : 2.4, 0, 6.283); g.fill(); g.shadowBlur = 0; });
    const pulse = reduce.matches ? 0 : (Math.sin(now / 500) + 1) / 2, R = big ? 9 : 6;
    g.fillStyle = `rgba(51,255,102,${.12 + pulse * .12})`; g.beginPath(); g.arc(cx, cy, R * 2.4 + pulse * 3, 0, 6.283); g.fill();
    g.fillStyle = '#33ff66'; g.shadowColor = '#33ff66'; g.shadowBlur = 14; g.beginPath(); g.arc(cx, cy, R, 0, 6.283); g.fill(); g.shadowBlur = 0;
    g.fillStyle = 'rgba(216,245,227,.9)'; g.font = mono; g.textAlign = 'center'; g.fillText(big && me ? me : 'YOU', cx, cy + R + 16);
    if (big) {
      g.textAlign = 'left'; g.fillStyle = 'rgba(138,165,149,.95)'; g.font = '11px ui-monospace,Consolas,monospace';
      g.fillText('NETWORK TOPOLOGY  /  ' + (n + 1) + ' NODE' + (n ? 'S' : '') + ' ONLINE', left + 18, 34);
      if (hint) { g.textAlign = 'center'; g.fillStyle = 'rgba(138,165,149,.8)'; g.fillText(hint, cx, h - 26); }
    } else if (!n) { g.fillStyle = 'rgba(127,154,138,.9)'; g.textAlign = 'center'; g.fillText('no other nodes online', cx, cy - 22); }
  }
  const wallOn = () => wall && wall.clientWidth > 0;
  function drawAll(now) { drawTopo(now); if (wallOn()) drawGraph(wall, wg, now, true, hitsW); }
  function drawTopo(now) { if (tg && topo.clientWidth) drawGraph(topo, tg, now, false, hitsT); }
  function loop(now) {
    if (document.hidden) { running = false; return; }
    if (now - last >= 33) { last = now; if (meshOn) drawMesh(now); drawAll(now); }
    requestAnimationFrame(loop);
  }
  function wake() { if (running || reduce.matches) return; running = true; requestAnimationFrame(loop); }
  function pick(cv, hits, e) {
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const h = hits.map(q => ({ q, d: Math.hypot(q.x - x, q.y - y) })).sort((a, b) => a.d - b.d)[0];
    return h && h.d < 22 ? h.q.n : '';
  }
  [[topo, hitsT], [wall, hitsW]].forEach(([cv, hits]) => {
    if (!cv) return;
    cv.addEventListener('pointerdown', e => { const n = pick(cv, hits, e); if (n && api.onPick) api.onPick(n); });
    cv.addEventListener('pointermove', e => { cv.style.cursor = pick(cv, hits, e) ? 'pointer' : 'default'; });
  });
  addEventListener('resize', size);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
  reduce.addEventListener && reduce.addEventListener('change', () => { size(); wake(); });
  size(); wake();
})();
