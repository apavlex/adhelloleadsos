/**
 * Intent-only document warm (hover / pointerdown).
 *
 * Why: full idle-warm of /today,/prospecting,/focus,… jammed the server.
 * Returning 204 for Prefetch poisoned the next navigation (blank page).
 * Disabling warm entirely made every hop a cold getAllLeads — slow again.
 *
 * Safe path: warm only the link the user is about to open, with a real HTML
 * GET (so the leads list cache heats), abort in-flight work on leave, and
 * never idle-prefetch a pile of routes.
 */
(function () {
  var warmed = Object.create(null);
  var controllers = [];
  var hoverTimer = null;
  var inflight = 0;
  var queue = [];
  var MAX_INFLIGHT = 2;

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

  function pump() {
    while (inflight < MAX_INFLIGHT && queue.length) {
      var url = queue.shift();
      runFetch(url);
    }
  }

  function runFetch(url) {
    if (!window.fetch) return;
    inflight += 1;
    var ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
    if (ac) controllers.push(ac);
    fetch(url, {
      credentials: 'same-origin',
      headers: { Purpose: 'prefetch', 'Sec-Purpose': 'prefetch' },
      signal: ac ? ac.signal : undefined,
    })
      .catch(function () {})
      .then(function () {
        inflight = Math.max(0, inflight - 1);
        if (ac) {
          var i = controllers.indexOf(ac);
          if (i >= 0) controllers.splice(i, 1);
        }
        pump();
      });
  }

  function warm(url) {
    if (!url || warmed[url]) return;
    // Skip current page.
    try {
      var here = window.location.pathname + window.location.search;
      if (url === here) return;
    } catch (e) {}
    warmed[url] = true;
    queue.push(url);
    pump();
  }

  function abortPendingWarms() {
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
    queue.length = 0;
    while (controllers.length) {
      var ac = controllers.pop();
      try { ac.abort(); } catch (e) {}
    }
    inflight = 0;
  }

  function fromEvent(e) {
    var el = e.target && e.target.closest ? e.target.closest('a[href], [data-nav-prefetch]') : null;
    return el ? resolveHref(el) : '';
  }

  document.addEventListener('pointerdown', function (e) {
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
    warm(fromEvent(e));
  }, true);

  document.addEventListener(
    'mouseover',
    function (e) {
      var url = fromEvent(e);
      if (!url) return;
      if (hoverTimer) clearTimeout(hoverTimer);
      hoverTimer = setTimeout(function () {
        hoverTimer = null;
        warm(url);
      }, 120);
    },
    true
  );

  document.addEventListener(
    'touchstart',
    function (e) {
      warm(fromEvent(e));
    },
    { capture: true, passive: true }
  );

  window.addEventListener('pagehide', abortPendingWarms);
  window.addEventListener('beforeunload', abortPendingWarms);
})();
