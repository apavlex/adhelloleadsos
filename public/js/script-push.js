/* Scripts page: "Push to workspaces" — copy selected offer scripts into other workspaces this user manages. */
(function () {
  'use strict';

  var modal = null;
  var state = { offers: [], targets: [], recent: [], offerKeys: {}, targetIds: {}, includeSender: false };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function plural(n, word) {
    return n + ' ' + word + (n === 1 ? '' : 's');
  }

  function close() {
    if (modal) modal.remove();
    modal = null;
    document.removeEventListener('keydown', onKey);
  }

  function onKey(e) {
    if (e.key === 'Escape') close();
  }

  function open(inner) {
    close();
    modal = document.createElement('div');
    modal.className = 'fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/60 p-4';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Push scripts to workspaces');
    modal.innerHTML =
      '<div class="w-full max-w-2xl max-h-[85vh] overflow-y-auto custom-scrollbar rounded-3xl bg-white dark:bg-slate-900 border border-brand-border dark:border-white/10 shadow-2xl p-6 text-brand-dark dark:text-white">' +
      inner +
      '</div>';
    modal.addEventListener('click', function (e) {
      if (e.target === modal || e.target.closest('[data-sp-close]')) close();
    });
    var host = document.getElementById('scriptPushPortal');
    if (!host) {
      host = document.createElement('div');
      host.id = 'scriptPushPortal';
      host.className = 'app-body-portal';
      document.body.appendChild(host);
    }
    host.appendChild(modal);
    document.addEventListener('keydown', onKey);
    return modal;
  }

  function header(title, sub) {
    return (
      '<div class="flex items-start justify-between gap-3 mb-5"><div>' +
      '<h2 class="font-display font-bold text-lg">' + esc(title) + '</h2>' +
      (sub ? '<p class="text-xs text-brand-muted mt-1 leading-relaxed">' + sub + '</p>' : '') +
      '</div><button type="button" data-sp-close class="text-brand-muted hover:text-brand-dark dark:hover:text-white text-xl leading-none" aria-label="Close">×</button></div>'
    );
  }

  function activeOfferKey() {
    var tab = document.querySelector('#pitchTabs [aria-selected="true"]');
    return tab ? tab.getAttribute('data-pitch') : '';
  }

  function countSelected(map) {
    return Object.keys(map).filter(function (k) { return map[k]; }).length;
  }

  function checkboxRow(kind, value, checked, title, detail) {
    return (
      '<label class="flex items-start gap-3 rounded-xl border border-brand-border/60 dark:border-white/10 px-3 py-2.5 cursor-pointer hover:border-sky-400/70">' +
      '<input type="checkbox" data-sp-' + kind + '="' + esc(value) + '"' + (checked ? ' checked' : '') +
      ' class="mt-0.5 rounded border-brand-border text-sky-600 focus:ring-sky-500" />' +
      '<span class="min-w-0"><span class="block text-sm font-bold">' + title + '</span>' +
      (detail ? '<span class="block text-[11px] text-brand-muted mt-0.5">' + detail + '</span>' : '') +
      '</span></label>'
    );
  }

  function sectionHead(label, kind) {
    return (
      '<div class="flex items-center justify-between mb-2"><p class="text-[10px] font-black uppercase tracking-widest text-brand-muted">' + label + '</p>' +
      '<button type="button" data-sp-all="' + kind + '" class="text-[10px] font-black uppercase tracking-widest text-sky-700 dark:text-sky-300 hover:underline">Select all</button></div>'
    );
  }

  function recentHtml() {
    if (!state.recent.length) return '';
    var names = {};
    state.targets.forEach(function (t) { names[t.id] = t.name; });
    return (
      '<div class="mt-6 pt-4 border-t border-brand-border/50 dark:border-white/10">' +
      '<p class="text-[10px] font-black uppercase tracking-widest text-brand-muted mb-2">Recent pushes</p><ul class="space-y-1.5">' +
      state.recent
        .map(function (p, i) {
          var ok = (p.results || []).filter(function (r) { return r.ok; });
          return (
            '<li class="flex items-center justify-between gap-3 text-[11px]"><span class="min-w-0 text-brand-muted"><span class="text-brand-dark dark:text-slate-200 font-semibold">' +
            esc((p.offers || []).map(function (o) { return o.label; }).join(', ')) +
            '</span> → ' + esc(ok.map(function (r) { return names[r.id] || r.name; }).join(', ') || 'no workspaces') +
            ' · ' + esc(new Date(p.at).toLocaleString()) +
            '</span><button type="button" data-sp-repeat="' + i + '" class="shrink-0 text-[10px] font-black uppercase tracking-widest text-sky-700 dark:text-sky-300 hover:underline">Select again</button></li>'
          );
        })
        .join('') +
      '</ul></div>'
    );
  }

  function pushLabel() {
    var o = countSelected(state.offerKeys);
    var t = countSelected(state.targetIds);
    return o && t ? 'Push ' + plural(o, 'script') + ' to ' + plural(t, 'workspace') : 'Pick scripts and workspaces';
  }

  function renderPicker() {
    var offersHtml = state.offers.length
      ? state.offers
          .map(function (o) {
            return checkboxRow('offer', o.key, !!state.offerKeys[o.key], esc(o.label), '');
          })
          .join('')
      : '<p class="text-sm text-brand-muted">This workspace has no offer scripts yet.</p>';

    var picked = Object.keys(state.offerKeys).filter(function (k) { return state.offerKeys[k]; });
    var targetsHtml = state.targets.length
      ? state.targets
          .map(function (t) {
            var linked = (t.linkedKeys || []).filter(function (k) { return picked.indexOf(k) >= 0; }).length;
            var detail = plural(t.offerCount, 'offer') + (linked ? ' · already has ' + linked + ' of these from here (will update)' : '');
            var title = esc(t.name) + (t.isDemo ? ' <span class="ml-1 rounded-full bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-300">Demo</span>' : '');
            return checkboxRow('target', t.id, !!state.targetIds[t.id], title, detail);
          })
          .join('')
      : '<p class="text-sm text-brand-muted">You don’t manage any other workspaces yet. You need to be an owner or admin of a workspace to push scripts into it.</p>';

    var canPush = countSelected(state.offerKeys) && countSelected(state.targetIds);
    var m = open(
      header(
        'Push scripts to other workspaces',
        'Copies the call, SMS and email script for each offer you pick. An offer pushed from here before, or one with the same name, is updated; anything else is added as a new offer. Edit here and push again any time to update them.'
      ) +
        '<div class="grid gap-5 md:grid-cols-2">' +
        '<div>' + sectionHead('Scripts', 'offer') + '<div class="space-y-2">' + offersHtml + '</div></div>' +
        '<div>' + sectionHead('Push to', 'target') + '<div class="space-y-2">' + targetsHtml + '</div></div>' +
        '</div>' +
        '<label class="mt-5 flex items-start gap-3 text-xs cursor-pointer"><input type="checkbox" data-sp-sender' + (state.includeSender ? ' checked' : '') +
        ' class="mt-0.5 rounded border-brand-border text-sky-600 focus:ring-sky-500" /><span><span class="font-bold">Also copy sender details</span>' +
        '<span class="block text-brand-muted mt-0.5">Business name, vertical, audit link and service area. Leave off when each workspace sends as its own business.</span></span></label>' +
        '<p data-sp-error class="hidden mt-4 text-sm text-rose-600 dark:text-rose-300" role="alert"></p>' +
        '<div class="mt-5 flex flex-wrap items-center gap-3">' +
        '<button type="button" data-sp-push class="btn-pill btn-primary px-5 py-2.5 text-[10px] font-black uppercase tracking-widest disabled:opacity-50"' + (canPush ? '' : ' disabled') + '>' + esc(pushLabel()) + '</button>' +
        '<button type="button" data-sp-close class="text-[10px] font-black uppercase tracking-widest text-brand-muted hover:text-brand-dark dark:hover:text-white">Cancel</button>' +
        '</div>' +
        recentHtml()
    );

    m.addEventListener('change', function (e) {
      var el = e.target;
      if (el.hasAttribute('data-sp-offer')) state.offerKeys[el.getAttribute('data-sp-offer')] = el.checked;
      else if (el.hasAttribute('data-sp-target')) state.targetIds[el.getAttribute('data-sp-target')] = el.checked;
      else if (el.hasAttribute('data-sp-sender')) state.includeSender = el.checked;
      else return;
      if (el.hasAttribute('data-sp-offer')) return renderPicker();
      var btn = m.querySelector('[data-sp-push]');
      btn.disabled = !(countSelected(state.offerKeys) && countSelected(state.targetIds));
      btn.textContent = pushLabel();
    });
    m.addEventListener('click', function (e) {
      var all = e.target.closest('[data-sp-all]');
      if (all) {
        var kind = all.getAttribute('data-sp-all');
        var list = kind === 'offer' ? state.offers.map(function (o) { return o.key; }) : state.targets.map(function (t) { return t.id; });
        var map = kind === 'offer' ? state.offerKeys : state.targetIds;
        var every = list.every(function (k) { return map[k]; });
        list.forEach(function (k) { map[k] = !every; });
        return renderPicker();
      }
      var rep = e.target.closest('[data-sp-repeat]');
      if (rep) {
        var p = state.recent[Number(rep.getAttribute('data-sp-repeat'))];
        if (!p) return;
        state.offerKeys = {};
        state.targetIds = {};
        (p.offers || []).forEach(function (o) {
          if (state.offers.some(function (x) { return x.key === o.key; })) state.offerKeys[o.key] = true;
        });
        (p.results || []).forEach(function (r) {
          if (r.ok && state.targets.some(function (t) { return t.id === r.id; })) state.targetIds[r.id] = true;
        });
        state.includeSender = !!p.includeSender;
        return renderPicker();
      }
      if (e.target.closest('[data-sp-push]')) push(m);
    });
  }

  function push(m) {
    var offerKeys = Object.keys(state.offerKeys).filter(function (k) { return state.offerKeys[k]; });
    var targetIds = Object.keys(state.targetIds).filter(function (k) { return state.targetIds[k]; });
    if (!offerKeys.length || !targetIds.length) return;
    if (!window.confirm('Push ' + plural(offerKeys.length, 'script') + ' to ' + plural(targetIds.length, 'workspace') + '? Matching offers there get this script text.')) return;
    var btn = m.querySelector('[data-sp-push]');
    var err = m.querySelector('[data-sp-error]');
    btn.disabled = true;
    btn.textContent = 'Pushing…';
    err.classList.add('hidden');
    var flush = typeof window.__flushScriptBlocks === 'function' ? window.__flushScriptBlocks() : Promise.resolve(true);
    Promise.resolve(flush)
      .then(function (saved) {
        if (saved === false) throw new Error('Could not save your latest edits here. Fix that first, then push.');
        return fetch('/workspace/scripts/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ offerKeys: offerKeys, targetIds: targetIds, includeSender: state.includeSender }),
        });
      })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.success) throw new Error((data && data.error) || 'Push failed');
        renderResult(data);
      })
      .catch(function (e) {
        btn.disabled = false;
        btn.textContent = pushLabel();
        err.textContent = e.message || 'Push failed';
        err.classList.remove('hidden');
      });
  }

  function renderResult(data) {
    var rows = (data.results || [])
      .map(function (r) {
        var parts = [];
        if (r.updated) parts.push(r.updated + ' updated');
        if (r.created) parts.push(r.created + ' added');
        return (
          '<li class="flex items-center justify-between gap-3 rounded-xl border border-brand-border/60 dark:border-white/10 px-3 py-2.5 text-sm">' +
          '<span class="font-bold">' + esc(r.name) + '</span>' +
          (r.ok
            ? '<span class="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">' + esc(parts.join(' · ') || 'No changes') + '</span>'
            : '<span class="text-[11px] font-semibold text-rose-600 dark:text-rose-300">' + esc(r.error || 'Failed') + '</span>') +
          '</li>'
        );
      })
      .join('');
    var names = (data.offers || []).map(function (o) { return o.label; }).join(', ');
    open(
      header('Scripts pushed', esc(names) + '. Members of those workspaces see the new scripts next time they open Scripts.') +
        '<ul class="space-y-2">' + rows + '</ul>' +
        '<div class="mt-5 flex justify-end"><button type="button" data-sp-close class="btn-pill btn-primary px-5 py-2.5 text-[10px] font-black uppercase tracking-widest">Done</button></div>'
    );
  }

  function load() {
    open(header('Push scripts to other workspaces', '') + '<p class="text-sm text-brand-muted">Loading…</p>');
    Promise.all([
      fetch('/workspace/scripts/offers.json', { headers: { Accept: 'application/json' } }).then(function (r) { return r.json(); }),
      fetch('/workspace/scripts/push-targets.json', { headers: { Accept: 'application/json' } }).then(function (r) { return r.json(); }),
    ])
      .then(function (res) {
        var offers = res[0];
        var targets = res[1];
        if (!targets || !targets.success) throw new Error((targets && targets.error) || 'Could not load workspaces');
        state.offers = (offers && offers.catalog) || [];
        state.targets = targets.targets || [];
        state.recent = targets.recent || [];
        state.offerKeys = {};
        state.targetIds = {};
        var active = activeOfferKey();
        if (active) state.offerKeys[active] = true;
        renderPicker();
      })
      .catch(function (e) {
        open(header('Push scripts to other workspaces', '') + '<p class="text-sm text-rose-600 dark:text-rose-300">' + esc(e.message || 'Could not load') + '</p>');
      });
  }

  document.addEventListener('click', function (e) {
    if (e.target.closest('#scriptPushBtn')) load();
  });
})();
