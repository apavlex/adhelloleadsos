(function () {
  if (!('serviceWorker' in navigator)) return;
  var swUrl = '/sw.js';
  window.addEventListener('load', function () {
    navigator.serviceWorker
      .register(swUrl)
      .then(function (reg) {
        // Throttle update checks — calling update + skipWaiting on every page
        // re-claimed clients and made hops feel slow.
        var now = Date.now();
        var last = 0;
        try {
          last = parseInt(sessionStorage.getItem('adhello-sw-checked') || '0', 10) || 0;
        } catch (_) {
          /* ignore */
        }
        if (!last || now - last > 5 * 60 * 1000) {
          try {
            sessionStorage.setItem('adhello-sw-checked', String(now));
          } catch (_) {
            /* ignore */
          }
          try {
            reg.update();
          } catch (_) {
            /* ignore */
          }
        }
        if (reg.waiting) {
          try {
            reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          } catch (_) {
            /* ignore */
          }
        }
      })
      .catch(function () {});
  });
})();
