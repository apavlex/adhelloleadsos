const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pavlex-leadgen-'));
process.env.APP_DATA_DIR = tmpDataDir;

const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');
const workspaceIntegrations = require('../services/workspaceIntegrations');
const mapsSearch = require('../services/mapsSearch');
const scrapeJobRunner = require('../services/scrapeJobRunner');
const { executeCrmTool, TOOL_NAMES, getOpenAiFunctionTools } = require('../services/mcp/mcpToolExecutor');
const { getOpenAiToolManifest } = require('../services/mcp/mcpServerFactory');
const leadGen = require('../services/mcp/mcpLeadGen');
const { CRM_COMMAND_HINTS } = require('../services/pavlex/pavlexConstants');
const { matchDirectCrmQuery } = require('../services/pavlex/pavlexCrmDirect');
const { isCrmIntent } = require('../services/pavlex/pavlexCrmIntent');
const { normalizeBoards } = require('../services/opportunityBoards');

const WS_A = 'ws_leadgen_a';
const WS_B = 'ws_leadgen_b';
const ctxA = { workspaceId: WS_A, userEmail: 'owner@a.test' };
const ctxB = { workspaceId: WS_B, userEmail: 'owner@b.test' };

const NEW_TOOLS = [
  'create_folder',
  'rename_folder',
  'find_leads',
  'get_search_status',
  'bookmark_leads',
  'save_script',
  'move_opportunities',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, { timeoutMs = 4000, stepMs = 25 } = {}) {
  const started = Date.now();
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const v = await fn();
    if (v) return v;
    if (Date.now() - started > timeoutMs) throw new Error('waitFor timed out');
    // eslint-disable-next-line no-await-in-loop
    await sleep(stepMs);
  }
}

let leadSeq = 0;
async function seedLead(workspaceId, fields) {
  leadSeq += 1;
  const saved = await dbService.saveLeadWithMeta({
    title: `Lead ${leadSeq}`,
    phone: `(360) 555-${String(1000 + leadSeq)}`,
    city: 'Camas',
    state: 'WA',
    website: `https://lead${leadSeq}-${workspaceId}.example.com`,
    workspaceId,
    ...fields,
  });
  await sleep(2);
  return saved.key;
}

const original = {
  getEnv: workspaceIntegrations.getResolvedIntegrationEnv,
  configured: mapsSearch.isMapsSearchConfigured,
  execute: scrapeJobRunner.executeScrapeJob,
};

before(async () => {
  await dbService.saveWorkspace(WS_A, { id: WS_A, name: 'Flooring Co', members: {} });
  await dbService.saveWorkspace(WS_B, { id: WS_B, name: 'Other Co', members: {} });
});

after(() => {
  workspaceIntegrations.getResolvedIntegrationEnv = original.getEnv;
  mapsSearch.isMapsSearchConfigured = original.configured;
  scrapeJobRunner.executeScrapeJob = original.execute;
  leadGen._resetSearchQueueForTests();
});

describe('Pavlex lead-gen tool registry', () => {
  it('registers every new tool in TOOL_NAMES, inline function tools, and the MCP manifest', () => {
    const fnNames = getOpenAiFunctionTools().map((t) => t.function.name);
    const manifestNames = getOpenAiToolManifest().tools.map((t) => t.name);
    for (const name of NEW_TOOLS) {
      assert.ok(TOOL_NAMES.includes(name), `TOOL_NAMES missing ${name}`);
      assert.ok(fnNames.includes(name), `function tools missing ${name}`);
      assert.ok(manifestNames.includes(name), `manifest missing ${name}`);
    }
  });

  it('prompt hints map the lead-gen phrases and separate folders from pipelines', () => {
    for (const name of ['create_folder', 'find_leads', 'bookmark_leads', 'save_script', 'move_opportunities']) {
      assert.match(CRM_COMMAND_HINTS, new RegExp(name));
    }
    assert.match(CRM_COMMAND_HINTS, /never create pipelines when asked for folders/i);
  });

  it('direct shortcuts leave new-lead searches to the model', () => {
    assert.equal(matchDirectCrmQuery('find 20 interior designers in Camas WA and put them in Referral Partners'), null);
    assert.equal(matchDirectCrmQuery('find referral partners for flooring in Camas'), null);
    assert.equal(matchDirectCrmQuery('find Acme Roofing').tool, 'search_leads');
    assert.equal(isCrmIntent('find 20 interior designers in Camas WA'), true);
    assert.equal(isCrmIntent('send the bookmarked ones to opportunities for review'), true);
  });
});

