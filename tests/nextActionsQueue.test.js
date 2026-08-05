const test = require('node:test');
const assert = require('node:assert/strict');
const { buildNextActionsQueue } = require('../services/nextActionsQueue');

test('buildNextActionsQueue dedupes by leadKey preferring task over cadence', () => {
  const now = new Date('2026-08-05T12:00:00.000Z');
  const leadKey = 'lead:abc';
  const items = buildNextActionsQueue({
    now,
    leads: [{ key: leadKey, title: 'Acme', nextActionAt: '2026-08-05T08:00:00.000Z' }],
    tasks: [
      {
        leadKey,
        title: 'Callback task',
        scheduledAt: '2026-08-05T09:00:00.000Z',
        column: 'todo',
        leadTitle: 'Acme',
      },
    ],
    cadenceQueue: {
      calls: [
        {
          leadKey,
          title: 'Acme',
          stepTitle: 'Cadence call',
          nextDueAt: '2026-08-05T07:00:00.000Z',
          overdue: true,
        },
      ],
      emails: [],
      texts: [],
      linkedin: [],
      other: [],
    },
    reportsOpened24h: [],
    limit: 10,
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'task');
  assert.equal(items[0].title, 'Callback task');
});

test('buildNextActionsQueue includes report opens when no higher-priority item', () => {
  const now = new Date('2026-08-05T12:00:00.000Z');
  const leadKey = 'lead:xyz';
  const items = buildNextActionsQueue({
    now,
    leads: [],
    tasks: [],
    cadenceQueue: { calls: [], emails: [], texts: [], linkedin: [], other: [] },
    reportsOpened24h: [
      {
        leadKey,
        leadTitle: 'Bistro',
        lastViewedAt: '2026-08-05T11:00:00.000Z',
        focusLeadParam: 'xyz',
      },
    ],
    limit: 10,
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'report_open');
  assert.match(items[0].title, /audit/i);
});

test('buildNextActionsQueue prefers engagement over cadence for same lead', () => {
  const now = new Date('2026-08-05T12:00:00.000Z');
  const leadKey = 'lead:eng';
  const items = buildNextActionsQueue({
    now,
    leads: [{ key: leadKey, title: 'Warm Co' }],
    tasks: [],
    engagementQueue: [
      {
        leadKey,
        leadTitle: 'Warm Co',
        signalType: 'link_click',
        signalLabel: 'Link click',
        signalAt: '2026-08-05T11:30:00.000Z',
        priority: 2,
        href: '/focus?lead=eng',
      },
    ],
    cadenceQueue: {
      calls: [
        {
          leadKey,
          title: 'Warm Co',
          stepTitle: 'Cadence call',
          nextDueAt: '2026-08-05T07:00:00.000Z',
          overdue: true,
        },
      ],
      emails: [],
      texts: [],
      linkedin: [],
      other: [],
    },
    reportsOpened24h: [],
    limit: 10,
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'engagement');
  assert.match(items[0].title, /engaged/i);
});
