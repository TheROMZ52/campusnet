#!/usr/bin/env node
'use strict';
/* `npm start`. Loads `.env` if there is one and, on a personal machine, turns HTTPS on (self-signed certificate) so encrypted
   direct messages and calls work on a LAN. On a hosting platform nothing is forced: when PORT or TRUST_PROXY is already set in the
   real environment (or NODE_ENV=production) the server stays on plain HTTP behind the platform's proxy, and a missing .env is fine.
   Real environment variables always win over the file. `node server.js` itself reads neither .env nor sets HTTPS. */
const fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '..'), envFile = path.join(root, '.env'), example = path.join(root, '.env.example');
const hosted = process.env.PORT !== undefined || process.env.TRUST_PROXY !== undefined || process.env.NODE_ENV === 'production';   // decided before .env is read
if (!hosted && !fs.existsSync(envFile) && fs.existsSync(example)) { try { fs.copyFileSync(example, envFile); } catch { /* read-only folder: run without it */ } }
function loadEnv(file) {
  let text; try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim(); if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line); if (!m) continue;
    let v = m[2].trim(); if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1); else v = v.replace(/\s+#.*$/, '').trim();
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadEnv(envFile);
if (!hosted && process.env.HTTPS === undefined && !process.env.TLS_CERT) process.env.HTTPS = '1';
require('../server.js');