describe('create_folder', () => {
  it('creates real lead folders (not pipelines) and is idempotent by name', async () => {
    const pipelinesBefore = normalizeBoards((await dbService.getWorkspace(WS_A)).opportunityBoards).boards
      .pipelines.length;
    const first = await executeCrmTool(ctxA, 'create_folder', {
      names: ['Electricians', 'HVAC', 'Plumbers', 'Roofers', 'Painters'],
    });
    assert.equal(first.success, true, first.error);
    assert.equal(first.created, 5);
    const keys = new Set(first.folders.map((f) => f.key));
    assert.equal(keys.size, 5, 'each folder gets a distinct key');

    const folders = await dbService.listFolders(WS_A);
    for (const n of ['Electricians', 'HVAC', 'Plumbers', 'Roofers', 'Painters']) {
      assert.ok(folders.some((f) => f.name === n), `folder ${n} persisted`);
    }

    const again = await executeCrmTool(ctxA, 'create_folder', { name: 'hvac' });
    assert.equal(again.success, true);
    assert.equal(again.existed, true);
    assert.equal(again.folder.name, 'HVAC');
    assert.equal((await dbService.listFolders(WS_A)).length, folders.length);

    const pipelinesAfter = normalizeBoards((await dbService.getWorkspace(WS_A)).opportunityBoards).boards
      .pipelines.length;
    assert.equal(pipelinesAfter, pipelinesBefore, 'no opportunity pipelines created');

    const activity = dbService.listTeamActivity({ workspaceId: WS_A, category: 'leads', limit: 50 });
    assert.ok(activity.some((a) => /Created folder "Electricians"/.test(a.summary)));
  });

  it('nests under a parent folder and keeps workspaces isolated', async () => {
    const nested = await executeCrmTool(ctxA, 'create_folder', {
      name: 'Referral Partners',
      parent_folder_name: 'Plumbers',
    });
    assert.equal(nested.success, true, nested.error);
    const parent = (await dbService.listFolders(WS_A)).find((f) => f.name === 'Plumbers');
    assert.equal(nested.folder.parentFolderKey, parent.key);

    const inB = await executeCrmTool(ctxB, 'create_folder', { name: 'HVAC' });
    assert.equal(inB.success, true);
    assert.equal(inB.existed, false, 'workspace B does not see workspace A folders');
    assert.ok(inB.folder.key.startsWith(`folder:${WS_B}:`));
    assert.ok((await dbService.listFolders(WS_A)).every((f) => f.key.startsWith(`folder:${WS_A}:`)));
  });

  it('rejects an empty name and renames folders', async () => {
    const bad = await executeCrmTool(ctxA, 'create_folder', { names: ['  '] });
    assert.equal(bad.success, false);
    assert.equal(bad.code, 'INVALID_ARGUMENT');

    const renamed = await executeCrmTool(ctxA, 'rename_folder', { folder_name: 'Painters', new_name: 'House Painters' });
    assert.equal(renamed.success, true, renamed.error);
    assert.equal(renamed.folder.name, 'House Painters');
    const clash = await executeCrmTool(ctxA, 'rename_folder', { folder_name: 'House Painters', new_name: 'HVAC' });
    assert.equal(clash.success, false);
    assert.equal(clash.code, 'CONFLICT');
  });
});

