(function () {
  'use strict';

  var STYLE_ID = 'adhello-dialog-style';
  var ROOT_ID = 'adhelloDialogRoot';
  var active = null;

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '#' + ROOT_ID + '{position:fixed;inset:0;z-index:11000;display:flex;align-items:flex-start;justify-content:center;padding:4.5rem 1rem 1.5rem;box-sizing:border-box;}',
      '#' + ROOT_ID + '[hidden]{display:none!important;}',
      '#' + ROOT_ID + ' .adhello-dialog-backdrop{position:absolute;inset:0;background:rgba(15,23,42,0.55);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);}',
      '#' + ROOT_ID + ' .adhello-dialog-panel{position:relative;z-index:1;width:min(24rem,calc(100vw - 2rem));background:#fff;border:1px solid rgba(17,24,39,0.1);border-radius:1.5rem;box-shadow:0 24px 60px rgba(15,23,42,0.28);padding:1.35rem 1.35rem 1.2rem;color:#111827;}',
      'html.dark #' + ROOT_ID + ' .adhello-dialog-panel{background:#0f172a;border-color:rgba(255,255,255,0.12);color:#f8fafc;}',
      '#' + ROOT_ID + ' .adhello-dialog-eyebrow{margin:0 0 0.35rem;font-size:0.625rem;font-weight:800;letter-spacing:0.16em;text-transform:uppercase;color:#94a3b8;}',
      '#' + ROOT_ID + ' .adhello-dialog-title{margin:0;font-size:1.15rem;font-weight:800;line-height:1.25;color:inherit;}',
      '#' + ROOT_ID + ' .adhello-dialog-message{margin:0.65rem 0 0;font-size:0.875rem;font-weight:600;line-height:1.45;color:#64748b;}',
      'html.dark #' + ROOT_ID + ' .adhello-dialog-message{color:#94a3b8;}',
      '#' + ROOT_ID + ' .adhello-dialog-label{display:block;margin:1rem 0 0.4rem;font-size:0.625rem;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;color:#94a3b8;}',
      '#' + ROOT_ID + ' .adhello-dialog-input{display:block;width:100%;box-sizing:border-box;border:1px solid rgba(17,24,39,0.12);border-radius:0.85rem;background:rgba(250,247,237,0.72);padding:0.7rem 0.85rem;font-size:0.9rem;font-weight:600;color:inherit;outline:none;}',
      '#' + ROOT_ID + ' .adhello-dialog-input:focus{border-color:rgba(250,204,21,0.7);box-shadow:0 0 0 3px rgba(250,204,21,0.28);}',
      'html.dark #' + ROOT_ID + ' .adhello-dialog-input{background:rgba(30,41,59,0.85);border-color:rgba(255,255,255,0.12);}',
      '#' + ROOT_ID + ' .adhello-dialog-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:0.5rem;margin-top:1.15rem;}',
      '#' + ROOT_ID + ' .adhello-dialog-btn{display:inline-flex;align-items:center;justify-content:center;min-height:2.55rem;padding:0.55rem 1.15rem;border-radius:999px;font-size:0.625rem;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;cursor:pointer;border:1px solid transparent;}',
      '#' + ROOT_ID + ' .adhello-dialog-btn:disabled{opacity:0.55;cursor:not-allowed;}',
      '#' + ROOT_ID + ' .adhello-dialog-btn--ghost{background:#fff;border-color:rgba(17,24,39,0.14);color:#111827;}',
      'html.dark #' + ROOT_ID + ' .adhello-dialog-btn--ghost{background:#0f172a;border-color:rgba(255,255,255,0.16);color:#f8fafc;}',
      '#' + ROOT_ID + ' .adhello-dialog-btn--ghost:hover{background:rgba(250,247,237,0.9);}',
      'html.dark #' + ROOT_ID + ' .adhello-dialog-btn--ghost:hover{background:rgba(30,41,59,0.9);}',
      '#' + ROOT_ID + ' .adhello-dialog-btn--primary{background:#0f2747;color:#fff;}',
      '#' + ROOT_ID + ' .adhello-dialog-btn--primary:hover{filter:brightness(1.08);}',
      '#' + ROOT_ID + ' .adhello-dialog-btn--danger{background:#e11d48;color:#fff;}',
      '#' + ROOT_ID + ' .adhello-dialog-btn--danger:hover{filter:brightness(1.05);}',
      '#' + ROOT_ID + ' .adhello-dialog-panel--wide{width:min(34rem,calc(100vw - 2rem));}',
      '#' + ROOT_ID + ' .adhello-dialog-choices{display:flex;flex-direction:column;gap:0.45rem;margin-top:0.9rem;max-height:min(22rem,48vh);overflow:auto;padding-right:0.15rem;}',
      '#' + ROOT_ID + ' .adhello-dialog-choice{display:block;width:100%;text-align:left;border:1px solid rgba(17,24,39,0.12);border-radius:1rem;background:#fff;padding:0.7rem 0.8rem;cursor:pointer;color:inherit;}',
      'html.dark #' + ROOT_ID + ' .adhello-dialog-choice{background:#1e293b;border-color:rgba(255,255,255,0.12);}',
      '#' + ROOT_ID + ' .adhello-dialog-choice:hover{border-color:rgba(202,138,4,0.45);background:rgba(250,204,21,0.12);}',
      '#' + ROOT_ID + ' .adhello-dialog-choice.is-on{border-color:rgba(202,138,4,0.55);background:rgba(250,204,21,0.22);box-shadow:inset 0 0 0 1px rgba(202,138,4,0.25);}',
      '#' + ROOT_ID + ' .adhello-dialog-choice strong{display:block;font-size:0.82rem;font-weight:800;}',
      '#' + ROOT_ID + ' .adhello-dialog-choice span{display:block;margin-top:0.2rem;font-size:0.72rem;font-weight:600;color:#64748b;line-height:1.35;}',
      'html.dark #' + ROOT_ID + ' .adhello-dialog-choice span{color:#94a3b8;}',
      '#' + ROOT_ID + ' .adhello-dialog-stages{display:flex;flex-wrap:wrap;gap:0.28rem;margin-top:0.45rem;}',
      '#' + ROOT_ID + ' .adhello-dialog-stage{display:inline-flex;align-items:center;border-radius:999px;padding:0.18rem 0.45rem;font-size:0.62rem;font-weight:700;background:rgba(15,39,71,0.08);color:#0f2747;}',
      'html.dark #' + ROOT_ID + ' .adhello-dialog-stage{background:rgba(255,255,255,0.08);color:#f8fafc;}',
    ].join('');
    document.head.appendChild(style);
  }

  function ensureRoot() {
    ensureStyle();
    var root = document.getElementById(ROOT_ID);
    if (root) return root;
    root = document.createElement('div');
    root.id = ROOT_ID;
    root.hidden = true;
    root.setAttribute('aria-hidden', 'true');
    document.body.appendChild(root);
    return root;
  }

  function closeActive(result) {
    if (!active) return;
    var current = active;
    active = null;
    var root = document.getElementById(ROOT_ID);
    if (root) {
      root.hidden = true;
      root.setAttribute('aria-hidden', 'true');
      root.innerHTML = '';
    }
    document.removeEventListener('keydown', current.onKey, true);
    current.resolve(result);
  }

  function openDialog(options) {
    options = options || {};
    if (active) closeActive(options.mode === 'prompt' ? null : false);

    return new Promise(function (resolve) {
      var root = ensureRoot();
      var isPrompt = options.mode === 'prompt';
      var title = String(options.title || (isPrompt ? 'Enter a value' : 'Please confirm'));
      var message = String(options.message || '');
      var label = String(options.label || title);
      var confirmLabel = String(options.confirmLabel || (isPrompt ? 'Save' : 'Confirm'));
      var cancelLabel = String(options.cancelLabel || 'Cancel');
      var danger = !!options.danger;
      var maxLength = Number(options.maxLength) > 0 ? Number(options.maxLength) : 40;
      var initial = String(options.value == null ? '' : options.value);

      root.innerHTML =
        '<div class="adhello-dialog-backdrop" data-adhello-dialog="cancel" aria-hidden="true"></div>' +
        '<div class="adhello-dialog-panel" role="dialog" aria-modal="true" aria-labelledby="adhelloDialogTitle">' +
        '<p class="adhello-dialog-eyebrow">AdHello</p>' +
        '<h3 class="adhello-dialog-title" id="adhelloDialogTitle"></h3>' +
        (message ? '<p class="adhello-dialog-message" id="adhelloDialogMessage"></p>' : '') +
        (isPrompt
          ? '<label class="adhello-dialog-label" for="adhelloDialogInput"></label><input id="adhelloDialogInput" class="adhello-dialog-input" type="text" autocomplete="off" />'
          : '') +
        '<div class="adhello-dialog-actions">' +
        '<button type="button" class="adhello-dialog-btn adhello-dialog-btn--ghost" data-adhello-dialog="cancel"></button>' +
        '<button type="button" class="adhello-dialog-btn ' +
        (danger ? 'adhello-dialog-btn--danger' : 'adhello-dialog-btn--primary') +
        '" data-adhello-dialog="confirm"></button>' +
        '</div></div>';

      root.querySelector('#adhelloDialogTitle').textContent = title;
      if (message) root.querySelector('#adhelloDialogMessage').textContent = message;
      var cancelBtn = root.querySelector('[data-adhello-dialog="cancel"].adhello-dialog-btn');
      var confirmBtn = root.querySelector('[data-adhello-dialog="confirm"]');
      cancelBtn.textContent = cancelLabel;
      confirmBtn.textContent = confirmLabel;

      var input = null;
      if (isPrompt) {
        var labelEl = root.querySelector('.adhello-dialog-label');
        labelEl.textContent = label;
        input = root.querySelector('#adhelloDialogInput');
        input.value = initial;
        input.maxLength = maxLength;
      }

      function onKey(ev) {
        if (ev.key === 'Escape') {
          ev.preventDefault();
          closeActive(isPrompt ? null : false);
          return;
        }
        if (ev.key === 'Enter' && isPrompt && document.activeElement === input) {
          ev.preventDefault();
          confirmBtn.click();
        }
      }

      active = { resolve: resolve, onKey: onKey };
      root.hidden = false;
      root.setAttribute('aria-hidden', 'false');
      document.addEventListener('keydown', onKey, true);

      root.addEventListener('click', function (ev) {
        var action = ev.target.closest('[data-adhello-dialog]');
        if (!action || !root.contains(action)) return;
        var kind = action.getAttribute('data-adhello-dialog');
        if (kind === 'cancel') {
          closeActive(isPrompt ? null : false);
          return;
        }
        if (kind !== 'confirm') return;
        if (isPrompt) {
          closeActive(String((input && input.value) || '').trim());
          return;
        }
        closeActive(true);
      });

      requestAnimationFrame(function () {
        if (input) {
          input.focus();
          input.select();
        } else {
          confirmBtn.focus();
        }
      });
    });
  }

  window.adhelloPrompt = function (labelOrOptions, value) {
    if (labelOrOptions && typeof labelOrOptions === 'object') {
      return openDialog({
        mode: 'prompt',
        title: labelOrOptions.title || labelOrOptions.label || 'Enter a value',
        label: labelOrOptions.label || labelOrOptions.title || 'Value',
        value: labelOrOptions.value,
        confirmLabel: labelOrOptions.confirmLabel,
        cancelLabel: labelOrOptions.cancelLabel,
        maxLength: labelOrOptions.maxLength,
      });
    }
    return openDialog({
      mode: 'prompt',
      title: String(labelOrOptions || 'Enter a value'),
      label: String(labelOrOptions || 'Value'),
      value: value,
    });
  };

  window.adhelloConfirm = function (messageOrOptions, title) {
    if (messageOrOptions && typeof messageOrOptions === 'object') {
      return openDialog({
        mode: 'confirm',
        title: messageOrOptions.title || 'Please confirm',
        message: messageOrOptions.message || '',
        confirmLabel: messageOrOptions.confirmLabel,
        cancelLabel: messageOrOptions.cancelLabel,
        danger: messageOrOptions.danger,
      });
    }
    return openDialog({
      mode: 'confirm',
      title: String(title || 'Please confirm'),
      message: String(messageOrOptions || ''),
      danger: true,
    });
  };

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  window.adhelloPickPipelineTemplate = function (options) {
    options = options || {};
    var templates = Array.isArray(options.templates) ? options.templates : [];
    if (!templates.length) {
      return window.adhelloPrompt({
        title: 'New pipeline name',
        label: 'Pipeline name',
        value: 'New pipeline',
        confirmLabel: 'Create',
      }).then(function (name) {
        if (!name) return null;
        return { templateId: 'marketing', name: name };
      });
    }

    if (active) closeActive(null);

    return new Promise(function (resolve) {
      var root = ensureRoot();
      var selectedId = String(options.selectedId || templates[0].id || 'marketing');
      var initialName = String(options.value || '');

      function findTemplate(id) {
        for (var i = 0; i < templates.length; i++) {
          if (templates[i].id === id) return templates[i];
        }
        return templates[0];
      }

      function choiceHtml(template) {
        var stages = Array.isArray(template.stages) ? template.stages : [];
        var chips = stages
          .map(function (stage) {
            return '<span class="adhello-dialog-stage">' + escapeHtml(stage) + '</span>';
          })
          .join('');
        return (
          '<button type="button" class="adhello-dialog-choice' +
          (template.id === selectedId ? ' is-on' : '') +
          '" data-adhello-dialog="pick" data-template-id="' +
          escapeHtml(template.id) +
          '"><strong>' +
          escapeHtml(template.name) +
          '</strong><span>' +
          escapeHtml(template.description || '') +
          '</span><div class="adhello-dialog-stages">' +
          chips +
          '</div></button>'
        );
      }

      root.innerHTML =
        '<div class="adhello-dialog-backdrop" data-adhello-dialog="cancel" aria-hidden="true"></div>' +
        '<div class="adhello-dialog-panel adhello-dialog-panel--wide" role="dialog" aria-modal="true" aria-labelledby="adhelloDialogTitle">' +
        '<p class="adhello-dialog-eyebrow">AdHello</p>' +
        '<h3 class="adhello-dialog-title" id="adhelloDialogTitle">New pipeline</h3>' +
        '<p class="adhello-dialog-message">Pick a template, then name the board. You can edit stages anytime.</p>' +
        '<div class="adhello-dialog-choices">' +
        templates.map(choiceHtml).join('') +
        '</div>' +
        '<label class="adhello-dialog-label" for="adhelloDialogInput">Pipeline name</label>' +
        '<input id="adhelloDialogInput" class="adhello-dialog-input" type="text" maxlength="40" autocomplete="off" />' +
        '<div class="adhello-dialog-actions">' +
        '<button type="button" class="adhello-dialog-btn adhello-dialog-btn--ghost" data-adhello-dialog="cancel">Cancel</button>' +
        '<button type="button" class="adhello-dialog-btn adhello-dialog-btn--primary" data-adhello-dialog="confirm">Create pipeline</button>' +
        '</div></div>';

      var input = root.querySelector('#adhelloDialogInput');
      var selected = findTemplate(selectedId);
      input.value = initialName || selected.name || 'New pipeline';

      function syncSelection() {
        var buttons = root.querySelectorAll('[data-adhello-dialog="pick"]');
        Array.prototype.forEach.call(buttons, function (btn) {
          btn.classList.toggle('is-on', btn.getAttribute('data-template-id') === selectedId);
        });
      }

      function onKey(ev) {
        if (ev.key === 'Escape') {
          ev.preventDefault();
          closeActive(null);
          return;
        }
        if (ev.key === 'Enter' && document.activeElement === input) {
          ev.preventDefault();
          root.querySelector('[data-adhello-dialog="confirm"]').click();
        }
      }

      active = { resolve: resolve, onKey: onKey };
      root.hidden = false;
      root.setAttribute('aria-hidden', 'false');
      document.addEventListener('keydown', onKey, true);

      root.addEventListener('click', function (ev) {
        var action = ev.target.closest('[data-adhello-dialog]');
        if (!action || !root.contains(action)) return;
        var kind = action.getAttribute('data-adhello-dialog');
        if (kind === 'cancel') {
          closeActive(null);
          return;
        }
        if (kind === 'pick') {
          selectedId = action.getAttribute('data-template-id') || selectedId;
          var next = findTemplate(selectedId);
          if (!String(input.value || '').trim() || templates.some(function (item) { return item.name === input.value; })) {
            input.value = next.name || '';
          }
          syncSelection();
          return;
        }
        if (kind !== 'confirm') return;
        var name = String(input.value || '').trim();
        if (!name) {
          input.focus();
          return;
        }
        closeActive({ templateId: selectedId, name: name });
      });

      requestAnimationFrame(function () {
        input.focus();
        input.select();
      });
    });
  };
})();
