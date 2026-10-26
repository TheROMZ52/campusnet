'use strict';
/* Real-browser E2E for v0.14: the service worker installs, caches the shell, the app opens with no network, and the install row works. */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { chromium } = require('playwright-core');
const ROOT = path.join(__dirname, '..', '..'), PW = 'correct-horse-9', VERSION = require('../../package.json').version;

function startServer(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campusnet-e2e-pwa-'));
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env: { ...process.env, PORT: '0', DATA_DIR: dir, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  return new Promise((resolve, reject) => {
    child.stdout.on('data', d => { out += d; const m = out.match(/listening port=(\d+)/); if (m) resolve({ port: +m[1], base: 'http://127.0.0.1:' + m[1], stop: () => child.kill() }); });
    child.once('exit', c => reject(new Error('server exited ' + c))); setTimeout(() => reject(new Error('server start timeout')), 8000);
  });
}

describe('v0.14: installable app and offline shell', () => {
  let s, browser; const problems = [];
  before(async () => { s = await startServer(); browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--no-sandbox'] }); });
  after(async () => { await browser?.close(); s?.stop(); });
  async function open() {
    const ctx = await browser.newContext(), page = await ctx.newPage();
    page.on('pageerror', e => problems.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(m.text())) problems.push('console: ' + m.text()); });
    await page.goto(s.base + '/'); return { ctx, page };
  }
  const controlled = page => page.waitForFunction(() => navigator.serviceWorker.controller && navigator.serviceWorker.controller.state === 'activated', null, { timeout: 15000 });

  it('registers the worker and caches the whole shell under the versioned cache name', async () => {
    const { ctx, page } = await open(); await controlled(page);
    const info = await page.evaluate(async () => { const ks = await caches.keys(), c = await caches.open(ks[0]), reqs = (await c.keys()).map(r => new URL(r.url).pathname); return { ks, reqs }; });
    assert.deepEqual(info.ks, ['cn-' + VERSION]);
    for (const p of ['/', '/app.js', '/style.css', '/pwa.js', '/shell.js', '/fonts/Vazirmatn-Regular.woff2', '/icon-192.png', '/manifest.webmanifest']) assert.ok(info.reqs.includes(p), p);
    await ctx.close();
  });

  it('with no network the page still opens, styled and with its scripts running', async () => {
    const { ctx, page } = await open(); await controlled(page);
    await ctx.setOffline(true); await page.reload();
    await page.locator('#login').waitFor({ timeout: 15000 });
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(5, 7, 6)');
    assert.equal(await page.evaluate(() => typeof CN + ':' + typeof I18N + ':' + typeof Shell), 'object:object:object');
    await page.click('#tabUp'); await page.locator('#pw2Row').waitFor({ state: 'visible' });   // the gate is alive, not a static picture
    await page.click('#langBtn'); await page.waitForFunction(() => document.documentElement.lang === 'fa', null, { timeout: 5000 });
    await ctx.setOffline(false); await ctx.close();
  });

  it('without the worker nothing would open offline (the test above really depends on it)', async () => {
    const ctx = await browser.newContext({ serviceWorkers: 'block' }), page = await ctx.newPage(); await page.goto(s.base + '/'); await page.locator('#login').waitFor();
    await ctx.setOffline(true); await assert.rejects(page.reload({ timeout: 8000 })); await ctx.close();
  });

  it('a signed-in user reloading offline gets the app shell without script errors', async () => {
    const { ctx, page } = await open(); await controlled(page);
    await page.click('#tabUp'); await page.fill('#nameIn', 'offy'); await page.fill('#pwIn', PW); await page.fill('#pw2In', PW); await page.click('#goBtn');
    await page.waitForFunction(() => document.querySelector('#meBar')?.textContent.startsWith('offy'), null, { timeout: 15000 });
    await ctx.setOffline(true); await page.reload(); await page.locator('#app, #login').first().waitFor({ timeout: 15000 });
    assert.equal(await page.evaluate(() => typeof Shell), 'object'); await ctx.setOffline(false); await ctx.close();
  });

  it('Settings shows the install button only when the browser offers installation, and clicking it opens the prompt', async () => {
    const { ctx, page } = await open();
    await page.click('#tabUp'); await page.fill('#nameIn', 'insta'); await page.fill('#pwIn', PW); await page.fill('#pw2In', PW); await page.click('#goBtn');
    await page.waitForFunction(() => document.querySelector('#meBar')?.textContent.startsWith('insta'), null, { timeout: 15000 });
    await page.locator('#launcher button[aria-label="Open Settings"]').click();
    await page.locator('.set').waitFor(); assert.equal(await page.locator('.set .instbox').isHidden(), true);
    await page.evaluate(() => { window.__prompted = 0; const e = new Event('beforeinstallprompt', { cancelable: true }); e.prompt = () => { window.__prompted++; }; e.userChoice = Promise.resolve({ outcome: 'accepted' }); window.dispatchEvent(e); });
    await page.locator('.set .instbox button:text-is("Install app")').waitFor({ state: 'visible' });
    await page.locator('.set .instbox button:text-is("Install app")').click();
    await page.waitForFunction(() => window.__prompted === 1); await page.locator('.set .instbox').waitFor({ state: 'hidden' });
    await ctx.close();
  });

  it('no page errors', () => { assert.deepEqual(problems, []); });
});
