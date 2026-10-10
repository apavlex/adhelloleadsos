/* Member referral app: Add-to-Home-Screen modal, copy and share buttons. */
(function () {
  var standalone =
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    window.navigator.standalone === true;
  var ua = navigator.userAgent || '';
  var isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isAndroid = /Android/i.test(ua);
  var params = new URLSearchParams(window.location.search || '');
  var memberPwa = params.get('source') === 'pwa';
  try {
    if (memberPwa) sessionStorage.setItem('ma-member-pwa', '1');
    else if (sessionStorage.getItem('ma-member-pwa') === '1') memberPwa = true;
  } catch (e) { /* private mode */ }

  // Workspace PWA/webview can report standalone while hosting /m/:token.
  // Only treat as "already installed" when this session came from the member manifest.
  var alreadyInstalled = standalone && memberPwa;
  var fromWorkspaceShell = standalone && !memberPwa;

  var modal = document.getElementById('maInstall');
  var KEY = 'ma-install-hint-dismissed';
  var AUTO_KEY = 'ma-install-auto-shown';

  function dismissed() {
    try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; }
  }
  function markDismissed() {
    try { localStorage.setItem(KEY, '1'); } catch (e) { /* private mode */ }
  }
  function autoShown() {
    try { return sessionStorage.getItem(AUTO_KEY) === '1'; } catch (e) { return false; }
  }
  function markAutoShown() {
    try { sessionStorage.setItem(AUTO_KEY, '1'); } catch (e) { /* private mode */ }
  }

  function installUrl() {
    var url = new URL(window.location.href);
    url.searchParams.delete('source');
    // Clean path to the member app root when possible
    var path = url.pathname.replace(/\/+$/, '');
    var m = path.match(/^(\/m\/[^/]+)/);
    if (m) url.pathname = m[1];
    url.hash = '';
    return url.toString();
  }

  function showPanel(name) {
    if (!modal) return;
    var panels = modal.querySelectorAll('[data-ma-install-panel]');
    for (var i = 0; i < panels.length; i++) {
      panels[i].hidden = panels[i].getAttribute('data-ma-install-panel') !== name;
    }
  }

  function configurePanels() {
    if (alreadyInstalled) showPanel('installed');
    else if (fromWorkspaceShell) showPanel('workspace');
    else if (isIOS) showPanel('browser-ios');
    else if (isAndroid) showPanel('browser-android');
    else showPanel('browser-android');
  }

  function openModal() {
    if (!modal) return;
    configurePanels();
    modal.hidden = false;
    document.documentElement.style.overflow = 'hidden';
  }

  function closeModal(persist) {
    if (!modal) return;
    modal.hidden = true;
    document.documentElement.style.overflow = '';
    if (persist) markDismissed();
  }

  // Auto-show: browser first visit, or when opened inside the workspace app.
  // Skip when already running as the installed member PWA.
  if (modal && !alreadyInstalled && !dismissed() && !autoShown()) {
    configurePanels();
    modal.hidden = false;
    markAutoShown();
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
    var openBtn = event.target.closest('[data-ma-install-open]');
    if (openBtn) {
      openModal();
      return;
    }

    var close = event.target.closest('[data-ma-install-close]');
    if (close && modal) {
      closeModal(true);
      return;
    }

    if (modal && !modal.hidden && event.target === modal) {
      closeModal(true);
      return;
    }

    var copyInstall = event.target.closest('[data-ma-install-copy]');
    if (copyInstall) {
      var link = installUrl();
      var done = function () {
        var original = copyInstall.textContent;
        copyInstall.textContent = 'Copied';
        setTimeout(function () { copyInstall.textContent = original; }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(done).catch(function () { window.prompt('Copy this link:', link); });
      } else {
        window.prompt('Copy this link:', link);
      }
      return;
    }

    var shareInstall = event.target.closest('[data-ma-install-share]');
    if (shareInstall) {
      var shareLink = installUrl();
      var title = document.title || 'Referral app';
      if (navigator.share) {
        navigator.share({ title: title, text: 'Open ' + title, url: shareLink }).catch(function () { /* cancelled */ });
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(shareLink).then(function () {
          var original = shareInstall.textContent;
          shareInstall.textContent = 'Link copied';
          setTimeout(function () { shareInstall.textContent = original; }, 1600);
        });
      } else {
        window.prompt('Copy this link:', shareLink);
      }
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
      var doneCopy = function () {
        var original = copyBtn.innerHTML;
        copyBtn.textContent = 'Copied';
        setTimeout(function () { copyBtn.innerHTML = original; }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(doneCopy).catch(function () { window.prompt('Copy this link:', text); });
      } else {
        window.prompt('Copy this link:', text);
      }
      return;
    }

    var shareBtn = event.target.closest('[data-ma-share]');
    if (shareBtn) {
      var url = shareBtn.getAttribute('data-ma-share');
      var shareTitle = shareBtn.getAttribute('data-ma-share-title') || document.title;
      if (navigator.share) {
        navigator.share({ title: shareTitle, text: shareTitle + ':', url: url }).catch(function () { /* cancelled */ });
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
