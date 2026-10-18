'use strict';
/* Audio processors for voice calls (runs in the AudioWorklet thread).
   Telephone-quality voice: 8 kHz mono, one byte per sample (logarithmic companding), 60 ms frames of 480 bytes (8 KB/s).
   cn-capture: microphone -> 8 kHz bytes.  cn-player: bytes from the other person -> speaker, with a small jitter buffer. */
const MU = 255, FRAME = 480;
const enc = x => { const s = x < 0 ? 0x80 : 0, v = Math.min(1, Math.abs(x)), y = Math.log(1 + MU * v) / Math.log(1 + MU); return (~(s | Math.round(y * 127))) & 0xFF; };
const DEC = new Float32Array(256); for (let b = 0; b < 256; b++) { const n = ~b & 0xFF, y = (n & 0x7F) / 127, v = (Math.pow(1 + MU, y) - 1) / MU; DEC[b] = (n & 0x80) ? -v : v; }

class Capture extends AudioWorkletProcessor {
  constructor() { super(); this.ratio = sampleRate / 8000; this.acc = 0; this.n = 0; this.pos = 0; this.buf = new Uint8Array(FRAME); this.i = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]; if (!ch) return true;
    for (let k = 0; k < ch.length; k++) {
      this.acc += ch[k]; this.n++; this.pos++;
      if (this.pos >= this.ratio) {   // box-average decimation to 8 kHz
        const x = this.acc / this.n; this.acc = 0; this.n = 0; this.pos -= this.ratio; this.buf[this.i++] = enc(x);
        if (this.i === FRAME) { this.port.postMessage(this.buf.buffer, [this.buf.buffer]); this.buf = new Uint8Array(FRAME); this.i = 0; }
      }
    }
    return true;
  }
}

class Player extends AudioWorkletProcessor {
  constructor() {
    super(); this.ring = new Float32Array(8000 * 4); this.r = 0; this.w = 0; this.len = 0; this.step = 8000 / sampleRate; this.frac = 0; this.cur = 0; this.next = 0;
    this.prime = true; this.played = 0; this.peak = 0; this.blocks = 0;
    this.port.onmessage = e => {
      const u = new Uint8Array(e.data), cap = this.ring.length;
      for (let i = 0; i < u.length; i++) { this.ring[this.w] = DEC[u[i]]; this.w = (this.w + 1) % cap; this.len = Math.min(cap, this.len + 1); }
      if (this.len > 3200) { const drop = this.len - 1600; this.r = (this.r + drop) % cap; this.len -= drop; }   // more than 400 ms queued: skip ahead to 200 ms
    };
  }
  pop() { if (this.len <= 0) return 0; const v = this.ring[this.r]; this.r = (this.r + 1) % this.ring.length; this.len--; return v; }
  process(_, outputs) {
    const out = outputs[0][0]; if (!out) return true;
    for (let i = 0; i < out.length; i++) {
      if (this.prime) { if (this.len >= 800) { this.prime = false; this.cur = this.pop(); this.next = this.pop(); } else { out[i] = 0; continue; } }   // wait for 100 ms of audio
      const v = this.cur + (this.next - this.cur) * this.frac; out[i] = v; const a = Math.abs(v); if (a > this.peak) this.peak = a;
      this.frac += this.step;
      while (this.frac >= 1) { this.frac -= 1; this.cur = this.next; if (this.len <= 0) { this.prime = true; this.frac = 0; this.next = 0; break; } this.next = this.pop(); }   // ran dry: refill 100 ms before continuing
    }
    this.played += out.length;
    if (++this.blocks % 40 === 0) { this.port.postMessage({ level: this.len, played: this.played, peak: this.peak }); this.peak = 0; }
    return true;
  }
}
registerProcessor('cn-capture', Capture); registerProcessor('cn-player', Player);
