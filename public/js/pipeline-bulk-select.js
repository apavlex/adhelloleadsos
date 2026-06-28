/**
 * Pipeline / inbound table select-all — loaded before app.js so header toggle always works.
 */
(function () {
  'use strict';

  function getPageCheckboxes(table) {
    if (!table) return [];
    const rowSel = 'tbody tr.result-row:not(.pipeline-row-page-hidden)';
    const boxes = [];
    table.querySelectorAll(rowSel).forEach((tr) => {
      const cb = tr.querySelector(
        'input[type="checkbox"].lead-checkbox, input[type="checkbox"].row-checkbox',
      );
      if (cb) boxes.push(cb);
    });
    if (boxes.length) return boxes;
    return Array.from(
      table.querySelectorAll(
        'tbody tr.result-row input[type="checkbox"].lead-checkbox, tbody tr.result-row input[type="checkbox"].row-checkbox',
      ),
    ).filter((cb) => {
      const tr = cb.closest('tr');
      return tr && !tr.classList.contains('pipeline-row-page-hidden');
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

  /** Populate folder dropdown from bootstrap data — works before app.js finishes init. */
  function rebuildBulkFolderSelectEarly(preferredValue) {
    if (typeof window.__rebuildBulkFolderSelect === 'function') {
      window.__rebuildBulkFolderSelect(preferredValue);
      return;
    }
    const selectEl = document.getElementById('bulkFolderSelect');
    if (!selectEl) return;
    if (!Array.isArray(window.WORKSPACE_FOLDERS)) window.WORKSPACE_FOLDERS = [];
    if (!window.WORKSPACE_FOLDERS.length) {
      selectEl.querySelectorAll('option').forEach(function (opt) {
        const key = String(opt.value || '').trim();
        if (!key) return;
        window.WORKSPACE_FOLDERS.push({
          key: key,
          name: String(opt.textContent || '').trim() || 'Folder',
        });
      });
    }
    const folders = window.WORKSPACE_FOLDERS.slice().sort(function (a, b) {
      return String(a.name || '').localeCompare(String(b.name || ''), undefined, {
        sensitivity: 'base',
      });
    });
    const prev =
      preferredValue !== undefined && preferredValue !== null
        ? String(preferredValue)
        : selectEl.value;
    selectEl.innerHTML = '';
    const emptyOpt = document.createElement('option');
    emptyOpt.value = '';
    emptyOpt.textContent = 'No folder';
    selectEl.appendChild(emptyOpt);
    folders.forEach(function (f) {
      if (!f || !f.key) return;
      const opt = document.createElement('option');
      opt.value = f.key;
      opt.textContent = f.name || 'Folder';
      selectEl.appendChild(opt);
    });
    const valid = prev && Array.from(selectEl.options).some(function (o) {
      return o.value === prev;
    });
    selectEl.value = valid ? prev : '';
  }

  function refreshBulkFolderSelectEarly(preferredValue) {
    if (typeof window.__refreshBulkFolderSelectOptions === 'function') {
      return window.__refreshBulkFolderSelectOptions(preferredValue);
    }
    rebuildBulkFolderSelectEarly(preferredValue);
    return Promise.resolve();
  }

  /** Show/hide floating bulk bar (Focus, export, tags, etc.) — does not depend on app.js init order. */
  let _bulkBarVisibleForFolderRefresh = false;

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
      if (bar.dataset.bulkMode !== 'search') {
        ['bulkFocusModeBtn', 'bulkDirectMailBtn', 'bulkPushGhlBtn'].forEach((id) => {
          const el = document.getElementById(id);
          if (!el) return;
          el.classList.remove('hidden', 'opacity-40', 'cursor-not-allowed');
          el.setAttribute('aria-disabled', 'false');
        });
      }
      if (!_bulkBarVisibleForFolderRefresh) {
        refreshBulkFolderSelectEarly().catch(function () {
          rebuildBulkFolderSelectEarly();
        });
      }
    } else {
      _bulkBarVisibleForFolderRefresh = false;
      bar.classList.add('opacity-0', 'translate-y-16', 'pointer-events-none');
      bar.classList.remove('opacity-100', 'translate-y-0');
      bar.style.removeProperty('opacity');
      bar.style.removeProperty('visibility');
      bar.style.removeProperty('transform');
      bar.style.pointerEvents = 'none';
    }
    _bulkBarVisibleForFolderRefresh = visible;
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

  function normalizeFocusLeadKey(key) {
    return String(key || '').trim().replace(/^lead:/i, '');
  }

  function leadKeyFromCheckboxOrRow(cb) {
    let key = String(cb.getAttribute('data-key') || cb.dataset.key || '').trim();
    if (!key) {
      const row = cb.closest('tr.result-row, tr[data-lead-key]');
      key = row ? String(row.getAttribute('data-lead-key') || row.dataset.leadKey || '').trim() : '';
    }
    return key;
  }

  function collectSelectedLeadKeysFromDom() {
    const out = [];
    const seen = new Set();
    document
      .querySelectorAll(
        'tbody input.lead-checkbox:checked, tbody input.row-checkbox:checked, input.lead-checkbox:checked, input.row-checkbox:checked',
      )
      .forEach((cb) => {
        const key = leadKeyFromCheckboxOrRow(cb);
        if (!key || seen.has(key)) return;
        seen.add(key);
        out.push(key);
      });
    return out;
  }

  function collectSelectedLeadKeysEarly() {
    const out = [];
    const seen = new Set();
    const add = (raw) => {
      const k = String(raw || '').trim();
      if (!k || seen.has(k)) return;
      seen.add(k);
      out.push(k);
    };
    if (typeof window.__getSelectedLeadKeysForBulk === 'function') {
      window.__getSelectedLeadKeysForBulk().forEach(add);
    }
    if (typeof window.__ensureBulkSelectionKeys === 'function') {
      window.__ensureBulkSelectionKeys().forEach(add);
    }
    collectSelectedLeadKeysFromDom().forEach(add);
    return out;
  }

  function collectFocusSelectionKeys() {
    return collectSelectedLeadKeysEarly().map(normalizeFocusLeadKey).filter(Boolean);
  }

  function persistFocusSelectionKeys(keys) {
    try {
      const norm = (keys || []).map(normalizeFocusLeadKey).filter(Boolean);
      if (norm.length) {
        sessionStorage.setItem('adhello_focus_selected_keys', JSON.stringify(norm));
      } else {
        sessionStorage.removeItem('adhello_focus_selected_keys');
      }
    } catch (_) {
      /* ignore */
    }
  }

  function buildFocusSelectionUrl(keys, channel) {
    const norm = (keys || []).map(normalizeFocusLeadKey).filter(Boolean);
    const ch = String(channel || '').trim().toLowerCase();
    let url = '/focus';
    const params = new URLSearchParams();
    if (norm.length) {
      params.set('lead', norm[0]);
      params.set('keys', norm.join(','));
    }
    if (ch) params.set('channel', ch);
    const qs = params.toString();
    return qs ? `${url}?${qs}` : url;
  }

  function persistDirectMailSelectionKeys(keys) {
    try {
      const norm = (keys || []).map(normalizeFocusLeadKey).filter(Boolean);
      if (norm.length) {
        sessionStorage.setItem('adhello_dm_selected_keys', JSON.stringify(norm));
      } else {
        sessionStorage.removeItem('adhello_dm_selected_keys');
      }
    } catch (_) {
      /* ignore */
    }
  }

  function buildDirectMailSelectionUrl(keys) {
    const norm = (keys || []).map(normalizeFocusLeadKey).filter(Boolean);
    if (!norm.length) return '/direct-mail';
    return `/direct-mail?keys=${encodeURIComponent(norm.join(','))}`;
  }

  window.__normalizeFocusLeadKey = normalizeFocusLeadKey;
  window.__collectSelectedLeadKeysEarly = collectSelectedLeadKeysEarly;
  window.__collectFocusSelectionKeys = collectFocusSelectionKeys;
  window.__persistFocusSelectionKeys = persistFocusSelectionKeys;
  window.__buildFocusSelectionUrl = buildFocusSelectionUrl;
  window.__persistDirectMailSelectionKeys = persistDirectMailSelectionKeys;
  window.__buildDirectMailSelectionUrl = buildDirectMailSelectionUrl;

  /** GHL bulk push — one contact per request so progress updates; survives page changes via bell queue. */
  async function pushLeadKeysToGhlWithProgress(opts) {
    const leadKeys = Array.isArray(opts && opts.leadKeys)
      ? opts.leadKeys.map((k) => String(k || '').trim()).filter(Boolean)
      : [];
    const tagNoWebsite = !(opts && opts.tagNoWebsite === false);
    const btn = opts && opts.btn ? opts.btn : null;
    const onProgress =
      opts && typeof opts.onProgress === 'function' ? opts.onProgress : null;
    const total = leadKeys.length;
    if (!total) return { ok: true, pushed: 0, failed: 0, total: 0, results: [] };

    if (typeof window.agencyOsGhlSync === 'object' && typeof window.agencyOsGhlSync.run === 'function') {
      if (onProgress) onProgress({ current: 0, total, remaining: total, pushed: 0, failed: 0 });
      if (btn) btn.textContent = total > 1 ? `${total} left` : 'Syncing…';
      const result = await window.agencyOsGhlSync.run({
        leadKeys,
        tagNoWebsite,
        onProgress: function (progress) {
          if (onProgress) onProgress(progress);
          if (btn && progress && progress.remaining != null) {
            btn.textContent = progress.remaining > 0 ? `${progress.remaining} left` : 'Finishing…';
          }
        },
      });
      if (btn) btn.textContent = result.failed > 0 ? 'Failed' : 'Finishing…';
      return result;
    }

    if (onProgress) onProgress({ current: 0, total, remaining: total, pushed: 0, failed: 0 });
    if (btn) btn.textContent = total > 1 ? `${total} left` : 'Syncing…';

    let pushed = 0;
    let failed = 0;
    const results = [];
    for (let i = 0; i < leadKeys.length; i += 1) {
      const key = leadKeys[i];
      if (onProgress) {
        onProgress({
          current: i,
          total,
          remaining: total - i,
          pushed,
          failed,
        });
      }
      if (btn) btn.textContent = total - i > 1 ? `${total - i} left` : 'Syncing…';
      try {
        // eslint-disable-next-line no-await-in-loop
        const res = await fetch('/ghl/push', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ leadKeys: [key], tagNoWebsite }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
          throw new Error((data && data.error) || `HTTP ${res.status}`);
        }
        const batchPushed = data.pushed != null ? data.pushed : 0;
        const batchFailed = data.failed != null ? data.failed : 0;
        pushed += batchPushed;
        failed += batchFailed > 0 ? batchFailed : batchPushed > 0 ? 0 : 1;
        if (Array.isArray(data.results)) results.push(...data.results);
      } catch (err) {
        failed += 1;
        results.push({ key, ok: false, error: err.message || String(err) });
      }
    }
    if (onProgress) {
      onProgress({ current: total, total, remaining: 0, pushed, failed });
    }
    if (btn) btn.textContent = failed > 0 ? 'Failed' : 'Finishing…';
    return { ok: failed === 0, pushed, failed, total, results };
  }
  window.__pushLeadKeysToGhlWithProgress = pushLeadKeysToGhlWithProgress;

  /** Last row index used for shift-click range selection (per table). */
  let lastBulkSelectAnchor = null;

  function resetBulkSelectAnchor() {
    lastBulkSelectAnchor = null;
  }
  window.__resetBulkSelectAnchor = resetBulkSelectAnchor;

  function isBulkSelectRowTarget(target) {
    if (!target || !target.closest) return false;
    if (target.closest('input, button, a, select, textarea, label, form')) return false;
    if (
      target.closest('.bookmark-btn') ||
      target.closest('.view-detail-btn') ||
      target.closest('.ai-analysis-btn') ||
      target.closest('.lead-category-input') ||
      target.closest('.plc-col-resize') ||
      target.closest('.js-pipeline-columns-wrap')
    ) {
      return false;
    }
    return true;
  }

  function getCheckboxIndex(table, checkboxOrRow) {
    const boxes = getPageCheckboxes(table);
    if (!boxes.length) return -1;
    let cb = null;
    if (checkboxOrRow && checkboxOrRow.matches && checkboxOrRow.matches('input.lead-checkbox, input.row-checkbox')) {
      cb = checkboxOrRow;
    } else if (checkboxOrRow && checkboxOrRow.closest) {
      cb = checkboxOrRow.querySelector('input.lead-checkbox, input.row-checkbox');
    }
    if (!cb) return -1;
    return boxes.indexOf(cb);
  }

  function setCheckboxChecked(cb, checked) {
    if (!cb) return;
    cb.checked = checked;
    if (checked) cb.setAttribute('checked', 'checked');
    else cb.removeAttribute('checked');
    const tr = cb.closest('tr');
    if (tr) {
      tr.classList.toggle('bulk-selected', checked);
      tr.setAttribute('aria-selected', checked ? 'true' : 'false');
    }
  }

  function notifyCheckboxChanged(cb) {
    if (!cb) return;
    try {
      cb.dispatchEvent(new Event('input', { bubbles: true }));
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (_) {
      /* ignore */
    }
  }

  function syncTableRowHighlights(table) {
    if (!table) return;
    table.querySelectorAll('tbody tr.result-row:not(.pipeline-row-page-hidden)').forEach((tr) => {
      const cb = tr.querySelector('input.lead-checkbox, input.row-checkbox');
      const on = !!(cb && cb.checked);
      tr.classList.toggle('bulk-selected', on);
      tr.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  function syncSelectAllHeaderForTable(table) {
    if (!table) return;
    const header = table.querySelector('thead input[data-select-all-leads]');
    if (!header) return;
    const boxes = getPageCheckboxes(table);
    if (!boxes.length) {
      header.checked = false;
      header.indeterminate = false;
      return;
    }
    const checkedCount = boxes.filter((cb) => cb.checked).length;
    header.checked = checkedCount > 0 && checkedCount === boxes.length;
    header.indeterminate = checkedCount > 0 && checkedCount < boxes.length;
  }

  function applyBulkRangeSelection(table, fromIndex, toIndex, checked) {
    window.__bulkSelectRangeSync = true;
    try {
      const boxes = getPageCheckboxes(table);
      const start = Math.min(fromIndex, toIndex);
      const end = Math.max(fromIndex, toIndex);
      let lastChanged = null;
      for (let i = start; i <= end; i += 1) {
        if (boxes[i]) {
          setCheckboxChecked(boxes[i], checked);
          lastChanged = boxes[i];
        }
      }
      syncTableRowHighlights(table);
      syncSelectAllHeaderForTable(table);
      if (lastChanged) notifyCheckboxChanged(lastChanged);
      syncBulkBarFromDom();
    } finally {
      window.__bulkSelectRangeSync = false;
    }
  }

  function handleShiftBulkSelect(table, targetIndex) {
    if (targetIndex < 0) return;
    if (
      lastBulkSelectAnchor &&
      lastBulkSelectAnchor.table === table &&
      lastBulkSelectAnchor.index >= 0
    ) {
      applyBulkRangeSelection(table, lastBulkSelectAnchor.index, targetIndex, true);
    } else {
      window.__bulkSelectRangeSync = true;
      try {
        const boxes = getPageCheckboxes(table);
        if (boxes[targetIndex]) {
          setCheckboxChecked(boxes[targetIndex], true);
          notifyCheckboxChanged(boxes[targetIndex]);
        }
        syncTableRowHighlights(table);
        syncSelectAllHeaderForTable(table);
        syncBulkBarFromDom();
      } finally {
        window.__bulkSelectRangeSync = false;
      }
    }
    lastBulkSelectAnchor = { table: table, index: targetIndex };
  }

  function bindShiftClickRangeSelection() {
    if (window.__BULK_SHIFT_SELECT_BOUND === '1') return;
    window.__BULK_SHIFT_SELECT_BOUND = '1';

    document.addEventListener(
      'mousedown',
      (e) => {
        if (!e.shiftKey) return;
        const cb =
          e.target && e.target.closest
            ? e.target.closest('input.lead-checkbox, input.row-checkbox')
            : null;
        if (cb) {
          const table = cb.closest('table');
          if (!table) return;
          e.preventDefault();
          e.stopPropagation();
          handleShiftBulkSelect(table, getCheckboxIndex(table, cb));
          return;
        }
        const row =
          e.target && e.target.closest
            ? e.target.closest('tr.result-row:not(.pipeline-row-page-hidden)')
            : null;
        if (!row || !isBulkSelectRowTarget(e.target)) return;
        const table = row.closest('table');
        if (!table) return;
        e.preventDefault();
        e.stopPropagation();
        handleShiftBulkSelect(table, getCheckboxIndex(table, row));
      },
      true,
    );

    // Shift+mousedown selects the range; the subsequent click would toggle the target checkbox off.
    document.addEventListener(
      'click',
      (e) => {
        if (!e.shiftKey) return;
        const cb =
          e.target && e.target.closest
            ? e.target.closest('input.lead-checkbox, input.row-checkbox')
            : null;
        if (cb) {
          e.preventDefault();
          e.stopPropagation();
          const table = cb.closest('table');
          if (table) syncTableRowHighlights(table);
          return;
        }
        const row =
          e.target && e.target.closest
            ? e.target.closest('tr.result-row:not(.pipeline-row-page-hidden)')
            : null;
        if (!row || !isBulkSelectRowTarget(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
      },
      true,
    );

    document.addEventListener(
      'click',
      (e) => {
        if (e.shiftKey) return;
        const cb =
          e.target && e.target.closest
            ? e.target.closest('input.lead-checkbox, input.row-checkbox')
            : null;
        if (!cb) return;
        const table = cb.closest('table');
        if (!table) return;
        const idx = getCheckboxIndex(table, cb);
        if (idx >= 0) lastBulkSelectAnchor = { table: table, index: idx };
      },
      true,
    );
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

    table.querySelectorAll('tbody tr.result-row:not(.pipeline-row-page-hidden)').forEach((tr) => {
      const cb = tr.querySelector('input.lead-checkbox, input.row-checkbox');
      const on = !!(cb && cb.checked);
      tr.classList.toggle('bulk-selected', on);
      tr.setAttribute('aria-selected', on ? 'true' : 'false');
    });

    syncBulkBarFromDom();
    if (!checked) resetBulkSelectAnchor();
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
    rebuildBulkFolderSelectEarly(
      typeof window.PROSPECTING_ACTIVE_FOLDER_KEY === 'string' && window.PROSPECTING_ACTIVE_FOLDER_KEY.trim()
        ? window.PROSPECTING_ACTIVE_FOLDER_KEY.trim()
        : typeof window.SEARCH_TARGET_FOLDER_KEY === 'string' && window.SEARCH_TARGET_FOLDER_KEY.trim()
          ? window.SEARCH_TARGET_FOLDER_KEY.trim()
          : undefined,
    );
    const folderSelect = document.getElementById('bulkFolderSelect');
    if (folderSelect) {
      folderSelect.addEventListener('focus', function () {
        refreshBulkFolderSelectEarly(folderSelect.value).catch(function () {
          rebuildBulkFolderSelectEarly(folderSelect.value);
        });
      });
    }
    bindBulkBarCaptureActions();
    bindShiftClickRangeSelection();
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

  function appendFolderToPageSelects(folder) {
    if (!folder || !folder.key) return;
    document.querySelectorAll('select[name="folderKey"]').forEach(function (sel) {
      const exists = Array.from(sel.options).some(function (o) {
        return o.value === folder.key;
      });
      if (exists) return;
      const opt = document.createElement('option');
      opt.value = folder.key;
      opt.textContent = folder.name || 'Folder';
      sel.appendChild(opt);
    });
  }

  /** Create folder from bulk bar — available before app.js finishes loading. */
  async function bulkFolderSaveFromBar() {
    const nameInput = document.getElementById('bulkFolderNewName');
    const saveBtn = document.getElementById('bulkFolderNewSave');
    const name = nameInput ? String(nameInput.value || '').trim() : '';
    if (!name) {
      window.alert('Enter a folder name.');
      return;
    }
    if (saveBtn) saveBtn.disabled = true;
    try {
      const res = await fetch('/folders', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ name: name }),
      });
      const data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data.success || !data.folder || !data.folder.key) {
        throw new Error((data && data.error) || 'HTTP ' + res.status);
      }
      const folder = data.folder;
      const key = folder.key;
      const folderName = folder.name || name;
      if (!Array.isArray(window.WORKSPACE_FOLDERS)) window.WORKSPACE_FOLDERS = [];
      const existing = window.WORKSPACE_FOLDERS.find(function (f) {
        return f && f.key === key;
      });
      if (existing) {
        existing.name = folderName;
      } else {
        window.WORKSPACE_FOLDERS.push({ key: key, name: folderName });
      }
      rebuildBulkFolderSelectEarly(key);
      appendFolderToPageSelects({ key: key, name: folderName });
      if (typeof window.__setBulkFolderNewRowVisible === 'function') {
        window.__setBulkFolderNewRowVisible(false);
      } else {
        toggleBulkFolderNewRow();
      }
      if (typeof window.showProspectToast === 'function') {
        window.showProspectToast('Folder created');
      }
    } catch (err) {
      console.error('[pipeline-bulk-select] create folder failed:', err);
      window.alert((err && err.message) || 'Could not create folder.');
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  }
  window.__bulkFolderSaveFromBar = bulkFolderSaveFromBar;

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

  function collectBulkDeleteTargets() {
    const targets = [];
    const seen = new Set();
    document
      .querySelectorAll(
        '#prospectLeadsTable tbody input.lead-checkbox:checked, #prospectLeadsTable tbody input.row-checkbox:checked, tbody input.lead-checkbox:checked, tbody input.row-checkbox:checked',
      )
      .forEach((cb) => {
        const row = cb.closest('tr.result-row');
        if (!row) return;
        let key = String(
          row.getAttribute('data-lead-key') ||
            row.dataset.leadKey ||
            cb.getAttribute('data-key') ||
            cb.dataset.key ||
            '',
        ).trim();
        if (!key || seen.has(key)) return;
        seen.add(key);
        targets.push({ row, key });
      });
    return targets;
  }

  let bulkDeleteInFlight = false;

  async function bulkDeleteSelectedLeads() {
    if (bulkDeleteInFlight) return;
    const targets = collectBulkDeleteTargets();
    if (!targets.length) return;
    const n = targets.length;
    const msg = 'Delete ' + n + ' selected lead' + (n === 1 ? '' : 's') + '? This cannot be undone.';
    if (!window.confirm(msg)) return;

    bulkDeleteInFlight = true;
    const deleteBtn = document.getElementById('bulkDeleteBtn');
    if (deleteBtn) deleteBtn.disabled = true;

    let deleted = 0;
    let errorMsg = '';
    const closePanel = document.getElementById('closeMobilePanel');

    try {
      const res = await fetch('/leads/bulk-delete', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ keys: targets.map((t) => t.key) }),
      });
      const data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data.success) {
        errorMsg =
          (data && data.error) ||
          (data && data.errors && data.errors[0] && data.errors[0].error) ||
          'Delete failed (' + res.status + ').';
      } else {
        deleted = Number(data.deleted) || 0;
        if (deleted > 0) {
          const deletedSet = new Set(
            (Array.isArray(data.deletedKeys) ? data.deletedKeys : targets.map((t) => t.key)).map(
              function (k) {
                return String(k || '').trim();
              },
            ),
          );
          targets.forEach(function (target) {
            if (!target.row || !target.row.isConnected) return;
            if (!deletedSet.has(target.key)) return;
            if (target.row.classList.contains('selected') && closePanel) closePanel.click();
            target.row.remove();
          });
        }
        if (data.failed && !deleted) {
          errorMsg = 'Could not delete selected leads.';
        }
      }
    } catch (err) {
      console.error('[pipeline-bulk-select] bulk delete failed', err);
      errorMsg = (err && err.message) || 'Delete failed.';
    } finally {
      bulkDeleteInFlight = false;
      if (deleteBtn) deleteBtn.disabled = false;
    }

    const selectAllHeader = document.querySelector('#prospectLeadsTable thead input[data-select-all-leads]');
    if (selectAllHeader) {
      selectAllHeader.checked = false;
      selectAllHeader.indeterminate = false;
    }
    if (typeof window.__resetBulkSelectAnchor === 'function') window.__resetBulkSelectAnchor();
    showBulkActionBar(0);
    if (typeof window.__updateBulkActionBar === 'function') window.__updateBulkActionBar();
    if (typeof window.__pipelineTablePagingApply === 'function') window.__pipelineTablePagingApply();
    if (typeof window.showProspectToast === 'function') {
      window.showProspectToast(
        deleted
          ? 'Deleted ' + deleted + ' lead' + (deleted === 1 ? '' : 's')
          : errorMsg || 'Could not delete selected leads',
      );
    } else if (errorMsg && !deleted) {
      window.alert(errorMsg);
    }
    const remaining = document.querySelectorAll('#prospectLeadsTable tbody tr.result-row').length;
    if (remaining === 0) window.location.reload();
  }
  window.__bulkDeleteSelectedLeads = bulkDeleteSelectedLeads;

  function mountSmsModalToBodyEarly() {
    const modal = document.getElementById('smsScriptModal');
    if (modal && modal.parentElement !== document.body) {
      document.body.appendChild(modal);
    }
  }

  function showBulkBarFeedbackEarly(message, variant) {
    const msg = String(message || '').trim();
    if (!msg) return;
    if (typeof window.showBulkActionConfirmation === 'function') {
      window.showBulkActionConfirmation(msg, variant || 'info');
      return;
    }
    const el = document.getElementById('bulkSaveFeedback');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden', 'text-emerald-300', 'text-rose-300', 'text-white/80', 'text-sky-200');
    if (variant === 'error') el.classList.add('text-rose-300');
    else if (variant === 'success') el.classList.add('text-emerald-300');
    else if (variant === 'loading') el.classList.add('text-white/80');
    else el.classList.add('text-sky-200');
  }

  function collectPhoneLeadKeysEarly() {
    const keys = [];
    const seen = new Set();
    document
      .querySelectorAll(
        'tbody input.lead-checkbox:checked, tbody input.row-checkbox:checked, input.lead-checkbox:checked, input.row-checkbox:checked',
      )
      .forEach(function (cb) {
        const row = cb.closest('tr.result-row, tr[data-lead-key]');
        if (!row) return;
        const phone = String(row.getAttribute('data-phone') || row.dataset.phone || '').trim();
        if (!phone || phone === 'N/A' || !/\d/.test(phone)) return;
        let key = String(row.getAttribute('data-lead-key') || row.dataset.leadKey || '').trim();
        if (!key) key = String(cb.getAttribute('data-key') || cb.dataset.key || '').trim();
        if (!key || seen.has(key)) return;
        seen.add(key);
        keys.push(key);
      });
    return keys;
  }

  function countNoWebsiteSelectedEarly() {
    let count = 0;
    document
      .querySelectorAll(
        'tbody input.lead-checkbox:checked, tbody input.row-checkbox:checked, input.lead-checkbox:checked, input.row-checkbox:checked',
      )
      .forEach(function (cb) {
        const row = cb.closest('tr.result-row, tr[data-lead-key]');
        if (!row) return;
        const w = String(row.getAttribute('data-website') || row.dataset.website || '').trim();
        if (!(w && w !== 'N/A' && w !== '—')) count += 1;
      });
    return count;
  }

  async function waitForBulkSmsHandler(maxMs) {
    const limit = typeof maxMs === 'number' ? maxMs : 8000;
    const step = 100;
    for (let elapsed = 0; elapsed < limit; elapsed += step) {
      if (typeof window.__openBulkSmsFromBar === 'function') return window.__openBulkSmsFromBar;
      if (typeof window.__openBulkSmsModal === 'function') return window.__openBulkSmsModal;
      // eslint-disable-next-line no-await-in-loop
      await new Promise(function (resolve) {
        window.setTimeout(resolve, step);
      });
    }
    return null;
  }

  async function runBulkSmsFromBarEarly() {
    mountSmsModalToBodyEarly();
    const btn = document.getElementById('bulkSmsBtn');
    const phoneKeys = collectPhoneLeadKeysEarly();
    if (!phoneKeys.length) {
      showBulkBarFeedbackEarly('Selected leads have no phone numbers for SMS.', 'error');
      return;
    }
    showBulkBarFeedbackEarly(
      `Opening SMS composer for ${phoneKeys.length} lead${phoneKeys.length === 1 ? '' : 's'}…`,
      'info',
    );
    if (typeof window.__flashBulkBarBtn === 'function') {
      window.__flashBulkBarBtn(btn, 'Opening…', 900);
    }
    if (typeof window.__openBulkSmsFromBar === 'function') {
      await window.__openBulkSmsFromBar();
      return;
    }
    if (typeof window.__openBulkSmsModal === 'function') {
      const result = await window.__openBulkSmsModal(phoneKeys);
      if (result && result.ok) {
        showBulkBarFeedbackEarly(
          `SMS ready — personalize and send via GHL (${phoneKeys.length} lead${phoneKeys.length === 1 ? '' : 's'}).`,
          'success',
        );
        if (typeof window.__flashBulkBarBtn === 'function') window.__flashBulkBarBtn(btn, '✓ Opened');
      } else {
        showBulkBarFeedbackEarly((result && result.message) || 'Could not open SMS composer.', 'error');
      }
      return;
    }
    showBulkBarFeedbackEarly('Loading SMS composer…', 'loading');
    const handler = await waitForBulkSmsHandler(8000);
    if (typeof handler === 'function') {
      if (handler === window.__openBulkSmsFromBar) {
        await window.__openBulkSmsFromBar();
      } else {
        const result = await window.__openBulkSmsModal(phoneKeys);
        if (result && result.ok) {
          showBulkBarFeedbackEarly(
            `SMS ready — personalize and send via GHL (${phoneKeys.length} lead${phoneKeys.length === 1 ? '' : 's'}).`,
            'success',
          );
          if (typeof window.__flashBulkBarBtn === 'function') window.__flashBulkBarBtn(btn, '✓ Opened');
        } else {
          showBulkBarFeedbackEarly((result && result.message) || 'Could not open SMS composer.', 'error');
        }
      }
      return;
    }
    showBulkBarFeedbackEarly('SMS composer failed to load. Hard-refresh the page and try again.', 'error');
  }
  window.__runBulkSmsFromBarEarly = runBulkSmsFromBarEarly;

  async function waitForBulkPushGhlHandler(maxMs) {
    const limit = typeof maxMs === 'number' ? maxMs : 8000;
    const step = 100;
    for (let elapsed = 0; elapsed < limit; elapsed += step) {
      if (typeof window.__openBulkPushGhlFromBar === 'function') return window.__openBulkPushGhlFromBar;
      if (typeof window.__pushLeadKeysToGhlWithProgress === 'function') {
        return window.__pushLeadKeysToGhlWithProgress;
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise(function (resolve) {
        window.setTimeout(resolve, step);
      });
    }
    return null;
  }

  function setBulkGhlProgressEarly(progress) {
    const el = document.getElementById('bulkSaveFeedback');
    const done = progress && progress.current != null ? progress.current : 0;
    const total = progress && progress.total != null ? progress.total : 0;
    const remaining =
      progress && progress.remaining != null ? progress.remaining : Math.max(0, total - done);
    const msg = `Syncing ${done} of ${total} · ${remaining} left`;
    if (el) {
      el.textContent = msg;
      el.classList.remove('hidden', 'text-emerald-300', 'text-rose-300', 'text-sky-200');
      el.classList.add('text-white/80');
    }
  }

  async function runBulkPushGhlFromBarEarly() {
    if (window.__bulkPushGhlInFlight) return { ok: false, error: 'in_flight' };
    if (typeof window.__openBulkPushGhlFromBar === 'function') {
      return window.__openBulkPushGhlFromBar();
    }

    const btn = document.getElementById('bulkPushGhlBtn');
    const leadKeys = collectSelectedLeadKeysEarly();
    if (!leadKeys.length) {
      showBulkBarFeedbackEarly('Select at least one lead.', 'error');
      return { ok: false, error: 'no_selection' };
    }
    const noWebsiteCount = countNoWebsiteSelectedEarly();
    const labelDefault = 'Sync GHL';
    const prev = btn ? String(btn.textContent || '').trim() || labelDefault : labelDefault;
    window.__bulkPushGhlInFlight = true;
    if (btn) {
      btn.disabled = true;
      btn.textContent = `${leadKeys.length} left`;
      btn.setAttribute('aria-busy', 'true');
      btn.classList.add('is-busy');
    }
    setBulkGhlProgressEarly({ current: 0, total: leadKeys.length, remaining: leadKeys.length });

    let pushWithProgress = window.__pushLeadKeysToGhlWithProgress;
    if (typeof pushWithProgress !== 'function') {
      const handler = await waitForBulkPushGhlHandler(8000);
      if (typeof handler === 'function' && handler === window.__openBulkPushGhlFromBar) {
        window.__bulkPushGhlInFlight = false;
        return handler();
      }
      pushWithProgress =
        typeof handler === 'function' ? handler : window.__pushLeadKeysToGhlWithProgress;
    }

    try {
      if (typeof pushWithProgress !== 'function') {
        throw new Error('GHL sync handler failed to load. Hard-refresh and try again.');
      }
      const result = await pushWithProgress({
        leadKeys: leadKeys,
        tagNoWebsite: true,
        btn: btn,
        onProgress: setBulkGhlProgressEarly,
      });
      const taggedNote = noWebsiteCount > 0 ? ` · ${noWebsiteCount} tagged no website` : '';
      const msg = `GHL sync complete · ${result.pushed} contact${result.pushed === 1 ? '' : 's'}${taggedNote}${result.failed ? ` · ${result.failed} failed` : ''}`;
      showBulkBarFeedbackEarly(msg, result.failed === 0 ? 'success' : 'error');
      if (typeof window.__flashBulkBarBtn === 'function') {
        window.__flashBulkBarBtn(btn, result.failed === 0 ? '✓ Synced' : 'Failed');
      }
      const link = document.getElementById('bulkOpenGhlContactsLink');
      if (link && result.pushed > 0) link.classList.remove('hidden');
      return { ok: result.failed === 0, pushed: result.pushed, failed: result.failed };
    } catch (err) {
      const msg = err && err.message ? err.message : 'GHL sync failed';
      showBulkBarFeedbackEarly(msg, 'error');
      if (typeof window.__flashBulkBarBtn === 'function') {
        window.__flashBulkBarBtn(btn, 'Failed', 1200);
      }
      return { ok: false, error: msg };
    } finally {
      window.__bulkPushGhlInFlight = false;
      if (btn) {
        btn.disabled = false;
        btn.removeAttribute('aria-busy');
        btn.classList.remove('is-busy');
        if (!btn.__flashTimer) btn.textContent = prev;
      }
      if (typeof window.__syncBulkBarFromDom === 'function') window.__syncBulkBarFromDom();
      else if (typeof window.__updateBulkActionBar === 'function') window.__updateBulkActionBar();
    }
  }
  window.__runBulkPushGhlFromBarEarly = runBulkPushGhlFromBarEarly;

  async function runBulkGhlEmailFromBarEarly() {
    if (typeof window.__openBulkGhlEmailFromBar === 'function') {
      return window.__openBulkGhlEmailFromBar();
    }
    const btn = document.getElementById('bulkGhlNoWebsiteBtn');
    const leadKeys = collectSelectedLeadKeysEarly();
    if (!leadKeys.length) {
      showBulkBarFeedbackEarly('Select at least one lead.', 'error');
      return;
    }
    const noWebsiteCount = countNoWebsiteSelectedEarly();
    const prev = btn ? String(btn.textContent || '').trim() : '';
    if (btn) {
      btn.textContent = 'Saving…';
      btn.setAttribute('aria-busy', 'true');
    }
    showBulkBarFeedbackEarly(`Saving ${leadKeys.length} lead${leadKeys.length === 1 ? '' : 's'} to GHL…`, 'loading');
    try {
      const res = await fetch('/ghl/push', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ leadKeys: leadKeys, tagNoWebsite: true }),
      });
      const data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data.success) {
        throw new Error((data && data.error) || `HTTP ${res.status}`);
      }
      const pushed = data.pushed != null ? data.pushed : 0;
      const failed = data.failed != null ? data.failed : 0;
      const taggedNote = noWebsiteCount > 0 ? ` · ${noWebsiteCount} tagged no website` : '';
      const msg = `GHL: ${pushed} saved for email${taggedNote}${failed ? ` · ${failed} failed` : ''}`;
      showBulkBarFeedbackEarly(msg, failed === 0 ? 'success' : 'error');
      if (typeof window.__flashBulkBarBtn === 'function') {
        window.__flashBulkBarBtn(btn, failed === 0 ? '✓ Saved' : 'Failed');
      }
      const link = document.getElementById('bulkOpenGhlContactsLink');
      if (link && pushed > 0) link.classList.remove('hidden');
    } catch (err) {
      const msg = err && err.message ? err.message : 'GHL save failed';
      showBulkBarFeedbackEarly(msg, 'error');
      if (typeof window.__flashBulkBarBtn === 'function') {
        window.__flashBulkBarBtn(btn, 'Failed', 1200);
      }
    } finally {
      if (btn) {
        btn.textContent = prev || 'Email (GHL)';
        btn.removeAttribute('aria-busy');
      }
      if (typeof window.__syncBulkBarFromDom === 'function') window.__syncBulkBarFromDom();
      else if (typeof window.__updateBulkActionBar === 'function') window.__updateBulkActionBar();
    }
  }
  window.__runBulkGhlEmailFromBarEarly = runBulkGhlEmailFromBarEarly;

  function collectDirectMailLeadKeysEarly() {
    const keys = collectSelectedLeadKeysEarly();
    if (keys.length) return keys;
    if (typeof window.__getSelectedLeadKeysForBulk === 'function') {
      return window.__getSelectedLeadKeysForBulk();
    }
    if (typeof window.__ensureBulkSelectionKeys === 'function') {
      return window.__ensureBulkSelectionKeys();
    }
    return collectSelectedLeadKeysFromDom();
  }

  function runBulkDirectMailFromBarEarly() {
    const mailBtn = document.getElementById('bulkDirectMailBtn');
    const keys = collectDirectMailLeadKeysEarly();
    if (!keys.length) {
      showBulkBarFeedbackEarly('Select at least one saved lead first.', 'error');
      return;
    }
    const n = keys.length;
    if (typeof window.showBulkActionConfirmation === 'function') {
      window.showBulkActionConfirmation(
        `Adding ${n} selected lead${n === 1 ? '' : 's'} to the Direct Mail folder…`,
        'info',
      );
    }
    if (typeof window.__flashBulkBarBtn === 'function') {
      window.__flashBulkBarBtn(mailBtn, 'Saving…', 700);
    }
    const finish = function (msg, ok) {
      if (typeof window.showBulkActionConfirmation === 'function') {
        window.showBulkActionConfirmation(msg, ok ? 'success' : 'error');
      }
      if (typeof window.showAppToast === 'function') {
        window.showAppToast(msg, { variant: ok ? 'success' : 'error' });
      }
      if (typeof window.__flashBulkBarBtn === 'function' && mailBtn) {
        window.__flashBulkBarBtn(mailBtn, ok ? 'Added ✓' : 'Failed', 900);
      }
    };
    if (typeof window.__addLeadsToDirectMailQueue === 'function') {
      window
        .__addLeadsToDirectMailQueue(keys)
        .then(function (data) {
          const added = data && data.added != null ? data.added : n;
          finish(
            `Added ${added} lead${added === 1 ? '' : 's'} to the Direct Mail folder.`,
            true,
          );
          if (typeof window.__persistDirectMailSelectionKeys === 'function') {
            window.__persistDirectMailSelectionKeys(
              typeof window.__directMailSessionKeys === 'function'
                ? window.__directMailSessionKeys()
                : keys,
            );
          }
          const folderKey = data && data.folderKey ? String(data.folderKey) : '';
          const folderLink = document.getElementById('bulkOpenGhlContactsLink');
          if (folderLink && folderKey) {
            const folderUrl =
              typeof window.__buildDirectMailFolderUrl === 'function'
                ? window.__buildDirectMailFolderUrl(folderKey)
                : `/prospecting?tab=pipeline&folderKey=${encodeURIComponent(folderKey)}`;
            folderLink.href = folderUrl;
            folderLink.textContent = 'Open Direct Mail folder →';
            folderLink.classList.remove('hidden');
          }
        })
        .catch(function (err) {
          finish((err && err.message) || 'Could not add leads to Direct Mail folder.', false);
        });
      return;
    }
    if (typeof window.__persistDirectMailSelectionKeys === 'function') {
      window.__persistDirectMailSelectionKeys(keys);
    }
    const href =
      typeof window.__buildDirectMailSelectionUrl === 'function'
        ? window.__buildDirectMailSelectionUrl(keys)
        : `/direct-mail?keys=${encodeURIComponent(keys.join(','))}`;
    finish('Opening Direct Mail…', true);
    window.setTimeout(function () {
      window.location.href = href;
    }, 120);
  }
  window.__runBulkDirectMailFromBarEarly = runBulkDirectMailFromBarEarly;

  function handleBulkPrimaryActionClick(e, action) {
    const now = Date.now();
    if (handleBulkPrimaryActionClick.__lastAt && now - handleBulkPrimaryActionClick.__lastAt < 450) return;
    handleBulkPrimaryActionClick.__lastAt = now;
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    if (action === 'sms') {
      runBulkSmsFromBarEarly();
      return;
    }
    if (action === 'email') {
      runBulkGhlEmailFromBarEarly();
    }
  }

  /**
   * Capture-phase clicks on the bulk bar — fixes Folder actions when bubble handlers
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
          bulkFolderSaveFromBar();
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
          return;
        }
        if (e.target.closest('#bulkDirectMailBtn')) {
          e.preventDefault();
          e.stopPropagation();
          runBulkDirectMailFromBarEarly();
          return;
        }
        if (e.target.closest('#bulkFocusModeBtn')) {
          e.preventDefault();
          e.stopPropagation();
          const keys = collectFocusSelectionKeys();
          if (!keys.length) return;
          persistFocusSelectionKeys(keys);
          const callBtn = document.getElementById('bulkFocusModeBtn');
          const n = keys.length;
          if (typeof window.showBulkActionConfirmation === 'function') {
            window.showBulkActionConfirmation(
              `Opening call queue for ${n} selected lead${n === 1 ? '' : 's'}…`,
              'info',
            );
          }
          if (typeof window.__flashBulkBarBtn === 'function') {
            window.__flashBulkBarBtn(callBtn, 'Opening…', 700);
          }
          const href = buildFocusSelectionUrl(keys, 'call');
          window.setTimeout(function () {
            window.location.href = href;
          }, 120);
          return;
        }
        if (e.target.closest('#bulkPushGhlBtn')) {
          e.preventDefault();
          e.stopPropagation();
          runBulkPushGhlFromBarEarly();
          return;
        }
        if (e.target.closest('#bulkSmsBtn')) {
          handleBulkPrimaryActionClick(e, 'sms');
          return;
        }
        if (e.target.closest('#bulkGhlNoWebsiteBtn')) {
          handleBulkPrimaryActionClick(e, 'email');
          return;
        }
        if (e.target.closest('#bulkDeleteBtn')) {
          e.preventDefault();
          e.stopPropagation();
          bulkDeleteSelectedLeads();
          return;
        }
      },
      true,
    );
    document.addEventListener(
      'pointerdown',
      (e) => {
        const bar = document.getElementById('bulkActionBar');
        if (!bar || bar.dataset.visible !== 'true') return;
        if (!e.target || !e.target.closest || !e.target.closest('#bulkActionBar')) return;
        if (e.target.closest('#bulkDirectMailBtn')) {
          e.preventDefault();
          e.stopPropagation();
          runBulkDirectMailFromBarEarly();
          return;
        }
        if (e.target.closest('#bulkSmsBtn')) {
          handleBulkPrimaryActionClick(e, 'sms');
          return;
        }
        if (e.target.closest('#bulkGhlNoWebsiteBtn')) {
          handleBulkPrimaryActionClick(e, 'email');
        }
      },
      true,
    );
    document.addEventListener(
      'keydown',
      function (e) {
        if (e.target && e.target.id === 'bulkFolderNewName') {
          if (e.key === 'Escape') {
            e.preventDefault();
            if (typeof window.__setBulkFolderNewRowVisible === 'function') {
              window.__setBulkFolderNewRowVisible(false);
            } else {
              toggleBulkFolderNewRow();
            }
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            bulkFolderSaveFromBar();
          }
          return;
        }
      },
      true,
    );
  }

  window.__PIPELINE_BULK_SELECT_V2 = '9';
  window.__pipelineBulkSelectApply = applySelectAll;
  window.__applySelectAllLeads = applySelectAll;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
