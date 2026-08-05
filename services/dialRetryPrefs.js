/**
 * Workspace dial-retry preferences — auto no-answer after dial + retry scheduling.
 * Stored on workspace.telephony.dialRetry
 */

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function atHourLocal(date, hour, minute = 0) {
  const d = new Date(date);
  d.setHours(hour, minute, 0, 0);
  return d;
}

const RETRY_SCHEDULES = Object.freeze([
  '18h',
  '1d',
  '3d',
  '7d',
  'custom_hours',
  'custom_days',
]);

const QUEUE_MODES = Object.freeze(['continue_list', 'retry_when_due']);

const DEFAULTS = Object.freeze({
  autoNoAnswerOnDial: true,
  retrySchedule: '18h',
  retryDelayHours: 18,
  retryDelayDays: 3,
  retryAtHourLocal: 10,
  queueMode: 'continue_list',
});

function clampInt(v, min, max, fallback) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeRetrySchedule(raw) {
  const s = String(raw || '').trim().toLowerCase();
  return RETRY_SCHEDULES.includes(s) ? s : DEFAULTS.retrySchedule;
}

function normalizeQueueMode(raw) {
  const s = String(raw || '').trim().toLowerCase();
  return QUEUE_MODES.includes(s) ? s : DEFAULTS.queueMode;
}

function resolveDialRetryPrefs(telephony) {
  const tp = telephony && typeof telephony === 'object' ? telephony : {};
  const raw = tp.dialRetry && typeof tp.dialRetry === 'object' ? tp.dialRetry : {};
  return {
    autoNoAnswerOnDial: raw.autoNoAnswerOnDial !== false,
    retrySchedule: normalizeRetrySchedule(raw.retrySchedule),
    retryDelayHours: clampInt(raw.retryDelayHours, 1, 720, DEFAULTS.retryDelayHours),
    retryDelayDays: clampInt(raw.retryDelayDays, 1, 90, DEFAULTS.retryDelayDays),
    retryAtHourLocal: clampInt(raw.retryAtHourLocal, 0, 23, DEFAULTS.retryAtHourLocal),
    queueMode: normalizeQueueMode(raw.queueMode),
  };
}

function parseDialRetryFromBody(body) {
  if (!body || typeof body !== 'object') return null;
  const has =
    Object.prototype.hasOwnProperty.call(body, 'dialRetryAutoNoAnswer') ||
    Object.prototype.hasOwnProperty.call(body, 'dialRetrySchedule') ||
    Object.prototype.hasOwnProperty.call(body, 'dialRetryDelayHours') ||
    Object.prototype.hasOwnProperty.call(body, 'dialRetryDelayDays') ||
    Object.prototype.hasOwnProperty.call(body, 'dialRetryAtHour') ||
    Object.prototype.hasOwnProperty.call(body, 'dialRetryQueueMode');
  if (!has) return null;

  const patch = {};
  if (Object.prototype.hasOwnProperty.call(body, 'dialRetryAutoNoAnswer')) {
    patch.autoNoAnswerOnDial = body.dialRetryAutoNoAnswer === true || body.dialRetryAutoNoAnswer === 'true';
  }
  if (Object.prototype.hasOwnProperty.call(body, 'dialRetrySchedule')) {
    patch.retrySchedule = normalizeRetrySchedule(body.dialRetrySchedule);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'dialRetryDelayHours')) {
    patch.retryDelayHours = clampInt(body.dialRetryDelayHours, 1, 720, DEFAULTS.retryDelayHours);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'dialRetryDelayDays')) {
    patch.retryDelayDays = clampInt(body.dialRetryDelayDays, 1, 90, DEFAULTS.retryDelayDays);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'dialRetryAtHour')) {
    patch.retryAtHourLocal = clampInt(body.dialRetryAtHour, 0, 23, DEFAULTS.retryAtHourLocal);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'dialRetryQueueMode')) {
    patch.queueMode = normalizeQueueMode(body.dialRetryQueueMode);
  }
  return patch;
}

function resolveNoAnswerRetryAt(prefs, now = new Date()) {
  const p = prefs && typeof prefs === 'object' ? prefs : DEFAULTS;
  const hour = p.retryAtHourLocal ?? DEFAULTS.retryAtHourLocal;
  switch (p.retrySchedule) {
    case '18h':
      return addHours(now, 18);
    case '1d':
      return atHourLocal(addDays(now, 1), hour);
    case '3d':
      return atHourLocal(addDays(now, 3), hour);
    case '7d':
      return atHourLocal(addDays(now, 7), hour);
    case 'custom_hours':
      return addHours(now, p.retryDelayHours || DEFAULTS.retryDelayHours);
    case 'custom_days':
      return atHourLocal(addDays(now, p.retryDelayDays || DEFAULTS.retryDelayDays), hour);
    default:
      return addHours(now, 18);
  }
}

function formatRetryDelayLabel(scheduledAtIso, now = new Date()) {
  const ts = Date.parse(scheduledAtIso);
  if (!Number.isFinite(ts)) return 'later';
  const ms = ts - now.getTime();
  if (ms <= 0) return 'now';
  const hours = Math.round(ms / 3600000);
  if (hours < 48) return `in ${hours}h`;
  const days = Math.round(ms / 86400000);
  return `in ${days} day${days === 1 ? '' : 's'}`;
}

function isLeadDeferredForRetry(lead, queueMode, nowMs = Date.now()) {
  if (queueMode !== 'continue_list') return false;
  const na = lead && lead.nextActionAt ? Date.parse(lead.nextActionAt) : NaN;
  const rb = lead && lead.redialBlockedUntil ? Date.parse(lead.redialBlockedUntil) : NaN;
  const blockUntil = Math.max(Number.isFinite(na) ? na : 0, Number.isFinite(rb) ? rb : 0);
  return blockUntil > nowMs;
}

module.exports = {
  DEFAULTS,
  RETRY_SCHEDULES,
  QUEUE_MODES,
  resolveDialRetryPrefs,
  parseDialRetryFromBody,
  resolveNoAnswerRetryAt,
  formatRetryDelayLabel,
  isLeadDeferredForRetry,
};
