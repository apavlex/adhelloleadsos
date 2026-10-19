/**
 * Browser notifications for scheduled tasks (polls /tasks/api globally).
 * Respects Notification.permission and agencyOsTaskRemindersPaused in localStorage.
 * Mark all reviewed (AgencyTaskReminders.markAllCaughtUp) stamps due reminders so the
 * same overdue alerts do not keep reappearing after the tray is cleared.
 */
(function () {
  var STORAGE_KEY = 'agencyOsTaskReminderFired';
  var PAUSE_KEY = 'agencyOsTaskRemindersPaused';
  var REVIEW_KEY = 'agencyOsTaskRemindersReviewedAt';
  var INTERVAL_MS = 25000;
  /** Match server taskPushReminders — do not re-alert ancient overdue tasks in a burst. */
  var LOOKBACK_MS = 30 * 60 * 1000;
  /** Keep fired stamps across workspace switches (prune used to wipe them). */
  var KEEP_FIRED_MS = 3 * 24 * 60 * 60 * 1000;
  var cache = [];
  var refreshInflight = null;
  var reviewSyncInflight = null;

  function remindersPaused() {
    try {
      return localStorage.getItem(PAUSE_KEY) === '1';
    } catch (e) {
      return false;
    }
  }

  function setRemindersPaused(paused) {
    try {
      if (paused) localStorage.setItem(PAUSE_KEY, '1');
      else localStorage.removeItem(PAUSE_KEY);
    } catch (e) {}
  }

  function getReviewedAt() {
    try {
      var n = parseInt(localStorage.getItem(REVIEW_KEY) || '0', 10);
      return Number.isFinite(n) && n > 0 ? n : 0;
    } catch (e) {
      return 0;
    }
  }

  function setReviewedAt(atMs) {
    var at = Number.isFinite(atMs) && atMs > 0 ? Math.min(atMs, Date.now()) : Date.now();
    try {
      var prev = getReviewedAt();
      if (at < prev) at = prev;
      localStorage.setItem(REVIEW_KEY, String(at));
    } catch (e) {}
    return at;
  }

  function loadMap() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch (e) {
      return {};
    }
  }

  function saveMap(m) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(m));
    } catch (e) {}
  }

  function firedKey(task, kind) {
    return String(task.id || '') + '|' + String(task.scheduledAt || '') + '|' + (kind || 'due');
  }

  function earlyMinutes(task) {
    if (!task) return 0;
    var n = parseInt(task.remindMinutesBefore, 10);
    if (Number.isFinite(n) && n > 0) return n;
    var title = String(task.title || '');
    if (/\(remind T-15\)/i.test(title)) return 15;
    return 0;
  }

  function pruneMap(tasks) {
    // Keep fired stamps for KEEP_FIRED_MS even when the task is not in the current
    // workspace list — otherwise switching workspaces makes every overdue task
    // notify again when you come back.
    var now = Date.now();
    var m = loadMap();
    var next = {};
    var current = {};
    (tasks || []).forEach(function (t) {
      if (!t) return;
      current[firedKey(t, 'due')] = true;
      if (earlyMinutes(t) > 0) current[firedKey(t, 'early')] = true;
    });
    Object.keys(m).forEach(function (k) {
      var at = Number(m[k]) || 0;
      if (current[k] || (at > 0 && now - at < KEEP_FIRED_MS)) next[k] = m[k];
    });
    if (Object.keys(next).length !== Object.keys(m).length) saveMap(next);
  }

  function getTasks() {
    if (typeof window.__agencyTasksGetter === 'function') {
      var local = window.__agencyTasksGetter();
      if (Array.isArray(local) && local.length) return local;
    }
    return cache;
  }

  function refreshTasks() {
    if (refreshInflight) return refreshInflight;
    refreshInflight = fetch('/tasks/api', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
      .then(function (r) {
        return r.json().catch(function () {
          return {};
        });
      })
      .then(function (data) {
        if (data && data.success && Array.isArray(data.tasks)) {
          cache = data.tasks;
        }
      })
      .catch(function () {})
      .finally(function () {
        refreshInflight = null;
      });
    return refreshInflight;
  }

  /** Pull Mark-all-reviewed watermark from the server so it survives device/workspace hops. */
  function syncReviewedFromServer() {
    if (reviewSyncInflight) return reviewSyncInflight;
    reviewSyncInflight = fetch('/notifications/recent.json', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        if (!data || !data.success || !data.reviewedAt) return;
        var ms = Date.parse(data.reviewedAt);
        if (Number.isFinite(ms) && ms > 0) setReviewedAt(ms);
      })
      .catch(function () {})
      .finally(function () {
        reviewSyncInflight = null;
      });
    return reviewSyncInflight;
  }

  function notifyTask(task, kind) {
    var body = task.title || 'Scheduled task';
    if (task.leadTitle) body += ' — ' + task.leadTitle;
    if (kind === 'early') {
      body = 'Reminder in ' + earlyMinutes(task) + ' min: ' + body;
    }
    var n = new Notification(kind === 'early' ? 'Upcoming task' : 'Task reminder', {
      body: body,
      tag: firedKey(task, kind),
      renotify: false,
      silent: false,
    });
    n.onclick = function () {
      try {
        window.focus();
      } catch (e) {}
      if (task.leadKey) {
        var lk = String(task.leadKey).replace(/^lead:/i, '');
        window.location.href = '/tasks?leadKey=' + encodeURIComponent(lk);
      } else {
        window.location.href = '/tasks';
      }
      n.close();
    };
  }

  /**
   * Stamp every reminder that is already due (or past its early window) so tick()
   * and workspace switches do not recreate the same phone alerts.
   * @returns {number} reviewed-at ms used
   */
  function markAllCaughtUp(atMs) {
    var at = setReviewedAt(atMs);
    var tasks = getTasks() || [];
    var fired = loadMap();
    tasks.forEach(function (task) {
      if (!task || !task.scheduledAt || task.column === 'done') return;
      var due = Date.parse(task.scheduledAt);
      if (!Number.isFinite(due)) return;
      var earlyMin = earlyMinutes(task);
      if (earlyMin > 0) {
        var earlyAt = due - earlyMin * 60 * 1000;
        if (earlyAt <= at) fired[firedKey(task, 'early')] = at;
      }
      if (due <= at) fired[firedKey(task, 'due')] = at;
    });
    saveMap(fired);
    return at;
  }

  function stampQuiet(fired, key, now) {
    fired[key] = now;
    saveMap(fired);
  }

  function tick() {
    if (remindersPaused()) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    var tasks = getTasks() || [];
    pruneMap(tasks);
    var fired = loadMap();
    var reviewedAt = getReviewedAt();
    var now = Date.now();

    tasks.forEach(function (task) {
      if (!task || task.column === 'done') return;
      if (!task.scheduledAt) return;
      var due = Date.parse(task.scheduledAt);
      if (!Number.isFinite(due)) return;

      var earlyMin = earlyMinutes(task);
      if (earlyMin > 0) {
        var earlyAt = due - earlyMin * 60 * 1000;
        if (now >= earlyAt && now < due) {
          var ek = firedKey(task, 'early');
          if (fired[ek]) {
            /* already notified */
          } else if (earlyAt <= reviewedAt || now - earlyAt >= LOOKBACK_MS) {
            stampQuiet(fired, ek, now);
          } else {
            stampQuiet(fired, ek, now);
            try {
              notifyTask(task, 'early');
            } catch (e) {}
          }
        }
      }

      if (due > now) return;
      var k = firedKey(task, 'due');
      if (fired[k]) return;
      // Reviewed, or too old to alert (avoids re-spamming 20+ overdue follow-ups).
      if (due <= reviewedAt || now - due >= LOOKBACK_MS) {
        stampQuiet(fired, k, now);
        return;
      }
      stampQuiet(fired, k, now);
      try {
        notifyTask(task, 'due');
      } catch (e) {}
    });
  }

  function start() {
    if (window.__agencyTaskReminderTimer) return;
    syncReviewedFromServer();
    window.__agencyTaskReminderTimer = setInterval(function () {
      refreshTasks().finally(tick);
    }, INTERVAL_MS);
    refreshTasks().finally(tick);
  }

  function stop() {
    if (window.__agencyTaskReminderTimer) {
      clearInterval(window.__agencyTaskReminderTimer);
      window.__agencyTaskReminderTimer = null;
    }
  }

  function requestPermission() {
    if (!('Notification' in window)) return Promise.resolve('unsupported');
    if (Notification.permission === 'granted') return Promise.resolve('granted');
    if (Notification.permission === 'denied') return Promise.resolve('denied');
    try {
      return Notification.requestPermission();
    } catch (e) {
      return Promise.resolve('denied');
    }
  }

  function ensurePermissionForScheduledTask() {
    if (remindersPaused()) return Promise.resolve();
    if (!('Notification' in window)) return Promise.resolve();
    if (Notification.permission === 'granted') return Promise.resolve();
    if (Notification.permission === 'default') return requestPermission();
    return Promise.resolve();
  }

  window.__agencyTasksGetter = window.__agencyTasksGetter || function () {
    return cache;
  };

  window.AgencyTaskReminders = {
    start: start,
    stop: stop,
    tick: tick,
    refresh: refreshTasks,
    setTasks: function (tasks) {
      cache = Array.isArray(tasks) ? tasks.slice() : [];
    },
    requestPermission: requestPermission,
    ensurePermissionForScheduledTask: ensurePermissionForScheduledTask,
    isPaused: remindersPaused,
    setPaused: setRemindersPaused,
    markAllCaughtUp: markAllCaughtUp,
    getReviewedAt: getReviewedAt,
    syncReviewedFromServer: syncReviewedFromServer,
    LOOKBACK_MS: LOOKBACK_MS,
    KEEP_FIRED_MS: KEEP_FIRED_MS,
  };

  function boot() {
    start();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
