const test = require('node:test');
const assert = require('node:assert/strict');
const {
  mergeLeadActivityEntries,
  activityEntryMatchesFilter,
  isManualPanelNote,
  buildWorkspaceActivityFeed,
} = require('../services/leadActivityFeed');

test('mergeLeadActivityEntries dedupes updates and logs', () => {
  const lead = {
    key: 'lead:abc',
    title: 'Acme Co',
    updates: [
      { type: 'note', value: 'Follow up Tuesday', timestamp: '2026-07-20T12:00:00.000Z', source: 'panel_post' },
      { type: 'call_outbound', value: 'Dialed main line', timestamp: '2026-07-21T12:00:00.000Z' },
    ],
    logs: [
      { type: 'note', message: 'Follow up Tuesday', timestamp: '2026-07-20T12:00:00.000Z' },
    ],
  };
  const entries = mergeLeadActivityEntries(lead);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].typ, 'call_outbound');
});

test('activity filters notes vs calls', () => {
  const note = {
    typ: 'note',
    text: 'Manual note',
    raw: { source: 'panel_post' },
  };
  const call = { typ: 'call_outbound', text: 'Called lead', raw: {} };
  const engagement = {
    typ: 'engagement_signal',
    text: 'Link click · https://example.com',
    raw: { signalType: 'link_click' },
  };
  assert.equal(isManualPanelNote(note), true);
  assert.equal(activityEntryMatchesFilter(note, 'notes'), true);
  assert.equal(activityEntryMatchesFilter(call, 'notes'), false);
  assert.equal(activityEntryMatchesFilter(call, 'calls'), true);
  assert.equal(activityEntryMatchesFilter(engagement, 'engagement'), true);
  assert.equal(activityEntryMatchesFilter(call, 'engagement'), false);
});

test('buildWorkspaceActivityFeed groups by lead and paginates', () => {
  const leads = [
    {
      key: 'lead:a',
      title: 'Alpha',
      updates: [{ type: 'note', value: 'Old', timestamp: '2026-07-01T10:00:00.000Z', source: 'panel_post' }],
    },
    {
      key: 'lead:b',
      title: 'Beta',
      updates: [
        { type: 'note', value: 'New', timestamp: '2026-07-22T10:00:00.000Z', source: 'panel_post' },
        { type: 'call_outbound', value: 'Dialed', timestamp: '2026-07-22T09:00:00.000Z' },
      ],
    },
  ];
  const feed = buildWorkspaceActivityFeed(leads, {
    filter: 'all',
    limit: 1,
    offset: 0,
    sinceMs: Date.parse('2026-06-01T00:00:00.000Z'),
  });
  assert.equal(feed.total, 2);
  assert.equal(feed.groups.length, 1);
  assert.equal(feed.groups[0].leadTitle, 'Beta');
  assert.equal(feed.groups[0].events.length, 2);
});

test('buildWorkspaceActivityFeed includes lead tags on groups', () => {
  const leads = [
    {
      key: 'lead:t',
      title: 'Tagged Co',
      tags: ['hot', 'referral'],
      updates: [
        { type: 'note', value: 'Tagged note', timestamp: '2026-07-22T10:00:00.000Z', source: 'panel_post' },
      ],
    },
  ];
  const feed = buildWorkspaceActivityFeed(leads, {
    filter: 'all',
    sinceMs: Date.parse('2026-06-01T00:00:00.000Z'),
  });
  assert.deepEqual(feed.groups[0].tags, ['hot', 'referral']);
});

test('buildWorkspaceActivityFeed consolidates multiple events under one lead', () => {
  const leads = [
    {
      key: 'lead:x',
      title: 'All In One Floors',
      updates: [
        { type: 'call_disposition', value: 'Send info', timestamp: '2026-07-23T21:28:00.000Z' },
        { type: 'status_change', value: 'Called Lead', timestamp: '2026-07-23T21:28:00.000Z' },
        { type: 'call_outbound', value: 'Outbound call', timestamp: '2026-07-23T21:24:00.000Z' },
      ],
    },
  ];
  const feed = buildWorkspaceActivityFeed(leads, {
    filter: 'all',
    sinceMs: Date.parse('2026-06-01T00:00:00.000Z'),
  });
  assert.equal(feed.total, 1);
  assert.equal(feed.groups.length, 1);
  assert.equal(feed.groups[0].events.length, 1);
  assert.equal(feed.groups[0].events[0].type, 'call_disposition');
});

test('buildWorkspaceActivityFeed collapses one call session into a single primary event', () => {
  const leads = [
    {
      key: 'lead:x',
      title: 'All In One Floors',
      updates: [
        {
          type: 'call_disposition',
          value: 'Disposition: Send info — Send email to John',
          timestamp: '2026-07-23T21:29:00.000Z',
        },
        { type: 'status_change', value: 'Called Lead', timestamp: '2026-07-23T21:29:00.000Z' },
        {
          type: 'call_disposition',
          value: 'Disposition: Send info — Send email to John',
          timestamp: '2026-07-23T21:28:00.000Z',
        },
        { type: 'status_change', value: 'Called Lead', timestamp: '2026-07-23T21:28:00.000Z' },
        {
          type: 'call_outbound',
          value: 'Outbound call initiated (+13608525976).',
          timestamp: '2026-07-23T21:24:00.000Z',
        },
      ],
      logs: [
        {
          type: 'call_disposition',
          message: 'Disposition set to Send info · Send-info action tagged for GHL follow-up.',
          timestamp: '2026-07-23T21:29:00.000Z',
        },
        {
          type: 'call_disposition',
          message: 'Disposition set to Send info · Send-info action tagged for GHL follow-up.',
          timestamp: '2026-07-23T21:28:00.000Z',
        },
        {
          type: 'call_outbound',
          message: 'SignalWire call initiated (4e50576d-2fd7-4c38-a5c7-8731026e73f2)',
          timestamp: '2026-07-23T21:24:00.000Z',
        },
      ],
    },
  ];
  const feed = buildWorkspaceActivityFeed(leads, {
    filter: 'all',
    sinceMs: Date.parse('2026-06-01T00:00:00.000Z'),
  });
  assert.equal(feed.groups[0].events.length, 1);
  assert.match(feed.groups[0].events[0].text, /Send info/i);
});
