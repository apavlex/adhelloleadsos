(function () {
  'use strict';

  const msgEl = document.getElementById('tagsManageMsg');
  const countEl = document.getElementById('tagsManageCount');
  const tbody = document.getElementById('tagsManageBody');
  const createForm = document.getElementById('tagsManageCreateForm');
  const nameInput = document.getElementById('tagsManageNewName');

  function showMsg(text, ok) {
    if (!msgEl) return;
    msgEl.textContent = text;
    msgEl.className =
      'mb-4 text-sm rounded-xl px-4 py-3 ' +
      (ok
        ? 'bg-emerald-500/15 text-emerald-900 dark:text-emerald-200'
        : 'bg-red-500/15 text-red-900 dark:text-red-200');
    msgEl.classList.remove('hidden');
  }

  async function apiJson(url, opts) {
    const res = await fetch(url, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      ...opts,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      throw new Error((data && data.error) || 'Request failed');
    }
    return data;
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function encodeTagKey(key) {
    return encodeURIComponent(String(key || '').trim());
  }

  function updateCount() {
    if (!countEl || !tbody) return;
    const n = tbody.querySelectorAll('.tags-manage-row').length;
    countEl.textContent = `${n} tag${n === 1 ? '' : 's'}`;
  }

  function removeEmptyRow() {
    const empty = document.getElementById('tagsManageEmptyRow');
    if (empty) empty.remove();
  }

  function appendTagRow(tag) {
    if (!tbody || !tag || !tag.key) return;
    removeEmptyRow();
    const color = tag.color || '#94a3b8';
    const name = String(tag.name || 'Tag');
    const count = typeof tag.leadCount === 'number' ? tag.leadCount : 0;
    const tr = document.createElement('tr');
    tr.className = 'border-b border-brand-border/15 dark:border-white/[0.07] tags-manage-row';
    tr.setAttribute('data-tag-key', tag.key);
    tr.innerHTML = `
      <td class="px-4 py-3 align-middle">
        <span class="inline-block w-4 h-4 rounded-full border border-black/10 dark:border-white/15" style="background:${escapeHtml(color)}" aria-hidden="true"></span>
      </td>
      <td class="px-4 py-3 align-middle">
        <input type="text" class="tags-manage-name w-full max-w-md rounded-lg border border-brand-border/40 dark:border-white/10 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-semibold text-brand-dark dark:text-white" value="${escapeHtml(name)}" maxlength="80" data-original-name="${escapeHtml(name)}" />
      </td>
      <td class="px-4 py-3 align-middle">
        ${
          count > 0
            ? `<a href="/prospecting?tab=pipeline&amp;tagKey=${encodeTagKey(tag.key)}" class="text-sm font-bold text-brand-dark dark:text-white tabular-nums hover:text-brand-yellow transition-colors">${count}</a>`
            : '<span class="text-sm font-semibold text-brand-muted tabular-nums">0</span>'
        }
      </td>
      <td class="px-4 py-3 align-middle text-right whitespace-nowrap">
        <button type="button" class="tags-manage-save btn-pill bg-brand-yellow text-brand-dark px-3 py-1.5 text-[9px] font-black uppercase tracking-widest mr-2 disabled:opacity-40" disabled>Save</button>
        <button type="button" class="tags-manage-delete text-[10px] font-black uppercase tracking-widest text-red-500 hover:text-red-600 px-2 py-1">Delete</button>
      </td>`;
    tbody.appendChild(tr);
    bindRow(tr);
    updateCount();
  }

  function syncWorkspaceTags(tags) {
    if (Array.isArray(tags)) window.WORKSPACE_TAGS = tags;
  }

  function upsertWorkspaceTag(tag) {
    if (!tag || !tag.key) return;
    const list = Array.isArray(window.WORKSPACE_TAGS) ? window.WORKSPACE_TAGS.slice() : [];
    const idx = list.findIndex((t) => t && t.key === tag.key);
    if (idx >= 0) list[idx] = { ...list[idx], ...tag };
    else list.push(tag);
    list.sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }),
    );
    syncWorkspaceTags(list);
  }

  function removeWorkspaceTag(tagKey) {
    const list = Array.isArray(window.WORKSPACE_TAGS) ? window.WORKSPACE_TAGS : [];
    syncWorkspaceTags(list.filter((t) => t && t.key !== tagKey));
  }

  async function refreshTagsFromServer() {
    const data = await apiJson('/tags');
    syncWorkspaceTags(data.tags || []);
    return data.tags || [];
  }

  function bindRow(row) {
    if (!row) return;
    const key = row.getAttribute('data-tag-key');
    const nameEl = row.querySelector('.tags-manage-name');
    const saveBtn = row.querySelector('.tags-manage-save');
    const deleteBtn = row.querySelector('.tags-manage-delete');

    function syncSaveState() {
      if (!nameEl || !saveBtn) return;
      const orig = String(nameEl.getAttribute('data-original-name') || '').trim();
      const val = String(nameEl.value || '').trim();
      saveBtn.disabled = !val || val === orig;
    }

    if (nameEl) {
      nameEl.addEventListener('input', syncSaveState);
      nameEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (saveBtn && !saveBtn.disabled) saveBtn.click();
        }
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        const name = String(nameEl?.value || '').trim();
        if (!name || !key) return;
        saveBtn.disabled = true;
        try {
          const data = await apiJson(`/tags/${encodeTagKey(key)}/rename`, {
            method: 'POST',
            body: JSON.stringify({ name }),
          });
          if (nameEl) nameEl.setAttribute('data-original-name', name);
          upsertWorkspaceTag(data.tag);
          showMsg(`Renamed to “${name}”.`, true);
        } catch (err) {
          showMsg(err.message || 'Could not rename tag.', false);
        } finally {
          syncSaveState();
        }
      });
    }

    if (deleteBtn) {
      deleteBtn.addEventListener('click', async () => {
        const label = String(nameEl?.value || nameEl?.getAttribute('data-original-name') || 'this tag');
        const leadLink = row.querySelector('td:nth-child(3) a');
        const leadCount = leadLink ? parseInt(leadLink.textContent, 10) || 0 : 0;
        let confirmMsg = `Delete “${label}”?`;
        if (leadCount > 0) {
          confirmMsg += ` It will be removed from ${leadCount} lead${leadCount === 1 ? '' : 's'}.`;
        }
        if (!window.confirm(confirmMsg)) return;
        deleteBtn.disabled = true;
        try {
          await apiJson(`/tags/${encodeTagKey(key)}/delete`, { method: 'POST', body: '{}' });
          row.remove();
          removeWorkspaceTag(key);
          updateCount();
          if (!tbody.querySelector('.tags-manage-row')) {
            const tr = document.createElement('tr');
            tr.id = 'tagsManageEmptyRow';
            tr.innerHTML =
              '<td colspan="4" class="px-6 py-12 text-center text-sm text-brand-muted dark:text-slate-400">No tags yet. Create one above or from a lead panel.</td>';
            tbody.appendChild(tr);
          }
          showMsg(`Deleted “${label}”.`, true);
        } catch (err) {
          showMsg(err.message || 'Could not delete tag.', false);
          deleteBtn.disabled = false;
        }
      });
    }
  }

  if (tbody) {
    tbody.querySelectorAll('.tags-manage-row').forEach(bindRow);
  }

  if (createForm) {
    createForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = String(nameInput?.value || '').trim();
      if (!name) return;
      const submitBtn = createForm.querySelector('[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;
      try {
        const data = await apiJson('/tags', {
          method: 'POST',
          body: JSON.stringify({ name }),
        });
        appendTagRow({ ...data.tag, leadCount: 0 });
        upsertWorkspaceTag(data.tag);
        if (nameInput) nameInput.value = '';
        showMsg(`Created tag “${name}”.`, true);
      } catch (err) {
        showMsg(err.message || 'Could not create tag.', false);
      } finally {
        if (submitBtn) submitBtn.disabled = false;
        if (nameInput) nameInput.focus();
      }
    });
  }

  updateCount();
})();