describe('list_leads sort + bookmark_leads', () => {
  let folderKey;
  const keys = {};

  before(async () => {
    const out = await executeCrmTool(ctxA, 'create_folder', { name: 'Sort Test' });
    folderKey = out.folder.key;
    keys.low = await seedLead(WS_A, { title: 'Low Rated', totalScore: 3.1, reviewsCount: 400, folderKey });
    keys.top = await seedLead(WS_A, { title: 'Top Rated', totalScore: 4.9, reviewsCount: 12, folderKey });
    keys.mid = await seedLead(WS_A, { title: 'Mid Rated', totalScore: 4.2, reviewsCount: 80, folderKey });
    keys.other = await seedLead(WS_B, { title: 'Other Workspace Lead', totalScore: 5 });
  });

  it('sorts by rating, reviews, and newest', async () => {
    const byRating = await executeCrmTool(ctxA, 'list_leads', { folder_name: 'Sort Test', sort: 'rating', limit: 2 });
    assert.equal(byRating.success, true, byRating.error);
    assert.deepEqual(byRating.leads.map((l) => l.title), ['Top Rated', 'Mid Rated']);
    const byReviews = await executeCrmTool(ctxA, 'list_leads', { folder_name: 'Sort Test', sort: 'reviews' });
    assert.equal(byReviews.leads[0].title, 'Low Rated');
    const newest = await executeCrmTool(ctxA, 'list_leads', { folder_name: 'Sort Test', sort: 'newest' });
    assert.equal(newest.leads[0].title, 'Mid Rated');
    const byScore = await executeCrmTool(ctxA, 'list_leads', { folder_name: 'Sort Test', sort: 'score' });
    assert.equal(byScore.success, true, byScore.error);
    assert.ok(byScore.leads.every((l) => typeof l.score === 'number'));
  });

  it('bookmarks the top N and refuses leads from another workspace', async () => {
    const top = await executeCrmTool(ctxA, 'list_leads', { folder_name: 'Sort Test', sort: 'rating', limit: 2 });
    const ids = top.leads.map((l) => l.key);
    const out = await executeCrmTool(ctxA, 'bookmark_leads', { lead_ids: [...ids, keys.other] });
    assert.equal(out.success, true, out.error);
    assert.equal(out.changed, 2);
    assert.equal(out.failed, 1);
    assert.equal((await dbService.getLead(keys.top)).bookmarked, true);
    assert.ok(!(await dbService.getLead(keys.other)).bookmarked, 'other workspace lead untouched');

    const repeat = await executeCrmTool(ctxA, 'bookmark_leads', { lead_ids: [keys.top] });
    assert.equal(repeat.unchanged, 1);

    const listed = await executeCrmTool(ctxA, 'list_leads', { bookmarked_only: true });
    assert.equal(listed.success, true, listed.error);
    assert.equal(listed.scope, 'workspace');
    assert.deepEqual(listed.leads.map((l) => l.title).sort(), ['Mid Rated', 'Top Rated']);

    const activity = dbService.listTeamActivity({ workspaceId: WS_A, leadKey: keys.top, limit: 10 });
    assert.ok(activity.some((a) => a.summary === 'Bookmarked'));

    const un = await executeCrmTool(ctxA, 'bookmark_leads', { lead_ids: [keys.mid], bookmarked: false });
    assert.equal(un.changed, 1);
    assert.ok(!(await dbService.getLead(keys.mid)).bookmarked);
  });
});

describe('move_opportunities', () => {
  it('moves many leads to the default stage and reports per-lead results', async () => {
    const a1 = await seedLead(WS_A, { title: 'Opp One' });
    const a2 = await seedLead(WS_A, { title: 'Opp Two' });
    const b1 = await seedLead(WS_B, { title: 'Opp Foreign' });
    const pipes = await executeCrmTool(ctxA, 'list_opportunity_pipelines', {});
    const active = pipes.pipelines.find((p) => p.id === pipes.activePipelineId) || pipes.pipelines[0];
    const expectedStage =
      active.stages.find((s) => /review/i.test(s.name)) || active.stages[0];

    const out = await executeCrmTool(ctxA, 'move_opportunities', { lead_ids: [a1, a2, b1, 'lead:missing'] });
    assert.equal(out.success, true, out.error);
    assert.equal(out.moved, 2);
    assert.equal(out.failed, 2);
    assert.equal(out.stageId, expectedStage.id);
    const l1 = await dbService.getLead(a1);
    assert.equal(l1.opportunityPipelineId, active.id);
    assert.equal(l1.opportunityStageId, expectedStage.id);
    assert.equal(l1.onPipelineBoard, true);
    assert.ok(!(await dbService.getLead(b1)).opportunityStageId, 'foreign lead untouched');

    const lastStage = active.stages[active.stages.length - 1];
    const named = await executeCrmTool(ctxA, 'move_opportunities', {
      lead_ids: [a1],
      pipeline_name: active.name,
      stage_name: lastStage.name,
    });
    assert.equal(named.success, true, named.error);
    assert.equal((await dbService.getLead(a1)).opportunityStageId, lastStage.id);

    const bad = await executeCrmTool(ctxA, 'move_opportunities', { lead_ids: [a1], stage_name: 'Nope' });
    assert.equal(bad.success, false);
  });
});

