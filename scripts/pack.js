#!/usr/bin/env node
'use strict';
/* Builds a ready-to-upload deployment zip with no tools and no network: node scripts/pack.js [output.zip]
   Files sit at the zip root (server.js is the start file). node_modules, tests, data and CI files are left out:
   CampusNet has no runtime dependencies to install (ws is vendored in vendor/ws). */
const fs = require('node:fs'), path = require('node:path');
const ROOT = path.join(__dirname, '..');
const INCLUDE = ['server.js', 'package.json', 'package-lock.json', 'Dockerfile', 'README.md', 'RELEASE_NOTES.md', 'DEPLOY.md', 'DEPLOY.fa.md', '.env.example', 'scripts/start.js', 'scripts/restore.js', 'lib', 'vendor', 'public'];
const walk = rel => { const abs = path.join(ROOT, rel); if (!fs.existsSync(abs)) return []; const st = fs.statSync(abs); return st.isDirectory() ? fs.readdirSync(abs).sort().flatMap(n => walk(rel + '/' + n)) : [rel]; };
const { zip } = require('../lib/zip');
function build() {
  const names = INCLUDE.flatMap(walk); return { zip: zip(names.map(name => ({ name, data: fs.readFileSync(path.join(ROOT, name)) }))), names };
}
if (require.main === module) {
  const version = require('../package.json').version, out = path.resolve(process.argv[2] || path.join(ROOT, 'dist', `campusnet-${version}.zip`));
  const { zip, names } = build(); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, zip);
  console.log(`${out}\n${names.length} files, ${(zip.length / 1024).toFixed(0)} KB. Start file: server.js. No npm install needed.`);
}
module.exports = { build };
