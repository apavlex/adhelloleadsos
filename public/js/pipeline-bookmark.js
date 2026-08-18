/**
 * Pipeline row bookmarks — bound immediately so a later app.js crash cannot
 * leave the ribbon icon as a no-op. Search-results save/unsave is unchanged.
 */
(function () {
  'use strict';

  if (window.__PIPELINE_BOOKMARK_BOUND === '1') return;
  window.__PIPELINE_BOOKMARK_BOUND = '1';

  function isPipelineBookmarkButton(btn) {
    if (!btn || !btn.closest) return false;
    if (btn.classList.contains('pipeline-bookmark-btn')) return true;
    return !!(btn.classList.contains('bookmark-btn') && btn.closest('#prospectLeadsTable'));
  }

  function bookmarkTitles(saved) {
    return saved
      ? { title: 'Bookmarked — click to remove', label: 'Remove bookmark' }
      : { title: 'Bookmark lead', label: 'Bookmark lead' };
  }

  function markBookmarkSaved(btn) {
    if (!btn) return;
    btn.dataset.saved = '1';
    btn.setAttribute('data-saved', '1');
    btn.setAttribute('aria-pressed', 'true');
    btn.classList.add('bg-brand-yellow', 'text-brand-dark', 'border-brand-yellow', 'bookmark-btn--saved');
    btn.classList.remove('text-brand-muted', 'border-brand-border', 'dark:text-slate-400');
    const titles = bookmarkTitles(true);
    btn.setAttribute('title', titles.title);
    btn.setAttribute('aria-label', titles.label);
    const svg = btn.querySelector('svg');
    if (svg) svg.setAttribute('fill', 'currentColor');
  }

  function markBookmarkUnsaved(btn) {
    if (!btn) return;
    btn.dataset.saved = '0';
    btn.setAttribute('data-saved', '0');
    btn.setAttribute('aria-pressed', 'false');
    btn.classList.remove('bg-brand-yellow', 'text-brand-dark', 'border-brand-yellow', 'bookmark-btn--saved');
    btn.classList.add('text-brand-muted', 'border-brand-border');
    const titles = bookmarkTitles(false);
    btn.setAttribute('title', titles.title);
    btn.setAttribute('aria-label', titles.label);
    const svg = btn.querySelector('svg');
    if (svg) svg.setAttribute('fill', 'none');
  }

  function isButtonBookmarked(btn, row) {
    if (!btn) return false;
    const savedAttr = btn.getAttribute('data-saved');
    if (savedAttr === '1' || btn.dataset.saved === '1' || btn.classList.contains('bookmark-btn--saved')) {
      return true;
    }
    if (savedAttr === '0' || btn.dataset.saved === '0') return false;
    return !!(row && row.dataset && row.dataset.bookmarked === '1');
  }

  function leadKeyFromRow(row) {
    if (!row) return '';
    let leadKey = String((row.dataset && row.dataset.leadKey) || '').trim();
    if (!leadKey) {
      const cb = row.querySelector && row.querySelector('input.lead-checkbox[data-key]');
      leadKey = String((cb && cb.getAttribute('data-key')) || '').trim();
      if (leadKey && row.dataset) row.dataset.leadKey = leadKey;
    }
    return leadKey;
  }

  function applyRowBookmarked(row, btn, on) {
    if (row && row.dataset) {
      row.dataset.bookmarked = on ? '1' : '0';
      row.dataset.bookmarkClient = '1';
    }
    if (on) markBookmarkSaved(btn);
    else markBookmarkUnsaved(btn);
    const list = window.INITIAL_SAVED_LEADS;
    if (Array.isArray(list) && row) {
      const rawKey = String((row.dataset && row.dataset.leadKey) || '').trim();
      const keyNorm = rawKey.replace(/^lead:/i, '');
      const rec = list.find((l) => {
        if (!l) return false;
        const lk = String(l.key || '').trim();
        const lkNorm = lk.replace(/^lead:/i, '');
        return !!(rawKey && (lk === rawKey || lkNorm === keyNorm));
      });
      if (rec) rec.bookmarked = on;
    }
  }

  async function togglePipelineLeadBookmark(row, bookmarkBtn) {
    if (!row || !bookmarkBtn) return false;
    if (bookmarkBtn.dataset.bookmarkBusy === '1') return false;

    const leadKey = leadKeyFromRow(row);
    if (!leadKey) {
      if (typeof window.showAppToast === 'function') {
        window.showAppToast('Could not bookmark — missing lead key.', { variant: 'error' });
      }
      return false;
    }

    const next = !isButtonBookmarked(bookmarkBtn, row);
    bookmarkBtn.dataset.bookmarkBusy = '1';
    bookmarkBtn.setAttribute('aria-busy', 'true');
    applyRowBookmarked(row, bookmarkBtn, next);

    try {
      const res = await fetch('/leads/' + encodeURIComponent(leadKey) + '/update', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ bookmarked: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error((data && data.error) || 'Could not update bookmark');
      }
      const persisted =
        data.lead && Object.prototype.hasOwnProperty.call(data.lead, 'bookmarked')
          ? !!data.lead.bookmarked
          : next;
      applyRowBookmarked(row, bookmarkBtn, persisted);
      if (typeof window.showProspectToast === 'function') {
        window.showProspectToast(persisted ? 'Lead bookmarked' : 'Bookmark removed');
      }
      return true;
    } catch (err) {
      console.error('Failed to toggle pipeline bookmark:', err);
      applyRowBookmarked(row, bookmarkBtn, !next);
      if (row && row.dataset) delete row.dataset.bookmarkClient;
      if (typeof window.showAppToast === 'function') {
        window.showAppToast((err && err.message) || 'Could not update bookmark', { variant: 'error' });
      }
      return false;
    } finally {
      delete bookmarkBtn.dataset.bookmarkBusy;
      bookmarkBtn.removeAttribute('aria-busy');
    }
  }

  window.__togglePipelineLeadBookmark = togglePipelineLeadBookmark;
  window.__markPipelineBookmarkSaved = markBookmarkSaved;
  window.__markPipelineBookmarkUnsaved = markBookmarkUnsaved;

  function onPipelineBookmarkClick(e) {
    if (!e || !e.target || !e.target.closest) return;
    const bookmarkBtn = e.target.closest('.bookmark-btn');
    if (!bookmarkBtn || !isPipelineBookmarkButton(bookmarkBtn)) return;

    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();

    const row = bookmarkBtn.closest('.result-row');
    if (!row) return;
    void togglePipelineLeadBookmark(row, bookmarkBtn);
  }

  document.addEventListener('click', onPipelineBookmarkClick, true);
})();
