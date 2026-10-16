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

describe('groups in a real browser', () => {
  let s, browser; const problems = [];
  before(async () => { s = await startServer(); browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--no-sandbox'] }); });
  after(async () => { await browser?.close(); s?.stop(); });
  async function user(name) {
    const ctx = await browser.newContext(), page = await ctx.newPage();
    page.on('pageerror', e => problems.push('pageerror: ' + e.message)); page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text() + ' ' + m.location().url); });
    await page.goto(s.base + '/'); await page.click('#tabUp'); await page.fill('#nameIn', name); await page.fill('#pwIn', PW); await page.fill('#pw2In', PW); await page.click('#goBtn');
    await page.waitForFunction(n => document.querySelector('#meBar')?.textContent.startsWith(n), name, { timeout: 8000 });
    for (const a of ['Messages', 'Groups']) await page.locator('#launcher button[aria-label="Open ' + a + '"]').click();
    return { ctx, page };
  }
  const click = (page, sel) => page.locator(sel).first().dispatchEvent('click');
  const room = (page, text) => page.locator('#rooms li', { hasText: text }).first();
  it('create, join, chat, roles, leave; non-members see nothing', async () => {
    const i = await user('ivy'), j = await user('jack'), k = await user('kim');
    await i.page.locator('input[aria-label="Group name"]').fill('Study group'); await click(i.page, '.soc button:text-is("Create group")');
    await i.page.waitForSelector('#rooms li:has-text("Study group")');
    await j.page.locator('input[aria-label="Find groups"]').fill('study');
    await j.page.waitForSelector('.plist li:has-text("Study group")');
    await click(j.page, '.plist li:has-text("Study group") button:text-is("Join")'); await j.page.waitForSelector('#rooms li:has-text("Study group")');
    await click(i.page, '#rooms li:has-text("Study group")'); await i.page.waitForFunction(() => /not end-to-end encrypted/.test(document.querySelector('#convTitle').textContent));
    await i.page.fill('#inp', 'group-hello'); await i.page.keyboard.press('Enter');
    await click(j.page, '#rooms li:has-text("Study group")'); await j.page.waitForSelector('#log .msg:has-text("group-hello")');
    assert.equal(await j.page.locator('#log .msg:has-text("group-hello") .ra-b[aria-label="Pin message"]').count(), 0, 'plain member cannot pin');
    await click(i.page, '.glist button:text-is("Manage")'); await click(i.page, '.glist button:text-is("Make mod")');
    await j.page.waitForSelector('#log .msg:has-text("group-hello") .ra-b[aria-label="Pin message"]', { timeout: 6000 });
    await j.page.locator('#log .msg:has-text("group-hello")').first().hover(); await j.page.locator('#log .msg:has-text("group-hello") .ra-b[aria-label="Pin message"]').click();
    await i.page.waitForSelector('#pinBar:not([hidden]) .pin:has-text("group-hello")', { timeout: 6000 });
    await k.page.locator('input[aria-label="Find groups"]').fill('study'); await k.page.waitForSelector('.plist li:has-text("Study group")'); await sleep(300);
    assert.equal(await k.page.locator('#rooms li:has-text("Study group")').count(), 0); assert.ok(!(await k.page.evaluate(() => document.body.innerText)).includes('group-hello'));
    await click(j.page, '.glist button:text-is("Leave")'); await click(j.page, '.glist button:text-is("Click again to confirm")');
    await j.page.waitForFunction(() => ![...document.querySelectorAll('#rooms li')].some(l => l.textContent.includes('Study group')), null, { timeout: 6000 });
    await i.ctx.close(); await j.ctx.close(); await k.ctx.close();
  });
  it('terminal diag and ping use real probes; safety number comparison detects match and mismatch', async () => {
    const mk = async name => { const u = await user(name); for (const a of ['Terminal', 'Security']) await u.page.locator('#launcher button[aria-label="Open ' + a + '"]').dispatchEvent('click'); return u; };
    const l = await mk('lena'), m = await mk('marek');
    const cmd = async (page, c) => { await page.locator('input[aria-label="Terminal command"]').fill(c); await page.keyboard.press('Enter'); };
    await cmd(l.page, 'diag'); await l.page.waitForFunction(() => /session\s+\d+ min/.test(document.querySelector('.tout').innerText), null, { timeout: 12000 });
    const out = await l.page.locator('.tout').innerText();
    assert.match(out, /HTTP \/healthz min \d+ ms/); assert.match(out, /round trip min \d+ ms/); assert.match(out, /secure context yes/); assert.match(out, /clock\s+differs/);
    await cmd(l.page, 'ping'); await l.page.waitForFunction(() => /WebSocket\s+4 probes/.test(document.querySelector('.tout').innerText), null, { timeout: 12000 });
    await l.page.locator('#users li', { hasText: 'marek' }).first().dispatchEvent('click'); await l.page.fill('#inp', 'hi marek'); await l.page.keyboard.press('Enter');
    await l.page.waitForSelector('.peer:has-text("marek")'); await m.page.waitForSelector('.sec .stat .fp');
    const theirs = (await m.page.locator('.sec .stat .fp').first().textContent()).trim();
    const box = l.page.locator('.peer:has-text("marek") input[aria-label="Their safety number"]');
    await box.fill(theirs.slice(0, -2) + (theirs.endsWith('00') ? '11' : '00')); await l.page.waitForSelector('.peer:has-text("marek") .cmpres.bad');
    await box.fill(theirs); await l.page.waitForSelector('.peer:has-text("marek") .cmpres.ok:has-text("Match")');
    await l.page.locator('.peer:has-text("marek") .cmpres button:text-is("Mark verified")').dispatchEvent('click');
    await l.page.waitForSelector('.peer:has-text("marek") .pill.verified', { timeout: 6000 });
    await l.ctx.close(); await m.ctx.close();
  });
  it('no uncaught page errors or console errors', () => { assert.deepEqual(problems, []); });
});
