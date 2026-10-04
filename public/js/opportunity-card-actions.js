/**
 * Opportunity card actions — call, SMS, email, schedule, tags, task, move pipeline, GHL sync,
 * advance and remove. Shared by the Opportunities board and the pipeline "Board & stages" view.
 *
 *   window.__adhelloBindOppCardActions(rootEl, options)
 *   window.__adhelloOppCardToolsHtml({ key, title, phone, email, tagKeys, isLastStage, canMove })
 *   window.__adhelloOppCardRemoveHtml({ key, title })
 *   window.__adhelloOppStageSmsButtonHtml()
 */
(function () {
  'use strict';

  if (window.__adhelloBindOppCardActions) return;

  var SVG_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var ICONS = {
    call: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
    sms: SVG_OPEN + '<path d="M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 1 1 18 0z"/></svg>',
    email: SVG_OPEN + '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
    contacts: SVG_OPEN + '<circle cx="9" cy="8" r="3.5"/><path d="M3 20a6 6 0 0 1 9.4-4.9"/><circle cx="17" cy="16" r="3"/><path d="m21.5 20.5-2.3-2.3"/></svg>',
    schedule: SVG_OPEN + '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/></svg>',
    task: SVG_OPEN + '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m8 12 3 3 5-6"/></svg>',
    tags: SVG_OPEN + '<path d="M20.59 13.41 13.42 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1.25"/></svg>',
    move: SVG_OPEN + '<path d="M8 7h11M16 3l4 4-4 4"/><path d="M16 17H5M8 21l-4-4 4-4"/></svg>',
    ghl: SVG_OPEN + '<path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M21 21v-5h-5"/></svg>',
    advance: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>',
    remove: SVG_OPEN + '<path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M8 7l1 12h6l1-12"/><path d="M10 11v5M14 11v5"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11z"/><circle cx="12" cy="10" r="2.25"/></svg>',
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function usablePhone(value) {
    var s = String(value || '').trim();
    return !s || s === 'N/A' || s === '—' || s === 'undefined' ? '' : s;
  }

  function toolsHtml(o) {
    var key = escapeHtml(o.key);
    var title = escapeHtml(o.title);
    var phone = usablePhone(o.phone);
    var common = ' data-lead-key="' + key + '" data-title="' + title + '"';
    function btn(action, label, extra, icon) {
      return '<button type="button" data-opp-action="' + action + '"' + common + (extra || '') + ' title="' + label + '" aria-label="' + label + '">' + icon + '</button>';
    }
    return (
      '<div class="opp-card-tools">' +
      '<button type="button" class="opp-card-call" data-opp-action="call"' + common + (phone ? '' : ' disabled') +
      ' title="' + (phone ? 'Call ' + escapeHtml(phone) + ' in the softphone' : 'No phone number on this lead') + '" aria-label="Call">' + ICONS.call + '</button>' +
      btn('sms', 'SMS', ' data-phone="' + escapeHtml(phone) + '"', ICONS.sms) +
      btn('email', 'Email', ' data-email="' + escapeHtml(o.email || '') + '"', ICONS.email) +
      btn('contacts', 'Find contacts', '', ICONS.contacts) +
      btn('schedule', 'Schedule', '', ICONS.schedule) +
      btn('task', 'Task', '', ICONS.task) +
      btn('tags', 'Tags', ' data-tags="' + escapeHtml(JSON.stringify(o.tagKeys || [])) + '"', ICONS.tags) +
      (o.canMove === false ? '' : btn('move', 'Move to another pipeline', '', ICONS.move)) +
      btn('ghl', 'Sync GHL', '', ICONS.ghl) +
      btn('advance', 'Move to next stage', o.isLastStage ? ' hidden' : '', ICONS.advance) +
      '</div>'
    );
  }

  /** Trash button for the card's top-right corner (inside `.opp-card-head`). */
  function removeButtonHtml(o) {
    return (
      '<button type="button" class="opp-card-remove" data-opp-action="remove" data-lead-key="' + escapeHtml(o.key) +
      '" data-title="' + escapeHtml(o.title) + '" title="Remove from opportunities" aria-label="Remove from opportunities">' +
      ICONS.remove + '</button>'
    );
  }

  /** Stage-header buttons: call queue in the softphone, then group SMS, for every lead in the column. */
  function stageSmsButtonHtml() {
    return (
      '<button type="button" class="opp-stage-call" data-opp-action="stage-call" title="Call everyone in this stage" aria-label="Call everyone in this stage" disabled>' +
      ICONS.call + '</button>' +
      '<button type="button" class="opp-stage-sms" data-opp-action="stage-sms" title="Text everyone in this stage" aria-label="Text everyone in this stage" disabled>' +
      ICONS.sms + '</button>'
    );
  }

  window.__adhelloOppCardIcons = ICONS;
  window.__adhelloOppCardToolsHtml = toolsHtml;
  window.__adhelloOppCardRemoveHtml = removeButtonHtml;
  window.__adhelloOppStageSmsButtonHtml = stageSmsButtonHtml;

  function post(url, body) {
    return fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body || {}),
    }).then(function (res) {
      return res.json().then(
        function (data) { return { ok: res.ok, data: data }; },
        function () { return { ok: false, data: { error: 'The server sent an unexpected reply. Try again in a moment.' } }; }
      );
    });
  }

  /* Long stages are capped so the /focus URL stays under proxy header limits. */
  var MONEY_MODE_STAGE_KEY_CAP = 80;

  function bind(board, options) {
    if (!board || board.getAttribute('data-opp-icons') === '1') return;
    board.setAttribute('data-opp-icons', '1');
    var press = null;
    var pop = null;

    var cfg = Object.assign(
      {
        column: '.opp-stage',
        list: '.opp-stage-cards',
        stageId: function (col) { return (col && col.getAttribute('data-stage-id')) || ''; },
        stageName: function (col) {
          var el = col && col.querySelector('.opp-stage-title');
          return el ? String(el.textContent || '').trim() : '';
        },
        pipelineId: function () { return board.getAttribute('data-pipeline-id') || ''; },
        status: function (text, ok) {
          var msg = document.getElementById('oppBoardMsg');
          if (!msg) return;
          msg.textContent = text;
          msg.classList.toggle('is-ok', !!ok);
          msg.classList.remove('hidden');
        },
        refreshStage: refreshOppStage,
        openProfile: openMoneyMode,
        pipelines: function () {
          var node = document.getElementById('oppBoardPipelinesJson');
          if (node) {
            try {
              var fromPage = JSON.parse(node.textContent || '[]');
              if (Array.isArray(fromPage)) return fromPage;
            } catch (e) { /* fall through */ }
          }
          try {
            var parsed = JSON.parse(board.getAttribute('data-pipelines') || '[]');
            return Array.isArray(parsed) ? parsed : [];
          } catch (e) {
            return [];
          }
        },
        /** Persist a stage change within this board; resolves `{ ok, data }` like `post`. */
        persistStage: function (key, column) {
          return post('/opportunities/move', { leadKey: key, pipelineId: cfg.pipelineId(column), stageId: cfg.stageId(column) });
        },
        onPlaced: function () {},
        onRemoved: function () {},
      },
      options || {}
    );

    function status(text, ok) {
      cfg.status(text, ok);
    }

    function refreshStage(column) {
      if (!column) return;
      cfg.refreshStage(column);
      syncAdvanceButtons(column);
    }

    function refreshOppStage(column) {
      var list = column.querySelector('.opp-stage-cards');
      var cards = list ? list.querySelectorAll('.opp-card') : [];
      var count = cards.length;
      var badge = column.querySelector('.opp-stage-count');
      if (badge) badge.textContent = String(count);
      var meta = column.querySelector('.opp-stage-meta');
      if (meta) {
        var total = 0;
        Array.prototype.forEach.call(cards, function (item) {
          total += Number(item.getAttribute('data-value')) || 0;
        });
        if (total > 0) meta.textContent = total.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
        else meta.textContent = count === 1 ? '1 opportunity' : count + ' opportunities';
      }
      if (!list) return;
      var drop = list.querySelector('.opp-drop');
      if (!count && !drop) {
        list.classList.add('is-empty');
        drop = document.createElement('div');
        drop.className = 'opp-drop';
        drop.textContent = 'Drop here';
        list.appendChild(drop);
      }
      if (count && drop) drop.remove();
      list.classList.toggle('is-empty', !count);
    }

    function closePop() {
      if (pop && pop.parentNode) pop.parentNode.removeChild(pop);
      pop = null;
    }

    function paintOppPopSurface() {
      if (!pop) return;
      var dark = document.documentElement.classList.contains('dark');
      var fill = dark ? '#0f172a' : '#ffffff';
      var ink = dark ? '#f8fafc' : '#111827';
      var shadow = '0 18px 44px rgba(15, 23, 42, 0.28)';
      [
        ['position', 'fixed'],
        ['display', 'block'],
        ['visibility', 'visible'],
        ['pointer-events', 'auto'],
        ['z-index', '10060'],
        ['width', 'min(18rem, calc(100vw - 1.5rem))'],
        ['min-width', '16rem'],
        ['background', fill],
        ['background-color', fill],
        ['background-image', 'none'],
        ['color', ink],
        ['opacity', '1'],
        ['backdrop-filter', 'none'],
        ['-webkit-backdrop-filter', 'none'],
        ['isolation', 'isolate'],
        ['box-shadow', shadow],
        ['overflow', 'visible'],
        ['transform', 'none'],
        ['clip-path', 'none'],
        ['filter', 'none'],
        ['padding', '0'],
      ].forEach(function (pair) {
        pop.style.setProperty(pair[0], pair[1], 'important');
      });
      if (typeof window.applyPortaledPopoverSurface === 'function') {
        window.applyPortaledPopoverSurface(pop);
      }
      pop.querySelectorAll('.opp-pop__surface, .adhello-mini-calendar__surface, .opp-cal, .opp-cal-nav').forEach(function (node) {
        node.style.setProperty('background', fill, 'important');
        node.style.setProperty('background-color', fill, 'important');
        node.style.setProperty('background-image', 'none', 'important');
        node.style.setProperty('color', ink, 'important');
        node.style.setProperty('visibility', 'visible', 'important');
        node.style.setProperty('opacity', '1', 'important');
      });
    }

    function placePop(anchor) {
      if (!pop || !anchor) return;
      paintOppPopSurface();
      var rect = anchor.getBoundingClientRect();
      var width = Math.max(pop.offsetWidth || 280, 256);
      var height = pop.offsetHeight || 280;
      var left = Math.min(rect.left, window.innerWidth - width - 12);
      if (left < 8) left = 8;
      var top = rect.bottom + 8;
      if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 8);
      pop.style.setProperty('left', left + 'px', 'important');
      pop.style.setProperty('top', top + 'px', 'important');
    }

    function openPop() {
      closePop();
      pop = document.createElement('div');
      pop.className = 'opp-pop portaled-popover-surface';
      pop.setAttribute('role', 'dialog');
      var surface = document.createElement('div');
      surface.className = 'opp-pop__surface adhello-mini-calendar__surface';
      pop.appendChild(surface);
      document.body.appendChild(pop);
      paintOppPopSurface();
      // Callers fill the opaque surface; positioning uses the outer shell.
      return surface;
    }

    function leadKey(action) {
      if (!action) return '';
      var card = action.closest ? action.closest('.opp-card') : null;
      var fromCard = card && card.getAttribute('data-lead-key');
      if (fromCard) return fromCard;
      return action.getAttribute('data-lead-key') || '';
    }

    function leadTitle(action) {
      if (!action) return 'this opportunity';
      var fromAction = action.getAttribute('data-title');
      if (fromAction) return fromAction;
      var card = action.closest ? action.closest('.opp-card') : null;
      var fromCard = card && card.getAttribute('data-title');
      if (fromCard) return fromCard;
      return 'this opportunity';
    }

    function cardForKey(key) {
      var found = null;
      Array.prototype.forEach.call(board.querySelectorAll('.opp-card[data-lead-key]'), function (c) {
        if (!found && c.getAttribute('data-lead-key') === key) found = c;
      });
      return found;
    }

    function moneyModeUrlForKey(key) {
      var stageKeys = [];
      var clicked = cardForKey(key);
      var list = clicked && clicked.closest(cfg.list);
      if (list) {
        Array.prototype.forEach.call(list.querySelectorAll('.opp-card[data-lead-key]'), function (c) {
          var k = c.getAttribute('data-lead-key');
          if (k && stageKeys.indexOf(k) === -1) stageKeys.push(k);
        });
      }
      var start = stageKeys.indexOf(key);
      if (start > 0) stageKeys = stageKeys.slice(start).concat(stageKeys.slice(0, start));
      if (start === -1) stageKeys.unshift(key);
      stageKeys = stageKeys.slice(0, MONEY_MODE_STAGE_KEY_CAP);
      var params = new URLSearchParams();
      params.set('lead', key);
      if (stageKeys.length > 1) params.set('keys', stageKeys.join(','));
      params.set('from', 'opportunities');
      var pipelineId = board.getAttribute('data-pipeline-id');
      if (pipelineId) params.set('pipeline', pipelineId);
      return '/focus?' + params.toString();
    }

    function openMoneyMode(key) {
      status('Opening Money mode…', true);
      window.location.href = moneyModeUrlForKey(key);
    }

    function openProfileByKey(profileKey) {
      var key = String(profileKey || '').trim();
      if (!key) {
        status('Could not open that company.', false);
        return;
      }
      closePop();
      cfg.openProfile(key, cardForKey(key));
    }

    function resolvePressTarget(ev) {
      if (ev.button != null && ev.button !== 0) return null;
      var card = ev.target.closest('.opp-card');
      var tools = ev.target.closest('.opp-card-tools');
      var action = ev.target.closest('[data-opp-action]');
      if (tools) {
        if (!action || !card) return null;
        return {
          x: ev.clientX,
          y: ev.clientY,
          action: action,
          kind: action.getAttribute('data-opp-action') || '',
          leadKey: card.getAttribute('data-lead-key') || action.getAttribute('data-lead-key') || '',
        };
      }
      if (action) {
        return {
          x: ev.clientX,
          y: ev.clientY,
          action: action,
          kind: action.getAttribute('data-opp-action') || '',
          leadKey: (card && card.getAttribute('data-lead-key')) || action.getAttribute('data-lead-key') || '',
        };
      }
      if (card) {
        return { x: ev.clientX, y: ev.clientY, action: null, kind: 'profile', leadKey: card.getAttribute('data-lead-key') || '' };
      }
      return null;
    }

    function openComposer(kind, action) {
      var key = leadKey(action);
      if (!key) return;
      var opener = kind === 'email'
        ? (window.__openBulkEmailModal || window.__openBulkEmailModalImplFull)
        : (window.__openBulkSmsModalImpl || window.__openBulkSmsModal || window.__openBulkSmsModalImplFull);
      if (typeof opener !== 'function') {
        status(kind === 'email' ? 'Email templates are still loading. Try again.' : 'SMS templates are still loading. Try again.', false);
        return;
      }
      status(kind === 'email' ? 'Opening email templates…' : 'Opening SMS templates…', true);
      Promise.resolve(opener([key])).then(function (result) {
        if (result && result.ok === false) status(result.message || 'Could not open that composer.', false);
      }).catch(function () {
        status('Could not open that composer.', false);
      });
    }

    function fetchTags() {
      return fetch('/tags', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (res) { return res.json(); })
        .then(function (data) { return (data && data.tags) || []; });
    }

    function openTags(action) {
      var key = leadKey(action);
      if (!key) return;
      var applied = [];
      try { applied = JSON.parse(action.getAttribute('data-tags') || '[]'); } catch (e) { applied = []; }
      if (!Array.isArray(applied)) applied = [];
      var box = openPop();
      box.innerHTML = '<h4>Add a tag</h4><div class="opp-pop-tags">Loading tags…</div><form class="opp-pop-row"><input type="text" name="name" placeholder="New tag" maxlength="40" /><button type="submit" class="opp-pop-add">Add</button></form>';
      paintOppPopSurface();
      placePop(action);
      requestAnimationFrame(function () { placePop(action); });
      var list = box.querySelector('.opp-pop-tags');
      function paint(tags) {
        list.textContent = '';
        if (!tags.length) {
          list.textContent = 'No tags yet. Create one below.';
          return;
        }
        tags.forEach(function (tag) {
          if (!tag || !tag.key) return;
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'opp-pop-tag' + (applied.indexOf(tag.key) >= 0 ? ' is-on' : '');
          btn.textContent = (applied.indexOf(tag.key) >= 0 ? '' : '+ ') + (tag.name || 'Tag');
          btn.addEventListener('click', function () {
            var on = applied.indexOf(tag.key) >= 0;
            btn.disabled = true;
            post('/tags/assign', { leadKey: key, tagKeys: [tag.key], mode: on ? 'remove' : 'add' }).then(function (result) {
              btn.disabled = false;
              if (!result.ok || !result.data || !result.data.success) {
                status((result.data && result.data.error) || 'Could not update that tag.', false);
                return;
              }
              if (on) applied = applied.filter(function (item) { return item !== tag.key; });
              else applied.push(tag.key);
              action.setAttribute('data-tags', JSON.stringify(applied));
              status(on ? 'Tag removed.' : 'Tag added.', true);
              paint(tags);
            }).catch(function () {
              btn.disabled = false;
              status('Could not update that tag.', false);
            });
          });
          list.appendChild(btn);
        });
      }
      fetchTags().then(paint).catch(function () { list.textContent = 'Could not load tags.'; });
      box.querySelector('form').addEventListener('submit', function (ev) {
        ev.preventDefault();
        var input = box.querySelector('input');
        var name = String(input.value || '').trim();
        if (!name) return;
        input.disabled = true;
        post('/tags', { name: name }).then(function (created) {
          if (!created.ok || !created.data || !created.data.tag) {
            input.disabled = false;
            status((created.data && created.data.error) || 'Could not create that tag.', false);
            return;
          }
          return post('/tags/assign', { leadKey: key, tagKeys: [created.data.tag.key], mode: 'add' }).then(function (assigned) {
            input.disabled = false;
            input.value = '';
            if (!assigned.ok || !assigned.data || !assigned.data.success) {
              status((assigned.data && assigned.data.error) || 'Tag created, but it was not added.', false);
              return;
            }
            applied.push(created.data.tag.key);
            action.setAttribute('data-tags', JSON.stringify(applied));
            status('Tag added.', true);
            return fetchTags().then(paint);
          });
        }).catch(function () {
          input.disabled = false;
          status('Could not create that tag.', false);
        });
      });
    }

    function openCalendar(action) {
      var key = leadKey(action);
      var title = leadTitle(action);
      var box = openPop();
      var view = new Date();
      view.setDate(1);
      var selected = '';
      box.innerHTML = '<h4>Schedule follow-up</h4><div class="opp-cal-nav"><button type="button" data-cal="prev" aria-label="Previous month">‹</button><span data-cal="label"></span><button type="button" data-cal="next" aria-label="Next month">›</button></div><div class="opp-cal" data-cal="grid"></div><div class="opp-pop-row"><select class="opp-pop-time" data-cal="time"></select><button type="button" class="opp-pop-add" data-cal="save">Save</button></div>';
      paintOppPopSurface();
      var time = box.querySelector('[data-cal="time"]');
      for (var hour = 8; hour <= 18; hour++) {
        var opt = document.createElement('option');
        opt.value = String(hour);
        opt.textContent = (hour > 12 ? hour - 12 : hour) + ':00 ' + (hour >= 12 ? 'PM' : 'AM');
        if (hour === 15) opt.selected = true;
        time.appendChild(opt);
      }
      function render() {
        var label = box.querySelector('[data-cal="label"]');
        var grid = box.querySelector('[data-cal="grid"]');
        label.textContent = view.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
        grid.textContent = '';
        ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].forEach(function (day) {
          var span = document.createElement('span');
          span.textContent = day;
          grid.appendChild(span);
        });
        var first = new Date(view.getFullYear(), view.getMonth(), 1);
        for (var i = 0; i < first.getDay(); i++) grid.appendChild(document.createElement('span'));
        var days = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
        var today = new Date();
        for (var day = 1; day <= days; day++) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = String(day);
          var iso = view.getFullYear() + '-' + String(view.getMonth() + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
          btn.setAttribute('data-day', iso);
          if (today.getFullYear() === view.getFullYear() && today.getMonth() === view.getMonth() && today.getDate() === day) btn.classList.add('is-today');
          if (selected === iso) btn.classList.add('is-selected');
          grid.appendChild(btn);
        }
      }
      box.addEventListener('click', function (ev) {
        var prev = ev.target.closest('[data-cal="prev"]');
        var next = ev.target.closest('[data-cal="next"]');
        var day = ev.target.closest('[data-day]');
        var save = ev.target.closest('[data-cal="save"]');
        if (prev || next) {
          view.setMonth(view.getMonth() + (next ? 1 : -1));
          render();
          return;
        }
        if (day) {
          selected = day.getAttribute('data-day');
          render();
          return;
        }
        if (!save) return;
        if (!selected) {
          status('Pick a day first.', false);
          return;
        }
        var when = new Date(selected + 'T' + String(time.value).padStart(2, '0') + ':00:00');
        if (Number.isNaN(when.getTime())) {
          status('Pick a valid day.', false);
          return;
        }
        save.disabled = true;
        post('/tasks/api', {
          title: 'Follow up with ' + title,
          leadKey: key,
          scheduledAt: when.toISOString(),
          remindMinutesBefore: 15,
        }).then(function (result) {
          save.disabled = false;
          if (!result.ok || !result.data || !result.data.success) {
            status((result.data && result.data.error) || 'Could not schedule that.', false);
            return;
          }
          closePop();
          status('Scheduled.', true);
        }).catch(function () {
          save.disabled = false;
          status('Could not schedule that.', false);
        });
      });
      render();
      placePop(action);
      requestAnimationFrame(function () { placePop(action); });
    }

    function syncGhl(action) {
      var key = leadKey(action);
      if (!key || action.classList.contains('is-syncing')) return;
      action.classList.add('is-syncing');
      action.setAttribute('aria-label', 'Sync in progress');
      status('Sync in progress…', true);
      post('/ghl/push', { leadKeys: [key] }).then(function (result) {
        action.classList.remove('is-syncing');
        action.setAttribute('aria-label', 'Sync GHL');
        if (!result.ok || !result.data || !result.data.success) {
          status(
            (result.data && result.data.error) ||
              'Could not sync that opportunity. Check Workspace → Integrations (token + Location ID must match).',
            false
          );
          return;
        }
        status('Synced to Go High Level.', true);
      }).catch(function () {
        action.classList.remove('is-syncing');
        action.setAttribute('aria-label', 'Sync GHL');
        status('Could not sync that opportunity. Check Workspace → Integrations.', false);
      });
    }

    function applyFoundContacts(card, lead) {
      if (!card || !lead) return;
      var phone = usablePhone(lead.phone);
      if (phone && !card.getAttribute('data-phone')) {
        card.setAttribute('data-phone', phone);
        var callBtn = card.querySelector('.opp-card-call');
        if (callBtn) {
          callBtn.disabled = false;
          callBtn.title = 'Call ' + phone + ' in the softphone';
        }
        var smsBtn = card.querySelector('[data-opp-action="sms"]');
        if (smsBtn) smsBtn.setAttribute('data-phone', phone);
      }
      var email = usablePhone(lead.email);
      var emailBtn = card.querySelector('[data-opp-action="email"]');
      if (email && emailBtn && !emailBtn.getAttribute('data-email')) emailBtn.setAttribute('data-email', email);
    }

    function findContacts(action) {
      var key = leadKey(action);
      if (!key || action.classList.contains('is-finding')) return;
      var card = action.closest('.opp-card');
      var name = leadTitle(action) || 'this lead';
      action.classList.add('is-finding');
      action.setAttribute('aria-label', 'Finding contacts');
      status('Finding contacts for ' + name + ' — this can take up to a minute…', true);
      function done() {
        action.classList.remove('is-finding');
        action.setAttribute('aria-label', 'Find contacts');
      }
      post('/leads/' + encodeURIComponent(key) + '/find-contacts', {}).then(function (result) {
        done();
        var data = result.data || {};
        if (data.lead) applyFoundContacts(card, data.lead);
        if (!result.ok || !data.success) {
          status(name + ': ' + (data.error || 'Could not find contacts.'), false);
          return;
        }
        status(name + ': ' + (data.message || 'Contacts updated.'), true);
      }).catch(function () {
        done();
        status('Could not find contacts. Check your connection and try again.', false);
      });
    }

    function nextStageColumn(column) {
      if (!column) return null;
      var next = column.nextElementSibling;
      while (next && !(next.matches && next.matches(cfg.column))) next = next.nextElementSibling;
      return next;
    }

    function syncAdvanceButtons(column) {
      if (!column) return;
      var hasNext = !!nextStageColumn(column);
      Array.prototype.forEach.call(column.querySelectorAll('[data-opp-action="advance"]'), function (btn) {
        btn.hidden = !hasNext;
      });
    }

    function restoreCard(card, list, nextSibling) {
      if (!card || !list) return;
      if (nextSibling && nextSibling.parentNode === list) list.insertBefore(card, nextSibling);
      else list.appendChild(card);
    }

    function advanceOpportunity(action) {
      var key = leadKey(action);
      var card = action.closest('.opp-card');
      var fromColumn = card && card.closest(cfg.column);
      var toColumn = nextStageColumn(fromColumn);
      if (!key || !card) return;
      if (!toColumn) {
        status('Already in the last stage.', false);
        return;
      }
      var toList = toColumn.querySelector(cfg.list);
      var stageId = cfg.stageId(toColumn);
      if (!toList || !stageId || action.disabled) return;

      var stageName = cfg.stageName(toColumn) || 'next stage';
      var fromList = card.parentNode;
      var nextSibling = card.nextSibling;

      action.disabled = true;
      closePop();
      toList.appendChild(card);
      refreshStage(fromColumn);
      refreshStage(toColumn);
      status('Moved to ' + stageName + '.', true);

      function undo(message) {
        action.disabled = false;
        restoreCard(card, fromList, nextSibling);
        refreshStage(fromColumn);
        refreshStage(toColumn);
        status(message || 'Could not move that opportunity. Card restored.', false);
      }
      cfg.persistStage(key, toColumn).then(function (result) {
        if (result && result.ok && result.data && result.data.success) {
          action.disabled = false;
          cfg.onPlaced(key, cfg.pipelineId(toColumn), stageId, result.data);
          return;
        }
        undo(result && result.data && result.data.error);
      }).catch(function () { undo(); });
    }

    function openMove(action) {
      var key = leadKey(action);
      if (!key) return;
      var card = action.closest('.opp-card');
      var column = card && card.closest(cfg.column);
      var currentPipelineId = cfg.pipelineId(column);
      var others = (cfg.pipelines() || []).filter(function (pipe) {
        return pipe && pipe.id && pipe.id !== currentPipelineId;
      });
      var box = openPop();
      if (!others.length) {
        box.innerHTML = '<h4>Move to another pipeline</h4><p class="opp-move-empty">Create another pipeline first, then you can move this lead there.</p><button type="button" class="opp-pop-add" data-move="new" style="margin-top:0.65rem">New pipeline</button>';
        paintOppPopSurface();
        placePop(action);
        box.querySelector('[data-move="new"]').addEventListener('click', function () {
          closePop();
          var btn = document.getElementById('oppNewPipeline');
          if (btn) btn.click();
          else window.location.href = '/opportunities';
        });
        return;
      }
      var html = '<h4>Move to another pipeline</h4><div class="opp-move-list">';
      others.forEach(function (pipe) {
        html += '<div class="opp-move-pipe"><strong>' + escapeHtml(pipe.name || 'Pipeline') + '</strong><div class="opp-move-stages">';
        (Array.isArray(pipe.stages) ? pipe.stages : []).forEach(function (stage) {
          html += '<button type="button" class="opp-move-stage" data-move-pipeline="' + escapeHtml(pipe.id) + '" data-move-stage="' + escapeHtml(stage.id) + '" data-move-label="' + escapeHtml((pipe.name || 'Pipeline') + ' · ' + (stage.name || 'Stage')) + '">' + escapeHtml(stage.name || 'Stage') + '</button>';
        });
        html += '</div></div>';
      });
      html += '</div>';
      box.innerHTML = html;
      paintOppPopSurface();
      placePop(action);
      box.addEventListener('click', function (ev) {
        var target = ev.target.closest('[data-move-pipeline]');
        if (!target || target.disabled) return;
        var pipelineId = target.getAttribute('data-move-pipeline');
        var stageId = target.getAttribute('data-move-stage');
        var label = target.getAttribute('data-move-label') || 'that pipeline';
        if (!pipelineId || !stageId) return;

        var nextSibling = card && card.nextSibling;
        var parentList = card && card.parentNode;

        // Optimistic: leave the board immediately; persist in the background.
        closePop();
        if (card) card.remove();
        refreshStage(column);
        status('Moved to ' + label + '.', true);

        function undo(message) {
          restoreCard(card, parentList, nextSibling);
          refreshStage(column);
          status(message || 'Could not move that opportunity. Card restored.', false);
        }
        post('/opportunities/move', { leadKey: key, pipelineId: pipelineId, stageId: stageId }).then(function (result) {
          if (result.ok && result.data && result.data.success) {
            cfg.onPlaced(key, pipelineId, stageId, result.data);
            return;
          }
          undo(result.data && result.data.error);
        }).catch(function () { undo(); });
      });
    }

    function stageCallItems(column) {
      if (!column) return [];
      return Array.prototype.map.call(column.querySelectorAll('.opp-card[data-lead-key]'), function (c) {
        return {
          key: c.getAttribute('data-lead-key') || '',
          title: c.getAttribute('data-title') || 'Lead',
          phone: c.getAttribute('data-phone') || '',
        };
      });
    }

    /** Load the stage into the softphone; `startKey` picks which card is on the keypad first. */
    function callStageInSoftphone(column, startKey) {
      closePop();
      if (typeof window.__adhelloCallQueueInSoftphone !== 'function') {
        status('The dialer is still loading. Try again in a moment.', false);
        return;
      }
      var n = window.__adhelloCallQueueInSoftphone(stageCallItems(column), startKey || '');
      if (!n) {
        status('No one in this stage has a phone number.', false);
        return;
      }
      status(
        'Softphone loaded with ' + n + ' lead' + (n === 1 ? '' : 's') + ' from this stage — press the green button to dial, then › for the next one.',
        true
      );
    }

    function stageSmsKeys(column) {
      var keys = [];
      var noPhone = 0;
      if (column) {
        Array.prototype.forEach.call(column.querySelectorAll('.opp-card[data-lead-key]'), function (c) {
          var k = c.getAttribute('data-lead-key') || '';
          if (!k || keys.indexOf(k) >= 0) return;
          if (usablePhone(c.getAttribute('data-phone'))) keys.push(k);
          else noPhone += 1;
        });
      }
      return { keys: keys, noPhone: noPhone };
    }

    function syncStageSmsButton(column) {
      if (!column) return;
      var n = stageSmsKeys(column).keys.length;
      var leads = n + ' lead' + (n === 1 ? '' : 's');
      var sms = column.querySelector('.opp-stage-sms');
      if (sms) {
        sms.disabled = !n;
        sms.title = n ? 'Text everyone in this stage (' + leads + ')' : 'No one in this stage has a phone number';
      }
      var call = column.querySelector('.opp-stage-call');
      if (call) {
        call.disabled = !n;
        call.title = n ? 'Call everyone in this stage (' + leads + ') in the softphone' : 'No one in this stage has a phone number';
      }
    }

    function syncAllStageSmsButtons() {
      Array.prototype.forEach.call(board.querySelectorAll(cfg.column), syncStageSmsButton);
    }

    /** Group SMS for the stage — the bulk modal runs the Do Not Contact / GHL precheck itself. */
    function smsStage(column) {
      closePop();
      var picked = stageSmsKeys(column);
      var n = picked.keys.length;
      if (!n) {
        status('No one in this stage has a phone number.', false);
        return;
      }
      var opener = window.__openBulkSmsModalImpl || window.__openBulkSmsModal || window.__openBulkSmsModalImplFull;
      if (typeof opener !== 'function') {
        status('SMS templates are still loading. Try again.', false);
        return;
      }
      var hidden = parseInt((column && column.getAttribute('data-hidden-count')) || '0', 10) || 0;
      var parts = [hidden ? 'Texting the ' + n + ' lead' + (n === 1 ? '' : 's') + ' shown' : 'Opening group SMS for ' + n + ' lead' + (n === 1 ? '' : 's')];
      if (hidden) parts.push('open the full board to include the other ' + hidden);
      if (picked.noPhone) parts.push(picked.noPhone + ' without a phone number left out');
      status(parts.join(' · ') + '.', true);
      Promise.resolve(opener(picked.keys)).then(function (result) {
        if (result && result.ok === false) status(result.message || 'Could not open group SMS.', false);
      }).catch(function () {
        status('Could not open group SMS.', false);
      });
    }

    function removeOpportunity(action) {
      var key = leadKey(action);
      var card = action.closest('.opp-card');
      if (!key || !card || action.disabled) return;
      var message = 'Remove ' + leadTitle(action) + ' from opportunities? The lead stays in your list.';
      var runRemove = function () {
        action.disabled = true;
        status('Removing…', true);
        post('/opportunities/remove', { leadKey: key }).then(function (result) {
          action.disabled = false;
          if (!result.ok || !result.data || !result.data.success) {
            status((result.data && result.data.error) || 'Could not remove that opportunity.', false);
            return;
          }
          var column = card.closest(cfg.column);
          card.remove();
          refreshStage(column);
          cfg.onRemoved(key);
          status('Removed from opportunities.', true);
        }).catch(function () {
          action.disabled = false;
          status('Could not remove that opportunity.', false);
        });
      };
      if (typeof window.adhelloConfirm === 'function') {
        window.adhelloConfirm({
          title: 'Remove opportunity?',
          message: message,
          confirmLabel: 'Remove',
          cancelLabel: 'Cancel',
          danger: true,
        }).then(function (ok) {
          if (ok) runRemove();
        });
        return;
      }
      if (!window.confirm(message)) return;
      runRemove();
    }

    function run(action) {
      var kind = action.getAttribute('data-opp-action');
      if (kind === 'stage-sms') {
        if (!action.disabled) smsStage(action.closest(cfg.column));
        return;
      }
      if (kind === 'stage-call') {
        if (!action.disabled) callStageInSoftphone(action.closest(cfg.column), '');
        return;
      }
      if (kind === 'call') {
        var callCard = action.closest('.opp-card');
        if (!callCard || !callCard.getAttribute('data-phone')) {
          status('No phone number on this lead.', false);
          return;
        }
        callStageInSoftphone(callCard.closest(cfg.column), leadKey(action));
        return;
      }
      if (kind === 'profile') {
        openProfileByKey(leadKey(action));
        return;
      }
      if (kind === 'sms' || kind === 'email') {
        closePop();
        openComposer(kind, action);
        return;
      }
      if (kind === 'schedule') return openCalendar(action);
      if (kind === 'task') {
        closePop();
        var taskKey = leadKey(action);
        window.location.href = '/tasks' + (taskKey ? '?leadKey=' + encodeURIComponent(taskKey) : '');
        return;
      }
      if (kind === 'tags') return openTags(action);
      if (kind === 'move') return openMove(action);
      if (kind === 'advance') return advanceOpportunity(action);
      if (kind === 'ghl') return syncGhl(action);
      if (kind === 'contacts') return findContacts(action);
      if (kind === 'remove') return removeOpportunity(action);
    }

    board.addEventListener('pointerdown', function (ev) {
      press = resolvePressTarget(ev);
    }, true);

    board.addEventListener('pointerup', function (ev) {
      if (!press) return;
      // Don't open profile while (or right after) a Sortable drag — especially on iPhone.
      if (board.getAttribute('data-opp-sorting') === '1' || document.body.classList.contains('opp-sorting')) {
        press = null;
        return;
      }
      var moved = Math.abs(ev.clientX - press.x) > 8 || Math.abs(ev.clientY - press.y) > 8;
      var snapshot = press;
      press = null;
      if (moved) return;
      // Use the lead key captured on press — not whatever is under the cursor on release
      // (scroll containers / Sortable can shift hit-testing by one card).
      ev.preventDefault();
      ev.stopPropagation();
      if (snapshot.kind === 'profile') {
        openProfileByKey(snapshot.leadKey);
        return;
      }
      if (!snapshot.action) return;
      if (snapshot.leadKey) snapshot.action.setAttribute('data-lead-key', snapshot.leadKey);
      run(snapshot.action);
    }, true);

    document.addEventListener('pointerdown', function (ev) {
      if (!pop) return;
      if (pop.contains(ev.target) || ev.target.closest('[data-opp-action]')) return;
      closePop();
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') closePop();
    });

    // Cards arrive and leave through drags, advances and board rebuilds; keep stage SMS buttons in step.
    var smsSyncQueued = false;
    if (typeof MutationObserver === 'function') {
      new MutationObserver(function () {
        if (smsSyncQueued) return;
        smsSyncQueued = true;
        requestAnimationFrame(function () {
          smsSyncQueued = false;
          syncAllStageSmsButtons();
        });
      }).observe(board, { childList: true, subtree: true });
    }
    syncAllStageSmsButtons();

    return { refreshStage: refreshStage, closePop: closePop, syncStageSms: syncAllStageSmsButtons };
  }

  window.__adhelloBindOppCardActions = bind;
})();
