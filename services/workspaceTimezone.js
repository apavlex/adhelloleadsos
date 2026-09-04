/**
 * Workspace timezone helpers (automations, morning brief, quiet hours context).
 */
const { DateTime } = require('luxon');

const DEFAULT_WORKSPACE_TIMEZONE = 'America/Los_Angeles';
const DAILY_OUTREACH_HOUR = 9;
const DAILY_OUTREACH_MINUTE = 30;

function resolveWorkspaceTimezone(workspaceOrTz) {
  if (typeof workspaceOrTz === 'string') {
    const raw = String(workspaceOrTz || '').trim();
    if (raw && DateTime.now().setZone(raw).isValid) return raw;
    return DEFAULT_WORKSPACE_TIMEZONE;
  }
  const raw = String((workspaceOrTz && workspaceOrTz.timezone) || '').trim();
  if (raw && DateTime.now().setZone(raw).isValid) return raw;
  return DEFAULT_WORKSPACE_TIMEZONE;
}

function localDayKey(timezone, fromDate = new Date()) {
  const tz = resolveWorkspaceTimezone(timezone);
  return DateTime.fromJSDate(fromDate, { zone: 'utc' }).setZone(tz).toFormat('yyyy-MM-dd');
}

/** Today's calendar date (yyyy-MM-dd) in the workspace timezone. Accepts a workspace or tz string. */
function workspaceTodayYmd(workspaceOrTz, fromDate = new Date()) {
  return localDayKey(workspaceOrTz, fromDate);
}

/**
 * Next daily outreach instant (09:30 in workspace TZ), as UTC ISO.
 */
function computeNextDailyRunIso(timezone, fromDate = new Date()) {
  const tz = resolveWorkspaceTimezone(timezone);
  const now = DateTime.fromJSDate(fromDate, { zone: 'utc' }).setZone(tz);
  let next = now.set({
    hour: DAILY_OUTREACH_HOUR,
    minute: DAILY_OUTREACH_MINUTE,
    second: 0,
    millisecond: 0,
  });
  if (next <= now) next = next.plus({ days: 1 });
  return next.toUTC().toISO();
}

function formatInTimezone(iso, timezone) {
  if (!iso) return '—';
  const tz = resolveWorkspaceTimezone(timezone);
  const dt = DateTime.fromISO(String(iso), { zone: 'utc' }).setZone(tz);
  if (!dt.isValid) return '—';
  return dt.toFormat('LLL d, h:mm a');
}

function dailyOutreachScheduleLabel(timezone) {
  const tz = resolveWorkspaceTimezone(timezone);
  const sample = DateTime.now().setZone(tz).set({
    hour: DAILY_OUTREACH_HOUR,
    minute: DAILY_OUTREACH_MINUTE,
  });
  const clock = sample.toFormat('h:mm a');
  const zone = sample.toFormat('ZZZZ');
  return `Daily ${clock} ${zone}`;
}

/**
 * True once per local day inside the 09:30-09:44 window (for every-15-min cron).
 */
function isDailyOutreachWindow(timezone, fromDate = new Date()) {
  const tz = resolveWorkspaceTimezone(timezone);
  const local = DateTime.fromJSDate(fromDate, { zone: 'utc' }).setZone(tz);
  if (local.hour !== DAILY_OUTREACH_HOUR) return false;
  if (local.minute < DAILY_OUTREACH_MINUTE || local.minute >= DAILY_OUTREACH_MINUTE + 15) {
    return false;
  }
  return true;
}

function lastDailyOutreachLocalDay(workspace) {
  const p = workspace && workspace.prospecting;
  return String((p && p.lastDailyOutreachLocalDay) || '').trim();
}

module.exports = {
  DEFAULT_WORKSPACE_TIMEZONE,
  DAILY_OUTREACH_HOUR,
  DAILY_OUTREACH_MINUTE,
  resolveWorkspaceTimezone,
  localDayKey,
  workspaceTodayYmd,
  computeNextDailyRunIso,
  formatInTimezone,
  dailyOutreachScheduleLabel,
  isDailyOutreachWindow,
  lastDailyOutreachLocalDay,
};
