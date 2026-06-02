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

    if (typeof window.__updateBulkActionBar === 'function') {
      window.__updateBulkActionBar();
    } else if (typeof window.__syncBulkSelectionFromDom === 'function') {
      window.__syncBulkSelectionFromDom();
    }

    return boxes.length;
  }

  function bindTable(table) {
    const header = table.querySelector('thead input[data-select-all-leads]');
    if (!header || header.dataset.plcBulkBound === '1') return;
    if (!table.querySelector('tbody input.lead-checkbox, tbody input.row-checkbox')) return;
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
    document.querySelectorAll('table').forEach((table) => {
      if (table.querySelector('thead input[data-select-all-leads]')) {
        bindTable(table);
      }
    });
  }

  window.__PIPELINE_BULK_SELECT_V2 = '2';
  window.__pipelineBulkSelectApply = applySelectAll;
  window.__applySelectAllLeads = applySelectAll;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
