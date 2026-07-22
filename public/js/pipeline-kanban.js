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

  function isRowOnPipelineBoard(row) {
    if (!row) return false;
    const ds = row.dataset || {};
    if (ds.onPipelineBoard === '1' || ds.onPipelineBoard === 'true') return true;
    const key = String(ds.leadKey || '').trim();
    if (key && window.__pipelineBoardKeys && window.__pipelineBoardKeys.has(key)) return true;
    return false;
  }

  function markRowOnPipelineBoard(row) {
    if (!row) return;
    row.dataset.onPipelineBoard = '1';
    const key = String(row.dataset.leadKey || '').trim();
    if (!key) return;
    if (!window.__pipelineBoardKeys) window.__pipelineBoardKeys = new Set();
    window.__pipelineBoardKeys.add(key);
  }

  function markLeadsOnPipelineBoard(keys) {
    if (!Array.isArray(keys)) return;
    keys.forEach(function (key) {
      const k = String(key || '').trim();
      if (!k) return;
      const bare = k.replace(/^lead:/i, '');
      const variants = [k, bare, 'lead:' + bare];
      let row = null;
      for (let i = 0; i < variants.length; i += 1) {
        row = document.querySelector(
          '.result-row[data-lead-key="' + CSS.escape(variants[i]) + '"]',
        );
        if (row) break;
      }
      if (row) {
        markRowOnPipelineBoard(row);
      } else {
        if (!window.__pipelineBoardKeys) window.__pipelineBoardKeys = new Set();
        window.__pipelineBoardKeys.add(k);
      }
    });
  }

  function hydratePipelineBoardKeysFromDom() {
    if (!window.__pipelineBoardKeys) window.__pipelineBoardKeys = new Set();
    document.querySelectorAll('.result-row[data-on-pipeline-board="1"]').forEach(function (row) {
      const key = String(row.dataset.leadKey || '').trim();
      if (key) window.__pipelineBoardKeys.add(key);
    });
  }

  window.__markRowOnPipelineBoard = markRowOnPipelineBoard;
  window.__markLeadsOnPipelineBoard = markLeadsOnPipelineBoard;

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
    row.dataset.phone = lead.phone || 'N/A';
    row.dataset.email = lead.email || 'N/A';
    row.dataset.url = lead.url || '';
    row.dataset.address = lead.address || 'N/A';
    row.dataset.city = lead.city || '';
    row.dataset.facebook = lead.facebook || 'N/A';
    row.dataset.instagram = lead.instagram || 'N/A';
    row.dataset.twitter = lead.twitter || 'N/A';
    if (lead.onPipelineBoard) row.dataset.onPipelineBoard = '1';
    return row;
  }

  function getKanbanRowSources() {
    hydratePipelineBoardKeysFromDom();
    const table = document.getElementById('prospectLeadsTable');
    if (table) {
      const rows = Array.from(
        table.querySelectorAll('tbody tr.result-row:not(.result-row--panel-source)'),
      ).filter(isRowOnPipelineBoard);
      if (rows.length) return rows;
    }

    if (Array.isArray(window.INITIAL_SAVED_LEADS) && window.INITIAL_SAVED_LEADS.length) {
      return window.INITIAL_SAVED_LEADS.filter(function (lead) {
        return lead && lead.onPipelineBoard;
      })
        .map(leadRecordToRowShape)
        .filter(Boolean);
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

  function isBlankContact(value) {
    const s = String(value || '').trim();
    return !s || s === 'N/A' || s === '—' || s === 'undefined';
  }

  function googleMapsHrefFromDataset(ds) {
    const raw = String((ds && ds.url) || '').trim();
    function isGmListing(absUrl) {
      try {
        const u = new URL(absUrl);
        const h = u.hostname.replace(/^www\./i, '').toLowerCase();
        if (h === 'maps.app.goo.gl') return true;
        if (h === 'goo.gl' && u.pathname.includes('maps')) return true;
        if (h.endsWith('google.com') || h.endsWith('google.co.uk')) {
          if (u.pathname.includes('/maps/')) return true;
          if (u.search.includes('cid=') || u.search.includes('q=place_id:')) return true;
        }
        return false;
      } catch (_) {
        return false;
      }
    }
    if (raw && /^https?:\/\//i.test(raw) && isGmListing(raw)) return raw;
    const title = String((ds && ds.title) || '').trim();
    const address = String((ds && ds.address) || '').trim();
    const city = String((ds && ds.city) || '').trim();
    if (address && address !== 'N/A') {
      return (
        'https://www.google.com/maps/search/?api=1&query=' +
        encodeURIComponent((address + ' ' + title).trim())
      );
    }
    if (title && city) {
      return (
        'https://www.google.com/maps/search/?api=1&query=' +
        encodeURIComponent((title + ' ' + city).trim())
      );
    }
    if (title) {
      return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(title);
    }
    return '';
  }

  function buildKanbanSocialsHtml(row, leadKey) {
    const slot = row.querySelector('.lead-cell-socials-content');
    if (slot && slot.children.length) {
      return (
        '<div class="kanban-card-socials flex flex-wrap items-center gap-1.5">' + slot.innerHTML + '</div>'
      );
    }
    const ds = row.dataset || {};
    if (window.AdhelloSocialBrand && typeof window.AdhelloSocialBrand.renderLinks === 'function') {
      const html = window.AdhelloSocialBrand.renderLinks({
        gm: googleMapsHrefFromDataset(ds),
        fb: ds.facebook,
        ig: ds.instagram,
        tw: ds.twitter,
        gradSuffix: String(leadKey || '').replace(/[^a-z0-9]+/gi, '-'),
        emptyDash: false,
        size: 'table',
      });
      if (html) {
        return '<div class="kanban-card-socials flex flex-wrap items-center gap-1.5">' + html + '</div>';
      }
    }
    return '';
  }

  function buildKanbanContactHtml(row, leadKey) {
    const ds = row.dataset || {};
    const phone = String(ds.phone || '').trim();
    const email = String(ds.email || '').trim();

    const phoneInner = isBlankContact(phone)
      ? '<span class="text-[10px] font-semibold text-brand-muted/60 dark:text-slate-500">—</span>'
      : '<button type="button" class="kanban-card-phone flex items-center gap-1.5 min-w-0 max-w-full text-left text-[10px] font-semibold text-brand-dark dark:text-slate-200 hover:text-brand-yellow transition-colors rounded-md focus:outline-none focus:ring-2 focus:ring-brand-yellow/40" data-phone="' +
        escapeHtml(phone) +
        '" data-lead-key="' +
        escapeHtml(leadKey) +
        '" aria-label="Call ' +
        escapeHtml(phone) +
        '"><svg class="w-3.5 h-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg><span class="truncate tabular-nums">' +
        escapeHtml(phone) +
        '</span></button>';

    const emailInner = isBlankContact(email)
      ? '<span class="text-[10px] font-semibold text-brand-muted/60 dark:text-slate-500">—</span>'
      : '<a href="mailto:' +
        escapeHtml(email) +
        '" class="text-[10px] font-bold text-brand-yellow hover:underline truncate block min-w-0" title="' +
        escapeHtml(email) +
        '">' +
        escapeHtml(email) +
        '</a>';

    const socialsHtml = buildKanbanSocialsHtml(row, leadKey);

    return (
      '<div class="kanban-card-contact mt-3 pt-3 border-t border-brand-border/15 dark:border-white/10 space-y-2">' +
      '<div class="flex items-start gap-2 min-w-0">' +
      '<span class="text-[8px] font-black uppercase tracking-widest text-brand-muted dark:text-slate-500 w-10 shrink-0 pt-0.5">Phone</span>' +
      '<div class="min-w-0 flex-1">' +
      phoneInner +
      '</div></div>' +
      '<div class="flex items-start gap-2 min-w-0">' +
      '<span class="text-[8px] font-black uppercase tracking-widest text-brand-muted dark:text-slate-500 w-10 shrink-0 pt-0.5">Email</span>' +
      '<div class="min-w-0 flex-1">' +
      emailInner +
      '</div></div>' +
      (socialsHtml
        ? '<div class="flex items-center gap-1.5 min-w-0 pt-0.5">' + socialsHtml + '</div>'
        : '') +
      '</div>'
    );
  }

  window.__adhelloBuildKanbanContactHtml = buildKanbanContactHtml;

  function wireKanbanCardInteractions(card, row) {
    if (!card) return;
    card.querySelectorAll('.kanban-card-phone').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (typeof window.__adhelloPipelinePhoneClick === 'function') {
          window.__adhelloPipelinePhoneClick(btn, e);
        }
      });
    });
    card.querySelectorAll('a, button').forEach(function (el) {
      if (el.classList.contains('kanban-card-phone')) return;
      el.addEventListener('click', function (e) {
        e.stopPropagation();
      });
    });
    card.addEventListener('click', function (e) {
      if (e.target.closest('a, button')) return;
      activateKanbanRow(row);
    });
  }

  function createKanbanCard(row) {
    const card = document.createElement('div');
    card.className =
      'kanban-card kanban-card--lift p-4 bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-brand-border/10 cursor-grab active:cursor-grabbing hover:border-brand-yellow/50 transition-all duration-150 group';
    const leadKey = String((row && row.dataset && row.dataset.leadKey) || '').trim();
    card.dataset.leadKey = leadKey;

    const title = escapeHtml((row && row.dataset && row.dataset.title) || 'Untitled');
    const websiteRaw = String((row && row.dataset && row.dataset.website) || '').trim();
    const category = escapeHtml((row && row.dataset && row.dataset.category) || '');

    let websiteHtml = '';
    if (!isBlankContact(websiteRaw)) {
      const href = /^https?:\/\//i.test(websiteRaw)
        ? websiteRaw
        : 'https://' + websiteRaw.replace(/^\/+/, '');
      const label = escapeHtml(
        websiteRaw.replace(/^https?:\/\//i, '').split('?')[0].replace(/\/$/, ''),
      );
      websiteHtml =
        '<a href="' +
        escapeHtml(href) +
        '" target="_blank" rel="noopener noreferrer" class="text-[10px] text-brand-muted font-bold truncate block mb-2 hover:text-brand-yellow">' +
        label +
        '</a>';
    }

    card.innerHTML =
      '<div class="flex items-center justify-between mb-3">' +
      '<span class="text-[9px] font-black uppercase tracking-widest text-brand-muted">' +
      category +
      '</span></div>' +
      '<h4 class="text-sm font-black text-brand-dark dark:text-white mb-1 truncate">' +
      title +
      '</h4>' +
      websiteHtml +
      buildKanbanContactHtml(row, leadKey);

    wireKanbanCardInteractions(card, row);
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
            onPipelineBoard: true,
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
            markRowOnPipelineBoard(originalRow);
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
    if (isKanbanVisible()) {
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
