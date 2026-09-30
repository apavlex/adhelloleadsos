const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildBookmarkSessions, buildRecentlyWorked } = require('../services/todayResumeQueue');

const now = Date.now();
const iso = (msAgo) => new Date(now - msAgo).toISOString();

const folders = [{ key: 'folder:ws1:100', name: 'Home Contractors' }];

const leads = [
  { key: 'lead:a1', title: 'Alpha Floors', phone: '(360) 555-0101', bookmarked: true, folderKey: 'folder:ws1:100', pipelineStage: 1 },
  { key: 'lead:b2', title: 'Beta Builders', phone: 'N/A', bookmarked: true, folderKey: 'folder:ws1:100', pipelineStage: 1 },
  { key: 'lead:c3', title: 'Gamma Tile', phone: '(360) 555-0103', bookmarked: true, folderKey: '', pipelineStage: 2 },
  {
    key: 'lead:d4',
    title: 'Delta Roofing',
    phone: '(360) 555-0104',
    pipelineStage: 1,
    updates: [{ type: 'call_outbound', value: 'Dialed', timestamp: iso(2 * 3600000) }],
  },
  {
    key: 'lead:e5',
    title: 'Echo Paint',
    phone: '(360) 555-0105',
    pipelineStage: 1,
    updates: [{ type: 'note', value: 'Owner out until Friday', timestamp: iso(10 * 60000) }],
  },
  {
    key: 'lead:f6',
    title: 'Foxtrot HVAC',
    phone: '(360) 555-0106',
    pipelineStage: 1,
    updates: [{ type: 'sms_inbound', value: 'Who is this?', timestamp: iso(60000) }],
  },
];

describe('todayResumeQueue', () => {
  it('groups bookmarked leads by folder with Money Mode links', () => {
    const out = buildBookmarkSessions(leads, folders, { queueMode: 'continue_list' });
    assert.equal(out.total, 3);
    assert.equal(out.callable, 2);
    const contractors = out.folders.find((f) => f.name === 'Home Contractors');
    assert.equal(contractors.count, 2);
    assert.equal(contractors.callable, 1);
    const url = new URL(contractors.href, 'http://x');
    assert.equal(url.pathname, '/focus');
    assert.deepEqual(url.searchParams.get('keys').split(',').sort(), ['a1', 'b2']);
    assert.ok(out.folders.some((f) => f.name === 'Main pipeline (unfiled)' && f.count === 1));
  });

  it('lists most recently worked leads first and ignores inbound-only activity', () => {
    const out = buildRecentlyWorked(leads, folders, { limit: 8 });
    assert.deepEqual(out.items.map((i) => i.title), ['Echo Paint', 'Delta Roofing']);
    const url = new URL(out.href, 'http://x');
    assert.equal(url.searchParams.get('keys'), 'e5,d4');
    assert.equal(url.searchParams.get('lead'), 'e5');
  });
});
