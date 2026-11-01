(function () {
  if (!('serviceWorker' in navigator)) return;
  var swUrl = '/sw.js';
  window.addEventListener('load', function () {
    navigator.serviceWorker
      .register(swUrl)
      .then(function (reg) {
        // Pick up CACHE_VERSION bumps (blank-screen / frost hotfixes) without waiting
        // for the browser's 24h SW update check.
        try {
          reg.update();
        } catch (_) {
          /* ignore */
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
