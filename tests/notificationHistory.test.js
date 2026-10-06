const test = require('node:test');
const assert = require('node:assert/strict');
const { buildNotificationHistory } = require('../services/notificationHistory');

const NOW = Date.parse('2026-10-05T23:00:00Z');
const iso = (hoursAgo) => new Date(NOW - hoursAgo * 3600000).toISOString();

const leads = [
  {
    key: 'lead:abc',
    title: 'Pat Painter',
    inboundHandledAt: iso(3),
    inboundEvents: [
      { id: 'sms:1', type: 'sms', at: iso(5), preview: 'Old question' },
      { id: 'sms:2', type: 'sms', at: iso(1), preview: 'Still there?' },
      { id: 'call:1', type: 'call', at: iso(2), label: '' },
      { id: 'form:old', type: 'form', at: iso(24 * 40) },
    ],
  },
];

const searches = [
  { key: 'search:1', keyword: 'roofers', city: 'Camas', state: 'WA', resultCount: 12, timestamp: iso(4), targetFolderKey: 'f1' },
  { key: 'search:2', keyword: 'painters', status: 'failed', error: 'API key missing', timestamp: iso(6) },
];

const logged = [
  { id: 'a', at: iso(0.5), title: 'Contact hunt complete', body: 'Buildex', href: '/leads', userEmail: '' },
  { id: 'b', at: iso(0.6), title: 'Artwork ready', body: 'Mine', userEmail: 'me@x.com' },
  { id: 'c', at: iso(0.7), title: 'Someone else', body: 'Theirs', userEmail: 'other@x.com' },
];

test('history merges inbound, searches, and logged notifications newest first', () => {
  const h = buildNotificationHistory({ leads, searches, logged, userEmail: 'me@x.com', now: NOW });
  assert.deepEqual(
    h.items.map((i) => i.title),
    [
      'Contact hunt complete',
      'Artwork ready',
      'Text: Pat Painter',
      'Inbound call: Pat Painter',
      'Lead search complete',
      'Text: Pat Painter',
      'Lead search failed',
    ],
  );
  assert.deepEqual(h.counts, { all: 7, inbound: 3, search: 2, other: 2 });
  const [, , newText, , search, oldText, failed] = h.items;
  assert.equal(newText.status, 'open');
  assert.equal(oldText.status, 'handled');
  assert.equal(newText.href, '/focus?lead=abc');
  assert.equal(search.body, '"roofers in Camas, WA" · 12 leads');
  assert.equal(search.href, '/prospecting?tab=pipeline&folderKey=f1');
  assert.equal(failed.href, '/history');
  assert.match(failed.body, /API key missing/);
});

test('history filters by kind', () => {
  const h = buildNotificationHistory({ leads, searches, logged, userEmail: 'me@x.com', now: NOW, kind: 'search' });
  assert.equal(h.kind, 'search');
  assert.deepEqual(h.items.map((i) => i.kind), ['search', 'search']);
  assert.equal(h.counts.all, 7);
});
