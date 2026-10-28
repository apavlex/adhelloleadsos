/* Member referral app: Add-to-Home-Screen modal, copy and share buttons. */
(function () {
  /** Centered progress overlay while a customer / tab navigation is in flight. */
  function ensureMaNavLoading() {
    var el = document.getElementById('maNavLoading');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'maNavLoading';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-label', 'Loading');
    el.innerHTML =
      '<div class="ma-nav-loader">' +
        '<svg class="ma-nav-loader-ring" viewBox="0 0 80 80" aria-hidden="true">' +
          '<circle class="ma-nav-loader-track" cx="40" cy="40" r="34" />' +
          '<circle class="ma-nav-loader-arc" cx="40" cy="40" r="34" />' +
        '</svg>' +
        '<span class="ma-nav-loader-dot" aria-hidden="true"></span>' +
      '</div>';
    document.body.appendChild(el);
    return el;
  }

  function hideMaNavLoading() {
    clearTimeout(hideMaNavLoading._failSafe);
    document.documentElement.classList.remove('ma-nav-loading');
    var el = document.getElementById('maNavLoading');
    if (el) el.classList.remove('is-on');
  }

  function showMaNavLoading() {
    document.documentElement.classList.add('ma-nav-loading');
    var el = ensureMaNavLoading();
    void el.offsetWidth;
    el.classList.add('is-on');
    clearTimeout(hideMaNavLoading._failSafe);
    hideMaNavLoading._failSafe = setTimeout(hideMaNavLoading, 8000);
  }

  window.maShowNavLoading = showMaNavLoading;
  window.maHideNavLoading = hideMaNavLoading;

  document.addEventListener(
    'click',
    function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a) return;
      if (e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target === '_blank') return;
      if (a.hasAttribute('download') || a.hasAttribute('data-ma-no-nav-progress')) return;
      var href = a.getAttribute('href') || '';
      if (!href || href.charAt(0) === '#' || href.indexOf('javascript:') === 0) return;
      try {
        var u = new URL(href, window.location.href);
        if (u.origin !== window.location.origin) return;
        if (u.pathname === window.location.pathname && u.search === window.location.search && u.hash) return;
        var onMember = /\/(?:m|a)\//.test(window.location.pathname);
        var toMember = /\/(?:m|a)\//.test(u.pathname);
        if (!onMember && !toMember) return;
      } catch (_) {
        return;
      }
      showMaNavLoading();
    },
    true
  );

  document.addEventListener(
    'submit',
    function (e) {
      var form = e.target;
      if (!form || form.tagName !== 'FORM') return;
      if (form.getAttribute('data-ma-no-nav-progress') === '1') return;
      if (form.getAttribute('target') === '_blank') return;
      // In-page AJAX forms set data-ma-busy themselves — skip full-screen loader.
      if (form.hasAttribute('data-ma-busy') || form.hasAttribute('data-ma-ajax')) return;
      showMaNavLoading();
    },
    true
  );

  window.addEventListener('pageshow', hideMaNavLoading);
  window.addEventListener('pagehide', function () {
    /* keep spinner through unload when navigating away */
  });

  // Reviews used to register the Agency OS root /sw.js. That single worker received
  // workspace task reminders + search alerts, so they showed on the Reviews icon.
  // Drop the root worker here; Reviews keeps /m/sw.js only. Agency OS re-registers
  // /sw.js the next time the workspace app is opened.
  if ('serviceWorker' in navigator && navigator.serviceWorker.getRegistrations) {
    navigator.serviceWorker.getRegistrations().then(function (regs) {
      (regs || []).forEach(function (reg) {
        var script =
          (reg.active && reg.active.scriptURL) ||
          (reg.waiting && reg.waiting.scriptURL) ||
          (reg.installing && reg.installing.scriptURL) ||
          '';
        try {
          if (new URL(script).pathname === '/sw.js') reg.unregister();
        } catch (e) {
          /* ignore */
        }
      });
    }).catch(function () {});
  }

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
  // Mobile Safari/Chrome tab (not Home Screen app, not Agency OS shell).
  var inSafariOrBrowser = !standalone && (isIOS || isAndroid);

  var modal = document.getElementById('maInstall');
  var openAppBanner = document.getElementById('maOpenApp');
  // Legacy permanent dismiss blocked the sheet forever — clear it so Home can show again.
  var LEGACY_KEY = 'ma-install-hint-dismissed';
  var SNOOZE_KEY = 'ma-install-snoozed';
  var HOMESCREEN_KEY = 'ma-homescreen-app';
  var OPEN_APP_DISMISS_KEY = 'ma-open-app-dismissed-until';
  var forceQuery =
    params.get('install') === '1' ||
    params.get('hint') === 'install' ||
    params.get('install') === 'true';
  // Only open the sheet when ?install=1 (invite / Get the app links) or the user
  // taps “Save as a phone app” in Settings — never auto-nag on Home or deep links.
  var forceInstall = forceQuery;

  try { localStorage.removeItem(LEGACY_KEY); } catch (e) { /* private mode */ }

  if (alreadyInstalled) {
    try { localStorage.setItem(HOMESCREEN_KEY, '1'); } catch (e) { /* private mode */ }
  }

  function snoozed() {
    try { return sessionStorage.getItem(SNOOZE_KEY) === '1'; } catch (e) { return false; }
  }
  function markSnoozed() {
    try { sessionStorage.setItem(SNOOZE_KEY, '1'); } catch (e) { /* private mode */ }
  }

  function knowsHomescreenApp() {
    try { return localStorage.getItem(HOMESCREEN_KEY) === '1'; } catch (e) { return false; }
  }

  function openAppBannerDismissed() {
    try {
      var until = parseInt(localStorage.getItem(OPEN_APP_DISMISS_KEY) || '0', 10);
      return Number.isFinite(until) && until > Date.now();
    } catch (e) {
      return false;
    }
  }

  function dismissOpenAppBanner(days) {
    var ms = Math.max(1, Number(days) || 3) * 24 * 60 * 60 * 1000;
    try { localStorage.setItem(OPEN_APP_DISMISS_KEY, String(Date.now() + ms)); } catch (e) { /* private mode */ }
    if (openAppBanner) openAppBanner.hidden = true;
    document.documentElement.classList.remove('ma-open-app-visible');
  }

  function showOpenAppBanner() {
    if (!openAppBanner || alreadyInstalled || fromWorkspaceShell || !inSafariOrBrowser) return false;
    if (openAppBannerDismissed()) return false;
    openAppBanner.hidden = false;
    document.documentElement.classList.add('ma-open-app-visible');
    return true;
  }

  function cleanInstallQueryFromUrl() {
    if (!forceQuery || !window.history || !window.history.replaceState) return;
    try {
      var u = new URL(window.location.href);
      u.searchParams.delete('install');
      u.searchParams.delete('hint');
      window.history.replaceState({}, '', u.pathname + u.search + u.hash);
    } catch (e) { /* ignore */ }
  }

  function installUrl() {
    var url = new URL(window.location.href);
    url.searchParams.delete('source');
    url.searchParams.delete('install');
    url.searchParams.delete('hint');
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
    // Workspace shell: open Safari/Chrome + copy/share. In-browser: Got it + steps only.
    var inWorkspace = name === 'workspace-ios' || name === 'workspace-android';
    var inBrowser = name === 'browser-ios' || name === 'browser-android';
    var safariOpen = name === 'safari-open';
    var workspaceOnly = modal.querySelectorAll('[data-ma-install-workspace-only]');
    for (var w = 0; w < workspaceOnly.length; w++) workspaceOnly[w].hidden = !inWorkspace;
    var browserDone = modal.querySelectorAll('[data-ma-install-browser-done]');
    for (var b = 0; b < browserDone.length; b++) browserDone[b].hidden = !inBrowser;
    var safariDone = modal.querySelectorAll('[data-ma-install-safari-open-done]');
    for (var s = 0; s < safariDone.length; s++) safariDone[s].hidden = !safariOpen;
    var title = modal.querySelector('#maInstallTitle');
    var kicker = modal.querySelector('.ma-install-kicker');
    var lead = modal.querySelector('[data-ma-install-lead]');
    var appLabel =
      (openAppBanner && openAppBanner.getAttribute('data-ma-open-app-name')) ||
      (modal.getAttribute('data-ma-install-app-name')) ||
      'this app';
    if (title) title.textContent = safariOpen ? 'Open from Home Screen' : 'Save as a phone app';
    if (kicker) {
      kicker.textContent = safariOpen ? 'You’re in Safari' : 'Save this app to your phone';
    }
    if (lead) {
      lead.hidden = !!safariOpen;
      if (!safariOpen) {
        lead.textContent = '';
        lead.appendChild(document.createTextNode('Add '));
        var leadBold = document.createElement('b');
        leadBold.textContent = String(appLabel || 'this app');
        lead.appendChild(leadBold);
        lead.appendChild(
          document.createTextNode(' to your Home Screen for one-tap reviews, customers, and referrals.'),
        );
      }
    }
    var openBtn = modal.querySelector('[data-ma-install-open-browser]');
    if (openBtn) {
      // iOS standalone PWAs cannot open same-origin links in Safari (white flash).
      // Share sheet is the reliable handoff; Android uses Chrome intent.
      openBtn.textContent = name === 'workspace-android' ? 'Open in Chrome' : 'Share to Safari';
    }
  }

  function openSafariOpenSheet() {
    if (!modal) return;
    showPanel('safari-open');
    modal.hidden = false;
    document.documentElement.style.overflow = 'hidden';
  }

  function openInstallFromBanner() {
    if (!modal) return;
    configurePanels();
    modal.hidden = false;
    document.documentElement.style.overflow = 'hidden';
  }

  function configurePanels() {
    if (alreadyInstalled) showPanel('installed');
    else if (fromWorkspaceShell) showPanel(isIOS ? 'workspace-ios' : 'workspace-android');
    else if (isIOS) showPanel('browser-ios');
    else if (isAndroid) showPanel('browser-android');
    else showPanel('browser-android');
  }

  function copyInstallLink(href, doneLabelEl) {
    var link = String(href || '').trim();
    if (!link) return;
    var done = function () {
      if (!doneLabelEl) {
        if (typeof window.showAppToast === 'function') {
          window.showAppToast('Link copied — paste it in Safari', { variant: 'success' });
        }
        return;
      }
      var original = doneLabelEl.textContent;
      doneLabelEl.textContent = 'Copied';
      setTimeout(function () { doneLabelEl.textContent = original; }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(done).catch(function () { window.prompt('Copy this link:', link); });
    } else {
      window.prompt('Copy this link:', link);
    }
  }

  /**
   * Leave the workspace PWA for Safari / Chrome.
   * iOS same-origin `_blank` stays in the PWA (white page flash) — use Share instead.
   */
  function openInSystemBrowser(url) {
    var href = String(url || '').trim();
    if (!href) return;

    if (isIOS) {
      var appName =
        (modal && modal.getAttribute('data-ma-install-app-name')) ||
        'Review app';
      if (navigator.share) {
        navigator
          .share({
            title: appName,
            text: 'Open in Safari, then Share → Add to Home Screen',
            url: href,
          })
          .catch(function (err) {
            // User cancelled share — don't also force-copy.
            if (err && (err.name === 'AbortError' || err.name === 'NotAllowedError')) return;
            copyInstallLink(href);
          });
        return;
      }
      copyInstallLink(href);
      if (typeof window.showAppToast === 'function') {
        window.showAppToast('Link copied — open Safari and paste', { variant: 'info', duration: 5000 });
      }
      return;
    }

    if (isAndroid) {
      try {
        var u = new URL(href, window.location.origin);
        var path = u.pathname + u.search + u.hash;
        var intent =
          'intent://' +
          u.host +
          path +
          '#Intent;scheme=' +
          u.protocol.replace(':', '') +
          ';package=com.android.chrome;S.browser_fallback_url=' +
          encodeURIComponent(u.href) +
          ';end';
        window.location.href = intent;
        return;
      } catch (e) { /* fall through */ }
    }

    var a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      if (a.parentNode) a.parentNode.removeChild(a);
    }, 0);
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
    // "Not now" / Got it only snooze this browser session — never permanently hide.
    if (persist) markSnoozed();
    // Next: in-your-face phone alerts prompt (leads + News & updates).
    try {
      window.dispatchEvent(new CustomEvent('ma-install-closed', { detail: { persist: !!persist } }));
    } catch (e) { /* old browser */ }
  }

  // Safari/Chrome deep links (customer, leads, …): YouTube-style “Open in app” bar.
  // iOS cannot hand HTTPS links to a Home Screen PWA — the bar explains that.
  showOpenAppBanner();

  // Explicit ?install=1 only (Get the app / invite links). No auto-popup on browse.
  if (modal && !alreadyInstalled && forceInstall && !snoozed()) {
    configurePanels();
    modal.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    cleanInstallQueryFromUrl();
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

  /** Optimistic job status chips — paint first, save in background. */
  function postStatus(action, status, back) {
    var body = new URLSearchParams();
    body.set('status', status);
    if (back) body.set('back', back);
    return fetch(action, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        Accept: 'application/json',
        'X-Requested-With': 'fetch',
      },
      body: body.toString(),
      credentials: 'same-origin',
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok || !data || data.ok === false) {
          var err = new Error((data && data.error) || 'Could not update status.');
          err.status = res.status;
          throw err;
        }
        return data;
      }, function () {
        if (!res.ok) throw new Error('Could not update status.');
        return { ok: true, status: status };
      });
    });
  }

  function initStatusSteps(form) {
    if (!form || form.getAttribute('data-ma-ready') === '1') return;
    var buttons = form.querySelectorAll('button[name="status"]');
    if (!buttons.length) return;
    var pill = document.querySelector('[data-ma-job-status-pill]');
    var select = document.getElementById('jbStatus');
    var onBtn = form.querySelector('.ma-step.is-on');
    var current = onBtn ? onBtn.value : '';
    var currentLabel = onBtn ? (onBtn.textContent || '').replace(/\s+/g, ' ').trim() : '';
    var seq = 0;

    var dateInput = document.getElementById('jbDate');

    function applyUi(status, label, date) {
      for (var i = 0; i < buttons.length; i++) {
        var btn = buttons[i];
        var on = btn.value === status;
        btn.classList.toggle('is-on', on);
        if (on) btn.setAttribute('aria-pressed', 'true');
        else btn.removeAttribute('aria-pressed');
      }
      if (pill) {
        pill.className = String(pill.className || '')
          .replace(/\bma-pill--job-\S+/g, '')
          .replace(/\s+/g, ' ')
          .trim() + ' ma-pill--job-' + status;
        if (label) pill.textContent = label;
      }
      if (select && select.querySelector('option[value="' + status + '"]')) {
        select.value = status;
      }
      if (dateInput && date && !dateInput.value) {
        dateInput.value = date;
      }
    }

    form.addEventListener('click', function (e) {
      var btn = e.target.closest('button[name="status"]');
      if (!btn || !form.contains(btn)) return;
      e.preventDefault();
      var status = btn.value;
      var label = (btn.textContent || '').replace(/\s+/g, ' ').trim();
      if (!status || status === current) return;

      var prev = current;
      var prevLabel = currentLabel;
      var mySeq = ++seq;
      current = status;
      currentLabel = label;
      applyUi(status, label);
      form.classList.add('is-saving');
      form.classList.remove('is-error');
      form.removeAttribute('title');

      postStatus(form.action, status, null)
        .then(function (data) {
          if (mySeq !== seq) return;
          if (data.status) current = data.status;
          if (data.statusLabel) currentLabel = data.statusLabel;
          applyUi(current, currentLabel, data.date || '');
          form.classList.remove('is-saving');
        })
        .catch(function (err) {
          if (mySeq !== seq) return;
          current = prev;
          currentLabel = prevLabel;
          applyUi(prev, prevLabel);
          form.classList.remove('is-saving');
          form.classList.add('is-error');
          if (err && err.message) form.setAttribute('title', err.message);
          setTimeout(function () { form.classList.remove('is-error'); }, 1600);
        });
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
    });

    form.setAttribute('data-ma-ready', '1');
  }

  function initStatusAdvance(form) {
    if (!form || form.getAttribute('data-ma-ready') === '1') return;
    var row = form.closest('.ma-row--split') || form.closest('.ma-row');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (form.getAttribute('data-ma-busy') === '1') return;
      var statusInput = form.querySelector('input[name="status"]');
      var backInput = form.querySelector('input[name="back"]');
      var status = statusInput ? statusInput.value : '';
      if (!status) return;
      form.setAttribute('data-ma-busy', '1');
      form.classList.add('is-saving');
      if (row) row.classList.add('is-advancing');
      postStatus(form.action, status, backInput ? backInput.value : '')
        .then(function () {
          if (row) {
            row.style.transition = 'opacity .18s ease, transform .18s ease';
            row.style.opacity = '0';
            row.style.transform = 'translateX(12px)';
            setTimeout(function () {
              row.remove();
            }, 180);
          } else {
            window.location.reload();
          }
        })
        .catch(function () {
          form.removeAttribute('data-ma-busy');
          form.classList.remove('is-saving');
          if (row) row.classList.remove('is-advancing');
          form.classList.add('is-error');
          setTimeout(function () { form.classList.remove('is-error'); }, 1600);
        });
    });
    form.setAttribute('data-ma-ready', '1');
  }

  document.querySelectorAll('[data-ma-status-steps]').forEach(initStatusSteps);
  document.querySelectorAll('[data-ma-status-advance]').forEach(initStatusAdvance);

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
    var btn = form.querySelector('button[type="submit"], input[type="submit"], [data-ma-photo-pick="camera"]');
    if (!btn) return;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    if (btn.tagName === 'BUTTON') {
      if (!btn.getAttribute('data-ma-label')) btn.setAttribute('data-ma-label', btn.textContent || '');
      btn.textContent = form.getAttribute('data-ma-loading') || 'Saving…';
    }
    form.querySelectorAll('[data-ma-photo-pick], [data-ma-photo-close]').forEach(function (el) {
      el.disabled = true;
    });
  });

  /** Take photo / Choose from library sheet (customer + job pages).
   *  Optional collect mode (`data-ma-photo-collect`) appends files to a target
   *  input for a parent form (material quote) instead of POSTing immediately. */
  function initPhotoCapture(root) {
    if (!root || root.getAttribute('data-ma-ready') === '1') return;
    var sheet = root.querySelector('[data-ma-photo-sheet]');
    // Prefer a real <form>; collect-mode pages may use a <div class="ma-photo-form">
    // so they don’t nest a form inside another (browser would break the outer form).
    var form = root.querySelector('form.ma-photo-form') || root.querySelector('.ma-photo-form');
    var file = root.querySelector('input[type="file"][name="photo"]');
    if (!sheet || !form || !file) return;
    var collectSel = root.getAttribute('data-ma-photo-collect') || '';
    var previewSel = root.getAttribute('data-ma-photo-preview') || '';
    var countSel = root.getAttribute('data-ma-photo-count') || '';
    var maxPhotos = Math.max(1, Math.min(12, parseInt(root.getAttribute('data-ma-photo-max') || '8', 10) || 8));
    var collectInput = collectSel ? document.querySelector(collectSel) : null;
    var previewEl = previewSel ? document.querySelector(previewSel) : null;
    var countEl = countSel ? document.querySelector(countSel) : null;
    var collected = [];

    function openSheet() {
      // Portal to <body> so the sheet isn’t trapped under the fixed tab bar /
      // Review FAB (main can create a lower stacking context on iOS).
      if (sheet.parentNode !== document.body) document.body.appendChild(sheet);
      sheet.hidden = false;
      document.documentElement.style.overflow = 'hidden';
      document.body.classList.add('ma-photo-open');
      var cap = form.querySelector('[name="caption"]');
      if (cap) setTimeout(function () { cap.focus(); }, 50);
    }
    function closeSheet() {
      sheet.hidden = true;
      document.documentElement.style.overflow = '';
      document.body.classList.remove('ma-photo-open');
      if (sheet.parentNode !== root) root.appendChild(sheet);
      try { file.value = ''; } catch (e) { /* ignore */ }
    }

    function syncCollectInput() {
      if (!collectInput || typeof DataTransfer === 'undefined') return;
      var dt = new DataTransfer();
      collected.forEach(function (item) { dt.items.add(item.file); });
      collectInput.files = dt.files;
    }

    function renderCollectPreview() {
      if (countEl) countEl.textContent = collected.length + '/' + maxPhotos;
      if (root.querySelector('[data-ma-photo-open]')) {
        root.querySelector('[data-ma-photo-open]').hidden = collected.length >= maxPhotos;
      }
      if (!previewEl) return;
      previewEl.hidden = !collected.length;
      previewEl.innerHTML = '';
      collected.forEach(function (item, idx) {
        var fig = document.createElement('figure');
        fig.className = 'ma-photos__item';
        var img = document.createElement('img');
        img.src = item.url;
        img.alt = 'Quote photo ' + (idx + 1);
        img.loading = 'lazy';
        var wrap = document.createElement('a');
        wrap.href = item.url;
        wrap.className = 'ma-photos__thumb';
        wrap.appendChild(img);
        wrap.addEventListener('click', function (e) { e.preventDefault(); });
        var del = document.createElement('button');
        del.type = 'button';
        del.className = 'ma-photos__del';
        del.setAttribute('aria-label', 'Remove photo');
        del.textContent = '×';
        del.addEventListener('click', function () {
          try { URL.revokeObjectURL(item.url); } catch (err) { /* ignore */ }
          collected.splice(idx, 1);
          syncCollectInput();
          renderCollectPreview();
        });
        fig.appendChild(wrap);
        fig.appendChild(del);
        previewEl.appendChild(fig);
      });
    }

    root.querySelectorAll('[data-ma-photo-open]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        if (collectInput && collected.length >= maxPhotos) return;
        openSheet();
      });
    });
    root.querySelectorAll('[data-ma-photo-close]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        closeSheet();
      });
    });
    sheet.addEventListener('click', function (e) {
      if (e.target === sheet) closeSheet();
    });

    root.querySelectorAll('[data-ma-photo-pick]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        if (form.getAttribute('data-ma-busy') === '1') return;
        var mode = btn.getAttribute('data-ma-photo-pick');
        if (mode === 'camera') file.setAttribute('capture', 'environment');
        else file.removeAttribute('capture');
        file.click();
      });
    });

    file.addEventListener('change', function () {
      if (!file.files || !file.files.length) return;
      if (collectInput) {
        var picked = file.files[0];
        if (picked && collected.length < maxPhotos) {
          collected.push({
            file: picked,
            url: URL.createObjectURL(picked),
          });
          syncCollectInput();
          renderCollectPreview();
        }
        closeSheet();
        return;
      }
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.submit();
    });

    // Touch-friendly notes stretch (CSS resize is ignored on iOS).
    (function bindNoteResize() {
      var note = form.querySelector('.ma-photo-note__input');
      var grip = form.querySelector('[data-ma-photo-note-grip]');
      var box = form.querySelector('.ma-photo-note__box');
      if (!note || !grip) return;
      var minH = 112;
      var dragging = false;
      var startY = 0;
      var startH = 0;
      function maxH() {
        return Math.max(minH, Math.floor(window.innerHeight * 0.55));
      }
      function onMove(e) {
        if (!dragging) return;
        var y = e.clientY != null ? e.clientY : (e.touches && e.touches[0] && e.touches[0].clientY);
        if (y == null) return;
        var next = Math.min(maxH(), Math.max(minH, startH + (y - startY)));
        note.style.height = next + 'px';
        e.preventDefault();
      }
      function onEnd() {
        if (!dragging) return;
        dragging = false;
        if (box) box.classList.remove('is-resizing');
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onEnd);
        window.removeEventListener('pointercancel', onEnd);
        window.removeEventListener('touchmove', onMove);
        window.removeEventListener('touchend', onEnd);
      }
      function onStart(e) {
        dragging = true;
        startY = e.clientY != null ? e.clientY : (e.touches && e.touches[0] && e.touches[0].clientY);
        startH = note.getBoundingClientRect().height;
        if (box) box.classList.add('is-resizing');
        if (e.pointerId != null && grip.setPointerCapture) {
          try { grip.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        }
        window.addEventListener('pointermove', onMove, { passive: false });
        window.addEventListener('pointerup', onEnd);
        window.addEventListener('pointercancel', onEnd);
        window.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('touchend', onEnd);
        e.preventDefault();
      }
      grip.addEventListener('pointerdown', onStart);
      grip.addEventListener('touchstart', onStart, { passive: false });
    })();

    if (root.getAttribute('data-ma-photo-open-on-load') === '1') openSheet();
    root.setAttribute('data-ma-ready', '1');
  }

  document.querySelectorAll('[data-ma-photo-capture]').forEach(initPhotoCapture);

  /** Edit an existing photo's note (caption) from the gallery icon. */
  function initPhotoNoteSheet() {
    var sheet = document.querySelector('[data-ma-photo-note-sheet]');
    if (!sheet || sheet.getAttribute('data-ma-ready') === '1') return;
    var form = sheet.querySelector('form.ma-photo-note-form');
    var textarea = sheet.querySelector('[name="caption"]');
    var returnInput = form && form.querySelector('input[name="returnTo"]');
    var home = sheet.parentNode;
    if (!form || !textarea) return;

    function decodeCaption(raw) {
      var el = document.createElement('textarea');
      el.innerHTML = String(raw == null ? '' : raw);
      return el.value.replace(/\u00a0/g, ' ');
    }

    function openFor(btn) {
      var action = btn.getAttribute('data-action') || '';
      var ret = btn.getAttribute('data-return') || '';
      var caption = decodeCaption(btn.getAttribute('data-caption') || '');
      if (!action) return;
      form.action = action;
      if (returnInput) returnInput.value = ret;
      textarea.value = caption;
      if (sheet.parentNode !== document.body) document.body.appendChild(sheet);
      sheet.hidden = false;
      document.documentElement.style.overflow = 'hidden';
      document.body.classList.add('ma-photo-open');
      setTimeout(function () { textarea.focus(); }, 50);
    }

    function closeSheet() {
      sheet.hidden = true;
      document.documentElement.style.overflow = '';
      document.body.classList.remove('ma-photo-open');
      if (home && sheet.parentNode !== home) home.appendChild(sheet);
    }

    document.addEventListener('click', function (e) {
      var open = e.target.closest('[data-ma-photo-note-open]');
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        openFor(open);
        return;
      }
      var close = e.target.closest('[data-ma-photo-note-close]');
      if (close && sheet.contains(close)) {
        e.preventDefault();
        closeSheet();
        return;
      }
      if (e.target === sheet) closeSheet();
    });

    // Reuse the same stretch grip behavior as the capture sheet.
    (function bindNoteResize() {
      var note = form.querySelector('.ma-photo-note__input');
      var grip = form.querySelector('[data-ma-photo-note-grip]');
      var box = form.querySelector('.ma-photo-note__box');
      if (!note || !grip) return;
      var minH = 112;
      var dragging = false;
      var startY = 0;
      var startH = 0;
      function maxH() { return Math.max(minH, Math.floor(window.innerHeight * 0.55)); }
      function onMove(e) {
        if (!dragging) return;
        var y = e.clientY != null ? e.clientY : (e.touches && e.touches[0] && e.touches[0].clientY);
        if (y == null) return;
        note.style.height = Math.min(maxH(), Math.max(minH, startH + (y - startY))) + 'px';
        e.preventDefault();
      }
      function onEnd() {
        if (!dragging) return;
        dragging = false;
        if (box) box.classList.remove('is-resizing');
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onEnd);
        window.removeEventListener('pointercancel', onEnd);
        window.removeEventListener('touchmove', onMove);
        window.removeEventListener('touchend', onEnd);
      }
      function onStart(e) {
        dragging = true;
        startY = e.clientY != null ? e.clientY : (e.touches && e.touches[0] && e.touches[0].clientY);
        startH = note.getBoundingClientRect().height;
        if (box) box.classList.add('is-resizing');
        if (e.pointerId != null && grip.setPointerCapture) {
          try { grip.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        }
        window.addEventListener('pointermove', onMove, { passive: false });
        window.addEventListener('pointerup', onEnd);
        window.addEventListener('pointercancel', onEnd);
        window.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('touchend', onEnd);
        e.preventDefault();
      }
      grip.addEventListener('pointerdown', onStart);
      grip.addEventListener('touchstart', onStart, { passive: false });
    })();

    sheet.setAttribute('data-ma-ready', '1');
  }

  initPhotoNoteSheet();

  /** Lightroom-style fullscreen gallery viewer (dark stage + filmstrip). */
  function initPhotoLightroomViewer() {
    var root = document.querySelector('[data-ma-lr]');
    if (!root || root.getAttribute('data-ma-ready') === '1') return;
    var img = root.querySelector('[data-ma-lr-img]');
    var captionEl = root.querySelector('[data-ma-lr-caption]');
    var countEl = root.querySelector('[data-ma-lr-count]');
    var film = root.querySelector('[data-ma-lr-film]');
    var openTab = root.querySelector('[data-ma-lr-open-tab]');
    var prevBtn = root.querySelector('[data-ma-lr-prev]');
    var nextBtn = root.querySelector('[data-ma-lr-next]');
    var stage = root.querySelector('[data-ma-lr-stage]');
    if (!img || !film) return;

    var items = [];
    var index = 0;
    var touchX = null;
    var touchY = null;

    function decodeAttr(raw) {
      var el = document.createElement('textarea');
      el.innerHTML = String(raw == null ? '' : raw);
      return el.value.replace(/\u00a0/g, ' ');
    }

    function onLrTouchMove(e) {
      if (root.hidden) return;
      var t = e.target;
      if (t && t.closest && t.closest('.ma-lr__film')) return;
      if (e.cancelable) e.preventDefault();
    }

    function collectFrom(anchor) {
      var gallery = anchor.closest('[data-ma-lr-gallery]') || document;
      var list = [];
      gallery.querySelectorAll('[data-ma-lr-open]').forEach(function (a) {
        var src = a.getAttribute('data-ma-lr-src') || a.getAttribute('href') || '';
        if (!src) return;
        list.push({
          src: src,
          caption: decodeAttr(a.getAttribute('data-ma-lr-caption') || ''),
          el: a,
        });
      });
      return list;
    }

    function renderFilm() {
      film.innerHTML = '';
      if (items.length < 2) {
        film.hidden = true;
        return;
      }
      film.hidden = false;
      items.forEach(function (item, i) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ma-lr__thumb' + (i === index ? ' is-on' : '');
        btn.setAttribute('aria-label', 'Photo ' + (i + 1));
        btn.innerHTML = '<img src="' + item.src + '" alt="" loading="lazy">';
        btn.addEventListener('click', function () { show(i); });
        film.appendChild(btn);
      });
      var on = film.querySelector('.ma-lr__thumb.is-on');
      if (on && on.scrollIntoView) {
        try { on.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); } catch (e) { /* ignore */ }
      }
    }

    function show(i) {
      if (!items.length) return;
      index = (i + items.length) % items.length;
      var item = items[index];
      root.classList.add('is-switching');
      img.onload = function () { root.classList.remove('is-switching'); };
      img.onerror = function () { root.classList.remove('is-switching'); };
      img.src = item.src;
      img.alt = item.caption || 'Job photo';
      if (captionEl) captionEl.textContent = item.caption || 'Job photo';
      if (countEl) countEl.textContent = (index + 1) + ' / ' + items.length;
      if (openTab) openTab.href = item.src;
      if (prevBtn) prevBtn.hidden = items.length < 2;
      if (nextBtn) nextBtn.hidden = items.length < 2;
      renderFilm();
      setTimeout(function () { root.classList.remove('is-switching'); }, 220);
    }

    function openAt(anchor) {
      items = collectFrom(anchor);
      if (!items.length) return;
      var start = parseInt(anchor.getAttribute('data-ma-lr-index'), 10);
      if (!Number.isFinite(start)) {
        start = items.findIndex(function (it) { return it.el === anchor; });
      }
      if (start < 0) start = 0;
      if (root.parentNode !== document.body) document.body.appendChild(root);
      root.style.transform = '';
      root.hidden = false;
      document.documentElement.style.overflow = 'hidden';
      document.documentElement.classList.add('ma-lr-open');
      document.body.classList.add('ma-lr-open');
      document.body.classList.add('ma-photo-open');
      document.addEventListener('touchmove', onLrTouchMove, { passive: false, capture: true });
      show(start);
    }

    function closeViewer() {
      root.hidden = true;
      document.documentElement.style.overflow = '';
      document.documentElement.classList.remove('ma-lr-open');
      document.body.classList.remove('ma-lr-open');
      document.body.classList.remove('ma-photo-open');
      document.removeEventListener('touchmove', onLrTouchMove, { capture: true });
      root.style.transform = '';
      items = [];
    }

    document.addEventListener('click', function (e) {
      var open = e.target.closest('[data-ma-lr-open]');
      if (open) {
        e.preventDefault();
        openAt(open);
        return;
      }
      if (e.target.closest('[data-ma-lr-close]')) {
        e.preventDefault();
        closeViewer();
        return;
      }
      if (e.target.closest('[data-ma-lr-prev]')) {
        e.preventDefault();
        show(index - 1);
        return;
      }
      if (e.target.closest('[data-ma-lr-next]')) {
        e.preventDefault();
        show(index + 1);
      }
    });

    document.addEventListener('keydown', function (e) {
      if (root.hidden) return;
      if (e.key === 'Escape') closeViewer();
      else if (e.key === 'ArrowLeft') show(index - 1);
      else if (e.key === 'ArrowRight') show(index + 1);
    });

    if (stage) {
      stage.addEventListener('touchstart', function (e) {
        var t = e.changedTouches && e.changedTouches[0];
        touchX = t ? t.clientX : null;
        touchY = t ? t.clientY : null;
        root.style.transform = '';
      }, { passive: true });
      stage.addEventListener('touchmove', function (e) {
        if (touchX == null || touchY == null) return;
        var t = e.changedTouches && e.changedTouches[0];
        if (!t) return;
        var dy = t.clientY - touchY;
        var dx = t.clientX - touchX;
        if (Math.abs(dy) > Math.abs(dx) && e.cancelable) e.preventDefault();
      }, { passive: false });
      stage.addEventListener('touchend', function (e) {
        if (touchX == null) return;
        var t = e.changedTouches && e.changedTouches[0];
        if (!t) return;
        var dx = t.clientX - touchX;
        var dy = touchY == null ? 0 : (t.clientY - touchY);
        touchX = null;
        touchY = null;
        root.style.transform = '';
        if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy)) return;
        if (dx > 0) show(index - 1);
        else show(index + 1);
      }, { passive: true });
    }

    root.setAttribute('data-ma-ready', '1');
  }

  initPhotoLightroomViewer();

  function initQrViewer() {
    var view = document.getElementById('maQrView');
    if (!view) return;

    function openQr() {
      view.hidden = false;
      document.documentElement.classList.add('ma-qr-view-open');
      document.body.classList.add('ma-qr-view-open');
      var closeBtn = view.querySelector('[data-ma-qr-close]');
      if (closeBtn) closeBtn.focus();
    }

    function closeQr() {
      view.hidden = true;
      document.documentElement.classList.remove('ma-qr-view-open');
      document.body.classList.remove('ma-qr-view-open');
    }

    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-ma-qr-open]')) {
        e.preventDefault();
        openQr();
        return;
      }
      if (e.target.closest('[data-ma-qr-close]')) {
        e.preventDefault();
        closeQr();
        return;
      }
      if (!view.hidden && e.target === view) closeQr();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !view.hidden) closeQr();
    });
  }

  initQrViewer();

  document.addEventListener('click', function (event) {
    var openAppCta = event.target.closest('[data-ma-open-app]');
    if (openAppCta) {
      // iOS cannot launch a Home Screen PWA from Safari — explain that when we know
      // they’ve used the installed app before; otherwise show Add to Home Screen steps.
      if (knowsHomescreenApp()) openSafariOpenSheet();
      else openInstallFromBanner();
      return;
    }

    var openAppDismiss = event.target.closest('[data-ma-open-app-dismiss]');
    if (openAppDismiss) {
      dismissOpenAppBanner(3);
      return;
    }

    var openAppHowto = event.target.closest('[data-ma-open-app-howto]');
    if (openAppHowto) {
      openInstallFromBanner();
      return;
    }

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

    var openBrowserBtn = event.target.closest('[data-ma-install-open-browser]');
    if (openBrowserBtn) {
      openInSystemBrowser(installUrl());
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
      var title = document.title || 'Review app';
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

    var requestReviewBtn = event.target.closest('[data-ma-request-review]');
    if (requestReviewBtn) {
      event.preventDefault();
      requestReviewFromPhone(requestReviewBtn);
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

  /** Match server buildKeywordHint — "cabinet install in Camas". */
  function buildLiveKeywordHint(opts) {
    var explicit = String((opts && opts.keywords) || '').replace(/\s+/g, ' ').trim().slice(0, 100);
    if (explicit) return explicit;
    var job = String((opts && opts.jobTitle) || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    var city = String((opts && opts.city) || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (job && city) return job + ' in ' + city;
    if (job) return job;
    if (city) return 'work in ' + city;
    return '';
  }

  /**
   * Fill {{name}} / {{company}} / {{review_link}} / {{job}} / {{city}} / {{keywords}}
   * in the live SMS script. review_link is ONLY substituted when the placeholder
   * is present — never appended.
   */
  function fillLiveReviewScript(script, opts) {
    var name = String((opts && opts.name) || 'there').trim() || 'there';
    var company = String((opts && opts.company) || 'us').trim() || 'us';
    var link = String((opts && opts.url) || '').trim();
    var job = String((opts && opts.jobTitle) || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    var city = String((opts && opts.city) || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    var keywords = buildLiveKeywordHint(opts) || 'the work we did';
    var out = String(script || '');
    out = out
      .replace(/\{\{\s*name\s*\}\}/gi, name)
      .replace(/\{\{\s*first_name\s*\}\}/gi, name)
      .replace(/\{\{\s*company\s*\}\}/gi, company)
      .replace(/\{\{\s*business_name\s*\}\}/gi, company)
      .replace(/\{\{\s*job\s*\}\}/gi, job || 'your project')
      .replace(/\{\{\s*project\s*\}\}/gi, job || 'your project')
      .replace(/\{\{\s*city\s*\}\}/gi, city || 'your area')
      .replace(/\{\{\s*keywords\s*\}\}/gi, keywords)
      .replace(/\{\{\s*keyword\s*\}\}/gi, keywords);
    if (/\{\{\s*(review_link|review_url|link)\s*\}\}/i.test(out) && link) {
      out = out
        .replace(/\{\{\s*review_link\s*\}\}/gi, link)
        .replace(/\{\{\s*review_url\s*\}\}/gi, link)
        .replace(/\{\{\s*link\s*\}\}/gi, link);
    }
    // Older scripts said "the {{job}}" — avoid "the your project" when falling back.
    out = out
      .replace(/\bthe\s+your project\b/gi, 'your project')
      .replace(/\bthe\s+the project\b/gi, 'your project');
    return out.replace(/[ \t]+/g, ' ').trim();
  }

  function scriptWantsReviewLink(script) {
    var s = String(script || '');
    if (/\{\{\s*(review_link|review_url|link)\s*\}\}/i.test(s)) return true;
    return /https?:\/\/\S+/i.test(s);
  }

  /** Remove review URLs so iMessage cannot unfurl a preview the script did not ask for. */
  function stripReviewUrlsFromText(text, reviewUrl) {
    var out = String(text || '');
    var link = String(reviewUrl || '').trim();
    if (link) {
      out = out.split(link).join(' ');
      try {
        var parsed = new URL(link);
        if (parsed.host) out = out.split(parsed.host + parsed.pathname).join(' ');
        if (parsed.pathname && parsed.pathname.length > 4) out = out.split(parsed.pathname).join(' ');
      } catch (e) { /* ignore */ }
    }
    out = out.replace(/https?:\/\/\S*\/rv\/\S+/gi, ' ');
    out = out.replace(/https?:\/\/\S*leads\.adhello\.io\S*/gi, ' ');
    out = out.replace(/[ \t]+/g, ' ').replace(/\s+([,;.!])/g, '$1');
    out = out.replace(/[\s:\-–—]+$/g, '').trim();
    return out;
  }

  /**
   * Move the review URL to the end (own paragraph). iMessage unfurls the OG
   * image much more reliably when the link is last — not mid-sentence.
   */
  function placeReviewLinkAtEnd(text, reviewUrl) {
    var link = String(reviewUrl || '').trim();
    var out = String(text || '').trim();
    if (!link) return out;
    out = out.split(link).join(' ');
    try {
      var parsed = new URL(link);
      var hostPath = (parsed.host + parsed.pathname).replace(/\/$/, '');
      if (hostPath) out = out.split(hostPath).join(' ');
      if (parsed.pathname && parsed.pathname.length > 4) out = out.split(parsed.pathname).join(' ');
    } catch (e) { /* ignore */ }
    out = out
      .replace(/https?:\/\/\S*\/rv\/\S+/gi, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\s+([?!,;.])/g, '$1')
      .replace(/[\s:\-–—]+$/g, '')
      .trim();
    if (!out) return link;
    return out + '\n\n' + link;
  }

  /**
   * Text-only fallback: put the vCard URL above the review link so the review
   * URL stays last (iMessage unfurls the last link’s OG image).
   */
  function maybeAttachVcardUrl(message, vcardUrl, opts) {
    var attach = !!(opts && opts.attach);
    if (!attach) return String(message || '').trim();
    var url = String(vcardUrl || '').trim();
    if (!url) return String(message || '').trim();
    var out = String(message || '').trim();
    if (out.indexOf(url) !== -1) return out;
    var link = String((opts && opts.reviewLink) || '').trim();
    if (link && out === link) return url + '\n\n' + link;
    if (link && out.slice(-(link.length + 2)) === ('\n\n' + link)) {
      var without = out.slice(0, -(link.length + 2)).replace(/\s+$/, '');
      if (!without) return url + '\n\n' + link;
      return without + '\n\n' + url + '\n\n' + link;
    }
    if (link && out.slice(-(link.length + 1)) === ('\n' + link)) {
      var without2 = out.slice(0, -(link.length + 1)).replace(/\s+$/, '');
      if (!without2) return url + '\n\n' + link;
      return without2 + '\n\n' + url + '\n\n' + link;
    }
    if (!out) return url;
    return out + '\n\n' + url;
  }

  function vcardFilename(company) {
    var stem = String(company || 'contact')
      .replace(/[^\w\s-]+/g, '')
      .trim()
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    return (stem || 'contact') + '.vcf';
  }

  function makeVcardFile(blob, company) {
    var name = vcardFilename(company);
    var types = ['text/vcard', 'text/x-vcard', 'text/plain'];
    var i;
    for (i = 0; i < types.length; i++) {
      try {
        var file = new File([blob], name, { type: types[i] });
        if (!navigator.canShare) return file;
        if (navigator.canShare({ files: [file] })) return file;
      } catch (e) { /* try next type */ }
    }
    try {
      return new File([blob], name, { type: 'text/vcard' });
    } catch (e2) {
      return null;
    }
  }

  /**
   * Request a review from this phone.
   * Uses the live SMS script textarea when present (so removing {{review_link}}
   * takes effect immediately). If the script has no link placeholder/URL, strip
   * every review URL before share so Messages cannot show a preview image.
   * When the script wants a link, put it last so iMessage can unfurl the image.
   * Attach contact card: share a real .vcf File (contact bubble on iOS) and keep
   * only the review URL in the text; fall back to a .vcf URL above the review link.
   */
  function readLiveKeywordFields(payload) {
    function val(id) {
      var el = document.getElementById(id);
      return el && el.value != null ? String(el.value).replace(/\s+/g, ' ').trim() : '';
    }
    function named(name) {
      var nodes = document.getElementsByName(name);
      for (var i = 0; i < nodes.length; i++) {
        var v = nodes[i] && nodes[i].value != null ? String(nodes[i].value).replace(/\s+/g, ' ').trim() : '';
        if (v) return v;
      }
      return '';
    }
    // Prefer SMS-script defaults (rvKeyword*), then send Options, then name=, then payload.
    return {
      jobTitle: val('rvKeywordJob') || val('rvAskKeywordJob') || named('keywordJob') || String((payload && payload.jobTitle) || ''),
      city: val('rvKeywordCity') || val('rvAskKeywordCity') || named('keywordCity') || String((payload && payload.city) || ''),
      keywords: val('rvKeywords') || val('rvAskKeywords') || named('keywords') || String((payload && payload.keywords) || ''),
    };
  }

  function syncShareKeywordPayload() {
    var el = document.getElementById('maRequestReviewPayload');
    if (!el) return;
    try {
      var data = JSON.parse(el.textContent || '{}');
      var kw = readLiveKeywordFields(data);
      data.jobTitle = kw.jobTitle;
      data.city = kw.city;
      data.keywords = kw.keywords || buildLiveKeywordHint(kw);
      var scriptEl = document.getElementById('rvSmsScript');
      if (scriptEl) data.script = String(scriptEl.value || '');
      var attachEl = document.getElementById('rvAttachVcard');
      if (attachEl) data.attachVcard = !!attachEl.checked;
      el.textContent = JSON.stringify(data);
    } catch (e) { /* ignore */ }
  }

  function scriptNeedsKeywords(script) {
    return /\{\{\s*(job|city|keywords|keyword|project)\s*\}\}/i.test(String(script || ''));
  }

  function promptForKeywordDefaults() {
    var fold = document.querySelector('details.ma-fold summary');
    var summaries = document.querySelectorAll('details.ma-fold');
    for (var i = 0; i < summaries.length; i++) {
      var s = summaries[i].querySelector('summary');
      if (s && /SMS script/i.test(s.textContent || '')) {
        summaries[i].open = true;
        break;
      }
    }
    var jobEl = document.getElementById('rvKeywordJob');
    var emptyHint = document.getElementById('rvKeywordsEmptyHint');
    if (emptyHint) {
      emptyHint.style.display = '';
      emptyHint.textContent = 'Add a default project and city (or keywords), then Save script — gray example text is only a hint until you type.';
    }
    if (jobEl) {
      jobEl.classList.add('ma-input--unset');
      try { jobEl.focus(); } catch (e) { /* ignore */ }
      try { jobEl.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e2) { /* ignore */ }
    }
    void fold;
  }

  /** Digits/+ only for sms: URLs — never pass an email into Messages To:. */
  function smsDigits(phone) {
    var raw = String(phone || '').trim();
    if (!raw || raw.indexOf('@') !== -1) return '';
    return raw.replace(/[^\d+]/g, '');
  }

  function readAskPhone() {
    var el = document.getElementById('rvAskPhone');
    return smsDigits(el && el.value != null ? el.value : '');
  }

  function readAskName() {
    var nameEl = document.getElementById('rvAskName');
    if (nameEl && String(nameEl.value || '').trim()) return String(nameEl.value).trim();
    var selected = document.querySelector('[data-ma-ask-selected-name]');
    if (selected && String(selected.textContent || '').trim()) {
      return String(selected.textContent).replace(/\s+/g, ' ').trim();
    }
    return '';
  }

  function readAskEmail() {
    var el = document.getElementById('rvAskEmail');
    return el && el.value != null ? String(el.value).trim() : '';
  }

  function promptForAskPhone() {
    var fold = document.getElementById('maAskForm');
    if (fold) fold.open = true;
    var phone = document.getElementById('rvAskPhone');
    var manual = document.querySelector('[data-ma-ask-manual]');
    if (manual) manual.hidden = false;
    if (phone) {
      phone.classList.add('ma-input--unset');
      try { phone.focus(); } catch (e) { /* ignore */ }
      try { phone.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e2) { /* ignore */ }
    }
    var hint = document.getElementById('rvAskPhoneHint');
    if (!hint && phone && phone.parentNode) {
      hint = document.createElement('p');
      hint.id = 'rvAskPhoneHint';
      hint.className = 'ma-flash ma-flash--err';
      hint.style.margin = '8px 0 0';
      phone.parentNode.appendChild(hint);
    }
    if (hint) {
      hint.style.display = '';
      hint.textContent = 'Add their mobile number so Messages opens that SMS thread (email alone won’t show text history).';
    }
  }

  function requestReviewFromPhone(btn) {
    syncShareKeywordPayload();
    var payload = readRequestReviewPayload(btn);
    if (!payload) return;
    var title = payload.title || 'Leave a review';
    var company = payload.company || '';
    var reviewUrl = String(payload.url || '').trim();
    var scriptEl = document.getElementById('rvSmsScript');
    var liveScript = scriptEl ? String(scriptEl.value || '').trim() : '';
    var sourceScript = liveScript || String(payload.script || '');
    var kw = readLiveKeywordFields(payload);
    var askPhone = readAskPhone();
    var askName = readAskName() || 'there';
    var text = '';
    var hasKw = !!(kw.jobTitle || kw.city || kw.keywords || buildLiveKeywordHint(kw));

    // Don't open Messages with empty "your project / your area" — make them set defaults.
    if (scriptNeedsKeywords(sourceScript) && !hasKw) {
      promptForKeywordDefaults();
      return;
    }

    // Customer/email filled but no mobile — don’t open Messages with an email To:.
    if (!askPhone && (readAskEmail() || readAskName() || document.getElementById('rvAskCustomerId') && document.getElementById('rvAskCustomerId').value)) {
      promptForAskPhone();
      return;
    }

    // Live script may add {{review_link}} after page load — pick URL from the page.
    if (!reviewUrl && scriptWantsReviewLink(sourceScript)) {
      var linkEl = document.getElementById('rvLink');
      reviewUrl = linkEl ? String(linkEl.textContent || '').trim() : '';
    }

    if (liveScript) {
      text = fillLiveReviewScript(liveScript, {
        name: askName,
        company: company,
        url: reviewUrl,
        jobTitle: kw.jobTitle,
        city: kw.city,
        keywords: kw.keywords,
      });
    } else {
      // Server shareSmsText should already be filled; re-fill any leftover tags.
      text = fillLiveReviewScript(String(payload.text || '').trim() || String(payload.script || ''), {
        name: askName,
        company: company,
        url: reviewUrl,
        jobTitle: kw.jobTitle,
        city: kw.city,
        keywords: kw.keywords,
      });
    }

    // Hard rule: no {{review_link}} / URL in the script → no URL in the message.
    if (!scriptWantsReviewLink(sourceScript)) {
      text = stripReviewUrlsFromText(text, reviewUrl);
    } else if (reviewUrl) {
      // Review link last → iMessage can unfurl the OG image.
      text = placeReviewLinkAtEnd(text, reviewUrl);
    }

    // Live checkbox (even before Save).
    var attachEl = document.getElementById('rvAttachVcard');
    var attachVcard = attachEl ? !!attachEl.checked : !!payload.attachVcard;
    var vcardUrl = String(payload.vcardUrl || '').trim();
    var reviewLinkForAttach = scriptWantsReviewLink(sourceScript) ? reviewUrl : '';

    if (!text) {
      // Empty script — share a short note with NO forced URL.
      text = title;
    }

    var originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.textContent = 'Opening…';

    function restore() {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      btn.innerHTML = originalHtml;
    }

    function openSms(body, phone) {
      var msg = String(body || '');
      var digits = smsDigits(phone);
      var href;
      if (digits) {
        // Recipient in the sms: URL so iOS/Android open that contact’s SMS history.
        href = isIOS
          ? 'sms:' + encodeURIComponent(digits) + '&body=' + encodeURIComponent(msg)
          : 'sms:' + encodeURIComponent(digits) + '?body=' + encodeURIComponent(msg);
      } else {
        href = isIOS
          ? 'sms:&body=' + encodeURIComponent(msg)
          : 'sms:?body=' + encodeURIComponent(msg);
      }
      window.location.href = href;
      // Keep the loading label briefly — Messages is taking over.
      setTimeout(restore, 1200);
    }

    function textWithVcardUrl(body) {
      return maybeAttachVcardUrl(body, vcardUrl, {
        attach: true,
        reviewLink: reviewLinkForAttach,
      });
    }

    /** Drop any .vcf URL so sms: drafts keep only the review link for the OG image. */
    function textWithoutVcardUrl(body) {
      var msg = String(body || '');
      var card = String(vcardUrl || '').trim();
      if (!card) return msg.trim();
      var out = msg.split(card).join(' ');
      try {
        var parsed = new URL(card);
        var hostPath = (parsed.host + parsed.pathname).replace(/\/$/, '');
        if (hostPath) out = out.split(hostPath).join(' ');
        if (parsed.pathname && parsed.pathname.length > 4) out = out.split(parsed.pathname).join(' ');
      } catch (e) { /* ignore */ }
      out = out
        .replace(/https?:\/\/\S*\.vcf\b/gi, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .trim();
      if (reviewLinkForAttach) out = placeReviewLinkAtEnd(out, reviewLinkForAttach);
      return out;
    }

    function shareText(body, vcardFile) {
      var msg = String(body || '');
      // Phone known → open SMS to that number (thread history). File share can't set To:.
      // Never paste a .vcf URL into this path — it blocks the review-link preview image.
      if (askPhone) {
        openSms(textWithoutVcardUrl(msg), askPhone);
        return;
      }
      if (navigator.share) {
        var data = { title: title, text: msg };
        if (vcardFile) {
          try {
            data.files = [vcardFile];
          } catch (e) { /* ignore */ }
        }
        navigator.share(data).then(restore).catch(function (err) {
          if (err && err.name === 'AbortError') {
            restore();
            return;
          }
          // File share rejected — put the .vcf URL in the body (review link stays last).
          var fallback = vcardFile ? textWithVcardUrl(msg) : msg;
          if (navigator.share) {
            navigator.share({ title: title, text: fallback }).then(restore).catch(function () {
              openSms(fallback, askPhone);
            });
            return;
          }
          openSms(fallback, askPhone);
        });
        return;
      }
      openSms(vcardFile ? textWithVcardUrl(msg) : msg, askPhone);
    }

    // With a mobile number, open Messages to that phone (SMS history).
    // sms: cannot attach a .vcf File — and pasting the .vcf URL in the body
    // blocks iMessage’s review-link preview image. Keep text = script + review
    // link only (same preview as Request a review without a recipient). Contact
    // card File share stays on the no-recipient Share path below.
    if (askPhone) {
      openSms(textWithoutVcardUrl(text), askPhone);
      return;
    }

    if (attachVcard && vcardUrl && typeof fetch === 'function' && navigator.share) {
      // No recipient yet — Share can still attach a real .vcf contact file.
      fetch(vcardUrl, { credentials: 'omit' }).then(function (res) {
        if (!res || !res.ok) throw new Error('vcard fetch failed');
        return res.blob();
      }).then(function (blob) {
        var file = makeVcardFile(blob, company);
        if (!file) throw new Error('vcard file unsupported');
        shareText(text, file);
      }).catch(function () {
        shareText(textWithVcardUrl(text), null);
      });
      return;
    }

    if (attachVcard && vcardUrl) {
      text = textWithVcardUrl(text);
    }
    shareText(text, null);
  }

  function readRequestReviewPayload(btn) {
    var id = btn.getAttribute('data-ma-request-review-payload') || 'maRequestReviewPayload';
    var el = document.getElementById(id);
    if (!el) {
      return {
        url: btn.getAttribute('data-ma-share') || '',
        title: btn.getAttribute('data-ma-share-title') || '',
        text: btn.getAttribute('data-ma-share-text') || '',
      };
    }
    try {
      return JSON.parse(el.textContent || '{}');
    } catch (e) {
      return null;
    }
  }

  /** Typeahead: search customers as you type (review ask + Referrals → Request). */
  function initCustomerPick(root) {
    if (!root || root.getAttribute('data-ma-ready') === '1') return;
    var searchApi = window.maCustomerSearch;
    if (!searchApi || !searchApi.searchCustomers) {
      // Defer scripts can race on soft navigations — retry once shortly.
      if (!root.getAttribute('data-ma-pick-retry')) {
        root.setAttribute('data-ma-pick-retry', '1');
        setTimeout(function () { initCustomerPick(root); }, 50);
      }
      return;
    }

    var input = root.querySelector('input[role="combobox"], input[type="search"], input.ma-input');
    var hidden = root.querySelector('input[type="hidden"][name="customerId"], input[type="hidden"][name="customer"]');
    var list = root.querySelector('[role="listbox"]');
    var dataEl = root.querySelector('script[type="application/json"]');
    var searchWrap = root.querySelector('[data-ma-ask-search]');
    var selectedWrap = root.querySelector('[data-ma-ask-selected]');
    var selectedName = root.querySelector('[data-ma-ask-selected-name]');
    var selectedMeta = root.querySelector('[data-ma-ask-selected-meta]');
    var selectedAvatar = root.querySelector('[data-ma-ask-selected-avatar]');
    var clearBtn = root.querySelector('[data-ma-ask-clear]');
    var manualWrap = document.querySelector('[data-ma-ask-manual]');
    var savedOnly = root.getAttribute('data-ma-pick-mode') === 'saved'
      || root.getAttribute('data-ma-saved-only') === '1';
    if (!input || !hidden || !list || !dataEl) return;

    var customers = [];
    try { customers = JSON.parse(dataEl.textContent || '[]'); } catch (e) { customers = []; }
    if (!Array.isArray(customers)) customers = [];

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
      if (phone) phone.value = c.phone || '';
      if (email) email.value = c.email || '';
    }

    function syncMode() {
      var picked = !!String(hidden.value || '').trim();
      if (searchWrap) searchWrap.hidden = picked;
      if (selectedWrap) selectedWrap.hidden = !picked;
      if (manualWrap && !savedOnly) manualWrap.hidden = picked;
      var submit = root.closest('form') && root.closest('form').querySelector('[data-ma-needs-customer]');
      if (submit) submit.disabled = !picked;
    }

    function showSelected(c) {
      if (!c) return;
      if (selectedName) selectedName.textContent = c.name || 'Customer';
      if (selectedMeta) selectedMeta.textContent = c.phone || c.email || 'Saved customer';
      if (selectedAvatar) {
        selectedAvatar.textContent = String(c.name || '?').charAt(0).toUpperCase();
      }
    }

    function clearPick(opts) {
      var keepManual = opts && opts.keepManual;
      hidden.value = '';
      active = -1;
      input.value = '';
      if (!keepManual && !savedOnly) {
        if (name) name.value = '';
        if (phone) phone.value = '';
        if (email) email.value = '';
      }
      syncMode();
    }

    function closeList() {
      list.hidden = true;
      list.setAttribute('hidden', '');
      input.setAttribute('aria-expanded', 'false');
      active = -1;
    }

    function openList() {
      list.hidden = false;
      list.removeAttribute('hidden');
      input.setAttribute('aria-expanded', 'true');
    }

    function render(query) {
      var q = String(query || '').trim();
      // Any typed characters filter the full customer list; empty query shows everyone (capped).
      shown = customers.length
        ? searchApi.searchCustomers(customers, q, { limit: 80 })
        : [];
      var html = '';
      if (!savedOnly) {
        html += '<li class="ma-typeahead__item ma-typeahead__item--new" role="option" data-id="" data-idx="-1">' +
          (q ? 'Use “' + esc(q) + '” as a new person' : 'Or enter a new person below…') + '</li>';
      }
      shown.forEach(function (c, i) {
        html += '<li class="ma-typeahead__item" role="option" data-id="' + esc(c.id) + '" data-idx="' + i + '">' +
          esc(labelFor(c)) + '</li>';
      });
      if (!customers.length) {
        html += '<li class="ma-typeahead__empty" role="presentation">No customers yet — add some under Customers</li>';
      } else if (q && !shown.length) {
        html += '<li class="ma-typeahead__empty" role="presentation">' +
          (savedOnly ? 'No matches — try another name or phone' : 'No saved matches — enter them as new below') +
          '</li>';
      } else if (!q && savedOnly && !shown.length) {
        html += '<li class="ma-typeahead__empty" role="presentation">No customers yet</li>';
      }
      list.innerHTML = html;
      // Always show the panel once the field is active / typed into.
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
        if (savedOnly) return;
        var typed = String(input.value || '').trim();
        clearPick({ keepManual: true });
        if (typed && name) name.value = typed;
        closeList();
        syncMode();
        if (name) name.focus();
        return;
      }
      var c = shown[idx];
      if (!c) {
        c = customers.find(function (row) { return row.id === id; });
      }
      if (!c) return;
      hidden.value = c.id;
      fillFields(c);
      showSelected(c);
      input.value = '';
      closeList();
      syncMode();
      try { input.blur(); } catch (err) { /* ignore */ }
    }

    // Hydrate selected card if the page loaded with a customerId.
    if (hidden.value) {
      var initial = customers.find(function (row) { return row.id === hidden.value; });
      if (initial) {
        fillFields(initial);
        showSelected(initial);
      }
    }
    syncMode();

    input.addEventListener('focus', function () {
      render(input.value);
    });
    input.addEventListener('input', function () {
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
    list.addEventListener('pointerdown', onPickEvent);
    list.addEventListener('mousedown', onPickEvent);
    list.addEventListener('click', onPickEvent);
    if (clearBtn) {
      clearBtn.addEventListener('click', function (e) {
        e.preventDefault();
        clearPick();
        syncMode();
        if (input) input.focus();
      });
    }
    document.addEventListener('click', function (e) {
      if (!root.contains(e.target)) closeList();
    });

    root.setAttribute('data-ma-ready', '1');
  }

  /** Live filter for Customers → List (same ranking as review ask typeahead). */
  function initCustomerListSearch(form) {
    if (!form || form.getAttribute('data-ma-ready') === '1') return;
    var searchApi = window.maCustomerSearch;
    if (!searchApi || !searchApi.scoreCustomer) return;

    var input = form.querySelector('input[type="search"], input[name="q"]');
    var list = document.querySelector('[data-ma-customer-list]');
    var empty = document.querySelector('[data-ma-customer-list-empty]');
    var emptyMsg = empty && empty.querySelector('[data-ma-customer-list-empty-msg]');
    if (!input || !list) return;

    var rows = Array.prototype.slice.call(list.querySelectorAll('[data-ma-customer-row]'));
    if (!rows.length) return;

    function customerFromRow(row) {
      return {
        id: row.getAttribute('data-id') || '',
        name: row.getAttribute('data-name') || '',
        phone: row.getAttribute('data-phone') || '',
        email: row.getAttribute('data-email') || '',
        address: row.getAttribute('data-address') || '',
      };
    }

    function apply(query) {
      var q = String(query || '').trim();
      var scored = rows.map(function (row, index) {
        return { row: row, index: index, score: searchApi.scoreCustomer(customerFromRow(row), q) };
      });
      var visible = 0;
      if (!q) {
        scored.sort(function (a, b) { return a.index - b.index; });
        scored.forEach(function (item) {
          item.row.hidden = false;
          list.appendChild(item.row);
          visible += 1;
        });
      } else {
        scored.sort(function (a, b) { return b.score - a.score || a.index - b.index; });
        scored.forEach(function (item) {
          var show = item.score > 0;
          item.row.hidden = !show;
          if (show) {
            list.appendChild(item.row);
            visible += 1;
          }
        });
      }
      if (empty) {
        empty.hidden = visible > 0;
        if (emptyMsg) {
          emptyMsg.textContent = q
            ? 'No customers match “' + q + '”.'
            : 'No customers match.';
        }
      }
      list.hidden = visible === 0;
      try {
        var url = new URL(window.location.href);
        if (q) url.searchParams.set('q', q);
        else url.searchParams.delete('q');
        url.searchParams.delete('view');
        window.history.replaceState(null, '', url.pathname + url.search + url.hash);
      } catch (e) { /* ignore */ }
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      apply(input.value);
      input.blur();
    });
    input.addEventListener('input', function () {
      apply(input.value);
    });
    input.addEventListener('search', function () {
      apply(input.value);
    });

    if (String(input.value || '').trim()) apply(input.value);
    form.setAttribute('data-ma-ready', '1');
  }

  /** Typeahead + focus-gated suggestion pills for customer tags. */
  function initTagPick(root) {
    if (!root || root.getAttribute('data-ma-ready') === '1') return;
    var form = root.querySelector('[data-ma-tag-form]');
    var input = root.querySelector('[data-ma-tag-input]');
    var keyInput = root.querySelector('[data-ma-tag-key]');
    var list = root.querySelector('[data-ma-tag-list]');
    var dataEl = root.querySelector('[data-ma-tag-catalog]');
    var suggest = root.querySelector('[data-ma-tag-suggest]');
    var applied = root.querySelector('[data-ma-tag-applied]');
    if (!form || !input || !keyInput || !list || !dataEl) return;

    var catalog = [];
    try { catalog = JSON.parse(dataEl.textContent || '[]'); } catch (e) { catalog = []; }
    if (!Array.isArray(catalog)) catalog = [];

    var active = -1;
    var searchActive = false;
    var blurTimer = 0;
    var removeAction = applied ? (applied.getAttribute('data-remove-action') || '') : '';
    var busy = Object.create(null);

    function esc(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
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

    function setActive(idx) {
      active = idx;
      var items = list.querySelectorAll('.ma-typeahead__item');
      for (var i = 0; i < items.length; i++) {
        items[i].classList.toggle('is-active', i === active);
      }
    }

    function filterSuggest(qLower) {
      if (!suggest) return;
      if (!searchActive) {
        suggest.hidden = true;
        return;
      }
      var items = suggest.querySelectorAll('[data-ma-tag-suggest-item]');
      var visible = 0;
      for (var i = 0; i < items.length; i++) {
        var name = String(items[i].getAttribute('data-name') || '');
        var show = !qLower || name.indexOf(qLower) !== -1;
        items[i].hidden = !show;
        if (show) visible += 1;
      }
      suggest.hidden = visible === 0;
    }

    function setSearchActive(on) {
      searchActive = !!on;
      if (!searchActive) {
        if (suggest) suggest.hidden = true;
        closeList();
        return;
      }
      filterSuggest(String(input.value || '').trim().toLowerCase());
    }

    function syncEmptyState() {
      if (!applied) return;
      var chips = applied.querySelectorAll('.ma-tags__chip');
      var empty = applied.querySelector('[data-ma-tag-empty]');
      if (chips.length) {
        if (empty) empty.remove();
      } else if (!empty) {
        var p = document.createElement('p');
        p.className = 'ma-hint ma-tags__empty';
        p.setAttribute('data-ma-tag-empty', '');
        p.style.margin = '0';
        p.textContent = 'No tags on this customer yet.';
        applied.appendChild(p);
      }
    }

    function postTagForm(action, fields) {
      var body = new URLSearchParams();
      Object.keys(fields || {}).forEach(function (k) {
        if (fields[k] != null && fields[k] !== '') body.set(k, fields[k]);
      });
      return fetch(action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html' },
        body: body.toString(),
        credentials: 'same-origin',
        redirect: 'manual',
      }).then(function (res) {
        // 303/302 after save, or 200 error page
        if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400) || res.status === 0) {
          return { ok: true };
        }
        if (res.ok) return { ok: true };
        return { ok: false };
      }).catch(function () { return { ok: false }; });
    }

    function buildChip(tag) {
      var chip = document.createElement('div');
      chip.className = 'ma-tags__chip';
      chip.setAttribute('role', 'listitem');
      chip.setAttribute('data-key', tag.key);
      chip.style.setProperty('--ma-tag', tag.color || 'var(--acc)');
      chip.innerHTML =
        '<span class="ma-tags__chip-name">' + esc(tag.name) + '</span>' +
        '<form method="post" action="' + esc(removeAction) + '" class="ma-tags__chip-remove" data-ma-tag-remove-form>' +
          '<input type="hidden" name="tagKey" value="' + esc(tag.key) + '">' +
          '<button type="submit" class="ma-tags__chip-x" aria-label="Remove ' + esc(tag.name) + ' tag">×</button>' +
        '</form>';
      return chip;
    }

    function optimisticAdd(tag, suggestItem) {
      if (!applied || !tag || !tag.key || busy[tag.key]) return;
      busy[tag.key] = true;
      if (suggestItem) suggestItem.hidden = true;
      catalog = catalog.filter(function (t) { return t.key !== tag.key; });
      var chip = buildChip(tag);
      applied.appendChild(chip);
      syncEmptyState();
      filterSuggest(String(input.value || '').trim().toLowerCase());
      chip.classList.add('is-pending');
      postTagForm(form.action, { tagKey: tag.key }).then(function (out) {
        chip.classList.remove('is-pending');
        delete busy[tag.key];
        if (out.ok) return;
        chip.remove();
        if (suggestItem) suggestItem.hidden = false;
        catalog.push({ key: tag.key, name: tag.name, color: tag.color || '' });
        syncEmptyState();
        filterSuggest(String(input.value || '').trim().toLowerCase());
      });
    }

    function optimisticRemove(chip) {
      if (!chip || !applied) return;
      var key = chip.getAttribute('data-key') || '';
      if (!key || busy[key]) return;
      var nameEl = chip.querySelector('.ma-tags__chip-name');
      var name = nameEl ? nameEl.textContent : key;
      var color = chip.style.getPropertyValue('--ma-tag') || '';
      busy[key] = true;
      var next = chip.nextSibling;
      chip.remove();
      syncEmptyState();
      // Restore into suggestions if we have a matching slot, else append a new one
      var suggestItem = null;
      if (suggest) {
        var suggestItems = suggest.querySelectorAll('[data-ma-tag-suggest-item]');
        for (var si = 0; si < suggestItems.length; si++) {
          if (suggestItems[si].getAttribute('data-key') === key) { suggestItem = suggestItems[si]; break; }
        }
      }
      if (suggestItem) {
        suggestItem.hidden = !searchActive;
      } else if (suggest) {
        suggestItem = document.createElement('li');
        suggestItem.className = 'ma-tags__suggest-item';
        suggestItem.setAttribute('data-ma-tag-suggest-item', '');
        suggestItem.setAttribute('data-key', key);
        suggestItem.setAttribute('data-name', String(name || '').toLowerCase());
        suggestItem.setAttribute('data-color', color);
        suggestItem.hidden = !searchActive;
        suggestItem.innerHTML =
          '<form method="post" action="' + esc(form.action) + '" data-ma-tag-suggest-form>' +
            '<input type="hidden" name="tagKey" value="' + esc(key) + '">' +
            '<button type="submit" class="ma-tags__suggest-btn" style="--ma-tag:' + esc(color || 'var(--acc)') + '">+ ' + esc(name) + '</button>' +
          '</form>';
        suggest.appendChild(suggestItem);
      }
      if (!catalog.some(function (t) { return t.key === key; })) {
        catalog.push({ key: key, name: name, color: color });
      }
      filterSuggest(String(input.value || '').trim().toLowerCase());
      postTagForm(removeAction, { tagKey: key }).then(function (out) {
        delete busy[key];
        if (out.ok) return;
        var restored = buildChip({ key: key, name: name, color: color });
        if (next && next.parentNode === applied) applied.insertBefore(restored, next);
        else applied.appendChild(restored);
        if (suggestItem) suggestItem.remove();
        catalog = catalog.filter(function (t) { return t.key !== key; });
        syncEmptyState();
        filterSuggest(String(input.value || '').trim().toLowerCase());
      });
    }

    function render(query) {
      var q = String(query || '').trim();
      var qLower = q.toLowerCase();
      filterSuggest(qLower);

      var shown = catalog.filter(function (t) {
        if (!qLower) return false; // pills handle the empty-query case
        return String(t.name || '').toLowerCase().indexOf(qLower) !== -1;
      }).slice(0, 40);

      var exact = catalog.some(function (t) {
        return String(t.name || '').toLowerCase() === qLower;
      });

      var html = '';
      if (q && !exact) {
        html += '<li class="ma-typeahead__item ma-typeahead__item--new" role="option" data-create="1" data-idx="0">' +
          'Create “' + esc(q) + '”</li>';
      }
      shown.forEach(function (t, i) {
        var idx = (q && !exact ? 1 : 0) + i;
        html += '<li class="ma-typeahead__item" role="option" data-key="' + esc(t.key) + '" data-name="' + esc(t.name) + '" data-idx="' + idx + '">' +
          esc(t.name) + '</li>';
      });
      if (!q) {
        closeList();
        list.innerHTML = '';
        return;
      }
      if (!html) {
        html = '<li class="ma-typeahead__empty" role="presentation">No matching tags</li>';
      }
      list.innerHTML = html;
      openList();
      setActive(q && !exact ? 0 : -1);
    }

    function pickCreate() {
      keyInput.value = '';
    }

    function pickExisting(el) {
      if (!el) return;
      keyInput.value = el.getAttribute('data-key') || '';
      input.value = el.getAttribute('data-name') || input.value;
    }

    function chooseActive() {
      var items = list.querySelectorAll('.ma-typeahead__item');
      if (active < 0 || active >= items.length) {
        keyInput.value = '';
        return true;
      }
      var el = items[active];
      if (el.getAttribute('data-create') === '1') pickCreate();
      else pickExisting(el);
      closeList();
      return true;
    }

    input.addEventListener('focus', function () {
      if (blurTimer) { clearTimeout(blurTimer); blurTimer = 0; }
      setSearchActive(true);
      render(input.value);
    });
    input.addEventListener('blur', function () {
      blurTimer = setTimeout(function () {
        blurTimer = 0;
        if (root.contains(document.activeElement)) return;
        setSearchActive(false);
      }, 120);
    });
    input.addEventListener('input', function () {
      keyInput.value = '';
      setSearchActive(true);
      render(input.value);
    });
    input.addEventListener('keydown', function (e) {
      var items = list.querySelectorAll('.ma-typeahead__item');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (list.hidden) render(input.value);
        items = list.querySelectorAll('.ma-typeahead__item');
        setActive(Math.min(active + 1, items.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive(Math.max(active - 1, 0));
      } else if (e.key === 'Enter') {
        if (!list.hidden && items.length) {
          e.preventDefault();
          var el = items[active] || items[0];
          if (el && el.getAttribute('data-create') !== '1' && el.getAttribute('data-key')) {
            var tag = catalog.find(function (t) { return t.key === el.getAttribute('data-key'); });
            if (tag) {
              chooseActive();
              var suggestItem = null;
              if (suggest) {
                var sItems = suggest.querySelectorAll('[data-ma-tag-suggest-item]');
                for (var sj = 0; sj < sItems.length; sj++) {
                  if (sItems[sj].getAttribute('data-key') === tag.key) { suggestItem = sItems[sj]; break; }
                }
              }
              optimisticAdd(tag, suggestItem);
              input.value = '';
              keyInput.value = '';
              closeList();
              filterSuggest('');
              return;
            }
          }
          chooseActive();
          form.requestSubmit();
        } else {
          keyInput.value = '';
        }
      } else if (e.key === 'Escape') {
        closeList();
        setSearchActive(false);
        input.blur();
      }
    });
    list.addEventListener('mousedown', function (e) {
      var el = e.target.closest('.ma-typeahead__item');
      if (!el) return;
      e.preventDefault();
      if (el.getAttribute('data-create') === '1') {
        pickCreate();
        closeList();
        form.requestSubmit();
        return;
      }
      var key = el.getAttribute('data-key') || '';
      var tag = catalog.find(function (t) { return t.key === key; });
      if (tag) {
        var suggestItem = null;
        if (suggest) {
          var sItems2 = suggest.querySelectorAll('[data-ma-tag-suggest-item]');
          for (var sk = 0; sk < sItems2.length; sk++) {
            if (sItems2[sk].getAttribute('data-key') === key) { suggestItem = sItems2[sk]; break; }
          }
        }
        optimisticAdd(tag, suggestItem);
        input.value = '';
        keyInput.value = '';
        closeList();
        filterSuggest('');
        return;
      }
      pickExisting(el);
      closeList();
      form.requestSubmit();
    });

    if (suggest) {
      // Keep focus on the search field while tapping a suggestion.
      suggest.addEventListener('mousedown', function (e) {
        if (e.target.closest('[data-ma-tag-suggest-form]')) e.preventDefault();
      });
      suggest.addEventListener('click', function (e) {
        var formEl = e.target.closest('[data-ma-tag-suggest-form]');
        if (!formEl) return;
        e.preventDefault();
        var item = formEl.closest('[data-ma-tag-suggest-item]');
        if (!item) return;
        var key = item.getAttribute('data-key') || '';
        var name = item.getAttribute('data-name') || '';
        var color = item.getAttribute('data-color') || '';
        var btn = formEl.querySelector('.ma-tags__suggest-btn');
        var label = btn ? String(btn.textContent || '').replace(/^\+\s*/, '').trim() : name;
        optimisticAdd({ key: key, name: label || name, color: color }, item);
      });
    }

    if (applied) {
      applied.addEventListener('click', function (e) {
        var formEl = e.target.closest('[data-ma-tag-remove-form]');
        if (!formEl) return;
        e.preventDefault();
        var chip = formEl.closest('.ma-tags__chip');
        if (chip) optimisticRemove(chip);
      });
    }

    // Available tags stay hidden until the search input is focused.
    setSearchActive(false);
    root.setAttribute('data-ma-ready', '1');
  }

  /** Typeahead: search workspace teammates + network partners on Share contact. */
  function initShareMatePick(root) {
    if (!root || root.getAttribute('data-ma-ready') === '1') return;
    var input = root.querySelector('[data-ma-share-mate-input]');
    var hidden = root.querySelector('[data-ma-share-mate-id]');
    var list = root.querySelector('[data-ma-share-mate-list]');
    var dataEl = root.querySelector('[data-ma-share-mates]');
    var searchWrap = root.querySelector('[data-ma-share-search]');
    var selectedWrap = root.querySelector('[data-ma-share-selected]');
    var selectedName = root.querySelector('[data-ma-share-selected-name]');
    var selectedMeta = root.querySelector('[data-ma-share-selected-meta]');
    var selectedAvatar = root.querySelector('[data-ma-share-selected-avatar]');
    var clearBtn = root.querySelector('[data-ma-share-clear]');
    var form = root.closest('[data-ma-share-mate-form]') || root.closest('form');
    var submitBtn = form ? form.querySelector('[data-ma-share-submit]') : null;
    if (!input || !hidden || !list || !dataEl) return;

    var mates = [];
    try {
      mates = JSON.parse(dataEl.textContent || '[]');
    } catch (e) {
      mates = [];
    }
    if (!Array.isArray(mates)) mates = [];

    var shown = [];
    var active = -1;

    function esc(s) {
      return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function norm(s) {
      return String(s || '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
    }

    function digits(s) {
      return String(s || '').replace(/\D+/g, '');
    }

    function displayLine(m) {
      var label = String((m && m.label) || 'Teammate');
      var contact = String((m && m.contact) || '');
      if (contact && contact !== label) return label + ' · ' + contact;
      return label;
    }

    function metaLine(m) {
      if (!m) return '';
      if (m.workspaceStaff) return m.contact || m.email || 'Workspace team';
      var bits = [];
      if (m.contact && m.contact !== m.label) bits.push(m.contact);
      if (m.email) bits.push(m.email);
      else if (m.phone) bits.push(m.phone);
      return bits.join(' · ') || 'Network partner';
    }

    function scoreMate(m, query) {
      var q = norm(query);
      if (!q) return m && m.workspaceStaff ? 2 : 1;
      var label = norm(m && m.label);
      var contact = norm(m && m.contact);
      var email = norm(m && m.email);
      var phone = digits(m && m.phone);
      var qDigits = digits(q);
      var score = 0;
      function hit(hay, exact, prefix, contains) {
        if (!hay) return;
        if (hay === q) score = Math.max(score, exact);
        else if (hay.indexOf(q) === 0) score = Math.max(score, prefix);
        else if (hay.indexOf(q) !== -1) score = Math.max(score, contains);
      }
      hit(label, 1000, 800, 500);
      hit(contact, 900, 700, 400);
      hit(email, 850, 650, 350);
      if (qDigits.length >= 3 && phone && phone.indexOf(qDigits) !== -1) {
        score = Math.max(score, 600);
      }
      if (score > 0 && m && m.workspaceStaff) score += 20;
      return score;
    }

    function searchMates(query) {
      var q = norm(query);
      var ranked = mates
        .map(function (m, index) {
          return { m: m, index: index, score: scoreMate(m, q) };
        })
        .filter(function (row) {
          return q ? row.score > 0 : true;
        })
        .sort(function (a, b) {
          if (!!a.m.workspaceStaff !== !!b.m.workspaceStaff) return a.m.workspaceStaff ? -1 : 1;
          return b.score - a.score || a.index - b.index;
        });
      return ranked.slice(0, 40).map(function (row) {
        return row.m;
      });
    }

    function syncSubmit() {
      var picked = !!String(hidden.value || '').trim();
      if (submitBtn) submitBtn.disabled = !picked;
    }

    function syncMode() {
      var picked = !!String(hidden.value || '').trim();
      if (searchWrap) searchWrap.hidden = picked;
      if (selectedWrap) selectedWrap.hidden = !picked;
      syncSubmit();
    }

    function showSelected(m) {
      if (!m) return;
      if (selectedName) selectedName.textContent = m.label || 'Teammate';
      if (selectedMeta) selectedMeta.textContent = metaLine(m);
      if (selectedAvatar) {
        selectedAvatar.textContent = String(m.label || '?').charAt(0).toUpperCase();
      }
    }

    function clearPick() {
      hidden.value = '';
      active = -1;
      input.value = '';
      syncMode();
    }

    function closeList() {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      active = -1;
      list.style.maxHeight = '';
    }

    function fitListHeight() {
      if (list.hidden) {
        list.style.maxHeight = '';
        return;
      }
      var vv = window.visualViewport;
      var viewH = vv && vv.height ? vv.height : window.innerHeight;
      var viewBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
      var shell = list.closest('.ma-shell') || list.closest('[data-ma-scroll-root]') || null;
      var shellBottom = shell ? shell.getBoundingClientRect().bottom : viewBottom;
      var bottom = Math.min(viewBottom, shellBottom);
      var top = list.getBoundingClientRect().top;
      var available = Math.floor(bottom - top - 12);
      var cap = Math.min(280, Math.floor(viewH * 0.5));
      var h = Math.max(72, Math.min(cap, available > 0 ? available : 72));
      list.style.maxHeight = h + 'px';
    }

    function openList() {
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      fitListHeight();
      try {
        list.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      } catch (err) { /* ignore */ }
    }

    function setActive(idx) {
      active = idx;
      var items = list.querySelectorAll('.ma-typeahead__item');
      for (var i = 0; i < items.length; i++) {
        var on = i === active;
        items[i].classList.toggle('is-active', on);
        if (on) {
          try {
            items[i].scrollIntoView({ block: 'nearest', inline: 'nearest' });
          } catch (err) { /* ignore */ }
        }
      }
    }

    function render(query) {
      shown = searchMates(query);
      var html = '';
      var q = String(query || '').trim();
      if (!shown.length) {
        html = '<li class="ma-typeahead__empty" role="presentation">' +
          (q ? 'No matches for “' + esc(q) + '”' : 'No teammates or partners yet') +
          '</li>';
      } else {
        var lastGroup = '';
        shown.forEach(function (m, i) {
          var group = m.workspaceStaff ? 'Workspace team' : 'Network partners';
          if (group !== lastGroup) {
            html += '<li class="ma-typeahead__empty" role="presentation" style="font-weight:800;color:var(--ink)">' +
              esc(group) + '</li>';
            lastGroup = group;
          }
          var disabled = !m.canNotify;
          html += '<li class="ma-typeahead__item' + (disabled ? ' is-off' : '') + '" role="option" data-id="' +
            esc(m.id) + '" data-idx="' + i + '"' + (disabled ? ' aria-disabled="true"' : '') + '>' +
            esc(displayLine(m)) +
            (disabled ? ' <span class="ma-label__hint">(add phone/email)</span>' : '') +
            '</li>';
        });
      }
      list.innerHTML = html;
      openList();
      setActive(-1);
    }

    function pickByEl(el) {
      if (!el) return;
      if (el.getAttribute('aria-disabled') === 'true') return;
      var id = el.getAttribute('data-id') || '';
      var idx = parseInt(el.getAttribute('data-idx'), 10);
      if (!id) return;
      var m = shown[idx] || mates.find(function (row) { return row.id === id; });
      if (!m || !m.canNotify) return;
      hidden.value = m.id;
      showSelected(m);
      input.value = '';
      closeList();
      syncMode();
      try { input.blur(); } catch (err) { /* ignore */ }
    }

    syncMode();

    function onViewportChange() {
      if (!list.hidden) fitListHeight();
    }
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', onViewportChange);
      window.visualViewport.addEventListener('scroll', onViewportChange);
    }
    window.addEventListener('resize', onViewportChange);

    input.addEventListener('focus', function () {
      render(input.value);
      try {
        input.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      } catch (err) { /* ignore */ }
    });
    input.addEventListener('input', function () {
      render(input.value);
    });
    input.addEventListener('keydown', function (e) {
      var items = list.querySelectorAll('.ma-typeahead__item:not([aria-disabled="true"])');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (list.hidden) render(input.value);
        items = list.querySelectorAll('.ma-typeahead__item:not([aria-disabled="true"])');
        var next = -1;
        if (active < 0) next = 0;
        else {
          for (var i = 0; i < items.length; i++) {
            if (items[i].classList.contains('is-active')) {
              next = Math.min(items.length - 1, i + 1);
              break;
            }
          }
          if (next < 0) next = 0;
        }
        setActive(Array.prototype.indexOf.call(list.querySelectorAll('.ma-typeahead__item'), items[next]));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        items = list.querySelectorAll('.ma-typeahead__item:not([aria-disabled="true"])');
        var cur = -1;
        for (var j = 0; j < items.length; j++) {
          if (items[j].classList.contains('is-active')) { cur = j; break; }
        }
        var prev = Math.max(0, cur - 1);
        if (items[prev]) {
          setActive(Array.prototype.indexOf.call(list.querySelectorAll('.ma-typeahead__item'), items[prev]));
        }
      } else if (e.key === 'Enter') {
        var all = list.querySelectorAll('.ma-typeahead__item');
        if (!list.hidden && active >= 0 && all[active]) {
          e.preventDefault();
          pickByEl(all[active]);
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
    list.addEventListener('pointerdown', onPickEvent);
    list.addEventListener('mousedown', onPickEvent);
    list.addEventListener('click', onPickEvent);

    if (clearBtn) {
      clearBtn.addEventListener('click', function (e) {
        e.preventDefault();
        clearPick();
        if (input) input.focus();
      });
    }

    if (form) {
      form.addEventListener('submit', function (e) {
        if (!String(hidden.value || '').trim()) {
          e.preventDefault();
          if (searchWrap) searchWrap.hidden = false;
          if (selectedWrap) selectedWrap.hidden = true;
          syncSubmit();
          if (input) {
            input.focus();
            render(input.value);
          }
        }
      });
    }

    document.addEventListener('click', function (e) {
      if (!root.contains(e.target)) closeList();
    });

    root.setAttribute('data-ma-ready', '1');
  }

  function bootCustomerPicks() {
    document.querySelectorAll('[data-ma-customer-pick]').forEach(initCustomerPick);
    document.querySelectorAll('[data-ma-customer-list-search]').forEach(initCustomerListSearch);
    document.querySelectorAll('[data-ma-tag-pick]').forEach(initTagPick);
    document.querySelectorAll('[data-ma-share-mate-pick]').forEach(initShareMatePick);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootCustomerPicks);
  } else {
    bootCustomerPicks();
  }

  /** Light / dark / system — White-label default wins until Profile pins a newer choice. */
  var THEME_KEY = 'ma-theme';
  var THEME_PIN_KEY = 'ma-theme-pinned';
  var THEME_PIN_AT_KEY = 'ma-theme-pinned-at';
  var themeMql = null;

  function workspaceThemePref() {
    var raw = document.documentElement.getAttribute('data-ma-workspace-theme') || 'system';
    return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
  }

  function workspaceThemeAt() {
    return String(document.documentElement.getAttribute('data-ma-workspace-theme-at') || '');
  }

  function themePinValid(stored) {
    if (!(stored === 'light' || stored === 'dark' || stored === 'system')) return false;
    var pinned = false;
    var pinnedAt = '';
    try {
      pinned = localStorage.getItem(THEME_PIN_KEY) === '1';
      pinnedAt = String(localStorage.getItem(THEME_PIN_AT_KEY) || '');
    } catch (e) { return false; }
    if (!pinned) return false;
    var ws = workspaceThemePref();
    if (ws === 'light' || ws === 'dark') {
      var at = workspaceThemeAt();
      return !!(at && pinnedAt && Number(pinnedAt) >= Number(at));
    }
    return true;
  }

  function readThemePref() {
    var ws = workspaceThemePref();
    var stored = null;
    try { stored = localStorage.getItem(THEME_KEY); } catch (e) { /* private mode */ }
    if (themePinValid(stored)) return stored;
    if (ws === 'light' || ws === 'dark') return ws;
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
    return 'system';
  }

  function resolveTheme(pref) {
    if (pref === 'light' || pref === 'dark') return pref;
    try {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
    } catch (e) { /* ignore */ }
    return 'light';
  }

  function syncThemeChrome(theme) {
    var meta = document.getElementById('maThemeColor');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#1c1c1e' : '#ffffff');
    var status = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (status) status.setAttribute('content', theme === 'dark' ? 'black' : 'default');
  }

  function syncThemeSeg(pref) {
    var seg = document.querySelector('[data-ma-theme-seg]');
    if (!seg) return;
    var buttons = seg.querySelectorAll('[data-ma-theme-set]');
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      var on = btn.getAttribute('data-ma-theme-set') === pref;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  function applyMaTheme(pref, persist) {
    var next = pref === 'light' || pref === 'dark' ? pref : 'system';
    if (persist) {
      try {
        localStorage.setItem(THEME_KEY, next);
        localStorage.setItem(THEME_PIN_KEY, '1');
        localStorage.setItem(THEME_PIN_AT_KEY, String(Date.now()));
      } catch (e) { /* private mode */ }
    } else {
      // Keep localStorage aligned with White-label when no fresher Profile pin exists.
      var ws = workspaceThemePref();
      var stored = null;
      try { stored = localStorage.getItem(THEME_KEY); } catch (e0) { /* ignore */ }
      if ((ws === 'light' || ws === 'dark') && !themePinValid(stored)) {
        try {
          localStorage.setItem(THEME_KEY, ws);
          localStorage.removeItem(THEME_PIN_KEY);
          localStorage.removeItem(THEME_PIN_AT_KEY);
        } catch (e2) { /* ignore */ }
        next = ws;
      }
    }
    var theme = resolveTheme(next);
    document.documentElement.setAttribute('data-ma-theme', theme);
    document.documentElement.setAttribute('data-ma-theme-pref', next);
    syncThemeChrome(theme);
    syncThemeSeg(next);
    bindSystemThemeListener(next);
  }

  function bindSystemThemeListener(pref) {
    if (!window.matchMedia) return;
    if (!themeMql) {
      themeMql = window.matchMedia('(prefers-color-scheme: dark)');
      var onChange = function () {
        if (readThemePref() === 'system') applyMaTheme('system', false);
      };
      if (typeof themeMql.addEventListener === 'function') themeMql.addEventListener('change', onChange);
      else if (typeof themeMql.addListener === 'function') themeMql.addListener(onChange);
    }
    void pref;
  }

  function initMaTheme() {
    applyMaTheme(readThemePref(), false);
    var seg = document.querySelector('[data-ma-theme-seg]');
    if (!seg) return;
    seg.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-ma-theme-set]');
      if (!btn || !seg.contains(btn)) return;
      e.preventDefault();
      applyMaTheme(btn.getAttribute('data-ma-theme-set') || 'system', true);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMaTheme);
  } else {
    initMaTheme();
  }

  function bootKeywordShareSync() {
    if (!document.getElementById('maRequestReviewPayload')) return;
    syncShareKeywordPayload();
    document.addEventListener('input', function (e) {
      if (!e.target) return;
      var id = e.target.id || '';
      if (
        id === 'rvKeywordJob' || id === 'rvKeywordCity' || id === 'rvKeywords' ||
        id === 'rvAskKeywordJob' || id === 'rvAskKeywordCity' || id === 'rvAskKeywords' ||
        id === 'rvSmsScript'
      ) {
        syncShareKeywordPayload();
      }
    });
    window.addEventListener('pageshow', syncShareKeywordPayload);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootKeywordShareSync);
  } else {
    bootKeywordShareSync();
  }

  /** Customer profile: load GHL calls & texts after paint so open isn't blocked. */
  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatGhlAgo(at) {
    var when = at ? new Date(at) : null;
    if (!when || isNaN(when.getTime())) return '';
    var mins = Math.max(0, Math.round((Date.now() - when.getTime()) / 60000));
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    return Math.round(hrs / 24) + 'd ago';
  }

  var GHL_FEED_PREVIEW = 2;

  function ghlFeedItemHtml(m) {
    var ago = formatGhlAgo(m.at);
    var dir = m.direction === 'inbound' ? 'In' : 'Out';
    var html =
      '<li class="ma-ghl-feed__item ma-ghl-feed__item--' + escHtml(m.kind || 'sms') +
      ' ma-ghl-feed__item--' + escHtml(m.direction || 'inbound') + '">' +
      '<div class="ma-ghl-feed__meta"><strong>' + escHtml(m.title || '') + '</strong>' +
      '<span>' + dir + (ago ? ' · ' + ago : '') + '</span></div>';
    if (m.kind === 'sms' && m.body) {
      html += '<p class="ma-ghl-feed__body">' + escHtml(m.body) + '</p>';
    }
    if (m.openHref) {
      html +=
        '<a class="ma-ghl-feed__open" href="' + escHtml(m.openHref) +
        '" target="_blank" rel="noopener noreferrer">' +
        (m.kind === 'call' ? 'Open in LC' : 'Reply in LC') +
        '</a>';
    }
    return html + '</li>';
  }

  function renderGhlActivity(section, payload) {
    var body = section.querySelector('[data-ma-ghl-activity-body]');
    var open = section.querySelector('[data-ma-ghl-open]');
    if (!body) return;
    var items = payload && Array.isArray(payload.items) ? payload.items : [];
    var openHref = payload && payload.openHref ? String(payload.openHref) : '';
    var err = payload && payload.error ? String(payload.error) : '';
    if (open) {
      if (openHref) {
        open.href = openHref;
        open.hidden = false;
      } else {
        open.hidden = true;
      }
    }
    if (err && !items.length) {
      body.innerHTML = '<p class="ma-hint" style="margin:0">' + escHtml(err) + '</p>';
      return;
    }
    if (!items.length) {
      body.innerHTML = '<p class="ma-hint" style="margin:0">No calls or texts in GHL for this contact yet.</p>';
      return;
    }
    var preview = Math.min(GHL_FEED_PREVIEW, items.length);
    var rest = items.length - preview;
    var html = '<ul class="ma-ghl-feed" aria-label="GHL calls and texts" data-ma-ghl-feed>';
    items.forEach(function (m, i) {
      var row = ghlFeedItemHtml(m);
      if (i >= preview) {
        row = row.replace(
          'class="ma-ghl-feed__item',
          'class="ma-ghl-feed__item ma-ghl-feed__item--more" hidden',
        );
      }
      html += row;
    });
    html += '</ul>';
    if (rest > 0) {
      html +=
        '<button type="button" class="ma-ghl-feed__more" data-ma-ghl-feed-more>' +
        'More · ' + rest + ' older</button>';
    }
    body.innerHTML = html;
    bindGhlFeedMore(body);
  }

  function bindGhlFeedMore(root) {
    var scope = root || document;
    var moreBtn = scope.querySelector('[data-ma-ghl-feed-more]');
    if (!moreBtn || moreBtn.getAttribute('data-bound') === '1') return;
    moreBtn.setAttribute('data-bound', '1');
    moreBtn.addEventListener('click', function () {
      var body = moreBtn.closest('[data-ma-ghl-activity-body]') || moreBtn.parentElement;
      var feed = body && body.querySelector('[data-ma-ghl-feed]');
      if (!feed) return;
      feed.querySelectorAll('.ma-ghl-feed__item--more').forEach(function (el) {
        el.hidden = false;
        el.classList.remove('ma-ghl-feed__item--more');
      });
      moreBtn.remove();
    });
  }

  function bootGhlActivity() {
    var section = document.getElementById('maCustomerGhlActivity');
    if (!section) return;
    bindGhlFeedMore(section);
    var url = section.getAttribute('data-ma-ghl-activity-url');
    if (!url) return;
    fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) {
        return r.json().catch(function () {
          return {};
        });
      })
      .then(function (data) {
        if (!data || data.success === false) {
          renderGhlActivity(section, {
            items: [],
            error: (data && data.error) || 'Could not load calls & texts from GHL.',
          });
          return;
        }
        renderGhlActivity(section, data.activity || data);
      })
      .catch(function () {
        renderGhlActivity(section, {
          items: [],
          error: 'Could not load calls & texts from GHL.',
        });
      });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootGhlActivity);
  } else {
    bootGhlActivity();
  }

  /** Speech-to-text on job / customer / photo fields (Reviews + paid partner apps). */
  function voiceEndpoint() {
    if (typeof window.__maVoiceEndpoint === 'string' && window.__maVoiceEndpoint) {
      return window.__maVoiceEndpoint;
    }
    var path = String(window.location.pathname || '');
    var m = path.match(/^(\/m\/[^/]+)/);
    return m ? m[1] + '/voice/transcribe' : '';
  }

  function attachMaVoiceButtons(root) {
    if (!window.AlexVoice || typeof window.AlexVoice.attach !== 'function') return;
    var endpoint = voiceEndpoint();
    if (!endpoint) return;
    var scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('[data-ma-voice-for]').forEach(function (btn) {
      if (btn.__alexVoice) return;
      var id = btn.getAttribute('data-ma-voice-for');
      var input = id ? document.getElementById(id) : null;
      if (!input) return;
      window.AlexVoice.attach({
        button: btn,
        input: input,
        endpoint: endpoint,
        hideIfUnsupported: false,
      });
    });
  }

  function bootMaVoiceDictate() {
    attachMaVoiceButtons(document);
  }

  if (window.AlexVoice) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bootMaVoiceDictate);
    } else {
      bootMaVoiceDictate();
    }
  } else {
    document.addEventListener('alexvoice:ready', bootMaVoiceDictate);
  }

  // Photo sheets open later — re-scan when a modal becomes visible.
  document.addEventListener(
    'click',
    function (e) {
      var openBtn =
        e.target && e.target.closest
          ? e.target.closest('[data-ma-photo-open], [data-ma-photo-note-open]')
          : null;
      if (!openBtn) return;
      setTimeout(function () {
        attachMaVoiceButtons(document);
      }, 0);
    },
    true
  );

  window.__maAttachVoiceButtons = attachMaVoiceButtons;

  /**
   * iOS Contact Autofill can replace/erase digits in a phone field while you type
   * (especially when Name matches a contact). Re-apply the key when that happens.
   */
  function guardPhoneTyping(input) {
    if (!input || input.getAttribute('data-ma-phone-guard-ready') === '1') return;
    input.setAttribute('data-ma-phone-guard-ready', '1');
    var last = String(input.value || '');
    var pending = null;

    input.addEventListener('keydown', function (e) {
      if (e.isComposing || e.key === 'Process') return;
      if (e.ctrlKey || e.metaKey || e.altKey) {
        pending = null;
        return;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        pending = { kind: 'delete' };
        return;
      }
      if (e.key && e.key.length === 1) {
        var start = input.selectionStart;
        var end = input.selectionEnd;
        var hasSel = typeof start === 'number' && typeof end === 'number' && end > start;
        // Only guard plain append typing (caret at end, no selection).
        var atEnd = typeof start === 'number' && start === String(input.value || '').length;
        pending = { kind: 'insert', ch: e.key, guard: !hasSel && atEnd };
        return;
      }
      pending = null;
    });

    input.addEventListener('input', function () {
      var v = String(input.value || '');
      if (pending && pending.kind === 'insert' && pending.guard) {
        // Autofill wiped or replaced the field instead of appending the key.
        var expected = last + pending.ch;
        if (v !== expected && (v.length < expected.length || v.indexOf(last) !== 0)) {
          var max = input.maxLength > 0 ? input.maxLength : 40;
          if (expected.length <= max) {
            input.value = expected;
            v = expected;
            try {
              input.setSelectionRange(v.length, v.length);
            } catch (_) { /* ignore */ }
          }
        }
      }
      last = String(input.value || '');
      pending = null;
    });

    input.addEventListener('focus', function () {
      last = String(input.value || '');
    });
  }

  /** Speak-once → parse → confirm → create on New customer. */
  function bootSpeakAddCustomer() {
    var form = document.querySelector('[data-ma-voice-customer-form="1"]');
    var wrap = document.getElementById('maVoiceAddCustomer');
    var btn = document.getElementById('maVoiceAddCustomerBtn');
    var capture = document.getElementById('maVoiceAddCustomerCapture');
    var statusEl = document.getElementById('maVoiceAddCustomerStatus');
    var sheet = document.getElementById('maVoiceCustomerConfirm');
    var preview = document.getElementById('maVoiceCustomerPreview');
    var warningEl = document.getElementById('maVoiceCustomerConfirmWarning');
    var createBtn = document.getElementById('maVoiceCustomerCreateBtn');
    // Phone guard runs even when voice UI is absent (edit customer).
    document.querySelectorAll('[data-ma-phone-guard="1"]').forEach(guardPhoneTyping);
    if (!form || !wrap || !btn || !capture) return;

    var parseUrl = voiceEndpoint().replace(/\/voice\/transcribe$/, '/voice/parse-customer');
    var parsing = false;
    var lastTranscript = '';
    var parseGeneration = 0;
    var parseAbort = null;
    var applyingVoice = false;
    /** Fields the user typed after the last mic start — never overwrite those. */
    var dirtyFields = Object.create(null);
    var FIELD_KEYS = ['name', 'phone', 'email', 'address', 'notes'];

    function setStatus(msg, isError) {
      if (!statusEl) return;
      var text = String(msg || '').trim();
      statusEl.textContent = text;
      statusEl.hidden = !text;
      statusEl.style.color = isError ? '#b91c1c' : '';
      wrap.classList.toggle('is-listening', /listening/i.test(text) && !isError);
      wrap.classList.toggle('is-busy', /transcrib|filling/i.test(text) && !isError);
    }

    function markDirty(name) {
      if (applyingVoice) return;
      if (FIELD_KEYS.indexOf(name) === -1) return;
      dirtyFields[name] = true;
      // Typing while a parse is in flight: drop that result so it can’t wipe digits.
      if (parsing && parseAbort) {
        try { parseAbort.abort(); } catch (_) { /* ignore */ }
        parseAbort = null;
        parsing = false;
        parseGeneration += 1;
        setStatus('Keep typing — voice fill canceled so it won’t erase what you enter.');
        wrap.classList.remove('is-listening', 'is-busy');
      } else if (parsing) {
        parseGeneration += 1;
        parsing = false;
      }
    }

    form.addEventListener('input', function (e) {
      var t = e.target;
      if (!t || t === capture) return;
      if (t.name) markDirty(t.name);
    });

    function fillForm(fields) {
      fields = fields || {};
      applyingVoice = true;
      try {
        FIELD_KEYS.forEach(function (key) {
          if (dirtyFields[key]) return;
          var input = form.querySelector('[name="' + key + '"]');
          if (!input) return;
          // Don’t fight the field the user is actively typing in.
          if (document.activeElement === input) {
            dirtyFields[key] = true;
            return;
          }
          var next = fields[key] != null ? String(fields[key]) : '';
          var cur = String(input.value || '');
          // Never clear a typed value with a blank parse result (common when
          // speech only caught the name and the phone parse arrives late).
          if (!next.trim() && cur.trim()) return;
          if (next === cur) return;
          input.value = next;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        });
      } finally {
        applyingVoice = false;
      }
    }

    function showPreview(fields, warning) {
      fields = fields || {};
      if (preview) {
        preview.querySelectorAll('[data-field]').forEach(function (dd) {
          var key = dd.getAttribute('data-field');
          var val = String(fields[key] || '').trim();
          dd.textContent = val || '—';
          dd.classList.toggle('is-empty', !val);
        });
      }
      if (warningEl) {
        if (warning) {
          warningEl.hidden = false;
          warningEl.textContent = warning;
        } else {
          warningEl.hidden = true;
          warningEl.textContent = '';
        }
      }
      if (createBtn) createBtn.disabled = !String(fields.name || '').trim();
      if (sheet) {
        sheet.hidden = false;
        try {
          sheet.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } catch (_) {}
      }
    }

    function closeSheet() {
      if (sheet) sheet.hidden = true;
    }

    function currentFields() {
      return {
        name: (form.querySelector('[name="name"]') || {}).value,
        phone: (form.querySelector('[name="phone"]') || {}).value,
        email: (form.querySelector('[name="email"]') || {}).value,
        address: (form.querySelector('[name="address"]') || {}).value,
        notes: (form.querySelector('[name="notes"]') || {}).value,
      };
    }

    function parseTranscript(text) {
      var cleaned = String(text || '').trim();
      if (!cleaned || parsing) return;
      if (cleaned === lastTranscript) {
        showPreview(currentFields(), '');
        return;
      }
      parsing = true;
      lastTranscript = cleaned;
      var gen = ++parseGeneration;
      if (parseAbort) {
        try { parseAbort.abort(); } catch (_) { /* ignore */ }
      }
      parseAbort = typeof AbortController !== 'undefined' ? new AbortController() : null;
      setStatus('Filling the form from what you said…');
      fetch(parseUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ text: cleaned }),
        signal: parseAbort ? parseAbort.signal : undefined,
      })
        .then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (d) {
            d.__status = r.status;
            return d;
          });
        })
        .then(function (d) {
          if (gen !== parseGeneration) return;
          if (!d || !d.success || !d.fields) {
            setStatus((d && d.error) || 'Could not understand that. Try again.', true);
            return;
          }
          fillForm(d.fields);
          setStatus('Check the details, then confirm.');
          showPreview(currentFields(), d.warning || '');
        })
        .catch(function (err) {
          if (err && err.name === 'AbortError') return;
          if (gen !== parseGeneration) return;
          setStatus('Connection error. Check your internet and try again.', true);
        })
        .finally(function () {
          if (gen === parseGeneration) {
            parsing = false;
            parseAbort = null;
          }
        });
    }

    function attachSpeakAll() {
      if (!window.AlexVoice || typeof window.AlexVoice.attach !== 'function') return;
      if (btn.__alexVoice) return;
      var endpoint = voiceEndpoint();
      if (!endpoint) return;
      // Clear capture before AlexVoice snapshots liveBase / starts recording.
      // Optimistic listening UI so the mic shows it’s working on the first tap.
      btn.addEventListener(
        'click',
        function () {
          if (btn.getAttribute('aria-pressed') === 'true') return;
          if (btn.getAttribute('data-state') === 'transcribing') return;
          capture.value = '';
          lastTranscript = '';
          dirtyFields = Object.create(null);
          parseGeneration += 1;
          if (parseAbort) {
            try { parseAbort.abort(); } catch (_) { /* ignore */ }
            parseAbort = null;
          }
          parsing = false;
          btn.setAttribute('data-state', 'listening');
          btn.setAttribute('aria-pressed', 'true');
          setStatus('Listening — tap the mic again when you’re done.');
        },
        true
      );
      window.AlexVoice.attach({
        button: btn,
        input: capture,
        endpoint: endpoint,
        hideIfUnsupported: false,
        preventFocus: true,
        onUnsupported: function (msg) {
          setStatus(msg || 'Voice isn’t available here. Type the details instead.', true);
        },
        onState: function (state, detail) {
          if (state === 'unsupported') {
            setStatus(detail || 'Voice isn’t available here. Type the details instead.', true);
          } else if (state === 'listening') {
            setStatus('Listening — tap the mic again when you’re done.');
          } else if (state === 'transcribing') {
            setStatus('Transcribing…');
          } else if (state === 'idle' && !parsing) {
            wrap.classList.remove('is-listening', 'is-busy');
            /* keep last status until parse finishes or errors */
          } else if (state === 'error') {
            wrap.classList.remove('is-listening', 'is-busy');
            setStatus((detail && detail.message) || 'Could not start the mic. Try again.', true);
          }
        },
        onCommit: function (text) {
          parseTranscript(text);
        },
      });
    }

    if (window.AlexVoice) attachSpeakAll();
    else document.addEventListener('alexvoice:ready', attachSpeakAll);

    document.querySelectorAll('[data-ma-voice-customer-edit]').forEach(function (el) {
      el.addEventListener('click', function () {
        closeSheet();
        setStatus('Form is filled — edit anything, then tap Add customer.');
        var nameInput = form.querySelector('#cuName');
        if (nameInput) {
          try { nameInput.focus({ preventScroll: false }); } catch (_) { nameInput.focus(); }
        }
      });
    });

    if (createBtn) {
      createBtn.addEventListener('click', function () {
        var nameInput = form.querySelector('[name="name"]');
        if (!nameInput || !String(nameInput.value || '').trim()) {
          setStatus('Add a name before creating.', true);
          closeSheet();
          if (nameInput) nameInput.focus();
          return;
        }
        closeSheet();
        if (typeof form.requestSubmit === 'function') form.requestSubmit();
        else form.submit();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootSpeakAddCustomer);
  } else {
    bootSpeakAddCustomer();
  }
})();

