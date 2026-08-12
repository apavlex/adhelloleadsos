const test = require('node:test');
const assert = require('node:assert/strict');
const { DateTime } = require('luxon');
const {
  computeNextDailyRunUtc,
  computeScheduleNextRun,
  outreachStatus,
} = require('../services/automationsRegistry');

test('outreachStatus returns running when enabled', () => {
  assert.equal(outreachStatus({ enabled: true }), 'running');
});

test('outreachStatus returns paused when disabled but has run history', () => {
  assert.equal(outreachStatus({ enabled: false, lastRunAt: '2026-01-01T09:30:00Z' }), 'paused');
  assert.equal(outreachStatus({ enabled: false, lastEnrolled: 3 }), 'paused');
});

test('outreachStatus returns idle when never run', () => {
  assert.equal(outreachStatus({ enabled: false }), 'idle');
});

test('computeNextDailyRunUtc returns future 09:30 UTC', () => {
  const before = DateTime.utc().set({ hour: 8, minute: 0, second: 0, millisecond: 0 });
  const next = computeNextDailyRunUtc(before.toJSDate());
  const dt = DateTime.fromISO(next, { zone: 'utc' });
  assert.equal(dt.hour, 9);
  assert.equal(dt.minute, 30);
  assert.ok(dt > before);
});

test('computeScheduleNextRun handles one-time future schedule', () => {
  const future = DateTime.utc().plus({ days: 2 }).toISO();
  const next = computeScheduleNextRun({
    scheduledRunAt: future,
    lastRun: null,
  });
  assert.equal(DateTime.fromISO(next).toUTC().toISO(), DateTime.fromISO(future).toUTC().toISO());
});

test('computeScheduleNextRun returns null for completed one-time schedule', () => {
  const past = DateTime.utc().minus({ days: 1 }).toISO();
  const next = computeScheduleNextRun({
    scheduledRunAt: past,
    lastRun: past,
  });
  assert.equal(next, null);
});
