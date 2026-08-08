/**
 * RapidAPI website enrich — shared by pipeline sidebar and Focus mode.
 */
(function (global) {
  'use strict';

  function leadKeyFromArg(leadKey) {
    return String(leadKey || '')
      .trim()
      .replace(/^lead:/i, '');
  }

  function toast(message, variant) {
    if (typeof global.showAppToast === 'function') {
      global.showAppToast(message, { variant: variant || 'info' });
    }
  }

  function setStatus(el, message, isError) {
    if (!el) return;
    if (!message) {
      el.textContent = '';
      el.classList.add('hidden');
      el.classList.remove(
        'text-emerald-700',
        'dark:text-emerald-300',
        'text-amber-700',
        'dark:text-amber-300',
        'bg-emerald-50',
        'dark:bg-emerald-950/30',
        'bg-amber-50',
        'dark:bg-amber-950/30',
        'border-emerald-200',
        'dark:border-emerald-800/50',
        'border-amber-200',
        'dark:border-amber-800/50',
        'px-3',
        'py-2',
        'rounded-xl',
        'border'
      );
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
    try {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch (_) {}
  }

  function setEnrichUi(btn, state) {
    if (!btn) return;
    const next = state || 'idle';
    btn.dataset.enrichState = next;
    btn.setAttribute('aria-busy', next === 'active' ? 'true' : 'false');
    btn.classList.toggle('rapidapi-enrich-btn--active', next === 'active');
    btn.classList.toggle('rapidapi-enrich-btn--done', next === 'done');
  }

  /**
   * @param {string} leadKey
   * @param {{ btn?: HTMLElement, statusEl?: HTMLElement, onUpdated?: function(object): void, blockedReason?: string }} [opts]
   */
  async function runLeadRapidapiWebsiteEnrich(leadKey, opts) {
    opts = opts || {};
    const btn = opts.btn || null;

    if (opts.blockedReason) {
      setStatus(opts.statusEl, opts.blockedReason, true);
      toast(opts.blockedReason, 'warning');
      return { success: false, error: 'blocked' };
    }

    const key = leadKeyFromArg(leadKey);
    if (!key) {
      const msg = 'Select a saved lead before enriching.';
      setStatus(opts.statusEl, msg, true);
      toast(msg, 'warning');
      return { success: false, error: 'missing_key' };
    }

    if (btn) {
      btn.disabled = true;
      setEnrichUi(btn, 'active');
    }
    setStatus(opts.statusEl, 'Scraping website for email, phone, and socials…', false);
    toast('Enriching contacts…', 'info');

    try {
      const res = await fetch('/leads/' + encodeURIComponent(key) + '/enrich-rapidapi-website', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data.success) {
        const err = (data && data.error) || 'Enrich failed';
        setStatus(opts.statusEl, err, true);
        toast(err, 'error');
        if (btn) setEnrichUi(btn, 'idle');
        return { success: false, error: err };
      }
      const msg = data.message || 'Enriched from website.';
      setStatus(opts.statusEl, msg, false);
      toast(msg, 'success');
      if (btn) {
        setEnrichUi(btn, 'done');
        window.setTimeout(function () {
          setEnrichUi(btn, 'idle');
        }, 2200);
      }
      if (typeof opts.onUpdated === 'function') opts.onUpdated(data.lead || null, data);
      return data;
    } catch (e) {
      const msg = 'Network error — try again.';
      setStatus(opts.statusEl, msg, true);
      toast(msg, 'error');
      if (btn) setEnrichUi(btn, 'idle');
      return { success: false, error: 'network' };
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function bindRapidapiWebsiteEnrichButton(btn, opts) {
    if (!btn || btn.dataset.rapidapiEnrichBound === '1') return;
    btn.dataset.rapidapiEnrichBound = '1';
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var key =
        btn.getAttribute('data-lead-key') ||
        (opts && opts.getLeadKey ? opts.getLeadKey() : '') ||
        '';
      var blocked =
        btn.getAttribute('data-enrich-blocked') === '1'
          ? btn.getAttribute('data-enrich-blocked-reason') ||
            'Add a website URL to this lead before enriching.'
          : '';
      void runLeadRapidapiWebsiteEnrich(key, {
        btn: btn,
        statusEl: opts && opts.statusEl ? opts.statusEl : null,
        onUpdated: opts && opts.onUpdated ? opts.onUpdated : null,
        blockedReason: blocked,
      });
    });
  }

  global.runLeadRapidapiWebsiteEnrich = runLeadRapidapiWebsiteEnrich;
  global.bindRapidapiWebsiteEnrichButton = bindRapidapiWebsiteEnrichButton;
  global.setRapidapiWebsiteEnrichUi = setEnrichUi;
})(typeof window !== 'undefined' ? window : globalThis);
