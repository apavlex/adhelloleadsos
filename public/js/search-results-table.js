/**
 * Search results table — select-all + row bookmarks.
 * Scoped to #searchResultsLeadsTable so it works even if other app.js handlers race.
 */
(function () {
  function normalizeTitleKey(title) {
    return String(title || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  /** Rebuild folder dropdown from window.WORKSPACE_FOLDERS (available before app.js finishes init). */
  function rebuildBulkFolderSelect(preferredValue) {
    const selectEl = document.getElementById('bulkFolderSelect');
    if (!selectEl) return;
    if (!Array.isArray(window.WORKSPACE_FOLDERS)) window.WORKSPACE_FOLDERS = [];
    const folders = [...window.WORKSPACE_FOLDERS].sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }),
    );
    const prev =
      preferredValue !== undefined && preferredValue !== null
        ? String(preferredValue)
        : selectEl.value;
    selectEl.innerHTML = '';
    const emptyOpt = document.createElement('option');
    emptyOpt.value = '';
    emptyOpt.textContent = 'No folder';
    selectEl.appendChild(emptyOpt);
    folders.forEach((f) => {
      if (!f || !f.key) return;
      const opt = document.createElement('option');
      opt.value = f.key;
      opt.textContent = f.name || 'Folder';
      selectEl.appendChild(opt);
    });
    const valid = prev && Array.from(selectEl.options).some((o) => o.value === prev);
    selectEl.value = valid ? prev : '';
    selectEl.dispatchEvent(new Event('change', { bubbles: true }));
  }
  window.__rebuildBulkFolderSelect = rebuildBulkFolderSelect;

  function mountBulkBar() {
    const bar = document.getElementById('bulkActionBar');
    if (bar && bar.parentElement !== document.body) {
      document.body.appendChild(bar);
    }
    return bar;
  }

  function renderSearchResultStars() {
    if (typeof window.__applyReviewStars === 'function') {
      const table = document.getElementById('searchResultsLeadsTable');
      window.__applyReviewStars(table || document);
    }
  }
  window.__renderSearchResultStars = renderSearchResultStars;

  function countCheckedRows(table) {
    const tbody = table.querySelector('tbody');
    if (!tbody) return 0;
    return tbody.querySelectorAll('input.lead-checkbox:checked').length;
  }

  function getSelectedFolderKey() {
    const folderEl = document.getElementById('bulkFolderSelect');
    const fromBar = folderEl && folderEl.value ? String(folderEl.value).trim() : '';
    if (fromBar) return fromBar;
    return typeof window.SEARCH_TARGET_FOLDER_KEY === 'string'
      ? window.SEARCH_TARGET_FOLDER_KEY.trim()
      : '';
  }

  function getFolderDisplayName(folderKey) {
    if (!folderKey || !Array.isArray(window.WORKSPACE_FOLDERS)) return '';
    const match = window.WORKSPACE_FOLDERS.find((f) => f && f.key === folderKey);
    return match && match.name ? match.name : '';
  }

  function showBulkSaveFeedback(message, variant) {
    const el = document.getElementById('bulkSaveFeedback');
    if (el) {
      el.textContent = message || '';
      el.classList.remove('hidden', 'text-emerald-300', 'text-rose-300', 'text-white/70');
      if (variant === 'error') el.classList.add('text-rose-300');
      else if (variant === 'loading') el.classList.add('text-white/70');
      else el.classList.add('text-emerald-300');
      if (!message) el.classList.add('hidden');
    }
    if (variant === 'error' && typeof window.showAppToast === 'function') {
      window.showAppToast(message, { variant: 'error', duration: 9000 });
    } else if (message && variant === 'ok' && typeof window.showAppToast === 'function') {
      window.showAppToast(message, { duration: 4500 });
    }
  }

  let bulkSaveInFlight = false;

  async function bulkSaveSelectedToFolder(triggerBtn) {
    if (bulkSaveInFlight) return;
    const table = document.getElementById('searchResultsLeadsTable');
    if (!table) return;

    const folderKey = getSelectedFolderKey();
    const checked = Array.from(table.querySelectorAll('tbody input.lead-checkbox:checked'));
    if (!checked.length) {
      showBulkSaveFeedback('Select at least one lead.', 'error');
      return;
    }
    if (!folderKey) {
      showBulkSaveFeedback('Select a folder (or create one) before saving.', 'error');
      return;
    }

    const rows = checked
      .map((cb) => cb.closest('tr.result-row'))
      .filter(Boolean);
    const folderName = getFolderDisplayName(folderKey);
    const saveBtn = triggerBtn || document.getElementById('bulkSaveBtn');
    const defaultLabel =
      (saveBtn && saveBtn.getAttribute('data-default-label')) || 'Save to folder';

    bulkSaveInFlight = true;
    showBulkSaveFeedback(
      `Saving ${rows.length} lead${rows.length === 1 ? '' : 's'}${folderName ? ` to ${folderName}` : ''}…`,
      'loading',
    );
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.setAttribute('aria-busy', 'true');
      saveBtn.innerHTML =
        '<span class="inline-flex items-center gap-2"><svg class="w-4 h-4 animate-spin shrink-0" fill="none" viewBox="0 0 24 24" aria-hidden="true"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg><span>Saving…</span></span>';
    }

    let savedCount = 0;
    const leadKeys = [];
    let succeeded = false;

    try {
      const folderEl = document.getElementById('bulkFolderSelect');
      if (folderEl && !folderEl.value) folderEl.value = folderKey;

      for (const row of rows) {
        let key = String(row.dataset.leadKey || '').trim();
        if (!key && window.__savedLeadsByTitle) {
          key = String(window.__savedLeadsByTitle.get(normalizeTitleKey(row.dataset.title)) || '').trim();
        }
        if (!key) {
          const ok = await saveRow(row);
          if (ok) {
            key = String(row.dataset.leadKey || '').trim();
          }
        }
        if (key) {
          savedCount += 1;
          leadKeys.push(key.startsWith('lead:') ? key : `lead:${key}`);
          markSaved(row.querySelector('.bookmark-btn'));
        }
      }

      const uniqueKeys = [...new Set(leadKeys.filter(Boolean))];
      if (uniqueKeys.length) {
        const res = await fetch('/folders/assign-bulk', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ leadKeys: uniqueKeys, folderKey }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
          throw new Error((data && data.error) || `Could not assign folder (HTTP ${res.status})`);
        }
      }

      if (savedCount === 0) {
        throw new Error('No leads were saved. Try again or refresh the page.');
      }

      const successMsg = folderName
        ? `Saved ${savedCount} lead${savedCount === 1 ? '' : 's'} to ${folderName}`
        : `Saved ${savedCount} lead${savedCount === 1 ? '' : 's'}`;
      showBulkSaveFeedback(successMsg, 'ok');
      if (saveBtn) {
        saveBtn.classList.add('bulk-save-btn--success', 'ring-2', 'ring-emerald-300');
        saveBtn.innerHTML =
          '<span class="inline-flex items-center gap-2"><svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path></svg><span>Saved!</span></span>';
      }
      succeeded = true;
    } catch (err) {
      console.error('[search-results-table] bulk save failed:', err);
      showBulkSaveFeedback(err.message || 'Could not save leads to folder.', 'error');
      if (saveBtn) {
        saveBtn.textContent = defaultLabel;
        saveBtn.classList.remove('bulk-save-btn--success', 'ring-2', 'ring-emerald-300');
        saveBtn.removeAttribute('aria-busy');
        saveBtn.disabled = countCheckedRows(table) === 0;
      }
    } finally {
      bulkSaveInFlight = false;
    }

    if (succeeded) {
      setTimeout(function () {
        const btn = document.getElementById('bulkSaveBtn');
        if (!btn) return;
        btn.textContent = defaultLabel;
        btn.classList.remove('bulk-save-btn--success', 'ring-2', 'ring-emerald-300');
        btn.removeAttribute('aria-busy');
        btn.disabled = countCheckedRows(table) === 0;
        showBulkSaveFeedback('', 'ok');
      }, 3500);
    }
  }

  window.__bulkSaveSearchResultsToFolder = bulkSaveSelectedToFolder;

  /** Show the floating bulk bar (folder + save) when rows are selected on search results. */
  function syncBulkBar(table) {
    const n = countCheckedRows(table);
    const bar = mountBulkBar();
    if (bar) {
      const circle = document.getElementById('selectedCountCircle');
      if (circle) circle.textContent = String(n);
      const visible = n > 0;
      bar.dataset.visible = visible ? 'true' : 'false';
      bar.classList.toggle('bulk-action-bar--visible', visible);
      bar.setAttribute('aria-hidden', visible ? 'false' : 'true');
      if (visible) {
        bar.classList.remove('opacity-0', 'translate-y-24', 'pointer-events-none');
        bar.classList.add('opacity-100', 'translate-y-0');
        bar.style.pointerEvents = 'auto';
      } else {
        bar.classList.add('opacity-0', 'translate-y-24', 'pointer-events-none');
        bar.classList.remove('opacity-100', 'translate-y-0');
        bar.style.pointerEvents = 'none';
      }
      const saveBtn = document.getElementById('bulkSaveBtn');
      if (saveBtn && saveBtn.getAttribute('aria-busy') !== 'true') {
        saveBtn.disabled = n === 0;
      }
    }

    const headerBulk = document.getElementById('headerBulkActions');
    const headerCount = document.getElementById('headerSelectedCount');
    if (headerBulk) {
      if (n > 0) {
        headerBulk.classList.remove('hidden');
        headerBulk.classList.add('flex');
        if (headerCount) headerCount.textContent = String(n);
      } else {
        headerBulk.classList.add('hidden');
        headerBulk.classList.remove('flex');
      }
    }

    document.querySelectorAll('.js-bulk-enhance').forEach((btn) => {
      btn.classList.toggle('ring-2', n > 0);
      btn.classList.toggle('ring-brand-yellow/60', n > 0);
    });
  }

  function syncBulkUi(table) {
    const tbl = table || document.getElementById('searchResultsLeadsTable');
    if (tbl) syncBulkBar(tbl);
    if (typeof window.__syncBulkSelectionFromDom === 'function') {
      window.__syncBulkSelectionFromDom();
    } else if (typeof window.__updateBulkActionBar === 'function') {
      window.__updateBulkActionBar();
    }
  }

  function setBulkFolderNewRowVisible(show) {
    const row = document.getElementById('bulkFolderNewRow');
    const nameInput = document.getElementById('bulkFolderNewName');
    const toggle = document.getElementById('bulkFolderNewToggle');
    if (!row) return;
    if (show) {
      row.classList.remove('hidden');
      row.classList.add('flex');
      if (toggle) toggle.setAttribute('aria-expanded', 'true');
      if (nameInput) {
        requestAnimationFrame(() => nameInput.focus());
      }
    } else {
      row.classList.add('hidden');
      row.classList.remove('flex');
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
      if (nameInput) nameInput.value = '';
    }
  }

  function initBulkBarFolderActions() {
    const bar = mountBulkBar();
    if (!bar || bar.dataset.folderActionsBound === '1') return;
    bar.dataset.folderActionsBound = '1';

    rebuildBulkFolderSelect(
      typeof window.SEARCH_TARGET_FOLDER_KEY === 'string' ? window.SEARCH_TARGET_FOLDER_KEY.trim() : '',
    );

    const folderSelect = document.getElementById('bulkFolderSelect');
    if (folderSelect) {
      folderSelect.addEventListener('change', function () {
        const tbl = document.getElementById('searchResultsLeadsTable');
        if (tbl) syncBulkBar(tbl);
      });
    }

    bar.addEventListener('click', async (e) => {
      if (e.target.closest('#bulkSaveBtn')) {
        e.preventDefault();
        e.stopPropagation();
        await bulkSaveSelectedToFolder(document.getElementById('bulkSaveBtn'));
        return;
      }
      if (e.target.closest('#bulkFolderNewToggle')) {
        e.preventDefault();
        e.stopPropagation();
        const row = document.getElementById('bulkFolderNewRow');
        const show = !!(row && row.classList.contains('hidden'));
        setBulkFolderNewRowVisible(show);
        return;
      }
      if (e.target.closest('#bulkFolderNewCancel')) {
        e.preventDefault();
        e.stopPropagation();
        setBulkFolderNewRowVisible(false);
        return;
      }
      if (e.target.closest('#bulkFolderNewSave')) {
        e.preventDefault();
        e.stopPropagation();
        const nameInput = document.getElementById('bulkFolderNewName');
        const name = nameInput ? String(nameInput.value || '').trim() : '';
        if (!name) {
          window.alert('Enter a folder name.');
          return;
        }
        const saveBtn = document.getElementById('bulkFolderNewSave');
        if (saveBtn) saveBtn.disabled = true;
        try {
          const res = await fetch('/folders', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ name }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data.success || !data.folder || !data.folder.key) {
            throw new Error((data && data.error) || `HTTP ${res.status}`);
          }
          const { key, name: folderName } = data.folder;
          if (!Array.isArray(window.WORKSPACE_FOLDERS)) window.WORKSPACE_FOLDERS = [];
          const existing = window.WORKSPACE_FOLDERS.find((f) => f && f.key === key);
          if (existing) {
            existing.name = folderName || name;
          } else {
            window.WORKSPACE_FOLDERS.push({ key, name: folderName || name });
          }
          rebuildBulkFolderSelect(key);
          setBulkFolderNewRowVisible(false);
          if (typeof window.showProspectToast === 'function') {
            window.showProspectToast('Folder created');
          }
        } catch (err) {
          console.error('[search-results-table] create folder failed:', err);
          window.alert(err.message || 'Could not create folder.');
        } finally {
          if (saveBtn) saveBtn.disabled = false;
        }
      }
    });

    bar.addEventListener('keydown', (e) => {
      if (e.target.id !== 'bulkFolderNewName') return;
      if (e.key === 'Escape') {
        e.preventDefault();
        setBulkFolderNewRowVisible(false);
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const save = document.getElementById('bulkFolderNewSave');
        if (save && !save.disabled) save.click();
      }
    });
  }

  function markSaved(btn) {
    if (!btn) return;
    btn.dataset.saved = '1';
    btn.classList.add('bg-brand-yellow', 'text-brand-dark', 'border-brand-yellow');
    btn.classList.remove('text-brand-muted', 'border-brand-border');
    btn.setAttribute('title', 'Saved — click to remove');
    const svg = btn.querySelector('svg');
    if (svg) svg.setAttribute('fill', 'currentColor');
  }

  function markUnsaved(btn) {
    if (!btn) return;
    delete btn.dataset.saved;
    btn.classList.remove('bg-brand-yellow', 'text-brand-dark', 'border-brand-yellow');
    btn.classList.add('text-brand-muted', 'border-brand-border');
    btn.setAttribute('title', 'Save lead');
    const svg = btn.querySelector('svg');
    if (svg) svg.setAttribute('fill', 'none');
  }

  function isTitleSaved(title) {
    const key = normalizeTitleKey(title);
    if (!key) return false;
    if (typeof window.__isLeadTitleSaved === 'function') {
      return window.__isLeadTitleSaved(title);
    }
    const map = window.__savedLeadsByTitle;
    return !!(map && map.has && map.has(key));
  }

  async function saveRow(row) {
    if (typeof window.__saveSearchResultLead === 'function') {
      return window.__saveSearchResultLead(row);
    }
    const folderEl = document.getElementById('bulkFolderSelect');
    const folderFromBar = folderEl && folderEl.value ? String(folderEl.value).trim() : '';
    const folderFromSearch =
      typeof window.SEARCH_TARGET_FOLDER_KEY === 'string' ? window.SEARCH_TARGET_FOLDER_KEY.trim() : '';
    const leadData = {
      title: row.dataset.title,
      phone: row.dataset.phone,
      website: row.dataset.website,
      email: row.dataset.email,
      categoryName: row.dataset.category,
      address: row.dataset.address,
      city: row.dataset.city,
      totalScore: parseFloat(row.dataset.rating) || 0,
      reviewsCount: parseInt(row.dataset.reviews, 10) || 0,
      url: row.dataset.url,
      facebook: row.dataset.facebook,
      instagram: row.dataset.instagram,
      twitter: row.dataset.twitter,
      folderKey: folderFromBar || folderFromSearch,
    };
    try {
      const res = await fetch('/leads/save', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(leadData),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success && data.key) {
        const titleKey = normalizeTitleKey(row.dataset.title);
        if (window.__savedLeadsByTitle && window.__savedLeadsByTitle.set) {
          window.__savedLeadsByTitle.set(titleKey, data.key);
        }
        row.dataset.leadKey = data.key;
        return true;
      }
      if (typeof window.showAppToast === 'function') {
        window.showAppToast((data && data.error) || 'Could not save lead', { variant: 'error' });
      }
    } catch (err) {
      console.error('[search-results-table] save failed:', err);
    }
    return false;
  }

  async function unsaveRow(row) {
    if (typeof window.__unsaveSearchResultLead === 'function') {
      return window.__unsaveSearchResultLead(row);
    }
    const titleKey = normalizeTitleKey(row.dataset.title);
    const leadKey =
      (window.__savedLeadsByTitle && window.__savedLeadsByTitle.get(titleKey)) ||
      row.dataset.leadKey;
    if (!leadKey) return false;
    try {
      const res = await fetch(`/leads/${encodeURIComponent(leadKey)}/delete`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        if (window.__savedLeadsByTitle && window.__savedLeadsByTitle.delete) {
          window.__savedLeadsByTitle.delete(titleKey);
        }
        delete row.dataset.leadKey;
        return true;
      }
    } catch (err) {
      console.error('[search-results-table] unsave failed:', err);
    }
    return false;
  }

  function init() {
    const table = document.getElementById('searchResultsLeadsTable');
    if (!table) return;

    const tbody = table.querySelector('tbody');
    const header = table.querySelector('input[data-select-all-leads]');
    if (!tbody || !header) return;

    function rowCheckboxes() {
      return Array.from(tbody.querySelectorAll('input.lead-checkbox'));
    }

    function syncHeaderFromRows() {
      const boxes = rowCheckboxes();
      const checked = boxes.filter((cb) => cb.checked).length;
      header.checked = boxes.length > 0 && checked === boxes.length;
      header.indeterminate = checked > 0 && checked < boxes.length;
    }

    function setAllRows(checked) {
      rowCheckboxes().forEach((cb) => {
        cb.checked = checked;
      });
      syncHeaderFromRows();
      syncBulkUi(table);
    }

    mountBulkBar();
    initBulkBarFolderActions();

    const headerBulkSaveBtn = document.getElementById('headerBulkSaveBtn');
    if (headerBulkSaveBtn) {
      headerBulkSaveBtn.addEventListener('click', function (e) {
        e.preventDefault();
        bulkSaveSelectedToFolder(headerBulkSaveBtn);
      });
    }

    table.addEventListener('change', (e) => {
      const t = e.target;
      if (!t || t.tagName !== 'INPUT') return;
      if (t === header) {
        e.stopPropagation();
        setAllRows(!!t.checked);
        return;
      }
      if (t.classList.contains('lead-checkbox')) {
        e.stopPropagation();
        syncHeaderFromRows();
        syncBulkUi(table);
      }
    });

    header.addEventListener(
      'click',
      (e) => {
        e.stopPropagation();
      },
      true,
    );

    table.addEventListener('click', async (e) => {
        const btn = e.target.closest('.bookmark-btn');
        if (!btn || !table.contains(btn)) return;
        e.preventDefault();
        e.stopPropagation();
        const row = btn.closest('tr.result-row');
        if (!row || !row.dataset.title) return;

        if (isTitleSaved(row.dataset.title)) {
          const ok = await unsaveRow(row);
          if (ok) markUnsaved(btn);
          return;
        }

        markSaved(btn);
        const ok = await saveRow(row);
        if (!ok) markUnsaved(btn);
        else if (typeof window.showProspectToast === 'function') {
          window.showProspectToast('Lead saved');
        }
    });

    document.querySelectorAll('#searchResultsLeadsTable tr.result-row').forEach((row) => {
      const title = row.dataset.title;
      if (!title || !isTitleSaved(title)) return;
      const btn = row.querySelector('.bookmark-btn');
      if (btn) markSaved(btn);
    });

    syncHeaderFromRows();
    renderSearchResultStars();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
