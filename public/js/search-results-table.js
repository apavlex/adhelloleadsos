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

  function syncBulkUi() {
    if (typeof window.__syncBulkSelectionFromDom === 'function') {
      window.__syncBulkSelectionFromDom();
    } else if (typeof window.__updateBulkActionBar === 'function') {
      window.__updateBulkActionBar();
    }
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
      syncBulkUi();
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
        syncBulkUi();
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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
