const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-lead-sources-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');
const { executeCrmTool, TOOL_NAMES, getOpenAiFunctionTools } = require('../services/mcp/mcpToolExecutor');
const { createCrmMcpServer, getOpenAiToolManifest } = require('../services/mcp/mcpServerFactory');
const { LEAD_SOURCE_TOOL_NAMES } = require('../services/mcp/mcpLeadSources');

const OWNER = 'owner@example.com';
let n = 0;

async function setup() {
  n += 1;
  const wid = `ws_sources_${n}`;
  await dbService.saveWorkspace(wid, {
    id: wid,
    name: 'Sources WS',
    ownerUserId: OWNER,
    isDemo: true,
    timezone: 'America/Chicago',
    members: { [OWNER]: { role: 'owner' } },
  });
  const lead = async (fields) => (await dbService.saveLeadWithMeta({ workspaceId: wid, city: 'Camas', state: 'WA', ...fields })).key;
  return { wid, ctx: { workspaceId: wid, userEmail: OWNER }, lead };
}

test('every lead-source tool is on the MCP server, the manifest and the Ask AI function list', () => {
  const registered = Object.keys(createCrmMcpServer({ workspaceId: 'x' })._registeredTools);
  const manifest = getOpenAiToolManifest().tools.map((t) => t.name);
  const fns = getOpenAiFunctionTools().map((t) => t.function.name);
  for (const name of LEAD_SOURCE_TOOL_NAMES) {
    assert.ok(TOOL_NAMES.includes(name), name);
    assert.ok(registered.includes(name), name);
    assert.ok(manifest.includes(name), name);
    assert.ok(fns.includes(name), name);
  }
});

test('schedule_search saves a weekly Maps search, lists only this workspace, and deletes it', async () => {
  const { ctx } = await setup();
  const other = await setup();
  await executeCrmTool(other.ctx, 'schedule_search', { source: 'maps', query: 'Roofers', location: 'Tampa, FL', repeat: 'daily' });

  const res = await executeCrmTool(ctx, 'schedule_search', {
    source: 'maps',
    query: 'Plumbers',
    location: 'Camas, WA',
    repeat: 'weekly',
    time: '8:30',
    folder_name: 'Weekly Plumbers',
  });
  assert.equal(res.success, true, res.error);
  assert.equal(res.schedule.repeat, 'weekly');
  assert.equal(res.schedule.time, '08:30');
  assert.equal(res.schedule.timezone, 'America/Chicago');
  assert.equal(res.schedule.folder.name, 'Weekly Plumbers');

  const listed = await executeCrmTool(ctx, 'list_search_schedules', {});
  assert.equal(listed.count, 1);
  assert.equal(listed.schedules[0].query, 'Plumbers');

  const foreign = (await executeCrmTool(other.ctx, 'list_search_schedules', {})).schedules[0];
  const blocked = await executeCrmTool(ctx, 'delete_search_schedule', { schedule_id: foreign.schedule_id });
  assert.equal(blocked.success, false);
  assert.equal(blocked.code, 'NOT_FOUND');

  const del = await executeCrmTool(ctx, 'delete_search_schedule', { schedule_id: res.schedule.schedule_id });
  assert.equal(del.success, true, del.error);
  assert.equal((await executeCrmTool(ctx, 'list_search_schedules', {})).count, 0);

  const past = await executeCrmTool(ctx, 'schedule_search', {
    source: 'maps',
    query: 'Plumbers',
    location: 'Camas, WA',
    repeat: 'once',
    date: '2020-01-01',
  });
  assert.equal(past.success, false);
  assert.equal(past.code, 'INVALID_ARGUMENTS');
});

test('search_lead_source validates input before starting anything', async () => {
  const { ctx } = await setup();
  const formations = await executeCrmTool(ctx, 'search_lead_source', { source: 'business_formations', states: ['TX'] });
  assert.equal(formations.success, false);
  assert.match(formations.error, /supported state/);

  const listings = await executeCrmTool(ctx, 'search_lead_source', { source: 'real_estate', query: 'mobile homes' });
  assert.equal(listings.success, false);
  assert.equal(listings.code, 'NEED_LOCATION');
});

