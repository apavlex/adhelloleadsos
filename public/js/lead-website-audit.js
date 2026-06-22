/**
 * Website audit button — binds before app.js (same pattern as contact hunt).
 */
(function () {
  'use strict';

  var clickLock = false;

  function resolveRow() {
    if (typeof window.__resolveRowForLeadPanelActions === 'function') {
      return window.__resolveRowForLeadPanelActions();
    }
    if (typeof window.__resolveActiveLeadRow === 'function') {
      return window.__resolveActiveLeadRow();
    }
    return document.querySelector('.result-row.selected:not(.result-row--panel-source)');
  }

  function notify(msg, variant) {
    if (typeof window.showAppToast === 'function') {
      window.showAppToast(msg, { variant: variant || 'warning' });
    } else {
      window.alert(msg);
    }
  }

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

    var btn = document.getElementById('pageSpeedAuditRunBtn');
    if (btn && btn.disabled && btn.dataset.auditState === 'active') {
      return;
    }

    var row = resolveRow();
    if (!row) {
      notify('Select a lead from the table first.', 'warning');
      return;
    }

    if (typeof window.__adhelloSetCurrentLeadRow === 'function') {
      window.__adhelloSetCurrentLeadRow(row);
    }

    function attempt(n) {
      if (typeof window.__adhelloRunPageSpeedAudit === 'function') {
        window.__adhelloRunPageSpeedAudit(row, ev).catch(function (err) {
          console.error('[Website audit]', err);
          if (typeof window.__stopPageSpeedAuditProgressTicker === 'function') {
            window.__stopPageSpeedAuditProgressTicker();
          }
          if (typeof window.__setPageSpeedAuditUi === 'function') {
            window.__setPageSpeedAuditUi('idle');
          }
          notify((err && err.message) || 'Website audit failed.', 'error');
        });
        return;
      }
      if (n >= 200) {
        notify('Website audit failed to load. Hard refresh the page and try again.', 'error');
        if (typeof window.__setPageSpeedAuditUi === 'function') window.__setPageSpeedAuditUi('idle');
        return;
      }
      setTimeout(function () {
        attempt(n + 1);
      }, 50);
    }

    attempt(0);
  }

  window.__adhelloRunWebsiteAuditClick = runWebsiteAuditClick;

  if (!window.__adhelloWebsiteAuditEarlyBound) {
    window.__adhelloWebsiteAuditEarlyBound = true;
    document.addEventListener('click', function (e) {
      if (!e.target.closest || !e.target.closest('#pageSpeedAuditRunBtn')) return;
      runWebsiteAuditClick(e);
    }, true);
  }

  function resetStuckAuditButton() {
    window.__pageSpeedAuditLeadKey = '';
    window.__pageSpeedAuditLeadTitle = '';
    if (window.__leadPanelJob && window.__leadPanelJob.kind === 'audit') {
      window.__leadPanelJob = null;
    }
    var btn = document.getElementById('pageSpeedAuditRunBtn');
    if (!btn) return;
    if (btn.dataset.auditState === 'active') {
      btn.dataset.auditState = 'idle';
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      btn.classList.remove('audit-active', 'cursor-wait');
      var progressRow = btn.querySelector('.page-speed-audit-progress-row');
      if (progressRow) progressRow.classList.add('hidden');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', resetStuckAuditButton);
  } else {
    resetStuckAuditButton();
  }
})();
