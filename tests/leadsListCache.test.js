const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leads-list-cache-'));
process.env.APP_DATA_DIR = tmpDataDir;

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const dbService = require('../services/database');
const {
  latestActivityTimestampMs,
  leadHasActivitySince,
  leadLogsMentionReply,
} = require('../services/leadActivityWindow');

const WS_A = 'ws_cache_a';
const WS_B = 'ws_cache_b';
const ALIAS_KEY = 'sys:legacy_default_workspace_id';

/** What a cold getAllLeads scan returns, read straight from SQLite (bypasses the in-memory cache). */
function freshScan(wid) {
  const db = new Database(path.join(tmpDataDir, 'app.db'), { readonly: true });
  try {
    const aliasRow = db.prepare('SELECT value FROM kv WHERE key = ?').get(ALIAS_KEY);
    const alias = aliasRow && typeof aliasRow.value === 'string' ? aliasRow.value.trim() : '';
    const out = [];
    for (const row of db.prepare("SELECT key, value FROM kv WHERE key LIKE 'lead:%'").all()) {
      let parsed;
      try {
        parsed = JSON.parse(row.value);
      } catch {
        continue;
      }
      if (!parsed || typeof parsed !== 'object') continue;
      let lw = parsed.workspaceId || 'default';
      if ((lw === 'default' || lw === '') && alias) lw = alias;
      if (lw !== wid) continue;
      out.push({ ...parsed, key: row.key, workspaceId: wid });
    }
    const ts = (k) => parseInt(String(k).split(':')[1], 10) || 0;
    return out.sort((a, b) => ts(b.key) - ts(a.key));
  } finally {
    db.close();
  }
}

async function put(key, lead) {
  await dbService.putStorageKey(key, lead);
}

async function assertMatchesFresh(wid) {
  const cached = await dbService.getAllLeads(wid);
  assert.deepEqual(cached, freshScan(wid));
  return cached;
}

