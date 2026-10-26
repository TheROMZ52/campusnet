'use strict';
/* Translation integrity: every string the code asks to translate must exist in the Persian dictionary, with the same {placeholders}. */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const PUB = path.join(__dirname, '..', 'public');
const read = f => fs.readFileSync(path.join(PUB, f), 'utf8');
const box = { document: { documentElement: { classList: { toggle() {} } } }, localStorage: { getItem: () => 'fa' }, navigator: { language: 'fa' }, NodeFilter: {}, location: {} };
vm.createContext(box); vm.runInContext(read('i18n.js') + '\n;this.I18N = I18N;', box);
const FA = box.I18N.dictFa, has = k => Object.prototype.hasOwnProperty.call(FA, k);
const phs = s => (String(s).match(/\{(\w+)\}/g) || []).sort().join();
const lit = src => new Function('return ' + src)();
const CODE = ['app.js', 'shell.js', 'social.js', 'music.js', 'home.js', 'pwa.js'];

describe('i18n', () => {
  it('every tr()/trn() literal in the client code has a Persian entry', () => {
    const missing = [];
    for (const f of CODE) {
      const src = read(f);
      for (const m of src.matchAll(/\btr\('((?:[^'\\\n]|\\.)*)'/g)) { const k = lit("'" + m[1] + "'"); if (!has(k)) missing.push(f + ': ' + k); }
      for (const m of src.matchAll(/\btrn\([^,]+,\s*'((?:[^'\\\n]|\\.)*)',\s*'((?:[^'\\\n]|\\.)*)'/g)) for (const g of [m[1], m[2]]) { const k = lit("'" + g + "'"); if (!has(k)) missing.push(f + ': ' + k); }
    }
    assert.deepEqual([...new Set(missing)], []);
  });
  it('translations keep the same {placeholders} as their English key and are not empty', () => {
    const bad = Object.entries(FA).filter(([k, v]) => !String(v).trim() || phs(k) !== phs(v)).map(([k]) => k);
    assert.deepEqual(bad, []);
  });
  it('static page text in index.html is translated (except brand and symbols)', () => {
    let h = read('index.html'); h = h.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, '');
    const texts = [...h.matchAll(/>([^<>]+)</g)].map(m => m[1].trim()).concat([...h.matchAll(/(?:placeholder|aria-label|title|alt)="([^"]+)"/g)].map(m => m[1]));
    const allow = new Set(['CampusNet', 'OS', 'CAMPUSNET', '[ LINK', 'ready', '--', 'MB', '&gt;']);
    const missing = [...new Set(texts.filter(t => /[A-Za-z]{2}/.test(t) && !allow.has(t) && !has(t)))];
    assert.deepEqual(missing, []);
  });
  it('error messages the server sends are translated', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8'), missing = [];
    for (const m of src.matchAll(/(?:fail\(|text:\s*)'((?:[^'\\\n]|\\.)*)'/g)) { const k = lit("'" + m[1] + "'"); if (/^[A-Z]/.test(k) && /[a-z]{3}/.test(k) && !k.includes('${') && !has(k)) missing.push(k); }
    assert.deepEqual([...new Set(missing)], []);
  });
  it('tr() fills placeholders and falls back to English for unknown text', () => {
    assert.equal(box.I18N.tr('Welcome, {name}. Type /help for commands.', { name: 'Ali' }), FA['Welcome, {name}. Type /help for commands.'].replace('{name}', 'Ali'));
    assert.equal(box.I18N.tr('Some brand new sentence {x}', { x: 1 }), 'Some brand new sentence 1');
  });
});
