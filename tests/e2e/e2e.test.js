'use strict';
/* Real-browser E2E (Playwright + Chromium) against a real server on a temp DATA_DIR. Run: npm run test:e2e
   Needs Chromium: set PW_CHROMIUM=/path/to/chrome, or run `npx playwright-core install chromium`. */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { chromium } = require('playwright-core');
const ROOT = path.join(__dirname, '..', '..'), PW = 'correct-horse-9', sleep = ms => new Promise(r => setTimeout(r, ms));

function startServer(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campusnet-e2e-'));
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env: { ...process.env, PORT: '0', DATA_DIR: dir, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  return new Promise((resolve, reject) => {
    child.stdout.on('data', d => { out += d; const m = out.match(/listening port=(\d+)/); if (m) resolve({ port: +m[1], dir, base: 'http://127.0.0.1:' + m[1], stop: () => { child.kill(); } }); });
    child.once('exit', c => reject(new Error('server exited ' + c)));
    setTimeout(() => reject(new Error('server start timeout')), 8000);
  });
}

describe('browser E2E', () => {
  let s, browser; const problems = [];
  before(async () => {
    s = await startServer({ ADMIN_USERS: 'boss', ADMIN_CODE: 'adm-secret-1' });
    browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--no-sandbox'] });
  });
  after(async () => { await browser?.close(); s?.stop(); });

  async function newUser() {
    const ctx = await browser.newContext(), page = await ctx.newPage();
    page.on('pageerror', e => problems.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text() + ' ' + m.location().url); });
    return { ctx, page };
  }
  async function register(page, name, pw = PW) {
    await page.goto(s.base + '/'); await page.click('#tabUp');
    await page.fill('#nameIn', name); await page.fill('#pwIn', pw); await page.fill('#pw2In', pw); await page.click('#goBtn');
  }
  /* The UI is a desktop OS: after login, open the app windows we need (launcher tiles). */
  const online = async (page, name, apps = ['Messages', 'Network', 'Files']) => {
    await page.waitForFunction(n => document.querySelector('#meBar')?.textContent.startsWith(n), name, { timeout: 8000 });
    for (const a of apps) { const t = page.locator('#launcher button[aria-label="Open ' + a + '"]'); if (await t.count()) await t.click(); }
  };

  it('rejects short passwords in the UI and does not log in', async () => {
    const { ctx, page } = await newUser();
    await register(page, 'shorty', 'matrix1');
    await page.waitForFunction(() => document.querySelector('#loginErr').textContent.length > 0, null, { timeout: 5000 });
    assert.equal(await page.evaluate(() => document.querySelector('#meBar').textContent), '');
    await ctx.close();
  });

  it('registers, chats in public room, receives live messages (dedupe: one copy)', async () => {
    const a = await newUser(), b = await newUser();
    await register(a.page, 'alice'); await online(a.page, 'alice');
    await register(b.page, 'bob'); await online(b.page, 'bob');
    await a.page.fill('#inp', 'hello-public-1'); await a.page.keyboard.press('Enter');
    await b.page.waitForFunction(() => document.querySelector('#log').innerText.includes('hello-public-1'), null, { timeout: 5000 });
    const count = await b.page.evaluate(() => document.querySelector('#log').innerText.split('hello-public-1').length - 1);
    assert.equal(count, 1);
    await a.ctx.close(); await b.ctx.close();
  });

  it('E2E-encrypted DM: delivered in plaintext to peer, never plaintext on the server disk', async () => {
    const a = await newUser(), b = await newUser(), secret = 'top-secret-dm-' + Date.now();
    await register(a.page, 'carol'); await online(a.page, 'carol', ['Messages']);
    await register(b.page, 'dave'); await online(b.page, 'dave', ['Messages']);
    await a.page.waitForSelector('#users li:not(.self)'); await a.page.click('#users li:not(.self) .n');
    await a.page.waitForFunction(() => document.querySelector('#convTitle').textContent.toLowerCase().includes('dave'));
    await a.page.fill('#inp', secret); await a.page.keyboard.press('Enter');
    await b.page.waitForFunction(s => document.body.innerText.includes(s) || document.querySelector('#users')?.innerText.includes('carol'), secret, { timeout: 8000 });
    await b.page.click('#users li:not(.self) .n');
    await b.page.waitForFunction(s => document.querySelector('#log').innerText.includes(s), secret, { timeout: 8000 });
    await sleep(1200); // let the server persist
    const blob = fs.readdirSync(s.dir).filter(f => fs.statSync(path.join(s.dir, f)).isFile()).map(f => fs.readFileSync(path.join(s.dir, f), 'utf8')).join('\n');
    assert.ok(/"enc"/.test(fs.readFileSync(path.join(s.dir, 'dms.json'), 'utf8')), 'the DM was persisted (as ciphertext), so the check below is not vacuous');
    assert.ok(!blob.includes(secret), 'plaintext DM must not be on the server disk');
    await a.ctx.close(); await b.ctx.close();
  });

  it('file upload + download works via HttpOnly cookie, token never in the URL', async () => {
    const a = await newUser(); await register(a.page, 'erin'); await online(a.page, 'erin');
    const f = path.join(os.tmpdir(), 'e2e-upload.txt'); fs.writeFileSync(f, 'file-body-123');
    await a.page.setInputFiles('#fileIn', f);
    await a.page.waitForFunction(() => document.querySelector('#files').innerText.includes('e2e-upload.txt'), null, { timeout: 8000 });
    const hrefs = await a.page.$$eval('#files a[href]', as => as.map(x => x.getAttribute('href')));
    assert.ok(hrefs.length > 0, 'a download link exists');
    const token = await a.page.evaluate(() => sessionStorage.getItem('cn:token'));
    for (const h of hrefs) assert.ok(!h.includes(token) && !/token=/i.test(h), 'no token in URL: ' + h);
    const ok = await a.page.evaluate(async h => { const r = await fetch(h); return [r.status, await r.text()]; }, hrefs[0]);
    assert.deepEqual(ok, [200, 'file-body-123']);
    const cookies = await a.ctx.cookies(); const c = cookies.find(x => x.httpOnly);
    assert.ok(c, 'an HttpOnly cookie is set');
    const anon = await fetch(s.base + hrefs[0]); assert.ok(anon.status === 401 || anon.status === 403 || anon.status === 404, 'anonymous download refused, got ' + anon.status);
    await a.ctx.close();
  });

  it('reserved admin name needs the admin code field; correct code works', async () => {
    const a = await newUser(); await register(a.page, 'boss');
    await a.page.waitForFunction(() => !document.querySelector('#admRow').hidden, null, { timeout: 5000 });
    assert.equal(await a.page.evaluate(() => document.querySelector('#meBar').textContent), '');
    await a.page.fill('#admIn', 'adm-secret-1'); await a.page.click('#goBtn');
    await online(a.page, 'boss');
    assert.match(await a.page.evaluate(() => document.querySelector('#meBar').textContent), /admin/);
    await a.ctx.close();
  });

  it('reload returns to the login gate (E2E key is password-locked); sign-out clears the token', async () => {
    const a = await newUser(); await register(a.page, 'frank'); await online(a.page, 'frank', []);
    await a.page.reload();
    await a.page.waitForSelector('#loginForm', { state: 'visible' });
    assert.equal(await a.page.evaluate(() => document.querySelector('#meBar').textContent), '');
    await a.page.fill('#nameIn', 'frank'); await a.page.fill('#pwIn', PW); await a.page.click('#goBtn'); await online(a.page, 'frank', []);
    await a.page.click('#outBtn'); await a.page.click('#mOk');
    await a.page.waitForFunction(() => !sessionStorage.getItem('cn:token'), null, { timeout: 5000 });
    await a.ctx.close();
  });

  it('no uncaught page errors or console errors during the run', () => { assert.deepEqual(problems, []); });
});
