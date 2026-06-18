/**
 * Outreach lists (Call / Email / Double Tap), toolbar actions, and row METHODS buttons.
 */
(function () {
  'use strict';

  const LIST_MAP = {
    call: 'Call List',
    email: 'Email List',
    doubleTap: 'Double Tap List',
  };

  function toast(msg) {
    if (typeof window.showProspectToast === 'function') window.showProspectToast(msg);
    else window.alert(msg);
  }

  function toolbarMsg(text, ok) {
    const el = document.getElementById('leadsOutreachToolbarMsg');
    if (!el) return;
    if (!text) {
      el.classList.add('hidden');
      el.textContent = '';
      return;
    }
    el.textContent = text;
    el.classList.remove('hidden', 'text-emerald-600', 'text-rose-600', 'dark:text-emerald-300', 'dark:text-rose-300');
    el.classList.add(ok ? 'text-emerald-600' : 'text-rose-600', ok ? 'dark:text-emerald-300' : 'dark:text-rose-300');
  }

  function getTags() {
    return Array.isArray(window.WORKSPACE_TAGS) ? window.WORKSPACE_TAGS : [];
  }

  function tagKeyByName(name) {
    const want = String(name || '').trim().toLowerCase();
    const hit = getTags().find((t) => t && String(t.name || '').trim().toLowerCase() === want);
    return hit && hit.key ? hit.key : '';
  }

  async function apiJson(url, opts) {
    const fn = typeof window.fetchJson === 'function' ? window.fetchJson : null;
    if (fn) return fn(url, opts);
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.message || 'Request failed');
    return data;
  }

  async function ensureTagByName(name) {
    const existing = tagKeyByName(name);
    if (existing) return existing;
    const data = await apiJson('/tags', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (data.tag && data.tag.key) {
      if (!Array.isArray(window.WORKSPACE_TAGS)) window.WORKSPACE_TAGS = [];
      window.WORKSPACE_TAGS.push({
        key: data.tag.key,
        name: data.tag.name || name,
        color: data.tag.color || '#94a3b8',
      });
      return data.tag.key;
    }
    throw new Error('Could not create tag.');
  }

  function resolveLeadKeys(fallbackToAll) {
    if (typeof window.__ensureBulkSelectionKeys === 'function') {
      const keys = window.__ensureBulkSelectionKeys();
      if (keys.length) return keys;
    }
    if (!fallbackToAll) return [];
    const keys = [];
    document.querySelectorAll('#prospectLeadsTable tbody tr.result-row[data-lead-key]').forEach((row) => {
      const k = String(row.getAttribute('data-lead-key') || '').trim();
      if (k) keys.push(k);
    });
    return keys;
  }

  function updateToolbarCounts() {
    let count = 0;
    if (typeof window.__ensureBulkSelectionKeys === 'function') {
      const selected = window.__ensureBulkSelectionKeys();
      if (selected.length) count = selected.length;
    }
    if (!count) {
      count = document.querySelectorAll('#prospectLeadsTable tbody tr.result-row[data-lead-key]').length;
    }
    const countEl = document.getElementById('leadsToolbarCount');
    const ghlEl = document.querySelector('.js-toolbar-ghl-count');
    if (countEl) countEl.textContent = String(count);
    if (ghlEl) ghlEl.textContent = String(count);
  }

  async function bulkAddToList(listId, fallbackToAll) {
    const tagName = LIST_MAP[listId] || listId;
    if (!tagName) return;
    const keys = resolveLeadKeys(!!fallbackToAll);
    if (!keys.length) {
      toast(fallbackToAll ? 'No leads in this view.' : 'Select at least one lead first.');
      return;
    }
    toolbarMsg(`Adding ${keys.length} lead${keys.length === 1 ? '' : 's'} to ${tagName}…`, true);
    try {
      const tagKey = await ensureTagByName(tagName);
      const data = await apiJson('/tags/assign-bulk', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ mode: 'add', tagKeys: [tagKey], leadKeys: keys }),
      });
      const updated = Array.isArray(data.leads)
        ? data.leads.length
        : Array.isArray(data.updatedKeys)
          ? data.updatedKeys.length
          : keys.length;
      keys.forEach((key) => {
        const row = document.querySelector(`#prospectLeadsTable tr.result-row[data-lead-key="${CSS.escape(key)}"]`);
        if (row && typeof window.__setRowLeadTags === 'function') {
          const prev = row.dataset.tags ? JSON.parse(row.dataset.tags) : [];
          const next = [...new Set([...(Array.isArray(prev) ? prev : []), tagKey])];
          window.__setRowLeadTags(row, next);
        }
      });
      toolbarMsg(`Added ${updated} lead${updated === 1 ? '' : 's'} to ${tagName}.`, true);
      toast(`Added to ${tagName}`);
    } catch (err) {
      toolbarMsg(err.message || 'Could not update list.', false);
      toast(err.message || 'Could not update list.');
    }
  }

  function filterUrlForList(listId) {
    const tagName = LIST_MAP[listId];
    const tagKey = tagKeyByName(tagName);
    const params = new URLSearchParams(window.location.search);
    params.set('tab', 'pipeline');
    if (tagKey) params.set('tagKey', tagKey);
    return `/prospecting?${params.toString()}`;
  }

  async function startListAction(listId) {
    const tagName = LIST_MAP[listId];
    if (!tagName) return;
    try {
      await ensureTagByName(tagName);
    } catch (_) {
      /* filter still works if tag exists */
    }
    if (listId === 'call') {
      if (typeof window.__openWarRoomFromSelection === 'function') {
        const boxes = typeof window.__getSelectedLeadCheckboxesForBulkActions === 'function'
          ? window.__getSelectedLeadCheckboxesForBulkActions()
          : [];
        if (!boxes.length) {
          document.querySelectorAll('#prospectLeadsTable tbody input.lead-checkbox, #prospectLeadsTable tbody input.row-checkbox').forEach((cb) => {
            cb.checked = true;
          });
        }
        window.__openWarRoomFromSelection();
        return;
      }
    }
    window.location.href = filterUrlForList(listId);
  }

  function onMethodCall(btn) {
    const row = btn.closest('tr.result-row');
    if (!row) return;
    const phoneBtn = row.querySelector('.js-click-to-call-btn');
    if (phoneBtn) {
      phoneBtn.click();
      return;
    }
    const cb = row.querySelector('input.lead-checkbox, input.row-checkbox');
    if (cb) {
      document.querySelectorAll('#prospectLeadsTable tbody input.lead-checkbox:checked, #prospectLeadsTable tbody input.row-checkbox:checked').forEach((x) => {
        x.checked = false;
      });
      cb.checked = true;
    }
    if (typeof window.__openWarRoomFromSelection === 'function') window.__openWarRoomFromSelection();
  }

  function onMethodEmail(btn) {
    const row = btn.closest('tr.result-row');
    if (!row) return;
    const mail = String(row.getAttribute('data-email') || row.dataset.email || '').trim();
    if (mail && mail !== 'N/A') {
      const outreachBtn = row.querySelector('.quick-outreach-btn');
      if (outreachBtn) {
        outreachBtn.click();
        return;
      }
      window.location.href = `mailto:${encodeURIComponent(mail)}`;
    }
  }

  async function pushGhlFromToolbar(btn) {
    const keys = resolveLeadKeys(true);
    if (!keys.length) {
      toast('No leads in this view.');
      return;
    }
    const prev = btn.textContent;
    btn.disabled = true;
    toolbarMsg(`Pushing ${keys.length} lead${keys.length === 1 ? '' : 's'} to GHL…`, true);
    try {
      const data = await apiJson('/ghl/push', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ leadKeys: keys }),
      });
      const pushed = data.pushed != null ? data.pushed : keys.length;
      const failed = data.failed != null ? data.failed : 0;
      const msg = `GHL: ${pushed} pushed${failed ? `, ${failed} failed` : ''}`;
      toolbarMsg(msg, failed === 0);
      toast(msg);
    } catch (err) {
      toolbarMsg(err.message || 'GHL push failed', false);
      toast(err.message || 'GHL push failed');
    } finally {
      btn.disabled = false;
      if (prev) btn.textContent = prev;
    }
  }

  document.addEventListener('click', (e) => {
    const ghlBtn = e.target.closest('.js-toolbar-push-ghl');
    if (ghlBtn) {
      e.preventDefault();
      pushGhlFromToolbar(ghlBtn);
      return;
    }
    const listBtn = e.target.closest('.js-add-outreach-list');
    if (listBtn) {
      e.preventDefault();
      const fromToolbar = !!listBtn.closest('#leadsOutreachToolbar');
      bulkAddToList(listBtn.getAttribute('data-outreach-list') || '', fromToolbar);
      return;
    }
    const lmvBtn = e.target.closest('.js-lmv-method-action');
    if (lmvBtn) {
      e.preventDefault();
      const kind = lmvBtn.getAttribute('data-lmv-action') || '';
      if (kind === 'call_list') startListAction('call');
      else if (kind === 'email_list') startListAction('email');
      else if (kind === 'double_tap_list') startListAction('doubleTap');
      return;
    }
    const callBtn = e.target.closest('.js-lead-method-call');
    if (callBtn) {
      e.preventDefault();
      e.stopPropagation();
      onMethodCall(callBtn);
      return;
    }
    const emailBtn = e.target.closest('.js-lead-method-email');
    if (emailBtn) {
      e.preventDefault();
      e.stopPropagation();
      onMethodEmail(emailBtn);
    }
  });

  document.addEventListener('change', (e) => {
    if (e.target && e.target.matches('#prospectLeadsTable input.lead-checkbox, #prospectLeadsTable input.row-checkbox')) {
      updateToolbarCounts();
      if (typeof window.__syncBulkBarFromDom === 'function') {
        window.__syncBulkBarFromDom();
      }
    }
  });

  document.addEventListener('DOMContentLoaded', updateToolbarCounts);
})();
