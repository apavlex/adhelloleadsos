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
  assert.equal(isManualPanelNote(note), true);
  assert.equal(activityEntryMatchesFilter(note, 'notes'), true);
  assert.equal(activityEntryMatchesFilter(call, 'notes'), false);
  assert.equal(activityEntryMatchesFilter(call, 'calls'), true);
});

test('buildWorkspaceActivityFeed sorts globally and paginates', () => {
  const leads = [
    {
      key: 'lead:a',
      title: 'Alpha',
      updates: [{ type: 'note', value: 'Old', timestamp: '2026-07-01T10:00:00.000Z', source: 'panel_post' }],
    },
    {
      key: 'lead:b',
      title: 'Beta',
      updates: [{ type: 'note', value: 'New', timestamp: '2026-07-22T10:00:00.000Z', source: 'panel_post' }],
    },
  ];
  const feed = buildWorkspaceActivityFeed(leads, {
    filter: 'notes',
    limit: 1,
    offset: 0,
    sinceMs: Date.parse('2026-06-01T00:00:00.000Z'),
  });
  assert.equal(feed.total, 2);
  assert.equal(feed.items.length, 1);
  assert.equal(feed.items[0].leadTitle, 'Beta');
});
