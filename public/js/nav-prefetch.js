/**
 * Warm heavy routes on hover / pointerdown so Today → Focus / Pipeline feels faster.
 */
(function () {
  var warmed = Object.create(null);

  function resolveHref(el) {
    if (!el) return '';
    var custom = el.getAttribute('data-nav-prefetch');
    if (custom) return custom;
    var href = el.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#' || href.indexOf('javascript:') === 0) return '';
    try {
      return new URL(href, window.location.origin).pathname + new URL(href, window.location.origin).search;
    } catch (e) {
      return href;
    }
  }

  function warm(url) {
    if (!url || warmed[url]) return;
    warmed[url] = true;
    try {
      var link = document.createElement('link');
      link.rel = 'prefetch';
      link.as = 'document';
      link.href = url;
      document.head.appendChild(link);
    } catch (e) {}
    try {
      if (window.fetch) {
        fetch(url, {
          credentials: 'same-origin',
          headers: { Purpose: 'prefetch', 'Sec-Purpose': 'prefetch' },
        }).catch(function () {});
      }
    } catch (e2) {}
  }

  function onIntent(e) {
    var el = e.target && e.target.closest ? e.target.closest('a[href], [data-nav-prefetch]') : null;
    if (!el) return;
    warm(resolveHref(el));
  }

  document.addEventListener('pointerdown', onIntent, true);
  document.addEventListener('mouseover', onIntent, true);
  document.addEventListener('touchstart', onIntent, { capture: true, passive: true });

  // Idle-warm common destinations from Today and the shell.
  function idleWarmDefaults() {
    var path = window.location.pathname || '';
    var common = [
      '/today',
      '/opportunities',
      '/focus',
      '/prospecting?tab=pipeline',
      '/tasks',
      '/engagement',
      '/activity',
      '/referrals',
    ];
    common.forEach(function (url) {
      if (path === url || (url.indexOf('?') === -1 && path.indexOf(url) === 0)) return;
      warm(url);
    });
  }

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(idleWarmDefaults, { timeout: 2500 });
  } else {
    setTimeout(idleWarmDefaults, 1200);
  }
})();
