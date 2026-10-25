#!/usr/bin/env node
'use strict';
/* Restore a CampusNet backup:  node scripts/restore.js <backup.zip> [--data DIR] [--yes]
   STOP THE SERVER FIRST. The current data files are moved to <DATA_DIR>/before-restore-<time>/ (nothing is deleted), then the
   backup's files are written. Uploaded files are not part of a backup: copy the `uploads` folder back separately. */
const fs = require('node:fs'), path = require('node:path');
const { unzip } = require('../lib/zip');
const FILES = ['users.json', 'messages.json', 'dms.json', 'notices.json', 'files.json', 'groups.json', 'posts.json', 'notifs.json', 'settings.json'];
const args = process.argv.slice(2), yes = args.includes('--yes'), di = args.indexOf('--data');
const dataDir = path.resolve(di >= 0 ? args[di + 1] : (process.env.DATA_DIR || path.join(__dirname, '..', 'data')));
const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--data');
const die = m => { console.error('\n  ' + m + '\n'); process.exit(1); };
if (!file) die('Usage: node scripts/restore.js <backup.zip> [--data DIR] [--yes]');
let entries; try { entries = unzip(fs.readFileSync(file)); } catch (e) { die('Cannot read the backup: ' + e.message); }
const byName = Object.fromEntries(entries.map(e => [e.name, e.data]));
let manifest; try { manifest = JSON.parse(byName['manifest.json'].toString('utf8')); } catch { die('This is not a CampusNet backup (no readable manifest.json).'); }
if (manifest.app !== 'CampusNet') die('This is not a CampusNet backup.');
for (const e of entries) { if (e.name !== 'manifest.json' && !FILES.includes(e.name)) die('Unexpected file in the backup: ' + e.name); if (e.name !== 'manifest.json') { try { JSON.parse(e.data.toString('utf8')); } catch { die('Damaged data file in the backup: ' + e.name); } } }
if (!byName['users.json']) die('The backup has no users.json.');
console.log(`\n  Backup from ${manifest.created} (CampusNet ${manifest.version}): ${manifest.users} users, ${manifest.files} files listed.\n  Target data folder: ${dataDir}\n  ${manifest.note || ''}`);
if (!yes) { console.log('\n  Nothing was changed. Stop the server, then run again with --yes to restore.\n'); process.exit(0); }
fs.mkdirSync(dataDir, { recursive: true }); const old = path.join(dataDir, 'before-restore-' + new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '')); let moved = 0;
for (const n of FILES) for (const f of [n, n + '.bak']) { const p = path.join(dataDir, f); if (fs.existsSync(p)) { fs.mkdirSync(old, { recursive: true }); fs.renameSync(p, path.join(old, f)); moved++; } }
for (const e of entries) { if (e.name === 'manifest.json') continue; const p = path.join(dataDir, e.name); fs.writeFileSync(p + '.tmp', e.data, { mode: 0o600 }); fs.renameSync(p + '.tmp', p); }
console.log(`\n  Restored ${entries.length - 1} data files.${moved ? ' The previous ones are in ' + old : ''}\n  Start the server again. If you use uploaded files, make sure the uploads folder is in place.\n`);
