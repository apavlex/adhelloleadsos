/**
 * Schedule callback → Tasks (lead panel). Document-level click like lead-panel-notes.js.
 */
(function () {
  'use strict';

  var submitInflight = false;
  var successTimer = null;
  var picker = null;

  function panelEl() {
    return document.getElementById('mobilePanel');
  }

  function panelTitle() {
    var el =
      document.getElementById('mobilePanelTitle') ||
      document.getElementById('stickyPanelTitle');
    return el ? String(el.textContent || '').trim() : '';
  }

  function normalizeTitle(t) {
    return String(t || '')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function selectedRow() {
    return document.querySelector(
      '#prospectLeadsTable tbody tr.result-row.selected, tr.result-row.selected:not(.result-row--panel-source)',
    );
  }

  function collectLeadKeys(extraRow) {
    var keys = [];
    function add(k) {
      var v = String(k || '').trim();
      if (v && keys.indexOf(v) === -1) keys.push(v);
    }
    var panel = panelEl();
    if (panel && panel.dataset) {
      add(String(panel.dataset.adhelloLeadKey || '').replace(/^lead:/i, ''));
    }
    add(String(window.__leadPanelActiveRowKey || '').replace(/^lead:/i, ''));
    var row = extraRow || selectedRow();
    if (row && row.dataset) {
      add(String(row.dataset.leadKey || '').replace(/^lead:/i, ''));
    }
    return keys;
  }

  function resolveLeadKey(extraRow) {
    var keys = collectLeadKeys(extraRow);
    for (var i = 0; i < keys.length; i += 1) {
      var k = keys[i];
      if (k && k.indexOf('title:') !== 0) return k;
    }
    return '';
  }

  function hintEl() {
    return document.getElementById('leadCallbackTaskHint');
  }

  function setHint(message, variant) {
    var hint = hintEl();
    if (!hint) return;
    var text = String(message || '').trim();
    if (!text) {
      hint.textContent = '';
      hint.classList.add('hidden');
      hint.classList.remove('lead-callback-hint--success', 'lead-callback-hint--error', 'lead-callback-hint--pending');
      return;
    }
    hint.textContent = text;
    hint.classList.remove('hidden');
    hint.classList.toggle('lead-callback-hint--success', variant === 'success');
    hint.classList.toggle('lead-callback-hint--error', variant === 'error');
    hint.classList.toggle('lead-callback-hint--pending', variant === 'pending');
    try {
      hint.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch (_) {}
  }

  function saveBtn() {
    return document.getElementById('leadCallbackSaveBtn');
  }

  function setBtnLoading(loading) {
    var btn = saveBtn();
    if (!btn) return;
    if (successTimer) {
      clearTimeout(successTimer);
      successTimer = null;
    }
    if (!btn.getAttribute('data-default-label')) {
      btn.setAttribute('data-default-label', (btn.textContent || 'Create callback task').trim());
    }
    if (loading) {
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
      btn.textContent = 'Booking…';
      btn.classList.remove('bg-emerald-600', 'hover:bg-emerald-700');
      btn.classList.add('bg-sky-600', 'hover:bg-sky-700');
      return;
    }
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    btn.textContent = btn.getAttribute('data-default-label') || 'Create callback task';
  }

  function setBtnSuccess() {
    var btn = saveBtn();
    if (!btn) return;
    if (successTimer) clearTimeout(successTimer);
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    btn.textContent = 'Booked ✓';
    btn.classList.remove('bg-sky-600', 'hover:bg-sky-700');
    btn.classList.add('bg-emerald-600', 'hover:bg-emerald-700', '!bg-emerald-600', 'dark:!bg-emerald-500');
    successTimer = setTimeout(function () {
      successTimer = null;
      btn.textContent = btn.getAttribute('data-default-label') || 'Create callback task';
      btn.classList.remove('bg-emerald-600', 'hover:bg-emerald-700', '!bg-emerald-600', 'dark:!bg-emerald-500');
      btn.classList.add('bg-sky-600', 'hover:bg-sky-700');
    }, 2800);
  }

  function ensurePicker() {
    if (picker) return picker;
    var at = document.getElementById('leadCallbackAt');
    if (!at) return null;
    if (at.__gcalPicker) {
      picker = at.__gcalPicker;
      return picker;
    }
    if (typeof window.initGcalDatetimePicker !== 'function') return null;
    picker = window.initGcalDatetimePicker(at, {
      label: 'Schedule callback date and time',
      triggerId: 'leadCallbackAt-trigger',
      fixedPopover: true,
    });
    return picker;
  }

  function resetScheduler() {
    setHint('');
    ensurePicker();
    var reason = document.getElementById('leadCallbackReason');
    if (reason && !String(reason.value || '').trim()) reason.value = 'Call back';
    var rem = document.getElementById('leadCallbackRemind15');
    if (rem) rem.checked = true;
    if (picker && typeof picker.setDefaultInDays === 'function') {
      picker.setDefaultInDays(1, 8, 0);
      return;
    }
    var at = document.getElementById('leadCallbackAt');
    if (at && !String(at.value || '').trim()) {
      var d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(8, 0, 0, 0);
      var pad = function (n) {
        return String(n).padStart(2, '0');
      };
      at.value =
        d.getFullYear() +
        '-' +
        pad(d.getMonth() + 1) +
        '-' +
        pad(d.getDate()) +
        'T' +
        pad(d.getHours()) +
        ':' +
        pad(d.getMinutes());
    }
  }

  function readRowUpdates(row) {
    if (!row || !row.dataset) return [];
    try {
      var parsed = JSON.parse(row.dataset.updates || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function appendCallbackActivity(row, message) {
    if (!row || !row.dataset) return;
    var updates = readRowUpdates(row);
    updates.push({
      type: 'callback_task',
      value: message,
      timestamp: new Date().toISOString(),
      source: 'panel_callback',
    });
    try {
      row.dataset.updates = JSON.stringify(updates);
    } catch (_) {}
    if (typeof window.renderLeadActivityTimeline === 'function') {
      try {
        window.renderLeadActivityTimeline(row, window.__leadActivityFilter || 'all');
      } catch (_) {}
    }
  }

  function toast(msg, variant) {
    if (typeof window.showAppToast === 'function') {
      window.showAppToast(msg, { variant: variant || 'success' });
    }
  }

  async function submitCallbackTask() {
    if (submitInflight) return false;
    ensurePicker();

    var at = document.getElementById('leadCallbackAt');
    var reasonEl = document.getElementById('leadCallbackReason');
    var rem = document.getElementById('leadCallbackRemind15');
    var when = at && at.value ? String(at.value).trim() : '';
    if (!when) {
      setHint('Pick a date and time.', 'error');
      toast('Pick a date and time.', 'error');
      return false;
    }
    var parsed = new Date(when);
    if (Number.isNaN(parsed.getTime())) {
      setHint('Invalid date or time.', 'error');
      toast('Invalid date or time.', 'error');
      return false;
    }

    var row = selectedRow();
    var leadKey = resolveLeadKey(row);
    var title = panelTitle() || (row && row.dataset && row.dataset.title) || 'Lead';
    var titleBits = ['Callback: ' + title];
    if (rem && rem.checked) titleBits.push('(remind T-15)');
    var reason = reasonEl && reasonEl.value ? String(reasonEl.value).trim() : '';
    if (reason) titleBits.push('— ' + reason);

    var whenLabel = parsed.toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
    var iso = parsed.toISOString();
    var successLine = 'Callback booked for ' + whenLabel + '. View it on Tasks.';

    submitInflight = true;
    setBtnLoading(true);
    setHint('Booking callback task…', 'pending');

    try {
      var res = await fetch('/tasks/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          title: titleBits.join(' '),
          scheduledAt: iso,
          leadKey: leadKey || null,
          column: 'todo',
        }),
      });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data.success) {
        throw new Error((data && data.error) || 'Could not create callback task.');
      }

      setBtnSuccess();
      setHint(successLine, 'success');
      appendCallbackActivity(row, successLine);
      toast('Callback task saved to Tasks.', 'success');
      return true;
    } catch (err) {
      var msg = err && err.message ? err.message : 'Could not book callback.';
      setHint(msg, 'error');
      toast(msg, 'error');
      setBtnLoading(false);
      return false;
    } finally {
      submitInflight = false;
    }
  }

  window.__adhelloEnsureLeadCallbackPicker = ensurePicker;
  window.__adhelloResetLeadCallbackScheduler = resetScheduler;
  window.__adhelloSubmitLeadCallbackTask = submitCallbackTask;

  document.addEventListener(
    'click',
    function (e) {
      if (!e.target.closest('#leadCallbackSaveBtn')) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      void submitCallbackTask();
    },
    true,
  );

  function boot() {
    if (!document.getElementById('leadCallbackAt')) return;
    ensurePicker();
    resetScheduler();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
