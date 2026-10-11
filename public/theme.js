(function () {
  var t = null;
  try { t = localStorage.getItem('cn:theme'); } catch (e) { /* ignore */ }
  if (!t) t = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
})();