test('the search queue runs custom source runners and fails cleanly when one throws', async () => {
  const leadGen = require('../services/mcp/mcpLeadGen');
  leadGen._resetSearchQueueForTests();
  const { wid, ctx } = await setup();
  const folder = await dbService.createFolder(wid, 'Permits Test');
  let startedWith = null;
  const ok = await leadGen.enqueueSearch(ctx, {
    folder,
    keyword: 'roofing',
    source: 'permits',
    start: async (f) => {
      startedWith = f.key;
    },
  });
  assert.equal(ok.status, 'running');
  assert.equal(startedWith, folder.key);

  leadGen._resetSearchQueueForTests();
  const bad = await leadGen.enqueueSearch(ctx, {
    folder,
    keyword: 'roofing',
    source: 'permits',
    start: async () => {
      throw new Error('Permit Stack down');
    },
  });
  assert.equal(bad.status, 'failed');
  assert.equal(bad.error, 'Permit Stack down');
  const status = await executeCrmTool(ctx, 'get_search_status', { search_id: bad.id });
  assert.equal(status.search.source, 'permits');
  leadGen._resetSearchQueueForTests();
});

test('save_folder_search stores the preset on the folder', async () => {
  const { wid, ctx } = await setup();
  const folder = await dbService.createFolder(wid, 'HVAC Leads');
  const res = await executeCrmTool(ctx, 'save_folder_search', {
    folder_id: folder.key,
    query: 'HVAC contractors',
    location: 'Vancouver, WA',
    min_rating: 4,
    max_results: 40,
  });
  assert.equal(res.success, true, res.error);
  const saved = await dbService.getFolder(wid, folder.key);
  assert.equal(saved.searchPreset.keyword, 'HVAC contractors');
  assert.equal(saved.searchPreset.city, 'Vancouver');
  assert.equal(saved.searchPreset.maxResults, 40);
  assert.equal(saved.searchPreset.minRating, 4);
});

test('import_leads_csv creates leads in a folder and updates them on re-import', async () => {
  const { wid, ctx } = await setup();
  const csv = 'Business Name,Phone,City,State\nAcme Roofing,360-555-0101,Camas,WA\nBeta Electric,360-555-0102,Camas,WA\n';
  const first = await executeCrmTool(ctx, 'import_leads_csv', { csv_text: csv, folder_name: 'Imported' });
  assert.equal(first.success, true, first.error);
  assert.equal(first.created, 2);
  assert.equal(first.folder.name, 'Imported');

  const again = await executeCrmTool(ctx, 'import_leads_csv', { csv_text: csv, folder_id: first.folder.key });
  assert.equal(again.created, 0);
  assert.equal(again.updated, 2);

  const leads = await dbService.getAllLeads(wid);
  assert.equal(leads.length, 2);
  assert.ok(leads.every((l) => l.folderKey === first.folder.key));
});

test('find_duplicate_leads groups matches and merge_leads folds them into the primary', async () => {
  const { wid, ctx, lead } = await setup();
  const a = await lead({ title: 'Camas Plumbing', website: 'https://camasplumbing.com', phone: '3605550111' });
  const b = await lead({ title: 'Riverside Pipes', phone: '3605550199' });
  await dbService.updateLead(b, { website: 'http://www.camasplumbing.com/contact' }, wid);
  await lead({ title: 'Other Co', website: 'https://other.example' });

  const found = await executeCrmTool(ctx, 'find_duplicate_leads', {});
  assert.equal(found.success, true, found.error);
  assert.equal(found.groups_found, 1);
  assert.equal(found.groups[0].matched_on, 'domain');
  assert.deepEqual(found.groups[0].leads.map((l) => l.id).sort(), [a, b].sort());

  const merged = await executeCrmTool(ctx, 'merge_leads', { lead_ids: [a, b], primary_lead_id: a });
  assert.equal(merged.success, true, merged.error);
  assert.equal(merged.primary_lead_id, a);
  assert.deepEqual(merged.deleted_lead_ids, [b]);
  assert.equal(await dbService.getLead(b), null);
  assert.equal((await dbService.getAllLeads(wid)).length, 2);
});

test('deep_enrich_lead requires steps and reports per-step failures', async () => {
  const { ctx, lead } = await setup();
  const key = await lead({ title: 'No Phone Co' });

  const missing = await executeCrmTool(ctx, 'deep_enrich_lead', { lead_id: key });
  assert.equal(missing.success, false);
  assert.equal(missing.code, 'INVALID_ARGUMENTS');

  const res = await executeCrmTool(ctx, 'deep_enrich_lead', { lead_id: key, steps: ['phone_line_type'] });
  assert.equal(res.success, true, res.error);
  assert.equal(res.results.phone_line_type.ok, false);
  assert.equal(res.results.phone_line_type.code, 'no_phone');
});
