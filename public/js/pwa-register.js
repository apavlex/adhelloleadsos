(function () {
  if (!('serviceWorker' in navigator)) return;
  var swUrl = '/sw.js';
  var NAV_FIX = '676';
  window.addEventListener('load', function () {
    navigator.serviceWorker
      .register(swUrl)
      .then(function (reg) {
        try {
          reg.update();
        } catch (_) {
          /* ignore */
        }
        var worker = reg.waiting || reg.installing || reg.active;
        if (worker) {
          try {
            worker.postMessage({ type: 'SKIP_WAITING' });
          } catch (_) {
            /* ignore */
          }
          // One-shot: drop caches from SW builds that intercepted navigations.
          try {
            if (localStorage.getItem('adhello-sw-nav-fix') !== NAV_FIX) {
              worker.postMessage({ type: 'CLEAR_CACHES' });
              localStorage.setItem('adhello-sw-nav-fix', NAV_FIX);
            }
          } catch (_) {
            /* ignore */
          }
        }
      })
      .catch(function () {});
  });
})();
