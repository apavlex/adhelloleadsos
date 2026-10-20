/**
 * Check running ads (Outscraper Ads Checker) — business details panel + Money mode.
 * POST /leads/:key/check-ads
 */
(function (global) {
  'use strict';

  var clickLock = false;

  function leadKeyFromArg(leadKey) {
    return String(leadKey || '')
      .trim()
      .replace(/^lead:/i, '');
  }

  function toast(message, variant) {
    if (typeof global.showAppToast === 'function') {
      global.showAppToast(message, { variant: variant || 'info' });
      return;
    }
    if (message) global.alert(message);
  }

  function setStatus(el, message, isError) {
    if (!el) return;
    if (!message) {
      el.textContent = '';
      el.classList.add('hidden');
      return;
    }
    el.textContent = message;
    el.classList.remove('hidden');
    el.classList.add('px-3', 'py-2', 'rounded-xl', 'border');
    el.classList.toggle('text-emerald-700', !isError);
    el.classList.toggle('dark:text-emerald-300', !isError);
    el.classList.toggle('text-amber-700', !!isError);
    el.classList.toggle('dark:text-amber-300', !!isError);
    el.classList.toggle('bg-emerald-50', !isError);
    el.classList.toggle('dark:bg-emerald-950/30', !isError);
    el.classList.toggle('bg-amber-50', !!isError);
    el.classList.toggle('dark:bg-amber-950/30', !!isError);
    el.classList.toggle('border-emerald-200', !isError);
    el.classList.toggle('dark:border-emerald-800/50', !isError);
    el.classList.toggle('border-amber-200', !!isError);
    el.classList.toggle('dark:border-amber-800/50', !!isError);
  }

  function setBtnUi(btn, state) {
    if (!btn) return;
    var next = state || 'idle';
    btn.dataset.adsCheckState = next;
    btn.setAttribute('aria-busy', next === 'active' ? 'true' : 'false');
    var idle = btn.querySelector('.ads-check-idle');
    var active = btn.querySelector('.ads-check-active');
    var done = btn.querySelector('.ads-check-done');
    if (idle) idle.classList.toggle('hidden', next !== 'idle');
    if (active) active.classList.toggle('hidden', next !== 'active');
    if (done) done.classList.toggle('hidden', next !== 'done');
    btn.classList.toggle('opacity-55', next === 'idle' && btn.getAttribute('data-ads-check-blocked') === '1');
  }

  function statusElForButton(btn) {
    if (!btn) return null;
    if (btn.id === 'focus-ads-check-btn') return document.getElementById('focus-ads-check-status');
    return document.getElementById('leadPanelAdsCheckStatus');
  }

  function paintResultChip(lead) {
    var panelChip = document.getElementById('leadPanelAdsCheckResult');
    var focusChip = document.getElementById('focus-ads-check-result');
    var text = '';
    if (lead && (lead.adsCheckedAt || lead.adsRunning != null)) {
      if (lead.adsRunning) {
        var parts = [];
        if (lead.adsRunningGoogle) parts.push('Google');
        if (lead.adsRunningLinkedin) parts.push('LinkedIn');
        text = parts.length ? 'Running ads: ' + parts.join(' + ') : 'Running paid ads';
      } else {
        text = 'No paid ads detected';
      }
    }
    [panelChip, focusChip].forEach(function (el) {
      if (!el) return;
      if (!text) {
        el.textContent = '';
        el.classList.add('hidden');
        return;
      }
      el.textContent = text;
      el.classList.remove('hidden');
      el.classList.toggle('border-emerald-500/40', !!lead.adsRunning);
      el.classList.toggle('bg-emerald-500/10', !!lead.adsRunning);
      el.classList.toggle('text-emerald-800', !!lead.adsRunning);
      el.classList.toggle('dark:text-emerald-200', !!lead.adsRunning);
      el.classList.toggle('border-brand-border/60', !lead.adsRunning);
      el.classList.toggle('bg-brand-cream/40', !lead.adsRunning);
      el.classList.toggle('dark:bg-slate-800/60', !lead.adsRunning);
      el.classList.toggle('text-brand-muted', !lead.adsRunning);
    });
  }

  async function runAdsCheck(leadKey, opts) {
    opts = opts || {};
    var key = leadKeyFromArg(leadKey);
    var btn = opts.btn || null;
    var statusEl = opts.statusEl || statusElForButton(btn);
    if (!key) {
      setStatus(statusEl, 'Save this lead first.', true);
      return null;
    }
    if (btn && btn.dataset.adsCheckBlocked === '1') {
      setStatus(statusEl, btn.dataset.adsCheckBlockedReason || 'Add a website first.', true);
      return null;
    }
    if (clickLock) return null;
    clickLock = true;
    if (btn) setBtnUi(btn, 'active');
    setStatus(statusEl, 'Checking Google / LinkedIn ads via Outscraper…', false);
    try {
      var res = await fetch('/leads/' + encodeURIComponent(key) + '/check-ads', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data.success) {
        var err = (data && data.error) || 'Ads check failed.';
        setStatus(statusEl, err, true);
        toast(err, 'error');
        if (btn) setBtnUi(btn, 'idle');
        return null;
      }
      var msg = (data && data.message) || 'Ads check complete.';
      setStatus(statusEl, msg, false);
      paintResultChip(data.lead || {});
      if (btn) {
        setBtnUi(btn, 'done');
        setTimeout(function () {
          setBtnUi(btn, 'idle');
        }, 2200);
      }
      toast(msg, 'success');
      if (typeof opts.onUpdated === 'function' && data.lead) opts.onUpdated(data.lead);
      return data;
    } catch (e) {
      var fail = (e && e.message) || 'Ads check failed.';
      setStatus(statusEl, fail, true);
      toast(fail, 'error');
      if (btn) setBtnUi(btn, 'idle');
      return null;
    } finally {
      clickLock = false;
    }
  }

  function bindAdsCheckButton(btn, opts) {
    if (!btn || btn.dataset.adsCheckBound === '1') return;
    btn.dataset.adsCheckBound = '1';
    opts = opts || {};
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var key =
        (typeof opts.getLeadKey === 'function' && opts.getLeadKey()) ||
        btn.getAttribute('data-lead-key') ||
        '';
      void runAdsCheck(key, {
        btn: btn,
        statusEl: opts.statusEl || statusElForButton(btn),
        onUpdated: opts.onUpdated,
      });
    });
  }

  function paintAdsCheckButton(btn, opts) {
    if (!btn) return;
    opts = opts || {};
    var hasWebsite = !!opts.hasWebsite;
    var key = String(opts.leadKey || btn.getAttribute('data-lead-key') || '').trim();
    btn.dataset.leadKey = key;
    var blocked = !key || !hasWebsite;
    btn.dataset.adsCheckBlocked = blocked ? '1' : '0';
    btn.dataset.adsCheckBlockedReason = !key
      ? 'Save this lead before checking ads.'
      : !hasWebsite
        ? 'Add a website URL to check running ads.'
        : '';
    btn.title = blocked
      ? btn.dataset.adsCheckBlockedReason
      : 'Check Google / LinkedIn ads via Outscraper Ads Checker';
    btn.classList.toggle('opacity-55', blocked);
    if (opts.lead) paintResultChip(opts.lead);
  }

  global.runLeadAdsCheck = runAdsCheck;
  global.bindAdsCheckButton = bindAdsCheckButton;
  global.paintAdsCheckButton = paintAdsCheckButton;
  global.paintLeadAdsCheckResult = paintResultChip;
})(typeof window !== 'undefined' ? window : global);
