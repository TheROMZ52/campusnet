'use strict';
/* Real-browser E2E for v0.7 features: reply/edit/react/delete/pin, DM edit/delete/receipts, persistent unread + mute, profile/search/follow/feed/alerts. */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { chromium } = require('playwright-core');
const ROOT = path.join(__dirname, '..', '..'), PW = 'correct-horse-9', sleep = ms => new Promise(r => setTimeout(r, ms));

function startServer(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campusnet-e2e2-'));
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env: { ...process.env, PORT: '0', DATA_DIR: dir, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  return new Promise((resolve, reject) => {
    child.stdout.on('data', d => { out += d; const m = out.match(/listening port=(\d+)/); if (m) resolve({ port: +m[1], dir, base: 'http://127.0.0.1:' + m[1], stop: () => child.kill() }); });
    child.once('exit', c => reject(new Error('server exited ' + c))); setTimeout(() => reject(new Error('server start timeout')), 8000);
  });
}

describe('layout on small screens', () => {
  let s, browser; const problems = [];
  before(async () => { s = await startServer(); browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--no-sandbox'] }); });
  after(async () => { await browser?.close(); s?.stop(); });
  for (const [locale, width] of [['en-US', 320], ['en-US', 390], ['fa-IR', 390]]) {
    it(`no sideways scrolling at ${width}px (${locale}) in any app`, async () => {
      const ctx = await browser.newContext({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true, locale }), page = await ctx.newPage(), name = 'lay' + locale.slice(0, 2) + width;
      page.on('pageerror', e => problems.push(e.message));
      await page.goto(s.base + '/'); await page.click('#tabUp'); await page.fill('#nameIn', name); await page.fill('#pwIn', PW); await page.fill('#pw2In', PW); await page.click('#goBtn');
      await page.waitForFunction(n => document.querySelector('#meBar')?.textContent.startsWith(n), name, { timeout: 15000 });
      const bad = [];
      for (const app of ['home', 'chat', 'people', 'feed', 'groups', 'alerts', 'music', 'files', 'security', 'settings']) {
        await page.evaluate(id => Shell.launch(id), app); await sleep(250);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); if (over > 0) bad.push(app + ' +' + over + 'px');
      }
      assert.deepEqual(bad, []); await ctx.close();
    });
  }
  it('no page errors', () => { assert.deepEqual(problems, []); });
});
