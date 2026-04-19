/**
 * Browser notifications when task.scheduledAt is due (Chrome / modern browsers).
 * Requires Notification permission. Fires while this tab is open (poll ~25s).
 */
(function () {
  var STORAGE_KEY = 'agencyOsTaskReminderFired';
  var INTERVAL_MS = 25000;

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

  function firedKey(task) {
    return String(task.id || '') + '|' + String(task.scheduledAt || '');
  }

  function pruneMap(tasks) {
    var ids = {};
    (tasks || []).forEach(function (t) {
      ids[firedKey(t)] = true;
    });
    var m = loadMap();
    var next = {};
    Object.keys(m).forEach(function (k) {
      if (ids[k]) next[k] = m[k];
    });
    if (Object.keys(next).length !== Object.keys(m).length) saveMap(next);
  }

  function tick() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    var getTasks = window.__agencyTasksGetter;
    if (typeof getTasks !== 'function') return;
    var tasks = getTasks() || [];
    pruneMap(tasks);
    var fired = loadMap();
    var now = Date.now();

    tasks.forEach(function (task) {
      if (!task || task.column === 'done') return;
      if (!task.scheduledAt) return;
      var due = Date.parse(task.scheduledAt);
      if (!Number.isFinite(due) || due > now) return;
      var k = firedKey(task);
      if (fired[k]) return;
      fired[k] = now;
      saveMap(fired);
      try {
        new Notification('Task reminder', {
          body: task.title || 'Scheduled task',
          tag: k,
          silent: false,
        });
      } catch (e) {}
    });
  }

  function start() {
    if (window.__agencyTaskReminderTimer) return;
    window.__agencyTaskReminderTimer = setInterval(tick, INTERVAL_MS);
    tick();
  }

  function stop() {
    if (window.__agencyTaskReminderTimer) {
      clearInterval(window.__agencyTaskReminderTimer);
      window.__agencyTaskReminderTimer = null;
    }
  }

  window.AgencyTaskReminders = { start: start, stop: stop, tick: tick };
})();
