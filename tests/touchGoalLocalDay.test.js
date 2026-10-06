const test = require('node:test');
const assert = require('node:assert/strict');
const { countUniqueLeadsTouchedToday } = require('../services/trackerStats');

const note = (timestamp) => ({ updates: [{ type: 'note', value: 'Called, left voicemail', timestamp }] });

test('daily touch count resets at midnight in the workspace timezone, not UTC', () => {
  const now = new Date('2026-10-06T17:00:00.000Z'); // 10:00 AM Pacific
  const leads = [
    note('2026-10-06T01:30:00.000Z'), // 6:30 PM Pacific yesterday — same UTC date, must not count
    note('2026-10-06T07:05:00.000Z'), // 12:05 AM Pacific today
    note('2026-10-06T16:45:00.000Z'), // 9:45 AM Pacific today
    note('2026-10-05T23:00:00.000Z'), // yesterday afternoon
  ];
  assert.equal(countUniqueLeadsTouchedToday(leads, { timezone: 'America/Los_Angeles' }, now), 2);
  assert.equal(countUniqueLeadsTouchedToday(leads, 'UTC', now), 3);
});

test('evening touches after 5 PM Pacific count toward the same local day', () => {
  const now = new Date('2026-10-07T04:00:00.000Z'); // 9:00 PM Pacific Oct 6
  const leads = [note('2026-10-06T16:45:00.000Z'), note('2026-10-07T03:30:00.000Z')];
  assert.equal(countUniqueLeadsTouchedToday(leads, { timezone: 'America/Los_Angeles' }, now), 2);
});
