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

function wav(seconds = 1) { const n = 8000 * seconds, b = Buffer.alloc(44 + n, 128); b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40); return b; }

describe('v0.9: Home, music, reload and Back', () => {
  let s, browser; const problems = [];
  before(async () => { s = await startServer(); browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] }); });
  after(async () => { await browser?.close(); s?.stop(); });
  async function user(name, apps = []) {
    const ctx = await browser.newContext(), page = await ctx.newPage();
    page.on('pageerror', e => problems.push('pageerror: ' + e.message)); page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text() + ' ' + m.location().url); });
    await page.goto(s.base + '/'); await page.click('#tabUp'); await page.fill('#nameIn', name); await page.fill('#pwIn', PW); await page.fill('#pw2In', PW); await page.click('#goBtn');
    await page.waitForFunction(n => document.querySelector('#meBar')?.textContent.startsWith(n), name, { timeout: 8000 });
    for (const a of apps) await page.locator('#launcher button[aria-label="Open ' + a + '"]').dispatchEvent('click');
    return { ctx, page };
  }
  const openDM = (page, who) => page.locator('#users li', { hasText: who }).first().click();

  it('Home opens first, with live content', async () => {
    const a = await user('hana'), b = await user('hugo', ['Messages']);
    await a.page.waitForSelector('.home h2:has-text("hana")');
    await openDM(b.page, 'hana'); await b.page.fill('#inp', 'hello-home'); await b.page.keyboard.press('Enter');
    await a.page.waitForFunction(() => /hugo/.test(document.querySelector('.home')?.innerText || '') && /1\s*new/.test(document.querySelector('.home').innerText), null, { timeout: 8000 });
    await a.page.locator('.home .tile2:has-text("Music")').dispatchEvent('click'); await a.page.waitForSelector('.music .tlist');
    await a.ctx.close(); await b.ctx.close();
  });

  it('music: upload, library, real playback, profile song visible to others', async () => {
    const m = await user('musa', ['Music']), p = await user('mira', ['People']);
    await m.page.locator('.music input[type=file]').setInputFiles({ name: 'Test Artist - Song One.wav', mimeType: 'audio/wav', buffer: wav(2) });
    await m.page.waitForSelector('.tlist li:has-text("Song One")', { timeout: 10000 });
    await m.page.locator('.tlist li:has-text("Song One") button[aria-label^="Play"]').click();
    await m.page.waitForFunction(() => Music.state().id && !Music.state().paused && Music.state().time > 0.15, null, { timeout: 10000 });
    assert.match(await m.page.evaluate(() => Music.state().src), /\/f\/[a-f0-9]{16}\?audio=1$/);
    await m.page.waitForFunction(() => /Song One/.test(document.querySelector('.home .mini')?.innerText || ''), null, { timeout: 5000 });
    await m.page.locator('.tlist li:has-text("Song One") button:text-is("Profile song")').dispatchEvent('click');
    await m.page.waitForSelector('.tlist li:has-text("Song One") button:text-is("Remove from profile")');
    await p.page.locator('input[aria-label="Find people"]').fill('musa'); await p.page.waitForSelector('.plist li:has-text("Song One") button:has-text("Test Artist")');
    await p.page.locator('.plist li button:has-text("Test Artist")').click(); await p.page.waitForFunction(() => Music.state().id !== null);
    await m.page.locator('.tlist li:has-text("Song One") button:text-is("Delete")').dispatchEvent('click'); await m.page.click('#mOk');
    await m.page.waitForFunction(() => !document.querySelector('.tlist li:not(.empty)') && Music.state().id === null, null, { timeout: 6000 });
    await m.ctx.close(); await p.ctx.close();
  });

  it('reload: stays signed in, restores the conversation, DMs unlock with the password; Back never leaves the app', async () => {
    const a = await user('rita', ['Messages']), b = await user('remy', ['Messages']);
    await openDM(a.page, 'remy'); await a.page.fill('#inp', 'before-reload'); await a.page.keyboard.press('Enter');
    await b.page.locator('#users li', { hasText: 'rita' }).first().waitFor();
    await openDM(b.page, 'rita'); await b.page.waitForSelector('#log .msg:has-text("before-reload")');
    await b.page.locator('#rooms li', { hasText: 'help' }).first().click(); await openDM(b.page, 'rita');
    await b.page.goBack(); assert.match(await b.page.textContent('#convTitle'), /help/);
    await b.page.goForward(); assert.match(await b.page.textContent('#convTitle'), /rita/);
    await b.page.reload(); await b.page.waitForFunction(() => document.querySelector('#meBar').textContent.startsWith('remy'));
    assert.ok(await b.page.locator('#login').isHidden()); assert.match(await b.page.textContent('#convTitle'), /rita/, 'conversation restored');
    await b.page.waitForSelector('#unlockBar', { state: 'visible' });
    await b.page.fill('#unlockPw', PW); await b.page.keyboard.press('Enter'); await b.page.waitForSelector('#unlockBar', { state: 'hidden' });
    await b.page.waitForSelector('#log .msg:has-text("before-reload")', { timeout: 8000 });
    for (let i = 0; i < 8; i++) { await b.page.goBack().catch(() => {}); await sleep(80); }
    assert.ok(b.page.url().startsWith(s.base), 'Back stays on the app: ' + b.page.url()); assert.ok(await b.page.locator('#app').isVisible()); await b.page.waitForSelector('.home');
    await a.ctx.close(); await b.ctx.close();
  });

  it('no uncaught page errors or console errors', () => { assert.deepEqual(problems, []); });
});
