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
      ['bulkMoveFolderBtn', 'bulkAddToBoardBtn', 'bulkSaveBtn'].forEach(function (id) {
        const el = document.getElementById(id);
        if (el) el.disabled = false;
      });
      if (bar.dataset.bulkMode !== 'search') {
        ['bulkFocusModeBtn', 'bulkSmsBtn', 'bulkDirectMailBtn', 'bulkEmailBtn', 'bulkAutoOutreachBtn'].forEach((id) => {
          const el = document.getElementById(id);
          if (!el) return;
          el.classList.remove('hidden', 'opacity-40', 'cursor-not-allowed');
          el.setAttribute('aria-disabled', 'false');
        });
        const pushGhlBtn = document.getElementById('bulkPushGhlBtn');
        if (pushGhlBtn) {
          pushGhlBtn.classList.remove('hidden', 'opacity-40', 'cursor-not-allowed');
          pushGhlBtn.disabled = false;
          pushGhlBtn.setAttribute('aria-disabled', 'false');
        }
      }
      syncBulkBookmarkBtnState();
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
    if (typeof window.__syncBulkSelectionFromDom === 'function') {
      window.__syncBulkSelectionFromDom();
      return;
    }
    if (typeof window.__updateBulkActionBar === 'function') {
      window.__updateBulkActionBar();
    }
  }
  window.__syncBulkBarFromDom = syncBulkBarFromDom;

  let syncBulkBarRaf = 0;
  function scheduleSyncBulkBarFromDom() {
    if (syncBulkBarRaf) return;
    syncBulkBarRaf = requestAnimationFrame(function () {
      syncBulkBarRaf = 0;
      syncBulkBarFromDom();
    });
  }

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

  /** Resolve row checkbox from direct input, label, check cell, or row click target. */
  function resolveBulkCheckboxFromTarget(target) {
    if (!target || !target.closest) return null;
    const direct = target.closest('input.lead-checkbox, input.row-checkbox');
    if (direct) return direct;
    const label = target.closest('label');
    if (label) {
      const labelFor = label.getAttribute('for');
      if (labelFor) {
        const byId = document.getElementById(labelFor);
        if (byId && byId.matches('input.lead-checkbox, input.row-checkbox')) return byId;
      }
      const nested = label.querySelector('input.lead-checkbox, input.row-checkbox');
      if (nested) return nested;
    }
    const checkCell = target.closest('td[data-plc="check"]');
    if (checkCell) {
      const cellCb = checkCell.querySelector('input.lead-checkbox, input.row-checkbox');
      if (cellCb) return cellCb;
    }
    const row = target.closest('tr.result-row:not(.pipeline-row-page-hidden)');
    if (row) return row.querySelector('input.lead-checkbox, input.row-checkbox');
    return null;
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

  function bulkAnchorFromTarget(table, checkboxOrRow) {
    if (!table) return null;
    const idx = getCheckboxIndex(table, checkboxOrRow);
    if (idx < 0) return null;
    let cb = null;
    if (
      checkboxOrRow &&
      checkboxOrRow.matches &&
      checkboxOrRow.matches('input.lead-checkbox, input.row-checkbox')
    ) {
      cb = checkboxOrRow;
    } else if (checkboxOrRow && checkboxOrRow.querySelector) {
      cb = checkboxOrRow.querySelector('input.lead-checkbox, input.row-checkbox');
    }
    return {
      table: table,
      tableId: String(table.id || ''),
      index: idx,
      key: cb ? leadKeyFromCheckboxOrRow(cb) : '',
    };
  }

  function setBulkSelectAnchor(table, checkboxOrRow) {
    const next = bulkAnchorFromTarget(table, checkboxOrRow);
    if (next) lastBulkSelectAnchor = next;
  }

  function resolveBulkSelectAnchor(table) {
    if (!lastBulkSelectAnchor || !table) return null;
    if (lastBulkSelectAnchor.table === table) return lastBulkSelectAnchor;
    if (
      lastBulkSelectAnchor.tableId &&
      String(table.id || '') === lastBulkSelectAnchor.tableId
    ) {
      return lastBulkSelectAnchor;
    }
    return null;
  }

  function anchorIndexForTable(table, anchor) {
    if (!anchor || !table) return -1;
    const key = String(anchor.key || '').trim();
    if (key) {
      const boxes = getPageCheckboxes(table);
      for (let i = 0; i < boxes.length; i += 1) {
        if (leadKeyFromCheckboxOrRow(boxes[i]) === key) return i;
      }
    }
    if (anchor.index >= 0) return anchor.index;
    return -1;
  }

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
      for (let i = start; i <= end; i += 1) {
        if (boxes[i]) setCheckboxChecked(boxes[i], checked);
      }
      syncTableRowHighlights(table);
      syncSelectAllHeaderForTable(table);
      syncBulkBarFromDom();
    } finally {
      window.__bulkSelectRangeSync = false;
    }
  }

  function handleShiftBulkSelect(table, targetIndex, targetEl) {
    if (targetIndex < 0) return;
    const anchor = resolveBulkSelectAnchor(table);
    const anchorIndex = anchorIndexForTable(table, anchor);
    if (anchor && anchorIndex >= 0) {
      applyBulkRangeSelection(table, anchorIndex, targetIndex, true);
    } else {
      window.__bulkSelectRangeSync = true;
      try {
        const boxes = getPageCheckboxes(table);
        if (boxes[targetIndex]) setCheckboxChecked(boxes[targetIndex], true);
        syncTableRowHighlights(table);
        syncSelectAllHeaderForTable(table);
        syncBulkBarFromDom();
      } finally {
        window.__bulkSelectRangeSync = false;
      }
    }
    if (targetEl) setBulkSelectAnchor(table, targetEl);
    else {
      const boxes = getPageCheckboxes(table);
      if (boxes[targetIndex]) setBulkSelectAnchor(table, boxes[targetIndex]);
    }
  }

  function bindShiftClickRangeSelection() {
    if (window.__BULK_SHIFT_SELECT_BOUND === '1') return;
    window.__BULK_SHIFT_SELECT_BOUND = '1';

    document.addEventListener(
      'mousedown',
      (e) => {
        const cb = resolveBulkCheckboxFromTarget(e.target);
        const row =
          !cb && e.target && e.target.closest
            ? e.target.closest('tr.result-row:not(.pipeline-row-page-hidden)')
            : cb
              ? cb.closest('tr.result-row:not(.pipeline-row-page-hidden)')
              : null;
        const table = cb
          ? cb.closest('table')
          : row
            ? row.closest('table')
            : null;
        if (!table) return;

        if (e.shiftKey) {
          if (cb) {
            e.preventDefault();
            e.stopPropagation();
            handleShiftBulkSelect(table, getCheckboxIndex(table, cb), cb);
            return;
          }
          if (!row || !isBulkSelectRowTarget(e.target)) return;
          e.preventDefault();
          e.stopPropagation();
          handleShiftBulkSelect(table, getCheckboxIndex(table, row), row);
          return;
        }

        if (cb) {
          setBulkSelectAnchor(table, cb);
          return;
        }
        if (row && isBulkSelectRowTarget(e.target)) {
          setBulkSelectAnchor(table, row);
        }
      },
      true,
    );

    // Shift+mousedown selects the range; the subsequent click would toggle the target checkbox off.
    document.addEventListener(
      'click',
      (e) => {
        if (!e.shiftKey) return;
        const cb = resolveBulkCheckboxFromTarget(e.target);
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
      'change',
      (e) => {
        if (window.__bulkSelectRangeSync) return;
        if (e.shiftKey) return;
        const cb =
          e.target && e.target.matches
            ? e.target.matches('input.lead-checkbox, input.row-checkbox')
              ? e.target
              : null
            : null;
        if (!cb) return;
        const table = cb.closest('table');
        if (!table) return;
        setBulkSelectAnchor(table, cb);
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
      if (!window.__bulkSelectRangeSync) setBulkSelectAnchor(table, t);
      scheduleSyncBulkBarFromDom();
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
    bindBulkBoardButtonDirect();
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
        if (window.__bulkSelectRangeSync) return;
        scheduleSyncBulkBarFromDom();
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
        if (!cb || window.__bulkSelectRangeSync) return;
        scheduleSyncBulkBarFromDom();
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
  function buildBulkFolderCreatePayload(name) {
    var payload = { name: String(name || '').trim() };
    var activeKey = String(
      window.PROSPECTING_ACTIVE_FOLDER_KEY || window.SEARCH_TARGET_FOLDER_KEY || '',
    ).trim();
    if (!activeKey) return payload;
    payload.parentFolderKey = activeKey;
    var folders = Array.isArray(window.WORKSPACE_FOLDERS) ? window.WORKSPACE_FOLDERS : [];
    var activeFolder = folders.find(function (f) {
      return f && String(f.key) === activeKey;
    });
    if (activeFolder && activeFolder.jobType) {
      payload.jobType = String(activeFolder.jobType);
    } else if (typeof window.SEARCH_JOB_TYPE === 'string' && window.SEARCH_JOB_TYPE.trim()) {
      payload.jobType = window.SEARCH_JOB_TYPE.trim();
    } else if (window.PROSPECTING_BUSINESSES_VIEW) {
      payload.jobType = 'maps_business';
    }
    return payload;
  }

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
        body: JSON.stringify(buildBulkFolderCreatePayload(name)),
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
      const nextFolder = {
        key: key,
        name: folderName,
        jobType: folder.jobType || '',
        parentFolderKey: folder.parentFolderKey || '',
        isPipelineDefault: !!folder.isPipelineDefault,
        isTradeFolder: !!folder.isTradeFolder,
      };
      if (existing) {
        Object.assign(existing, nextFolder);
      } else {
        window.WORKSPACE_FOLDERS.push(nextFolder);
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

  let bulkMergeInFlight = false;

  function leadKeyNorm(key) {
    return String(key || '')
      .trim()
      .replace(/^lead:/i, '');
  }

  function leadTitleFromRow(row) {
    if (!row) return 'Lead';
    const fromData = String(row.getAttribute('data-title') || row.dataset.title || '').trim();
    if (fromData) return fromData;
    const titleEl = row.querySelector('[data-plc="company"] .company-title-text');
    if (titleEl) {
      const txt = String(titleEl.textContent || '').trim();
      if (txt) return txt;
    }
    return 'Lead';
  }

  function notifyMergeResult(message, variant) {
    const msg = String(message || '').trim();
    if (!msg) return;
    if (typeof window.showBulkActionConfirmation === 'function') {
      window.showBulkActionConfirmation(msg, variant || 'info');
    }
    if (typeof window.showProspectToast === 'function') {
      window.showProspectToast(msg);
    } else if (typeof window.showAppToast === 'function') {
      window.showAppToast(msg, { variant: variant === 'error' ? 'error' : variant === 'success' ? 'success' : 'info' });
    } else if (variant === 'error') {
      window.alert(msg);
    }
  }

  async function bulkMergeSelectedLeads() {
    if (bulkMergeInFlight) return;
    const targets = collectBulkDeleteTargets();
    if (targets.length < 2) {
      notifyMergeResult('Select at least two leads to merge.', 'error');
      return;
    }
    const primary = targets[0];
    const primaryTitle = leadTitleFromRow(primary.row);
    const n = targets.length;
    const otherLines = targets
      .slice(1)
      .map(function (t) {
        return '- ' + leadTitleFromRow(t.row);
      })
      .join('\n');
    const msg =
      'Merge ' +
      n +
      ' leads into:\n' +
      primaryTitle +
      '\n\nAlso combining:\n' +
      otherLines +
      '\n\nThe first selected row stays as the main record. Other rows will be removed. Continue?';
    if (!window.confirm(msg)) return;

    bulkMergeInFlight = true;
    const mergeBtn = document.getElementById('bulkMergeBtn');
    const mergeBtnHtml = mergeBtn ? mergeBtn.innerHTML : '';
    if (mergeBtn) {
      mergeBtn.disabled = true;
      mergeBtn.innerHTML = '<span class="text-[10px] font-black uppercase tracking-widest">Merging…</span>';
    }
    showBulkBarFeedbackEarly('Merging selected leads…', 'loading');

    let errorMsg = '';
    let mergedCount = 0;
    const closePanel = document.getElementById('closeMobilePanel');
    const primaryKeyNorm = leadKeyNorm(primary.key);

    try {
      const res = await fetch('/leads/bulk-merge', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          keys: targets.map(function (t) {
            return t.key;
          }),
          primaryKey: primary.key,
        }),
      });
      const data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data.success) {
        errorMsg = (data && data.error) || 'Merge failed (' + res.status + ').';
      } else {
        mergedCount = Number(data.mergedCount) || 0;
        const awayCount = Array.isArray(data.mergedAwayKeys) ? data.mergedAwayKeys.length : 0;
        if (mergedCount <= 0 && awayCount > 0) mergedCount = awayCount;
        if (mergedCount > 0 || awayCount > 0) {
          targets.forEach(function (target) {
            if (!target.row || !target.row.isConnected) return;
            if (leadKeyNorm(target.key) === primaryKeyNorm) return;
            if (target.row.classList.contains('selected') && closePanel) closePanel.click();
            target.row.remove();
          });
        } else {
          errorMsg = 'Merge completed but no leads were combined. Try refreshing and selecting again.';
        }
      }
    } catch (err) {
      console.error('[pipeline-bulk-select] bulk merge failed', err);
      errorMsg = (err && err.message) || 'Merge failed.';
    } finally {
      bulkMergeInFlight = false;
      if (mergeBtn) {
        mergeBtn.disabled = false;
        mergeBtn.innerHTML = mergeBtnHtml || mergeBtn.innerHTML;
      }
    }

    const selectAllHeader = document.querySelector('#prospectLeadsTable thead input[data-select-all-leads]');
    if (selectAllHeader) {
      selectAllHeader.checked = false;
      selectAllHeader.indeterminate = false;
    }
    if (typeof window.__resetBulkSelectAnchor === 'function') window.__resetBulkSelectAnchor();
    if (typeof window.__pipelineTablePagingApply === 'function') window.__pipelineTablePagingApply();

    if (mergedCount > 0) {
      notifyMergeResult(
        'Merged ' + mergedCount + ' lead' + (mergedCount === 1 ? '' : 's') + ' into ' + primaryTitle + '. Refreshing…',
        'success',
      );
      window.setTimeout(function () {
        window.location.reload();
      }, 700);
      return;
    }

    showBulkActionBar(0);
    if (typeof window.__updateBulkActionBar === 'function') window.__updateBulkActionBar();
    const failMsg = errorMsg || 'Merge failed.';
    notifyMergeResult(failMsg, 'error');
    window.alert(failMsg);
  }

  window.__bulkMergeSelectedLeads = bulkMergeSelectedLeads;

  function rowIsBookmarkedForBulk(row) {
    if (!row) return false;
    const btn = row.querySelector && row.querySelector('.bookmark-btn');
    if (typeof window.__isPipelineRowBookmarked === 'function') {
      return !!window.__isPipelineRowBookmarked(btn, row);
    }
    if (btn) {
      const savedAttr = btn.getAttribute('data-saved');
      if (savedAttr === '1' || btn.dataset.saved === '1' || btn.classList.contains('bookmark-btn--saved')) {
        return true;
      }
      if (savedAttr === '0' || btn.dataset.saved === '0') return false;
    }
    return row.dataset.bookmarked === '1';
  }

  function applyBulkBookmarkBtnVisual(btn, next, count) {
    if (!btn) return;
    const n = Math.max(0, parseInt(count, 10) || 0);
    const svg = btn.querySelector('svg');
    const label = btn.querySelector('span');
    btn.classList.toggle('bulk-bookmark-btn--saved', !!next);
    btn.setAttribute('aria-pressed', next ? 'true' : 'false');
    if (svg) svg.setAttribute('fill', next ? 'currentColor' : 'none');
    if (label) label.textContent = next ? 'Unbookmark' : 'Bookmark';
    btn.setAttribute(
      'title',
      next
        ? n
          ? `Remove bookmark from ${n} selected lead${n === 1 ? '' : 's'}`
          : 'Remove bookmark from selected leads'
        : n
          ? `Bookmark ${n} selected lead${n === 1 ? '' : 's'}`
          : 'Bookmark selected leads',
    );
  }

  function syncBulkBookmarkBtnState() {
    const btn = document.getElementById('bulkBookmarkBtn');
    if (!btn) return;
    const targets = collectBulkDeleteTargets();
    const allOn = targets.length > 0 && targets.every(function (t) {
      return rowIsBookmarkedForBulk(t.row);
    });
    applyBulkBookmarkBtnVisual(btn, allOn, targets.length);
  }

  let bulkBookmarkInFlight = false;

  function applyRowBookmarkOptimistic(row, next) {
    const btn = row && row.querySelector && row.querySelector('.bookmark-btn');
    if (typeof window.__applyRowBookmarked === 'function' && btn) {
      window.__applyRowBookmarked(row, btn, next);
      return btn;
    }
    if (row && row.dataset) {
      row.dataset.bookmarked = next ? '1' : '0';
      row.dataset.bookmarkClient = '1';
    }
    if (btn) {
      btn.dataset.saved = next ? '1' : '0';
      btn.setAttribute('data-saved', next ? '1' : '0');
      btn.setAttribute('aria-pressed', next ? 'true' : 'false');
      btn.classList.toggle('bookmark-btn--saved', !!next);
      btn.classList.toggle('bg-brand-yellow', !!next);
      btn.classList.toggle('text-brand-dark', !!next);
      btn.classList.toggle('border-brand-yellow', !!next);
      const svg = btn.querySelector('svg');
      if (svg) svg.setAttribute('fill', next ? 'currentColor' : 'none');
    }
    return btn;
  }

  async function persistRowBookmarkFallback(row, next) {
    const btn = applyRowBookmarkOptimistic(row, next);
    let key = String((row && row.dataset && row.dataset.leadKey) || '').trim();
    if (!key) {
      const cb = row && row.querySelector && row.querySelector('input.lead-checkbox[data-key], input.row-checkbox[data-key]');
      key = String((cb && (cb.getAttribute('data-key') || cb.dataset.key)) || '').trim();
    }
    if (!key) return false;
    try {
      const res = await fetch('/leads/' + encodeURIComponent(key) + '/update', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ bookmarked: !!next }),
      });
      const data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data.success) {
        throw new Error((data && data.error) || 'Could not update bookmark');
      }
      return true;
    } catch (err) {
      applyRowBookmarkOptimistic(row, !next);
      if (row && row.dataset) delete row.dataset.bookmarkClient;
      if (btn) {
        btn.dataset.saved = next ? '0' : '1';
        btn.setAttribute('data-saved', next ? '0' : '1');
      }
      throw err;
    }
  }

  async function bulkBookmarkSelectedLeads() {
    if (bulkBookmarkInFlight) return;
    const targets = collectBulkDeleteTargets();
    if (!targets.length) {
      notifyMergeResult('Select leads to bookmark.', 'error');
      return;
    }

    const allOn = targets.every(function (t) {
      return rowIsBookmarkedForBulk(t.row);
    });
    const next = !allOn;
    const n = targets.length;
    const btn = document.getElementById('bulkBookmarkBtn');

    bulkBookmarkInFlight = true;
    if (btn) {
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
    }
    applyBulkBookmarkBtnVisual(btn, next, n);
    targets.forEach(function (target) {
      applyRowBookmarkOptimistic(target.row, next);
    });
    showBulkBarFeedbackEarly(next ? 'Bookmarking selected leads…' : 'Removing bookmarks…', 'loading');

    const setFn =
      typeof window.__setPipelineLeadBookmark === 'function' ? window.__setPipelineLeadBookmark : null;
    let okCount = 0;
    let errorMsg = '';

    try {
      const BATCH = 8;
      for (let i = 0; i < targets.length; i += BATCH) {
        const slice = targets.slice(i, i + BATCH);
        const results = await Promise.all(
          slice.map(function (target) {
            const row = target.row;
            const bookmarkBtn = row && row.querySelector && row.querySelector('.bookmark-btn');
            if (setFn && bookmarkBtn) {
              return setFn(row, bookmarkBtn, next, { silent: true, force: true }).catch(function (err) {
                console.error('[pipeline-bulk-select] bulk bookmark failed', err);
                return false;
              });
            }
            return persistRowBookmarkFallback(row, next).catch(function (err) {
              console.error('[pipeline-bulk-select] bulk bookmark failed', err);
              return false;
            });
          }),
        );
        results.forEach(function (ok) {
          if (ok) okCount += 1;
        });
      }
    } catch (err) {
      console.error('[pipeline-bulk-select] bulk bookmark failed', err);
      errorMsg = (err && err.message) || 'Could not update bookmarks.';
    } finally {
      bulkBookmarkInFlight = false;
      if (btn) {
        btn.disabled = false;
        btn.removeAttribute('aria-busy');
      }
      syncBulkBookmarkBtnState();
    }

    if (okCount > 0) {
      const msg = next
        ? 'Bookmarked ' + okCount + ' lead' + (okCount === 1 ? '' : 's')
        : 'Removed bookmark from ' + okCount + ' lead' + (okCount === 1 ? '' : 's');
      notifyMergeResult(msg, 'success');
      if (okCount < n) {
        notifyMergeResult(
          'Updated ' + okCount + ' of ' + n + ' selected leads.' + (errorMsg ? ' ' + errorMsg : ''),
          'error',
        );
      }
      return;
    }

    notifyMergeResult(errorMsg || 'Could not update bookmarks.', 'error');
  }

  window.__bulkBookmarkSelectedLeads = bulkBookmarkSelectedLeads;
  window.__syncBulkBookmarkBtnState = syncBulkBookmarkBtnState;

  function mountSmsModalToBodyEarly() {
    if (typeof window.__mountSmsModalToBody === 'function') {
      window.__mountSmsModalToBody();
      return;
    }
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
    el.classList.remove('hidden');
    el.classList.remove('text-emerald-300', 'text-rose-300', 'text-white/80', 'text-sky-200');
    if (variant === 'error') el.classList.add('text-rose-300');
    else if (variant === 'success') el.classList.add('text-emerald-300');
    else if (variant === 'loading') el.classList.add('text-white/80');
    else el.classList.add('text-sky-200');
  }
  window.__showBulkBarFeedbackEarly = showBulkBarFeedbackEarly;

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

  function collectEmailLeadKeysEarly() {
    const keys = [];
    const seen = new Set();
    document
      .querySelectorAll(
        'tbody input.lead-checkbox:checked, tbody input.row-checkbox:checked, input.lead-checkbox:checked, input.row-checkbox:checked',
      )
      .forEach(function (cb) {
        const row = cb.closest('tr.result-row, tr[data-lead-key]');
        if (!row) return;
        const email = String(row.getAttribute('data-email') || row.dataset.email || '').trim();
        if (!email || email === 'N/A' || !email.includes('@')) return;
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

  async function waitForSmsModalElement(maxMs) {
    mountSmsModalToBodyEarly();
    const limit = typeof maxMs === 'number' ? maxMs : 12000;
    const step = 50;
    for (let elapsed = 0; elapsed < limit; elapsed += step) {
      if (document.getElementById('smsScriptModal')) return true;
      // eslint-disable-next-line no-await-in-loop
      await new Promise(function (resolve) {
        window.setTimeout(resolve, step);
      });
    }
    return false;
  }

  async function waitForBulkSmsHandler(maxMs) {
    const limit = typeof maxMs === 'number' ? maxMs : 12000;
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

  async function runBulkEmailFromBarEarly() {
    mountSmsModalToBodyEarly();
    const btn = document.getElementById('bulkEmailBtn');
    const selectedCount = collectSelectedLeadKeysEarly().length;
    const emailKeys = collectEmailLeadKeysEarly();
    if (!emailKeys.length) {
      showBulkBarFeedbackEarly('Selected leads have no email addresses.', 'error');
      return;
    }
    const skipped = Math.max(0, selectedCount - emailKeys.length);
    showBulkBarFeedbackEarly(
      skipped
        ? `Opening email composer for ${emailKeys.length} lead${emailKeys.length === 1 ? '' : 's'} (${skipped} skipped — no email)…`
        : `Opening email composer for ${emailKeys.length} lead${emailKeys.length === 1 ? '' : 's'}…`,
      'info',
    );
    if (typeof window.__flashBulkBarBtn === 'function') {
      window.__flashBulkBarBtn(btn, 'Opening…', 900);
    }
    const modalReady = await waitForSmsModalElement(12000);
    if (!modalReady) {
      showBulkBarFeedbackEarly('Email composer failed to load. Hard-refresh the page and try again.', 'error');
      return;
    }
    if (typeof window.__openBulkEmailFromBar === 'function') {
      const fromBarResult = await window.__openBulkEmailFromBar();
      if (fromBarResult && fromBarResult.ok) {
        showBulkBarFeedbackEarly(
          skipped
            ? `Email composer open · ${emailKeys.length} with address · ${skipped} skipped`
            : `Email composer open for ${emailKeys.length} lead${emailKeys.length === 1 ? '' : 's'}.`,
          'success',
        );
      } else if (fromBarResult && fromBarResult.message) {
        showBulkBarFeedbackEarly(fromBarResult.message, 'error');
      }
      return fromBarResult;
    }
    if (typeof window.__openBulkEmailModal === 'function') {
      return window.__openBulkEmailModal(emailKeys);
    }
    showBulkBarFeedbackEarly('Email composer failed to load. Hard-refresh the page and try again.', 'error');
  }
  window.__runBulkEmailFromBarEarly = runBulkEmailFromBarEarly;

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
    const modalReady = await waitForSmsModalElement(12000);
    if (!modalReady) {
      showBulkBarFeedbackEarly('SMS composer failed to load. Hard-refresh the page and try again.', 'error');
      return;
    }
    if (typeof window.__openBulkSmsFromBar === 'function') {
      const fromBarResult = await window.__openBulkSmsFromBar();
      if (fromBarResult && fromBarResult.ok) {
        showBulkBarFeedbackEarly(
          `SMS ready — personalize and send via GHL (${phoneKeys.length} lead${phoneKeys.length === 1 ? '' : 's'}).`,
          'success',
        );
        if (typeof window.__flashBulkBarBtn === 'function') window.__flashBulkBarBtn(btn, '✓ Opened');
      } else if (fromBarResult && fromBarResult.message) {
        showBulkBarFeedbackEarly(fromBarResult.message, 'error');
      }
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
    const handler = await waitForBulkSmsHandler(12000);
    if (typeof handler === 'function') {
      if (handler === window.__openBulkSmsFromBar) {
        const fromBarResult = await window.__openBulkSmsFromBar();
        if (fromBarResult && fromBarResult.ok) {
          showBulkBarFeedbackEarly(
            `SMS ready — personalize and send via GHL (${phoneKeys.length} lead${phoneKeys.length === 1 ? '' : 's'}).`,
            'success',
          );
          if (typeof window.__flashBulkBarBtn === 'function') window.__flashBulkBarBtn(btn, '✓ Opened');
        } else if (fromBarResult && fromBarResult.message) {
          showBulkBarFeedbackEarly(fromBarResult.message, 'error');
        }
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
    const prevHtml = btn ? btn.innerHTML : '';
    window.__bulkPushGhlInFlight = true;
    if (btn) {
      btn.disabled = true;
      const labelEl = btn.querySelector('span');
      if (labelEl) labelEl.textContent = `${leadKeys.length} left`;
      else btn.textContent = `${leadKeys.length} left`;
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
        if (!btn.__flashTimer && prevHtml) btn.innerHTML = prevHtml;
      }
      if (typeof window.__syncBulkBarFromDom === 'function') window.__syncBulkBarFromDom();
      else if (typeof window.__updateBulkActionBar === 'function') window.__updateBulkActionBar();
    }
  }
  window.__runBulkPushGhlFromBarEarly = runBulkPushGhlFromBarEarly;

  async function runBulkCreateSubaccountFromBarEarly() {
    if (window.__bulkCreateSubaccountInFlight) return { ok: false, error: 'in_flight' };
    const btn = document.getElementById('bulkCreateSubaccountBtn');
    const leadKeys = collectSelectedLeadKeysEarly();
    if (!leadKeys.length) {
      showBulkBarFeedbackEarly('Select at least one lead.', 'error');
      return { ok: false, error: 'no_selection' };
    }
    const n = leadKeys.length;
    const msg =
      n === 1
        ? 'Create a GHL sub-account for the selected business?'
        : `Create GHL sub-accounts for ${n} selected businesses?`;
    if (!window.confirm(msg)) return { ok: false, error: 'cancelled' };

    const prevHtml = btn ? btn.innerHTML : '';
    window.__bulkCreateSubaccountInFlight = true;
    if (btn) {
      btn.disabled = true;
      const labelEl = btn.querySelector('span');
      if (labelEl) labelEl.textContent = n > 1 ? `${n} left` : 'Creating…';
      else btn.textContent = n > 1 ? `${n} left` : 'Creating…';
      btn.setAttribute('aria-busy', 'true');
      btn.classList.add('is-busy');
    }
    showBulkBarFeedbackEarly(
      n === 1 ? 'Creating GHL sub-account…' : `Creating ${n} GHL sub-accounts…`,
      'loading',
    );

    try {
      const res = await fetch('/ghl/subaccounts', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ leadKeys }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok && res.status === 403) {
        throw new Error(data.error || 'Only workspace admins can create GHL sub-accounts.');
      }
      if (!res.ok && !(data && (data.created || data.skipped))) {
        throw new Error(data.error || 'Could not create GHL sub-accounts.');
      }
      const created = Number(data.created || 0);
      const skipped = Number(data.skipped || 0);
      const failed = Number(data.failed || 0);
      const summary = `Sub-accounts · ${created} created${skipped ? ` · ${skipped} already existed` : ''}${failed ? ` · ${failed} failed` : ''}`;
      showBulkBarFeedbackEarly(summary, failed && !created && !skipped ? 'error' : 'success');
      if (typeof window.__flashBulkBarBtn === 'function') {
        window.__flashBulkBarBtn(btn, failed && !created ? 'Failed' : '✓ Created');
      }
      const firstUrl =
        Array.isArray(data.results) &&
        data.results.map((r) => r && r.url).find((u) => u);
      const link = document.getElementById('bulkOpenGhlContactsLink');
      if (link && firstUrl) {
        link.href = firstUrl;
        link.textContent = 'Open GHL sub-account →';
        link.classList.remove('hidden');
      }
      return { ok: failed === 0, created, skipped, failed, results: data.results || [] };
    } catch (err) {
      const errMsg = err && err.message ? err.message : 'Create sub-account failed';
      showBulkBarFeedbackEarly(errMsg, 'error');
      if (typeof window.__flashBulkBarBtn === 'function') {
        window.__flashBulkBarBtn(btn, 'Failed', 1200);
      }
      return { ok: false, error: errMsg };
    } finally {
      window.__bulkCreateSubaccountInFlight = false;
      if (btn) {
        btn.disabled = false;
        btn.removeAttribute('aria-busy');
        btn.classList.remove('is-busy');
        if (!btn.__flashTimer && prevHtml) btn.innerHTML = prevHtml;
      }
      if (typeof window.__syncBulkBarFromDom === 'function') window.__syncBulkBarFromDom();
      else if (typeof window.__updateBulkActionBar === 'function') window.__updateBulkActionBar();
    }
  }
  window.__runBulkCreateSubaccountFromBarEarly = runBulkCreateSubaccountFromBarEarly;

  async function runBulkAutoOutreachFromBarEarly() {
    if (window.__bulkAutoOutreachInFlight) return { ok: false, error: 'in_flight' };
    const btn = document.getElementById('bulkAutoOutreachBtn');
    const leadKeys = collectSelectedLeadKeysEarly();
    if (!leadKeys.length) {
      showBulkBarFeedbackEarly('Select at least one lead.', 'error');
      return { ok: false, error: 'no_selection' };
    }
    const prev = btn ? String(btn.textContent || '').trim() || 'Auto outreach' : 'Auto outreach';
    window.__bulkAutoOutreachInFlight = true;
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Finding…';
      btn.setAttribute('aria-busy', 'true');
    }
    showBulkBarFeedbackEarly(
      `Finding contacts for ${leadKeys.length} lead${leadKeys.length === 1 ? '' : 's'}, then enrolling to GHL…`,
      'loading',
    );

    // Client enhance pass for missing phone/email (same Enhance API as Enrich leads).
    let enhanceUpdated = 0;
    try {
      for (let i = 0; i < leadKeys.length; i += 1) {
        const key = leadKeys[i];
        const row = findResultRowByLeadKeyEarly(key);
        const phone = String((row && row.dataset && row.dataset.phone) || '').trim();
        const email = String((row && row.dataset && row.dataset.email) || '').trim();
        const needsContact =
          !row ||
          !phone ||
          phone === 'N/A' ||
          phone === '—' ||
          !email ||
          email === 'N/A' ||
          email === '—';
        if (!needsContact) continue;

        if (btn) btn.textContent = `Find ${i + 1}/${leadKeys.length}`;
        showBulkBarFeedbackEarly(
          `Finding contacts ${i + 1}/${leadKeys.length} via API…`,
          'loading',
        );

        try {
          result = await runEnhanceApiForLeadKeyEarly(key);
          const d = result.lead || result.data;
          if (result.success && d) {
            enhanceUpdated += 1;
            if (row) {
              applyEnhanceDataToRowEarly(row, d);
              syncRowSocialsSlotEarly(row);
            }
          }
        } catch (_) {
          /* continue to enroll — server also finds email */
        }
      }
    } catch (_) {
      /* non-fatal; enroll still runs */
    }

    if (btn) btn.textContent = 'Enrolling…';
    showBulkBarFeedbackEarly(
      `Enrolling ${leadKeys.length} lead${leadKeys.length === 1 ? '' : 's'} to GHL auto-outreach…`,
      'loading',
    );

    try {
      const res = await fetch('/api/prospecting/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ leadKeys, tag: 'auto-outreach', findContacts: true }),
      });
      const data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data.success) {
        throw new Error((data && data.error) || 'Enroll failed');
      }
      const n = data.enrolled != null ? data.enrolled : leadKeys.length;
      const found =
        (Number(data.emailsFound) || 0) + (enhanceUpdated > 0 ? enhanceUpdated : 0);
      const foundNote =
        data.emailsFound > 0
          ? ` · found ${data.emailsFound} email${data.emailsFound === 1 ? '' : 's'}`
          : enhanceUpdated > 0
            ? ` · enhanced ${enhanceUpdated}`
            : '';
      const dmQueued = Number(data.directMailQueued || 0);
      const dmNote =
        dmQueued > 0
          ? ` · ${dmQueued} added to Direct Mail`
          : ' · Direct Mail queued';
      showBulkBarFeedbackEarly(
        `Tagged ${n} for auto outreach — synced to GHL workflow${foundNote}${dmNote}.`,
        'success',
      );
      const results = Array.isArray(data.results) ? data.results : [];
      results.forEach(function (item) {
        if (item && item.lead && typeof window.__applyLeadPipelineStageFromApi === 'function') {
          window.__applyLeadPipelineStageFromApi(item.lead);
        }
      });
      if (typeof window.__flashBulkBarBtn === 'function') {
        window.__flashBulkBarBtn(btn, `Enrolled ${n}`, 1400);
      }
      return { ok: true, found, ...data };
    } catch (err) {
      const msg = err && err.message ? err.message : 'Auto outreach enroll failed';
      showBulkBarFeedbackEarly(msg, 'error');
      if (typeof window.__flashBulkBarBtn === 'function') {
        window.__flashBulkBarBtn(btn, 'Failed', 1200);
      }
      return { ok: false, error: msg };
    } finally {
      window.__bulkAutoOutreachInFlight = false;
      if (btn) {
        btn.disabled = false;
        btn.removeAttribute('aria-busy');
        if (!btn.__flashTimer) btn.textContent = prev;
      }
    }
  }
  window.__runBulkAutoOutreachFromBarEarly = runBulkAutoOutreachFromBarEarly;

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

  function findResultRowByLeadKeyEarly(key) {
    const k = String(key || '').trim();
    if (!k) return null;
    const esc = k.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return document.querySelector(
      `tr.result-row[data-lead-key="${esc}"], tr[data-lead-key="${esc}"]`,
    );
  }

  function applySocialEnrichDataToRowEarly(row, d) {
    if (!row || !d || typeof d !== 'object') return;
    if (d.facebook) row.dataset.facebook = d.facebook;
    if (d.instagram) row.dataset.instagram = d.instagram;
    if (d.tiktok) row.dataset.tiktok = d.tiktok;
    if (d.twitter) row.dataset.twitter = d.twitter;
    if (d.linkedin) row.dataset.linkedin = d.linkedin;
  }

  function syncRowSocialsSlotEarly(row) {
    if (!row) return;
    const slot = row.querySelector('.lead-cell-socials-content');
    if (!slot) return;
    const sb = window.AdhelloSocialBrand;
    if (sb && typeof sb.renderLinks === 'function') {
      const suffix = String(row.dataset.leadKey || row.getAttribute('data-lead-key') || 'bulk');
      slot.innerHTML = sb.renderLinks({
        fb: row.dataset.facebook,
        ig: row.dataset.instagram,
        tt: row.dataset.tiktok,
        tw: row.dataset.twitter,
        li: row.dataset.linkedin,
        gradSuffix: suffix,
      });
      return;
    }
    slot.innerHTML =
      '<span class="text-[9px] font-bold text-brand-muted/60 uppercase tracking-widest">—</span>';
  }

  function collectSelectedEnhanceRowsEarly() {
    const out = [];
    const seen = new Set();
    document
      .querySelectorAll(
        'tbody input.lead-checkbox:checked, tbody input.row-checkbox:checked, input.lead-checkbox:checked, input.row-checkbox:checked',
      )
      .forEach(function (cb) {
        const row = cb.closest('tr.result-row, tr[data-lead-key]');
        if (!row || seen.has(row)) return;
        seen.add(row);
        out.push(row);
      });
    return out;
  }

  function applyEnhanceDataToRowEarly(row, d) {
    if (!row || !d || typeof d !== 'object') return;
    if (d.facebook) row.dataset.facebook = d.facebook;
    if (d.instagram) row.dataset.instagram = d.instagram;
    if (d.tiktok) row.dataset.tiktok = d.tiktok;
    if (d.twitter) row.dataset.twitter = d.twitter;
    if (d.linkedin) row.dataset.linkedin = d.linkedin;
    if (d.website && d.website !== 'N/A') row.dataset.website = d.website;
    if (d.email) row.dataset.email = d.email;
    if (d.phone !== undefined && d.phone !== null) row.dataset.phone = d.phone || 'N/A';
    if (d.address) row.dataset.address = d.address;
    if (d.city) row.dataset.city = d.city;
    if (d.state) row.dataset.state = d.state;
    if (d.zip || d.postalCode) row.dataset.zip = String(d.zip || d.postalCode).trim();
    const ratingVal = d.totalScore ?? d.total_score ?? d.rating;
    const revVal = d.reviewsCount ?? d.reviews_count ?? d.reviews;
    if (ratingVal != null && !Number.isNaN(parseFloat(ratingVal))) {
      row.dataset.rating = String(ratingVal);
    }
    if (revVal != null && !Number.isNaN(parseInt(revVal, 10))) {
      row.dataset.reviews = String(parseInt(revVal, 10));
    }
    if (typeof window.syncPipelineRowAddressDisplay === 'function') {
      window.syncPipelineRowAddressDisplay(row);
    }
    if (typeof window.syncPipelineRowWebsiteCell === 'function') {
      window.syncPipelineRowWebsiteCell(row);
    }
    if (typeof window.syncPipelineRowCallButton === 'function') {
      window.syncPipelineRowCallButton(row, row.dataset.phone);
    }
  }

  async function pollLeadEnhanceUntilDoneEarly(leadKey) {
    if (typeof window.__pollLeadEnhanceUntilDone === 'function') {
      return window.__pollLeadEnhanceUntilDone(leadKey, { maxMs: 120000 });
    }
    const maxMs = 120000;
    const interval = 2500;
    const deadline = Date.now() + maxMs;
    const started = Date.now();
    let idleStreak = 0;
    while (Date.now() < deadline) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, interval));
      let d = {};
      try {
        if (typeof window.__fetchJsonWithTimeout === 'function') {
          // eslint-disable-next-line no-await-in-loop
          const polled = await window.__fetchJsonWithTimeout(
            '/leads/' + encodeURIComponent(leadKey) + '/enhance-status',
            {
              credentials: 'same-origin',
              headers: { Accept: 'application/json' },
            },
            30000,
          );
          d = polled.data || {};
        } else {
          // eslint-disable-next-line no-await-in-loop
          const res = await fetch('/leads/' + encodeURIComponent(leadKey) + '/enhance-status', {
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
          });
          // eslint-disable-next-line no-await-in-loop
          d = await res.json().catch(() => ({}));
        }
      } catch (err) {
        d = { status: 'error', error: (err && err.message) || 'Status check failed.' };
      }
      if (d.status === 'processing') {
        idleStreak = 0;
        continue;
      }
      if (d.status === 'done') {
        return {
          success: !!d.success,
          lead: d.lead,
          data: d.data,
          error: d.error,
        };
      }
      if (d.status === 'error') {
        return { success: false, error: d.error || 'Enhance failed.' };
      }
      if (d.status === 'idle') {
        idleStreak += 1;
        if (Date.now() - started < 20000 && idleStreak < 8) continue;
        return {
          success: false,
          error: 'Enhance ended before results were ready. Refresh and try again.',
        };
      }
    }
    return {
      success: false,
      error: 'Enhance is taking longer than expected. Check back in a minute.',
    };
  }

  async function runEnhanceApiForLeadKeyEarly(leadKey) {
    const key = String(leadKey || '').trim();
    if (!key) return { success: false, error: 'Missing lead key.' };
    if (typeof window.__runEnhanceApiForLeadKey === 'function') {
      return window.__runEnhanceApiForLeadKey(key);
    }
    const run = async function () {
      let result = {};
      if (typeof window.__fetchJsonWithTimeout === 'function') {
        const post = await window.__fetchJsonWithTimeout(
          '/leads/' + encodeURIComponent(key) + '/enhance',
          {
            method: 'POST',
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
          },
          45000,
        );
        result = post.data || {};
        if (post.res.ok && result.processing) {
          result = await pollLeadEnhanceUntilDoneEarly(key);
        } else if (!post.res.ok) {
          result = { success: false, error: result.error || 'Enhance failed (' + post.res.status + ').' };
        }
      } else {
        const res = await fetch('/leads/' + encodeURIComponent(key) + '/enhance', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
        });
        result = await res.json().catch(() => ({}));
        if (res.ok && result.processing) {
          result = await pollLeadEnhanceUntilDoneEarly(key);
        } else if (!res.ok) {
          result = { success: false, error: result.error || 'Enhance failed (' + res.status + ').' };
        }
      }
      return result;
    };
    if (typeof window.__withBulkEnhanceLeadTimeout === 'function') {
      return window.__withBulkEnhanceLeadTimeout(run(), 120000);
    }
    return run();
  }

  async function runBulkEnhanceFromBarEarly() {
    if (window.__bulkEnhanceInFlight) return;

    const bar = document.getElementById('bulkActionBar');
    const useInlinePipeline =
      bar && bar.dataset.bulkMode === 'pipeline' && bar.dataset.visible === 'true';

    if (
      !useInlinePipeline &&
      typeof window.__runBulkEnhanceSelectedLeadsImpl === 'function'
    ) {
      return window.__runBulkEnhanceSelectedLeadsImpl();
    }

    const selectedRows = collectSelectedEnhanceRowsEarly();
    if (!selectedRows.length) {
      showBulkBarFeedbackEarly('Select one or more leads to enhance.', 'error');
      return;
    }

    const leadsToProcess = selectedRows.slice(0, 20);
    if (selectedRows.length > 20) {
      showBulkBarFeedbackEarly('Bulk enhance limited to 20 leads per batch.', 'info');
    }

    const enhanceBtns = document.querySelectorAll('.js-bulk-enhance');
    const btnSnap = Array.from(enhanceBtns).map((b) => b.innerHTML);
    const loadingHtml =
      '<span class="text-[10px] font-black uppercase tracking-widest animate-pulse">Enhancing…</span>';

    window.__bulkEnhanceInFlight = true;
    enhanceBtns.forEach((b) => {
      b.disabled = true;
      b.classList.add('loading');
      b.innerHTML = loadingHtml;
    });

    const total = leadsToProcess.length;
    showBulkBarFeedbackEarly(
      `Enhancing ${total} lead${total === 1 ? '' : 's'} via API (no new tabs)…`,
      'loading',
    );

    let successCount = 0;
    let attemptedCount = 0;
    let lastError = '';

    try {
      for (let i = 0; i < leadsToProcess.length; i += 1) {
        const row = leadsToProcess[i];
        const key = String(row.dataset.leadKey || row.getAttribute('data-lead-key') || '').trim();
        const url = row.dataset.website;
        const title = row.dataset.title;
        const city = row.dataset.city;
        const state = row.dataset.state;

        if (!key && (!url || url === 'N/A') && (!title || !city)) continue;

        attemptedCount += 1;
        enhanceBtns.forEach((b) => {
          b.innerHTML = `<span class="text-[10px] font-black uppercase tracking-widest animate-pulse">Enhance ${i + 1}/${total}</span>`;
        });
        showBulkBarFeedbackEarly(
          `Enhancing via API ${i + 1}/${total} (no new tabs)…`,
          'loading',
        );

        try {
          let result = {};
          if (key) {
            result = await runEnhanceApiForLeadKeyEarly(key);
          } else {
            const res = await fetch('/enrich', {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
              body: JSON.stringify({ url, title, city, state }),
            });
            result = await res.json().catch(() => ({}));
            if (!res.ok) {
              result = { success: false, error: result.error || `Enhance failed (${res.status}).` };
            }
          }
          if (result.error) lastError = String(result.error);
          const d = result.lead || result.data;
          const ok = !!result.success && !!d;
          if (ok) {
            successCount += 1;
            applyEnhanceDataToRowEarly(row, d);
            syncRowSocialsSlotEarly(row);
          }
        } catch (err) {
          lastError = (err && err.message) || lastError || 'Network error';
        }
      }
    } finally {
      window.__bulkEnhanceInFlight = false;
    }

    const summaryLabel =
      successCount > 0
        ? `Updated ${successCount}`
        : attemptedCount > 0
          ? 'No new data'
          : 'Done';
    enhanceBtns.forEach((b) => {
      b.innerHTML = `<span class="text-[10px] font-black uppercase tracking-widest">${summaryLabel}</span>`;
    });

    if (attemptedCount === 0) {
      showBulkBarFeedbackEarly(
        'Could not enhance selected leads. Save them to your pipeline first, then try again.',
        'error',
      );
    } else if (successCount > 0) {
      showBulkBarFeedbackEarly(
        `Enhanced ${successCount} lead${successCount === 1 ? '' : 's'}. Refresh if columns look stale.`,
        'success',
      );
    } else {
      showBulkBarFeedbackEarly(
        lastError ||
          'Enhance found no new contact or review data for the selected lead(s).',
        'error',
      );
    }

    setTimeout(() => {
      enhanceBtns.forEach((b, i) => {
        b.classList.remove('loading');
        b.disabled = false;
        b.innerHTML = btnSnap[i] || b.innerHTML;
      });
    }, 2800);
  }
  window.__runBulkEnhanceFromBarEarly = runBulkEnhanceFromBarEarly;

  /**
   * Queue lead keys for Chrome extension website scrape (contacts + socials).
   * @param {string[]} leadKeys
   * @param {{ toast?: boolean, busyEl?: HTMLElement|null, notifyExtension?: boolean }} [opts]
   */
  async function queueWebsiteEnrichForKeys(leadKeys, opts) {
    const keys = (Array.isArray(leadKeys) ? leadKeys : [])
      .map((k) => String(k || '').trim())
      .filter(Boolean)
      .slice(0, 150);
    if (!keys.length) {
      return { ok: false, error: 'no_keys', message: 'No leads with a website to enrich.' };
    }

    const res = await fetch('/leads/website-enrich-queue', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ leadKeys: keys }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      throw new Error(data.error || `Queue failed (${res.status}).`);
    }

    const toast = !opts || opts.toast !== false;
    const notifyExt = !opts || opts.notifyExtension !== false;
    if (data.empty || !data.queued) {
      const msg = data.message || 'No leads need website contact enrich.';
      if (toast && typeof window.showAppToast === 'function') {
        window.showAppToast(msg, { variant: 'info', duration: 6000 });
      }
      return { ok: true, empty: true, queued: 0, data, message: msg };
    }

    if (notifyExt) {
      try {
        window.postMessage(
          {
            source: 'adhello-app',
            type: 'START_WEBSITE_ENRICH_QUEUE',
            workspaceId: window.__ADHELLO_WORKSPACE_ID__ || undefined,
            limit: 150,
            queued: data.queued,
          },
          '*',
        );
      } catch (_) {
        /* ignore */
      }
    }

    const msg = `Enriching ${data.queued} lead${data.queued === 1 ? '' : 's'} in the background via Chrome (~5 sites at a time).`;
    if (toast && typeof window.showAppToast === 'function') {
      window.showAppToast(msg, { variant: 'success', duration: 8000 });
    }
    return { ok: true, empty: false, queued: data.queued, data, message: msg };
  }
  window.__queueWebsiteEnrichForKeys = queueWebsiteEnrichForKeys;

  function collectVisiblePipelineLeadKeysWithWebsite(limit) {
    const max = Math.min(Math.max(parseInt(limit, 10) || 150, 1), 150);
    const keys = [];
    const seen = new Set();
    document.querySelectorAll('#prospectLeadsTable .result-row').forEach((row) => {
      if (keys.length >= max) return;
      if (row.classList.contains('pipeline-row-page-hidden')) return;
      const website = String((row.dataset && row.dataset.website) || '').trim();
      if (!website || website === 'N/A' || website === '—') return;
      const key = String((row.dataset && row.dataset.leadKey) || '').trim();
      if (!key || seen.has(key)) return;
      seen.add(key);
      keys.push(key);
    });
    return keys;
  }
  window.__collectVisiblePipelineLeadKeysWithWebsite = collectVisiblePipelineLeadKeysWithWebsite;

  function getEnrichLeadsButtons() {
    return document.querySelectorAll(
      '.js-bulk-scrape-websites, .js-bulk-enrich-leads, .js-enhance-missing-contacts',
    );
  }

  function renderEnrichLeadsBusyHtml(btn, label) {
    const text = String(label || 'Enriching…');
    if (btn.classList.contains('js-enhance-missing-contacts')) {
      return (
        '<svg class="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" aria-hidden="true"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle><path class="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg><span>' +
        text +
        '</span>'
      );
    }
    return (
      '<span class="text-[10px] font-black uppercase tracking-widest animate-pulse">' +
      text +
      '</span>'
    );
  }

  function setEnrichLeadsButtonsState(btns, label) {
    btns.forEach((b) => {
      b.disabled = true;
      b.classList.add('loading');
      b.innerHTML = renderEnrichLeadsBusyHtml(b, label);
    });
  }

  function collectRowsForEnrichLeadsApi(limit) {
    const max = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 25);
    let rows = collectSelectedEnhanceRowsEarly().slice(0, max);
    if (rows.length) return rows;
    const seen = new Set();
    const visible = [];
    document.querySelectorAll('#prospectLeadsTable .result-row').forEach((row) => {
      if (visible.length >= max) return;
      if (row.classList.contains('pipeline-row-page-hidden')) return;
      const key = String((row.dataset && row.dataset.leadKey) || '').trim();
      if (!key || seen.has(key)) return;
      seen.add(key);
      visible.push(row);
    });
    return visible;
  }

  /**
   * Enrich leads via server Enhance + Socials APIs (not Chrome extension).
   */
  async function runBulkEnrichLeadsApiFromBarEarly() {
    if (
      window.__bulkEnrichLeadsApiInFlight ||
      window.__bulkEnhanceInFlight ||
      window.__bulkSocialEnrichInFlight ||
      window.__bulkWebsiteScrapeInFlight
    ) {
      showBulkBarFeedbackEarly('Another enrich job is already running.', 'info');
      return;
    }

    const rows = collectRowsForEnrichLeadsApi(20);
    if (!rows.length) {
      showBulkBarFeedbackEarly('Select one or more saved leads to enrich.', 'error');
      return;
    }

    const btns = getEnrichLeadsButtons();
    const btnSnap = Array.from(btns).map((b) => b.innerHTML);
    const enhanceBtns = document.querySelectorAll('.js-bulk-enhance');
    const socialBtns = document.querySelectorAll('.js-bulk-socials');
    const enhanceSnap = Array.from(enhanceBtns).map((b) => b.innerHTML);
    const socialSnap = Array.from(socialBtns).map((b) => b.innerHTML);

    window.__bulkEnrichLeadsApiInFlight = true;
    window.__bulkEnhanceInFlight = true;
    window.__bulkSocialEnrichInFlight = true;

    const restoreAll = (delayMs) => {
      window.setTimeout(() => {
        getEnrichLeadsButtons().forEach((b, i) => {
          b.classList.remove('loading');
          b.disabled = false;
          if (btnSnap[i]) b.innerHTML = btnSnap[i];
        });
        enhanceBtns.forEach((b, i) => {
          b.classList.remove('loading');
          b.disabled = false;
          if (enhanceSnap[i]) b.innerHTML = enhanceSnap[i];
        });
        socialBtns.forEach((b, i) => {
          b.classList.remove('loading');
          b.disabled = false;
          if (socialSnap[i]) b.innerHTML = socialSnap[i];
        });
        window.__bulkEnrichLeadsApiInFlight = false;
        window.__bulkEnhanceInFlight = false;
        window.__bulkSocialEnrichInFlight = false;
      }, Math.max(0, delayMs || 0));
    };

    setEnrichLeadsButtonsState(btns, 'Enhancing…');
    enhanceBtns.forEach((b) => {
      b.disabled = true;
      b.classList.add('loading');
      b.innerHTML =
        '<span class="text-[10px] font-black uppercase tracking-widest animate-pulse">Enhancing…</span>';
    });
    socialBtns.forEach((b) => {
      b.disabled = true;
      b.classList.add('loading');
      b.innerHTML =
        '<span class="text-[10px] font-black uppercase tracking-widest animate-pulse">Queued…</span>';
    });

    const total = rows.length;
    showBulkBarFeedbackEarly(
      `Enhancing ${total} lead${total === 1 ? '' : 's'} via API (no new tabs)…`,
      'loading',
    );

    let enhanceOk = 0;
    let socialOk = 0;
    let lastError = '';

    try {
      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        const key = String(row.dataset.leadKey || row.getAttribute('data-lead-key') || '').trim();
        const url = row.dataset.website;
        const title = row.dataset.title;
        const city = row.dataset.city;
        const state = row.dataset.state;
        if (!key && (!url || url === 'N/A') && (!title || !city)) continue;

        setEnrichLeadsButtonsState(btns, `Enhance ${i + 1}/${total}`);
        showBulkBarFeedbackEarly(
          `Enhancing via API ${i + 1}/${total} (no new tabs)…`,
          'loading',
        );

        try {
          let result = {};
          if (key) {
            result = await runEnhanceApiForLeadKeyEarly(key);
          } else {
            const res = await fetch('/enrich', {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
              body: JSON.stringify({ url, title, city, state }),
            });
            result = await res.json().catch(() => ({}));
            if (!res.ok) {
              result = { success: false, error: result.error || `Enhance failed (${res.status}).` };
            }
          }
          if (result.error) lastError = String(result.error);
          const d = result.lead || result.data;
          if (result.success && d) {
            enhanceOk += 1;
            applyEnhanceDataToRowEarly(row, d);
            syncRowSocialsSlotEarly(row);
          }
        } catch (err) {
          lastError = (err && err.message) || lastError || 'Enhance network error';
        }
      }

      enhanceBtns.forEach((b) => {
        b.innerHTML = `<span class="text-[10px] font-black uppercase tracking-widest">${
          enhanceOk > 0 ? `Updated ${enhanceOk}` : 'Enhance done'
        }</span>`;
      });
      socialBtns.forEach((b) => {
        b.innerHTML =
          '<span class="text-[10px] font-black uppercase tracking-widest animate-pulse">Finding…</span>';
      });
      setEnrichLeadsButtonsState(btns, 'Socials…');
      showBulkBarFeedbackEarly(
        `Finding socials for ${total} lead${total === 1 ? '' : 's'} via API…`,
        'loading',
      );

      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        const key = String(row.dataset.leadKey || row.getAttribute('data-lead-key') || '').trim();
        if (!key) continue;

        setEnrichLeadsButtonsState(btns, `Socials ${i + 1}/${total}`);
        showBulkBarFeedbackEarly(`Socials API ${i + 1}/${total}…`, 'loading');

        const slot = row.querySelector('.lead-cell-socials-content');
        if (slot) {
          slot.innerHTML =
            '<span class="text-[9px] font-bold text-pink-400 uppercase tracking-widest animate-pulse">Searching…</span>';
        }

        try {
          const res = await fetch(`/leads/${encodeURIComponent(key)}/enrich-socials`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
          });
          const result = await res.json().catch(() => ({}));
          if (result.error) lastError = String(result.error);
          const d = result.lead;
          const ok = res.ok && result.success && d && !result.skipped;
          if (ok) socialOk += 1;
          if (d) {
            applySocialEnrichDataToRowEarly(row, d);
            applyEnhanceDataToRowEarly(row, d);
            syncRowSocialsSlotEarly(row);
          } else {
            syncRowSocialsSlotEarly(row);
          }
        } catch (err) {
          lastError = (err && err.message) || lastError || 'Socials network error';
          syncRowSocialsSlotEarly(row);
        }
      }

      const msg = `Enrich done — enhance updated ${enhanceOk}/${total}, socials found on ${socialOk}/${total}.`;
      showBulkBarFeedbackEarly(msg, enhanceOk || socialOk ? 'success' : 'error');
      setEnrichLeadsButtonsState(
        btns,
        enhanceOk || socialOk ? `Done ${Math.max(enhanceOk, socialOk)}` : 'No new data',
      );
      socialBtns.forEach((b) => {
        b.innerHTML = `<span class="text-[10px] font-black uppercase tracking-widest">${
          socialOk > 0 ? `Found ${socialOk}` : 'No matches'
        }</span>`;
      });
      if (!enhanceOk && !socialOk && lastError && typeof window.showAppToast === 'function') {
        window.showAppToast(lastError, { variant: 'warning', duration: 9000 });
      } else if (typeof window.showAppToast === 'function') {
        window.showAppToast(msg, {
          variant: enhanceOk || socialOk ? 'success' : 'info',
          duration: 8000,
        });
      }
      restoreAll(3600);
    } catch (err) {
      const msg = (err && err.message) || 'Enrich failed.';
      showBulkBarFeedbackEarly(msg, 'error');
      setEnrichLeadsButtonsState(btns, 'Failed');
      restoreAll(3200);
    }
  }

  // Back-compat aliases (Enrich leads no longer uses Chrome website queue).
  async function runBulkScrapeWebsitesFromBarEarly() {
    return runBulkEnrichLeadsApiFromBarEarly();
  }
  window.__runBulkScrapeWebsitesFromBarEarly = runBulkScrapeWebsitesFromBarEarly;
  window.__runBulkEnrichLeadsFromBarEarly = runBulkEnrichLeadsApiFromBarEarly;

  async function runBulkSocialFromBarEarly() {
    if (window.__bulkSocialEnrichInFlight) return;
    if (typeof window.__runBulkSocialEnrichmentSelectedLeadsImpl === 'function') {
      return window.__runBulkSocialEnrichmentSelectedLeadsImpl();
    }

    const leadKeys = collectSelectedLeadKeysEarly().slice(0, 25);
    if (!leadKeys.length) {
      showBulkBarFeedbackEarly('Select at least one saved lead to find social profiles.', 'error');
      return;
    }

    const socialBtns = document.querySelectorAll('.js-bulk-socials');
    const btnSnap = Array.from(socialBtns).map((b) => b.innerHTML);
    const loadingHtml =
      '<span class="text-[10px] font-black uppercase tracking-widest animate-pulse">Finding…</span>';

    window.__bulkSocialEnrichInFlight = true;
    socialBtns.forEach((b) => {
      b.disabled = true;
      b.classList.add('loading');
      b.innerHTML = loadingHtml;
    });
    showBulkBarFeedbackEarly(
      `Searching social profiles for ${leadKeys.length} lead${leadKeys.length === 1 ? '' : 's'}…`,
      'loading',
    );

    let successCount = 0;
    let attemptedCount = 0;
    let lastError = '';

    try {
      for (const key of leadKeys) {
        attemptedCount += 1;
        const row = findResultRowByLeadKeyEarly(key);
        const slot = row && row.querySelector('.lead-cell-socials-content');
        if (slot) {
          slot.innerHTML =
            '<span class="text-[9px] font-bold text-pink-400 uppercase tracking-widest animate-pulse">Searching…</span>';
        }
        try {
          const res = await fetch(`/leads/${encodeURIComponent(key)}/enrich-socials`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
          });
          const result = await res.json().catch(() => ({}));
          if (result.error) lastError = String(result.error);
          const d = result.lead;
          const ok = res.ok && result.success && d && !result.skipped;
          if (ok) successCount += 1;
          if (d && row) {
            applySocialEnrichDataToRowEarly(row, d);
            syncRowSocialsSlotEarly(row);
          } else if (row) {
            syncRowSocialsSlotEarly(row);
          }
        } catch (err) {
          lastError = (err && err.message) || lastError || 'Network error';
          if (row) syncRowSocialsSlotEarly(row);
        }
      }
    } finally {
      window.__bulkSocialEnrichInFlight = false;
    }

    const summaryLabel =
      successCount > 0 ? `Found ${successCount}` : attemptedCount > 0 ? 'No matches' : 'Done';
    socialBtns.forEach((b) => {
      b.innerHTML = `<span class="text-[10px] font-black uppercase tracking-widest">${summaryLabel}</span>`;
    });

    if (successCount > 0) {
      showBulkBarFeedbackEarly(
        `Added social links on ${successCount} lead${successCount === 1 ? '' : 's'}. Click icons in the Socials column to DM.`,
        'success',
      );
    } else if (attemptedCount > 0) {
      showBulkBarFeedbackEarly(
        lastError ||
          'No matching Instagram, TikTok, or X profiles found. Add a TikHub API key under Workspace → Integrations.',
        'error',
      );
    }

    setTimeout(() => {
      socialBtns.forEach((b, i) => {
        b.classList.remove('loading');
        b.disabled = false;
        b.innerHTML = btnSnap[i] || b.innerHTML;
      });
    }, 2800);
  }
  window.__runBulkSocialFromBarEarly = runBulkSocialFromBarEarly;

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
      runBulkEmailFromBarEarly();
    }
  }

  /** Fallback when app.js bulk folder handlers are not ready yet. */
  function normalizeLeadKeyForBoardApi(key) {
    const k = String(key || '').trim();
    if (!k) return '';
    return k.startsWith('lead:') ? k : 'lead:' + k;
  }

  function applyPipelineStageToRowEarly(row, stageId, pipelineStage) {
    if (!row || !stageId) return;
    const sid = String(stageId).trim();
    row.dataset.stageId = sid;
    if (pipelineStage != null) row.dataset.pipelineStage = String(pipelineStage);
    const labels = window.PIPELINE_STAGE_LABELS || {};
    const fullName = labels[sid] || '';
    const short =
      (fullName.split('(')[0].trim().slice(0, 22)) + (fullName.length > 22 ? '…' : '');
    row.dataset.pipelineLabel = short;
    const pipeSel = row.querySelector('.pipeline-inline-select');
    if (pipeSel) pipeSel.value = sid;
    const cell = row.querySelector('.pipeline-stage-label');
    if (cell) cell.textContent = short || 'Stage';
    const wrap = row.querySelector('.pipeline-stage-pill-wrap');
    if (wrap) {
      const dot =
        (window.PIPELINE_STAGE_COLORS && window.PIPELINE_STAGE_COLORS[sid]) || '#94a3b8';
      wrap.style.boxShadow = 'inset 3px 0 0 ' + dot;
    }
  }

  function findLeadRowForBoardKey(key) {
    const k = String(key || '').trim();
    if (!k) return null;
    const variants = [k, k.replace(/^lead:/i, ''), 'lead:' + k.replace(/^lead:/i, '')];
    for (let i = 0; i < variants.length; i += 1) {
      const v = variants[i];
      const row = document.querySelector(
        '#prospectLeadsTable tr.result-row[data-lead-key="' +
          CSS.escape(v) +
          '"], tr.result-row[data-lead-key="' +
          CSS.escape(v) +
          '"]',
      );
      if (row) return row;
    }
    return null;
  }

  async function runBulkAddToBoardFromBarEarly() {
    if (typeof window.__bulkAddToBoardFromBar === 'function') {
      return window.__bulkAddToBoardFromBar();
    }

    const keys = collectSelectedLeadKeysEarly();
    if (!keys.length) {
      showBulkBarFeedbackEarly('Select at least one lead.', 'error');
      return;
    }
    const stageEl = document.getElementById('bulkPipelineStageSelect');
    const stageId = stageEl && stageEl.value ? String(stageEl.value).trim() : '';
    if (!stageId) {
      showBulkBarFeedbackEarly('Choose a pipeline stage first.', 'error');
      return;
    }
    const stageName =
      (stageEl &&
        stageEl.options &&
        stageEl.options[stageEl.selectedIndex] &&
        stageEl.options[stageEl.selectedIndex].textContent &&
        String(stageEl.options[stageEl.selectedIndex].textContent).trim()) ||
      (window.PIPELINE_STAGE_LABELS && window.PIPELINE_STAGE_LABELS[stageId]) ||
      'pipeline board';
    const folderEl = document.getElementById('bulkFolderSelect');
    const folderKey = folderEl && folderEl.value ? String(folderEl.value).trim() : '';
    const viewingFolder =
      typeof window.PROSPECTING_ACTIVE_FOLDER_KEY === 'string'
        ? window.PROSPECTING_ACTIVE_FOLDER_KEY.trim()
        : '';
    const btn = document.getElementById('bulkAddToBoardBtn');
    const n = keys.length;
    if (btn) {
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
    }
    if (typeof window.__flashBulkBarBtn === 'function' && btn) {
      window.__flashBulkBarBtn(btn, 'Saving…', 12000);
    }
    showBulkBarFeedbackEarly(
      'Adding ' + n + ' lead' + (n === 1 ? '' : 's') + ' to ' + stageName + '…',
      'loading',
    );
    try {
      const res = await fetch('/leads/bulk-stage-assign', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          leadKeys: keys.map(normalizeLeadKeyForBoardApi).filter(Boolean),
          stageId: stageId,
          ...(folderKey ? { folderKey: folderKey } : {}),
        }),
      });
      const data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data.success) {
        throw new Error((data && data.error) || 'HTTP ' + res.status);
      }
      const updated = Array.isArray(data.leads) ? data.leads : [];
      const updatedKeys = Array.isArray(data.updatedKeys) ? data.updatedKeys : [];
      if (!updatedKeys.length) {
        throw new Error('No leads were updated. Refresh the page and try again.');
      }

      updated.forEach(function (item) {
        if (!item || !item.key) return;
        const row = findLeadRowForBoardKey(item.key);
        if (!row) return;
        applyPipelineStageToRowEarly(row, item.stageId || stageId, item.pipelineStage);
        if (typeof window.__markRowOnPipelineBoard === 'function') {
          window.__markRowOnPipelineBoard(row);
        } else {
          row.dataset.onPipelineBoard = '1';
        }
        if (folderKey && viewingFolder && folderKey !== viewingFolder) {
          row.remove();
        }
      });

      window.__pipelineKanbanFocusKeys = null;

      const msg =
        'Saved ' + updatedKeys.length + ' lead' + (updatedKeys.length === 1 ? '' : 's') + ' to ' + stageName;
      showBulkBarFeedbackEarly(msg, 'success');
      if (typeof window.showProspectToast === 'function') window.showProspectToast(msg);
      if (typeof window.__flashBulkBarBtn === 'function' && btn) {
        window.__flashBulkBarBtn(btn, 'Saved ✓', 2200);
      }

      if (folderKey && folderKey !== viewingFolder) {
        try {
          sessionStorage.setItem('adhello_kanban_focus_keys', JSON.stringify(updatedKeys));
        } catch (_) {}
        window.location.href =
          '/prospecting?tab=pipeline&folderKey=' +
          encodeURIComponent(folderKey) +
          '&view=kanban&boardFocus=1';
        return;
      }

      if (typeof window.__adhelloSetPipelineView === 'function') {
        window.__adhelloSetPipelineView('kanban');
      } else if (typeof window.__adhelloInitKanban === 'function') {
        window.__adhelloInitKanban();
      }
      if (typeof window.refreshPipelineKanbanIfNeeded === 'function') {
        window.refreshPipelineKanbanIfNeeded();
      }
      requestAnimationFrame(function () {
        if (typeof window.__adhelloInitKanban === 'function') window.__adhelloInitKanban();
      });
      const kanbanEl = document.getElementById('kanbanView');
      if (kanbanEl && typeof kanbanEl.scrollIntoView === 'function') {
        kanbanEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }

      document
        .querySelectorAll('.lead-checkbox:checked, .row-checkbox:checked')
        .forEach(function (cb) {
          cb.checked = false;
        });
      if (typeof window.__syncBulkBarFromDom === 'function') {
        window.__syncBulkBarFromDom();
      } else if (typeof window.__updateBulkActionBar === 'function') {
        window.__updateBulkActionBar();
      }
    } catch (err) {
      console.error('[pipeline-bulk-select] bulk board failed:', err);
      showBulkBarFeedbackEarly(
        (err && err.message) || 'Could not add selected leads to the pipeline board.',
        'error',
      );
      if (typeof window.__flashBulkBarBtn === 'function' && btn) {
        window.__flashBulkBarBtn(btn, 'Failed', 1600);
      }
    } finally {
      if (btn) {
        btn.removeAttribute('aria-busy');
        btn.disabled = collectSelectedLeadKeysEarly().length === 0;
      }
    }
  }
  window.__runBulkAddToBoardFromBarEarly = runBulkAddToBoardFromBarEarly;

  async function runBulkMoveFolderFromBarEarly() {
    if (
      document.getElementById('searchResultsLeadsTable') &&
      typeof window.__bulkMoveSearchResultsToFolder === 'function'
    ) {
      return window.__bulkMoveSearchResultsToFolder();
    }

    const keys = collectSelectedLeadKeysEarly();
    if (!keys.length) {
      window.alert('Select at least one lead.');
      return;
    }
    const select = document.getElementById('bulkFolderSelect');
    const folderKey = select && select.value ? String(select.value).trim() : '';
    if (!folderKey) {
      window.alert('Select a folder from the dropdown first.');
      return;
    }
    const btn = document.getElementById('bulkMoveFolderBtn');
    if (btn) btn.disabled = true;
    try {
      const res = await fetch('/folders/assign-bulk', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ leadKeys: keys, folderKey }),
      });
      const data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data.success) {
        throw new Error((data && data.error) || 'HTTP ' + res.status);
      }
      const updated = Array.isArray(data.updatedKeys) ? data.updatedKeys.length : 0;
      if (!updated) {
        throw new Error('No leads were moved. Refresh the page and try again.');
      }
      if (typeof window.showProspectToast === 'function') {
        window.showProspectToast('Moved ' + updated + ' lead(s) to folder');
      }
      if (typeof window.__syncBulkBarFromDom === 'function') {
        window.__syncBulkBarFromDom();
      }
    } catch (err) {
      window.alert((err && err.message) || 'Could not move leads to folder.');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function runBulkSaveFolderFromBarEarly(triggerBtn) {
    if (
      document.getElementById('searchResultsLeadsTable') &&
      typeof window.__bulkSaveSearchResultsToFolder === 'function'
    ) {
      return window.__bulkSaveSearchResultsToFolder(triggerBtn);
    }
    if (typeof window.__bulkSaveSelectedLeads === 'function') {
      return window.__bulkSaveSelectedLeads(triggerBtn);
    }
    return runBulkMoveFolderFromBarEarly();
  }

  function bindBulkBoardButtonDirect() {
    const btn = document.getElementById('bulkAddToBoardBtn');
    if (!btn || btn.dataset.plcBoardBound === '1') return;
    btn.dataset.plcBoardBound = '1';
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      void runBulkAddToBoardFromBarEarly();
    });
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
        if (!e.target || !e.target.closest) return;
        // Top toolbar "Enrich leads" (outside the floating bulk bar).
        if (e.target.closest('.js-enhance-missing-contacts')) {
          e.preventDefault();
          e.stopPropagation();
          void runBulkScrapeWebsitesFromBarEarly();
          return;
        }

        const bar = document.getElementById('bulkActionBar');
        if (!bar || bar.dataset.visible !== 'true') return;
        if (!e.target.closest('#bulkActionBar')) return;

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
        if (e.target.closest('#bulkMoveFolderBtn')) {
          e.preventDefault();
          e.stopPropagation();
          if (typeof window.__bulkMoveFolderFromBar === 'function') {
            void window.__bulkMoveFolderFromBar();
          } else {
            void runBulkMoveFolderFromBarEarly();
          }
          return;
        }
        if (e.target.closest('#bulkAddToBoardBtn')) {
          e.preventDefault();
          e.stopPropagation();
          void runBulkAddToBoardFromBarEarly();
          return;
        }
        if (e.target.closest('#bulkSaveBtn')) {
          e.preventDefault();
          e.stopPropagation();
          const btn = e.target.closest('#bulkSaveBtn');
          if (typeof window.__bulkSaveSelectedLeads === 'function') {
            void window.__bulkSaveSelectedLeads(btn);
          } else {
            void runBulkSaveFolderFromBarEarly(btn);
          }
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
        if (e.target.closest('#bulkCategoryToggle')) {
          e.preventDefault();
          e.stopPropagation();
          if (typeof window.__toggleBulkCategoryRow === 'function') {
            window.__toggleBulkCategoryRow();
          }
          return;
        }
        if (e.target.closest('#bulkCategoryCancel')) {
          e.preventDefault();
          e.stopPropagation();
          if (typeof window.__setBulkCategoryRowVisible === 'function') {
            window.__setBulkCategoryRowVisible(false);
          }
          return;
        }
        if (e.target.closest('#bulkCategoryApplyBtn')) {
          e.preventDefault();
          e.stopPropagation();
          if (typeof window.__bulkSetCategoryFromBar === 'function') {
            void window.__bulkSetCategoryFromBar();
          }
          return;
        }
        if (e.target.closest('#bulkTagsCancel')) {
          e.preventDefault();
          e.stopPropagation();
          if (typeof window.__setBulkTagsRowVisible === 'function') {
            window.__setBulkTagsRowVisible(false);
          }
          return;
        }
        if (e.target.closest('#bulkTagAddBtn')) {
          e.preventDefault();
          e.stopPropagation();
          if (typeof window.__runBulkTagFromBar === 'function') {
            void window.__runBulkTagFromBar('add');
          }
          return;
        }
        if (e.target.closest('#bulkTagRemoveBtn')) {
          e.preventDefault();
          e.stopPropagation();
          if (typeof window.__runBulkTagFromBar === 'function') {
            void window.__runBulkTagFromBar('remove');
          }
          return;
        }
        if (e.target.closest('#bulkTagNewSave')) {
          e.preventDefault();
          e.stopPropagation();
          if (typeof window.__bulkTagCreateAndAddFromBar === 'function') {
            void window.__bulkTagCreateAndAddFromBar();
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
        if (e.target.closest('#bulkCreateSubaccountBtn')) {
          e.preventDefault();
          e.stopPropagation();
          runBulkCreateSubaccountFromBarEarly();
          return;
        }
        if (e.target.closest('#bulkAutoOutreachBtn')) {
          e.preventDefault();
          e.stopPropagation();
          runBulkAutoOutreachFromBarEarly();
          return;
        }
        if (e.target.closest('#bulkSmsBtn')) {
          handleBulkPrimaryActionClick(e, 'sms');
          return;
        }
        if (e.target.closest('#bulkEmailBtn')) {
          handleBulkPrimaryActionClick(e, 'email');
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
        if (e.target.closest('#bulkMergeBtn')) {
          e.preventDefault();
          e.stopPropagation();
          bulkMergeSelectedLeads();
          return;
        }
        if (e.target.closest('#bulkBookmarkBtn')) {
          e.preventDefault();
          e.stopPropagation();
          void bulkBookmarkSelectedLeads();
          return;
        }
        if (e.target.closest('.js-bulk-enhance')) {
          e.preventDefault();
          e.stopPropagation();
          void runBulkEnhanceFromBarEarly();
          return;
        }
        if (
          e.target.closest('.js-bulk-scrape-websites') ||
          e.target.closest('.js-bulk-enrich-leads')
        ) {
          e.preventDefault();
          e.stopPropagation();
          void runBulkScrapeWebsitesFromBarEarly();
          return;
        }
        if (e.target.closest('.js-bulk-socials')) {
          e.preventDefault();
          e.stopPropagation();
          void runBulkSocialFromBarEarly();
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
        if (e.target.closest('#bulkAddToBoardBtn')) {
          e.preventDefault();
          e.stopPropagation();
          void runBulkAddToBoardFromBarEarly();
          return;
        }
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
        if (e.target.closest('#bulkEmailBtn')) {
          handleBulkPrimaryActionClick(e, 'email');
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
        if (e.target && e.target.id === 'bulkTagNewName') {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (typeof window.__bulkTagCreateAndAddFromBar === 'function') {
              void window.__bulkTagCreateAndAddFromBar();
            }
          }
          return;
        }
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

  window.__PIPELINE_BULK_SELECT_V2 = '16';
  window.__pipelineBulkSelectApply = applySelectAll;
  window.__applySelectAllLeads = applySelectAll;

  window.addEventListener('agency-os-bulk-enhance-progress', (ev) => {
    const d = ev.detail || {};
    const total = d.total || 0;
    const index = d.index != null ? d.index : 0;
    if (!total) return;
    showBulkBarFeedbackEarly(
      `Enhancing via API ${index + 1}/${total} (no new tabs)…`,
      'loading',
    );
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
