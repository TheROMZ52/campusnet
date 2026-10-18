'use strict';
/* One-to-one voice calls. Signaling and audio frames travel over the existing WebSocket; the server only relays.
   Audio: 8 kHz telephone-quality voice (see call-worklet.js), every frame encrypted in the browser with the same AES-GCM key as direct messages. */
const Call = (function () {
  const S = { id: '', peer: '', role: '', status: 'idle', muted: false, t0: 0, seq: 0, last: -1, nonce: null, key: null, ctx: null, stream: null, cap: null, ply: null, bad: 0, chain: Promise.resolve(), stats: { sent: 0, recv: 0, dropped: 0, level: 0, peak: 0, played: 0 } };
  let box = null, tick = 0, ring = 0, guard = 0;
  const te = new TextEncoder(), b64 = u => btoa(String.fromCharCode(...u)), unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const dirOut = () => (S.role === 'caller' ? 0 : 1), dirIn = () => (S.role === 'caller' ? 1 : 0);
  const iv = (dir, seq) => { const v = new Uint8Array(12); v.set(S.nonce, 0); v[4] = dir; new DataView(v.buffer).setUint32(8, seq); return v; };   // unique per call, direction and frame
  const aad = dir => te.encode(S.id + ':' + dir);
  const supported = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.AudioWorklet && window.AudioContext && CN.supported && !IS_DEMO);
  const clock = () => { const s = Math.floor((Date.now() - S.t0) / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

  function ui() {
    if (box) return box; box = el('div', 'callbox'); box.hidden = true; box.setAttribute('role', 'alertdialog'); box.setAttribute('aria-live', 'assertive'); document.body.append(box); return box;
  }
  function render() {
    const b = ui(); b.replaceChildren(); if (S.status === 'idle') { b.hidden = true; return; } b.hidden = false;
    const status = { preparing: tr('Connecting...'), calling: tr('Calling {name}...', { name: S.peer }), ringing: tr('Ringing...'), incoming: tr('{name} is calling', { name: S.peer }), active: tr('Connected') + ' \u00B7 ' + clock() }[S.status] || '';
    const btn = (txt, fn, cls) => { const x = el('button', 'btn sm' + (cls ? ' ' + cls : ''), txt); x.type = 'button'; x.onclick = fn; return x; };
    const row = el('div', 'row'); b.append(el('div', 'cn', S.peer), el('div', 'cs', status), el('small', 'cz', '\uD83D\uDD12 ' + tr('End-to-end encrypted voice call')));
    if (S.status === 'incoming') row.append(btn(tr('Accept'), accept, 'ok'), btn(tr('Decline'), decline, 'bad'));
    else { if (S.status === 'active') row.append(btn(S.muted ? tr('Unmute microphone') : tr('Mute microphone'), mute, S.muted ? 'on' : '')); row.append(btn(S.status === 'active' ? tr('End call') : tr('Cancel'), end, 'bad')); }
    b.append(row);
  }
  function setStatus(x) { S.status = x; render(); clearInterval(tick); if (x === 'active') tick = setInterval(render, 1000); btn(); }

  async function prepare(peer) {
    if (!supported()) throw new Error(tr(IS_DEMO ? 'Voice calls are not available in demo mode.' : CN.supported ? 'Voice calls are not supported in this browser.' : 'Voice calls need HTTPS or localhost.'));
    if (!E2E.priv) throw new Error(tr('Unlock encrypted messages first to make calls.'));
    S.key = await sharedFor(peer);
    S.ctx = new AudioContext({ latencyHint: 'interactive' }); await S.ctx.resume(); await S.ctx.audioWorklet.addModule('call-worklet.js');
    try { S.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } }); } catch { throw new Error(tr('Microphone access was denied.')); }
  }
  function reset() {
    clearInterval(tick); clearInterval(ring); clearTimeout(guard);
    try { if (S.stream) S.stream.getTracks().forEach(t => t.stop()); } catch { /* ignore */ }
    try { if (S.cap) S.cap.disconnect(); if (S.ply) S.ply.disconnect(); if (S.ctx) S.ctx.close(); } catch { /* ignore */ }
    Object.assign(S, { id: '', peer: '', role: '', status: 'idle', muted: false, t0: 0, seq: 0, last: -1, nonce: null, key: null, ctx: null, stream: null, cap: null, ply: null, bad: 0, chain: Promise.resolve() });
    render(); btn();
  }
  function finish(msg, kind) { const dur = S.t0 ? clock() : ''; reset(); toast(dur && !msg ? tr('Call ended ({time})', { time: dur }) : msg || tr('Call ended'), kind || 'ok', 4000); }

  async function start(peer) {
    if (S.status !== 'idle') return; S.peer = peer; S.role = 'caller'; setStatus('preparing');
    try { await prepare(peer); } catch (e) { reset(); toast(e.message || tr('Call failed'), 'bad', 5000); return; }
    if (S.status !== 'preparing') return;   // cancelled while the microphone prompt was open
    S.nonce = crypto.getRandomValues(new Uint8Array(4)); send({ t: 'call', to: peer, nonce: b64(S.nonce) });
    guard = setTimeout(() => { if (S.status === 'preparing' && !S.id) finish(tr('Call failed'), 'bad'); }, 10000);
  }
  async function accept() {
    if (S.status !== 'incoming') return; const id = S.id, peer = S.peer; clearInterval(ring); setStatus('preparing');
    try { await prepare(peer); } catch (e) { send({ t: 'callans', id, accept: false }); reset(); toast(e.message || tr('Call failed'), 'bad', 5000); return; }
    send({ t: 'callans', id, accept: true });
  }
  function decline() { if (S.id) send({ t: 'callans', id: S.id, accept: false }); reset(); }
  function end() { const id = S.id; if (id) send({ t: 'callend', id }); finish(); }
  function mute() { S.muted = !S.muted; if (S.stream) S.stream.getAudioTracks().forEach(t => { t.enabled = !S.muted; }); render(); }

  function startMedia() {
    S.t0 = Date.now(); S.chain = Promise.resolve();
    const src = S.ctx.createMediaStreamSource(S.stream); S.cap = new AudioWorkletNode(S.ctx, 'cn-capture'); const mute0 = S.ctx.createGain(); mute0.gain.value = 0;
    src.connect(S.cap); S.cap.connect(mute0); mute0.connect(S.ctx.destination);
    S.ply = new AudioWorkletNode(S.ctx, 'cn-player', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] }); S.ply.connect(S.ctx.destination);
    S.cap.port.onmessage = e => sendFrame(new Uint8Array(e.data)); S.ply.port.onmessage = e => Object.assign(S.stats, e.data);
    Object.assign(S.stats, { sent: 0, recv: 0, dropped: 0, level: 0, peak: 0, played: 0 }); setStatus('active');
  }
  function sendFrame(pcm) {
    if (S.status !== 'active' || S.muted || !st.ws || st.ws.readyState !== 1 || st.ws.bufferedAmount > 131072) return;
    const seq = S.seq++, dir = dirOut(), id = S.id, key = S.key;
    S.chain = S.chain.then(async () => {
      if (S.id !== id) return; const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv(dir, seq), additionalData: aad(dir) }, key, pcm));
      const out = new Uint8Array(5 + ct.length); out[0] = 1; new DataView(out.buffer).setUint32(1, seq); out.set(ct, 5); if (st.ws && st.ws.readyState === 1) { st.ws.send(out); S.stats.sent++; }
    }).catch(() => {});
  }
  function onFrame(buf) {
    if (S.status !== 'active') return; const u = new Uint8Array(buf); if (u.length < 6 || u[0] !== 1) return;
    const seq = new DataView(buf).getUint32(1); if (seq <= S.last) { S.stats.dropped++; return; } S.last = seq; const id = S.id, dir = dirIn(), key = S.key;
    S.chain = S.chain.then(async () => {
      if (S.id !== id) return;
      try { const pcm = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv(dir, seq), additionalData: aad(dir) }, key, u.subarray(5)); S.bad = 0; S.stats.recv++; if (S.ply) S.ply.port.postMessage(pcm, [pcm]); }
      catch { if (++S.bad >= 20) { send({ t: 'callend', id }); finish(tr('Call failed'), 'bad'); } }
    });
  }

  function onMsg(m) {
    if (m.t === 'incoming') {
      if (S.status !== 'idle' || !supported()) { send({ t: 'callans', id: m.id, accept: false }); return; }
      try { S.nonce = unb64(m.nonce); } catch { return; } if (S.nonce.length !== 4) { S.nonce = null; return; }
      S.id = m.id; S.peer = m.from; S.role = 'callee'; setStatus('incoming'); const ringOnce = () => { beep(520); setTimeout(() => beep(660), 220); try { navigator.vibrate && navigator.vibrate([250, 120, 250]); } catch { /* ignore */ } };
      ringOnce(); ring = setInterval(ringOnce, 2200); return;
    }
    if (m.t !== 'callstate') return;
    if (S.role === 'caller' && !S.id && ['ringing', 'offline', 'busy'].includes(m.state)) {
      clearTimeout(guard);
      if (m.state === 'offline') return finish(tr('{name} is offline', { name: m.peer }), 'warn'); if (m.state === 'busy') return finish(tr('{name} is busy', { name: m.peer }), 'warn');
      S.id = m.id; if (S.status === 'preparing') setStatus('calling'); return;
    }
    if (m.id !== S.id) return;
    if (m.state === 'ringing') setStatus('ringing');
    else if (m.state === 'accepted') { if (S.status === 'preparing' || S.status === 'calling' || S.status === 'ringing') startMedia(); }
    else if (m.state === 'ended') {
      const why = { declined: tr('{name} declined the call', { name: m.peer }), noanswer: tr('No answer'), disconnect: tr('The other person disconnected'), cancelled: tr('Call ended') }[m.reason];
      finish(why, m.reason === 'noanswer' || m.reason === 'declined' ? 'warn' : 'ok');
    }
  }
  function lost() { if (S.status !== 'idle') finish(tr('Connection lost'), 'bad'); }
  /* the Call button in a direct-message header */
  function btn() {
    const b = $('#callBtn'); if (!b) return; const peer = st.cur && st.cur.k === 'd' ? st.cur.id : '';
    b.hidden = !peer || !supported() || !st.me || !(st.users || []).some(n => same(n, peer)) || S.status !== 'idle'; if (b.hidden) return;
    b.textContent = '[' + tr('Call') + ']'; b.title = tr('Call {name}', { name: peer }); b.setAttribute('aria-label', tr('Call {name}', { name: peer }));
  }
  const bb = $('#callBtn'); if (bb) bb.onclick = () => { if (st.cur.k === 'd') start(st.cur.id); };
  document.addEventListener('cn:state', btn);
  return { onMsg, onFrame, lost, btn, start, supported, state: () => ({ status: S.status, id: S.id, peer: S.peer, role: S.role, muted: S.muted, encrypted: !!S.key, ...S.stats }) };
})();
