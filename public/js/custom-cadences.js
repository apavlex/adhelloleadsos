/* Cadences page: build, edit, delete custom GHL cadences; copy their GHL prompt; stop leads. */
(function () {
  var dataEl = document.getElementById('customCadencesData');
  var section = document.getElementById('custom-cadences');
  if (!dataEl || !section) return;
  var data = {};
  try {
    data = JSON.parse(dataEl.textContent || '{}');
  } catch (e) {
    data = {};
  }
  var cadences = Array.isArray(data.cadences) ? data.cadences : [];
  var channels = data.channels || { sms: 'SMS', email: 'Email', call: 'Call task', voicemail: 'Voicemail drop' };

  var EXAMPLE = {
    name: 'Territory seat invite',
    goal: 'Book a 15-minute call about the open seat',
    steps: [
      { dayOffset: 0, channel: 'sms', message: "Hi {{first_name}}, it's {{my_name}} with {{sender_business}}. We send homeowner jobs to one pro per trade in {{city}} and that seat is open. Want the details?" },
      { dayOffset: 1, channel: 'call', message: 'Mention yesterday\'s text. Ask how they get most of their jobs today and whether they could take 3–5 more a month in {{city}}.' },
      { dayOffset: 3, channel: 'email', subject: '{{first_name}}, the {{city}} seat for {{company}}', message: "Hi {{first_name}},\n\n{{sender_pitch}}\n\nOne seat per trade per area, first come first served. Worth a 15-minute call this week?\n\n{{my_name}}\n{{sender_business}}" },
      { dayOffset: 6, channel: 'sms', message: 'Last note from me, {{first_name}}. Should I hold the {{city}} seat for {{company}} or offer it to the next pro on the list?' },
    ],
  };

  var status = document.getElementById('ccStatus');
  function say(msg, ok) {
    if (!status) return;
    status.textContent = msg;
    status.className = 'text-[11px] ' + (ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300');
    setTimeout(function () { status.classList.add('hidden'); }, 4000);
  }

  async function post(url, body) {
    var res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body || {}),
    });
    var json = await res.json().catch(function () { return {}; });
    if (!res.ok || !json.success) throw new Error((json && json.error) || 'Something went wrong.');
    return json;
  }

  function cardId(el) {
    var card = el.closest('.cc-card');
    return card ? card.getAttribute('data-cadence-id') : '';
  }

  function copyText(text, btn) {
    function done(ok) {
      var prev = btn.textContent;
      btn.textContent = ok ? 'Copied' : 'Select and copy';
      setTimeout(function () { btn.textContent = prev; }, 2000);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }).catch(function () { done(false); });
    } else {
      done(false);
    }
  }

  // ── Editor ────────────────────────────────────────────────────────────────
  var form = document.getElementById('ccEditor');
  var stepsEl = document.getElementById('ccSteps');
  var lastMessageBox = null;

  function slugify(name) {
    return String(name || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  }

  function channelOptions(selected) {
    return Object.keys(channels).map(function (k) {
      return '<option value="' + k + '"' + (k === selected ? ' selected' : '') + '>' + channels[k] + '</option>';
    }).join('');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function addStepRow(step) {
    var s = step || { dayOffset: stepsEl.children.length ? 2 * stepsEl.children.length : 0, channel: 'sms', message: '' };
    var row = document.createElement('div');
    row.className = 'cc-step rounded-xl border border-brand-border/50 dark:border-white/10 bg-white dark:bg-slate-900 p-3 space-y-2';
    row.innerHTML =
      '<div class="flex flex-wrap items-center gap-2">' +
      '<label class="flex items-center gap-1.5 text-[11px] font-bold text-brand-muted">Day <input type="number" min="0" max="90" class="cc-day w-16 rounded-lg border border-brand-border dark:border-white/10 bg-white dark:bg-slate-900 px-2 py-1 text-sm" value="' + (parseInt(s.dayOffset, 10) || 0) + '" /></label>' +
      '<select class="cc-channel rounded-lg border border-brand-border dark:border-white/10 bg-white dark:bg-slate-900 px-2 py-1 text-sm">' + channelOptions(s.channel) + '</select>' +
      '<input class="cc-subject flex-1 min-w-[12rem] rounded-lg border border-brand-border dark:border-white/10 bg-white dark:bg-slate-900 px-2 py-1 text-sm" maxlength="160" placeholder="Email subject" value="' + escapeHtml(s.subject || '') + '" />' +
      '<button type="button" class="cc-remove ml-auto text-[10px] font-black uppercase tracking-widest text-rose-500 hover:text-rose-600">Remove</button>' +
      '</div>' +
      '<textarea class="cc-message w-full rounded-lg border border-brand-border dark:border-white/10 bg-white dark:bg-slate-900 px-3 py-2 text-sm" rows="3" maxlength="1600" placeholder="Message, script, or talking points"></textarea>';
    row.querySelector('.cc-message').value = s.message || '';
    stepsEl.appendChild(row);
    syncSubject(row);
  }

  function syncSubject(row) {
    var isEmail = row.querySelector('.cc-channel').value === 'email';
    row.querySelector('.cc-subject').classList.toggle('hidden', !isEmail);
    var msg = row.querySelector('.cc-message');
    var ch = row.querySelector('.cc-channel').value;
    msg.placeholder = ch === 'call' ? 'Talking points for the call' : ch === 'voicemail' ? 'Voicemail script' : ch === 'email' ? 'Email body' : 'Text message';
  }

  function updateTagPreview() {
    var preview = document.getElementById('ccTagPreview');
    if (!preview || !form) return;
    var id = form.elements.id.value;
    var existing = cadences.find(function (c) { return c.id === id; });
    var slug = existing ? existing.slug : slugify(form.elements.name.value);
    preview.textContent = slug ? 'GHL tag: cadence-' + slug + (existing ? ' (stays the same when renamed)' : '') : '';
  }

  function openEditor(cadence) {
    if (!form) return;
    form.classList.remove('hidden');
    form.elements.id.value = cadence && cadence.id ? cadence.id : '';
    form.elements.name.value = (cadence && cadence.name) || '';
    form.elements.goal.value = (cadence && cadence.goal) || '';
    document.getElementById('ccEditorTitle').textContent = cadence && cadence.id ? 'Edit cadence' : 'New cadence';
    document.getElementById('ccEditorError').classList.add('hidden');
    stepsEl.innerHTML = '';
    var steps = cadence && Array.isArray(cadence.steps) && cadence.steps.length ? cadence.steps : [null];
    steps.forEach(function (s) { addStepRow(s); });
    updateTagPreview();
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    form.elements.name.focus();
  }

  if (form) {
    document.getElementById('ccNewBtn').addEventListener('click', function () { openEditor(null); });
    document.getElementById('ccCancelBtn').addEventListener('click', function () { form.classList.add('hidden'); });
    document.getElementById('ccAddStepBtn').addEventListener('click', function () { addStepRow(null); });
    document.getElementById('ccExampleBtn').addEventListener('click', function () {
      openEditor({ id: form.elements.id.value, name: form.elements.name.value || EXAMPLE.name, goal: form.elements.goal.value || EXAMPLE.goal, steps: EXAMPLE.steps });
    });
    form.elements.name.addEventListener('input', updateTagPreview);
    stepsEl.addEventListener('change', function (e) {
      if (e.target.classList.contains('cc-channel')) syncSubject(e.target.closest('.cc-step'));
    });
    stepsEl.addEventListener('focusin', function (e) {
      if (e.target.classList.contains('cc-message') || e.target.classList.contains('cc-subject')) lastMessageBox = e.target;
    });
    stepsEl.addEventListener('click', function (e) {
      if (!e.target.classList.contains('cc-remove')) return;
      e.target.closest('.cc-step').remove();
      if (!stepsEl.children.length) addStepRow(null);
    });
    form.querySelectorAll('.cc-token').forEach(function (chip) {
      chip.addEventListener('mousedown', function (e) { e.preventDefault(); });
      chip.addEventListener('click', function () {
        var box = lastMessageBox || stepsEl.querySelector('.cc-message');
        if (!box) return;
        var token = chip.textContent;
        var start = box.selectionStart != null ? box.selectionStart : box.value.length;
        var end = box.selectionEnd != null ? box.selectionEnd : start;
        box.value = box.value.slice(0, start) + token + box.value.slice(end);
        box.focus();
        box.selectionStart = box.selectionEnd = start + token.length;
      });
    });
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var err = document.getElementById('ccEditorError');
      var steps = Array.prototype.map.call(stepsEl.querySelectorAll('.cc-step'), function (row) {
        return {
          dayOffset: row.querySelector('.cc-day').value,
          channel: row.querySelector('.cc-channel').value,
          subject: row.querySelector('.cc-subject').value,
          message: row.querySelector('.cc-message').value,
        };
      });
      var btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        await post('/sequences/custom', {
          id: form.elements.id.value,
          name: form.elements.name.value,
          goal: form.elements.goal.value,
          steps: steps,
        });
        window.location.hash = 'custom-cadences';
        window.location.reload();
      } catch (ex) {
        err.textContent = ex.message;
        err.classList.remove('hidden');
        btn.disabled = false;
      }
    });
  }

  // ── Cards ─────────────────────────────────────────────────────────────────
  section.addEventListener('click', async function (e) {
    var t = e.target;
    if (t.classList.contains('cc-copy')) {
      var ta = t.closest('details').querySelector('.cc-prompt');
      copyText(ta ? ta.value : '', t);
      return;
    }
    if (t.classList.contains('cc-edit')) {
      openEditor(cadences.find(function (c) { return c.id === cardId(t); }));
      return;
    }
    try {
      if (t.classList.contains('cc-delete')) {
        var c = cadences.find(function (x) { return x.id === cardId(t); });
        if (!window.confirm('Delete "' + (c ? c.name : 'this cadence') + '"? Leads already on it keep their GHL tag until you stop them.')) return;
        await post('/sequences/custom/' + encodeURIComponent(cardId(t)) + '/delete');
        t.closest('.cc-card').remove();
        say('Cadence deleted.', true);
      } else if (t.classList.contains('cc-ready')) {
        await post('/sequences/custom/' + encodeURIComponent(cardId(t)) + '/ghl-ready');
        window.location.reload();
      } else if (t.classList.contains('cc-stop')) {
        t.disabled = true;
        await post('/sequences/custom/stop', { leadKey: t.getAttribute('data-lead-key') });
        t.closest('li').remove();
        say('Stopped — the cadence tag comes off in GHL on the next sync.', true);
      }
    } catch (ex) {
      t.disabled = false;
      say(ex.message, false);
    }
  });
})();
