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

describe('voice calls in a real browser (fake microphone)', () => {
  let s, browser; const problems = [];
  before(async () => { s = await startServer(); browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] }); });
  after(async () => { await browser?.close(); s?.stop(); });
  async function user(name) {
    const ctx = await browser.newContext(); await ctx.grantPermissions(['microphone'], { origin: s.base }); const page = await ctx.newPage();
    page.on('pageerror', e => problems.push('pageerror: ' + e.message)); page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text() + ' ' + m.location().url); });
    await page.goto(s.base + '/'); await page.click('#tabUp'); await page.fill('#nameIn', name); await page.fill('#pwIn', PW); await page.fill('#pw2In', PW); await page.click('#goBtn');
    await page.waitForFunction(n => document.querySelector('#meBar')?.textContent.startsWith(n), name, { timeout: 8000 });
    await page.locator('#launcher button[data-app="chat"]').dispatchEvent('click'); return { ctx, page };
  }
  const openDM = (page, who) => page.locator('#users li', { hasText: who }).first().click();
  const st = page => page.evaluate(() => Call.state());
  const box = (page, txt) => page.locator('.callbox', { hasText: txt });

  it('call, accept, encrypted audio flows both ways, mute stops sending, end closes both sides', async () => {
    const a = await user('cora'), b = await user('dean');
    await openDM(a.page, 'dean'); await a.page.waitForSelector('#callBtn:not([hidden])'); await a.page.click('#callBtn');
    await b.page.waitForSelector('.callbox:not([hidden])'); await box(b.page, 'cora is calling').waitFor(); await b.page.locator('.callbox button:text-is("Accept")').click();
    await box(a.page, 'Connected').waitFor({ timeout: 8000 }); await box(b.page, 'Connected').waitFor({ timeout: 8000 });
    await a.page.waitForFunction(() => Call.state().recv > 10 && Call.state().sent > 10, null, { timeout: 10000 }); await b.page.waitForFunction(() => Call.state().recv > 10 && Call.state().sent > 10, null, { timeout: 10000 });
    await b.page.waitForFunction(() => Call.state().peak > 0.01, null, { timeout: 10000 });   // the fake microphone tone arrives and is played
    assert.equal((await st(a.page)).encrypted, true); assert.equal((await st(a.page)).dropped, 0);
    await a.page.locator('.callbox button:text-is("Mute microphone")').click(); await sleep(400); const sent = (await st(a.page)).sent; await sleep(800);
    assert.ok((await st(a.page)).sent - sent <= 1, 'no frames while muted'); await a.page.locator('.callbox button:text-is("Unmute microphone")').click();
    await a.page.waitForFunction(n => Call.state().sent > n + 3, sent, { timeout: 5000 });
    await a.page.locator('.callbox button:text-is("End call")').click();
    await a.page.waitForSelector('.callbox', { state: 'hidden' }); await b.page.waitForSelector('.callbox', { state: 'hidden' }); assert.equal((await st(b.page)).status, 'idle');
    await a.ctx.close(); await b.ctx.close();
  });

  it('decline, cancel and calling someone offline give clear feedback', async () => {
    const a = await user('ella'), b = await user('finn');
    await openDM(a.page, 'finn'); await a.page.click('#callBtn'); await b.page.locator('.callbox button:text-is("Decline")').click();
    await a.page.locator('.toast', { hasText: 'declined the call' }).waitFor({ timeout: 6000 }); await a.page.waitForSelector('.callbox', { state: 'hidden' });
    await a.page.click('#callBtn'); await b.page.waitForSelector('.callbox:not([hidden])'); await a.page.locator('.callbox button:text-is("Cancel")').click();
    await b.page.waitForSelector('.callbox', { state: 'hidden' }); await b.page.locator('#launcher button[data-app="alerts"]').dispatchEvent('click');
    await b.page.waitForFunction(() => /missed call/.test(document.body.innerText), null, { timeout: 6000 });
    await b.ctx.close(); await sleep(400); assert.equal(await a.page.locator('#callBtn').isHidden(), true, 'no call button for a user who went offline');
    await a.ctx.close();
  });

  it('a reload locks the encryption key, so calls refuse to start until it is unlocked', async () => {
    const a = await user('gina'), b = await user('hugo');
    await a.page.reload(); await a.page.waitForFunction(() => document.querySelector('#meBar').textContent.startsWith('gina')); await a.page.waitForSelector('#unlockBar', { state: 'visible' });
    await a.page.locator('#launcher button[data-app="chat"]').dispatchEvent('click'); await openDM(a.page, 'hugo'); await a.page.click('#callBtn');
    await a.page.locator('.toast', { hasText: 'Unlock encrypted messages first' }).waitFor({ timeout: 5000 }); assert.equal((await st(a.page)).status, 'idle');
    await a.ctx.close(); await b.ctx.close();
  });

  it('no uncaught page errors or console errors', () => { assert.deepEqual(problems, []); });
});
