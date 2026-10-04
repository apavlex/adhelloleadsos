(function () {
  'use strict';

  var board = document.getElementById('oppBoard');
  if (!board) return;

  var pipelineId = board.getAttribute('data-pipeline-id') || '';

  function showStatus(text, ok) {
    var msg = document.getElementById('oppBoardMsg');
    if (!msg) {
      if (!ok) window.alert(text);
      return;
    }
    msg.textContent = text;
    msg.classList.toggle('is-ok', !!ok);
    msg.classList.remove('hidden');
  }

  function showError(text) {
    showStatus(text, false);
  }

  function money(amount) {
    var n = Number(amount) || 0;
    if (n <= 0) return '';
    try {
      return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    } catch (e) {
      return '$' + n.toFixed(2);
    }
  }

  function nextStageColumn(column) {
    if (!column) return null;
    var next = column.nextElementSibling;
    while (next && !(next.classList && next.classList.contains('opp-stage'))) {
      next = next.nextElementSibling;
    }
    return next;
  }

  function syncAdvanceButtons(column) {
    if (!column) return;
    var hasNext = !!nextStageColumn(column);
    Array.prototype.forEach.call(column.querySelectorAll('[data-opp-action="advance"]'), function (btn) {
      btn.hidden = !hasNext;
    });
  }

  function syncStage(list) {
    if (!list) return;
    var cards = list.querySelectorAll('.opp-card');
    var count = cards.length;
    var drop = list.querySelector('.opp-drop');
    if (count && drop) drop.remove();
    if (!count && !list.querySelector('.opp-drop')) {
      drop = document.createElement('div');
      drop.className = 'opp-drop';
      drop.textContent = 'Drop here';
      list.appendChild(drop);
    }
    list.classList.toggle('is-empty', count === 0);
    var stage = list.closest('.opp-stage');
    if (!stage) return;
    var badge = stage.querySelector('.opp-stage-count');
    if (badge) badge.textContent = String(count);
    var meta = stage.querySelector('.opp-stage-meta');
    syncAdvanceButtons(stage);
    if (!meta) return;
    var total = 0;
    Array.prototype.forEach.call(cards, function (card) {
      total += Number(card.getAttribute('data-value')) || 0;
    });
    var label = money(total);
    meta.textContent = label || (count === 1 ? '1 opportunity' : count + ' opportunities');
  }

  function post(url, body) {
    return fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body || {}),
    }).then(function (res) {
      return res.json().then(function (data) {
        return { ok: res.ok, data: data };
      });
    });
  }

  function reloadPipeline(id) {
    var path = window.location.pathname.indexOf('/opportunities') === 0 ? '/opportunities' : '/today';
    window.location.href = path + '?pipeline=' + encodeURIComponent(id || pipelineId);
  }

  function bindSortable() {
    if (typeof Sortable === 'undefined') return;
    var lists = board.querySelectorAll('.opp-stage-cards');
    var coarse =
      (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
      (navigator.maxTouchPoints || 0) > 0;
    Array.prototype.forEach.call(lists, function (list) {
      if (list.getAttribute('data-opp-bound') === '1') return;
      list.setAttribute('data-opp-bound', '1');
      Sortable.create(list, {
        group: 'opportunities',
        animation: 150,
        draggable: '.opp-card',
        // Desktop: short delay so a click opens profile. Touch: longer press to drag
        // without fighting column scroll (iPhone Safari).
        delay: coarse ? 220 : 120,
        delayOnTouchOnly: true,
        touchStartThreshold: coarse ? 12 : 5,
        forceFallback: true,
        fallbackOnBody: true,
        fallbackTolerance: 4,
        scroll: true,
        bubbleScroll: true,
        filter: '.opp-card-tools, .opp-card-tools *, .opp-card-remove, .opp-card-remove *, .opp-pop, .opp-pop *',
        preventOnFilter: false,
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        dragClass: 'sortable-drag',
        onStart: function () {
          board.setAttribute('data-opp-sorting', '1');
          document.body.classList.add('opp-sorting');
        },
        onEnd: function (evt) {
          setTimeout(function () {
            board.removeAttribute('data-opp-sorting');
            document.body.classList.remove('opp-sorting');
          }, 100);
          if (evt.from) syncStage(evt.from);
          if (evt.to && evt.to !== evt.from) syncStage(evt.to);
          var card = evt.item;
          var stage = card && card.parentElement;
          var leadKey = card && card.getAttribute('data-lead-key');
          var stageId = stage && stage.getAttribute('data-stage-id');
          if (!leadKey || !stageId || evt.from === evt.to && evt.oldIndex === evt.newIndex) return;
          post('/opportunities/move', { leadKey: leadKey, pipelineId: pipelineId, stageId: stageId }).then(function (result) {
            if (!result.ok || !result.data || !result.data.success) {
              showError((result.data && result.data.error) || 'Could not move that opportunity.');
              window.location.reload();
            }
          }).catch(function () {
            showError('Could not move that opportunity.');
            window.location.reload();
          });
        },
      });
    });
  }

  function ensureSortable() {
    if (typeof Sortable !== 'undefined') {
      bindSortable();
      return;
    }
    if (typeof window.__ensureSortableJs === 'function') {
      window.__ensureSortableJs().then(bindSortable).catch(function () {});
    }
  }

  var select = document.getElementById('oppPipelineSelect');
  if (select) {
    select.addEventListener('change', function () {
      reloadPipeline(select.value);
    });
  }

  function openAddOpportunity() {
    var menu = document.getElementById('manualLeadOpenSidebar')
      || document.getElementById('manualLeadOpen')
      || document.getElementById('manualLeadOpenMobile');
    if (menu) menu.click();
  }

  ['oppAddFromMenu', 'oppAddCard'].forEach(function (id) {
    var btn = document.getElementById(id);
    if (btn) btn.addEventListener('click', openAddOpportunity);
  });

  function ask(label, current) {
    if (typeof window.adhelloPrompt === 'function') {
      return window.adhelloPrompt({
        title: label,
        label: label,
        value: current || '',
        confirmLabel: 'Save',
        maxLength: 40,
      });
    }
    var value = window.prompt(label, current || '');
    if (value == null) return Promise.resolve('');
    return Promise.resolve(String(value).trim());
  }

  function confirmAction(message, title) {
    if (typeof window.adhelloConfirm === 'function') {
      return window.adhelloConfirm({
        title: title || 'Please confirm',
        message: message,
        confirmLabel: 'Remove',
        cancelLabel: 'Cancel',
        danger: true,
      });
    }
    return Promise.resolve(window.confirm(message));
  }

  var DEFAULT_PIPELINE_TEMPLATES = [
    {
      id: 'marketing',
      name: 'Marketing Pipeline',
      description: 'Outbound and inbound contractor opportunities',
      stages: ['New opportunity', 'Contacted', 'Qualified', 'Proposal sent', 'Won'],
    },
    {
      id: 'sales',
      name: 'Sales Pipeline',
      description: 'Deals from first chat through close',
      stages: ['New lead', 'Discovery', 'Proposal', 'Negotiation', 'Closed won', 'Closed lost'],
    },
    {
      id: 'referrals',
      name: 'Referral Partners',
      description: 'Partner intros to active referral flow',
      stages: ['Introduced', 'Meeting booked', 'Onboarded', 'Active referrals', 'Inactive'],
    },
    {
      id: 'outreach',
      name: 'Outreach Sequence',
      description: 'Cold outreach and reply follow-through',
      stages: ['To contact', 'Sequenced', 'Replied', 'Meeting set', 'Nurture', 'Disqualified'],
    },
    {
      id: 'ai-review',
      name: 'AI Assistant Review',
      description: 'AI drafts waiting on your approval',
      stages: ['Queued', 'AI drafting', 'Needs review', 'Approved', 'Sent', 'Done'],
    },
    {
      id: 'simple',
      name: 'Simple Board',
      description: 'Three clear stages, easy to customize later',
      stages: ['New', 'In progress', 'Done'],
    },
    {
      id: 'blank',
      name: 'Start Blank',
      description: 'One stage — add the rest yourself',
      stages: ['New opportunity'],
    },
  ];

  function readJsonScript(id) {
    var node = document.getElementById(id);
    if (!node) return null;
    try {
      return JSON.parse(node.textContent || 'null');
    } catch (e) {
      return null;
    }
  }

  function pipelineTemplates() {
    var fromPage = readJsonScript('oppBoardTemplatesJson');
    if (Array.isArray(fromPage) && fromPage.length) return fromPage;
    var attr = board.getAttribute('data-pipeline-templates');
    if (attr) {
      try {
        var parsed = JSON.parse(attr);
        if (Array.isArray(parsed) && parsed.length) return parsed;
      } catch (e) { /* ignore broken attribute encoding */ }
    }
    return DEFAULT_PIPELINE_TEMPLATES.slice();
  }

  function askNewPipeline() {
    var templates = pipelineTemplates();
    if (typeof window.adhelloPickPipelineTemplate === 'function') {
      return window.adhelloPickPipelineTemplate({
        templates: templates,
        selectedId: 'marketing',
      });
    }
    return ask('New pipeline name', templates[0] ? templates[0].name : 'New pipeline').then(function (name) {
      if (!name) return null;
      return { templateId: 'marketing', name: name };
    });
  }

  var newPipeline = document.getElementById('oppNewPipeline');
  if (newPipeline) {
    newPipeline.addEventListener('click', function () {
      askNewPipeline().then(function (choice) {
        if (!choice || !choice.name) return;
        var name = String(choice.name || '').trim();
        if (!name) {
          showError('Enter a pipeline name.');
          return;
        }
        showStatus('Creating pipeline…', true);
        post('/opportunities/pipelines', {
          name: name,
          templateId: choice.templateId || 'marketing',
        }).then(function (result) {
          if (!result.ok || !result.data || !result.data.success) {
            showError((result.data && result.data.error) || 'Could not create that pipeline.');
            return;
          }
          reloadPipeline(result.data.pipelineId);
        }).catch(function () {
          showError('Could not create that pipeline.');
        });
      });
    });
  }

  var editBoard = document.getElementById('oppEditBoard');
  var cancelEdit = document.getElementById('oppCancelEdit');
  var editSnapshot = null;
  var pendingRemoveIds = [];

  function isEditing() {
    return board.classList.contains('is-editing');
  }

  function captureEditSnapshot() {
    var stages = [];
    Array.prototype.forEach.call(board.querySelectorAll('.opp-stage'), function (stageEl) {
      var id = stageEl.getAttribute('data-stage-id') || '';
      var title = stageEl.querySelector('.opp-stage-title');
      var input = stageEl.querySelector('.opp-stage-name-input');
      var name = title
        ? String(title.textContent || '').trim()
        : input
          ? String(input.value || '').trim()
          : 'Stage';
      stages.push({
        id: id,
        name: name,
        width: Math.round(stageEl.getBoundingClientRect().width) || 252,
      });
    });
    return { stages: stages };
  }

  function setEditing(on) {
    board.classList.toggle('is-editing', !!on);
    if (editBoard) {
      editBoard.textContent = on ? 'Save' : 'Edit';
      editBoard.classList.toggle('is-saving-mode', !!on);
      editBoard.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    if (cancelEdit) cancelEdit.hidden = !on;
    if (on) {
      closeStageZoom();
      Array.prototype.forEach.call(board.querySelectorAll('.opp-stage'), function (stageEl) {
        var title = stageEl.querySelector('.opp-stage-title');
        var input = stageEl.querySelector('.opp-stage-name-input');
        if (title && input) input.value = String(title.textContent || '').trim();
      });
      syncStageMoveButtons();
      showStatus('Edit mode — rename columns, use the arrows to reorder, drag edges to resize, then Save.', true);
    }
  }

  function stageColumns() {
    return Array.prototype.slice.call(board.querySelectorAll('.opp-stage'));
  }

  function syncStageMoveButtons() {
    var stages = stageColumns();
    stages.forEach(function (stageEl, i) {
      var left = stageEl.querySelector('[data-stage-move="-1"]');
      var right = stageEl.querySelector('[data-stage-move="1"]');
      if (left) left.disabled = i === 0;
      if (right) right.disabled = i === stages.length - 1;
      syncAdvanceButtons(stageEl);
    });
  }

  function moveStage(stageEl, dir) {
    var stages = stageColumns();
    var from = stages.indexOf(stageEl);
    var to = from + dir;
    if (from < 0 || to < 0 || to >= stages.length) return;
    var row = stageEl.parentNode;
    row.insertBefore(stageEl, dir < 0 ? stages[to] : stages[to].nextSibling);
    syncStageMoveButtons();
    if (stageEl.scrollIntoView) stageEl.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    var btn = stageEl.querySelector('[data-stage-move="' + dir + '"]');
    if (btn && !btn.disabled) btn.focus();
    showStatus('Stage moved — click Save to keep the new order.', true);
  }

  function restoreStageOrder(ids) {
    var row = document.getElementById('oppStageRow');
    if (!row) return;
    ids.forEach(function (id) {
      var stageEl = row.querySelector('.opp-stage[data-stage-id="' + id + '"]');
      if (stageEl) row.appendChild(stageEl);
    });
    syncStageMoveButtons();
  }

  function rememberStageOrder(ids) {
    if (ids[0]) board.setAttribute('data-first-stage-id', ids[0]);
    var node = document.getElementById('oppBoardPipelinesJson');
    var pipelines = readJsonScript('oppBoardPipelinesJson');
    if (!node || !Array.isArray(pipelines)) return;
    pipelines.forEach(function (pipeline) {
      if (!pipeline || pipeline.id !== pipelineId || !Array.isArray(pipeline.stages)) return;
      var byId = {};
      pipeline.stages.forEach(function (stage) { byId[stage.id] = stage; });
      pipeline.stages = ids.map(function (id) { return byId[id]; }).filter(Boolean);
    });
    node.textContent = JSON.stringify(pipelines).replace(/</g, '\\u003c');
  }

  function exitEditing(opts) {
    opts = opts || {};
    pendingRemoveIds = [];
    editSnapshot = null;
    setEditing(false);
    if (opts.reload) {
      window.location.reload();
      return;
    }
    if (opts.message) showStatus(opts.message, true);
  }

  function restoreFromSnapshot() {
    if (!editSnapshot) {
      exitEditing({ reload: true });
      return;
    }
    if (pendingRemoveIds.length) {
      exitEditing({ reload: true });
      return;
    }
    editSnapshot.stages.forEach(function (stage) {
      var stageEl = board.querySelector('.opp-stage[data-stage-id="' + stage.id + '"]');
      if (!stageEl) return;
      applyStageWidth(stageEl, stage.width);
      var title = stageEl.querySelector('.opp-stage-title');
      var input = stageEl.querySelector('.opp-stage-name-input');
      if (title) title.textContent = stage.name;
      if (input) input.value = stage.name;
    });
    restoreStageOrder(editSnapshot.stages.map(function (stage) { return stage.id; }));
    exitEditing({ message: 'Edits discarded.' });
  }

  function saveInlineEdits() {
    var current = [];
    var emptyInput = null;
    Array.prototype.forEach.call(board.querySelectorAll('.opp-stage'), function (stageEl) {
      var id = stageEl.getAttribute('data-stage-id') || '';
      var input = stageEl.querySelector('.opp-stage-name-input');
      var name = String((input && input.value) || '').trim();
      if (!name) {
        emptyInput = input;
        return;
      }
      current.push({
        id: id,
        name: name,
        width: Math.round(stageEl.getBoundingClientRect().width) || 252,
      });
    });
    if (emptyInput) {
      showError('Every column needs a name.');
      emptyInput.focus();
      return;
    }
    if (!current.length) {
      showError('A pipeline needs at least one stage.');
      return;
    }

    var originalById = {};
    (editSnapshot && editSnapshot.stages ? editSnapshot.stages : []).forEach(function (stage) {
      originalById[stage.id] = stage;
    });

    showStatus('Saving board…', true);
    var removedIds = pendingRemoveIds.slice();

    function runDeletes() {
      var chain = Promise.resolve({ ok: true, data: { success: true } });
      removedIds.forEach(function (stageId) {
        chain = chain.then(function (prev) {
          if (!prev.ok || !prev.data || !prev.data.success) return prev;
          return post('/opportunities/stages/' + encodeURIComponent(stageId) + '/delete', {});
        });
      });
      return chain;
    }

    function runRenames() {
      var tasks = [];
      current.forEach(function (stage) {
        var original = originalById[stage.id];
        if (!original) return;
        if (String(stage.name) !== String(original.name || '').trim()) {
          tasks.push(
            post('/opportunities/stages/' + encodeURIComponent(stage.id), { name: stage.name })
          );
        }
      });
      return Promise.all(tasks).then(function (results) {
        return { results: results, hadTasks: tasks.length > 0 };
      });
    }

    var orderIds = current.map(function (stage) { return stage.id; });
    var originalOrder = (editSnapshot && editSnapshot.stages ? editSnapshot.stages : [])
      .map(function (stage) { return stage.id; })
      .filter(function (id) { return removedIds.indexOf(id) === -1; });
    var orderChanged = orderIds.join('|') !== originalOrder.join('|');

    function runReorder() {
      if (!orderChanged) return Promise.resolve({ ok: true, data: { success: true } });
      return post('/opportunities/pipelines/' + encodeURIComponent(pipelineId) + '/stage-order', { stageIds: orderIds });
    }

    runDeletes()
      .then(function (deleteResult) {
        if (!deleteResult.ok || !deleteResult.data || !deleteResult.data.success) {
          showError((deleteResult.data && deleteResult.data.error) || 'Could not delete that column.');
          return null;
        }
        return runRenames();
      })
      .then(function (updatePack) {
        if (!updatePack) return;
        var failed = (updatePack.results || []).find(function (item) {
          return !item.ok || !item.data || !item.data.success;
        });
        if (failed) {
          showError((failed.data && failed.data.error) || 'Could not save all board changes.');
          return null;
        }
        return runReorder();
      })
      .then(function (orderResult) {
        if (!orderResult) return;
        if (!orderResult.ok || !orderResult.data || !orderResult.data.success) {
          showError((orderResult.data && orderResult.data.error) || 'Could not save the new stage order.');
          return;
        }
        if (orderChanged) rememberStageOrder(orderIds);
        current.forEach(function (stage) {
          persistStageWidth(stage.id, stage.width);
          var stageEl = board.querySelector('.opp-stage[data-stage-id="' + stage.id + '"]');
          if (!stageEl) return;
          var title = stageEl.querySelector('.opp-stage-title');
          var input = stageEl.querySelector('.opp-stage-name-input');
          if (title) title.textContent = stage.name;
          if (input) input.value = stage.name;
        });
        if (removedIds.length) {
          exitEditing({ reload: true });
          return;
        }
        exitEditing({ message: 'Board saved. Column widths are locked until you Edit again.' });
      })
      .catch(function () {
        showError('Could not save board changes.');
      });
  }

  if (editBoard) {
    editBoard.addEventListener('click', function () {
      if (isEditing()) {
        saveInlineEdits();
        return;
      }
      editSnapshot = captureEditSnapshot();
      pendingRemoveIds = [];
      setEditing(true);
    });
  }

  var deletePipelineBtn = document.getElementById('oppDeletePipeline');
  if (deletePipelineBtn) {
    deletePipelineBtn.addEventListener('click', function () {
      if (deletePipelineBtn.disabled) {
        showError('Keep at least one pipeline.');
        return;
      }
      var nameEl = board.querySelector('h1, h2');
      var pipelineName = nameEl ? String(nameEl.textContent || '').trim() : 'this pipeline';
      var pipelineCount = (readJsonScript('oppBoardPipelinesJson') || []).length;
      if (pipelineCount <= 1) {
        showError('Keep at least one pipeline.');
        return;
      }
      confirmAction(
        'Deletes “' +
          pipelineName +
          '” and clears opportunities currently on it. Leads stay in your CRM — they just leave this board. This cannot be undone.',
        'Delete this pipeline?'
      ).then(function (ok) {
        if (!ok) return;
        showStatus('Deleting pipeline…', true);
        post('/opportunities/pipelines/' + encodeURIComponent(pipelineId) + '/delete', {})
          .then(function (result) {
            if (!result.ok || !result.data || !result.data.success) {
              showError((result.data && result.data.error) || 'Could not delete that pipeline.');
              return;
            }
            reloadPipeline(result.data.activePipelineId || '');
          })
          .catch(function () {
            showError('Could not delete that pipeline.');
          });
      });
    });
  }

  if (cancelEdit) {
    cancelEdit.addEventListener('click', function () {
      if (!isEditing()) return;
      restoreFromSnapshot();
    });
  }

  var addStage = document.getElementById('oppAddStage');
  if (addStage) {
    addStage.addEventListener('click', function () {
      ask('New stage name', '').then(function (name) {
        if (!name) return;
        post('/opportunities/pipelines/' + encodeURIComponent(pipelineId) + '/stages', { name: name }).then(function (result) {
          if (!result.ok || !result.data || !result.data.success) {
            showError((result.data && result.data.error) || 'Could not add that stage.');
            return;
          }
          window.location.reload();
        });
      });
    });
  }

  function persistStageWidth(stageId, px) {
    if (!stageId) return;
    var next = readSavedWidths();
    next[stageId] = clampStageWidth(px);
    saveWidths(next);
  }

  board.addEventListener('click', function (ev) {
    if (ev.target.closest('[data-opp-action]')) return;
    var zoomBtn = ev.target.closest('[data-stage-zoom]');
    if (zoomBtn) {
      openStageZoom(zoomBtn.closest('.opp-stage'));
      return;
    }
    var zoomNav = ev.target.closest('[data-zoom-nav]');
    if (zoomNav) {
      var nav = zoomNav.getAttribute('data-zoom-nav');
      if (nav === 'close') closeStageZoom();
      else stepStageZoom(nav === 'next' ? 1 : -1);
      return;
    }
    var moveBtn = ev.target.closest('[data-stage-move]');
    if (moveBtn) {
      if (isEditing() && !moveBtn.disabled) {
        moveStage(moveBtn.closest('.opp-stage'), Number(moveBtn.getAttribute('data-stage-move')) < 0 ? -1 : 1);
      }
      return;
    }
    var remove = ev.target.closest('.opp-remove');
    if (!remove) return;
    if (!isEditing()) return;
    var stageId = remove.getAttribute('data-stage-id') || '';
    var stageEl = remove.closest('.opp-stage');
    var remaining = board.querySelectorAll('.opp-stage').length;
    if (remaining <= 1) {
      showError('A pipeline needs at least one stage.');
      return;
    }
    confirmAction(
      'Opportunities in this stage move to the neighboring stage when you save.',
      'Remove this stage?'
    ).then(function (ok) {
      if (!ok) return;
      if (stageId) pendingRemoveIds.push(stageId);
      if (stageEl) stageEl.remove();
      syncStageMoveButtons();
      showStatus('Stage removed — click Save to keep this change.', true);
    });
  });

  var zoomedStage = null;
  var ZOOM_ICONS = {
    prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  };

  function openStageZoom(stageEl) {
    if (!stageEl || isEditing()) return;
    if (zoomedStage && zoomedStage !== stageEl) closeStageZoom(true);
    var stages = stageColumns();
    var index = stages.indexOf(stageEl);
    var bar = document.createElement('div');
    bar.className = 'opp-zoom-bar';
    bar.innerHTML =
      '<button type="button" data-zoom-nav="prev" title="Previous stage" aria-label="Previous stage"' + (index <= 0 ? ' disabled' : '') + '>' + ZOOM_ICONS.prev + '</button>' +
      '<span class="opp-zoom-pos">Stage ' + (index + 1) + ' of ' + stages.length + '</span>' +
      '<button type="button" data-zoom-nav="next" title="Next stage" aria-label="Next stage"' + (index >= stages.length - 1 ? ' disabled' : '') + '>' + ZOOM_ICONS.next + '</button>' +
      '<button type="button" class="opp-zoom-close" data-zoom-nav="close" title="Back to all stages" aria-label="Back to all stages">' + ZOOM_ICONS.close + '</button>';
    stageEl.insertBefore(bar, stageEl.firstChild);
    stageEl.classList.add('is-zoomed');
    stageEl.setAttribute('role', 'dialog');
    stageEl.setAttribute('aria-modal', 'true');
    document.body.classList.add('opp-stage-zoom-open');
    zoomedStage = stageEl;
    var list = stageEl.querySelector('.opp-stage-cards');
    if (list) list.scrollTop = 0;
  }

  function closeStageZoom(keepBodyLock) {
    if (!zoomedStage) return;
    var stageEl = zoomedStage;
    zoomedStage = null;
    var bar = stageEl.querySelector('.opp-zoom-bar');
    if (bar) bar.remove();
    stageEl.classList.remove('is-zoomed');
    stageEl.removeAttribute('role');
    stageEl.removeAttribute('aria-modal');
    if (!keepBodyLock) {
      document.body.classList.remove('opp-stage-zoom-open');
      if (stageEl.scrollIntoView) stageEl.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
  }

  function stepStageZoom(dir) {
    if (!zoomedStage) return;
    var stages = stageColumns();
    var target = stages[stages.indexOf(zoomedStage) + dir];
    if (target) openStageZoom(target);
  }

  document.addEventListener('keydown', function (ev) {
    if (!zoomedStage || ev.defaultPrevented) return;
    if (ev.target && ev.target.closest && ev.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (ev.key === 'Escape') {
      if (document.querySelector('.opp-pop')) return;
      closeStageZoom();
    } else if (ev.key === 'ArrowLeft') {
      stepStageZoom(-1);
    } else if (ev.key === 'ArrowRight') {
      stepStageZoom(1);
    }
  }, true);
  function widthStorageKey() {
    return 'adhello.oppStageWidths.' + (pipelineId || 'default');
  }

  function readSavedWidths() {
    try {
      var raw = window.localStorage.getItem(widthStorageKey());
      var parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function saveWidths(map) {
    try {
      window.localStorage.setItem(widthStorageKey(), JSON.stringify(map || {}));
    } catch (e) { /* ignore quota */ }
  }

  function clampStageWidth(px) {
    var min = 220;
    var max = 448;
    var n = Number(px) || min;
    if (n < min) return min;
    if (n > max) return max;
    return Math.round(n);
  }

  function applyStageWidth(stage, px) {
    if (!stage) return;
    var width = clampStageWidth(px);
    stage.style.width = width + 'px';
    stage.style.flex = '0 0 auto';
    stage.style.minWidth = Math.min(width, 220) + 'px';
  }

  function bindColumnResize() {
    var stages = board.querySelectorAll('.opp-stage');
    var saved = readSavedWidths();
    Array.prototype.forEach.call(stages, function (stage) {
      var id = stage.getAttribute('data-stage-id') || '';
      if (id && saved[id]) applyStageWidth(stage, saved[id]);
      var handle = stage.querySelector('.opp-stage-resize');
      if (!handle || handle.getAttribute('data-bound') === '1') return;
      handle.setAttribute('data-bound', '1');
      handle.addEventListener('pointerdown', function (ev) {
        if (!isEditing()) return;
        if (ev.button != null && ev.button !== 0) return;
        ev.preventDefault();
        ev.stopPropagation();
        var startX = ev.clientX;
        var startWidth = stage.getBoundingClientRect().width;
        stage.classList.add('is-resizing');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        try { handle.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }

        function onMove(moveEv) {
          applyStageWidth(stage, startWidth + (moveEv.clientX - startX));
        }

        function onUp(upEv) {
          stage.classList.remove('is-resizing');
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
          try { handle.releasePointerCapture(upEv.pointerId); } catch (e) { /* ignore */ }
          handle.removeEventListener('pointermove', onMove);
          handle.removeEventListener('pointerup', onUp);
          handle.removeEventListener('pointercancel', onUp);
          /* Widths persist only when Save is clicked in edit mode. */
        }

        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onUp);
        handle.addEventListener('pointercancel', onUp);
      });
    });
  }

  function bindBoardWheelScroll() {
    var row = document.getElementById('oppStageRow');
    if (!row || row.getAttribute('data-wheel-bound') === '1') return;
    row.setAttribute('data-wheel-bound', '1');

    row.addEventListener(
      'wheel',
      function (ev) {
        if (ev.ctrlKey || ev.metaKey) return;
        if (ev.target && ev.target.closest && ev.target.closest('input, textarea, select, [contenteditable="true"]')) {
          return;
        }

        var dx = Number(ev.deltaX) || 0;
        var dy = Number(ev.deltaY) || 0;

        // Shift+wheel is the explicit horizontal shortcut (mouse wheels emit dy only).
        if (ev.shiftKey && Math.abs(dy) > Math.abs(dx)) {
          dx = dy;
          dy = 0;
        }

        // Vertical-dominant gestures must never pan the board sideways (Mac trackpad).
        // Let the column / page scroll natively.
        if (Math.abs(dy) >= Math.abs(dx)) return;

        if (row.scrollWidth <= row.clientWidth + 1) return;
        if (Math.abs(dx) < 0.5) return;

        row.scrollLeft += dx;
        ev.preventDefault();
      },
      { passive: false }
    );
  }

  bindColumnResize();
  bindBoardWheelScroll();
  ensureSortable();

  (function bindOppFullscreen() {
    if (!document.body.classList.contains('opp-page')) return;
    var btn = document.getElementById('oppFullscreenBtn');
    if (!btn || btn.getAttribute('data-bound') === '1') return;
    btn.setAttribute('data-bound', '1');
    var FS_KEY = 'adhello-opp-fullscreen';
    var prevSidebar = null;

    function setFullscreen(on) {
      document.body.classList.toggle('opp-fullscreen', !!on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      try {
        localStorage.setItem(FS_KEY, on ? '1' : '0');
      } catch (e) {}
      if (typeof window.__adhelloSetSidebarState === 'function') {
        if (on) {
          if (prevSidebar == null && typeof window.__adhelloGetSidebarState === 'function') {
            prevSidebar = window.__adhelloGetSidebarState();
          }
          window.__adhelloSetSidebarState('collapsed');
        } else if (prevSidebar) {
          window.__adhelloSetSidebarState(prevSidebar);
          prevSidebar = null;
        } else {
          window.__adhelloSetSidebarState('expanded');
        }
      }
    }

    var startOn = false;
    try {
      startOn = localStorage.getItem(FS_KEY) === '1';
    } catch (e) {}
    if (startOn) setFullscreen(true);

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      setFullscreen(!document.body.classList.contains('opp-fullscreen'));
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!document.body.classList.contains('opp-fullscreen')) return;
      if (e.target && (e.target.closest('input, textarea, select, [contenteditable="true"]') || e.target.closest('.opp-pop'))) return;
      setFullscreen(false);
    });
  })();
})();
