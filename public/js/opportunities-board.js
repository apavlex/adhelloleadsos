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
        filter: '.opp-card-tools, .opp-card-tools *, .opp-card-title, .opp-pop, .opp-pop *',
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

  var renamePipeline = document.getElementById('oppRenamePipeline');
  if (renamePipeline && select) {
    renamePipeline.addEventListener('click', function () {
      var current = select.options[select.selectedIndex] ? select.options[select.selectedIndex].text : '';
      ask('Pipeline name', current).then(function (name) {
        if (!name) return;
        post('/opportunities/pipelines/' + encodeURIComponent(pipelineId), { name: name }).then(function (result) {
          if (!result.ok || !result.data || !result.data.success) {
            showError((result.data && result.data.error) || 'Could not rename that pipeline.');
            return;
          }
          window.location.reload();
        });
      });
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

  board.addEventListener('click', function (ev) {
    if (ev.target.closest('[data-opp-action]')) return;
    var rename = ev.target.closest('.opp-rename');
    var remove = ev.target.closest('.opp-remove');
    if (rename) {
      ask('Stage name', rename.getAttribute('data-stage-name') || '').then(function (name) {
        if (!name) return;
        post('/opportunities/stages/' + encodeURIComponent(rename.getAttribute('data-stage-id')), { name: name }).then(function (result) {
          if (!result.ok || !result.data || !result.data.success) {
            showError((result.data && result.data.error) || 'Could not rename that stage.');
            return;
          }
          window.location.reload();
        });
      });
    }
    if (remove) {
      confirmAction(
        'Opportunities in this stage move to the neighboring stage.',
        'Remove this stage?'
      ).then(function (ok) {
        if (!ok) return;
        post('/opportunities/stages/' + encodeURIComponent(remove.getAttribute('data-stage-id')) + '/delete', {}).then(function (result) {
          if (!result.ok || !result.data || !result.data.success) {
            showError((result.data && result.data.error) || 'Could not remove that stage.');
            return;
          }
          window.location.reload();
        });
      });
    }
  });

  ensureSortable();
})();