test('leads list cache stays in sync with lead writes', async (t) => {
  await put('lead:1000', { title: 'A one', workspaceId: WS_A, status: 'New' });
  await put('lead:3000', { title: 'A three', workspaceId: WS_A, status: 'New' });
  await put('lead:2000', { title: 'B two', workspaceId: WS_B, status: 'New' });

  // Warm both workspace caches.
  assert.deepEqual((await dbService.getAllLeads(WS_A)).map((l) => l.key), ['lead:3000', 'lead:1000']);
  assert.deepEqual((await dbService.getAllLeads(WS_B)).map((l) => l.key), ['lead:2000']);

  await t.test('updateLead is visible immediately', async () => {
    await dbService.updateLead('lead:1000', { status: 'Contacted', notes: 'called' }, WS_A);
    const leads = await assertMatchesFresh(WS_A);
    const lead = leads.find((l) => l.key === 'lead:1000');
    assert.equal(lead.status, 'Contacted');
    assert.equal(lead.notes, 'called');
  });

  await t.test('new lead rows land in key-timestamp order', async () => {
    await put('lead:2500', { title: 'A two-five', workspaceId: WS_A });
    await put('lead:9000', { title: 'A nine', workspaceId: WS_A });
    await put('lead:500', { title: 'A half', workspaceId: WS_A });
    const leads = await assertMatchesFresh(WS_A);
    assert.deepEqual(
      leads.map((l) => l.key),
      ['lead:9000', 'lead:3000', 'lead:2500', 'lead:1000', 'lead:500'],
    );
  });

  await t.test('saveLead shows up without waiting for the TTL', async () => {
    const key = await dbService.saveLead({ title: 'Saved Via Service Co', workspaceId: WS_A, source: 'manual' });
    const leads = await assertMatchesFresh(WS_A);
    assert.equal(leads[0].key, key);
    assert.equal(leads[0].title, 'Saved Via Service Co');
  });

  await t.test('deleteLead removes the lead', async () => {
    await dbService.deleteLead('lead:2500');
    const leads = await assertMatchesFresh(WS_A);
    assert.ok(!leads.some((l) => l.key === 'lead:2500'));
  });

  await t.test('writes stay inside their workspace', async () => {
    await dbService.updateLead('lead:2000', { status: 'Won' }, WS_B);
    const a = await assertMatchesFresh(WS_A);
    const b = await assertMatchesFresh(WS_B);
    assert.ok(!a.some((l) => l.key === 'lead:2000'));
    assert.equal(b.find((l) => l.key === 'lead:2000').status, 'Won');
  });

  await t.test('moving a lead between workspaces updates both lists', async () => {
    await dbService.updateLead('lead:3000', { workspaceId: WS_B });
    const a = await assertMatchesFresh(WS_A);
    const b = await assertMatchesFresh(WS_B);
    assert.ok(!a.some((l) => l.key === 'lead:3000'));
    assert.deepEqual(b.map((l) => l.key), ['lead:3000', 'lead:2000']);
    assert.equal(b[0].workspaceId, WS_B);
  });

  await t.test('corrupt lead JSON drops the row like a cold scan does', async () => {
    await put('lead:1000', '{not json');
    const a = await assertMatchesFresh(WS_A);
    assert.ok(!a.some((l) => l.key === 'lead:1000'));
    await put('lead:1000', { title: 'A one', workspaceId: WS_A, status: 'New' });
    await assertMatchesFresh(WS_A);
  });

  await t.test('changing the legacy default alias re-scopes default-workspace leads', async () => {
    await put('lead:4000', { title: 'Legacy default lead', workspaceId: 'default' });
    assert.ok(!(await assertMatchesFresh(WS_A)).some((l) => l.key === 'lead:4000'));
    await dbService.putStorageKey(ALIAS_KEY, WS_A);
    const a = await assertMatchesFresh(WS_A);
    const legacy = a.find((l) => l.key === 'lead:4000');
    assert.ok(legacy);
    assert.equal(legacy.workspaceId, WS_A);
    await put('lead:4100', { title: 'Another legacy lead', workspaceId: '' });
    assert.ok((await assertMatchesFresh(WS_A)).some((l) => l.key === 'lead:4100'));
    await dbService.deleteStorageKey(ALIAS_KEY);
    assert.ok(!(await assertMatchesFresh(WS_A)).some((l) => l.key === 'lead:4000'));
  });

  await t.test('callers get a copy of the cached array', async () => {
    const first = await dbService.getAllLeads(WS_A);
    const n = first.length;
    first.splice(0, first.length);
    first.push({ key: 'lead:1', title: 'bogus' });
    const again = await dbService.getAllLeads(WS_A);
    assert.equal(again.length, n);
    assert.ok(!again.some((l) => l.key === 'lead:1'));
  });

  await t.test('getAllLeadsUnscoped returns every lead newest-first and skips corrupt rows', async () => {
    await put('lead:5000', '{broken');
    const all = await dbService.getAllLeadsUnscoped();
    const keys = all.map((l) => l.key);
    const expected = [...freshScan(WS_A), ...freshScan(WS_B)]
      .map((l) => l.key)
      .sort((x, y) => parseInt(y.split(':')[1], 10) - parseInt(x.split(':')[1], 10));
    assert.ok(!keys.includes('lead:5000'));
    for (const k of expected) assert.ok(keys.includes(k), `missing ${k}`);
    const ts = keys.map((k) => parseInt(k.split(':')[1], 10));
    assert.deepEqual(ts, [...ts].sort((x, y) => y - x));
    assert.equal(all.find((l) => l.key === 'lead:2000').title, 'B two');
    await dbService.deleteLead('lead:5000');
  });
});

test('leadActivityWindow matches a direct scan and refreshes when activity changes', () => {
  const lead = {
    updates: [{ timestamp: '2026-01-01T00:00:00Z', text: 'a' }, null, { timestamp: 'garbage' }],
    logs: [{ type: 'call', message: 'left voicemail', timestamp: '2026-02-01T00:00:00Z' }],
  };
  const feb = Date.parse('2026-02-01T00:00:00Z');
  assert.equal(latestActivityTimestampMs(lead), feb);
  assert.equal(leadHasActivitySince(lead, feb), true);
  assert.equal(leadHasActivitySince(lead, feb + 1), false);
  assert.equal(leadLogsMentionReply(lead), false);

  // Appending in place (same array, new length) must refresh the memo.
  lead.logs.push({ type: 'sms_inbound', message: 'Replied yes', timestamp: '2026-03-01T00:00:00Z' });
  assert.equal(latestActivityTimestampMs(lead), Date.parse('2026-03-01T00:00:00Z'));
  assert.equal(leadLogsMentionReply(lead), true);

  // Replacing the array must refresh the memo too.
  lead.logs = [];
  lead.updates = [];
  assert.equal(latestActivityTimestampMs(lead), -Infinity);
  assert.equal(leadHasActivitySince(lead, 0), false);
  assert.equal(leadLogsMentionReply(lead), false);

  // Unexpected shapes are never skipped by window filters.
  assert.equal(leadHasActivitySince({ updates: { bad: true } }, Date.now()), true);
  assert.equal(latestActivityTimestampMs(null), -Infinity);
  assert.equal(leadHasActivitySince({}, 0), false);
});
