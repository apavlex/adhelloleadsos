/**
 * Workspace audit request page settings.
 */
(function () {
  'use strict';

  function readForm() {
    var fields = {};
    document.querySelectorAll('.audit-field-enabled').forEach(function (el) {
      var key = el.getAttribute('data-field');
      if (!key) return;
      if (!fields[key]) fields[key] = {};
      fields[key].enabled = !!el.checked;
    });
    document.querySelectorAll('.audit-field-required').forEach(function (el) {
      var key = el.getAttribute('data-field');
      if (!key) return;
      if (!fields[key]) fields[key] = {};
      fields[key].required = !!el.checked;
    });
    document.querySelectorAll('.audit-field-label').forEach(function (el) {
      var key = el.getAttribute('data-field');
      if (!key) return;
      if (!fields[key]) fields[key] = {};
      fields[key].label = String(el.value || '').trim();
    });
    return {
      enabled: !!(document.getElementById('auditLandingEnabled') || {}).checked,
      headline: String((document.getElementById('auditLandingHeadline') || {}).value || '').trim(),
      subheadline: String((document.getElementById('auditLandingSubheadline') || {}).value || '').trim(),
      intro: String((document.getElementById('auditLandingIntro') || {}).value || '').trim(),
      submitLabel: String((document.getElementById('auditLandingSubmitLabel') || {}).value || '').trim(),
      thankYouTitle: String((document.getElementById('auditLandingThankYouTitle') || {}).value || '').trim(),
      thankYouBody: String((document.getElementById('auditLandingThankYouBody') || {}).value || '').trim(),
      smsSnippetTemplate: String((document.getElementById('auditLandingSmsTemplate') || {}).value || '').trim(),
      fields: fields,
    };
  }

  function flash(msg, ok) {
    var el = document.getElementById('auditLandingSaveMsg');
    if (!el) return;
    el.classList.remove('hidden');
    el.textContent = msg || '';
    el.className = 'text-sm ' + (ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-400');
  }

  function init() {
    var btn = document.getElementById('auditLandingSave');
    if (!btn) return;
    btn.addEventListener('click', function () {
      btn.disabled = true;
      fetch('/workspace/audit-landing-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ auditLandingPage: readForm() }),
      })
        .then(function (r) {
          return r.json();
        })
        .then(function (data) {
          flash(data.success ? 'Audit page saved.' : (data && data.error) || 'Save failed', !!data.success);
        })
        .catch(function () {
          flash('Save failed.', false);
        })
        .finally(function () {
          btn.disabled = false;
        });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
