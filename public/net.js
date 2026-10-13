'use strict';
/* Visual layer: ambient network mesh (decorative) + live topology of the real online users. */
(function () {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const COL = { online: '51,255,102', away: '255,176,32', busy: '255,77,109' };
  const mesh = document.getElementById('mesh'), mg = mesh.getContext('2d');
  const topo = document.getElementById('topo'), tg = topo ? topo.getContext('2d') : null;
  let meshOn = true, W = 0, H = 0, dpr = 1, nodes = [], peers = [], me = '', packets = [], hits = [], running = false, last = 0;
  const api = {
    onPick: null,
    setMesh(v) { meshOn = !!v; if (!meshOn) mg.clearRect(0, 0, W, H); else drawMesh(0); },
    update(o) { me = o.me; peers = o.users.filter(u => u.n !== o.me).map(u => ({ n: u.n, s: u.s })); if (reduce.matches) drawTopo(performance.now()); else wake(); },
    pulse(name) { if (reduce.matches || !peers.some(p => p.n === name)) return; packets.push({ n: name, t0: performance.now() }); wake(); }
  };
  window.NetViz = api;

  function size() {
    dpr = Math.min(window.devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight;
    mesh.width = W * dpr; mesh.height = H * dpr; mg.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.round(Math.min(48, Math.max(16, W * H / 30000)));
    nodes = Array.from({ length: n }, () => ({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - .5) * .22, vy: (Math.random() - .5) * .22, r: Math.random() * 1.1 + .6, p: Math.random() * 6.28 }));
    if (meshOn) drawMesh(0); drawTopo(performance.now());
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
      const glow = 0.35 + 0.25 * Math.sin(t / 900 + a.p);
      mg.fillStyle = `rgba(51,255,102,${glow})`; mg.beginPath(); mg.arc(a.x, a.y, a.r, 0, 6.283); mg.fill();
    }
  }
  function drawTopo(now) {
    if (!tg || !topo.clientWidth || !topo.clientHeight) return;
    const w = topo.clientWidth, h = topo.clientHeight;
    if (topo.width !== Math.round(w * dpr) || topo.height !== Math.round(h * dpr)) { topo.width = Math.round(w * dpr); topo.height = Math.round(h * dpr); }
    tg.setTransform(dpr, 0, 0, dpr, 0, 0); tg.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2 - 4, rx = Math.max(30, w / 2 - 38), ry = Math.max(22, h / 2 - 24);
    tg.lineWidth = 1; tg.strokeStyle = 'rgba(51,255,102,.10)';
    [1, .55].forEach(k => { tg.beginPath(); tg.ellipse(cx, cy, rx * k, ry * k, 0, 0, 6.283); tg.stroke(); });
    const n = peers.length, rot = reduce.matches ? 0 : now / 14000; hits = [];
    peers.forEach((p, i) => {
      const a = rot + i / n * 6.283 - 1.5708, x = cx + Math.cos(a) * rx, y = cy + Math.sin(a) * ry, c = COL[p.s] || COL.online;
      hits.push({ n: p.n, x, y });
      tg.strokeStyle = `rgba(${c},.35)`; tg.setLineDash([3, 4]); tg.lineDashOffset = reduce.matches ? 0 : -now / 80;
      tg.beginPath(); tg.moveTo(x, y); tg.lineTo(cx, cy); tg.stroke(); tg.setLineDash([]);
      tg.fillStyle = `rgba(${c},.16)`; tg.strokeStyle = `rgb(${c})`; tg.lineWidth = 1; tg.fillRect(x - 6, y - 6, 12, 12); tg.strokeRect(x - 6.5, y - 6.5, 13, 13);
      tg.fillStyle = `rgb(${c})`; tg.fillRect(x - 2, y - 2, 4, 4);
      tg.fillStyle = 'rgba(216,245,227,.78)'; tg.font = '10px ui-monospace,Consolas,monospace'; tg.textAlign = 'center';
      tg.fillText(p.n.length > 9 ? p.n.slice(0, 8) + '\u2026' : p.n, x, y + (y > cy ? 18 : -11));
    });
    packets = packets.filter(k => now - k.t0 < 900);
    packets.forEach(k => { const h = hits.find(q => q.n === k.n); if (!h) return; const f = (now - k.t0) / 900; tg.fillStyle = '#e8fff0'; tg.shadowColor = '#33ff66'; tg.shadowBlur = 10; tg.beginPath(); tg.arc(h.x + (cx - h.x) * f, h.y + (cy - h.y) * f, 2.4, 0, 6.283); tg.fill(); tg.shadowBlur = 0; });
    const pulse = reduce.matches ? 0 : (Math.sin(now / 500) + 1) / 2;
    tg.fillStyle = `rgba(51,255,102,${.12 + pulse * .12})`; tg.beginPath(); tg.arc(cx, cy, 15 + pulse * 3, 0, 6.283); tg.fill();
    tg.fillStyle = '#33ff66'; tg.shadowColor = '#33ff66'; tg.shadowBlur = 12; tg.beginPath(); tg.arc(cx, cy, 6, 0, 6.283); tg.fill(); tg.shadowBlur = 0;
    tg.fillStyle = 'rgba(216,245,227,.85)'; tg.font = '10px ui-monospace,Consolas,monospace'; tg.textAlign = 'center'; tg.fillText('YOU', cx, cy + 20);
    if (!n) { tg.fillStyle = 'rgba(127,154,138,.9)'; tg.fillText('no other nodes online', cx, cy - 22); }
  }
  function loop(now) {
    if (document.hidden) { running = false; return; }
    if (now - last >= 33) { last = now; if (meshOn) drawMesh(now); drawTopo(now); }
    requestAnimationFrame(loop);
  }
  function wake() { if (running || reduce.matches) return; running = true; requestAnimationFrame(loop); }
  topo && topo.addEventListener('pointerdown', e => {
    const r = topo.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const h = hits.map(q => ({ q, d: Math.hypot(q.x - x, q.y - y) })).sort((a, b) => a.d - b.d)[0];
    if (h && h.d < 20 && api.onPick) api.onPick(h.q.n);
  });
  addEventListener('resize', size);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
  reduce.addEventListener && reduce.addEventListener('change', () => { size(); wake(); });
  size(); wake();
})();
