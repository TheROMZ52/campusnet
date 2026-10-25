'use strict';
/* Minimal zip writer and reader (deflate or store), no dependencies. Used by `npm run pack`, the automatic backups and the restore script. */
const zlib = require('node:zlib');
const TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };

/* entries: [{ name: 'dir/file.txt', data: Buffer }]. Names use '/', no leading slash. */
function zip(entries, now = new Date()) {
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1), date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts = [], central = []; let offset = 0;
  for (const { name, data } of entries) {
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(data), packed = zlib.deflateRawSync(raw, { level: 9 }), nm = Buffer.from(name, 'utf8'), crc = crc32(raw);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8); lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(packed.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10); ch.writeUInt16LE(time, 12); ch.writeUInt16LE(date, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(packed.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(offset, 42);
    parts.push(lh, nm, packed); central.push(ch, nm); offset += 30 + nm.length + packed.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

/* Returns [{ name, data }]. Verifies sizes and CRC-32; throws on a damaged or unsupported archive. */
function unzip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])); if (end < 0) throw new Error('not a zip file');
  const n = buf.readUInt16LE(end + 10); let p = buf.readUInt32LE(end + 16); const out = [];
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('damaged zip directory');
    const method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24), nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl), start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28), body = buf.subarray(start, start + csize);
    if (method !== 8 && method !== 0) throw new Error('unsupported compression for ' + name);
    const data = method === 8 ? zlib.inflateRawSync(body) : Buffer.from(body);
    if (data.length !== usize || crc32(data) !== crc) throw new Error('damaged file in zip: ' + name);
    out.push({ name, data }); p += 46 + nl + el + cl;
  }
  return out;
}
module.exports = { zip, unzip, crc32 };
