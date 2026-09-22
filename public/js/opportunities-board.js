(function () {
  'use strict';

  var board = document.getElementById('oppBoard');
  if (!board) return;

  var pipelineId = board.getAttribute('data-pipeline-id') || '';

  function showError(text) {
    var msg = document.getElementById('oppBoardMsg');
    if (!msg) {
      window.alert(text);
      return;
    }
    msg.textContent = text;
    msg.classList.remove('hidden');
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
    Array.prototype.forEach.call(lists, function (list) {
      if (list.getAttribute('data-opp-bound') === '1') return;
      list.setAttribute('data-opp-bound', '1');
      Sortable.create(list, {
        group: 'opportunities',
        animation: 150,
        draggable: '.opp-card',
        ghostClass: 'sortable-ghost',
        onEnd: function (evt) {
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

  var addCardBtn = document.getElementById('oppAddCard');
  var addForm = document.getElementById('oppAddForm');
  if (addCardBtn && addForm) {
    addCardBtn.addEventListener('click', function () {
      addForm.classList.toggle('hidden');
      var title = document.getElementById('oppCardTitle');
      if (!addForm.classList.contains('hidden') && title) title.focus();
    });
    addForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      post('/opportunities/cards', {
        title: document.getElementById('oppCardTitle').value,
        source: document.getElementById('oppCardSource').value,
        value: document.getElementById('oppCardValue').value,
        stageId: document.getElementById('oppCardStage').value,
        pipelineId: pipelineId,
      }).then(function (result) {
        if (!result.ok || !result.data || !result.data.success) {
          showError((result.data && result.data.error) || 'Could not add that opportunity.');
          return;
        }
        reloadPipeline(result.data.pipelineId || pipelineId);
      }).catch(function () {
        showError('Could not add that opportunity.');
      });
    });
  }

  function ask(label, current) {
    var value = window.prompt(label, current || '');
    if (value == null) return '';
    return String(value).trim();
  }

  var newPipeline = document.getElementById('oppNewPipeline');
  if (newPipeline) {
    newPipeline.addEventListener('click', function () {
      var name = ask('New pipeline name', 'New pipeline');
      if (!name) return;
      post('/opportunities/pipelines', { name: name }).then(function (result) {
        if (!result.ok || !result.data || !result.data.success) {
          showError((result.data && result.data.error) || 'Could not create that pipeline.');
          return;
        }
        reloadPipeline(result.data.pipelineId);
      });
    });
  }

  var renamePipeline = document.getElementById('oppRenamePipeline');
  if (renamePipeline && select) {
    renamePipeline.addEventListener('click', function () {
      var current = select.options[select.selectedIndex] ? select.options[select.selectedIndex].text : '';
      var name = ask('Pipeline name', current);
      if (!name) return;
      post('/opportunities/pipelines/' + encodeURIComponent(pipelineId), { name: name }).then(function (result) {
        if (!result.ok || !result.data || !result.data.success) {
          showError((result.data && result.data.error) || 'Could not rename that pipeline.');
          return;
        }
        window.location.reload();
      });
    });
  }

  var addStage = document.getElementById('oppAddStage');
  if (addStage) {
    addStage.addEventListener('click', function () {
      var name = ask('New stage name', '');
      if (!name) return;
      post('/opportunities/pipelines/' + encodeURIComponent(pipelineId) + '/stages', { name: name }).then(function (result) {
        if (!result.ok || !result.data || !result.data.success) {
          showError((result.data && result.data.error) || 'Could not add that stage.');
          return;
        }
        window.location.reload();
      });
    });
  }

  board.addEventListener('click', function (ev) {
    var rename = ev.target.closest('.opp-rename');
    var remove = ev.target.closest('.opp-remove');
    if (rename) {
      var name = ask('Stage name', rename.getAttribute('data-stage-name') || '');
      if (!name) return;
      post('/opportunities/stages/' + encodeURIComponent(rename.getAttribute('data-stage-id')), { name: name }).then(function (result) {
        if (!result.ok || !result.data || !result.data.success) {
          showError((result.data && result.data.error) || 'Could not rename that stage.');
          return;
        }
        window.location.reload();
      });
    }
    if (remove) {
      if (!window.confirm('Remove this stage? Opportunities in it move to the neighboring stage.')) return;
      post('/opportunities/stages/' + encodeURIComponent(remove.getAttribute('data-stage-id')) + '/delete', {}).then(function (result) {
        if (!result.ok || !result.data || !result.data.success) {
          showError((result.data && result.data.error) || 'Could not remove that stage.');
          return;
        }
        window.location.reload();
      });
    }
  });

  ensureSortable();
})();
