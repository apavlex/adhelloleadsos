/**
 * Contact hunt button — binds before app.js so clicks always register.
 * app.js registers __runContactHuntImpl + __setDeepEnhanceHuntUi when ready.
 */
(function () {
  'use strict';

  var clickLock = false;

  function primeHuntUiActive() {
    if (typeof window.__setDeepEnhanceHuntUi === 'function') {
      window.__setDeepEnhanceHuntUi('active', {
        phase: { pct: 8, label: 'Hunting…', detail: '' },
      });
      return;
    }
    var btn = document.getElementById('deepEnhanceBtn');
    if (!btn) return;
    btn.dataset.huntState = 'active';
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.classList.add('hunt-active', 'loading', 'cursor-wait');
    var progressRow = btn.querySelector('.deep-enhance-progress-row');
    var done = btn.querySelector('.deep-enhance-done');
    if (progressRow) progressRow.classList.remove('hidden');
    if (done) done.classList.add('hidden');
    var bar = document.getElementById('deepEnhanceProgressBar');
    if (bar) bar.style.width = '8%';
    var status = document.getElementById('deepEnhanceStatusLabel');
    if (status) status.textContent = 'Hunting…';
  }

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

    primeHuntUiActive();

    whenImplReady(function () {
      runImpl(row, btn).catch(function (err) {
        console.error('[Contact hunt]', err);
        if (typeof window.__stopHuntProgressTickerGlobal === 'function') {
          window.__stopHuntProgressTickerGlobal();
        }
        if (typeof window.__setDeepEnhanceHuntUi === 'function') window.__setDeepEnhanceHuntUi('idle');
        notify((err && err.message) || 'Contact hunt failed.', 'error');
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
    var btn = document.getElementById('deepEnhanceBtn');
    if (!btn) return;
    if (btn.dataset.huntState === 'active') {
      btn.dataset.huntState = 'idle';
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      btn.classList.remove('hunt-active', 'loading', 'cursor-wait');
      var progressRow = btn.querySelector('.deep-enhance-progress-row');
      if (progressRow) progressRow.classList.add('hidden');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', resetStuckHuntButton);
  } else {
    resetStuckHuntButton();
  }
})();
