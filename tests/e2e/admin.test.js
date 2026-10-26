'use strict';
/* Real-browser E2E for v0.13: Admin window (suspend, reset password, registration, backups), launcher visibility,
   password change that keeps old private messages readable, and deleting your own account. */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { chromium } = require('playwright-core');
const ROOT = path.join(__dirname, '..', '..'), PW = 'correct-horse-9', PW2 = 'brand-new-horse-7', ADM = 'adm-secret-1';

function startServer(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campusnet-e2e-adm-'));
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env: { ...process.env, PORT: '0', DATA_DIR: dir, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  return new Promise((resolve, reject) => {
    child.stdout.on('data', d => { out += d; const m = out.match(/listening port=(\d+)/); if (m) resolve({ port: +m[1], dir, base: 'http://127.0.0.1:' + m[1], stop: () => child.kill() }); });
    child.once('exit', c => reject(new Error('server exited ' + c))); setTimeout(() => reject(new Error('server start timeout')), 8000);
  });
}

describe('v0.13: admin tools and account settings in a real browser', () => {
  let s, browser; const problems = [];
  before(async () => {
    s = await startServer({ ADMIN_USERS: 'boss', ADMIN_CODE: ADM, BACKUP_EVERY_HOURS: '0' });
    browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--no-sandbox'] });
  });
  after(async () => { await browser?.close(); s?.stop(); });

  async function open(ctxOpts = {}) {
    const ctx = await browser.newContext(ctxOpts), page = await ctx.newPage();
    page.on('pageerror', e => problems.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/the server responded with a status of (40\d)/.test(m.text())) problems.push('console: ' + m.text() + ' ' + m.location().url); });
    await page.goto(s.base + '/'); return { ctx, page };
  }
  const waitIn = (page, name) => page.waitForFunction(n => document.querySelector('#meBar')?.textContent.startsWith(n), name, { timeout: 15000 });
  async function signup(name, { pw = PW, admin } = {}) {
    const { ctx, page } = await open();
    await page.click('#tabUp'); await page.fill('#nameIn', name); await page.fill('#pwIn', pw); await page.fill('#pw2In', pw);
    if (admin) { await page.evaluate(() => { document.querySelector('#admRow').hidden = false; }); await page.fill('#admIn', admin); }
    await page.click('#goBtn'); await waitIn(page, name); return { ctx, page, name };
  }
  async function signin(name, pw) {
    const { ctx, page } = await open();
    await page.click('#tabIn'); await page.fill('#nameIn', name); await page.fill('#pwIn', pw); await page.click('#goBtn'); return { ctx, page, name };
  }
  const tile = (page, app) => page.locator('#launcher button[aria-label="Open ' + app + '"]');
  const app = async (page, name) => { await tile(page, name).click(); };
  const failedGate = async (page, re) => { await page.waitForFunction(() => document.querySelector('#loginErr')?.textContent.trim().length > 0, null, { timeout: 15000 }); assert.match(await page.textContent('#loginErr'), re); assert.ok(!(await page.textContent('#meBar')).trim()); };
  const adminRow = (page, who) => page.locator('.admin ul li', { hasText: who }).first();
  const adminBtn = (page, who, label) => adminRow(page, who).locator('button:text-is("' + label + '")');
  const confirmModal = async page => { await page.click('#mOk'); };
  const tab = (page, label) => page.locator('.admin .row button:text-is("' + label + '")').click();

  it('launcher shows the Admin tile for the administrator only', async () => {
    const boss = await signup('boss', { admin: ADM }), sam = await signup('sam');
    assert.equal(await tile(boss.page, 'Admin').count(), 1);
    assert.equal(await tile(sam.page, 'Admin').count(), 0);
    await boss.ctx.close(); await sam.ctx.close();
  });

  it('suspend signs the user out and blocks sign-in, restore lets them back', async () => {
    const boss = await signin('boss', PW); // wrong: boss was registered with PW, same password
    await waitIn(boss.page, 'boss'); await app(boss.page, 'Admin');
    const sam = await signin('sam', PW); await waitIn(sam.page, 'sam');
    await adminRow(boss.page, 'sam').waitFor();
    await adminBtn(boss.page, 'sam', 'Suspend').click(); await confirmModal(boss.page);
    await boss.page.locator('.admin ul li', { hasText: 'suspended' }).first().waitFor();
    await sam.page.waitForFunction(() => /suspended/i.test(document.body.innerText), null, { timeout: 15000 });
    const again = await signin('sam', PW); await failedGate(again.page, /suspended/i); await again.ctx.close();
    await adminBtn(boss.page, 'sam', 'Restore').click();
    await boss.page.waitForFunction(() => ![...document.querySelectorAll('.admin ul li')].some(l => /suspended/.test(l.innerText)), null, { timeout: 15000 });
    const back = await signin('sam', PW); await waitIn(back.page, 'sam');
    await back.ctx.close(); await sam.ctx.close(); await boss.ctx.close();
  });

  it('reset password shows a temporary password once; it works and forces a change', async () => {
    const tina = await signup('tina'), boss = await signin('boss', PW); await waitIn(boss.page, 'boss'); await app(boss.page, 'Admin');
    await adminBtn(boss.page, 'tina', 'Reset password').click(); await confirmModal(boss.page);
    const code = boss.page.locator('.admin code.temp'); await code.waitFor();
    const temp = (await code.textContent()).trim(); assert.ok(temp.length >= 8, 'temporary password shown');
    await tina.page.waitForFunction(() => /reset/i.test(document.body.innerText), null, { timeout: 15000 });
    const old = await signin('tina', PW); await failedGate(old.page, /./); await old.ctx.close();
    const t2 = await signin('tina', temp); await waitIn(t2.page, 'tina');
    await t2.page.locator('.acct').waitFor({ timeout: 15000 });   // Settings opens by itself after a reset
    await t2.page.locator('.acct input[aria-label="Current password"]').fill(temp);
    await t2.page.locator('.acct input[aria-label="New password"]').fill(PW2);
    await t2.page.locator('.acct input[aria-label="Repeat new password"]').fill(PW2);
    await t2.page.locator('.acct button:text-is("Change password")').click();
    await t2.page.waitForFunction(() => /Password changed/.test(document.querySelector('.acct small.note')?.textContent || ''), null, { timeout: 15000 });
    await t2.ctx.close(); await tina.ctx.close(); await boss.ctx.close();
    const fin = await signin('tina', PW2); await waitIn(fin.page, 'tina'); await fin.ctx.close();
  });

  it('closing registration blocks new accounts, opening it allows them again', async () => {
    const boss = await signin('boss', PW); await waitIn(boss.page, 'boss'); await app(boss.page, 'Admin'); await tab(boss.page, 'Server');
    await boss.page.locator('.admin .stat2').first().waitFor();
    await boss.page.locator('.admin button:text-is("Close registration")').click();
    await boss.page.locator('.admin button:text-is("Open registration")').waitFor();
    const late = await open(); await late.page.click('#tabUp'); await late.page.fill('#nameIn', 'late'); await late.page.fill('#pwIn', PW); await late.page.fill('#pw2In', PW); await late.page.click('#goBtn');
    await failedGate(late.page, /closed/i); await late.ctx.close();
    const existing = await signin('sam', PW); await waitIn(existing.page, 'sam'); await existing.ctx.close();   // existing accounts are unaffected
    await boss.page.locator('.admin button:text-is("Open registration")').click();
    await boss.page.locator('.admin button:text-is("Close registration")').waitFor();
    const fresh = await signup('newbie'); await fresh.ctx.close(); await boss.ctx.close();
  });

  it('backups: back up now lists a zip that only the administrator can download', async () => {
    const boss = await signin('boss', PW); await waitIn(boss.page, 'boss'); await app(boss.page, 'Admin'); await tab(boss.page, 'Backups');
    await boss.page.locator('.admin li.empty:text-is("No backups yet")').waitFor();
    await boss.page.locator('.admin button:text-is("Back up now")').click();
    const link = boss.page.locator('.admin ul li a:text-is("Download")').first(); await link.waitFor({ timeout: 15000 });
    const href = await link.getAttribute('href'); assert.match(href, /^\/f\/backup\/.+\.zip$/);
    const adminRes = await boss.page.evaluate(async h => { const r = await fetch(h, { credentials: 'include' }); const b = new Uint8Array(await r.arrayBuffer()); return { status: r.status, magic: String.fromCharCode(b[0], b[1]) }; }, href);
    assert.equal(adminRes.status, 200); assert.equal(adminRes.magic, 'PK');
    const sam = await signin('sam', PW); await waitIn(sam.page, 'sam');
    const userRes = await sam.page.evaluate(async h => (await fetch(h, { credentials: 'include' })).status, href);
    assert.ok(userRes === 401 || userRes === 403 || userRes === 404, 'non-admin got ' + userRes);
    await sam.ctx.close(); await boss.ctx.close();
  });

  it('changing the password keeps old private messages readable after signing in again', async () => {
    const pia = await signup('pia'), quin = await signup('quin');
    await app(pia.page, 'Messages'); await app(quin.page, 'Messages');
    await pia.page.locator('#users li', { hasText: 'quin' }).first().click();
    await pia.page.fill('#inp', 'secret-before-change'); await pia.page.keyboard.press('Enter');
    await quin.page.locator('#users li', { hasText: 'pia' }).first().click();
    await quin.page.waitForSelector('#log .msg:has-text("secret-before-change")', { timeout: 15000 });
    await app(pia.page, 'Settings');
    await pia.page.locator('.acct input[aria-label="Current password"]').fill(PW);
    await pia.page.locator('.acct input[aria-label="New password"]').fill(PW2);
    await pia.page.locator('.acct input[aria-label="Repeat new password"]').fill(PW2);
    await pia.page.locator('.acct button:text-is("Change password")').click();
    await pia.page.waitForFunction(() => /Password changed/.test(document.querySelector('.acct small.note')?.textContent || ''), null, { timeout: 15000 });
    await pia.ctx.close();
    const oldPw = await signin('pia', PW); await failedGate(oldPw.page, /./); await oldPw.ctx.close();
    const again = await signin('pia', PW2); await waitIn(again.page, 'pia'); await app(again.page, 'Messages');
    await again.page.locator('#users li', { hasText: 'quin' }).first().click();
    await again.page.waitForSelector('#log .msg:has-text("secret-before-change")', { timeout: 15000 });
    await quin.page.fill('#inp', 'reply-after-change'); await quin.page.keyboard.press('Enter');
    await again.page.waitForSelector('#log .msg:has-text("reply-after-change")', { timeout: 15000 });
    await again.ctx.close(); await quin.ctx.close();
  });

  it('change password rejects a wrong current password and a mismatch without touching the account', async () => {
    const u = await signup('rhea'); await app(u.page, 'Settings');
    const f = l => u.page.locator('.acct input[aria-label="' + l + '"]'), msg = () => u.page.locator('.acct small.note').first();
    await f('Current password').fill('not-the-password'); await f('New password').fill(PW2); await f('Repeat new password').fill(PW2);
    await u.page.locator('.acct button:text-is("Change password")').click();
    await u.page.waitForFunction(() => /Wrong password/.test(document.querySelector('.acct small.note')?.textContent || ''), null, { timeout: 15000 });
    await f('Current password').fill(PW); await f('Repeat new password').fill('something-else-1');
    await u.page.locator('.acct button:text-is("Change password")').click();
    assert.match(await msg().textContent(), /do not match/i);
    await u.ctx.close();
    const ok = await signin('rhea', PW); await waitIn(ok.page, 'rhea'); await ok.ctx.close();
  });

  it('deleting your own account removes it', async () => {
    const d = await signup('dora'); await app(d.page, 'Settings');
    await d.page.locator('.acct input[aria-label="Password"]').fill(PW);
    await d.page.locator('.acct button:text-is("Delete my account")').click(); await confirmModal(d.page);
    await d.page.waitForFunction(() => document.querySelector('#login') && !document.querySelector('#login').hidden && getComputedStyle(document.querySelector('#login')).display !== 'none', null, { timeout: 15000 });
    await d.ctx.close();
    const gone = await signin('dora', PW); await failedGate(gone.page, /./); await gone.ctx.close();
  });

  it('no page errors during any of the above', () => { assert.deepEqual(problems, []); });
});
