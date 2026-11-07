#!/usr/bin/env node
'use strict';
/* `npm start`. Loads `.env` if there is one and, on a personal machine, serves plain HTTP on PORT and HTTPS (self-signed
   certificate, PORT+443) next to it, so encrypted direct messages and calls work on a LAN over the https address. On a hosting platform nothing is forced: when PORT or TRUST_PROXY is already set in the
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
const hostedNow = hosted || process.env.TRUST_PROXY !== undefined || process.env.NODE_ENV === 'production';   // a .env that sets TRUST_PROXY marks a hosted copy too
if (!hostedNow && process.env.HTTPS === undefined && !process.env.TLS_CERT && process.env.HTTPS_PORT === undefined) {   // personal machine: plain HTTP on PORT and HTTPS (self-signed) next to it
  const p = Number(process.env.PORT ?? 3000); process.env.HTTPS_PORT = p === 0 ? '0' : p + 443 <= 65535 ? String(p + 443) : '0';
}
require('../server.js');
