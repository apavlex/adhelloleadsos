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
  var ghlRow = root.querySelector('[data-ma-bell-ghl]');
  var ghlToggle = root.querySelector('[data-ma-bell-ghl-toggle]');
  var ghlStatus = root.querySelector('[data-ma-bell-ghl-status]');

  var ua = navigator.userAgent || '';
  var isIos = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isMobile = isIos || /Android|Mobi/i.test(ua);
  var standalone =
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  var supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  var label = isMobile ? 'phone alerts' : 'desktop alerts';
  var ghlEnabled = false;

  function setOpen(on) {
    if (!panel || !openBtn) return;
    panel.hidden = !on;
    if (scrim) scrim.hidden = !on;
    openBtn.setAttribute('aria-expanded', on ? 'true' : 'false');
    document.body.classList.toggle('ma-bell-open', !!on);
    if (on) {
      loadFeed().then(function () { markAllRead(); });
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
    if (kind === 'missed_call') return 'Missed call';
    if (kind === 'voicemail') return 'Voicemail';
    if (kind === 'sms') return 'Text';
    return 'Lead';
  }

  function ago(iso) {
    var ms = Date.now() - Date.parse(iso || '');
    if (!isFinite(ms)) return '';
    var m = Math.max(0, Math.round(ms / 60000));
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    var h = Math.round(m / 60);
    if (h < 24) return h + 'h ago';
    return Math.round(h / 24) + 'd ago';
  }

  function activityHtml(item) {
    var href = item.href || (base + '/referrals');
    var cls = 'ma-bell__item' + (item.read ? '' : ' is-unread');
    return (
      '<a class="' + cls + '" href="' + esc(href) + '">' +
        '<strong>' + esc(item.title) + '</strong>' +
        (item.body ? '<span>' + esc(item.body) + '</span>' : '') +
        '<small>' + esc(kindLabel(item.kind)) + ' · Open</small>' +
      '</a>'
    );
  }

  function ghlHtml(item) {
    var callLabel = item.callOpensLeadConnector
      ? (item.kind === 'sms' ? 'Lead Connector' : 'Call in LC')
      : (item.kind === 'sms' ? 'Reply' : 'Call back');
    var callAttrs = item.callOpensLeadConnector ? ' target="_blank" rel="noopener noreferrer"' : '';
    var openAttrs = item.openHref && /^https?:/i.test(item.openHref)
      ? ' target="_blank" rel="noopener noreferrer"'
      : '';
    var meta = esc(item.typeLabel || kindLabel(item.kind)) +
      (item.label ? ' · ' + esc(item.label) : '') +
      (item.at ? ' · ' + esc(ago(item.at)) : '');
    return (
      '<div class="ma-bell__item ma-bell__item--ghl is-unread" data-ma-bell-ghl-row="' + esc(item.leadKey) + '">' +
        '<strong>' + esc(item.title) + '</strong>' +
        '<span>' + meta + '</span>' +
        (item.preview ? '<span>' + esc(item.preview) + '</span>' : '') +
        '<div class="ma-bell__ghl-actions">' +
          (item.callHref
            ? '<a class="ma-bell__ghl-btn" href="' + esc(item.callHref) + '"' + callAttrs + '>' + esc(callLabel) + '</a>'
            : '') +
          (item.openHref
            ? '<a class="ma-bell__ghl-link" href="' + esc(item.openHref) + '"' + openAttrs + '>Open</a>'
            : '') +
          '<button type="button" class="ma-bell__ghl-link" data-ma-bell-ghl-done="' + esc(item.leadKey) + '">Done</button>' +
        '</div>' +
      '</div>'
    );
  }

  function renderList(items, ghlItems) {
    if (!listEl) return;
    var activity = Array.isArray(items) ? items : [];
    var ghl = Array.isArray(ghlItems) ? ghlItems : [];
    if (!activity.length && !ghl.length) {
      listEl.innerHTML = '<p class="ma-bell__empty">' +
        (ghlEnabled ? 'No new alerts' : 'No new lead alerts') +
        '</p>';
      return;
    }
    var html = '';
    if (ghl.length) {
      html += '<p class="ma-bell__section">Waiting on a reply</p>';
      html += ghl.map(ghlHtml).join('');
    }
    if (activity.length) {
      if (ghl.length) html += '<p class="ma-bell__section">Leads &amp; referrals</p>';
      html += activity.map(activityHtml).join('');
    }
    listEl.innerHTML = html;
  }

  function renderGhlToggle(available, enabled) {
    ghlEnabled = !!enabled;
    if (!ghlRow) return;
    if (!available) {
      ghlRow.hidden = true;
      return;
    }
    ghlRow.hidden = false;
    if (ghlToggle) ghlToggle.checked = !!enabled;
    if (ghlStatus) {
      ghlStatus.textContent = enabled
        ? 'Missed calls and texts from Lead Connector show here and on phone alerts.'
        : 'Show missed calls and texts from Lead Connector in this app.';
    }
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
        renderGhlToggle(!!data.ghlAlertsAvailable, !!data.ghlAlertsEnabled);
        renderList(data.items || [], data.ghlItems || []);
        if (pushRow) {
          pushRow.hidden = !(data.pushAvailable || pushOk);
        }
      })
      .catch(function () { /* ignore */ });
  }

  function setGhlAlerts(enabled) {
    if (ghlToggle) ghlToggle.disabled = true;
    return post('/activity/ghl-alerts', { enabled: !!enabled })
      .then(function (data) {
        if (!data || !data.success) throw new Error((data && data.error) || 'Could not update GHL alerts.');
        renderGhlToggle(true, !!data.ghlAlertsEnabled);
        return loadFeed();
      })
      .catch(function (err) {
        if (ghlToggle) ghlToggle.checked = ghlEnabled;
        if (ghlStatus) ghlStatus.textContent = (err && err.message) || 'Could not update GHL alerts.';
      })
      .then(function () {
        if (ghlToggle) ghlToggle.disabled = false;
      });
  }

  function markGhlDone(leadKey) {
    return post('/activity/ghl-done', { leadKey: leadKey })
      .then(function (data) {
        if (!data || !data.success) return;
        setPing(data.unread || 0);
        return loadFeed();
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
    // Scoped SW under /m/ — do not share /sw.js with the workspace Agency OS app.
    return dropWorkspaceWorker().then(function () {
      return navigator.serviceWorker.register('/m/sw.js', { scope: '/m/' });
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
      setPushStatus(
        ghlEnabled
          ? 'New leads, referrals, and GHL calls & texts arrive on this device, even when the app is closed.'
          : 'New leads, agency assignments, and referrals arrive on this device, even when the app is closed.',
      );
      if (pushOff) pushOff.hidden = false;
    } else if (state === 'working') {
      pushEnable.textContent = 'Working…';
      pushEnable.disabled = true;
    } else {
      pushEnable.textContent = 'Turn on ' + label;
      setPushStatus(
        ghlEnabled
          ? 'Turn on ' + label + ' for leads, referrals, and GHL calls & texts that need you now.'
          : 'Turn on ' + label + ' for website forms, agency leads, and referrals that need you now.',
      );
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
  if (ghlToggle) {
    ghlToggle.addEventListener('change', function () {
      setGhlAlerts(!!ghlToggle.checked);
    });
  }
  if (listEl) {
    listEl.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-ma-bell-ghl-done]');
      if (!btn) return;
      e.preventDefault();
      markGhlDone(btn.getAttribute('data-ma-bell-ghl-done'));
    });
  }

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
