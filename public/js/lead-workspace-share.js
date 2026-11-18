/**
 * Bulk bar: share/copy selected leads into other workspaces the user manages
 * (e.g. AdHello → HomeElk).
 */
(function () {
  'use strict';

  var modal = null;
  var state = { targets: [], recent: [], targetIds: {}, leadKeys: [], busy: false };

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

  function toast(msg, variant) {
    if (typeof window.showAppToast === 'function') {
      window.showAppToast(msg, { variant: variant || 'info' });
      return;
    }
    if (msg) window.alert(msg);
  }

  function selectedLeadKeys() {
    var keys = [];
    document.querySelectorAll('.row-checkbox:checked, .lead-checkbox:checked').forEach(function (cb) {
      var row = cb.closest('.result-row');
      var key = row && row.dataset ? String(row.dataset.leadKey || '').trim() : '';
      if (!key) key = String(cb.getAttribute('data-key') || '').trim();
      if (key) keys.push(key.startsWith('lead:') ? key : 'lead:' + key);
    });
    return Array.from(new Set(keys));
  }

  function close() {
    if (modal) modal.remove();
    modal = null;
    document.removeEventListener('keydown', onKey);
  }

  function onKey(e) {
    if (e.key === 'Escape' && !state.busy) close();
  }

  function open(inner) {
    close();
    modal = document.createElement('div');
    modal.className = 'fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/60 p-4';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Share leads to workspaces');
    modal.innerHTML =
      '<div class="w-full max-w-lg max-h-[85vh] overflow-y-auto custom-scrollbar rounded-3xl bg-white dark:bg-slate-900 border border-brand-border dark:border-white/10 shadow-2xl p-6 text-brand-dark dark:text-white">' +
      inner +
      '</div>';
    modal.addEventListener('click', function (e) {
      if (state.busy) return;
      if (e.target === modal || e.target.closest('[data-lws-close]')) close();
    });
    var host = document.getElementById('leadWorkspaceSharePortal');
    if (!host) {
      host = document.createElement('div');
      host.id = 'leadWorkspaceSharePortal';
      host.className = 'app-body-portal';
      document.body.appendChild(host);
    }
    host.appendChild(modal);
    document.addEventListener('keydown', onKey);
    return modal;
  }

  function countSelected() {
    return Object.keys(state.targetIds).filter(function (k) {
      return state.targetIds[k];
    }).length;
  }

  function shareLabel() {
    var t = countSelected();
    var n = state.leadKeys.length;
    if (!n) return 'Select leads first';
    if (!t) return 'Pick a workspace';
    return 'Share ' + plural(n, 'lead') + ' to ' + plural(t, 'workspace');
  }

  function render() {
    if (!modal) return;
    var body = modal.querySelector('[data-lws-body]');
    if (!body) return;
    var rows = state.targets
      .map(function (t) {
        var checked = !!state.targetIds[t.id];
        return (
          '<label class="flex items-start gap-3 rounded-xl border border-brand-border/60 dark:border-white/10 px-3 py-2.5 cursor-pointer hover:border-sky-400/70">' +
          '<input type="checkbox" data-lws-target="' +
          esc(t.id) +
          '"' +
          (checked ? ' checked' : '') +
          (state.busy ? ' disabled' : '') +
          ' class="mt-0.5 rounded border-brand-border text-sky-600 focus:ring-sky-500" />' +
          '<span class="min-w-0"><span class="block text-sm font-bold">' +
          esc(t.name) +
          '</span>' +
          (t.slug
            ? '<span class="block text-[11px] text-brand-muted mt-0.5">/' + esc(t.slug) + '</span>'
            : '') +
          '</span></label>'
        );
      })
      .join('');

    var recent = '';
    if (state.recent.length) {
      recent =
        '<div class="mt-5 pt-4 border-t border-brand-border/50 dark:border-white/10">' +
        '<p class="text-[10px] font-black uppercase tracking-widest text-brand-muted mb-2">Recent shares</p><ul class="space-y-1.5">' +
        state.recent
          .map(function (p) {
            var ok = (p.results || []).filter(function (r) {
              return r.ok;
            });
            return (
              '<li class="text-[11px] text-brand-muted"><span class="font-semibold text-brand-dark dark:text-slate-200">' +
              esc(plural(p.leadCount || 0, 'lead')) +
              '</span> → ' +
              esc(ok.map(function (r) { return r.name; }).join(', ') || 'none') +
              ' · ' +
              esc(new Date(p.at).toLocaleString()) +
              '</li>'
            );
          })
          .join('') +
        '</ul></div>';
    }

    body.innerHTML =
      '<p class="text-xs text-brand-muted mb-4 leading-relaxed">Copies contact info into the other workspace. Originals stay here. Duplicates in the target merge by phone/email/name.</p>' +
      '<p class="text-[10px] font-black uppercase tracking-widest text-brand-muted mb-2">Sharing ' +
      esc(plural(state.leadKeys.length, 'lead')) +
      '</p>' +
      (state.targets.length
        ? '<div class="space-y-2 mb-4">' + rows + '</div>'
        : '<p class="text-sm text-amber-700 dark:text-amber-300 mb-4">No other workspaces you manage. Create or join HomeElk / AdHello workspaces first.</p>') +
      recent +
      '<div class="mt-5 flex items-center justify-end gap-2">' +
      '<button type="button" data-lws-close class="bulk-bar-btn bulk-bar-btn--ghost px-3 py-2 text-xs font-bold rounded-xl border border-brand-border dark:border-white/15"' +
      (state.busy ? ' disabled' : '') +
      '>Cancel</button>' +
      '<button type="button" data-lws-submit class="px-4 py-2 text-xs font-black uppercase tracking-wide rounded-xl bg-brand-yellow text-brand-dark disabled:opacity-50"' +
      (state.busy || !countSelected() || !state.leadKeys.length ? ' disabled' : '') +
      '>' +
      (state.busy ? 'Sharing…' : esc(shareLabel())) +
      '</button></div>';
  }

  function bind() {
    if (!modal) return;
    modal.querySelectorAll('[data-lws-target]').forEach(function (input) {
      input.addEventListener('change', function () {
        var id = input.getAttribute('data-lws-target');
        state.targetIds[id] = !!input.checked;
        render();
        bind();
      });
    });
    var submit = modal.querySelector('[data-lws-submit]');
    if (submit) {
      submit.addEventListener('click', function () {
        void doShare();
      });
    }
  }

  async function doShare() {
    if (state.busy) return;
    var ids = Object.keys(state.targetIds).filter(function (k) {
      return state.targetIds[k];
    });
    if (!ids.length || !state.leadKeys.length) return;
    state.busy = true;
    render();
    bind();
    try {
      var res = await fetch('/leads/share-to-workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ leadKeys: state.leadKeys, targetIds: ids }),
      });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data.success) {
        throw new Error((data && data.error) || 'Share failed');
      }
      var parts = (data.results || [])
        .filter(function (r) {
          return r.ok;
        })
        .map(function (r) {
          return r.name + ' (' + (r.created || 0) + ' new' + (r.merged ? ', ' + r.merged + ' merged' : '') + ')';
        });
      toast('Shared ' + plural(data.leadCount || state.leadKeys.length, 'lead') + ' → ' + (parts.join('; ') || 'done'), 'success');
      close();
    } catch (e) {
      state.busy = false;
      render();
      bind();
      toast(e.message || 'Share failed', 'error');
    }
  }

  async function openShareModal() {
    var keys = selectedLeadKeys();
    if (!keys.length) {
      toast('Select one or more saved leads first.', 'error');
      return;
    }
    state = { targets: [], recent: [], targetIds: {}, leadKeys: keys, busy: false };
    open(
      '<div class="flex items-start justify-between gap-3 mb-4"><div>' +
        '<h2 class="font-display font-bold text-lg">Share to workspace</h2>' +
        '<p class="text-xs text-brand-muted mt-1">Copy leads into HomeElk, AdHello, or another workspace where you are owner, admin, or manager.</p>' +
        '</div><button type="button" data-lws-close class="text-brand-muted hover:text-brand-dark dark:hover:text-white text-xl leading-none" aria-label="Close">×</button></div>' +
        '<div data-lws-body><p class="text-sm text-brand-muted">Loading workspaces…</p></div>',
    );
    try {
      var res = await fetch('/leads/share-targets.json', {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data.success) {
        throw new Error((data && data.error) || 'Could not load workspaces');
      }
      state.targets = Array.isArray(data.targets) ? data.targets : [];
      state.recent = Array.isArray(data.recent) ? data.recent : [];
      render();
      bind();
    } catch (e) {
      close();
      toast(e.message || 'Could not load workspaces', 'error');
    }
  }

  function wire() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('#bulkShareWorkspaceBtn, .js-bulk-share-workspace');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      void openShareModal();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }

  window.__adhelloShareLeadsToWorkspace = openShareModal;
})();
