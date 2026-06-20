/**
 * Website audit button — binds before app.js (same pattern as contact hunt).
 */
(function () {
  'use strict';

  var clickLock = false;

  function runWebsiteAuditClick(ev) {
    if (clickLock) return;
    clickLock = true;
    setTimeout(function () {
      clickLock = false;
    }, 400);

    if (ev) {
      ev.preventDefault();
      if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
      if (typeof ev.stopPropagation === 'function') ev.stopPropagation();
    }

    function attempt(n) {
      if (typeof window.__adhelloRunPageSpeedAudit === 'function') {
        window.__adhelloRunPageSpeedAudit(ev).catch(function (err) {
          console.error('[Website audit]', err);
          notify((err && err.message) || 'Website audit failed.', 'error');
        });
        return;
      }
      if (n >= 200) {
        notify('Website audit failed to load. Hard refresh the page and try again.', 'error');
        return;
      }
      setTimeout(function () {
        attempt(n + 1);
      }, 50);
    }

    attempt(0);
  }

  function notify(msg, variant) {
    if (typeof window.showAppToast === 'function') {
      window.showAppToast(msg, { variant: variant || 'warning' });
    } else {
      window.alert(msg);
    }
  }

  window.__adhelloRunWebsiteAuditClick = runWebsiteAuditClick;

  if (!window.__adhelloWebsiteAuditEarlyBound) {
    window.__adhelloWebsiteAuditEarlyBound = true;
    document.addEventListener('click', function (e) {
      if (!e.target.closest || !e.target.closest('#pageSpeedAuditRunBtn')) return;
      runWebsiteAuditClick(e);
    }, true);
  }
})();
