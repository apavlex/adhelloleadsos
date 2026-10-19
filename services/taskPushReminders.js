/**
 * Push task reminders to subscribed devices so they arrive with the app closed.
 * Tags match public/js/task-reminders.js so a device that also shows the in-page alert only shows one.
 * Respects the per-user notification review watermark (Mark all reviewed) so the same
 * overdue task alerts are not re-pushed after the user catches up.
 */

const dbService = require('./database');
const push = require('./pushNotifications');
const notificationReview = require('./notificationReview');
const { isManualUserTask } = require('./userTasks');

const FIRED_KEY = 'sys:push_task_fired';
/** Reminders older than this are skipped (e.g. after downtime) instead of arriving late in a burst. */
const LOOKBACK_MS = 30 * 60 * 1000;
const KEEP_FIRED_MS = 3 * 24 * 60 * 60 * 1000;

function earlyMinutes(task) {
  const n = parseInt(task.remindMinutesBefore, 10);
  if (Number.isFinite(n) && n > 0) return n;
  return /\(remind T-15\)/i.test(String(task.title || '')) ? 15 : 0;
}

function readJson(key) {
  const raw = dbService.getKvSync(key);
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

function dueReminders(task, now) {
  if (!task || task.column === 'done' || !task.scheduledAt || !isManualUserTask(task)) return [];
  const due = Date.parse(task.scheduledAt);
  if (!Number.isFinite(due)) return [];
  const out = [];
  const early = earlyMinutes(task);
  if (early > 0) {
    const earlyAt = due - early * 60 * 1000;
    if (now >= earlyAt && now < due && now - earlyAt < LOOKBACK_MS) out.push('early');
  }
  if (now >= due && now - due < LOOKBACK_MS) out.push('due');
  return out;
}

function reminderPayload(task, kind) {
  let body = task.title || 'Scheduled task';
  if (kind === 'early') body = `Reminder in ${earlyMinutes(task)} min: ${body}`;
  const leadKey = task.leadKey ? String(task.leadKey).replace(/^lead:/i, '') : '';
  return {
    title: kind === 'early' ? 'Upcoming task' : 'Task reminder',
    body,
    url: leadKey ? `/tasks?leadKey=${encodeURIComponent(leadKey)}` : '/tasks',
    tag: `${task.id || ''}|${task.scheduledAt || ''}|${kind}`,
  };
}

function eventAtMs(task, kind) {
  const due = Date.parse(String((task && task.scheduledAt) || ''));
  if (!Number.isFinite(due)) return NaN;
  if (kind === 'early') return due - earlyMinutes(task) * 60 * 1000;
  return due;
}

function firedKeyFor(wid, frag, task, kind) {
  return `user_task:${wid}:${frag}:${task.id}|${task.scheduledAt}|${kind}`;
}

function readFiredMap(now = Date.now()) {
  const fired = readJson(FIRED_KEY) || {};
  for (const [k, at] of Object.entries(fired)) {
    if (now - at > KEEP_FIRED_MS) delete fired[k];
  }
  return fired;
}

function writeFiredMap(fired) {
  dbService.setKvSync(FIRED_KEY, fired);
}

/**
 * Stamp due/early reminders at or before `atMs` as already fired for this user.
 * Used by Mark all reviewed so the scheduler does not re-push the same overdue alerts.
 * @param {string} email
 * @param {number} [atMs]
 * @param {{ workspaceIds?: string[] }} [opts]
 */
async function catchUpReviewed(email, atMs = Date.now(), opts = {}) {
  const em = String(email || '')
    .trim()
    .toLowerCase();
  if (!em) return { stamped: 0 };
  const at = Number.isFinite(atMs) && atMs > 0 ? Math.min(atMs, Date.now()) : Date.now();
  const fired = readFiredMap(at);
  const frags = dbService._userTaskEmailFragments(em);

  const wids = new Set(
    (Array.isArray(opts.workspaceIds) ? opts.workspaceIds : []).map(String).filter(Boolean),
  );
  try {
    for (const wid of await dbService.getUserWorkspaceIds(em)) wids.add(String(wid));
  } catch (_) {
    /* ignore */
  }
  for (const sub of push.listSubscriptions()) {
    const subEm = String(sub.userEmail || '')
      .trim()
      .toLowerCase();
    const fragOk = sub.emailFrag && frags.has(String(sub.emailFrag));
    if (subEm !== em && !fragOk) continue;
    for (const wid of sub.workspaceIds || []) wids.add(String(wid));
  }

  let stamped = 0;
  for (const wid of wids) {
    // eslint-disable-next-line no-await-in-loop
    const tasks = await dbService.listUserTasks(wid, em);
    for (const task of tasks) {
      if (!task || !task.id || !task.scheduledAt) continue;
      for (const frag of frags) {
        for (const kind of ['early', 'due']) {
          if (kind === 'early' && earlyMinutes(task) <= 0) continue;
          const eventAt = eventAtMs(task, kind);
          if (!Number.isFinite(eventAt) || eventAt > at) continue;
          const fk = firedKeyFor(wid, frag, task, kind);
          if (!fired[fk]) stamped += 1;
          fired[fk] = at;
        }
      }
    }
  }
  writeFiredMap(fired);
  return { stamped };
}

async function runTaskPushReminders(now = Date.now()) {
  const subs = push.listSubscriptions();
  if (!subs.length) return { sent: 0 };

  const fired = readFiredMap(now);

  const owners = new Map();
  for (const sub of subs) {
    if (!sub.emailFrag) continue;
    for (const wid of sub.workspaceIds || []) owners.set(`${wid}|${sub.emailFrag}`, { wid, email: sub.userEmail, frag: sub.emailFrag });
  }

  let sent = 0;
  for (const { wid, email, frag } of owners.values()) {
    const reviewedMs = notificationReview.getReviewedMs(email);
    // eslint-disable-next-line no-await-in-loop
    const tasks = await dbService.listUserTasks(wid, email);
    for (const task of tasks) {
      for (const kind of dueReminders(task, now)) {
        const fk = firedKeyFor(wid, frag, task, kind);
        if (fired[fk]) continue;
        const eventAt = eventAtMs(task, kind);
        if (Number.isFinite(eventAt) && eventAt <= reviewedMs) {
          fired[fk] = now;
          continue;
        }
        fired[fk] = now;
        // eslint-disable-next-line no-await-in-loop
        const result = await push.sendPush({ userEmail: email, workspaceId: wid }, reminderPayload(task, kind));
        sent += result.sent;
      }
    }
  }
  writeFiredMap(fired);
  return { sent };
}

module.exports = {
  runTaskPushReminders,
  dueReminders,
  reminderPayload,
  catchUpReviewed,
  eventAtMs,
  FIRED_KEY,
};