describe('save_script', () => {
  it('saves to the workspace script library (idempotent) and tags the folder in the title', async () => {
    const body = 'Hi {{name}}, I work with designers around {{city}} — could {{company}} use a flooring partner?';
    const out = await executeCrmTool(ctxA, 'save_script', {
      name: 'Designer opener',
      body,
      folder_name: 'Referral Partners',
    });
    assert.equal(out.success, true, out.error);
    assert.equal(out.script.title, 'Referral Partners — Designer opener');
    assert.equal(out.script.section, 'opening');
    const ws = await dbService.getWorkspace(WS_A);
    const saved = ws.salesScriptLibraryItems.find((i) => i.id === out.script.id);
    assert.equal(saved.text, body);

    const dup = await executeCrmTool(ctxA, 'save_script', { name: 'Designer opener', body, folder_name: 'Referral Partners' });
    assert.equal(dup.duplicate, true);
    assert.equal((await dbService.getWorkspace(WS_A)).salesScriptLibraryItems.length, 1);
    assert.ok(!((await dbService.getWorkspace(WS_B)).salesScriptLibraryItems || []).length);

    const missing = await executeCrmTool(ctxA, 'save_script', { name: 'x', body: '' });
    assert.equal(missing.success, false);
  });
});

describe('find_leads', () => {
  let executeCalls;
  let releaseSearch;

  beforeEach(async () => {
    leadGen._resetSearchQueueForTests({ pollIntervalMs: 20 });
    await dbService.clearActiveJob({});
    executeCalls = [];
    releaseSearch = null;
    workspaceIntegrations.getResolvedIntegrationEnv = async () => ({ RAPIDAPI_KEY: 'test' });
    mapsSearch.isMapsSearchConfigured = () => true;
    scrapeJobRunner.executeScrapeJob = async (schedule) => {
      executeCalls.push(schedule);
      if (schedule.keyword === 'Slow Trade') {
        await new Promise((r) => {
          releaseSearch = r;
        });
      }
      const slug = schedule.keyword.toLowerCase().replace(/\W+/g, '-');
      const n = schedule.keyword.length;
      return ['A', 'B'].map((suffix, i) => ({
        title: `${schedule.keyword} Studio ${suffix}`,
        phone: `(360) 5${String(n).padStart(2, '0')}-00${i}${n % 10}`,
        city: schedule.city,
        state: schedule.state,
        website: `https://${slug}-${suffix.toLowerCase()}.example.com`,
        totalScore: 4.8 - i,
        reviewsCount: 30 - i * 20,
      }));
    };
  });

  it('returns quickly, then saves results into the target folder in this workspace only', async () => {
    const started = Date.now();
    const out = await executeCrmTool(ctxA, 'find_leads', {
      query: 'Interior Designers',
      location: 'Camas, WA',
      max_results: 500,
      folder_name: 'Referral Partners',
    });
    assert.equal(out.success, true, out.error);
    assert.ok(Date.now() - started < 1500, 'tool call returns without waiting for the search');
    assert.equal(out.async, true);
    assert.equal(out.status, 'running');
    assert.equal(out.maxResults, leadGen.MAX_RESULTS_CAP);
    assert.equal(out.city, 'Camas');
    assert.equal(out.state, 'WA');
    assert.equal(out.folderCreated, false, 'reuses the existing Referral Partners folder');

    const status = await waitFor(async () => {
      const s = await executeCrmTool(ctxA, 'get_search_status', { search_id: out.search_id });
      return s.search && s.search.status === 'completed' ? s : null;
    });
    assert.equal(status.search.newLeadsSaved, 2);
    assert.equal(executeCalls[0].keyword, 'Interior Designers');
    assert.equal(executeCalls[0].maxResults, leadGen.MAX_RESULTS_CAP);

    const folder = (await dbService.listFolders(WS_A)).find((f) => f.name === 'Referral Partners');
    const leadsA = await dbService.getAllLeads(WS_A);
    const inFolder = leadsA.filter((l) => l.folderKey === folder.key && /Interior Designers Studio/.test(l.title));
    assert.equal(inFolder.length, 2);
    const leadsB = await dbService.getAllLeads(WS_B);
    assert.ok(!leadsB.some((l) => /Interior Designers Studio/.test(l.title)), 'nothing leaks into workspace B');

    const otherWs = await executeCrmTool(ctxB, 'get_search_status', { search_id: out.search_id });
    assert.equal(otherWs.search, null, 'workspace B cannot read workspace A search');

    const activity = dbService.listTeamActivity({ workspaceId: WS_A, category: 'search', limit: 10 });
    assert.ok(activity.some((a) => /Interior Designers/.test(a.summary)));
  });

  it('dedupes a repeat search like the UI and creates a missing folder', async () => {
    const out = await executeCrmTool(ctxA, 'find_leads', {
      query: 'Interior Designers',
      city: 'Camas',
      state: 'Washington',
      folder_name: 'Designers Camas',
    });
    assert.equal(out.success, true, out.error);
    assert.equal(out.folderCreated, true);
    assert.equal(out.maxResults, leadGen.DEFAULT_MAX_RESULTS);
    const done = await waitFor(async () => {
      const s = await executeCrmTool(ctxA, 'get_search_status', { search_id: out.search_id });
      return s.search && s.search.status === 'completed' ? s : null;
    });
    assert.equal(done.search.newLeadsSaved, 0, 'same businesses merge instead of duplicating');
  });

  it('queues behind a running search and starts it automatically', async () => {
    const first = await executeCrmTool(ctxA, 'find_leads', { query: 'Slow Trade', location: 'Camas WA' });
    assert.equal(first.status, 'running');
    await waitFor(() => releaseSearch);
    const second = await executeCrmTool(ctxA, 'find_leads', { query: 'Realtors', location: 'Camas, WA', folder_name: 'Referral Partners' });
    assert.equal(second.success, true, second.error);
    assert.equal(second.status, 'queued');
    assert.equal(second.queuePosition, 1);

    releaseSearch();
    const done = await waitFor(async () => {
      const s = await executeCrmTool(ctxA, 'get_search_status', { search_id: second.search_id });
      return s.search && s.search.status === 'completed' ? s : null;
    });
    assert.equal(done.search.newLeadsSaved, 2);
    assert.deepEqual(executeCalls.map((c) => c.keyword), ['Slow Trade', 'Realtors']);
    const recent = await executeCrmTool(ctxA, 'get_search_status', {});
    assert.ok(recent.searches.length >= 2);
  });

  it('returns clear errors when the provider is missing or the location is incomplete', async () => {
    mapsSearch.isMapsSearchConfigured = () => false;
    const noProvider = await executeCrmTool(ctxA, 'find_leads', { query: 'Realtors', location: 'Camas, WA' });
    assert.equal(noProvider.success, false);
    assert.equal(noProvider.code, 'PROVIDER_NOT_CONFIGURED');
    assert.match(noProvider.error, /API integrations/);

    mapsSearch.isMapsSearchConfigured = () => true;
    const noState = await executeCrmTool(ctxA, 'find_leads', { query: 'Realtors', location: 'Camas' });
    assert.equal(noState.success, false);
    assert.equal(noState.code, 'NEED_LOCATION');
    assert.equal(executeCalls.length, 0);
  });
});
