/**
 * In-your-face prompt after signup / first opens: turn on Web Push for leads,
 * referrals, and News & updates. Chains after the Add-to-Home-Screen sheet.
 */
(function () {
  var modal = document.getElementById('maPushNudge');
  if (!modal) return;

  var base = modal.getAttribute('data-ma-push-base') || '';
  var enableBtn = modal.querySelector('[data-ma-push-nudge-enable]');
  var statusEl = modal.querySelector('[data-ma-push-nudge-status]');
  var stepsEl = modal.querySelector('[data-ma-push-nudge-steps]');
  var SNOOZE_KEY = 'ma-push-nudge-snooze';
  var SNOOZE_MS = 12 * 60 * 60 * 1000; // 12 hours — still comes back
  var ua = navigator.userAgent || '';
  var isIos = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var standalone =
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    navigator.standalone === true;
  var supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  var path = String(window.location.pathname || '');
  var isHomeRoot = /^\/m\/[^/]+\/?$/.test(path);
  var opened = false;

  function snoozed() {
    try {
      var raw = localStorage.getItem(SNOOZE_KEY);
      if (!raw) return false;
      var until = Number(raw);
      if (!Number.isFinite(until)) return false;
      return Date.now() < until;
    } catch (e) {
      return false;
    }
  }

  function markSnoozed() {
    try {
      localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
    } catch (e) { /* private mode */ }
  }

  function clearSnooze() {
    try { localStorage.removeItem(SNOOZE_KEY); } catch (e) { /* ignore */ }
  }

  function setStatus(text, show) {
    if (!statusEl) return;
    statusEl.textContent = text || '';
    statusEl.hidden = !show;
    if (stepsEl) stepsEl.hidden = !!show;
  }

  function keyToBytes(base64) {
    var clean = String(base64 || '').replace(/[\s"'=]/g, '').replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(clean + '==='.slice(0, (4 - (clean.length % 4)) % 4));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
    return out;
  }

  function post(pathSuffix, body) {
    return fetch(base + pathSuffix, {
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
          } catch (e) { /* ignore */ }
          return null;
        }),
      );
    }).catch(function () {});
  }

  function registration() {
    return dropWorkspaceWorker().then(function () {
      return navigator.serviceWorker.register('/m/sw.js', { scope: '/m/' });
    });
  }

  function currentSubscription() {
    if (!supported) return Promise.resolve(null);
    return registration().then(function (reg) {
      return reg.pushManager.getSubscription();
    }).catch(function () { return null; });
  }

  function installModalOpen() {
    var install = document.getElementById('maInstall');
    return !!(install && !install.hidden);
  }

  function closeModal(persist) {
    modal.hidden = true;
    if (!installModalOpen()) document.documentElement.style.overflow = '';
    if (persist) markSnoozed();
    opened = false;
  }

  function openModal() {
    if (opened || !modal) return;
    opened = true;
    modal.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    setStatus('', false);
    if (enableBtn) {
      enableBtn.disabled = false;
      if (isIos && !standalone) {
        enableBtn.textContent = 'Add to Home Screen first';
      } else if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
        enableBtn.textContent = 'Notifications blocked';
        enableBtn.disabled = true;
        setStatus('Allow notifications for this site in your phone Settings, then come back.', true);
      } else {
        enableBtn.textContent = 'Turn on alerts';
      }
    }
  }

  function enableAlerts() {
    if (!enableBtn || enableBtn.disabled) return;
    if (isIos && !standalone) {
      setStatus('On iPhone: Share → Add to Home Screen, open this app from your home screen, then tap Turn on alerts.', true);
      var install = document.getElementById('maInstall');
      if (install) {
        closeModal(false);
        install.hidden = false;
        document.documentElement.style.overflow = 'hidden';
      }
      return;
    }
    if (!supported) {
      setStatus('This browser can’t show phone alerts. Open the app on your phone.', true);
      return;
    }
    enableBtn.disabled = true;
    enableBtn.textContent = 'Working…';
    setStatus('', false);
    return Notification.requestPermission()
      .then(function (perm) {
        if (perm !== 'granted') {
          setStatus('Allow notifications when your phone asks — that’s how leads and updates reach you.', true);
          enableBtn.disabled = false;
          enableBtn.textContent = 'Turn on alerts';
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
        clearSnooze();
        enableBtn.textContent = 'Alerts are on';
        setStatus('You’re set — leads, referrals, and News & updates will pop up on this phone.', true);
        post('/push/test', {}).catch(function () {});
        setTimeout(function () { closeModal(false); }, 1400);
      })
      .catch(function (err) {
        if (err && err.message === 'denied') return;
        enableBtn.disabled = false;
        enableBtn.textContent = 'Turn on alerts';
        setStatus((err && err.message) || 'Could not turn on alerts. Try again.', true);
      });
  }

  function maybePrompt() {
    if (!supported && !(isIos && !standalone)) return;
    currentSubscription().then(function (sub) {
      if (sub) return;
      if (snoozed()) return;
      if (typeof Notification !== 'undefined' && Notification.permission === 'denied' && !isHomeRoot) return;

      var show = function () {
        if (installModalOpen()) return;
        if (snoozed()) return;
        openModal();
      };

      if (installModalOpen()) {
        // Wait for install sheet to close, then jump to alerts.
        return;
      }
      // Home: immediate popup. Elsewhere: short delay. No Home page banner —
      // alerts stay in this modal + the bell notifications panel.
      if (isHomeRoot) show();
      else setTimeout(show, 900);
    });
  }

  if (enableBtn) enableBtn.addEventListener('click', enableAlerts);
  modal.querySelectorAll('[data-ma-push-nudge-close]').forEach(function (btn) {
    btn.addEventListener('click', function () { closeModal(true); });
  });
  modal.addEventListener('click', function (e) {
    if (e.target === modal) closeModal(true);
  });

  window.addEventListener('ma-install-closed', function () {
    currentSubscription().then(function (sub) {
      if (sub || snoozed()) return;
      setTimeout(function () { openModal(); }, 280);
    });
  });

  maybePrompt();
})();
