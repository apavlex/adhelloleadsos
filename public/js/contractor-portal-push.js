/**
 * Contractor portal push alerts — same Web Push stack as agency notifications,
 * scoped to this business package (mobile + desktop).
 */
(function () {
  var root = document.getElementById('cpPushRoot');
  if (!root) return;

  var base = root.getAttribute('data-base') || '';
  var ua = navigator.userAgent || '';
  var isIos = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isMobile = isIos || /Android|Mobi/i.test(ua);
  var standalone =
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  var supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  var isOn = false;
  var label = isMobile ? 'phone alerts' : 'desktop alerts';

  function $(sel) {
    return root.querySelector(sel);
  }

  function setStatus(text) {
    var el = root.querySelector('[data-cp-push-status]');
    if (el) el.textContent = text || '';
  }

  function setButton(text, mode) {
    var btn = root.querySelector('[data-cp-push-enable]');
    if (!btn) return;
    btn.textContent = text;
    btn.disabled = mode === 'working';
    btn.dataset.state = mode || 'off';
  }

  function keyToBytes(base64) {
    var clean = String(base64 || '').replace(/[\s"'=]/g, '').replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(clean + '==='.slice(0, (4 - (clean.length % 4)) % 4));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
    return out;
  }

  function sameKey(sub, key) {
    var current = sub && sub.options && sub.options.applicationServerKey;
    if (!current) return true;
    var a = new Uint8Array(current);
    if (a.length !== key.length) return false;
    for (var i = 0; i < a.length; i += 1) if (a[i] !== key[i]) return false;
    return true;
  }

  function post(path, body) {
    return fetch(base + path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body || {}),
    }).then(function (r) {
      return r.json().catch(function () {
        return {};
      });
    });
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

  function fetchPublicKey() {
    return fetch(base + '/push/key', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        if (!d || !d.publicKey) throw new Error('No push key');
        return d.publicKey;
      });
  }

  function render(state) {
    var off = root.querySelector('[data-cp-push-off]');
    if (off) off.hidden = true;
    root.hidden = false;

    if (state === 'install') {
      setButton('Add to Home Screen first', 'install');
      setStatus('On iPhone: Share → Add to Home Screen, open this portal from your home screen, then turn alerts on.');
    } else if (state === 'unsupported') {
      root.hidden = true;
    } else if (state === 'denied') {
      setButton('Notifications blocked', 'denied');
      setStatus(
        isIos
          ? 'Open iPhone Settings → Notifications and allow this app.'
          : 'Allow notifications for this site in your browser settings, then try again.',
      );
    } else if (state === 'on') {
      isOn = true;
      setButton((isMobile ? 'Phone' : 'Desktop') + ' alerts on · Send test', 'on');
      setStatus('New leads for this business arrive here even when the portal is closed.');
      if (off) off.hidden = false;
    } else if (state === 'working') {
      setButton('Turning on…', 'working');
    } else {
      isOn = false;
      setButton('Turn on ' + label, 'off');
      setStatus('Get the same style of alerts your agency gets — new leads on this phone or computer.');
    }
  }

  function refresh() {
    if (!supported) {
      render(isIos && !standalone ? 'install' : 'unsupported');
      return Promise.resolve();
    }
    if (Notification.permission === 'denied') {
      render('denied');
      return Promise.resolve();
    }
    if (Notification.permission !== 'granted') {
      render('off');
      return Promise.resolve();
    }
    return currentSubscription()
      .then(function (sub) {
        render(sub && Notification.permission === 'granted' ? 'on' : 'off');
      })
      .catch(function () {
        render('off');
      });
  }

  function subscribe() {
    var permission = Notification.requestPermission();
    render('working');
    return Promise.resolve(permission)
      .then(function (perm) {
        if (perm !== 'granted') throw new Error(perm === 'denied' ? 'denied' : 'dismissed');
        return Promise.all([registration(), fetchPublicKey()]);
      })
      .then(function (parts) {
        var reg = parts[0];
        var key = keyToBytes(parts[1]);
        var fresh = function () {
          return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        };
        return reg.pushManager.getSubscription().then(function (existing) {
          if (!existing) return fresh();
          if (sameKey(existing, key)) return existing;
          return existing.unsubscribe().catch(function () {}).then(fresh);
        });
      })
      .then(function (sub) {
        return post('/push/subscribe', { subscription: sub.toJSON() });
      })
      .then(function (res) {
        if (!res || !res.success) throw new Error((res && res.error) || 'Could not save this device.');
        return post('/push/test');
      })
      .catch(function (err) {
        var msg = err && err.message;
        if (msg === 'denied') setStatus('Notifications are blocked on this device.');
        else if (msg !== 'dismissed') setStatus(msg || 'Could not turn on alerts.');
      })
      .then(refresh);
  }

  function unsubscribe() {
    return currentSubscription()
      .then(function (sub) {
        if (!sub) return null;
        return post('/push/unsubscribe', { endpoint: sub.endpoint }).then(function () {
          return sub.unsubscribe();
        });
      })
      .catch(function () {})
      .then(refresh);
  }

  var enableBtn = root.querySelector('[data-cp-push-enable]');
  var offBtn = root.querySelector('[data-cp-push-off]');
  if (enableBtn) {
    enableBtn.addEventListener('click', function () {
      if (!supported || Notification.permission === 'denied') return;
      if (isOn) {
        post('/push/test').then(function () {
          setStatus('Test alert sent.');
        });
        return;
      }
      subscribe();
    });
  }
  if (offBtn) {
    offBtn.addEventListener('click', function () {
      unsubscribe();
    });
  }
  refresh();
})();
