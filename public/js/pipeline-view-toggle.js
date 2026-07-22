/**
 * Table ↔ Pipeline board toggle — loaded before app.js so the switch always works.
 */
(function () {
  'use strict';

  if (window.__adhelloPipelineViewToggleBound) return;
  window.__adhelloPipelineViewToggleBound = true;

  var SEG_ACTIVE = ['bg-brand-yellow', 'text-brand-dark', 'shadow-sm'];
  var SEG_INACTIVE = ['text-brand-muted', 'dark:text-slate-400'];

  function resolveInitialPipelineView() {
    try {
      var params = new URLSearchParams(window.location.search || '');
      var explicit = params.get('view');
      if (explicit === 'kanban') return 'kanban';
      if (explicit === 'table') return 'table';
      if (params.get('folderKey')) return 'table';
      return sessionStorage.getItem('adhello_pipeline_view');
    } catch (_) {
      return null;
    }
  }

  function syncToggleButtons(showKanban) {
    var showTableBtn = document.getElementById('showTableView');
    var showKanbanBtn = document.getElementById('showKanbanView');
    [showTableBtn, showKanbanBtn].forEach(function (btn) {
      if (!btn) return;
      var active = showKanban ? btn === showKanbanBtn : btn === showTableBtn;
      SEG_ACTIVE.forEach(function (cls) {
        btn.classList.toggle(cls, active);
      });
      SEG_INACTIVE.forEach(function (cls) {
        btn.classList.toggle(cls, !active);
      });
    });
  }

  function bootKanbanWhenReady() {
    var attempts = 0;
    function tryBoot() {
      if (typeof window.__adhelloInitKanban === 'function') {
        window.__adhelloInitKanban();
        if (typeof window.__ensureSortableJs === 'function') {
          window.__ensureSortableJs().catch(function () {});
        }
        return;
      }
      if (++attempts < 120) {
        window.setTimeout(tryBoot, 50);
      }
    }
    tryBoot();
  }

  function setPipelineView(mode, opts) {
    var options = opts || {};
    var tableView = document.getElementById('tableView');
    var kanbanView = document.getElementById('kanbanView');
    if (!tableView || !kanbanView) {
      return false;
    }
    var showKanban = mode === 'kanban';
    tableView.classList.toggle('hidden', showKanban);
    kanbanView.classList.toggle('hidden', !showKanban);
    syncToggleButtons(showKanban);
    if (!showKanban) {
      try {
        delete window.__pipelineKanbanFocusKeys;
      } catch (_) {
        window.__pipelineKanbanFocusKeys = null;
      }
    } else if (!options.keepFocusKeys) {
      try {
        delete window.__pipelineKanbanFocusKeys;
      } catch (_) {
        window.__pipelineKanbanFocusKeys = null;
      }
    }
    try {
      sessionStorage.setItem('adhello_pipeline_view', showKanban ? 'kanban' : 'table');
    } catch (_) {}
    if (showKanban) {
      bootKanbanWhenReady();
    }
    try {
      document.dispatchEvent(
        new CustomEvent('adhello-pipeline-view-change', { detail: { mode: showKanban ? 'kanban' : 'table' } }),
      );
    } catch (_) {}
    return true;
  }

  window.__adhelloSetPipelineView = setPipelineView;

  document.addEventListener(
    'click',
    function (e) {
      var btn =
        e.target && e.target.closest
          ? e.target.closest('#showTableView, #showKanbanView')
          : null;
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      setPipelineView(btn.id === 'showKanbanView' ? 'kanban' : 'table');
    },
    true,
  );

  function restoreSavedView() {
    try {
      var preferred = resolveInitialPipelineView();
      if (preferred === 'table') {
        setPipelineView('table');
        return;
      }
      if (
        preferred === 'kanban' ||
        document.documentElement.classList.contains('adhello-pipeline-view-kanban')
      ) {
        setPipelineView('kanban');
      }
    } catch (_) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', restoreSavedView);
  } else {
    restoreSavedView();
  }
})();
