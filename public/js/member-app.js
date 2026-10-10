/* Member referral app: Add-to-Home-Screen hint, copy and share buttons. */
(function () {
  var standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  var ua = navigator.userAgent || '';
  var isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var hint = document.getElementById('maInstall');
  var KEY = 'ma-install-hint-dismissed';

  function dismissed() {
    try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; }
  }
  if (hint && isIOS && !standalone && !dismissed()) {
    hint.hidden = false;
  }

  // The server reads this so "today" and "this week" match the phone's clock.
  try {
    var tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && document.cookie.indexOf('ma_tz=' + encodeURIComponent(tz)) === -1) {
      document.cookie = 'ma_tz=' + encodeURIComponent(tz) + '; path=/m; max-age=31536000; samesite=lax';
    }
  } catch (e) { /* old browser */ }

  var customerSelect = document.querySelector('[data-ma-newcust]');
  var newCustomer = document.getElementById('maNewCustomer');
  if (customerSelect && newCustomer) {
    var syncNewCustomer = function () {
      var isNew = customerSelect.value === 'new';
      newCustomer.hidden = !isNew;
      var name = newCustomer.querySelector('input[name="newCustomerName"]');
      if (name) name.required = isNew;
    };
    customerSelect.addEventListener('change', function () {
      syncNewCustomer();
      if (customerSelect.value === 'new') {
        var name = newCustomer.querySelector('input');
        if (name) name.focus();
      }
    });
    syncNewCustomer();
  }

  document.addEventListener('submit', function (event) {
    var form = event.target.closest('[data-ma-confirm]');
    if (form && !window.confirm(form.getAttribute('data-ma-confirm'))) event.preventDefault();
  });
  document.addEventListener('click', function (event) {
    var close = event.target.closest('[data-ma-install-close]');
    if (close && hint) {
      hint.hidden = true;
      try { localStorage.setItem(KEY, '1'); } catch (e) { /* private mode */ }
      return;
    }

    var copyBtn = event.target.closest('[data-ma-copy], [data-ma-copy-from]');
    if (copyBtn) {
      var fromId = copyBtn.getAttribute('data-ma-copy-from');
      var fromEl = fromId ? document.getElementById(fromId) : null;
      var text = fromEl
        ? String(fromEl.textContent || fromEl.value || '').trim()
        : copyBtn.getAttribute('data-ma-copy');
      if (!text) return;
      var done = function () {
        var original = copyBtn.innerHTML;
        copyBtn.textContent = 'Copied';
        setTimeout(function () { copyBtn.innerHTML = original; }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(function () { window.prompt('Copy this link:', text); });
      } else {
        window.prompt('Copy this link:', text);
      }
      return;
    }

    var shareBtn = event.target.closest('[data-ma-share]');
    if (shareBtn) {
      var url = shareBtn.getAttribute('data-ma-share');
      var title = shareBtn.getAttribute('data-ma-share-title') || document.title;
      if (navigator.share) {
        navigator.share({ title: title, text: title + ':', url: url }).catch(function () { /* cancelled */ });
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () {
          var original = shareBtn.innerHTML;
          shareBtn.textContent = 'Link copied';
          setTimeout(function () { shareBtn.innerHTML = original; }, 1600);
        });
      } else {
        window.prompt('Copy this link:', url);
      }
    }
  });
})();
