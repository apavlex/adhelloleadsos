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

  /** Take photo / Choose from library sheet (customer + job pages). */
  function initPhotoCapture(root) {
    if (!root || root.getAttribute('data-ma-ready') === '1') return;
    var sheet = root.querySelector('[data-ma-photo-sheet]');
    var form = root.querySelector('form.ma-photo-form');
    var file = root.querySelector('input[type="file"][name="photo"]');
    if (!sheet || !form || !file) return;

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

    root.querySelectorAll('[data-ma-photo-open]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
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

    var input = root.querySelector('input[role="combobox"], input[type="search"], input.ma-input');
    var hidden = root.querySelector('input[type="hidden"][name="customerId"]');
    var list = root.querySelector('[role="listbox"]');
    var dataEl = root.querySelector('script[type="application/json"]');
    var searchWrap = root.querySelector('[data-ma-ask-search]');
    var selectedWrap = root.querySelector('[data-ma-ask-selected]');
    var selectedName = root.querySelector('[data-ma-ask-selected-name]');
    var selectedMeta = root.querySelector('[data-ma-ask-selected-meta]');
    var selectedAvatar = root.querySelector('[data-ma-ask-selected-avatar]');
    var clearBtn = root.querySelector('[data-ma-ask-clear]');
    var manualWrap = document.querySelector('[data-ma-ask-manual]');
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
      if (phone) phone.value = c.phone || '';
      if (email) email.value = c.email || '';
    }

    function syncMode() {
      var picked = !!String(hidden.value || '').trim();
      if (searchWrap) searchWrap.hidden = picked;
      if (selectedWrap) selectedWrap.hidden = !picked;
      if (manualWrap) manualWrap.hidden = picked;
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
      if (!keepManual) {
        if (name) name.value = '';
        if (phone) phone.value = '';
        if (email) email.value = '';
      }
      syncMode();
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
        (q ? 'Use “' + esc(q) + '” as a new person' : 'Or enter a new person below…') + '</li>';
      shown.forEach(function (c, i) {
        html += '<li class="ma-typeahead__item" role="option" data-id="' + esc(c.id) + '" data-idx="' + i + '">' +
          esc(labelFor(c)) + '</li>';
      });
      if (q && !shown.length) {
        html += '<li class="ma-typeahead__empty" role="presentation">No saved matches — enter them as new below</li>';
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

  function bootCustomerPicks() {
    document.querySelectorAll('[data-ma-customer-pick]').forEach(initCustomerPick);
    document.querySelectorAll('[data-ma-customer-list-search]').forEach(initCustomerListSearch);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootCustomerPicks);
  } else {
    bootCustomerPicks();
  }
})();
