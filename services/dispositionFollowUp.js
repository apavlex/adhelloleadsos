/**
 * Default follow-up scheduling per call disposition — shared by API, Focus, and pipeline.
 */

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function addBusinessDays(date, days) {
  let d = new Date(date);
  let remaining = days;
  while (remaining > 0) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) remaining -= 1;
  }
  return d;
}

function atHourLocal(date, hour, minute = 0) {
  const d = new Date(date);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function tomorrowAt10am(now) {
  return atHourLocal(addDays(now, 1), 10);
}

/** Dispositions that should not auto-schedule follow-up. */
const SKIP_FOLLOW_UP_CODES = new Set(['not_interested', 'wrong_number']);

function needsFollowUpForDisposition(code) {
  const c = String(code || '').trim().toLowerCase();
  return !!c && !SKIP_FOLLOW_UP_CODES.has(c);
}

function defaultScheduledAt(code, now = new Date()) {
  const c = String(code || '').trim().toLowerCase();
  switch (c) {
    case 'callback':
      return tomorrowAt10am(now);
    case 'no_answer':
      return addHours(now, 18);
    case 'connected':
      return atHourLocal(addBusinessDays(now, 2), 10);
    case 'gatekeeper':
      return atHourLocal(addDays(now, 1), 10);
    case 'site_audit':
      return atHourLocal(addDays(now, 3), 10);
    case 'send_info':
      return atHourLocal(addDays(now, 2), 10);
    case 'voicemail':
      return atHourLocal(now, 16, 0);
    default:
      return tomorrowAt10am(now);
  }
}

function humanizeCode(code) {
  return String(code || '')
    .trim()
    .replace(/_/g, ' ');
}

function taskTitleFor(code, lead) {
  const name = String(lead?.title || lead?.company || lead?.email || 'Lead').slice(0, 120);
  const label = humanizeCode(code);
  switch (code) {
    case 'callback':
      return `Callback requested — ${name}`;
    case 'no_answer':
      return `Retry call — ${name}`;
    case 'voicemail':
      return `Voicemail follow-up — ${name}`;
    default:
      return `Follow up: ${name} — ${label}`;
  }
}

/**
 * Resolve follow-up plan after a disposition is logged.
 * @returns {{ skipFollowUp: boolean, scheduledAt: string|null, taskTitle: string|null }}
 */
function resolveFollowUpForDisposition(code, opts = {}) {
  const c = String(code || '').trim().toLowerCase();
  const now = opts.now instanceof Date ? opts.now : new Date(opts.now || Date.now());

  if (opts.skipFollowUp === true || !needsFollowUpForDisposition(c)) {
    return { skipFollowUp: true, scheduledAt: null, taskTitle: null };
  }

  let scheduledAt;
  if (opts.scheduledAt) {
    const parsed = new Date(opts.scheduledAt);
    scheduledAt = Number.isFinite(parsed.getTime()) ? parsed : defaultScheduledAt(c, now);
  } else {
    scheduledAt = defaultScheduledAt(c, now);
  }

  return {
    skipFollowUp: false,
    scheduledAt: scheduledAt.toISOString(),
    taskTitle: taskTitleFor(c, opts.lead || {}),
  };
}

/** Task owner: lead assignee, else workspace owner, else first member. */
function resolveTaskOwnerEmail(lead, workspace) {
  const assignee = String(lead?.assignedTo || '').trim().toLowerCase();
  if (assignee) return assignee;
  const owner = String(workspace?.ownerUserId || '').trim().toLowerCase();
  if (owner) return owner;
  const members = workspace?.members && typeof workspace.members === 'object' ? workspace.members : {};
  const keys = Object.keys(members);
  if (keys.length) return keys[0].toLowerCase();
  return null;
}

module.exports = {
  SKIP_FOLLOW_UP_CODES,
  needsFollowUpForDisposition,
  defaultScheduledAt,
  taskTitleFor,
  resolveFollowUpForDisposition,
  resolveTaskOwnerEmail,
};
