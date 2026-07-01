/**
 * Browser notifications for scheduled tasks (polls /tasks/api globally).
 * Respects Notification.permission and agencyOsTaskRemindersPaused in localStorage.
 */
(function () {
  var STORAGE_KEY = 'agencyOsTaskReminderFired';
  var PAUSE_KEY = 'agencyOsTaskRemindersPaused';
  var INTERVAL_MS = 25000;
  var cache = [];
  var refreshInflight = null;

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
    var ids = {};
    (tasks || []).forEach(function (t) {
      ids[firedKey(t, 'due')] = true;
      if (earlyMinutes(t) > 0) ids[firedKey(t, 'early')] = true;
    });
    var m = loadMap();
    var next = {};
    Object.keys(m).forEach(function (k) {
      if (ids[k]) next[k] = m[k];
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

  function notifyTask(task, kind) {
    var body = task.title || 'Scheduled task';
    if (task.leadTitle) body += ' — ' + task.leadTitle;
    if (kind === 'early') {
      body = 'Reminder in ' + earlyMinutes(task) + ' min: ' + body;
    }
    var n = new Notification(kind === 'early' ? 'Upcoming task' : 'Task reminder', {
      body: body,
      tag: firedKey(task, kind),
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

  function tick() {
    if (remindersPaused()) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    var tasks = getTasks() || [];
    pruneMap(tasks);
    var fired = loadMap();
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
          if (!fired[ek]) {
            fired[ek] = now;
            saveMap(fired);
            try {
              notifyTask(task, 'early');
            } catch (e) {}
          }
        }
      }

      if (due > now) return;
      var k = firedKey(task, 'due');
      if (fired[k]) return;
      fired[k] = now;
      saveMap(fired);
      try {
        notifyTask(task, 'due');
      } catch (e) {}
    });
  }

  function start() {
    if (window.__agencyTaskReminderTimer) return;
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
