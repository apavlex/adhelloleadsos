/**
 * Pipeline kanban board — loads before app.js so Table → Pipeline always populates cards.
 */
(function () {
  'use strict';

  if (window.__adhelloPipelineKanbanBound) return;
  window.__adhelloPipelineKanbanBound = true;

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function readColumnStageId(columnEl, index) {
    if (!columnEl) return '';
    const fromAttr = String(columnEl.getAttribute('data-pipeline-stage') || '').trim();
    if (fromAttr) return fromAttr;
    const fromDataset = String(columnEl.dataset.pipelineStage || '').trim();
    if (fromDataset) return fromDataset;
    const fromWindow =
      Array.isArray(window.PIPELINE_STAGES) && window.PIPELINE_STAGES[index]
        ? window.PIPELINE_STAGES[index]
        : null;
    return fromWindow && fromWindow.id ? String(fromWindow.id).trim() : '';
  }

  function leadRecordToRowShape(lead) {
    if (!lead || !lead.key) return null;
    const key = String(lead.key).trim();
    const existing = document.querySelector(
      '#prospectLeadsTable tbody tr.result-row[data-lead-key="' +
        CSS.escape(key) +
        '"], tr.result-row[data-lead-key="' +
        CSS.escape(key) +
        '"]',
    );
    if (existing) return existing;

    const row = document.createElement('tr');
    row.className = 'result-row result-row--kanban-bootstrap';
    row.dataset.leadKey = key;
    row.dataset.stageId = lead.stageId ? String(lead.stageId) : '';
    row.dataset.pipelineStage = String(lead.pipelineStage || 1);
    row.dataset.title = lead.title || '';
    row.dataset.rating = String(lead.totalScore || 0);
    row.dataset.website = lead.website || 'N/A';
    row.dataset.category = lead.categoryName || 'N/A';
    row.dataset.status = lead.status || 'Not Contacted';
    return row;
  }

  function getKanbanRowSources() {
    const table = document.getElementById('prospectLeadsTable');
    if (table) {
      const rows = Array.from(
        table.querySelectorAll('tbody tr.result-row:not(.result-row--panel-source)'),
      );
      if (rows.length) return rows;
    }

    if (Array.isArray(window.INITIAL_SAVED_LEADS) && window.INITIAL_SAVED_LEADS.length) {
      return window.INITIAL_SAVED_LEADS.map(leadRecordToRowShape).filter(Boolean);
    }
    return [];
  }

  function resolveRowColumnIndex(row, stageIds) {
    if (!stageIds.length) return 0;
    const sid = String(row.dataset.stageId || row.getAttribute('data-stage-id') || '').trim();
    if (sid) {
      const exact = stageIds.indexOf(sid);
      if (exact >= 0) return exact;
    }
    let ps = parseInt(row.dataset.pipelineStage || row.getAttribute('data-pipeline-stage'), 10);
    if (Number.isNaN(ps) || ps < 1) ps = 1;
    if (ps > stageIds.length) ps = stageIds.length;
    return ps - 1;
  }

  function activateKanbanRow(row) {
    if (typeof window.selectRow === 'function') {
      window.selectRow(row);
      return;
    }
    if (typeof window.__pipelineRowActivate === 'function') {
      window.__pipelineRowActivate({ stopPropagation: function () {} }, row);
    }
  }

  function createKanbanCard(row) {
    const card = document.createElement('div');
    card.className =
      'kanban-card kanban-card--lift p-4 bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-brand-border/10 cursor-grab active:cursor-grabbing hover:border-brand-yellow/50 transition-all duration-150 group';
    const leadKey = String((row && row.dataset && row.dataset.leadKey) || '').trim();
    card.dataset.leadKey = leadKey;

    const title = escapeHtml((row && row.dataset && row.dataset.title) || 'Untitled');
    const website = escapeHtml((row && row.dataset && row.dataset.website) || '—');
    const category = escapeHtml((row && row.dataset && row.dataset.category) || '');

    card.innerHTML =
      '<div class="flex items-center justify-between mb-3">' +
      '<span class="text-[9px] font-black uppercase tracking-widest text-brand-muted">' +
      category +
      '</span></div>' +
      '<h4 class="text-sm font-black text-brand-dark dark:text-white mb-1 truncate">' +
      title +
      '</h4>' +
      '<div class="text-[10px] text-brand-muted font-bold truncate mb-3">' +
      website +
      '</div>';

    card.addEventListener('click', function () {
      activateKanbanRow(row);
    });
    return card;
  }

  function bindSortable(col, columnWrap) {
    if (typeof Sortable === 'undefined') return;
    if (typeof Sortable.get === 'function') {
      const existing = Sortable.get(col);
      if (existing && typeof existing.destroy === 'function') existing.destroy();
    }
    Sortable.create(col, {
      group: 'leads',
      animation: 150,
      ghostClass: 'opacity-50',
      onEnd: function (evt) {
        const item = evt.item;
        const toCol =
          (evt.to && evt.to.closest && evt.to.closest('.kanban-column')) ||
          (evt.to && evt.to.parentElement) ||
          null;
        const key = item && item.dataset ? item.dataset.leadKey : '';
        if (!key || !toCol) return;
        const newStageId = String(toCol.dataset.pipelineStage || '').trim();
        if (!newStageId) return;
        fetch('/leads/' + encodeURIComponent(key) + '/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            stageId: newStageId,
            pipelineStageUpdatedAt: new Date().toISOString(),
          }),
        })
          .then(function (res) {
            return res.json();
          })
          .then(function (data) {
            if (!data || !data.success) return;
            const originalRow = document.querySelector('.result-row[data-lead-key="' + CSS.escape(key) + '"]');
            if (!originalRow) return;
            originalRow.dataset.stageId = newStageId;
            if (data.lead && data.lead.pipelineStage != null) {
              originalRow.dataset.pipelineStage = String(data.lead.pipelineStage);
            }
          })
          .catch(function () {});
      },
    });
  }

  function bindAllSortables() {
    document
      .querySelectorAll('#kanbanView[data-kanban-mode="pipeline"] .kanban-column')
      .forEach(function (columnWrap) {
        const col = columnWrap.querySelector('.kanban-list');
        if (!col) return;
        bindSortable(col, columnWrap);
      });
  }

  function buildPipelineKanbanBoard() {
    const kanbanRoot = document.querySelector('#kanbanView[data-kanban-mode="pipeline"]');
    if (!kanbanRoot) return 0;

    const columnEls = Array.from(kanbanRoot.querySelectorAll('.kanban-column'));
    if (!columnEls.length) return 0;

    const stageIds = columnEls.map(function (el, idx) {
      return readColumnStageId(el, idx);
    });
    const rows = getKanbanRowSources();
    const buckets = columnEls.map(function () {
      return [];
    });

    rows.forEach(function (row) {
      let idx = resolveRowColumnIndex(row, stageIds);
      if (idx < 0) idx = 0;
      if (idx >= buckets.length) idx = buckets.length - 1;
      buckets[idx].push(row);
    });

    if (rows.length > 0 && buckets.every(function (bucket) {
      return bucket.length === 0;
    })) {
      buckets[0] = rows.slice();
    }

    columnEls.forEach(function (columnWrap, idx) {
      const col = columnWrap.querySelector('.kanban-list');
      if (!col) return;
      col.innerHTML = '';
      (buckets[idx] || []).forEach(function (row) {
        col.appendChild(createKanbanCard(row));
      });
      const countBadge = columnWrap.querySelector('.column-count');
      if (countBadge) countBadge.textContent = String((buckets[idx] || []).length);
    });

    if (typeof Sortable !== 'undefined') {
      bindAllSortables();
    } else if (typeof window.__ensureSortableJs === 'function') {
      window.__ensureSortableJs()
        .then(bindAllSortables)
        .catch(function () {});
    }

    if (typeof window.__adhelloEnhanceKanbanCards === 'function') {
      window.__adhelloEnhanceKanbanCards();
    }

    return rows.length;
  }

  function isKanbanVisible() {
    const kanbanViewEl = document.getElementById('kanbanView');
    if (!kanbanViewEl) return false;
    if (document.documentElement.classList.contains('adhello-pipeline-view-kanban')) return true;
    return !kanbanViewEl.classList.contains('hidden');
  }

  function initKanban() {
    if (!document.querySelector('#kanbanView[data-kanban-mode="pipeline"]')) return 0;
    return buildPipelineKanbanBoard();
  }

  window.__adhelloBuildPipelineKanbanBoard = buildPipelineKanbanBoard;
  window.__adhelloInitKanban = initKanban;
  window.refreshPipelineKanbanIfNeeded = function refreshPipelineKanbanIfNeeded() {
    if (!isKanbanVisible()) return;
    initKanban();
  };

  document.addEventListener('adhello-pipeline-view-change', function (e) {
    if (e && e.detail && e.detail.mode === 'kanban') {
      initKanban();
    }
  });

  document.addEventListener('adhello-pipeline-prefs-ready', function () {
    if (isKanbanVisible()) initKanban();
  });

  function bootWhenTableReady(attempt) {
    var n = typeof attempt === 'number' ? attempt : 0;
    var table = document.getElementById('prospectLeadsTable');
    var rowCount = table
      ? table.querySelectorAll('tbody tr.result-row:not(.result-row--panel-source)').length
      : 0;
    var bootstrapCount = Array.isArray(window.INITIAL_SAVED_LEADS) ? window.INITIAL_SAVED_LEADS.length : 0;
    if (isKanbanVisible() && (rowCount > 0 || bootstrapCount > 0)) {
      initKanban();
      return;
    }
    if (n < 80) {
      window.setTimeout(function () {
        bootWhenTableReady(n + 1);
      }, 50);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      bootWhenTableReady(0);
    });
  } else {
    bootWhenTableReady(0);
  }
})();
