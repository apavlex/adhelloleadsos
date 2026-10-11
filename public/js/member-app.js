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
    var form = event.target;
    if (!(form instanceof HTMLFormElement)) return;

    if (form.hasAttribute('data-ma-confirm') && !window.confirm(form.getAttribute('data-ma-confirm'))) {
      event.preventDefault();
      return;
    }

    // Multipart uploads (profile photo, logos, etc.) can take a few seconds — show Saving…
    var wantsLoading =
      form.hasAttribute('data-ma-loading') ||
      String(form.getAttribute('enctype') || '').toLowerCase() === 'multipart/form-data';
    if (!wantsLoading) return;
    if (form.getAttribute('data-ma-busy') === '1') {
      event.preventDefault();
      return;
    }
    form.setAttribute('data-ma-busy', '1');
    var btn = form.querySelector('button[type="submit"], input[type="submit"]');
    if (!btn) return;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    if (btn.tagName === 'BUTTON') {
      if (!btn.getAttribute('data-ma-label')) btn.setAttribute('data-ma-label', btn.textContent || '');
      btn.textContent = form.getAttribute('data-ma-loading') || 'Saving…';
    }
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

  /** Typeahead: search customers as you type (review ask form). */
  function initCustomerPick(root) {
    if (!root || root.getAttribute('data-ma-ready') === '1') return;
    var searchApi = window.maCustomerSearch;
    if (!searchApi || !searchApi.searchCustomers) return;

    var input = root.querySelector('input[type="search"], input[role="combobox"]');
    var hidden = root.querySelector('input[type="hidden"][name="customerId"]');
    var list = root.querySelector('[role="listbox"]');
    var dataEl = root.querySelector('script[type="application/json"]');
    if (!input || !hidden || !list || !dataEl) return;

    var customers = [];
    try { customers = JSON.parse(dataEl.textContent || '[]'); } catch (e) { customers = []; }
    if (!Array.isArray(customers) || !customers.length) return;

    var name = document.getElementById('rvAskName');
    var phone = document.getElementById('rvAskPhone');
    var email = document.getElementById('rvAskEmail');
    var active = -1;
    var shown = [];

    function esc(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function labelFor(c) {
      var bits = [c.name || 'Customer'];
      if (c.phone) bits.push(c.phone);
      else if (c.email) bits.push(c.email);
      return bits.join(' · ');
    }

    function fillFields(c) {
      if (!c) return;
      if (name) name.value = c.name || '';
      // Fill even when SMS/email inputs are disabled (GHL not ready) so the pick is visible.
      if (phone) phone.value = c.phone || '';
      if (email) email.value = c.email || '';
    }

    function clearPick() {
      hidden.value = '';
      active = -1;
    }

    function closeList() {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      active = -1;
    }

    function openList() {
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }

    function render(query) {
      var q = String(query || '').trim();
      shown = searchApi.searchCustomers(customers, q, { limit: 40 });
      var html = '';
      html += '<li class="ma-typeahead__item ma-typeahead__item--new" role="option" data-id="" data-idx="-1">' +
        (q ? 'Use “' + esc(q) + '” as a new person' : 'Type a new person below…') + '</li>';
      shown.forEach(function (c, i) {
        html += '<li class="ma-typeahead__item" role="option" data-id="' + esc(c.id) + '" data-idx="' + i + '">' +
          esc(labelFor(c)) + '</li>';
      });
      if (q && !shown.length) {
        html += '<li class="ma-typeahead__empty" role="presentation">No matches — keep typing a new name below</li>';
      }
      list.innerHTML = html;
      openList();
      setActive(-1);
    }

    function setActive(idx) {
      active = idx;
      var items = list.querySelectorAll('.ma-typeahead__item');
      for (var i = 0; i < items.length; i++) {
        items[i].classList.toggle('is-active', i === active);
      }
    }

    function pickByEl(el) {
      if (!el) return;
      var id = el.getAttribute('data-id') || '';
      var idx = parseInt(el.getAttribute('data-idx'), 10);
      if (!id) {
        clearPick();
        var typed = String(input.value || '').trim();
        if (typed && name && !name.value) name.value = typed;
        closeList();
        if (name) name.focus();
        return;
      }
      var c = shown[idx];
      if (!c) {
        c = customers.find(function (row) { return row.id === id; });
      }
      if (!c) return;
      hidden.value = c.id;
      input.value = c.name || '';
      fillFields(c);
      closeList();
    }

    input.addEventListener('focus', function () {
      render(input.value);
    });
    input.addEventListener('input', function () {
      clearPick();
      render(input.value);
    });
    input.addEventListener('keydown', function (e) {
      var items = list.querySelectorAll('.ma-typeahead__item');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (list.hidden) render(input.value);
        setActive(Math.min(items.length - 1, active + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive(Math.max(-1, active - 1));
      } else if (e.key === 'Enter') {
        if (!list.hidden && active >= 0 && items[active]) {
          e.preventDefault();
          pickByEl(items[active]);
        }
      } else if (e.key === 'Escape') {
        closeList();
      }
    });
    function onPickEvent(e) {
      var el = e.target.closest('.ma-typeahead__item');
      if (!el || !list.contains(el)) return;
      e.preventDefault();
      e.stopPropagation();
      pickByEl(el);
    }
    list.addEventListener('mousedown', onPickEvent);
    list.addEventListener('click', onPickEvent);
    document.addEventListener('click', function (e) {
      if (!root.contains(e.target)) closeList();
    });

    root.setAttribute('data-ma-ready', '1');
  }

  function bootCustomerPicks() {
    document.querySelectorAll('[data-ma-customer-pick]').forEach(initCustomerPick);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootCustomerPicks);
  } else {
    bootCustomerPicks();
  }
})();
