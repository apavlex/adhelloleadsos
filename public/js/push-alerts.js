/**
 * Phone / push alerts (Web Push). Works in the home-screen app on iPhone (iOS 16.4+) and Android,
 * and in desktop browsers — alerts arrive even when the app is closed.
 */
(function () {
  var ua = navigator.userAgent || '';
  var isIos = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isMobile = isIos || /Android|Mobi/i.test(ua);
  var standalone =
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  var supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  // In-page alerts don't work on phones; the push row replaces the desktop row there.
  if (isMobile) window.__adhelloPushReplacesDesktopAlerts = true;

  var publicKeyPromise = null;
  var isOn = false;
  var label = isMobile ? 'phone alerts' : 'push alerts';

  function $(id) {
    return document.getElementById(id);
  }

  function toast(text, variant) {
    if (typeof window.showAppToast === 'function') window.showAppToast(text, { variant: variant || 'success' });
  }

  function keyToBytes(base64) {
    var padded = (base64 + '===='.slice((base64.length + 3) % 4)).replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(padded);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
    return out;
  }

  function fetchPublicKey() {
    if (!publicKeyPromise) {
      publicKeyPromise = fetch('/activity/push/key', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (r) {
          return r.json();
        })
        .then(function (d) {
          if (!d || !d.publicKey) throw new Error('No push key');
          return d.publicKey;
        })
        .catch(function (err) {
          publicKeyPromise = null;
          throw err;
        });
    }
    return publicKeyPromise;
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

  function post(path, body) {
    return fetch(path, {
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

  function render(state) {
    var row = $('notificationPushRow');
    var btn = $('navPushEnable');
    var status = $('navPushStatus');
    var off = $('navPushOff');
    if (!row || !btn || !status) return;
    isOn = state === 'on';
    row.classList.remove('hidden');
    btn.classList.remove('hidden', 'border-emerald-500/45', 'border-rose-500/40');
    btn.classList.add('border-sky-500/45');
    btn.disabled = false;
    if (off) off.classList.add('hidden');

    if (state === 'install') {
      btn.classList.add('hidden');
      status.textContent =
        'To get phone alerts on iPhone: tap Share, then "Add to Home Screen". Open AdHello from your home screen and turn alerts on here.';
    } else if (state === 'unsupported') {
      row.classList.add('hidden');
    } else if (state === 'denied') {
      btn.textContent = 'Notifications blocked';
      btn.classList.remove('border-sky-500/45');
      btn.classList.add('border-rose-500/40');
      status.textContent = isIos
        ? 'Open iPhone Settings → Notifications → AdHello and allow notifications.'
        : 'Allow notifications for this site in your browser settings, then try again.';
    } else if (state === 'on') {
      btn.textContent = (isMobile ? 'Phone' : 'Push') + ' alerts on · Send test';
      btn.classList.remove('border-sky-500/45');
      btn.classList.add('border-emerald-500/45');
      status.textContent = 'Lead runs and task reminders arrive on this device, even when the app is closed.';
      if (off) off.classList.remove('hidden');
    } else if (state === 'working') {
      btn.disabled = true;
      btn.textContent = 'Turning on…';
    } else {
      btn.textContent = 'Turn on ' + label;
      status.textContent = 'Get lead runs and task reminders on this device, even when the app is closed.';
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
        return sub;
      })
      .catch(function () {
        render('off');
      });
  }

  function subscribe() {
    // Ask first, inside the tap: iOS only shows the prompt for a direct user gesture.
    var permission = Notification.requestPermission();
    render('working');
    return Promise.resolve(permission)
      .then(function (perm) {
        if (perm !== 'granted') throw new Error(perm === 'denied' ? 'denied' : 'dismissed');
        return Promise.all([registration(), fetchPublicKey()]);
      })
      .then(function (parts) {
        var reg = parts[0];
        return reg.pushManager.getSubscription().then(function (existing) {
          return existing || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(parts[1]) });
        });
      })
      .then(function (sub) {
        return post('/activity/push/subscribe', { subscription: sub.toJSON() });
      })
      .then(function (res) {
        if (!res || !res.success) throw new Error((res && res.error) || 'Could not save this device.');
        toast((isMobile ? 'Phone' : 'Push') + ' alerts are on. Sending a test…');
        return post('/activity/push/test');
      })
      .catch(function (err) {
        var msg = err && err.message;
        if (msg === 'denied') toast('Notifications are blocked for AdHello on this device.', 'error');
        else if (msg !== 'dismissed') toast(msg || 'Could not turn on alerts.', 'error');
      })
      .then(refresh);
  }

  function unsubscribe() {
    return currentSubscription()
      .then(function (sub) {
        if (!sub) return null;
        return post('/activity/push/unsubscribe', { endpoint: sub.endpoint }).then(function () {
          return sub.unsubscribe();
        });
      })
      .then(function () {
        toast('Alerts turned off on this device.');
      })
      .catch(function () {})
      .then(refresh);
  }

  // Keep the server copy current (new workspace, rotated subscription).
  function resync() {
    if (!supported || Notification.permission !== 'granted') return;
    try {
      if (sessionStorage.getItem('adhelloPushSynced') === '1') return;
    } catch (e) {}
    currentSubscription()
      .then(function (sub) {
        if (!sub) return;
        return post('/activity/push/subscribe', { subscription: sub.toJSON() }).then(function () {
          try {
            sessionStorage.setItem('adhelloPushSynced', '1');
          } catch (e) {}
        });
      })
      .catch(function () {});
  }

  function boot() {
    var btn = $('navPushEnable');
    var off = $('navPushOff');
    if (!$('notificationPushRow')) return;
    if (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (!supported || Notification.permission === 'denied') return;
        if (isOn) {
          post('/activity/push/test').then(function () {
            toast('Test alert sent.');
          });
          return;
        }
        subscribe();
      });
    }
    if (off) {
      off.addEventListener('click', function (e) {
        e.stopPropagation();
        unsubscribe();
      });
    }
    var bell = $('processingIndicator');
    if (bell) bell.addEventListener('click', refresh);
    refresh();
    resync();
    if (supported) fetchPublicKey().catch(function () {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
