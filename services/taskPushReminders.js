/**
 * Push task reminders to subscribed devices so they arrive with the app closed.
 * Tags match public/js/task-reminders.js so a device that also shows the in-page alert only shows one.
 */

const dbService = require('./database');
const push = require('./pushNotifications');
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

async function runTaskPushReminders(now = Date.now()) {
  const subs = push.listSubscriptions();
  if (!subs.length) return { sent: 0 };

  const fired = readJson(FIRED_KEY) || {};
  for (const [k, at] of Object.entries(fired)) {
    if (now - at > KEEP_FIRED_MS) delete fired[k];
  }

  const owners = new Map();
  for (const sub of subs) {
    if (!sub.emailFrag) continue;
    for (const wid of sub.workspaceIds || []) owners.set(`${wid}|${sub.emailFrag}`, { wid, email: sub.userEmail, frag: sub.emailFrag });
  }

  let sent = 0;
  for (const { wid, email, frag } of owners.values()) {
    // eslint-disable-next-line no-await-in-loop
    const tasks = await dbService.listUserTasks(wid, email);
    for (const task of tasks) {
      const key = `user_task:${wid}:${frag}:${task.id}`;
      for (const kind of dueReminders(task, now)) {
        const firedKey = `${key}|${task.scheduledAt}|${kind}`;
        if (fired[firedKey]) continue;
        fired[firedKey] = now;
        // eslint-disable-next-line no-await-in-loop
        const result = await push.sendPush({ userEmail: email, workspaceId: wid }, reminderPayload(task, kind));
        sent += result.sent;
      }
    }
  }
  dbService.setKvSync(FIRED_KEY, fired);
  return { sent };
}

module.exports = { runTaskPushReminders, dueReminders, reminderPayload };
