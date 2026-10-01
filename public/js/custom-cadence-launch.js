/* Pipeline bulk bar: "Launch cadence" picker for custom GHL cadences. */
(function () {
  if (window.__customCadenceLaunchBound) return;
  window.__customCadenceLaunchBound = true;

  var modal = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function selectedKeys() {
    if (typeof window.__collectSelectedLeadKeysEarly === 'function') return window.__collectSelectedLeadKeysEarly();
    if (typeof window.__getSelectedLeadKeysForBulk === 'function') return window.__getSelectedLeadKeysForBulk();
    return [];
  }

  function feedback(msg, variant) {
    if (typeof window.__showBulkBarFeedbackEarly === 'function') window.__showBulkBarFeedbackEarly(msg, variant);
  }

  function close() {
    if (modal) modal.remove();
    modal = null;
    document.removeEventListener('keydown', onKey);
  }

  function onKey(e) {
    if (e.key === 'Escape') close();
  }

  function shell(inner) {
    close();
    modal = document.createElement('div');
    modal.className = 'fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/60 p-4';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Launch cadence');
    modal.innerHTML =
      '<div class="w-full max-w-xl max-h-[85vh] overflow-y-auto custom-scrollbar rounded-3xl bg-white dark:bg-slate-900 border border-brand-border dark:border-white/10 shadow-2xl p-6 text-brand-dark dark:text-white">' +
      inner +
      '</div>';
    modal.addEventListener('click', function (e) {
      if (e.target === modal || e.target.closest('[data-cc-close]')) close();
    });
    var host = document.getElementById('ccLaunchPortal');
    if (!host) {
      host = document.createElement('div');
      host.id = 'ccLaunchPortal';
      host.className = 'app-body-portal';
      document.body.appendChild(host);
    }
    host.appendChild(modal);
    document.addEventListener('keydown', onKey);
    return modal;
  }

  function header(title, sub) {
    return '<div class="flex items-start justify-between gap-3 mb-4"><div><p class="text-[10px] font-black uppercase tracking-widest text-brand-yellow mb-1">Runs in GHL</p>' +
      '<h2 class="font-display font-bold text-lg">' + esc(title) + '</h2>' +
      (sub ? '<p class="text-xs text-brand-muted mt-1">' + sub + '</p>' : '') +
      '</div><button type="button" data-cc-close class="text-brand-muted hover:text-brand-dark dark:hover:text-white text-xl leading-none" aria-label="Close">×</button></div>';
  }

  async function openPicker() {
    var keys = selectedKeys();
    if (!keys.length) {
      feedback('Select at least one lead.', 'error');
      return;
    }
    shell(header('Launch cadence', 'Loading your cadences…'));
    var data;
    try {
      var res = await fetch('/sequences/custom.json', { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
      data = await res.json();
    } catch (e) {
      data = { cadences: [] };
    }
    var list = (data && data.cadences) || [];
    var n = keys.length + ' lead' + (keys.length === 1 ? '' : 's');
    if (!list.length) {
      shell(
        header('Launch cadence', '') +
          '<p class="text-sm text-brand-muted mb-4">You have no cadences yet. Build one on the Cadences page, then come back and launch it on these leads.</p>' +
          '<a href="/sequences#custom-cadences" class="btn-pill btn-primary inline-flex px-5 py-2.5 text-[10px] font-black uppercase tracking-widest">Build a cadence</a>',
      );
      return;
    }
    var items = list.map(function (c) {
      return '<button type="button" data-cc-launch="' + esc(c.id) + '" class="w-full text-left rounded-2xl border border-brand-border/60 dark:border-white/10 bg-brand-cream/30 dark:bg-white/5 hover:border-brand-yellow/70 p-4 transition-colors">' +
        '<span class="flex items-center justify-between gap-2"><span class="font-bold">' + esc(c.name) + '</span>' +
        (c.ghlSetupAt ? '' : '<span class="rounded-full bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-300">GHL not set up yet</span>') +
        '</span>' +
        (c.goal ? '<span class="block text-xs text-brand-muted mt-0.5">' + esc(c.goal) + '</span>' : '') +
        '<span class="block text-[11px] text-brand-dark/80 dark:text-slate-300 mt-1">' + esc(c.summary) + '</span>' +
        '<span class="block text-[11px] text-brand-muted mt-1">Tags leads <code class="text-[10px]">' + esc(c.tagName) + '</code></span>' +
        '</button>';
    }).join('');
    var m = shell(
      header('Launch cadence', 'Pick a cadence for ' + n + '. Leads already on another cadence or auto outreach are skipped.') +
        '<div class="space-y-2">' + items + '</div>' +
        '<p class="text-[11px] text-brand-muted mt-4"><a href="/sequences#custom-cadences" class="underline">Manage cadences</a></p>',
    );
    m.querySelectorAll('[data-cc-launch]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        launch(btn.getAttribute('data-cc-launch'), keys, btn);
      });
    });
  }

  async function launch(cadenceId, keys, btn) {
    btn.disabled = true;
    btn.classList.add('opacity-60');
    var data;
    try {
      var res = await fetch('/sequences/custom/' + encodeURIComponent(cadenceId) + '/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ leadKeys: keys }),
      });
      data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.success) throw new Error((data && data.error) || 'Launch failed.');
    } catch (e) {
      btn.disabled = false;
      btn.classList.remove('opacity-60');
      feedback(e.message, 'error');
      return;
    }
    showResult(data);
    feedback('Launched "' + data.cadence.name + '" on ' + data.launched + ' lead' + (data.launched === 1 ? '' : 's') + '.', data.launched ? 'success' : 'error');
  }

  function showResult(data) {
    var skipped = Array.isArray(data.skipped) ? data.skipped : [];
    var lines = [];
    lines.push('<p class="text-sm"><strong>' + data.launched + '</strong> lead' + (data.launched === 1 ? '' : 's') + ' tagged <code class="text-[11px] px-1 rounded bg-brand-cream/80 dark:bg-slate-800">' + esc(data.tagName) + '</code>' +
      (data.syncedToGhl ? ' and syncing to GHL now.' : '. This is a demo workspace, so nothing is synced to GHL.') + '</p>');
    if (skipped.length) {
      lines.push('<details class="mt-2"><summary class="cursor-pointer text-xs text-brand-muted">' + skipped.length + ' skipped</summary><ul class="mt-1 text-xs text-brand-muted space-y-0.5">' +
        skipped.slice(0, 30).map(function (s) { return '<li>' + esc(s.title || s.leadKey) + ' — ' + esc(s.label) + '</li>'; }).join('') + '</ul></details>');
    }
    var ready = !!(data.cadence && data.cadence.ghlSetupAt);
    var promptBlock =
      '<div class="mt-4">' +
      '<p class="text-xs font-bold mb-1">' + (ready
        ? 'Your GHL workflow for this cadence is marked ready. Prompt for reference:'
        : 'Set this up once in GHL: paste the prompt into GHL\'s workflow AI builder (or give it to whoever builds workflows). Every future launch reuses the same workflow.') + '</p>' +
      '<textarea readonly rows="' + (ready ? 8 : 14) + '" class="w-full rounded-xl border border-brand-border/40 dark:border-white/10 bg-white dark:bg-slate-950 px-3 py-3 text-[11px] font-mono leading-relaxed resize-y custom-scrollbar" aria-label="GHL workflow prompt">' + esc(data.prompt) + '</textarea>' +
      '<div class="mt-2 flex flex-wrap items-center gap-3">' +
      '<button type="button" data-cc-copy class="rounded-xl bg-brand-dark dark:bg-brand-yellow text-white dark:text-brand-dark px-4 py-2 text-[10px] font-black uppercase tracking-widest hover:opacity-90">Copy prompt</button>' +
      (ready ? '' : '<button type="button" data-cc-ready class="text-[11px] font-bold text-brand-muted underline hover:text-brand-dark dark:hover:text-white">I\'ve set this up in GHL</button>') +
      '<button type="button" data-cc-close class="ml-auto text-[10px] font-black uppercase tracking-widest text-brand-muted hover:text-brand-dark dark:hover:text-white">Done</button>' +
      '</div></div>';
    var m = shell(header('Launched: ' + data.cadence.name, '') + lines.join('') + promptBlock);
    var copyBtn = m.querySelector('[data-cc-copy]');
    copyBtn.addEventListener('click', function () {
      var text = m.querySelector('textarea').value;
      var done = function (ok) {
        copyBtn.textContent = ok ? 'Copied' : 'Select and copy';
        setTimeout(function () { copyBtn.textContent = 'Copy prompt'; }, 2000);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
      else done(false);
    });
    var readyBtn = m.querySelector('[data-cc-ready]');
    if (readyBtn) {
      readyBtn.addEventListener('click', async function () {
        readyBtn.disabled = true;
        try {
          await fetch('/sequences/custom/' + encodeURIComponent(data.cadence.id) + '/ghl-ready', { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' } });
          readyBtn.textContent = 'Marked ready';
        } catch (e) {
          readyBtn.disabled = false;
        }
      });
    }
  }

  document.addEventListener('click', function (e) {
    if (e.target.closest('#bulkLaunchCadenceBtn')) {
      e.preventDefault();
      openPicker();
    }
  });
})();
