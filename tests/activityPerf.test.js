const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-perf-'));
process.env.APP_DATA_DIR = tmpDataDir;

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const dbService = require('../services/database');
const {
  mergeLeadActivityEntries,
  activityEntryMatchesFilter,
  collapsePrimaryActivities,
  formatActivityTypeLabel,
  formatActivityEntryText,
  buildWorkspaceActivityFeed,
} = require('../services/leadActivityFeed');

/** Pre-optimization feed loop: merge + format every lead, then drop out-of-window events. */
function referenceFeed(leads, { filter = 'all', sinceMs }) {
  const groups = [];
  let totalEvents = 0;
  for (const lead of leads) {
    if (!lead || !lead.key) continue;
    const merged = mergeLeadActivityEntries(lead);
    const filtered = merged.filter((e) => activityEntryMatchesFilter(e, filter));
    const primary = filter === 'notes' ? filtered : collapsePrimaryActivities(filtered);
    const events = [];
    for (const e of primary) {
      const tsMs = Date.parse(e.ts) || 0;
      if (sinceMs && tsMs && tsMs < sinceMs) continue;
      events.push({
        ts: e.ts || '',
        tsMs,
        type: e.typ,
        typeLabel: formatActivityTypeLabel(e.typ, e.raw),
        text: formatActivityEntryText(e).slice(0, 500),
        byLabel: String((e.raw && e.raw.by) || '').trim().slice(0, 160),
      });
    }
    if (!events.length) continue;
    events.sort((a, b) => b.tsMs - a.tsMs);
    totalEvents += events.length;
    groups.push({
      leadKey: lead.key,
      leadTitle: String(lead.title || lead.company || lead.email || 'Lead').slice(0, 120),
      folderKey: String(lead.folderKey || '').trim(),
      status: String(lead.status || '').trim(),
      city: String(lead.city || '').trim(),
      tags: Array.isArray(lead.tags) ? lead.tags.map(String).filter(Boolean) : [],
      latestTs: events[0].ts,
      latestTsMs: events[0].tsMs,
      eventCount: events.length,
      events,
    });
  }
  groups.sort((a, b) => b.latestTsMs - a.latestTsMs);
  return { groups, total: groups.length, totalEvents };
}

const mailLog = (id, timestamp) => ({
  type: 'direct_mail_outbound',
  message: `Lob postcard queued (psc_${id})`,
  postcardId: `psc_${id}`,
  ...(timestamp ? { timestamp } : {}),
});

test('buildWorkspaceActivityFeed skips only leads with nothing in the window; output unchanged', () => {
  const sinceMs = Date.parse('2026-09-16T00:00:00.000Z');
  const old = '2026-08-01T12:00:00.000Z';
  const recent = '2026-09-25T12:00:00.000Z';
  const leads = [
    { key: 'lead:old', title: 'Only old', logs: [mailLog('old1', old), mailLog('old2', old)] },
    { key: 'lead:recent', title: 'Has recent', logs: [mailLog('r_old', old), mailLog('r_new', recent)] },
    { key: 'lead:undated', title: 'Has undated', logs: [mailLog('u_old', old), mailLog('u_none', '')] },
    {
      key: 'lead:tail',
      title: 'Recent entries beyond the 24-entry tail',
      logs: [
        ...Array.from({ length: 6 }, (_, i) => mailLog(`t_new${i}`, recent)),
        ...Array.from({ length: 24 }, (_, i) => mailLog(`t_old${i}`, old)),
      ],
    },
  ];

  const feed = buildWorkspaceActivityFeed(leads, { filter: 'all', sinceMs, limit: 200 });
  const expected = referenceFeed(leads, { filter: 'all', sinceMs });

  assert.deepEqual(feed.groups, expected.groups);
  assert.equal(feed.total, expected.total);
  assert.equal(feed.totalEvents, expected.totalEvents);
  assert.deepEqual(
    feed.groups.map((g) => g.leadKey).sort(),
    ['lead:recent', 'lead:undated'],
  );
});

function writeRawKv(key, value) {
  const conn = new Database(path.join(tmpDataDir, 'app.db'));
  try {
    conn
      .prepare("INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))")
      .run(key, JSON.stringify(value));
  } finally {
    conn.close();
  }
}

test('resolveLeadStorageKey finds a lead whose stored key differs from its row key', async () => {
  writeRawKv('lead:123_abc', { key: 'lead:legacy1', workspaceId: 'ws_perf', title: 'Legacy Co' });
  writeRawKv('lead:999_other', { key: 'lead:legacy1', workspaceId: 'ws_elsewhere', title: 'Other WS' });

  assert.equal(await dbService.resolveLeadStorageKey('legacy1', 'ws_perf'), 'lead:123_abc');
  assert.equal(await dbService.resolveLeadStorageKey('lead:legacy1', 'ws_perf'), 'lead:123_abc');
  assert.equal(await dbService.resolveLeadStorageKey('LEAD:legacy1', 'ws_perf'), 'lead:123_abc');
  assert.equal(await dbService.resolveLeadStorageKey('legacy1', 'ws_elsewhere'), 'lead:999_other');
  assert.equal(await dbService.resolveLeadStorageKey('missing_key', 'ws_perf'), null);
  assert.equal(await dbService.resolveLeadStorageKey('legacy1', 'ws_nobody'), null);
});

test('getLeadTitlesByKeys returns title and workspace, ignoring missing keys', () => {
  writeRawKv('lead:t1', { key: 'lead:t1', workspaceId: 'ws_perf', title: 'Title One' });
  writeRawKv('lead:t2', { key: 'lead:t2', workspaceId: 'ws_perf' });

  const found = dbService.getLeadTitlesByKeys(['lead:t1', 'lead:t2', 'lead:gone', '', null]);
  assert.deepEqual(found.get('lead:t1'), { title: 'Title One', workspaceId: 'ws_perf' });
  assert.deepEqual(found.get('lead:t2'), { title: '', workspaceId: 'ws_perf' });
  assert.equal(found.has('lead:gone'), false);
  assert.equal(found.size, 2);
});
