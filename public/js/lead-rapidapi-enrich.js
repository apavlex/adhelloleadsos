/**
 * RapidAPI website / contact enrich — binds before app.js (same pattern as lead-contact-hunt.js).
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

  function resolveRow() {
    if (typeof global.__resolveRowForLeadPanelActions === 'function') {
      var fromPanel = global.__resolveRowForLeadPanelActions();
      if (fromPanel) return fromPanel;
    }
    if (typeof global.__getActiveLeadPanelRow === 'function') {
      var panelRow = global.__getActiveLeadPanelRow();
      if (panelRow) return panelRow;
    }
    if (typeof global.__resolveActiveLeadRow === 'function') {
      var active = global.__resolveActiveLeadRow();
      if (active) return active;
    }
    return document.querySelector('.result-row.selected:not(.result-row--panel-source)');
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
    try {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch (_) {}
  }

  function setEnrichUi(btn, state) {
    if (!btn) return;
    var next = state || 'idle';
    btn.dataset.enrichState = next;
    btn.setAttribute('aria-busy', next === 'active' ? 'true' : 'false');

    var idle = btn.querySelector('.rapidapi-enrich-idle');
    var active = btn.querySelector('.rapidapi-enrich-active');
    var done = btn.querySelector('.rapidapi-enrich-done');
    var progressRow = btn.querySelector('.rapidapi-enrich-progress-row');

    if (idle) idle.classList.toggle('hidden', next !== 'idle');
    if (active) active.classList.toggle('hidden', next !== 'active');
    if (done) done.classList.toggle('hidden', next !== 'done');
    if (progressRow) progressRow.classList.toggle('hidden', next !== 'active');

    btn.classList.toggle('rapidapi-enrich-btn--active', next === 'active');
    btn.classList.toggle('rapidapi-enrich-btn--done', next === 'done');
    btn.classList.toggle('opacity-55', next === 'idle' && btn.getAttribute('data-enrich-blocked') === '1');
  }

  function setProgress(btn, pct) {
    if (!btn) return;
    var bar = btn.querySelector('.rapidapi-enrich-progress-fill');
    if (!bar) return;
    var n = Math.max(8, Math.min(96, Number(pct) || 8));
    bar.style.width = n + '%';
  }

  function statusElForButton(btn) {
    if (!btn) return null;
    if (btn.id === 'focus-rapidapi-enrich-btn') {
      return document.getElementById('focus-rapidapi-enrich-status');
    }
    return document.getElementById('rapidapiWebsiteEnrichStatus');
  }

  /**
   * @param {string} leadKey
   * @param {{ btn?: HTMLElement, statusEl?: HTMLElement, onUpdated?: function(object): void, blockedReason?: string }} [opts]
   */
  async function runLeadRapidapiWebsiteEnrich(leadKey, opts) {
    opts = opts || {};
    var btn = opts.btn || null;
    var progressTimer = null;

    if (opts.blockedReason) {
      setStatus(opts.statusEl, opts.blockedReason, true);
      toast(opts.blockedReason, 'warning');
      return { success: false, error: 'blocked' };
    }

    var key = leadKeyFromArg(leadKey);
    if (!key) {
      var missingMsg = 'Select a saved lead before enriching contacts.';
      setStatus(opts.statusEl, missingMsg, true);
      toast(missingMsg, 'warning');
      return { success: false, error: 'missing_key' };
    }

    if (btn) {
      btn.disabled = true;
      setEnrichUi(btn, 'active');
      setProgress(btn, 12);
      progressTimer = global.setInterval(function () {
        var bar = btn.querySelector('.rapidapi-enrich-progress-fill');
        if (!bar) return;
        var cur = parseFloat(bar.style.width) || 12;
        setProgress(btn, Math.min(92, cur + (cur < 50 ? 6 : 2)));
      }, 450);
    }
    setStatus(opts.statusEl, 'Scraping website for email, phone, and socials…', false);
    toast('Enriching contacts…', 'info');

    try {
      var res = await fetch('/leads/' + encodeURIComponent(key) + '/enrich-rapidapi-website', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({}),
      });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data.success) {
        var err = (data && data.error) || 'Enrich failed';
        setStatus(opts.statusEl, err, true);
        toast(err, 'error');
        if (btn) setEnrichUi(btn, 'idle');
        return { success: false, error: err };
      }
      var msg = data.message || 'Contacts enriched.';
      setStatus(opts.statusEl, msg, false);
      toast(msg, 'success');
      if (btn) {
        setProgress(btn, 100);
        setEnrichUi(btn, 'done');
        global.setTimeout(function () {
          setEnrichUi(btn, 'idle');
          setProgress(btn, 8);
        }, 2200);
      }
      if (typeof opts.onUpdated === 'function') opts.onUpdated(data.lead || null, data);
      return data;
    } catch (e) {
      var netMsg = 'Network error — try again.';
      setStatus(opts.statusEl, netMsg, true);
      toast(netMsg, 'error');
      if (btn) setEnrichUi(btn, 'idle');
      return { success: false, error: 'network' };
    } finally {
      if (progressTimer) global.clearInterval(progressTimer);
      if (btn) btn.disabled = false;
    }
  }

  function runEnrichClick(ev) {
    if (clickLock) return;
    clickLock = true;
    global.setTimeout(function () {
      clickLock = false;
    }, 400);

    if (ev) {
      ev.preventDefault();
      if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
      if (typeof ev.stopPropagation === 'function') ev.stopPropagation();
    }

    var btn =
      (ev && ev.target && ev.target.closest && ev.target.closest('#rapidapiWebsiteEnrichBtn')) ||
      (ev && ev.target && ev.target.closest && ev.target.closest('#focus-rapidapi-enrich-btn')) ||
      document.getElementById('rapidapiWebsiteEnrichBtn') ||
      document.getElementById('focus-rapidapi-enrich-btn');
    if (!btn) return;

    if (btn.dataset.enrichState === 'active') return;

    var row = resolveRow();
    if (typeof global.__adhelloSetCurrentLeadRow === 'function' && row) {
      global.__adhelloSetCurrentLeadRow(row);
    }

    var key =
      btn.getAttribute('data-lead-key') ||
      (row && String(row.dataset.leadKey || '').trim()) ||
      '';
    var blocked =
      btn.getAttribute('data-enrich-blocked') === '1'
        ? btn.getAttribute('data-enrich-blocked-reason') ||
          'Add a website URL to this lead before enriching contacts.'
        : '';

    void runLeadRapidapiWebsiteEnrich(key, {
      btn: btn,
      statusEl: statusElForButton(btn),
      blockedReason: blocked,
      onUpdated: function (lead, data) {
        if (!lead || !row) return;
        var ds = row.dataset;
        var forceKeys =
          data && data.filled && data.filled.length
            ? data.filled
            : ['email', 'phone', 'facebook', 'instagram', 'twitter', 'linkedin', 'tiktok'];
        forceKeys.forEach(function (key) {
          if (Object.prototype.hasOwnProperty.call(lead, key)) {
            ds[key] = lead[key] == null ? '' : String(lead[key]).trim();
          }
        });
        if (typeof global.syncPersistedLeadToRowDataset === 'function') {
          global.syncPersistedLeadToRowDataset(row, lead);
        }
        if (typeof global.__populateLeadPanel === 'function') {
          global.__populateLeadPanel(row);
        }
      },
    });
  }

  function bindRapidapiWebsiteEnrichButton(btn, opts) {
    if (!btn || btn.dataset.rapidapiEnrichBound === '1') return;
    btn.dataset.rapidapiEnrichBound = '1';
    btn.addEventListener('click', function (e) {
      runEnrichClick(e);
    });
  }

  global.runLeadRapidapiWebsiteEnrich = runLeadRapidapiWebsiteEnrich;
  global.bindRapidapiWebsiteEnrichButton = bindRapidapiWebsiteEnrichButton;
  global.setRapidapiWebsiteEnrichUi = setEnrichUi;
  global.__adhelloRunRapidapiEnrichClick = runEnrichClick;

  if (!global.__adhelloRapidapiEnrichEarlyBound) {
    global.__adhelloRapidapiEnrichEarlyBound = true;
    document.addEventListener(
      'click',
      function (e) {
        if (
          !e.target.closest ||
          (!e.target.closest('#rapidapiWebsiteEnrichBtn') &&
            !e.target.closest('#focus-rapidapi-enrich-btn'))
        ) {
          return;
        }
        runEnrichClick(e);
      },
      true
    );
  }
})(typeof window !== 'undefined' ? window : globalThis);
