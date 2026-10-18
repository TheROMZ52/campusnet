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

describe('Persian interface in a real browser', () => {
  let s, browser; const problems = [];
  before(async () => { s = await startServer(); browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--no-sandbox'] }); });
  after(async () => { await browser?.close(); s?.stop(); });
  async function visit(locale) {
    const ctx = await browser.newContext({ locale, viewport: { width: 1360, height: 820 } }), page = await ctx.newPage();
    page.on('pageerror', e => problems.push('pageerror: ' + e.message)); page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text() + ' ' + m.location().url); });
    await page.goto(s.base + '/'); return { ctx, page };
  }
  async function signUp(page, name) {
    await page.click('#tabUp'); await page.fill('#nameIn', name); await page.fill('#pwIn', PW); await page.fill('#pw2In', PW); await page.click('#goBtn');
    await page.waitForFunction(n => document.querySelector('#meBar')?.textContent.startsWith(n), name, { timeout: 20000 });
  }
  const app = (page, id) => page.locator('#launcher button[data-app="' + id + '"]').dispatchEvent('click');

  it('browser language fa: Persian gate, Home, mixed-direction chat, Persian date, no raw placeholders', async () => {
    const { ctx, page } = await visit('fa-IR');
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'fa'); assert.equal((await page.textContent('#tabIn')).trim(), 'ورود'); assert.equal((await page.textContent('#langBtn')).trim(), 'English');
    await signUp(page, 'sara');
    await page.waitForFunction(() => /sara/.test(document.querySelector('.home h2')?.textContent || ''), null, { timeout: 20000 }); assert.match(await page.textContent('.home h2'), /(صبح|ظهر|عصر|شب) بخیر، sara/);
    assert.match(await page.textContent('.home .hero small'), /[\u06F0-\u06F9]/, 'Persian calendar with Persian digits');
    await app(page, 'chat'); await page.fill('#inp', 'سلام hello 123'); await page.keyboard.press('Enter');
    await page.waitForSelector('#log .msg:has-text("سلام hello 123") .b[dir="auto"]');
    for (const id of ['people', 'feed', 'groups', 'alerts', 'music', 'files', 'monitor', 'security', 'settings']) await app(page, id);
    await sleep(500);
    const text = await page.evaluate(() => document.querySelector('#app').innerText);
    assert.ok(!/[{}]/.test(text), 'no unfilled {placeholders} on screen'); assert.match(text, /پروفایل تو/); assert.match(text, /ساخت گروه/); assert.match(text, /آپلود موسیقی/);
    await ctx.close();
  });

  it('server errors are shown in Persian', async () => {
    const a = await visit('fa-IR'), b = await visit('fa-IR');
    await signUp(a.page, 'dupe');
    await b.page.click('#tabUp'); await b.page.fill('#nameIn', 'dupe'); await b.page.fill('#pwIn', PW); await b.page.fill('#pw2In', PW); await b.page.click('#goBtn');
    await b.page.waitForFunction(() => /قبلاً گرفته/.test(document.querySelector('#loginErr').textContent), null, { timeout: 6000 });
    await a.ctx.close(); await b.ctx.close();
  });

  it('language switch from the gate and from Settings; the choice is remembered', async () => {
    const { ctx, page } = await visit('en-US');
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'en'); assert.equal((await page.textContent('#tabIn')).trim(), 'Sign in');
    await page.click('#langBtn'); await page.waitForSelector('html.fa'); assert.equal((await page.textContent('#tabIn')).trim(), 'ورود'); assert.equal(await page.evaluate(() => localStorage.getItem('cn:lang')), 'fa');
    await page.click('#langBtn'); await page.waitForFunction(() => document.documentElement.lang === 'en');
    await signUp(page, 'lena'); await app(page, 'settings');
    await page.locator('select[aria-label="Language"]').selectOption('fa'); await page.waitForSelector('html.fa');
    await page.waitForFunction(() => document.querySelector('#meBar').textContent.startsWith('lena'));   // the session survives the reload
    await page.waitForFunction(() => /lena/.test(document.querySelector('.home h2')?.textContent || ''), null, { timeout: 20000 }); assert.match(await page.textContent('.home h2'), /بخیر/);
    await ctx.close();
  });

  it('no uncaught page errors or console errors', () => { assert.deepEqual(problems, []); });
});
