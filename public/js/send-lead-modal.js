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
  var sendAllWrap = document.getElementById('sendLeadAllWrap');
  var search = document.getElementById('sendLeadSearch');
  var scopeWrap = document.getElementById('sendLeadScopeWrap');
  var scopeNetwork = document.getElementById('sendLeadScopeNetwork');
  var scopeAll = document.getElementById('sendLeadScopeAll');
  var listHint = document.getElementById('sendLeadListHint');
  var teammates = [];
  var directory = [];
  var canCrossWorkspace = false;
  var optionsReady = false;

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

  function currentScope() {
    if (scopeAll && scopeAll.checked) return 'all';
    return 'network';
  }

  function activeRows() {
    var scope = currentScope();
    var rows = scope === 'all' ? directory.slice() : teammates.map(function (t) {
      return {
        key: t.id,
        memberId: t.id,
        name: t.name,
        contactName: t.contactName || '',
        email: t.email || '',
        workspaceName: '',
      };
    });
    var q = search && search.value ? String(search.value).trim().toLowerCase() : '';
    if (!q) return rows;
    return rows.filter(function (r) {
      var hay = [r.name, r.contactName, r.email, r.workspaceName].join(' ').toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }

  function renderRecipients() {
    if (!list) return;
    list.innerHTML = '';
    var rows = activeRows();
    var scope = currentScope();
    var allOn = !!(sendAll && sendAll.checked && scope === 'network');
    if (sendAllWrap) sendAllWrap.classList.toggle('hidden', scope !== 'network');
    if (listHint) {
      listHint.textContent = scope === 'all'
        ? (rows.length ? rows.length + ' Reviews-app user' + (rows.length === 1 ? '' : 's') + ' across your workspaces' : 'No matches')
        : (rows.length ? rows.length + ' teammate' + (rows.length === 1 ? '' : 's') + ' on this network' : 'No matches');
    }
    rows.forEach(function (t) {
      var label = document.createElement('label');
      label.className = 'flex items-start gap-2 rounded-lg border border-brand-border/70 dark:border-white/10 bg-white dark:bg-slate-900 px-2.5 py-2 cursor-pointer';
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.name = scope === 'all' ? 'targets' : 'memberIds';
      input.value = scope === 'all' ? t.key : t.memberId;
      input.className = 'mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-brand-border text-brand-yellow focus:ring-brand-yellow send-lead-mate';
      input.disabled = allOn;
      input.checked = allOn;
      var span = document.createElement('span');
      span.className = 'min-w-0';
      var title = document.createElement('span');
      title.className = 'block text-xs font-bold text-brand-dark dark:text-white truncate';
      title.textContent = t.name || 'Reviews user';
      span.appendChild(title);
      var metaBits = [];
      if (t.contactName) metaBits.push(t.contactName);
      if (t.workspaceName) metaBits.push(t.workspaceName);
      if (metaBits.length) {
        var meta = document.createElement('span');
        meta.className = 'block text-[10px] font-semibold text-brand-muted truncate';
        meta.textContent = metaBits.join(' · ');
        span.appendChild(meta);
      }
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
    optionsReady = false;
    return fetch('/network/lead-send-options', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(readJson)
      .then(function (data) {
        if (!data || !data.success) throw new Error((data && data.error) || 'Could not load recipients.');
        teammates = data.teammates || [];
        directory = data.directory || [];
        canCrossWorkspace = !!data.canCrossWorkspace;
        if (scopeWrap) scopeWrap.classList.toggle('hidden', !canCrossWorkspace);
        if (!teammates.length && !directory.length) {
          show(empty);
          return;
        }
        if (scopeNetwork) scopeNetwork.checked = true;
        if (scopeAll) scopeAll.checked = false;
        if (sendAll) sendAll.checked = false;
        if (search) search.value = '';
        optionsReady = true;
        renderRecipients();
        show(form);
        setTimeout(function () {
          var name = document.getElementById('sendLeadName');
          if (name) name.focus();
        }, 80);
      })
      .catch(function (err) {
        show(form);
        setError(err.message || 'Could not load recipients.');
      });
  }

  function applyPrefill(prefill) {
    if (!form || !prefill || typeof prefill !== 'object') return;
    [
      ['name', 'name'],
      ['phone', 'phone'],
      ['email', 'email'],
      ['address', 'address'],
      ['city', 'city'],
      ['zip', 'zip'],
      ['note', 'note'],
    ].forEach(function (pair) {
      var el = form.querySelector('[name="' + pair[0] + '"]');
      if (!el) return;
      var val = prefill[pair[1]];
      if (val == null || val === '') return;
      el.value = String(val);
    });
  }

  function prefillFromOpener(opener) {
    if (!opener || !opener.getAttribute) return null;
    var name = opener.getAttribute('data-send-lead-name') || '';
    var phone = opener.getAttribute('data-send-lead-phone') || '';
    var email = opener.getAttribute('data-send-lead-email') || '';
    if (!name && !phone && !email) return null;
    return {
      name: name,
      phone: phone,
      email: email,
      address: opener.getAttribute('data-send-lead-address') || '',
      city: opener.getAttribute('data-send-lead-city') || '',
      zip: opener.getAttribute('data-send-lead-zip') || '',
      note: opener.getAttribute('data-send-lead-note') || '',
    };
  }

  function open(prefill) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    modal.setAttribute('aria-hidden', 'false');
    setError('');
    if (form) form.reset();
    if (sendAll) {
      sendAll.checked = false;
      setAllChecked(false);
    }
    loadOptions().then(function () {
      applyPrefill(prefill);
    });
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
      open(prefillFromOpener(opener));
      return;
    }
    if (modal.contains(e.target) && e.target.closest('[data-send-lead-close]')) close();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) close();
  });

  if (sendAll) {
    sendAll.addEventListener('change', function () {
      if (currentScope() !== 'network') {
        sendAll.checked = false;
        return;
      }
      setAllChecked(sendAll.checked);
    });
  }

  if (scopeNetwork) scopeNetwork.addEventListener('change', function () {
    if (sendAll) sendAll.checked = false;
    renderRecipients();
  });
  if (scopeAll) scopeAll.addEventListener('change', function () {
    if (sendAll) sendAll.checked = false;
    renderRecipients();
  });
  if (search) {
    search.addEventListener('input', function () {
      renderRecipients();
    });
  }

  var another = document.getElementById('sendLeadAnother');
  if (another) {
    another.addEventListener('click', function () {
      form.reset();
      setError('');
      if (scopeNetwork) scopeNetwork.checked = true;
      setAllChecked(false);
      renderRecipients();
      show(form);
    });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    setError('');
    if (!optionsReady) {
      setError('Still loading recipients…');
      return;
    }
    var name = form.querySelector('[name="name"]');
    if (!name.value.trim()) { setError('Add the lead’s name.'); name.focus(); return; }
    var phone = form.querySelector('[name="phone"]');
    var email = form.querySelector('[name="email"]');
    if (!phone.value.trim() && !email.value.trim()) {
      setError('Add a phone or email for the lead.');
      phone.focus();
      return;
    }
    var scope = currentScope();
    var allOn = sendAll && sendAll.checked && scope === 'network';
    var picked = [];
    if (!allOn) {
      list.querySelectorAll('.send-lead-mate:checked').forEach(function (cb) {
        picked.push(cb.value);
      });
      if (!picked.length) {
        setError(scope === 'all'
          ? 'Pick at least one Reviews-app user.'
          : 'Pick at least one teammate, or turn on Send to all.');
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
    body.set('scope', scope);
    if (allOn) body.set('sendAll', '1');
    if (scope === 'all') {
      picked.forEach(function (id) { body.append('targets', id); });
    } else {
      picked.forEach(function (id) { body.append('memberIds', id); });
    }

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
        if (scopeNetwork) scopeNetwork.checked = true;
        setAllChecked(false);
        renderRecipients();
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
