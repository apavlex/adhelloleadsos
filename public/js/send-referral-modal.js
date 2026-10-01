(function () {
  var modal = document.getElementById('sendReferralModal');
  if (!modal) return;
  var form = document.getElementById('sendReferralForm');
  var loading = document.getElementById('sendReferralLoading');
  var setup = document.getElementById('sendReferralSetup');
  var done = document.getElementById('sendReferralDone');
  var doneText = document.getElementById('sendReferralDoneText');
  var errorBox = document.getElementById('sendReferralError');
  var submit = document.getElementById('sendReferralSubmit');
  var tradeSelect = document.getElementById('sendReferralTrade');
  var zoneSelect = document.getElementById('sendReferralZone');

  function show(panel) {
    [loading, setup, done, form].forEach(function (el) {
      if (el) el.classList.toggle('hidden', el !== panel);
    });
  }

  function setError(text, retry) {
    if (!errorBox) return;
    errorBox.textContent = text || '';
    errorBox.classList.toggle('hidden', !text);
    if (text && retry) {
      var again = document.createElement('button');
      again.type = 'button';
      again.className = 'ml-1 font-semibold underline';
      again.textContent = 'Try again';
      again.addEventListener('click', retry);
      errorBox.appendChild(again);
    }
  }

  /** Render shows an HTML page while the app restarts for a deploy, and an expired session redirects to login. */
  function readJson(res) {
    var type = String(res.headers.get('content-type') || '');
    if (type.indexOf('application/json') !== -1) return res.json();
    if (res.redirected && /\/auth\//.test(res.url)) throw new Error('Your session expired. Refresh the page and sign in again.');
    throw new Error('The app is restarting after an update. Wait a few seconds and try again.');
  }

  function fillSelect(select, rows, valueKey) {
    var first = select.options[0];
    select.innerHTML = '';
    select.appendChild(first);
    rows.forEach(function (row) {
      var opt = document.createElement('option');
      opt.value = row[valueKey];
      opt.textContent = row.name;
      select.appendChild(opt);
    });
  }

  function focusFirst() {
    setTimeout(function () { if (tradeSelect) tradeSelect.focus(); }, 100);
  }

  function loadOptions() {
    show(loading);
    setError('');
    return fetch('/network/send-options', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(readJson)
      .then(function (data) {
        if (!data || !data.success) throw new Error((data && data.error) || 'Could not load the referral form.');
        var keepTrade = tradeSelect.value;
        var keepZone = zoneSelect.value;
        fillSelect(tradeSelect, data.trades || [], 'slug');
        fillSelect(zoneSelect, data.zones || [], 'id');
        tradeSelect.value = keepTrade;
        zoneSelect.value = keepZone;
        if (!data.ready) { show(setup); return; }
        var noMembers = document.getElementById('sendReferralNoMembers');
        if (noMembers) noMembers.classList.toggle('hidden', !!data.hasActiveMembers);
        show(form);
        focusFirst();
      })
      .catch(function (err) {
        show(form);
        setError(err.message || 'Could not load the referral form.', loadOptions);
      });
  }

  function open(preset) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    modal.setAttribute('aria-hidden', 'false');
    setError('');
    loadOptions().then(function () {
      if (preset && preset.trade && tradeSelect) tradeSelect.value = preset.trade;
    });
  }

  function close() {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    modal.setAttribute('aria-hidden', 'true');
  }

  window.openSendReferralModal = open;

  document.addEventListener('click', function (e) {
    var opener = e.target.closest('[data-open-send-referral]');
    if (opener) {
      e.preventDefault();
      var mobileMenu = document.getElementById('mobileMenu');
      var closeMobile = document.getElementById('closeMobileMenu');
      if (mobileMenu && !mobileMenu.classList.contains('hidden') && closeMobile) closeMobile.click();
      open({ trade: opener.getAttribute('data-trade') || '' });
      return;
    }
    if (modal.contains(e.target) && e.target.closest('[data-send-referral-close]')) close();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) close();
  });

  var another = document.getElementById('sendReferralAnother');
  if (another) {
    another.addEventListener('click', function () {
      form.reset();
      setError('');
      show(form);
      focusFirst();
    });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    setError('');
    if (!tradeSelect.value) { setError('Pick the trade the homeowner needs.'); tradeSelect.focus(); return; }
    var name = form.querySelector('[name="name"]');
    if (!name.value.trim()) { setError('Add the homeowner\u2019s name.'); name.focus(); return; }
    var phone = form.querySelector('[name="phone"]');
    var email = form.querySelector('[name="email"]');
    if (!phone.value.trim() && !email.value.trim()) { setError('Add a phone or email for the homeowner.'); phone.focus(); return; }
    var consent = form.querySelector('[name="consent"]');
    if (!consent.checked) { setError('Confirm the homeowner agreed to be contacted.'); return; }

    var label = submit.textContent;
    submit.disabled = true;
    submit.textContent = 'Sending\u2026';
    fetch('/network/referrals', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(new FormData(form)).toString(),
    })
      .then(readJson)
      .then(function (data) {
        if (!data || !data.success) {
          setError((data && (data.error || data.notice)) || 'Could not send that referral.');
          return;
        }
        form.reset();
        if (doneText) doneText.textContent = data.notice || 'Referral sent.';
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
