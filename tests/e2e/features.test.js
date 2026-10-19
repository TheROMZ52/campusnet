'use strict';
/* Real-browser E2E for v0.7 features: reply/edit/react/delete/pin, DM edit/delete/receipts, persistent unread + mute, profile/search/follow/feed/alerts. */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { chromium } = require('playwright-core');
const ROOT = path.join(__dirname, '..', '..'), PW = 'correct-horse-9', sleep = ms => new Promise(r => setTimeout(r, ms));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');

function startServer(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campusnet-e2e2-'));
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env: { ...process.env, PORT: '0', DATA_DIR: dir, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  return new Promise((resolve, reject) => {
    child.stdout.on('data', d => { out += d; const m = out.match(/listening port=(\d+)/); if (m) resolve({ port: +m[1], dir, base: 'http://127.0.0.1:' + m[1], stop: () => child.kill() }); });
    child.once('exit', c => reject(new Error('server exited ' + c))); setTimeout(() => reject(new Error('server start timeout')), 8000);
  });
}

describe('v0.7 features in a real browser', () => {
  let s, browser; const problems = [];
  before(async () => { s = await startServer({ ADMIN_USERS: 'boss', ADMIN_CODE: 'adm-secret-1' }); browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--no-sandbox'] }); });
  after(async () => { await browser?.close(); s?.stop(); });

  async function user(name, { apps = ['Messages'], adminCode } = {}) {
    const ctx = await browser.newContext(), page = await ctx.newPage();
    page.on('pageerror', e => problems.push('pageerror: ' + e.message)); page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text() + ' ' + m.location().url); });
    await page.goto(s.base + '/'); await page.click('#tabUp'); await page.fill('#nameIn', name); await page.fill('#pwIn', PW); await page.fill('#pw2In', PW);
    if (adminCode) { await page.evaluate(() => { document.querySelector('#admRow').hidden = false; }); await page.fill('#admIn', adminCode); }
    await page.click('#goBtn'); await up(page, name, apps); return { ctx, page, name };
  }
  async function up(page, name, apps) {
    await page.waitForFunction(n => document.querySelector('#meBar')?.textContent.startsWith(n), name, { timeout: 15000 });
    for (const a of apps) { const t = page.locator('#launcher button[aria-label="Open ' + a + '"]'); if (await t.count()) await t.click(); }
  }
  async function relogin(page, name, apps = ['Messages']) {   // reload keeps the session; only the encryption key needs the password again
    await page.reload(); await up(page, name, apps); const bar = page.locator('#unlockBar');
    if (await bar.isVisible()) { await page.fill('#unlockPw', PW); await page.keyboard.press('Enter'); await bar.waitFor({ state: 'hidden' }); await up(page, name, apps); }
  }
  const say = async (page, text) => { await page.fill('#inp', text); await page.keyboard.press('Enter'); };
  const row = (page, text) => page.locator('#log .msg', { hasText: text }).first();
  const act = async (page, text, label) => { const r = row(page, text); await r.hover(); await r.locator(`.ra-b[aria-label="${label}"]`).click(); };
  const openDM = (page, who) => page.locator('#users li', { hasText: who }).first().click();
  const gone = (page, text) => page.waitForFunction(t => ![...document.querySelectorAll('#log .msg')].some(r => r.textContent.includes(t) && !r.querySelector('.rq')), text, { timeout: 15000 });

  it('room: reply, edit, react, delete', async () => {
    const a = await user('alice'), b = await user('bob');
    await say(a.page, 'orig-message');
    await b.page.waitForSelector('#log .msg:has-text("orig-message")');
    await act(b.page, 'orig-message', 'Reply'); assert.ok(await b.page.locator('#replyBar').isVisible());
    await say(b.page, 'the-answer');
    await a.page.waitForSelector('#log .msg:has-text("the-answer") .rq:has-text("orig-message")');
    await act(a.page, 'orig-message', 'Edit message'); assert.equal(await a.page.inputValue('#inp'), 'orig-message');
    await say(a.page, 'orig-message v2');
    await b.page.waitForSelector('#log .msg:has-text("orig-message v2") .ed');
    await act(b.page, 'orig-message v2', 'React'); await b.page.locator('.rpick button').first().click();
    await a.page.waitForSelector('#log .msg:has-text("orig-message v2") .rxc.me, #log .msg:has-text("orig-message v2") .rxc');
    assert.match(await a.page.locator('#log .msg:has-text("orig-message v2") .rxc').first().textContent(), /1/);
    await b.page.locator('#log .msg:has-text("orig-message v2") .rxc').first().click();                 // toggle off
    await a.page.waitForFunction(() => !document.querySelector('#log .rxc'), null, { timeout: 15000 });
    await act(a.page, 'the-answer', 'Reply'); assert.equal(await a.page.locator('#log .msg:has-text("the-answer") .ra-b[aria-label="Edit message"]').count(), 0, 'cannot edit others');
    await a.page.keyboard.press('Escape'); await act(a.page, 'orig-message v2', 'Delete message'); await gone(b.page, 'orig-message v2');
    await a.ctx.close(); await b.ctx.close();
  });

  it('admin pins a message and everyone sees the pin bar', async () => {
    const boss = await user('boss', { adminCode: 'adm-secret-1' }), g = await user('gabe');
    await say(g.page, 'pin-me-please'); await boss.page.waitForSelector('#log .msg:has-text("pin-me-please")');
    await act(boss.page, 'pin-me-please', 'Pin message');
    await g.page.waitForSelector('#pinBar:not([hidden]) .pin:has-text("pin-me-please")');
    assert.equal(await g.page.locator('#log .msg:has-text("pin-me-please") .ra-b[aria-label="Pin message"]').count(), 0, 'non-admin has no pin button');
    await boss.ctx.close(); await g.ctx.close();
  });

  it('encrypted DM: edit, react, seen receipts, delete', async () => {
    const c = await user('carol'), d = await user('dave');
    await openDM(c.page, 'dave'); await say(c.page, 'dm-one');
    await c.page.waitForSelector('#log .msg:has-text("dm-one") .rc:not(.seen)');
    await d.page.waitForSelector('#users li:has-text("carol") .badge');
    await openDM(d.page, 'carol'); await d.page.waitForSelector('#log .msg:has-text("dm-one")');
    await c.page.waitForSelector('#log .msg:has-text("dm-one") .rc.seen', { timeout: 15000 });
    await act(c.page, 'dm-one', 'Edit message'); await say(c.page, 'dm-one edited');
    await d.page.waitForSelector('#log .msg:has-text("dm-one edited") .ed');
    await act(d.page, 'dm-one edited', 'React'); await d.page.locator('.rpick button').nth(1).click();
    await c.page.waitForSelector('#log .msg:has-text("dm-one edited") .rxc');
    await act(d.page, 'dm-one edited', 'Reply'); await say(d.page, 'dm-reply');
    await c.page.waitForSelector('#log .msg:has-text("dm-reply") .rq:has-text("dm-one edited")');
    await act(c.page, 'dm-one edited', 'Delete message'); await gone(d.page, 'dm-one edited');
    await c.ctx.close(); await d.ctx.close();
  });

  it('unread counts and mute survive a reload', async () => {
    const e = await user('erin'), f = await user('frank');
    await openDM(e.page, 'frank'); await say(e.page, 'unread-ping');
    await f.page.waitForSelector('#users li:has-text("erin") .badge');
    await relogin(f.page, 'frank');
    await f.page.waitForSelector('#users li:has-text("erin") .badge');                                    // persistent unread
    await openDM(f.page, 'erin'); await f.page.waitForSelector('#log .msg:has-text("unread-ping")'); await sleep(900);
    await relogin(f.page, 'frank'); assert.equal(await f.page.locator('#users li:has-text("erin") .badge').count(), 0, 'read state persisted');
    await openDM(f.page, 'erin'); await f.page.click('#muteBtn'); await f.page.waitForFunction(() => document.querySelector('#muteBtn').textContent === '[muted]');
    await f.page.locator('#rooms li', { hasText: 'general' }).click();
    await say(e.page, 'muted-ping'); await sleep(900);
    assert.equal(await f.page.locator('#users li:has-text("erin") .badge').count(), 0, 'muted conversation shows no badge');
    await relogin(f.page, 'frank'); await openDM(f.page, 'erin'); assert.equal(await f.page.textContent('#muteBtn'), '[muted]');
    await e.ctx.close(); await f.ctx.close();
  });

  it('profile, search, follow, feed, likes and alerts; user text is never rendered as HTML', async () => {
    const g = await user('gina', { apps: ['People'] }), h = await user('hank', { apps: ['People', 'Feed', 'Alerts'] });
    await g.page.locator('input[aria-label="Display name"]').fill('Gina <b id="xss1">G</b>'); await g.page.locator('textarea[aria-label="Bio"]').fill('<img src=x onerror=alert(1)>');
    await g.page.locator('input[type=file][accept^="image"]').setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: PNG });
    await g.page.locator('.soc button:text-is("Save profile")').dispatchEvent('click');   // no wait for the preview: Save itself waits for the photo
    await g.page.waitForFunction(() => st.myProfile.a.startsWith('data:image/jpeg') && document.querySelector('.avbig img'), null, { timeout: 15000 });   // confirmed by the server
    await h.page.locator('input[aria-label="Find people"]').fill('gin');
    await h.page.waitForSelector('.plist li:has-text("gina")');
    assert.equal(await h.page.locator('#xss1, .plist img[src="x"]').count(), 0, 'profile text is inert');
    assert.match(await h.page.locator('.plist li').first().textContent(), /<b id="xss1">/);
    await h.page.locator('.plist li button:text-is("Follow")').dispatchEvent('click');
    await g.page.locator('#launcher button[aria-label="Open Alerts"]').click();
    await g.page.waitForSelector('.nlist li.new:has-text("hank started following you")', { timeout: 15000 }).catch(() => {});
    await g.page.waitForFunction(() => /hank started following you/.test(document.body.innerText), null, { timeout: 15000 });
    await h.page.locator('textarea[aria-label="New post"]').fill('hello feed <i id="xss2">x</i>');
    await h.page.locator('.soc button:text-is("Post")').dispatchEvent('click');
    await g.page.locator('#launcher button[aria-label="Open Feed"]').click();
    await g.page.waitForSelector('.post:has-text("hello feed")', { timeout: 15000 });
    assert.equal(await g.page.locator('#xss2').count(), 0, 'post text is inert');
    await g.page.locator('.post:has-text("hello feed") button[aria-label="Like post"]').dispatchEvent('click');
    await h.page.waitForFunction(() => /gina liked your post/.test(document.body.innerText), null, { timeout: 15000 });
    await g.page.locator('textarea[aria-label="New post"]').fill('from-gina'); await g.page.locator('.soc button:text-is("Post")').dispatchEvent('click');
    await h.page.locator('.soc button:text-is("Following")').dispatchEvent('click');   // hank follows gina
    await h.page.waitForSelector('.post:has-text("from-gina")', { timeout: 15000 });
    await g.ctx.close(); await h.ctx.close();
  });

  it('no uncaught page errors or console errors', () => { assert.deepEqual(problems, []); });
});
