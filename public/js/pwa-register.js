(function () {
  if (!('serviceWorker' in navigator)) return;
  var swUrl = '/sw.js';
  window.addEventListener('load', function () {
    navigator.serviceWorker.register(swUrl).catch(function () {});
  });
})();
