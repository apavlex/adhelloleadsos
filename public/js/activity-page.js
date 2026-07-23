(function () {
  const cfg = window.__ACTIVITY_PAGE || {};
  let offset = Number(cfg.offset) || 0;
  let total = Number(cfg.total) || 0;
  const filter = String(cfg.filter || 'all');
  const feedEl = document.getElementById('activityFeed');
  const countEl = document.getElementById('activityCountLabel');
  const statusEl = document.getElementById('activityStatus');
  const loadMoreBtn = document.getElementById('activityLoadMore');

  function setStatus(msg, variant) {
    if (!statusEl) return;
    const text = String(msg || '').trim();
    if (!text) {
      statusEl.classList.add('hidden');
      statusEl.textContent = '';
      return;
    }
    statusEl.textContent = text;
    statusEl.classList.remove('hidden', 'text-emerald-600', 'text-rose-600', 'text-brand-muted');
    if (variant === 'error') statusEl.classList.add('text-rose-600');
    else if (variant === 'success') statusEl.classList.add('text-emerald-600');
    else statusEl.classList.add('text-brand-muted');
  }

  function updateCount(shown, tot) {
    if (!countEl) return;
    countEl.textContent = `Showing ${shown} of ${tot} entries`;
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function leadFocusHref(leadKey) {
    const short = String(leadKey || '').replace(/^lead:/i, '');
    return `/prospecting?tab=pipeline&focusLead=${encodeURIComponent(short)}`;
  }

  function formatWhen(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    } catch (_) {
      return '—';
    }
  }

  function folderOptionsHtml(folders, selectedKey) {
    let html = '<option value="">Move to folder…</option>';
    html += `<option value=""${!selectedKey ? ' selected disabled' : ''}>${
      selectedKey ? 'Clear folder assignment' : 'No folder'
    }</option>`;
    (folders || []).forEach(function (fd) {
      if (!fd || !fd.key) return;
      const sel = fd.key === selectedKey ? ' selected' : '';
      html += `<option value="${escapeHtml(fd.key)}"${sel}>${escapeHtml(fd.name || 'Folder')}</option>`;
    });
    return html;
  }

  function renderRow(item, folders) {
    const idSafe = String(item.leadKey || '').replace(/[^a-zA-Z0-9_-]/g, '_');
    const meta = [];
    if (item.city) meta.push(escapeHtml(item.city));
    if (item.status) meta.push(escapeHtml(item.status));
    if (item.folderName) meta.push(`Folder: ${escapeHtml(item.folderName)}`);
    const metaLine = meta.length ? `<p class="text-[10px] font-semibold text-brand-muted mt-0.5">${meta.join(' · ')}</p>` : '';
    return `<article class="activity-row brand-card p-4 md:p-5 dark:bg-slate-900 dark:border-white/10 flex flex-col md:flex-row md:items-start gap-4" data-lead-key="${escapeHtml(item.leadKey)}" data-lead-title="${escapeHtml(item.leadTitle)}">
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-2 mb-1.5">
          <span class="inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-widest bg-brand-cream dark:bg-slate-800 text-brand-dark dark:text-slate-200 border border-brand-border/40 dark:border-white/10">${escapeHtml(item.typeLabel)}</span>
          <time class="text-[10px] font-bold text-brand-muted tabular-nums" datetime="${escapeHtml(item.ts)}">${formatWhen(item.ts)}</time>
        </div>
        <h2 class="font-display font-bold text-base text-brand-dark dark:text-white leading-snug">
          <a href="${leadFocusHref(item.leadKey)}" class="hover:text-brand-yellow transition-colors">${escapeHtml(item.leadTitle)}</a>
        </h2>
        ${metaLine}
        <p class="text-sm text-brand-dark/90 dark:text-slate-300 mt-2 leading-relaxed line-clamp-3">${escapeHtml(item.text)}</p>
      </div>
      <div class="flex flex-wrap md:flex-col gap-2 shrink-0 md:w-44">
        <a href="${leadFocusHref(item.leadKey)}" class="activity-action-btn btn-pill border border-brand-border dark:border-white/15 bg-white dark:bg-slate-800 text-[10px] font-black uppercase tracking-widest px-3 py-2 text-center">Open lead</a>
        <select class="activity-folder-select rounded-xl border border-brand-border dark:border-white/10 bg-brand-cream/40 dark:bg-slate-800/80 px-2 py-2 text-[10px] font-bold text-brand-dark dark:text-white" data-lead-key="${escapeHtml(item.leadKey)}" aria-label="Move ${escapeHtml(item.leadTitle)} to folder">${folderOptionsHtml(folders, item.folderKey)}</select>
        <button type="button" class="activity-add-task-btn btn-pill bg-emerald-500 hover:bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest px-3 py-2" data-lead-key="${escapeHtml(item.leadKey)}" data-lead-title="${escapeHtml(item.leadTitle)}" data-activity-text="${encodeURIComponent(String(item.text || '').slice(0, 300))}">Add to tasks</button>
      </div>
    </article>`;
  }

  async function assignFolder(leadKey, folderKey) {
    const res = await fetch('/folders/assign', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ leadKey, folderKey: folderKey || '' }),
    });
    const data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok || !data.success) {
      throw new Error((data && data.error) || 'Could not move lead to folder.');
    }
    return data;
  }

  async function addTask(leadKey, leadTitle, activityText) {
    const snippet = String(activityText || '').trim().slice(0, 80);
    const title = snippet
      ? `Follow up: ${leadTitle} — ${snippet}${snippet.length >= 80 ? '…' : ''}`
      : `Follow up: ${leadTitle}`;
    const res = await fetch('/tasks/api', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        title: title.slice(0, 200),
        leadKey,
        column: 'todo',
      }),
    });
    const data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok || !data.success) {
      throw new Error((data && data.error) || 'Could not add task.');
    }
    return data;
  }

  async function loadMore() {
    if (!loadMoreBtn) return;
    loadMoreBtn.disabled = true;
    setStatus('Loading…');
    try {
      const res = await fetch(
        `/activity/api?filter=${encodeURIComponent(filter)}&limit=50&offset=${encodeURIComponent(String(offset))}`,
        { credentials: 'same-origin', headers: { Accept: 'application/json' } },
      );
      const data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data.success) {
        throw new Error((data && data.error) || 'Could not load activity.');
      }
      const items = Array.isArray(data.items) ? data.items : [];
      total = Number(data.total) || total;
      if (items.length && feedEl) {
        const empty = feedEl.querySelector('.brand-card.p-12');
        if (empty) empty.remove();
        items.forEach(function (item) {
          feedEl.insertAdjacentHTML('beforeend', renderRow(item, data.folders));
        });
        offset += items.length;
        updateCount(offset, total);
      }
      if (offset >= total && loadMoreBtn) {
        loadMoreBtn.classList.add('hidden');
      }
      setStatus('');
    } catch (err) {
      setStatus((err && err.message) || 'Load failed.', 'error');
    } finally {
      if (loadMoreBtn) loadMoreBtn.disabled = false;
    }
  }

  document.addEventListener('change', function (e) {
    const sel = e.target && e.target.closest ? e.target.closest('.activity-folder-select') : null;
    if (!sel) return;
    const leadKey = String(sel.getAttribute('data-lead-key') || '').trim();
    const folderKey = String(sel.value || '').trim();
    if (!leadKey) return;
    const prev = sel.dataset.prevValue != null ? sel.dataset.prevValue : '';
    sel.disabled = true;
    setStatus('Moving to folder…');
    assignFolder(leadKey, folderKey)
      .then(function () {
        sel.dataset.prevValue = folderKey;
        setStatus('Lead moved to folder.', 'success');
        if (typeof window.showAppToast === 'function') {
          window.showAppToast('Lead moved to folder', { variant: 'success' });
        }
      })
      .catch(function (err) {
        sel.value = prev;
        setStatus((err && err.message) || 'Move failed.', 'error');
      })
      .finally(function () {
        sel.disabled = false;
      });
  });

  document.addEventListener('click', function (e) {
    const btn = e.target && e.target.closest ? e.target.closest('.activity-add-task-btn') : null;
    if (!btn) return;
    const leadKey = String(btn.getAttribute('data-lead-key') || '').trim();
    const leadTitle = String(btn.getAttribute('data-lead-title') || 'Lead').trim();
    let activityText = '';
    try {
      activityText = decodeURIComponent(String(btn.getAttribute('data-activity-text') || ''));
    } catch (_) {
      activityText = String(btn.getAttribute('data-activity-text') || '');
    }
    activityText = activityText.trim();
    if (!leadKey) return;
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Adding…';
    setStatus('Adding to task list…');
    addTask(leadKey, leadTitle, activityText)
      .then(function () {
        btn.textContent = '✓ Added';
        setStatus('Added to your To Do list.', 'success');
        if (typeof window.showAppToast === 'function') {
          window.showAppToast('Added to tasks', { variant: 'success' });
        }
        window.setTimeout(function () {
          btn.textContent = original;
        }, 1800);
      })
      .catch(function (err) {
        btn.textContent = original;
        setStatus((err && err.message) || 'Task failed.', 'error');
      })
      .finally(function () {
        btn.disabled = false;
      });
  });

  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', function () {
      void loadMore();
    });
  }

  document.querySelectorAll('.activity-folder-select').forEach(function (sel) {
    sel.dataset.prevValue = String(sel.value || '');
  });
})();
