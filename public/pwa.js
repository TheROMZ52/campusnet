'use strict';
/* Installable app: registers the service worker (needs HTTPS or localhost) and handles the install prompt. */
window.PWA = (function () {
  let deferred = null;
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const emit = () => document.dispatchEvent(new Event('cn:pwa'));
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; emit(); });
  window.addEventListener('appinstalled', () => { deferred = null; toast(tr('App installed'), 'ok', 2500); emit(); });
  if ('serviceWorker' in navigator && window.isSecureContext) {
    const had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('/sw.js').catch(() => { /* no service worker: the site still works online */ });
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (had) toast(tr('A new version is ready. Reload to use it.'), 'ok', 8000); });
  }
  return {
    /* 'installed' | 'prompt' (the browser can install it now) | 'ios' (manual steps) | 'none' */
    state() { return standalone() ? 'installed' : deferred ? 'prompt' : /iphone|ipad|ipod/i.test(navigator.userAgent) ? 'ios' : 'none'; },
    async install() { if (!deferred) return false; const d = deferred; deferred = null; emit(); d.prompt(); try { return (await d.userChoice).outcome === 'accepted'; } catch { return false; } }
  };
})();
