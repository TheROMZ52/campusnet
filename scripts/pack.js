#!/usr/bin/env node
'use strict';
/* Builds a ready-to-upload deployment zip with no tools and no network: node scripts/pack.js [output.zip]
   Files sit at the zip root (server.js is the start file). node_modules, tests, data and CI files are left out:
   CampusNet has no runtime dependencies to install (ws is vendored in vendor/ws). */
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib');
const ROOT = path.join(__dirname, '..');
const INCLUDE = ['server.js', 'package.json', 'package-lock.json', 'Dockerfile', 'README.md', 'RELEASE_NOTES.md', 'DEPLOY.md', 'DEPLOY.fa.md', 'vendor', 'public'];
const walk = rel => { const abs = path.join(ROOT, rel); if (!fs.existsSync(abs)) return []; const st = fs.statSync(abs); return st.isDirectory() ? fs.readdirSync(abs).sort().flatMap(n => walk(rel + '/' + n)) : [rel]; };
const TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function build() {
  const d = new Date(), time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const parts = [], central = []; let offset = 0; const names = INCLUDE.flatMap(walk);
  for (const name of names) {
    const raw = fs.readFileSync(path.join(ROOT, name)), packed = zlib.deflateRawSync(raw, { level: 9 }), nm = Buffer.from(name, 'utf8'), crc = crc32(raw);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8); lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(packed.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10); ch.writeUInt16LE(time, 12); ch.writeUInt16LE(date, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(packed.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(offset, 42);
    parts.push(lh, nm, packed); central.push(ch, nm); offset += 30 + nm.length + packed.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(names.length, 8); end.writeUInt16LE(names.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return { zip: Buffer.concat([...parts, cd, end]), names };
}
if (require.main === module) {
  const version = require('../package.json').version, out = path.resolve(process.argv[2] || path.join(ROOT, 'dist', `campusnet-${version}.zip`));
  const { zip, names } = build(); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, zip);
  console.log(`${out}\n${names.length} files, ${(zip.length / 1024).toFixed(0)} KB. Start file: server.js. No npm install needed.`);
}
module.exports = { build };
