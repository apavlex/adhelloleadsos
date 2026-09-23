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
    Array.prototype.forEach.call(lists, function (list) {
      if (list.getAttribute('data-opp-bound') === '1') return;
      list.setAttribute('data-opp-bound', '1');
      Sortable.create(list, {
        group: 'opportunities',
        animation: 150,
        draggable: '.opp-card',
        filter: '.opp-card-tools, .opp-card-tools *',
        preventOnFilter: false,
        ghostClass: 'sortable-ghost',
        onEnd: function (evt) {
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
    var action = ev.target.closest('[data-opp-action]');
    if (action) {
      var kind = action.getAttribute('data-opp-action');
      if (kind === 'call' || kind === 'email' || kind === 'ghl') {
        ev.preventDefault();
        ev.stopPropagation();
      }
      if (kind === 'call') {
        var phone = action.getAttribute('data-phone') || '';
        if (!phone) {
          showError('No phone number on this opportunity.');
          return;
        }
        if (typeof window.__adhelloOpenSoftphoneWithDial !== 'function' || !window.__adhelloOpenSoftphoneWithDial(phone, {
          leadKey: action.getAttribute('data-lead-key') || '',
          title: action.getAttribute('data-title') || '',
        })) {
          showError('Could not open the dialer for that number.');
        }
        return;
      }
      if (kind === 'email') {
        showError('No email on this opportunity.');
        return;
      }
      if (kind === 'ghl') {
        var leadKey = action.getAttribute('data-lead-key') || '';
        if (!leadKey || action.disabled) return;
        action.disabled = true;
        post('/ghl/push', { leadKeys: [leadKey] }).then(function (result) {
          action.disabled = false;
          if (!result.ok || !result.data || !result.data.success) {
            showError((result.data && result.data.error) || 'Could not sync that opportunity to Go High Level.');
            return;
          }
          showStatus('Synced to Go High Level.', true);
        }).catch(function () {
          action.disabled = false;
          showError('Could not sync that opportunity to Go High Level.');
        });
        return;
      }
    }
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
