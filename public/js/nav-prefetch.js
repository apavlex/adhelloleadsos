/**
 * Warm destinations on hover / pointerdown so sidebar hops feel faster.
 * Do NOT idle-prefetch a pile of lead-heavy HTML routes — that jammed the
 * server after every page hop and left the nav spinner looking stuck.
 */
(function () {
  var warmed = Object.create(null);
  var controllers = [];

  // GETs with side effects: warming them would sign the user out on hover.
  var NEVER_WARM = /^\/(logout|live-demo)(\/|\?|$)/;

  function resolveHref(el) {
    if (!el || el.hasAttribute('data-no-prefetch')) return '';
    var custom = el.getAttribute('data-nav-prefetch');
    if (custom) return custom;
    var href = el.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#' || href.indexOf('javascript:') === 0) return '';
    var url;
    try {
      var u = new URL(href, window.location.origin);
      if (u.origin !== window.location.origin) return '';
      url = u.pathname + u.search;
    } catch (e) {
      url = href;
    }
    return NEVER_WARM.test(url) ? '' : url;
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
        var ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
        if (ac) controllers.push(ac);
        fetch(url, {
          credentials: 'same-origin',
          headers: { Purpose: 'prefetch', 'Sec-Purpose': 'prefetch' },
          signal: ac ? ac.signal : undefined,
        }).catch(function () {});
      }
    } catch (e2) {}
  }

  function abortPendingWarms() {
    while (controllers.length) {
      var ac = controllers.pop();
      try { ac.abort(); } catch (e) {}
    }
  }

  function onIntent(e) {
    var el = e.target && e.target.closest ? e.target.closest('a[href], [data-nav-prefetch]') : null;
    if (!el) return;
    warm(resolveHref(el));
  }

  document.addEventListener('pointerdown', onIntent, true);
  document.addEventListener('mouseover', onIntent, true);
  document.addEventListener('touchstart', onIntent, { capture: true, passive: true });
  // Leaving the page: drop in-flight prefetch so it cannot race the real nav.
  window.addEventListener('pagehide', abortPendingWarms);
  window.addEventListener('beforeunload', abortPendingWarms);

  // Idle-warm only Workspace settings sibling tabs (light locals). No global
  // pile of /today /prospecting /focus /… — those are lead-scan HTML pages.
  function idleWarmWorkspaceSiblings() {
    var path = window.location.pathname || '';
    if (path.indexOf('/workspace') !== 0) return;

    var urls = [];
    var nav = document.getElementById('wsSettingsNav');
    if (nav) {
      var links = nav.querySelectorAll('a.ws-nav-item[href]');
      for (var i = 0; i < links.length; i++) {
        var href = resolveHref(links[i]);
        if (href) urls.push(href);
      }
    } else {
      urls = [
        '/workspace/team',
        '/workspace/white-label',
        '/workspace/pipeline',
        '/workspace/integrations',
        '/workspace/ai-apps',
        '/workspace/phones',
        '/workspace/routing',
        '/workspace/revenue',
      ];
    }

    var idx = 0;
    function next() {
      if (idx >= urls.length) return;
      warm(urls[idx++]);
      if (idx < urls.length) {
        if ('requestIdleCallback' in window) {
          window.requestIdleCallback(next, { timeout: 1500 });
        } else {
          setTimeout(next, 200);
        }
      }
    }
    next();
  }

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(idleWarmWorkspaceSiblings, { timeout: 2500 });
  } else {
    setTimeout(idleWarmWorkspaceSiblings, 1200);
  }
})();
