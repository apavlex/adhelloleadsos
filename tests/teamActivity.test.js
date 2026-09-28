const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'team-activity-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');
const teamActivity = require('../services/teamActivity');
const { applyLeadListFilters, leadListFilterQuerySuffix } = require('../services/leadListFilters');
const { _test: captureTest } = require('../middleware/teamActivityCapture');

function fakeReq(email, workspaceId = 'ws_team') {
  return { workspaceId, user: { emails: [{ value: email }], email, displayName: email.split('@')[0] }, headers: {} };
}

test('record writes activity and attribution; created_by sticks to the first actor', () => {
  const anna = fakeReq('Anna@Example.com');
  const bob = fakeReq('bob@example.com');
  teamActivity.record(anna, {
    category: 'search',
    action: 'maps_search',
    summary: 'Maps search "roofers"',
    leadKeys: ['abc', 'lead:def'],
    created: true,
  });
  teamActivity.record(bob, { category: 'tags', action: 'lead_tags', summary: 'Added Hot', leadKey: 'abc' });

  const rows = dbService.listTeamActivity({ workspaceId: 'ws_team' });
  assert.equal(rows.length, 2);
  assert.equal(rows[1].actor_email, 'anna@example.com');
  assert.deepEqual(rows[1].meta.leadKeys, ['lead:abc', 'lead:def']);
  assert.equal(rows[1].lead_count, 2);
  assert.equal(rows[0].lead_key, 'lead:abc');

  const attr = dbService.getLeadAttributions('ws_team', ['lead:abc', 'lead:def']);
  assert.equal(attr['lead:abc'].created_by, 'anna@example.com');
  assert.equal(attr['lead:abc'].last_by, 'bob@example.com');
  assert.equal(attr['lead:def'].last_by, 'anna@example.com');

  assert.deepEqual(dbService.listLeadKeysByActor('ws_team', 'bob@example.com', 'any'), ['lead:abc']);
  assert.equal(dbService.listLeadKeysByActor('ws_team', 'anna@example.com', 'any').length, 2);
});

test('authorLabel formats name and email, falling back to email', () => {
  assert.equal(
    teamActivity.authorLabel({ user: { emails: [{ value: 'Anna@Example.com' }], displayName: 'Anna Lee' } }),
    'Anna Lee (anna@example.com)',
  );
  assert.equal(teamActivity.authorLabel({ user: { emails: [{ value: 'bob@example.com' }] } }), 'bob@example.com');
  assert.equal(teamActivity.authorLabel({}), '');
});

test('record ignores unknown categories and missing actors without throwing', () => {
  assert.equal(teamActivity.record(fakeReq('x@example.com'), { category: 'ghl_sync', summary: 'nope' }), null);
  assert.equal(teamActivity.record({ workspaceId: 'ws_team', headers: {} }, { category: 'search' }), null);
  assert.equal(teamActivity.record(null, { category: 'search' }), null);
});

test('review checkpoints drive unseen counts per teammate', () => {
  const wid = 'ws_review';
  const carl = fakeReq('carl@example.com', wid);
  teamActivity.record(carl, { category: 'notes', action: 'note_add', summary: 'Note: one' });
  teamActivity.record(carl, { category: 'notes', action: 'note_add', summary: 'Note: two' });

  let stats = dbService.teamActivityActorStats(wid, teamActivity.getReviewCheckpoints(wid, 'me@example.com'));
  assert.equal(stats.find((s) => s.actor_email === 'carl@example.com').unseen, 2);

  teamActivity.markReviewed(wid, 'me@example.com', 'carl@example.com', Date.now() + 1);
  stats = dbService.teamActivityActorStats(wid, teamActivity.getReviewCheckpoints(wid, 'me@example.com'));
  assert.equal(stats.find((s) => s.actor_email === 'carl@example.com').unseen, 0);
});

test('memberDirectory merges workspace members with activity stats, newest first', () => {
  const ws = { members: { 'a@x.com': { role: 'owner', name: 'Ann' }, 'b@x.com': { role: 'admin' } } };
  const dir = teamActivity.memberDirectory(ws, [
    { actor_email: 'b@x.com', actor_name: 'Bea', total: 3, unseen: 1, last_at: 200 },
    { actor_email: 'gone@x.com', actor_name: '', total: 1, unseen: 1, last_at: 100 },
  ]);
  assert.deepEqual(
    dir.map((m) => m.email),
    ['b@x.com', 'gone@x.com', 'a@x.com'],
  );
  assert.equal(dir[0].name, 'Bea');
  assert.equal(dir[1].role, 'former');
  assert.equal(teamActivity.displayName(dir[2]), 'Ann');
  assert.equal(teamActivity.displayName({ email: 'zed@x.com' }), 'zed');
});

test('workedBy filter keeps only leads the teammate touched and stays out of the query suffix', () => {
  const filters = teamActivity.attachWorkedByKeys({ workedBy: 'BOB@example.com' }, 'ws_team');
  const leads = [{ key: 'lead:abc' }, { key: 'lead:def' }, { key: 'lead:zzz' }];
  assert.deepEqual(
    applyLeadListFilters(leads, filters).map((l) => l.key),
    ['lead:abc'],
  );
  assert.equal(leadListFilterQuerySuffix(filters), '&workedBy=BOB%40example.com');
});

test('search capture summary includes keyword, place and schedule mode', () => {
  const route = captureTest.SEARCH_ROUTES.find((r) => r.path === '/permits/search');
  assert.equal(
    captureTest.searchSummary(route, { permitKeyword: 'roof', city: 'Austin', state: 'TX' }),
    'Permit search "roof" in Austin, TX',
  );
  const formations = captureTest.SEARCH_ROUTES.find((r) => r.path === '/formations/search');
  assert.equal(
    captureTest.searchSummary(formations, { mode: 'schedule', stateCodes: ['NY', 'CO'] }),
    'Scheduled business formation search in NY, CO',
  );
});