/* Pull-to-refresh: drag down at top of .ma-shell → spinning refresh icon → reload. */
(function () {
  function bootPullToRefresh() {
    var shell = document.querySelector('main.ma-shell');
    if (!shell) return;
    if (document.documentElement.classList.contains('ma-preview')) return;
    if (window.matchMedia && window.matchMedia('(pointer: fine)').matches && !('ontouchstart' in window)) {
      /* Desktop mouse: still allow if coarse/touch exists; skip pure mouse desktops. */
      if (!('ontouchstart' in window) && !(navigator.maxTouchPoints > 0)) return;
    }

    var THRESHOLD = 70;
    var MAX_PULL = 110;
    var pulling = false;
    var startY = 0;
    var pull = 0;
    var armed = false;
    var refreshing = false;

    var el = document.createElement('div');
    el.id = 'maPtr';
    el.className = 'ma-ptr';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML =
      '<span class="ma-ptr__icon" aria-hidden="true">' +
        '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" width="22" height="22" stroke-width="1.8" stroke="currentColor">' +
          '<path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"/>' +
        '</svg>' +
      '</span>';
    document.body.appendChild(el);

    var icon = el.querySelector('.ma-ptr__icon');

    function blocked() {
      if (refreshing) return true;
      var html = document.documentElement;
      if (html.classList.contains('ma-nav-loading')) return true;
      if (html.classList.contains('ma-lr-open') || html.classList.contains('ma-qr-view-open')) return true;
      if (document.body.classList.contains('ma-lr-open') || document.body.classList.contains('ma-qr-view-open')) return true;
      var ae = document.activeElement;
      if (ae && /^(INPUT|TEXTAREA|SELECT)$/i.test(ae.tagName)) return true;
      return false;
    }

    function atTop() {
      return (shell.scrollTop || 0) <= 0;
    }

    function setPull(px) {
      pull = Math.max(0, Math.min(MAX_PULL, px));
      armed = pull >= THRESHOLD;
      var show = pull > 6;
      el.classList.toggle('is-visible', show || refreshing);
      el.classList.toggle('is-armed', armed && !refreshing);
      el.setAttribute('aria-hidden', show || refreshing ? 'false' : 'true');
      if (icon && !refreshing) {
        var turn = Math.min(360, (pull / THRESHOLD) * 210);
        icon.style.transform = 'rotate(' + turn + 'deg)';
      }
      /* Slight content give so the icon feels attached to the drag. */
      if (!refreshing) {
        shell.style.transform = pull ? 'translateY(' + Math.round(pull * 0.28) + 'px)' : '';
      }
    }

    function resetPull() {
      pull = 0;
      armed = false;
      el.classList.remove('is-visible', 'is-armed');
      el.setAttribute('aria-hidden', 'true');
      if (icon && !refreshing) icon.style.transform = '';
      shell.style.transform = '';
    }

    function triggerRefresh() {
      if (refreshing) return;
      refreshing = true;
      el.classList.add('is-visible', 'is-refreshing');
      el.classList.remove('is-armed');
      el.setAttribute('aria-label', 'Refreshing');
      if (icon) icon.style.transform = '';
      shell.style.transform = 'translateY(18px)';
      if (typeof window.maShowNavLoading === 'function') {
        try { window.maShowNavLoading(); } catch (_) { /* ignore */ }
      }
      setTimeout(function () {
        try {
          window.location.reload();
        } catch (_) {
          window.location.href = window.location.href;
        }
      }, 220);
    }

    shell.addEventListener(
      'touchstart',
      function (e) {
        if (blocked() || !atTop() || !e.touches || e.touches.length !== 1) {
          pulling = false;
          return;
        }
        pulling = true;
        startY = e.touches[0].clientY;
        pull = 0;
      },
      { passive: true }
    );

    shell.addEventListener(
      'touchmove',
      function (e) {
        if (!pulling || blocked() || !e.touches || e.touches.length !== 1) return;
        var dy = e.touches[0].clientY - startY;
        if (!atTop() || dy <= 0) {
          if (pull) resetPull();
          return;
        }
        /* Resist the drag so it feels intentional. */
        var resisted = Math.pow(Math.min(dy, 220), 0.85);
        setPull(resisted);
        if (pull > 8 && e.cancelable) e.preventDefault();
      },
      { passive: false }
    );

    function endPull() {
      if (!pulling) return;
      pulling = false;
      if (armed && !blocked()) triggerRefresh();
      else resetPull();
    }

    shell.addEventListener('touchend', endPull, { passive: true });
    shell.addEventListener('touchcancel', function () {
      pulling = false;
      if (!refreshing) resetPull();
    }, { passive: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootPullToRefresh);
  } else {
    bootPullToRefresh();
  }
})();
