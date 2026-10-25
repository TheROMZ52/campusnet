'use strict';
/* End-to-end crypto for direct messages (Web Crypto only, no dependencies).
   ECDH P-256 key pair per user. The private key is wrapped in the browser with a key derived from the password
   (PBKDF2-SHA256 -> AES-256-GCM) and stored on the server as an opaque blob. Each pair of users derives a shared
   AES-256-GCM key; the server only relays ciphertext. */
window.CN = (function () {
  const subtle = window.crypto && window.crypto.subtle;
  const te = new TextEncoder(), td = new TextDecoder(), ITER = 250000, EC = { name: 'ECDH', namedCurve: 'P-256' };
  const b64 = buf => { let s = ''; new Uint8Array(buf).forEach(c => { s += String.fromCharCode(c); }); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const aad = (f, t) => te.encode(String(f).toLowerCase() + '\n' + String(t).toLowerCase());
  const rnd = n => crypto.getRandomValues(new Uint8Array(n));
  async function wrapKey(password, salt) {
    const base = await subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function genPair() {
    const kp = await subtle.generateKey(EC, true, ['deriveKey']), j = await subtle.exportKey('jwk', kp.publicKey);
    return { kp, pub: { kty: j.kty, crv: j.crv, x: j.x, y: j.y } };
  }
  return {
    supported: !!subtle && window.isSecureContext !== false,
    genPair,
    async create(password) {
      const { kp, pub } = await genPair(), priv = await subtle.exportKey('jwk', kp.privateKey), salt = rnd(16), iv = rnd(12);
      const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, await wrapKey(password, salt), te.encode(JSON.stringify(priv)));
      const imported = await subtle.importKey('jwk', priv, EC, false, ['deriveKey']);
      return { priv: imported, pub, blob: { s: b64(salt), iv: b64(iv), ct: b64(ct) } };
    },
    /* change the password that locks the private key without touching the key itself (throws if the old password is wrong) */
    async rewrap(blob, oldPassword, newPassword) {
      const pt = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, await wrapKey(oldPassword, unb64(blob.s)), unb64(blob.ct));
      const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, await wrapKey(newPassword, salt), pt);
      return { s: b64(salt), iv: b64(iv), ct: b64(ct) };
    },
    async unlock(blob, password) {
      const pt = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, await wrapKey(password, unb64(blob.s)), unb64(blob.ct));
      return subtle.importKey('jwk', JSON.parse(td.decode(pt)), EC, false, ['deriveKey']);
    },
    async shared(priv, pubJwk) {
      const pub = await subtle.importKey('jwk', pubJwk, EC, false, []);
      return subtle.deriveKey({ name: 'ECDH', public: pub }, priv, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    },
    async encrypt(key, from, to, obj) {
      const iv = rnd(12), ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(from, to) }, key, te.encode(JSON.stringify(obj)));
      return { iv: b64(iv), ct: b64(ct) };
    },
    async decrypt(key, from, to, e) {
      return JSON.parse(td.decode(await subtle.decrypt({ name: 'AES-GCM', iv: unb64(e.iv), additionalData: aad(from, to) }, key, unb64(e.ct))));
    },
    async fingerprint(pub) {
      const h = await subtle.digest('SHA-256', te.encode(pub.x + '.' + pub.y));
      return [...new Uint8Array(h).slice(0, 12)].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase().match(/.{4}/g).join(' ');
    }
  };
})();
