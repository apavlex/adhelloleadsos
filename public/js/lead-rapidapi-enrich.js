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

  function setStatus(el, message, isError) {
    if (!el) return;
    if (!message) {
      el.textContent = '';
      el.classList.add('hidden');
      return;
    }
    el.textContent = message;
    el.classList.remove('hidden');
    el.classList.toggle('text-emerald-700', !isError);
    el.classList.toggle('dark:text-emerald-300', !isError);
    el.classList.toggle('text-amber-700', !!isError);
    el.classList.toggle('dark:text-amber-300', !!isError);
  }

  /**
   * @param {string} leadKey
   * @param {{ btn?: HTMLElement, statusEl?: HTMLElement, onUpdated?: function(object): void }} [opts]
   */
  async function runLeadRapidapiWebsiteEnrich(leadKey, opts) {
    opts = opts || {};
    const key = leadKeyFromArg(leadKey);
    if (!key) {
      setStatus(opts.statusEl, 'Save this lead before enriching.', true);
      return { success: false, error: 'missing_key' };
    }

    const btn = opts.btn || null;
    const prevLabel = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
      btn.textContent = 'Enriching…';
    }
    setStatus(opts.statusEl, 'Scraping website for contacts and socials…', false);

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
        return { success: false, error: err };
      }
      setStatus(opts.statusEl, data.message || 'Enriched from website.', false);
      if (typeof opts.onUpdated === 'function') opts.onUpdated(data.lead || null, data);
      return data;
    } catch (e) {
      setStatus(opts.statusEl, 'Network error — try again.', true);
      return { success: false, error: 'network' };
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.removeAttribute('aria-busy');
        btn.textContent = prevLabel || 'Enrich website';
      }
    }
  }

  function bindRapidapiWebsiteEnrichButton(btn, opts) {
    if (!btn || btn.dataset.rapidapiEnrichBound === '1') return;
    btn.dataset.rapidapiEnrichBound = '1';
    btn.addEventListener('click', function () {
      var key =
        btn.getAttribute('data-lead-key') ||
        (opts && opts.getLeadKey ? opts.getLeadKey() : '') ||
        '';
      void runLeadRapidapiWebsiteEnrich(key, {
        btn: btn,
        statusEl: opts && opts.statusEl ? opts.statusEl : null,
        onUpdated: opts && opts.onUpdated ? opts.onUpdated : null,
      });
    });
  }

  global.runLeadRapidapiWebsiteEnrich = runLeadRapidapiWebsiteEnrich;
  global.bindRapidapiWebsiteEnrichButton = bindRapidapiWebsiteEnrichButton;
})(typeof window !== 'undefined' ? window : globalThis);
