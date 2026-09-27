/**
 * Lead panel quick log → follow-up task + reminder (same presets as the softphone strip).
 * applyLeadPanelQuickLogTag in app.js reads the chosen date via window.__adhelloLeadFollowup.
 */
(function () {
  'use strict';

  var picker = null;
  var lastLeadKey = null;

  function el(id) {
    return document.getElementById(id);
  }

  function ensurePicker() {
    if (picker) return picker;
    var at = el('leadFollowupAt');
    if (!at) return null;
    if (at.__gcalPicker) {
      picker = at.__gcalPicker;
      return picker;
    }
    if (typeof window.initGcalDatetimePicker !== 'function') return null;
    picker = window.initGcalDatetimePicker(at, {
      label: 'Follow-up date & time',
      triggerId: 'leadFollowupAt-trigger',
      emptyLabel: 'Auto — based on quick log',
      fixedPopover: true,
    });
    return picker;
  }

  function isEnabled() {
    var cb = el('leadFollowupEnable');
    return !cb || !!cb.checked;
  }

  function setPresetActive(preset) {
    document.querySelectorAll('.lead-followup-preset').forEach(function (btn) {
      var on = !!preset && btn.getAttribute('data-preset') === preset;
      btn.setAttribute('data-active', on ? 'true' : 'false');
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function setValue(d) {
    var p = ensurePicker();
    if (p) {
      p.setValue(d);
      return;
    }
    var at = el('leadFollowupAt');
    if (!at) return;
    if (!d) {
      at.value = '';
      return;
    }
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

  function applyPreset(preset) {
    if (preset === 'custom') {
      var p = ensurePicker();
      if (p) p.open();
      setPresetActive('custom');
      return;
    }
    var d = new Date();
    var days = preset === '3days' ? 3 : preset === 'nextweek' ? 7 : 1;
    d.setDate(d.getDate() + days);
    d.setHours(10, 0, 0, 0);
    setValue(d);
    setPresetActive(preset);
  }

  function syncEnabledUi() {
    var on = isEnabled();
    var wrap = el('leadFollowupWrap');
    if (wrap) wrap.classList.toggle('hidden', !on);
    document.querySelectorAll('.lead-followup-preset').forEach(function (btn) {
      btn.disabled = !on;
      btn.classList.toggle('opacity-40', !on);
    });
  }

  function clear() {
    setValue(null);
    setPresetActive('');
  }

  /**
   * Body fields for POST /leads/:key/disposition.
   * Empty date → server picks the per-outcome default (e.g. VM today 4pm, no pickup next dial window).
   */
  function payloadFor(cfg) {
    if (!isEnabled()) return { skipFollowUp: true };
    if (cfg && cfg.enableFollowup === false) return { skipFollowUp: true };
    ensurePicker();
    var at = el('leadFollowupAt');
    var when = at && at.value ? String(at.value).trim() : '';
    if (!when) return {};
    var parsed = new Date(when);
    if (Number.isNaN(parsed.getTime())) return {};
    return { scheduledAt: parsed.toISOString() };
  }

  function afterLogged(data) {
    var task = data && data.followUpTask;
    var scheduled = (task && task.scheduledAt) || (data && data.scheduledAt) || '';
    clear();
    if (!scheduled || !task) return '';
    if (window.AgencyTaskReminders && window.AgencyTaskReminders.ensurePermissionForScheduledTask) {
      window.AgencyTaskReminders.ensurePermissionForScheduledTask()
        .then(function () {
          if (window.AgencyTaskReminders.refresh) return window.AgencyTaskReminders.refresh();
        })
        .then(function () {
          if (window.AgencyTaskReminders.tick) window.AgencyTaskReminders.tick();
        })
        .catch(function () {});
    }
    var d = new Date(scheduled);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  /** Reset only when the open lead changes so a picked date survives panel re-renders. */
  function resetForRow(row) {
    ensurePicker();
    var key = String((row && row.dataset && row.dataset.leadKey) || '').trim();
    if (key === lastLeadKey) return;
    lastLeadKey = key;
    var cb = el('leadFollowupEnable');
    if (cb) cb.checked = true;
    syncEnabledUi();
    clear();
  }

  window.__adhelloLeadFollowup = {
    payloadFor: payloadFor,
    afterLogged: afterLogged,
    resetForRow: resetForRow,
  };

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.lead-followup-preset');
    if (!btn || btn.disabled) return;
    e.preventDefault();
    e.stopPropagation();
    applyPreset(btn.getAttribute('data-preset') || 'tomorrow');
  });

  document.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'leadFollowupEnable') syncEnabledUi();
  });

  function boot() {
    if (!el('leadFollowupAt')) return;
    ensurePicker();
    syncEnabledUi();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
  window.addEventListener('load', boot);
})();
