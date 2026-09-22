const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTodayPriorityLeads } = require('../services/todayPriorityLeads');

test('buildTodayPriorityLeads buckets manual, follow-up, reply, and referral leads', () => {
  const buckets = buildTodayPriorityLeads({
    leads: [
      { key: 'lead:manual', title: 'Pacific Rockery', source: 'manual', city: 'Portland', createdAt: '2026-09-20T00:00:00.000Z' },
      {
        key: 'lead:reply',
        title: 'First Covenant',
        source: 'maps_search',
        engagementSignals: { smsRepliedAt: '2026-09-22T12:00:00.000Z', lastSignalType: 'sms_reply' },
      },
      { key: 'lead:ref', title: 'Summit Flooring', source: 'manual', tags: ['referral'], city: 'Gresham' },
      { key: 'lead:cadence', title: 'Cadence only', source: 'maps_search' },
    ],
    tasks: [
      { leadKey: 'lead:reply', column: 'todo', source: 'disposition', scheduledAt: '2026-09-22T15:00:00.000Z', title: 'Callback' },
      { leadKey: 'lead:cadence', column: 'todo', source: 'cadence', scheduledAt: '2026-09-22T15:00:00.000Z', title: '[CALL] step' },
      { leadKey: 'lead:manual', column: 'done', source: 'manual', scheduledAt: '2026-09-21T15:00:00.000Z', title: 'Done' },
    ],
  });

  assert.deepEqual(buckets.added.items.map((row) => row.title), ['Pacific Rockery', 'Summit Flooring']);
  assert.deepEqual(buckets.followUp.items.map((row) => row.title), ['First Covenant']);
  assert.equal(buckets.responded.items[0].title, 'First Covenant');
  assert.equal(buckets.responded.items[0].detail, 'SMS reply');
  assert.deepEqual(buckets.referrals.items.map((row) => row.title), ['Summit Flooring']);
  assert.equal(buckets.added.href.includes('origin=manual'), true);
});
