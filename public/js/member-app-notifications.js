/**
 * Member-app lead bell — activity feed + phone/home-screen alert on/off
 * (same idea as the workspace navbar notifications, scoped to active leads).
 */
(function () {
  var root = document.getElementById('maBellRoot');
  if (!root) return;

  var base = root.getAttribute('data-base') || '';
  var pushOk = root.getAttribute('data-push') === '1';
  var panel = document.getElementById('maBellPanel');
  var scrim = root.querySelector('[data-ma-bell-scrim]');
  var openBtn = root.querySelector('[data-ma-bell-open]');
  var closeBtn = root.querySelector('[data-ma-bell-close]');
  var listEl = root.querySelector('[data-ma-bell-list]');
  var ping = root.querySelector('[data-ma-bell-ping]');
  var pushRow = root.querySelector('[data-ma-bell-push]');
  var pushEnable = root.querySelector('[data-ma-bell-push-enable]');
  var pushOff = root.querySelector('[data-ma-bell-push-off]');
  var pushStatus = root.querySelector('[data-ma-bell-push-status]');

  var ua = navigator.userAgent || '';
  var isIos = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isMobile = isIos || /Android|Mobi/i.test(ua);
  var standalone =
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  var supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  var label = isMobile ? 'phone alerts' : 'desktop alerts';

  function setOpen(on) {
    if (!panel || !openBtn) return;
    panel.hidden = !on;
    if (scrim) scrim.hidden = !on;
    openBtn.setAttribute('aria-expanded', on ? 'true' : 'false');
    document.body.classList.toggle('ma-bell-open', !!on);
    if (on) {
      loadFeed();
      markAllRead();
    }
  }

  function setPing(n) {
    if (!ping) return;
    ping.hidden = !(n > 0);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function kindLabel(kind) {
    if (kind === 'referral') return 'Referral';
    if (kind === 'pool') return 'Pool';
    if (kind === 'agency') return 'Agency lead';
    if (kind === 'form') return 'Website lead';
    return 'Lead';
  }

  function renderList(items) {
    if (!listEl) return;
    if (!items || !items.length) {
      listEl.innerHTML = '<p class="ma-bell__empty">No new lead alerts</p>';
      return;
    }
    listEl.innerHTML = items.map(function (item) {
      var href = item.href || (base + '/referrals');
      var cls = 'ma-bell__item' + (item.read ? '' : ' is-unread');
      return (
        '<a class="' + cls + '" href="' + esc(href) + '">' +
          '<strong>' + esc(item.title) + '</strong>' +
          (item.body ? '<span>' + esc(item.body) + '</span>' : '') +
          '<small>' + esc(kindLabel(item.kind)) + ' · Open</small>' +
        '</a>'
      );
    }).join('');
  }

  function loadFeed() {
    return fetch(base + '/activity.json', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.success) return;
        setPing(data.unread || 0);
        renderList(data.items || []);
        if (pushRow) {
          pushRow.hidden = !(data.pushAvailable || pushOk);
        }
      })
      .catch(function () { /* ignore */ });
  }

  function markAllRead() {
    return fetch(base + '/activity/read', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ ids: 'all' }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.success) setPing(data.unread || 0);
      })
      .catch(function () { /* ignore */ });
  }

  function keyToBytes(base64) {
    var clean = String(base64 || '').replace(/[\s"'=]/g, '').replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(clean + '==='.slice(0, (4 - (clean.length % 4)) % 4));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
    return out;
  }

  function post(path, body) {
    return fetch(base + path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body || {}),
    }).then(function (r) { return r.json().catch(function () { return {}; }); });
  }

  function registration() {
    return navigator.serviceWorker.register('/sw.js').then(function () {
      return navigator.serviceWorker.ready;
    });
  }

  function currentSubscription() {
    return registration().then(function (reg) {
      return reg.pushManager.getSubscription();
    });
  }

  function setPushStatus(text) {
    if (pushStatus) pushStatus.textContent = text || '';
  }

  function renderPush(state) {
    if (!pushEnable) return;
    if (pushOff) pushOff.hidden = true;
    pushEnable.disabled = false;
    pushEnable.dataset.state = state;
    if (!pushOk) {
      pushEnable.textContent = 'Alerts need a linked lead package';
      pushEnable.disabled = true;
      setPushStatus('Ask your agency to connect appointments so website and agency leads can notify this phone.');
      return;
    }
    if (state === 'install') {
      pushEnable.textContent = 'Add to Home Screen first';
      pushEnable.disabled = true;
      setPushStatus('On iPhone: Share → Add to Home Screen, open this app from your home screen, then turn alerts on.');
    } else if (state === 'unsupported') {
      if (pushRow) pushRow.hidden = true;
    } else if (state === 'denied') {
      pushEnable.textContent = 'Notifications blocked';
      pushEnable.disabled = true;
      setPushStatus('Allow notifications for this site in Settings, then try again.');
    } else if (state === 'on') {
      pushEnable.textContent = (label.charAt(0).toUpperCase() + label.slice(1)) + ' on · Send test';
      setPushStatus('New leads, agency assignments, and referrals arrive on this device, even when the app is closed.');
      if (pushOff) pushOff.hidden = false;
    } else if (state === 'working') {
      pushEnable.textContent = 'Working…';
      pushEnable.disabled = true;
    } else {
      pushEnable.textContent = 'Turn on ' + label;
      setPushStatus('Turn on ' + label + ' for website forms, agency leads, and referrals that need you now.');
    }
  }

  function enablePush() {
    if (!pushOk) return;
    if (pushEnable && pushEnable.dataset.state === 'on') {
      post('/push/test', {}).catch(function () { /* ignore */ });
      return;
    }
    renderPush('working');
    return Notification.requestPermission()
      .then(function (perm) {
        if (perm !== 'granted') {
          renderPush('denied');
          throw new Error('denied');
        }
        return fetch(base + '/push/key', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (!d || !d.publicKey) throw new Error('No push key');
            return d.publicKey;
          });
      })
      .then(function (key) {
        var bytes = keyToBytes(key);
        return registration().then(function (reg) {
          return reg.pushManager.getSubscription().then(function (existing) {
            if (existing) return existing.unsubscribe().then(function () { return reg; });
            return reg;
          });
        }).then(function (reg) {
          return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
        });
      })
      .then(function (sub) {
        return post('/push/subscribe', { subscription: sub.toJSON() });
      })
      .then(function (data) {
        if (!data.success) throw new Error(data.error || 'Subscribe failed');
        renderPush('on');
        return post('/push/test', {});
      })
      .catch(function (err) {
        if (err && err.message === 'denied') return;
        setPushStatus(err.message || 'Could not turn on alerts.');
        renderPush('off');
      });
  }

  function disablePush() {
    return currentSubscription()
      .then(function (sub) {
        if (!sub) return { success: true };
        return post('/push/unsubscribe', { endpoint: sub.endpoint }).then(function () {
          return sub.unsubscribe();
        });
      })
      .then(function () { renderPush('off'); })
      .catch(function () { renderPush('off'); });
  }

  var ignoreOutsideUntil = 0;

  if (openBtn) {
    openBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var willOpen = !!(panel && panel.hidden);
      // Avoid the same gesture closing the panel via the document listener.
      if (willOpen) ignoreOutsideUntil = Date.now() + 400;
      setOpen(willOpen);
    });
  }
  if (closeBtn) closeBtn.addEventListener('click', function () { setOpen(false); });
  if (scrim) {
    scrim.addEventListener('click', function () { setOpen(false); });
  }
  document.addEventListener('click', function (e) {
    if (!panel || panel.hidden) return;
    if (Date.now() < ignoreOutsideUntil) return;
    if (root.contains(e.target)) return;
    setOpen(false);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') setOpen(false);
  });

  if (pushEnable) pushEnable.addEventListener('click', enablePush);
  if (pushOff) pushOff.addEventListener('click', disablePush);

  // Initial badge + push state
  loadFeed();
  if (!supported) {
    renderPush('unsupported');
  } else if (!pushOk) {
    renderPush('off');
  } else if (isIos && !standalone) {
    renderPush('install');
  } else if (Notification.permission === 'denied') {
    renderPush('denied');
  } else {
    currentSubscription()
      .then(function (sub) { renderPush(sub ? 'on' : 'off'); })
      .catch(function () { renderPush('off'); });
  }
})();
