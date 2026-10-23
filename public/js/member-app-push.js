/**
 * Partner-app phone alerts — Web Push for the Reviews /m app.
 * Subscriptions are scoped by network + member (free-app members included).
 */
(function () {
  var root = document.getElementById('maPushRoot');
  if (!root) return;

  var base = root.getAttribute('data-base') || '';
  var ua = navigator.userAgent || '';
  var isIos = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isMobile = isIos || /Android|Mobi/i.test(ua);
  var standalone =
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  var supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  var label = isMobile ? 'phone alerts' : 'desktop alerts';

  function setStatus(text) {
    var el = root.querySelector('[data-ma-push-status]');
    if (el) el.textContent = text || '';
  }

  function setButton(text, mode) {
    var btn = root.querySelector('[data-ma-push-enable]');
    if (!btn) return;
    btn.textContent = text;
    btn.disabled = mode === 'working';
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
    }).then(function (r) {
      return r.json().catch(function () { return {}; });
    });
  }

  function dropWorkspaceWorker() {
    if (!navigator.serviceWorker.getRegistrations) return Promise.resolve();
    return navigator.serviceWorker.getRegistrations().then(function (regs) {
      return Promise.all(
        (regs || []).map(function (reg) {
          var script =
            (reg.active && reg.active.scriptURL) ||
            (reg.waiting && reg.waiting.scriptURL) ||
            (reg.installing && reg.installing.scriptURL) ||
            '';
          try {
            if (new URL(script).pathname === '/sw.js') return reg.unregister();
          } catch (e) {
            /* ignore */
          }
          return null;
        }),
      );
    }).catch(function () {});
  }

  function registration() {
    // Scoped SW under /m/ so Reviews does not share the workspace Agency OS worker
    // (shared /sw.js made Search failed / task alerts land on the Reviews home-screen app).
    return dropWorkspaceWorker().then(function () {
      return navigator.serviceWorker.register('/m/sw.js', { scope: '/m/' });
    });
  }

  function currentSubscription() {
    return registration().then(function (reg) {
      return reg.pushManager.getSubscription();
    });
  }

  function fetchPublicKey() {
    return fetch(base + '/push/key', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.publicKey) throw new Error('No push key');
        return d.publicKey;
      });
  }

  function render(state) {
    var off = root.querySelector('[data-ma-push-off]');
    if (off) off.hidden = true;
    // Hide the whole card once alerts are on — manage from the bell panel instead.
    if (state === 'on' || state === 'unsupported') {
      root.hidden = true;
      return;
    }
    root.hidden = false;
    if (state === 'install') {
      setButton('Add to Home Screen first', 'install');
      setStatus('On iPhone: Share → Add to Home Screen, open this app from your home screen, then turn alerts on.');
    } else if (state === 'denied') {
      setButton('Notifications blocked', 'denied');
      setStatus('Allow notifications for this site in your browser settings, then try again.');
    } else {
      setButton('Turn on ' + label, 'off');
      setStatus('Turn on ' + label + ' for agency messages, leads, and referrals.');
    }
  }

  function enable() {
    setButton('Working…', 'working');
    return Notification.requestPermission()
      .then(function (perm) {
        if (perm !== 'granted') {
          render('denied');
          throw new Error('denied');
        }
        return fetchPublicKey();
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
        render('on');
        try {
          window.dispatchEvent(new CustomEvent('ma-push-enabled'));
        } catch (_) { /* ignore */ }
        return post('/push/test', {});
      })
      .catch(function (err) {
        if (err && err.message === 'denied') return;
        setStatus(err.message || 'Could not turn on alerts.');
        render('off');
      });
  }

  function disable() {
    return currentSubscription()
      .then(function (sub) {
        if (!sub) return { success: true };
        return post('/push/unsubscribe', { endpoint: sub.endpoint }).then(function () {
          return sub.unsubscribe();
        });
      })
      .then(function () { render('off'); })
      .catch(function () { render('off'); });
  }

  var enableBtn = root.querySelector('[data-ma-push-enable]');
  var offBtn = root.querySelector('[data-ma-push-off]');
  if (enableBtn) {
    enableBtn.addEventListener('click', function () {
      if (enableBtn.dataset.state === 'install') return;
      if (enableBtn.dataset.state === 'on') return;
      enable();
    });
  }
  if (offBtn) offBtn.addEventListener('click', disable);

  if (!supported) {
    render('unsupported');
    return;
  }
  if (isIos && !standalone) {
    render('install');
    return;
  }
  if (Notification.permission === 'denied') {
    render('denied');
    return;
  }
  currentSubscription()
    .then(function (sub) { render(sub ? 'on' : 'off'); })
    .catch(function () { render('off'); });
})();
