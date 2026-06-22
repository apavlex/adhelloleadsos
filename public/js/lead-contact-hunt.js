/**
 * Contact hunt button — binds before app.js so clicks always register.
 * app.js registers __runContactHuntImpl + __setDeepEnhanceHuntUi when ready.
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

  function runImpl(row, btn) {
    return window.__runContactHuntImpl(row, { triggerBtn: btn || document.getElementById('deepEnhanceBtn') });
  }

  function whenImplReady(fn, attempts) {
    var n = attempts != null ? attempts : 0;
    if (typeof window.__runContactHuntImpl === 'function') {
      fn();
      return;
    }
    if (n >= 200) {
      notify('Contact hunt failed to load. Hard refresh the page and try again.', 'error');
      if (typeof window.__setDeepEnhanceHuntUi === 'function') window.__setDeepEnhanceHuntUi('idle');
      return;
    }
    setTimeout(function () {
      whenImplReady(fn, n + 1);
    }, 50);
  }

  function runContactHuntClick(ev) {
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

    var btn = document.getElementById('deepEnhanceBtn');
    if (btn && btn.disabled && btn.dataset.huntState === 'active') {
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

    whenImplReady(function () {
      runImpl(row, btn)
        .then(function (result) {
          if (result && result.success) return;
          if (result && result.error === 'busy') return;
          releaseHuntUiAfterFailure(
            result && result.error ? { message: result.error } : { message: 'Contact hunt failed.' }
          );
        })
        .catch(function (err) {
          console.error('[Contact hunt]', err);
          releaseHuntUiAfterFailure(err);
        });
    });
  }

  window.__adhelloRunContactHuntClick = runContactHuntClick;

  if (!window.__adhelloContactHuntEarlyBound) {
    window.__adhelloContactHuntEarlyBound = true;
    document.addEventListener('click', function (e) {
      if (!e.target.closest || !e.target.closest('#deepEnhanceBtn')) return;
      runContactHuntClick(e);
    }, true);
  }

  function resetStuckHuntButton() {
    window.__contactHuntInFlight = new Set();
    window.__panelHuntLeadKey = '';
    window.__panelHuntLeadTitle = '';
    window.__leadPanelJob = null;
    var btn = document.getElementById('deepEnhanceBtn');
    if (!btn) return;
    if (btn.dataset.huntState === 'active') {
      btn.dataset.huntState = 'idle';
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      delete btn.dataset.huntStartedAt;
      btn.classList.remove('hunt-active', 'loading', 'cursor-wait');
      var progressRow = btn.querySelector('.deep-enhance-progress-row');
      if (progressRow) progressRow.classList.add('hidden');
    }
  }

  function releaseHuntUiAfterFailure(err) {
    if (typeof window.__stopHuntProgressTickerGlobal === 'function') {
      window.__stopHuntProgressTickerGlobal();
    }
    if (typeof window.__setDeepEnhanceHuntUi === 'function') {
      window.__setDeepEnhanceHuntUi('idle');
    }
    if (err && err.message) notify(err.message, 'error');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', resetStuckHuntButton);
  } else {
    resetStuckHuntButton();
  }
})();
