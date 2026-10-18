(function () {
  var modal = document.getElementById('sendLeadModal');
  if (!modal) return;
  var form = document.getElementById('sendLeadForm');
  var loading = document.getElementById('sendLeadLoading');
  var empty = document.getElementById('sendLeadEmpty');
  var done = document.getElementById('sendLeadDone');
  var doneText = document.getElementById('sendLeadDoneText');
  var errorBox = document.getElementById('sendLeadError');
  var submit = document.getElementById('sendLeadSubmit');
  var list = document.getElementById('sendLeadTeammateList');
  var sendAll = document.getElementById('sendLeadAll');
  var teammates = [];

  function show(panel) {
    [loading, empty, done, form].forEach(function (el) {
      if (el) el.classList.toggle('hidden', el !== panel);
    });
  }

  function setError(text) {
    if (!errorBox) return;
    errorBox.textContent = text || '';
    errorBox.classList.toggle('hidden', !text);
  }

  function readJson(res) {
    var type = String(res.headers.get('content-type') || '');
    if (type.indexOf('application/json') !== -1) return res.json();
    if (res.redirected && /\/auth\//.test(res.url)) throw new Error('Your session expired. Refresh the page and sign in again.');
    throw new Error('The app is restarting after an update. Wait a few seconds and try again.');
  }

  function renderTeammates(rows) {
    if (!list) return;
    list.innerHTML = '';
    rows.forEach(function (t) {
      var label = document.createElement('label');
      label.className = 'flex items-start gap-2 rounded-lg border border-brand-border/70 dark:border-white/10 bg-white dark:bg-slate-900 px-2.5 py-2 cursor-pointer';
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.name = 'memberIds';
      input.value = t.id;
      input.className = 'mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-brand-border text-brand-yellow focus:ring-brand-yellow send-lead-mate';
      var span = document.createElement('span');
      span.className = 'min-w-0';
      span.innerHTML = '<span class="block text-xs font-bold text-brand-dark dark:text-white truncate"></span>'
        + (t.contactName ? '<span class="block text-[10px] font-semibold text-brand-muted truncate"></span>' : '');
      span.querySelector('span').textContent = t.name || 'Teammate';
      if (t.contactName) span.querySelectorAll('span')[1].textContent = t.contactName;
      label.appendChild(input);
      label.appendChild(span);
      list.appendChild(label);
    });
  }

  function setAllChecked(on) {
    if (!list) return;
    list.querySelectorAll('.send-lead-mate').forEach(function (cb) {
      cb.checked = !!on;
      cb.disabled = !!on;
    });
  }

  function loadOptions() {
    show(loading);
    setError('');
    return fetch('/network/lead-send-options', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(readJson)
      .then(function (data) {
        if (!data || !data.success) throw new Error((data && data.error) || 'Could not load teammates.');
        teammates = data.teammates || [];
        if (!teammates.length || !data.ready) {
          show(empty);
          return;
        }
        renderTeammates(teammates);
        if (sendAll) {
          sendAll.checked = false;
          setAllChecked(false);
        }
        show(form);
        setTimeout(function () {
          var name = document.getElementById('sendLeadName');
          if (name) name.focus();
        }, 80);
      })
      .catch(function (err) {
        show(form);
        setError(err.message || 'Could not load teammates.');
      });
  }

  function open() {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    modal.setAttribute('aria-hidden', 'false');
    setError('');
    loadOptions();
  }

  function close() {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    modal.setAttribute('aria-hidden', 'true');
  }

  window.openSendLeadModal = open;

  document.addEventListener('click', function (e) {
    var opener = e.target.closest('[data-open-send-lead]');
    if (opener) {
      e.preventDefault();
      var mobileMenu = document.getElementById('mobileMenu');
      var closeMobile = document.getElementById('closeMobileMenu');
      if (mobileMenu && !mobileMenu.classList.contains('hidden') && closeMobile) closeMobile.click();
      document.querySelectorAll('[data-sidebar-new].is-open').forEach(function (wrap) {
        wrap.classList.remove('is-open');
        var toggle = wrap.querySelector('[data-sidebar-new-toggle]');
        var menu = wrap.querySelector('.sidebar-new-menu');
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
        if (menu) menu.hidden = true;
      });
      open();
      return;
    }
    if (modal.contains(e.target) && e.target.closest('[data-send-lead-close]')) close();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) close();
  });

  if (sendAll) {
    sendAll.addEventListener('change', function () {
      setAllChecked(sendAll.checked);
    });
  }

  var another = document.getElementById('sendLeadAnother');
  if (another) {
    another.addEventListener('click', function () {
      form.reset();
      setError('');
      setAllChecked(false);
      show(form);
    });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    setError('');
    var name = form.querySelector('[name="name"]');
    if (!name.value.trim()) { setError('Add the lead’s name.'); name.focus(); return; }
    var phone = form.querySelector('[name="phone"]');
    var email = form.querySelector('[name="email"]');
    if (!phone.value.trim() && !email.value.trim()) {
      setError('Add a phone or email for the lead.');
      phone.focus();
      return;
    }
    var allOn = sendAll && sendAll.checked;
    var picked = [];
    if (!allOn) {
      list.querySelectorAll('.send-lead-mate:checked').forEach(function (cb) {
        picked.push(cb.value);
      });
      if (!picked.length) {
        setError('Pick at least one teammate, or turn on Send to all.');
        return;
      }
    }

    var label = submit.textContent;
    submit.disabled = true;
    submit.textContent = 'Sending…';
    var body = new URLSearchParams();
    body.set('name', name.value.trim());
    body.set('phone', phone.value.trim());
    body.set('email', email.value.trim());
    body.set('address', (form.querySelector('[name="address"]') || {}).value || '');
    body.set('city', (form.querySelector('[name="city"]') || {}).value || '');
    body.set('zip', (form.querySelector('[name="zip"]') || {}).value || '');
    body.set('note', (form.querySelector('[name="note"]') || {}).value || '');
    if (allOn) body.set('sendAll', '1');
    picked.forEach(function (id) { body.append('memberIds', id); });

    fetch('/network/leads/send', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
    })
      .then(readJson)
      .then(function (data) {
        if (!data || !data.success) {
          setError((data && (data.error || data.notice)) || 'Could not send that lead.');
          return;
        }
        form.reset();
        setAllChecked(false);
        if (doneText) doneText.textContent = data.notice || 'Lead sent.';
        show(done);
      })
      .catch(function (err) {
        var offline = err instanceof TypeError;
        setError(offline ? 'Could not reach the app. Check your connection and try again.' : err.message);
      })
      .finally(function () {
        submit.disabled = false;
        submit.textContent = label;
      });
  });
})();
