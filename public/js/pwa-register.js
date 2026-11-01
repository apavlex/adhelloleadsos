(function () {
  if (!('serviceWorker' in navigator)) return;
  var swUrl = '/sw.js';
  window.addEventListener('load', function () {
    navigator.serviceWorker
      .register(swUrl)
      .then(function (reg) {
        try {
          reg.update();
        } catch (_) {
          /* ignore */
        }
        // Drop poisoned caches from older SW builds that intercepted navigations.
        var worker = reg.active || reg.waiting || reg.installing;
        if (worker) {
          try {
            worker.postMessage({ type: 'CLEAR_CACHES' });
          } catch (_) {
            /* ignore */
          }
          try {
            worker.postMessage({ type: 'SKIP_WAITING' });
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
