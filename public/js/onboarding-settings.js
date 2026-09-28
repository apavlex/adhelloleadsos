/**
 * Workspace → Teammate onboarding editor (invite email + daily activation steps).
 */
(function () {
  'use strict';

  var root = document.getElementById('onboardingEditor');
  var dataEl = document.getElementById('onboardingEditorData');
  if (!root || !dataEl) return;

  var data;
  try {
    data = JSON.parse(dataEl.textContent || '{}');
  } catch (e) {
    return;
  }
  var events = data.events || [];
  var links = data.links || [];
  var maxSteps = data.maxSteps || 14;
  var steps = ((data.config && data.config.steps) || []).map(function (s) { return Object.assign({}, s); });
  var dirty = false;
  var listEl = document.getElementById('obSteps');

  var INPUT = 'w-full rounded-xl border border-brand-border dark:border-white/10 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-brand-dark dark:text-white';
  var LABEL = 'text-[10px] font-black uppercase tracking-widest text-brand-muted block mb-1';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function postJson(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body || {}),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok || !j.success) throw new Error(j.error || 'Request failed (' + r.status + ')');
        return j;
      });
    });
  }

  function setStatus(el, msg, tone) {
    if (!el) return;
    el.classList.remove('hidden');
    el.textContent = msg || '';
    var color = tone === 'ok' ? 'text-emerald-700 dark:text-emerald-300' : tone === 'err' ? 'text-rose-600 dark:text-rose-400' : 'text-brand-muted';
    el.className = (el.id ? '' : 'ob-status ') + 'text-xs ' + color;
  }

  function markDirty() {
    dirty = true;
    var msg = document.getElementById('obSaveMsg');
    if (msg) {
      msg.textContent = 'Unsaved changes';
      msg.className = 'text-sm text-amber-700 dark:text-amber-300';
    }
  }

  function eventOptions(selected) {
    return events.map(function (ev) {
      return '<option value="' + esc(ev.key) + '"' + (ev.key === selected ? ' selected' : '') + '>' + esc(ev.label) + '</option>';
    }).join('');
  }

  function stepHtml(step, i, open) {
    var total = steps.length;
    return (
      '<li class="ob-step rounded-2xl border border-brand-border/60 dark:border-white/10 bg-white/70 dark:bg-slate-900/50" data-step-id="' + esc(step.id) + '">' +
      '<details' + (open ? ' open' : '') + '>' +
      '<summary class="flex flex-wrap items-center gap-3 cursor-pointer px-4 py-3">' +
      '<span class="w-8 h-8 shrink-0 rounded-xl flex items-center justify-center font-black text-xs bg-brand-cream dark:bg-slate-800 text-brand-dark dark:text-white">' + (i + 1) + '</span>' +
      '<span class="ob-step-label font-bold text-brand-dark dark:text-white flex-1 min-w-0 truncate">Day ' + (i + 1) + ' — ' + esc(step.title || 'Untitled') + '</span>' +
      '<span class="flex items-center gap-1">' +
      '<button type="button" data-step-action="up" class="px-2 py-1 text-xs text-brand-muted hover:text-brand-dark dark:hover:text-white disabled:opacity-30"' + (i === 0 ? ' disabled' : '') + ' aria-label="Move up">↑</button>' +
      '<button type="button" data-step-action="down" class="px-2 py-1 text-xs text-brand-muted hover:text-brand-dark dark:hover:text-white disabled:opacity-30"' + (i === total - 1 ? ' disabled' : '') + ' aria-label="Move down">↓</button>' +
      '<button type="button" data-step-action="remove" class="px-2 py-1 text-[10px] font-black uppercase tracking-widest text-rose-600 hover:underline disabled:opacity-30"' + (total <= 1 ? ' disabled' : '') + '>Remove</button>' +
      '</span>' +
      '</summary>' +
      '<div class="px-4 pb-4 pt-1 space-y-3" data-ob-email="step">' +
      '<div class="grid gap-3 md:grid-cols-2">' +
      '<label class="block"><span class="' + LABEL + '">Step title</span><input type="text" data-ob-field="title" value="' + esc(step.title) + '" class="' + INPUT + '" /></label>' +
      '<label class="block"><span class="' + LABEL + '">Checklist hint</span><input type="text" data-ob-field="hint" value="' + esc(step.hint) + '" class="' + INPUT + '" /></label>' +
      '<label class="block"><span class="' + LABEL + '">Link (Go button + {{step_link}})</span><input type="text" data-ob-field="href" list="obLinkOptions" value="' + esc(step.href) + '" class="' + INPUT + '" /></label>' +
      '<label class="block"><span class="' + LABEL + '">Auto-checks when the teammate…</span><select data-ob-field="event" class="' + INPUT + '">' + eventOptions(step.event || '') + '</select></label>' +
      '</div>' +
      '<label class="block"><span class="' + LABEL + '">Email subject</span><input type="text" data-ob-field="subject" value="' + esc(step.subject) + '" class="' + INPUT + '" /></label>' +
      '<label class="block"><span class="' + LABEL + '">Email body</span><textarea data-ob-field="body" rows="8" class="' + INPUT + ' font-mono text-[13px] leading-relaxed">' + esc(step.body) + '</textarea></label>' +
      '<div class="flex flex-col sm:flex-row gap-2">' +
      '<input type="text" data-ob-field="instruction" placeholder="Optional: tell AI how to rewrite this email" class="' + INPUT + ' flex-1" />' +
      '<button type="button" data-ob-action="rewrite" class="btn-pill border border-violet-400/60 bg-violet-50 dark:bg-violet-900/30 text-violet-800 dark:text-violet-200 px-4 py-2 text-[10px] font-black uppercase tracking-widest shrink-0">Rewrite with AI</button>' +
      '<button type="button" data-ob-action="test" class="btn-pill border border-brand-border dark:border-white/15 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-brand-dark dark:text-white shrink-0">Send test to me</button>' +
      '</div>' +
      '<p class="ob-status hidden text-xs" role="status"></p>' +
      '</div>' +
      '</details>' +
      '</li>'
    );
  }

  function openStepIds() {
    var ids = {};
    listEl.querySelectorAll('.ob-step').forEach(function (li) {
      var d = li.querySelector('details');
      if (d && d.open) ids[li.getAttribute('data-step-id')] = true;
    });
    return ids;
  }

  function render(openIds) {
    var open = openIds || {};
    listEl.innerHTML = steps.map(function (s, i) { return stepHtml(s, i, !!open[s.id]); }).join('');
    var count = document.getElementById('obStepCount');
    if (count) count.textContent = '· ' + steps.length + (steps.length === 1 ? ' day' : ' days');
    var add = document.getElementById('obAddStep');
    if (add) add.disabled = steps.length >= maxSteps;
  }

  function readField(scope, name) {
    var el = scope.querySelector('[data-ob-field="' + name + '"]');
    return el ? String(el.value || '') : '';
  }

  function collectSteps() {
    var out = [];
    listEl.querySelectorAll('.ob-step').forEach(function (li) {
      out.push({
        id: li.getAttribute('data-step-id') || '',
        title: readField(li, 'title').trim(),
        hint: readField(li, 'hint').trim(),
        href: readField(li, 'href').trim(),
        event: readField(li, 'event'),
        subject: readField(li, 'subject').trim(),
        body: readField(li, 'body'),
      });
    });
    return out;
  }

  function inviteScope() {
    return root.querySelector('[data-ob-email="invite"]');
  }

  function collectConfig() {
    var inv = inviteScope();
    return {
      enabled: !!document.getElementById('obEnabled').checked,
      sendInviteEmail: !!document.getElementById('obSendInvite').checked,
      skipCompleted: !!document.getElementById('obSkipCompleted').checked,
      sendHour: parseInt(document.getElementById('obSendHour').value, 10),
      invite: { subject: readField(inv, 'subject').trim(), body: readField(inv, 'body') },
      steps: collectSteps(),
    };
  }

  function newId() {
    return 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // Link suggestions for the step link input.
  var dl = document.createElement('datalist');
  dl.id = 'obLinkOptions';
  dl.innerHTML = links.map(function (l) { return '<option value="' + esc(l.href) + '">' + esc(l.label) + '</option>'; }).join('');
  root.appendChild(dl);

  render();

  root.addEventListener('input', function (e) {
    markDirty();
    var t = e.target;
    if (t && t.getAttribute('data-ob-field') === 'title') {
      var li = t.closest('.ob-step');
      if (!li) return;
      var idx = Array.prototype.indexOf.call(listEl.children, li);
      var label = li.querySelector('.ob-step-label');
      if (label) label.textContent = 'Day ' + (idx + 1) + ' — ' + (t.value.trim() || 'Untitled');
    }
  });
  root.addEventListener('change', markDirty);

  listEl.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-step-action]');
    if (!btn) return;
    e.preventDefault();
    var li = btn.closest('.ob-step');
    var open = openStepIds();
    steps = collectSteps();
    var idx = Array.prototype.indexOf.call(listEl.children, li);
    var action = btn.getAttribute('data-step-action');
    if (action === 'up' && idx > 0) steps.splice(idx - 1, 0, steps.splice(idx, 1)[0]);
    if (action === 'down' && idx < steps.length - 1) steps.splice(idx + 1, 0, steps.splice(idx, 1)[0]);
    if (action === 'remove' && steps.length > 1) {
      if (!window.confirm('Remove Day ' + (idx + 1) + '?')) return;
      steps.splice(idx, 1);
    }
    render(open);
    markDirty();
  });

  document.getElementById('obAddStep').addEventListener('click', function () {
    if (steps.length >= maxSteps) return;
    var open = openStepIds();
    steps = collectSteps();
    var id = newId();
    steps.push({
      id: id,
      title: 'New step',
      hint: '',
      href: '/today',
      event: '',
      subject: 'Day {{day}}: {{step_title}}',
      body: "Hi {{first_name}},\n\nToday's habit: {{step_title}}.\n\n{{step_hint}}\n\nStart here: {{step_link}}\n\n— The {{workspace_name}} team",
    });
    open[id] = true;
    render(open);
    markDirty();
  });

  document.getElementById('obResetSteps').addEventListener('click', function () {
    if (!window.confirm('Replace all steps with the default 7-day plan? (Not saved until you click Save.)')) return;
    steps = ((data.defaults && data.defaults.steps) || []).map(function (s) { return Object.assign({}, s); });
    render();
    markDirty();
  });

  document.getElementById('obGeneratePlan').addEventListener('click', function () {
    var btn = this;
    var status = document.getElementById('obPlanStatus');
    if (!window.confirm('Replace your current steps with an AI-generated plan? You can review before saving.')) return;
    btn.disabled = true;
    setStatus(status, 'Writing a plan for this workspace… (about 20 seconds)');
    postJson('/workspace/onboarding/generate-plan', {
      instruction: document.getElementById('obPlanInstruction').value,
      days: document.getElementById('obPlanDays').value,
    })
      .then(function (j) {
        steps = j.steps || [];
        var open = {};
        if (steps[0]) open[steps[0].id] = true;
        render(open);
        markDirty();
        setStatus(status, 'New ' + steps.length + '-day plan ready. Review the steps, then click Save onboarding.', 'ok');
      })
      .catch(function (err) { setStatus(status, err.message, 'err'); })
      .finally(function () { btn.disabled = false; });
  });

  root.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-ob-action]');
    if (!btn) return;
    var scope = btn.closest('[data-ob-email]');
    if (!scope) return;
    var kind = scope.getAttribute('data-ob-email');
    var status = scope.querySelector('.ob-status');
    var li = btn.closest('.ob-step');
    var stepIndex = li ? Array.prototype.indexOf.call(listEl.children, li) : null;
    var payload = {
      kind: kind,
      subject: readField(scope, 'subject'),
      body: readField(scope, 'body'),
      title: kind === 'step' ? readField(scope, 'title') : '',
      hint: kind === 'step' ? readField(scope, 'hint') : '',
    };
    btn.disabled = true;
    if (btn.getAttribute('data-ob-action') === 'rewrite') {
      payload.instruction = readField(scope, 'instruction');
      setStatus(status, 'Rewriting…');
      postJson('/workspace/onboarding/rewrite', payload)
        .then(function (j) {
          scope.querySelector('[data-ob-field="subject"]').value = j.subject || payload.subject;
          scope.querySelector('[data-ob-field="body"]').value = j.body || payload.body;
          markDirty();
          setStatus(status, 'Rewritten. Review it, then Save onboarding.', 'ok');
        })
        .catch(function (err) { setStatus(status, err.message, 'err'); })
        .finally(function () { btn.disabled = false; });
    } else {
      payload.stepIndex = stepIndex;
      payload.steps = collectSteps();
      setStatus(status, 'Sending test through GHL…');
      postJson('/workspace/onboarding/test', payload)
        .then(function (j) { setStatus(status, 'Test sent to ' + j.sentTo + '.', 'ok'); })
        .catch(function (err) { setStatus(status, err.message, 'err'); })
        .finally(function () { btn.disabled = false; });
    }
  });

  document.getElementById('obSave').addEventListener('click', function () {
    var btn = this;
    var msg = document.getElementById('obSaveMsg');
    var cfg = collectConfig();
    if (cfg.steps.some(function (s) { return !s.title; })) {
      msg.textContent = 'Every step needs a title.';
      msg.className = 'text-sm text-rose-600 dark:text-rose-400';
      return;
    }
    btn.disabled = true;
    postJson('/workspace/onboarding', { onboarding: cfg })
      .then(function (j) {
        var open = openStepIds();
        steps = (j.onboarding && j.onboarding.steps) || steps;
        render(open);
        dirty = false;
        msg.textContent = 'Saved. Future emails and the activation checklist use these steps.';
        msg.className = 'text-sm text-emerald-700 dark:text-emerald-300';
      })
      .catch(function (err) {
        msg.textContent = err.message;
        msg.className = 'text-sm text-rose-600 dark:text-rose-400';
      })
      .finally(function () { btn.disabled = false; });
  });

  root.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-ob-member-action]');
    if (!btn) return;
    var row = btn.closest('[data-ob-member]');
    var email = row && row.getAttribute('data-ob-member');
    var action = btn.getAttribute('data-ob-member-action');
    var verb = action === 'stop' ? 'Stop onboarding emails for ' : action === 'restart' ? 'Restart onboarding from Day 1 for ' : 'Start onboarding (Day 1 sends now) for ';
    if (!email || !window.confirm(verb + email + '?')) return;
    btn.disabled = true;
    postJson('/workspace/onboarding/member', { email: email, action: action })
      .then(function () { window.location.reload(); })
      .catch(function (err) {
        btn.disabled = false;
        window.alert(err.message);
      });
  });

  window.addEventListener('beforeunload', function (e) {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = '';
  });
})();
