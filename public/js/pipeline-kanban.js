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
    row.dataset.tiktok = lead.tiktok || 'N/A';
    row.dataset.twitter = lead.twitter || 'N/A';
    row.dataset.linkedin = lead.linkedin || '';
    if (lead.onPipelineBoard) row.dataset.onPipelineBoard = '1';
    row.dataset.opportunityPipelineId = lead.opportunityPipelineId || '';
    row.dataset.opportunityStageId = lead.opportunityStageId || '';
    return row;
  }

  function selectedOpportunityBoard() {
    const boards = window.OPPORTUNITY_BOARDS;
    if (!boards || !Array.isArray(boards.pipelines) || !boards.pipelines.length) return null;
    const sel = document.getElementById('bulkOpportunityPipelineSelect');
    const id = sel && sel.value ? String(sel.value).trim() : String(boards.activePipelineId || '');
    return boards.pipelines.find(function (pipeline) { return pipeline.id === id; }) || null;
  }

  function rowOpportunityPipelineId(row) {
    return String((row && row.dataset && row.dataset.opportunityPipelineId) || (row && row.getAttribute && row.getAttribute('data-opportunity-pipeline-id')) || '').trim();
  }

  function rowOpportunityStageId(row) {
    return String((row && row.dataset && row.dataset.opportunityStageId) || (row && row.getAttribute && row.getAttribute('data-opportunity-stage-id')) || '').trim();
  }

  function fillOpportunityStageSelect(pipeline) {
    const sel = document.getElementById('bulkPipelineStageSelect');
    if (!sel || !pipeline || !Array.isArray(pipeline.stages)) return;
    const current = sel.value;
    const currentName =
      sel.options && sel.options[sel.selectedIndex]
        ? String(sel.options[sel.selectedIndex].textContent || '').trim().toLowerCase()
        : '';
    sel.innerHTML = '';
    pipeline.stages.forEach(function (stage) {
      const opt = document.createElement('option');
      opt.value = stage.id;
      opt.textContent = stage.name;
      sel.appendChild(opt);
    });
    sel.setAttribute('data-board-id', pipeline.id);
    const match =
      pipeline.stages.find(function (stage) { return stage.id === current; }) ||
      pipeline.stages.find(function (stage) {
        return currentName && String(stage.name || '').trim().toLowerCase() === currentName;
      });
    if (match) sel.value = match.id;
  }

  function rebuildOpportunityColumns(pipeline) {
    const row = document.getElementById('kanbanColumns');
    if (!row || !pipeline) return;
    row.innerHTML = '';
    pipeline.stages.forEach(function (stage) {
      const col = document.createElement('div');
      col.className = 'kanban-column w-[min(100vw-2rem,17rem)] shrink-0 flex flex-col gap-3';
      col.setAttribute('data-pipeline-stage', stage.id);
      col.setAttribute('data-opportunity-pipeline', pipeline.id);
      col.innerHTML =
        '<div class="flex items-center justify-between px-1 mb-1">' +
        '<h3 class="text-[10px] font-black uppercase tracking-widest text-brand-dark dark:text-white leading-tight">' +
        escapeHtml(stage.name) +
        '</h3>' +
        '<span class="px-2 py-0.5 rounded-full bg-brand-cream dark:bg-slate-800 text-[10px] font-bold text-brand-muted dark:text-slate-300 column-count">0</span>' +
        '</div>' +
        '<div class="kanban-list kanban-drop-zone min-h-[480px] flex flex-col gap-3 p-2 bg-brand-cream/20 dark:bg-white/5 rounded-3xl border border-dashed border-brand-border/40 dark:border-white/10"></div>';
      row.appendChild(col);
    });
    const caption = document.getElementById('kanbanOpportunityCaption');
    if (caption) caption.textContent = pipeline.name + ' — same board as Opportunities. Drag a card to change its stage.';
  }

  function getKanbanRowSources() {
    hydratePipelineBoardKeysFromDom();
    const pipeline = selectedOpportunityBoard();
    const table = document.getElementById('prospectLeadsTable');
    if (pipeline) {
      if (table) {
        return Array.from(
          table.querySelectorAll('tbody tr.result-row:not(.result-row--panel-source)'),
        ).filter(function (row) {
          return rowOpportunityPipelineId(row) === pipeline.id;
        });
      }
      if (Array.isArray(window.INITIAL_SAVED_LEADS)) {
        return window.INITIAL_SAVED_LEADS.filter(function (lead) {
          return lead && String(lead.opportunityPipelineId || '') === pipeline.id;
        })
          .map(leadRecordToRowShape)
          .filter(Boolean);
      }
      return [];
    }
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
    const oppStage = rowOpportunityStageId(row);
    if (oppStage && stageIds.indexOf(oppStage) >= 0) return stageIds.indexOf(oppStage);
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
        tt: ds.tiktok,
        tw: ds.twitter,
        li: ds.linkedin,
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
        const opportunityPipelineId = String(toCol.dataset.opportunityPipeline || '').trim();
        if (!newStageId) return;
        if (opportunityPipelineId && newStageId.indexOf('ops_') === 0) {
          fetch('/opportunities/move', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
              leadKey: key,
              pipelineId: opportunityPipelineId,
              stageId: newStageId,
            }),
          })
            .then(function (res) { return res.json(); })
            .then(function (data) {
              if (!data || !data.success) return;
              const originalRow = document.querySelector('.result-row[data-lead-key="' + CSS.escape(key) + '"]');
              if (!originalRow) return;
              originalRow.dataset.opportunityPipelineId = opportunityPipelineId;
              originalRow.dataset.opportunityStageId = newStageId;
              markRowOnPipelineBoard(originalRow);
            })
            .catch(function () {});
          return;
        }
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

    const opportunityPipeline = selectedOpportunityBoard();
    if (opportunityPipeline) {
      fillOpportunityStageSelect(opportunityPipeline);
      rebuildOpportunityColumns(opportunityPipeline);
    }

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

  function applyOpportunityPlacement(keys, pipelineId, stageId) {
    const wanted = new Set();
    (Array.isArray(keys) ? keys : []).forEach(function (key) {
      const raw = String(key || '').trim();
      if (!raw) return;
      const bare = raw.replace(/^lead:/i, '');
      wanted.add(raw);
      wanted.add(bare);
      wanted.add('lead:' + bare);
    });
    document.querySelectorAll('.result-row').forEach(function (row) {
      const key = String(row.dataset.leadKey || '').trim();
      const bare = key.replace(/^lead:/i, '');
      if (!wanted.has(key) && !wanted.has(bare) && !wanted.has('lead:' + bare)) return;
      row.dataset.opportunityPipelineId = pipelineId;
      row.dataset.opportunityStageId = stageId;
      markRowOnPipelineBoard(row);
    });
    if (Array.isArray(window.INITIAL_SAVED_LEADS)) {
      window.INITIAL_SAVED_LEADS.forEach(function (lead) {
        if (!lead) return;
        const key = String(lead.key || '').trim();
        const bare = key.replace(/^lead:/i, '');
        if (!wanted.has(key) && !wanted.has(bare) && !wanted.has('lead:' + bare)) return;
        lead.opportunityPipelineId = pipelineId;
        lead.opportunityStageId = stageId;
        lead.onPipelineBoard = true;
      });
    }
    initKanban();
  }

  window.__adhelloApplyOpportunityPlacement = applyOpportunityPlacement;
  window.__adhelloBuildPipelineKanbanBoard = buildPipelineKanbanBoard;

  const opportunityBoardSelect = document.getElementById('bulkOpportunityPipelineSelect');
  if (opportunityBoardSelect && opportunityBoardSelect.getAttribute('data-opp-bound') !== '1') {
    opportunityBoardSelect.setAttribute('data-opp-bound', '1');
    opportunityBoardSelect.addEventListener('change', function () {
      const pipeline = selectedOpportunityBoard();
      fillOpportunityStageSelect(pipeline);
      buildPipelineKanbanBoard();
    });
  }
  window.__adhelloInitKanban = initKanban;
  window.refreshPipelineKanbanIfNeeded = function refreshPipelineKanbanIfNeeded() {
    if (!isKanbanVisible()) return;
    initKanban();
  };

  function findResultRowForLeadKey(key) {
    const raw = String(key || '').trim();
    if (!raw) return null;
    const bare = raw.replace(/^lead:/i, '');
    const variants = [raw, bare, 'lead:' + bare];
    for (let i = 0; i < variants.length; i += 1) {
      const row = document.querySelector(
        '.result-row[data-lead-key="' + CSS.escape(variants[i]) + '"]',
      );
      if (row) return row;
    }
    return null;
  }

  function applyLeadPipelineStageFromApi(lead, opts) {
    if (!lead) return false;
    const stageId = lead.stageId ? String(lead.stageId).trim() : '';
    if (!stageId && lead.pipelineStage == null) return false;
    const row = (opts && opts.row) || findResultRowForLeadKey(lead.key);
    if (row) {
      const prevStageId = String(row.dataset.stageId || '').trim();
      if (stageId) row.dataset.stageId = stageId;
      if (lead.pipelineStage != null) row.dataset.pipelineStage = String(lead.pipelineStage);
      const labels = window.PIPELINE_STAGE_LABELS || {};
      const fullName = String(lead.pipelineLabel || labels[stageId] || '').trim();
      const short =
        (fullName.split('(')[0].trim().slice(0, 22)) + (fullName.length > 22 ? '…' : '');
      if (short) row.dataset.pipelineLabel = short;
      const pipeSel = row.querySelector('.pipeline-inline-select');
      if (pipeSel && stageId) pipeSel.value = stageId;
      const cell = row.querySelector('.pipeline-stage-label');
      if (cell) cell.textContent = short || 'Stage';
      const wrap = row.querySelector('.pipeline-stage-pill-wrap');
      if (wrap && stageId) {
        const dot =
          (window.PIPELINE_STAGE_COLORS && window.PIPELINE_STAGE_COLORS[stageId]) || '#94a3b8';
        wrap.style.boxShadow = 'inset 3px 0 0 ' + dot;
      }
      const changed = !!(stageId && stageId !== prevStageId);
      if (changed && typeof window.refreshPipelineKanbanIfNeeded === 'function') {
        window.refreshPipelineKanbanIfNeeded();
      }
      return true;
    }
    if (typeof window.refreshPipelineKanbanIfNeeded === 'function') {
      window.refreshPipelineKanbanIfNeeded();
    }
    return false;
  }

  window.__applyLeadPipelineStageFromApi = applyLeadPipelineStageFromApi;

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
