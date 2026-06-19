/**
 * Pipeline / inbound table select-all — loaded before app.js so header toggle always works.
 */
(function () {
  'use strict';

  function getPageCheckboxes(table) {
    if (!table) return [];
    const boxes = [];
    table.querySelectorAll('tbody tr').forEach((tr) => {
      if (tr.classList.contains('pipeline-row-page-hidden')) return;
      const cb = tr.querySelector(
        'input[type="checkbox"].lead-checkbox, input[type="checkbox"].row-checkbox',
      );
      if (cb) boxes.push(cb);
    });
    if (boxes.length) return boxes;
    return Array.from(
      table.querySelectorAll(
        'tbody input[type="checkbox"].lead-checkbox, tbody input[type="checkbox"].row-checkbox',
      ),
    ).filter((cb) => {
      const tr = cb.closest('tr');
      return !tr || !tr.classList.contains('pipeline-row-page-hidden');
    });
  }

  function countCheckedGlobally() {
    return document.querySelectorAll(
      'tbody input.lead-checkbox:checked, tbody input.row-checkbox:checked, input.lead-checkbox:checked, input.row-checkbox:checked',
    ).length;
  }

  function mountBulkBarToBody() {
    const bar = document.getElementById('bulkActionBar');
    if (bar && bar.parentElement !== document.body) {
      document.body.appendChild(bar);
    }
    return bar;
  }

  /** Show/hide floating bulk bar (Focus, Call room, SMS, etc.) — does not depend on app.js init order. */
  function showBulkActionBar(count) {
    const bar = mountBulkBarToBody();
    if (!bar) return;
    const n = Math.max(0, parseInt(count, 10) || 0);
    const visible = n > 0;
    bar.dataset.visible = visible ? 'true' : 'false';
    bar.classList.toggle('bulk-action-bar--visible', visible);
    bar.setAttribute('aria-hidden', visible ? 'false' : 'true');
    const circle = document.getElementById('selectedCountCircle');
    if (circle) circle.textContent = String(n);
    if (visible) {
      bar.classList.remove('opacity-0', 'translate-y-16', 'pointer-events-none');
      bar.classList.add('opacity-100', 'translate-y-0');
      bar.style.setProperty('opacity', '1', 'important');
      bar.style.setProperty('visibility', 'visible', 'important');
      bar.style.setProperty('transform', 'translateX(-50%) translateY(0)', 'important');
      bar.style.setProperty('pointer-events', 'auto', 'important');
      bar.querySelectorAll('button, a, select, input, textarea, label').forEach((el) => {
        el.classList.remove('opacity-40', 'pointer-events-none', 'cursor-not-allowed');
        el.style.pointerEvents = 'auto';
        if (el.tagName === 'BUTTON' && el.id !== 'cancelSelectionBtn') {
          el.disabled = false;
        }
      });
    } else {
      bar.classList.add('opacity-0', 'translate-y-16', 'pointer-events-none');
      bar.classList.remove('opacity-100', 'translate-y-0');
      bar.style.removeProperty('opacity');
      bar.style.removeProperty('visibility');
      bar.style.removeProperty('transform');
      bar.style.pointerEvents = 'none';
    }
  }
  window.__showBulkActionBar = showBulkActionBar;

  function syncBulkBarFromDom() {
    const count = countCheckedGlobally();
    showBulkActionBar(count);
    if (typeof window.__updateBulkActionBar === 'function') {
      window.__updateBulkActionBar();
    } else if (typeof window.__syncBulkSelectionFromDom === 'function') {
      window.__syncBulkSelectionFromDom();
    }
  }
  window.__syncBulkBarFromDom = syncBulkBarFromDom;

  function applySelectAll(header, forceChecked) {
    if (!header || header.nodeType !== 1) return 0;
    const table =
      header.closest('table') ||
      document.getElementById('prospectLeadsTable') ||
      document.querySelector('table thead input[data-select-all-leads]')?.closest('table');
    if (!table) return 0;

    const boxes = getPageCheckboxes(table);
    const checked = forceChecked != null ? !!forceChecked : !!header.checked;

    if (!boxes.length) {
      header.checked = false;
      header.indeterminate = false;
      return 0;
    }

    boxes.forEach((cb) => {
      cb.checked = checked;
      if (checked) cb.setAttribute('checked', 'checked');
      else cb.removeAttribute('checked');
    });

    header.checked = checked;
    header.indeterminate = false;

    table.querySelectorAll('tbody tr').forEach((tr) => {
      if (tr.classList.contains('pipeline-row-page-hidden')) return;
      const cb = tr.querySelector('input.lead-checkbox, input.row-checkbox');
      const on = !!(cb && cb.checked);
      tr.classList.toggle('bulk-selected', on);
      tr.setAttribute('aria-selected', on ? 'true' : 'false');
    });

    syncBulkBarFromDom();
    return boxes.length;
  }

  function bindRowCheckboxes(table) {
    if (!table || table.dataset.plcRowBulkBound === '1') return;
    if (!table.querySelector('tbody input.lead-checkbox, tbody input.row-checkbox')) return;
    table.dataset.plcRowBulkBound = '1';

    function onRowCheckboxChange(e) {
      const t = e.target;
      if (!t || t.tagName !== 'INPUT') return;
      if (!t.classList.contains('lead-checkbox') && !t.classList.contains('row-checkbox')) return;
      syncBulkBarFromDom();
    }

    table.addEventListener('change', onRowCheckboxChange);
    table.addEventListener('input', onRowCheckboxChange);
  }

  function bindTable(table) {
    const header = table.querySelector('thead input[data-select-all-leads]');
    if (!table.querySelector('tbody input.lead-checkbox, tbody input.row-checkbox')) return;

    bindRowCheckboxes(table);

    if (!header || header.dataset.plcBulkBound === '1') return;
    header.dataset.plcBulkBound = '1';

    function onHeaderToggle() {
      applySelectAll(header);
    }

    header.addEventListener('change', (e) => {
      e.stopPropagation();
      onHeaderToggle();
    });
    header.addEventListener('input', (e) => {
      e.stopPropagation();
      onHeaderToggle();
    });
  }

  function init() {
    mountBulkBarToBody();
    bindBulkBarCaptureActions();
    document.querySelectorAll('table').forEach((table) => {
      if (table.querySelector('thead input[data-select-all-leads]')) {
        bindTable(table);
      }
    });

    // Capture-phase fallback: runs before app.js table handlers call stopPropagation.
    document.addEventListener(
      'change',
      (e) => {
        const t = e.target;
        if (!t || !t.matches) return;
        if (!t.matches('input.lead-checkbox, input.row-checkbox')) return;
        syncBulkBarFromDom();
      },
      true,
    );

    document.addEventListener(
      'click',
      (e) => {
        const cb =
          e.target && e.target.closest
            ? e.target.closest('input.lead-checkbox, input.row-checkbox')
            : null;
        if (!cb) return;
        requestAnimationFrame(syncBulkBarFromDom);
      },
      true,
    );
  }

  /** Toggle/create folder row — works even if app.js bubble handlers miss the click. */
  function toggleBulkFolderNewRow() {
    const row = document.getElementById('bulkFolderNewRow');
    if (!row) return;
    const show = row.classList.contains('hidden');
    if (typeof window.__setBulkFolderNewRowVisible === 'function') {
      window.__setBulkFolderNewRowVisible(show);
      return;
    }
    const nameInput = document.getElementById('bulkFolderNewName');
    const toggle = document.getElementById('bulkFolderNewToggle');
    if (show) {
      row.classList.remove('hidden');
      row.classList.add('flex');
      if (toggle) toggle.setAttribute('aria-expanded', 'true');
      const tagsRow = document.getElementById('bulkTagsRow');
      if (tagsRow) {
        tagsRow.classList.add('hidden');
        tagsRow.classList.remove('flex');
      }
      if (nameInput) requestAnimationFrame(() => nameInput.focus());
    } else {
      row.classList.add('hidden');
      row.classList.remove('flex');
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
      if (nameInput) nameInput.value = '';
    }
  }

  function openCallRoomFromBulkBar() {
    if (typeof window.__openWarRoomFromSelection === 'function') {
      window.__openWarRoomFromSelection();
      return;
    }
    const msg = 'Call room is not available on this page.';
    if (typeof window.showProspectToast === 'function') window.showProspectToast(msg);
    else window.alert(msg);
  }

  /**
   * Capture-phase clicks on the bulk bar — fixes Folder / Call room when bubble handlers
   * or pointer-events on the portaled bar block individual button listeners.
   */
  function bindBulkBarCaptureActions() {
    if (window.__BULK_BAR_CAPTURE_BOUND === '1') return;
    window.__BULK_BAR_CAPTURE_BOUND = '1';

    document.addEventListener(
      'click',
      (e) => {
        const bar = document.getElementById('bulkActionBar');
        if (!bar || bar.dataset.visible !== 'true') return;
        if (!e.target || !e.target.closest || !e.target.closest('#bulkActionBar')) return;

        if (e.target.closest('#bulkFolderNewToggle')) {
          e.preventDefault();
          e.stopPropagation();
          toggleBulkFolderNewRow();
          return;
        }
        if (e.target.closest('#bulkFolderNewCancel')) {
          e.preventDefault();
          e.stopPropagation();
          if (typeof window.__setBulkFolderNewRowVisible === 'function') {
            window.__setBulkFolderNewRowVisible(false);
          } else {
            toggleBulkFolderNewRow();
          }
          return;
        }
        if (e.target.closest('#bulkFolderNewSave')) {
          e.preventDefault();
          e.stopPropagation();
          if (typeof window.__bulkFolderSaveFromBar === 'function') {
            window.__bulkFolderSaveFromBar();
          }
          return;
        }
        if (e.target.closest('#batchOutreachBtnBulk')) {
          e.preventDefault();
          e.stopPropagation();
          openCallRoomFromBulkBar();
          return;
        }
        if (e.target.closest('#bulkTagsToggle')) {
          e.preventDefault();
          e.stopPropagation();
          if (typeof window.__toggleBulkTagsRow === 'function') {
            window.__toggleBulkTagsRow();
          } else if (typeof window.__setBulkTagsRowVisible === 'function') {
            const tagsRow = document.getElementById('bulkTagsRow');
            window.__setBulkTagsRowVisible(!!(tagsRow && tagsRow.classList.contains('hidden')));
          }
        }
      },
      true,
    );
  }

  window.__PIPELINE_BULK_SELECT_V2 = '4';
  window.__pipelineBulkSelectApply = applySelectAll;
  window.__applySelectAllLeads = applySelectAll;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
