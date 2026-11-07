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
  it('keeps the mobile chat expanded and renders local commands', async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage(), name = 'chatlayout';
    page.on('pageerror', e => problems.push(e.message));
    await page.goto(s.base + '/');
    await page.click('#tabUp');
    await page.fill('#nameIn', name);
    await page.fill('#pwIn', PW);
    await page.fill('#pw2In', PW);
    await page.click('#goBtn');
    await page.waitForFunction(n => document.querySelector('#meBar')?.textContent.startsWith(n), name, { timeout: 15000 });
    const layout = await page.evaluate(() => {
      const rect = selector => {
        const r = document.querySelector(selector).getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, height: r.height };
      };
      return {
        viewport: window.innerHeight,
        app: rect('#app'),
        main: rect('main'),
        center: rect('#center'),
        log: rect('#log'),
        tabs: rect('#tabs')
      };
    });
    assert.ok(layout.tabs.bottom >= layout.viewport - 4, 'mobile tabs stay at the bottom: ' + JSON.stringify(layout));
    assert.ok(layout.main.height > 300, 'main area fills the viewport: ' + JSON.stringify(layout));
    assert.ok(layout.center.height > 250, 'chat panel has usable height: ' + JSON.stringify(layout));
    assert.ok(layout.log.height > 150, 'message log remains expanded: ' + JSON.stringify(layout));
    await page.fill('#inp', '/help');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => [...document.querySelectorAll('#log .msg')].some(row => row.textContent.includes('/help')));
    assert.ok(await page.locator('#log').innerText().then(t => t.includes('/help')), 'local /help output is visible');
    await ctx.close();
  });

  it('chat still fills the screen on a WebView without dvh support', async () => {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 766 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage(), name = 'nodvh';
    page.on('pageerror', e => problems.push(e.message));
    await page.route('**/style.css', async route => { const res = await route.fetch(); await route.fulfill({ response: res, body: (await res.text()).replace(/(min-)?height:100dvh;?/g, '') }); });
    await page.goto(s.base + '/');
    await page.click('#tabUp'); await page.fill('#nameIn', name); await page.fill('#pwIn', PW); await page.fill('#pw2In', PW); await page.click('#goBtn');
    await page.waitForFunction(n => document.querySelector('#meBar')?.textContent.startsWith(n), name, { timeout: 15000 });
    const m = await page.evaluate(() => { const r = q => document.querySelector(q).getBoundingClientRect(); return { vh: innerHeight, app: r('#app').height, desk: r('#desk').height, log: r('#log').height, tabsBottom: r('#tabs').bottom, over: document.documentElement.scrollWidth - innerWidth }; });
    assert.ok(m.app >= m.vh - 2, 'app fills the screen: ' + JSON.stringify(m));
    assert.ok(m.desk > m.vh * 0.6 && m.log > 250, 'chat area is expanded: ' + JSON.stringify(m));
    assert.ok(m.tabsBottom >= m.vh - 4, 'tabs stay at the bottom: ' + JSON.stringify(m));
    assert.ok(m.over <= 0, 'no sideways scroll: ' + JSON.stringify(m));
    await ctx.close();
  });

  it('without dvh support the app height follows the real window height, also when it shrinks (keyboard)', async () => {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 766 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage(), name = 'nodvh2';
    page.on('pageerror', e => problems.push(e.message));
    await page.addInitScript(() => { const o = CSS.supports.bind(CSS); CSS.supports = (...a) => (a.join(' ').includes('dvh') ? false : o(...a)); });
    await page.route('**/style.css', async route => { const res = await route.fetch(); await route.fulfill({ response: res, body: (await res.text()).replace(/(min-)?height:100dvh;?/g, '') }); });
    await page.goto(s.base + '/');
    await page.click('#tabUp'); await page.fill('#nameIn', name); await page.fill('#pwIn', PW); await page.fill('#pw2In', PW); await page.click('#goBtn');
    await page.waitForFunction(n => document.querySelector('#meBar')?.textContent.startsWith(n), name, { timeout: 15000 });
    const read = () => page.evaluate(() => ({ vh: innerHeight, v: document.documentElement.style.getPropertyValue('--app-h'), app: document.querySelector('#app').getBoundingClientRect().height, tabsBottom: document.querySelector('#tabs').getBoundingClientRect().bottom }));
    let m = await read(); assert.equal(m.v, m.vh + 'px'); assert.ok(m.app >= m.vh - 2 && m.tabsBottom >= m.vh - 4, JSON.stringify(m));
    await page.setViewportSize({ width: 360, height: 440 }); await page.waitForTimeout(300);
    m = await read(); assert.equal(m.v, m.vh + 'px'); assert.ok(m.app >= m.vh - 2 && m.tabsBottom >= m.vh - 4, JSON.stringify(m));
    await ctx.close();
  });

  for (const height of [480, 568, 640]) {
    it(`login and register remain reachable at ${height}px viewport height`, async () => {
      const ctx = await browser.newContext({ viewport: { width: 360, height }, isMobile: true, hasTouch: true, locale: 'fa-IR' });
      const page = await ctx.newPage();
      await page.goto(s.base + '/');
      for (const mode of ['login', 'register']) {
        if (mode === 'register') await page.click('#tabUp');
        const metrics = await page.evaluate(() => {
          const root = document.querySelector('#login');
          return { client: root.clientHeight, scroll: root.scrollHeight, width: document.documentElement.scrollWidth - document.documentElement.clientWidth };
        });
        assert.equal(metrics.width, 0, 'no horizontal overflow');
        assert.ok(metrics.scroll >= metrics.client, 'login container can scroll vertically when needed');
        await page.locator('#login').evaluate(node => { node.scrollTop = node.scrollHeight; });
        assert.ok(await page.locator('#goBtn').isVisible(), `${mode} submit remains reachable`);
      }
      await ctx.close();
    });
  }
  it('no page errors', () => { assert.deepEqual(problems, []); });
});
