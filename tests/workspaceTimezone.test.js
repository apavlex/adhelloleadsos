const test = require('node:test');
const assert = require('node:assert/strict');
const { DateTime } = require('luxon');
const {
  resolveWorkspaceTimezone,
  computeNextDailyRunIso,
  formatInTimezone,
  dailyOutreachScheduleLabel,
  isDailyOutreachWindow,
  DEFAULT_WORKSPACE_TIMEZONE,
} = require('../services/workspaceTimezone');

test('resolveWorkspaceTimezone defaults to Pacific', () => {
  assert.equal(resolveWorkspaceTimezone(null), DEFAULT_WORKSPACE_TIMEZONE);
  assert.equal(resolveWorkspaceTimezone({}), DEFAULT_WORKSPACE_TIMEZONE);
  assert.equal(resolveWorkspaceTimezone({ timezone: 'America/New_York' }), 'America/New_York');
  assert.equal(resolveWorkspaceTimezone({ timezone: 'Not/AZone' }), DEFAULT_WORKSPACE_TIMEZONE);
});

test('computeNextDailyRunIso is 09:30 in workspace zone', () => {
  const from = DateTime.fromISO('2026-08-12T18:00:00Z').toJSDate(); // 11 AM PDT
  const next = computeNextDailyRunIso('America/Los_Angeles', from);
  const local = DateTime.fromISO(next, { zone: 'utc' }).setZone('America/Los_Angeles');
  assert.equal(local.hour, 9);
  assert.equal(local.minute, 30);
  assert.equal(local.toFormat('yyyy-MM-dd'), '2026-08-13');
});

test('formatInTimezone shows Pacific clock', () => {
  const label = formatInTimezone('2026-08-13T16:30:00.000Z', 'America/Los_Angeles');
  assert.match(label, /Aug 13/);
  assert.match(label, /9:30/i);
});

test('dailyOutreachScheduleLabel includes zone abbr', () => {
  const label = dailyOutreachScheduleLabel('America/Los_Angeles');
  assert.match(label, /Daily 9:30 AM/i);
  assert.match(label, /P[DS]T/);
});

test('isDailyOutreachWindow matches 09:30–09:44 local', () => {
  const inWindow = DateTime.fromObject(
    { year: 2026, month: 8, day: 13, hour: 9, minute: 35 },
    { zone: 'America/Los_Angeles' },
  ).toUTC().toJSDate();
  const outWindow = DateTime.fromObject(
    { year: 2026, month: 8, day: 13, hour: 9, minute: 10 },
    { zone: 'America/Los_Angeles' },
  ).toUTC().toJSDate();
  assert.equal(isDailyOutreachWindow('America/Los_Angeles', inWindow), true);
  assert.equal(isDailyOutreachWindow('America/Los_Angeles', outWindow), false);
});
