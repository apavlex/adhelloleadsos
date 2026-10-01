const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pavlex-crm-actions-'));
process.env.APP_DATA_DIR = tmpDataDir;
delete process.env.GHL_API_KEY;
delete process.env.GHL_LOCATION_ID;

const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');
const workspaceIntegrations = require('../services/workspaceIntegrations');
const ghlClient = require('../services/ghlClient');
const { executeCrmTool, TOOL_NAMES, getOpenAiFunctionTools } = require('../services/mcp/mcpToolExecutor');
const { getOpenAiToolManifest } = require('../services/mcp/mcpServerFactory');
const leadActions = require('../services/mcp/mcpLeadActions');
const { filterManualUserTasks, dedupeOpenLeadTasks, TASK_SOURCE_LEAD_TASK } = require('../services/userTasks');
const { CRM_COMMAND_HINTS } = require('../services/pavlex/pavlexConstants');
const { matchDirectCrmQuery } = require('../services/pavlex/pavlexCrmDirect');
const { isCrmIntent } = require('../services/pavlex/pavlexCrmIntent');

const WS_A = 'ws_actions_a';
const WS_B = 'ws_actions_b';
const ctxA = { workspaceId: WS_A, userEmail: 'owner@a.test' };
const ctxB = { workspaceId: WS_B, userEmail: 'owner@b.test' };

const NEW_TOOLS = ['list_tags', 'tag_leads', 'sync_leads_to_ghl', 'get_ghl_sync_status', 'list_team_members'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, { timeoutMs = 4000, stepMs = 20 } = {}) {
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
    phone: `(360) 555-${String(2000 + leadSeq)}`,
    city: 'Camas',
    state: 'WA',
    website: `https://act${leadSeq}-${workspaceId}.example.com`,
    workspaceId,
    ...fields,
  });
  await sleep(2);
  return saved.key;
}

const original = {
  getEnv: workspaceIntegrations.getResolvedIntegrationEnv,
  search: ghlClient.searchContactByEmailOrPhone,
  create: ghlClient.createContact,
  update: ghlClient.updateContact,
  tags: ghlClient.syncContactTags,
  fetch: global.fetch,
};

before(async () => {
  await dbService.saveWorkspace(WS_A, {
    id: WS_A,
    name: 'Flooring Co',
    ownerUserId: 'owner@a.test',
    members: {
      'owner@a.test': { role: 'owner', name: 'Alex Owner' },
      'maria@a.test': { role: 'sdr', name: 'Maria Lopez' },
      'mark@a.test': { role: 'admin', name: 'Mark Diaz' },
    },
  });
  await dbService.saveWorkspace(WS_B, {
    id: WS_B,
    name: 'Other Co',
    ownerUserId: 'owner@b.test',
    members: {
      'owner@b.test': { role: 'owner', name: 'Bea Owner' },
      'olga@b.test': { role: 'sdr', name: 'Olga Petrova' },
    },
  });
});

after(() => {
  workspaceIntegrations.getResolvedIntegrationEnv = original.getEnv;
  ghlClient.searchContactByEmailOrPhone = original.search;
  ghlClient.createContact = original.create;
  ghlClient.updateContact = original.update;
  ghlClient.syncContactTags = original.tags;
  global.fetch = original.fetch;
  leadActions._resetGhlJobsForTests();
});

describe('Pavlex CRM action tool registry', () => {
  it('registers the new tools everywhere and exposes assignee on task tools', () => {
    const fnTools = getOpenAiFunctionTools();
    const fnNames = fnTools.map((t) => t.function.name);
    const manifest = getOpenAiToolManifest().tools;
    for (const name of NEW_TOOLS) {
      assert.ok(TOOL_NAMES.includes(name), `TOOL_NAMES missing ${name}`);
      assert.ok(fnNames.includes(name), `function tools missing ${name}`);
      assert.ok(manifest.some((t) => t.name === name), `manifest missing ${name}`);
    }
    for (const name of ['create_task', 'update_task', 'list_tasks']) {
      const fn = fnTools.find((t) => t.function.name === name);
      assert.ok(fn.function.parameters.properties.assignee, `${name} function schema has assignee`);
      const m = manifest.find((t) => t.name === name);
      assert.ok(m.input_schema.properties.assignee, `${name} manifest has assignee`);
    }
    assert.equal(new Set(TOOL_NAMES).size, manifest.length, 'manifest and TOOL_NAMES list the same tools');
  });

  it('hints carry the worked examples and intents route to the model', () => {
    for (const name of ['tag_leads', 'sync_leads_to_ghl', 'list_team_members', 'create_task']) {
      assert.match(CRM_COMMAND_HINTS, new RegExp(name));
    }
    assert.match(CRM_COMMAND_HINTS, /Tag the top 10 plumbers as Hot/);
    assert.match(CRM_COMMAND_HINTS, /Sync my bookmarked leads to GHL/);
    assert.match(CRM_COMMAND_HINTS, /Assign a task to Maria/);
    for (const msg of [
      'tag the top 10 plumbers as Hot',
      'sync my bookmarked leads to GHL',
      'assign a task to Maria to call ABC Flooring tomorrow at 10',
      'who is on my team?',
    ]) {
      assert.equal(isCrmIntent(msg), true, msg);
      assert.equal(matchDirectCrmQuery(msg), null, msg);
    }
    assert.equal(matchDirectCrmQuery("search for Maria's tasks"), null);
    assert.equal(matchDirectCrmQuery('find Acme Roofing').tool, 'search_leads');
  });
});

describe('tag_leads + list_tags', () => {
  const keys = {};

  before(async () => {
    keys.a1 = await seedLead(WS_A, { title: 'Plumber One' });
    keys.a2 = await seedLead(WS_A, { title: 'Plumber Two' });
    keys.a3 = await seedLead(WS_A, { title: 'Plumber Three' });
    keys.b1 = await seedLead(WS_B, { title: 'Foreign Plumber' });
  });

  after(async () => {
    // Single-lead tag changes fire the UI's background GHL prospect sync; let it settle before GHL stubs go in.
    await new Promise((r) => setImmediate(r));
    await sleep(50);
  });

  it('creates a missing tag once and adds it to many leads in this workspace only', async () => {
    const out = await executeCrmTool(ctxA, 'tag_leads', { lead_ids: [keys.a1, keys.a2, keys.b1], add: ['Hot'] });
    assert.equal(out.success, true, out.error);
    assert.deepEqual(out.createdTags, ['Hot']);
    assert.equal(out.changed, 2);
    assert.equal(out.failed, 1);
    assert.equal(out.results.find((r) => r.lead_id === keys.b1).code, 'NOT_FOUND');

    const tagsA = await dbService.listTags(WS_A);
    const hot = tagsA.find((t) => t.name === 'Hot');
    assert.ok(hot && hot.key.startsWith(`tag:${WS_A}:`));
    assert.deepEqual((await dbService.getLead(keys.a1)).tags, [hot.key]);
    assert.deepEqual((await dbService.getLead(keys.a2)).tags, [hot.key]);
    assert.ok(!((await dbService.getLead(keys.b1)).tags || []).length, 'other workspace lead untouched');
    assert.ok(!(await dbService.listTags(WS_B)).some((t) => t.name === 'Hot'), 'no tag created in workspace B');

    const activity = dbService.listTeamActivity({ workspaceId: WS_A, category: 'tags', limit: 20 });
    assert.ok(activity.some((a) => a.summary === 'Created tag "Hot"'));
    assert.ok(activity.some((a) => a.action === 'bulk_tags' && a.summary === 'Added Hot on 2 leads'));

    const again = await executeCrmTool(ctxA, 'tag_leads', { lead_ids: [keys.a1, keys.a2], add: ['hot'] });
    assert.deepEqual(again.createdTags, [], 'matches existing tags case-insensitively');
    assert.equal(again.unchanged, 2);
    assert.equal((await dbService.listTags(WS_A)).filter((t) => t.name === 'Hot').length, 1);
  });

  it('adds and removes in one call and logs the single-lead change like the UI', async () => {
    const out = await executeCrmTool(ctxA, 'tag_leads', { lead_ids: [keys.a1], add: ['Warm'], remove: ['Hot', 'Nope'] });
    assert.equal(out.success, true, out.error);
    assert.deepEqual(out.unknownRemoveTags, ['Nope']);
    assert.deepEqual(out.results[0].added, ['Warm']);
    assert.deepEqual(out.results[0].removed, ['Hot']);
    const warm = (await dbService.listTags(WS_A)).find((t) => t.name === 'Warm');
    assert.deepEqual((await dbService.getLead(keys.a1)).tags, [warm.key]);
    const activity = dbService.listTeamActivity({ workspaceId: WS_A, leadKey: keys.a1, limit: 10 });
    assert.ok(activity.some((a) => a.action === 'lead_tags' && a.summary === 'Added Warm · Removed Hot'));

    const removeOnly = await executeCrmTool(ctxA, 'tag_leads', { lead_ids: [keys.a2], remove: ['Hot'] });
    assert.equal(removeOnly.changed, 1);
    assert.ok(!((await dbService.getLead(keys.a2)).tags || []).length);
  });

  it('gives each tag created in one call its own key', async () => {
    const out = await executeCrmTool(ctxA, 'tag_leads', { lead_ids: [keys.a3], add: ['Alpha', 'Beta', 'Gamma'] });
    assert.equal(out.success, true, out.error);
    assert.equal(out.createdTags.length, 3);
    const lead = await dbService.getLead(keys.a3);
    assert.equal(new Set(lead.tags).size, 3);
  });

  it('list_tags reports lead counts per workspace', async () => {
    const out = await executeCrmTool(ctxA, 'list_tags', {});
    assert.equal(out.success, true, out.error);
    const warm = out.tags.find((t) => t.name === 'Warm');
    assert.equal(warm.leadCount, 1);
    assert.equal(out.tags.find((t) => t.name === 'Hot').leadCount, 0);
    const outB = await executeCrmTool(ctxB, 'list_tags', {});
    assert.ok(!outB.tags.some((t) => t.name === 'Warm'));

    const inB = await executeCrmTool(ctxB, 'tag_leads', { lead_ids: [keys.b1], add: ['Hot'] });
    assert.deepEqual(inB.createdTags, ['Hot'], 'workspace B gets its own Hot tag');
    assert.ok((await dbService.getLead(keys.b1)).tags[0].startsWith(`tag:${WS_B}:`));
  });

  it('rejects calls with nothing to change or too many leads', async () => {
    const none = await executeCrmTool(ctxA, 'tag_leads', { lead_ids: [keys.a1] });
    assert.equal(none.success, false);
    assert.equal(none.code, 'INVALID_ARGUMENT');
    const tooMany = await executeCrmTool(ctxA, 'tag_leads', {
      lead_ids: Array.from({ length: 101 }, (_, i) => `lead:${i}`),
      add: ['Hot'],
    });
    assert.equal(tooMany.success, false);
    const both = await executeCrmTool(ctxA, 'tag_leads', { lead_ids: [keys.a1], add: ['Hot'], remove: ['hot'] });
    assert.equal(both.success, false);
  });
});

describe('sync_leads_to_ghl', () => {
  let creates;
  let updates;
  let createDelayMs;

  beforeEach(() => {
    leadActions._resetGhlJobsForTests();
    creates = [];
    updates = [];
    createDelayMs = 0;
    workspaceIntegrations.getResolvedIntegrationEnv = async (wid) =>
      wid === WS_A ? { GHL_API_KEY: 'test-key', GHL_LOCATION_ID: 'loc_a' } : {};
    ghlClient.searchContactByEmailOrPhone = async () => null;
    ghlClient.createContact = async (lead) => {
      if (createDelayMs) await sleep(createDelayMs);
      if (/Broken/.test(lead.title)) throw new Error('GHL rejected the phone number');
      creates.push(lead.key);
      return { id: `ghl_${creates.length}` };
    };
    ghlClient.updateContact = async (id, lead) => {
      updates.push({ id, key: lead.key });
      return { id };
    };
    ghlClient.syncContactTags = async (id, tags) => tags;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({}),
      text: async () => '{}',
    });
  });

  it('pushes leads through the app sync path and reports created / updated / skipped / error', async () => {
    const fresh = await seedLead(WS_A, { title: 'Fresh Co', email: 'hi@fresh.example.com' });
    const linked = await seedLead(WS_A, { title: 'Linked Co', ghlContactId: 'ghl_existing' });
    const broken = await seedLead(WS_A, { title: 'Broken Co' });
    const foreign = await seedLead(WS_B, { title: 'Foreign Co' });

    const out = await executeCrmTool(ctxA, 'sync_leads_to_ghl', { lead_ids: [fresh, linked, broken, foreign] });
    assert.equal(out.success, true, out.error);
    assert.equal(out.status, 'completed');
    assert.equal(out.total, 4);
    assert.equal(out.created, 1);
    assert.equal(out.updated, 1);
    assert.equal(out.skipped, 1);
    assert.equal(out.error, 1);
    const byId = Object.fromEntries(out.results.map((r) => [r.lead_id, r]));
    assert.equal(byId[fresh].status, 'created');
    assert.equal(byId[linked].status, 'updated');
    assert.equal(byId[broken].status, 'error');
    assert.match(byId[broken].message, /rejected the phone/);
    assert.equal(byId[foreign].status, 'skipped');
    assert.ok(updates.some((u) => u.id === 'ghl_existing'));
    assert.ok(byId[fresh].ghlContactId);
    assert.equal(
      (await dbService.getLead(fresh)).ghlContactId,
      byId[fresh].ghlContactId,
      'contact id saved on the lead like the UI sync',
    );
    assert.ok(!creates.includes(foreign), 'other workspace lead never pushed');
  });

  it('returns a clear error when GHL is not connected for the workspace', async () => {
    const lead = await seedLead(WS_B, { title: 'B Lead' });
    const out = await executeCrmTool(ctxB, 'sync_leads_to_ghl', { lead_ids: [lead] });
    assert.equal(out.success, false);
    assert.equal(out.code, 'GHL_NOT_CONNECTED');
    assert.match(out.error, /Workspace → Integrations/);
    assert.equal(creates.length, 0);
  });

  it('keeps long batches running in the background with a status tool', async () => {
    leadActions._resetGhlJobsForTests({ waitMs: 30 });
    createDelayMs = 60;
    const l1 = await seedLead(WS_A, { title: 'Slow One' });
    const l2 = await seedLead(WS_A, { title: 'Slow Two' });
    const out = await executeCrmTool(ctxA, 'sync_leads_to_ghl', { lead_ids: [l1, l2] });
    assert.equal(out.success, true, out.error);
    assert.equal(out.status, 'running');
    assert.equal(out.async, true);
    assert.ok(out.job_id);

    const done = await waitFor(async () => {
      const s = await executeCrmTool(ctxA, 'get_ghl_sync_status', { job_id: out.job_id });
      return s.job && s.job.status === 'completed' ? s : null;
    });
    assert.equal(done.job.created, 2);
    const otherWs = await executeCrmTool(ctxB, 'get_ghl_sync_status', { job_id: out.job_id });
    assert.equal(otherWs.job, null, 'workspace B cannot read workspace A jobs');
    const recent = await executeCrmTool(ctxA, 'get_ghl_sync_status', {});
    assert.ok(recent.jobs.length >= 1);
  });

  it('caps a call at 50 leads', async () => {
    const out = await executeCrmTool(ctxA, 'sync_leads_to_ghl', {
      lead_ids: Array.from({ length: 51 }, (_, i) => `lead:${i}`),
    });
    assert.equal(out.success, false);
    assert.equal(out.code, 'INVALID_ARGUMENT');
  });
});

describe('task assignment', () => {
  let leadKey;
  let foreignLead;

  before(async () => {
    leadKey = await seedLead(WS_A, { title: 'ABC Flooring' });
    foreignLead = await seedLead(WS_B, { title: 'Foreign Flooring' });
  });

  it('lists workspace members with names and roles', async () => {
    const out = await executeCrmTool(ctxA, 'list_team_members', {});
    assert.equal(out.success, true, out.error);
    assert.deepEqual(out.members.map((m) => m.email), ['maria@a.test', 'mark@a.test', 'owner@a.test']);
    const maria = out.members.find((m) => m.email === 'maria@a.test');
    assert.equal(maria.name, 'Maria Lopez');
    assert.equal(maria.role, 'sdr');
    assert.equal(out.members.find((m) => m.email === 'owner@a.test').you, true);
    const outB = await executeCrmTool(ctxB, 'list_team_members', {});
    assert.ok(!outB.members.some((m) => m.email === 'maria@a.test'));
  });

  it("puts an assigned lead task into the assignee's own task list, keeping several per lead", async () => {
    const due = '2026-10-01T10:00:00-07:00';
    const first = await executeCrmTool(ctxA, 'create_task', {
      title: 'Call ABC Flooring',
      assignee: 'Maria',
      lead_id: leadKey,
      scheduled_at: due,
    });
    assert.equal(first.success, true, first.error);
    assert.deepEqual(first.task.assignedTo, { email: 'maria@a.test', name: 'Maria Lopez' });
    assert.equal(first.task.scheduledAt, new Date(due).toISOString());

    const second = await executeCrmTool(ctxA, 'create_task', {
      title: 'Send ABC Flooring the quote',
      assignee: 'maria@a.test',
      lead_id: leadKey,
    });
    assert.equal(second.success, true, second.error);

    await dedupeOpenLeadTasks(WS_A, 'maria@a.test');
    const mariaTasks = filterManualUserTasks(await dbService.listUserTasks(WS_A, 'maria@a.test'));
    assert.deepEqual(mariaTasks.map((t) => t.title).sort(), ['Call ABC Flooring', 'Send ABC Flooring the quote']);
    assert.ok(mariaTasks.every((t) => t.source === TASK_SOURCE_LEAD_TASK && t.leadKey === leadKey));
    const ownerTasks = await dbService.listUserTasks(WS_A, 'owner@a.test');
    assert.ok(!ownerTasks.some((t) => /ABC Flooring/.test(t.title)), "not in the assigner's list");

    const listed = await executeCrmTool(ctxA, 'list_tasks', { assignee: 'Maria Lopez' });
    assert.equal(listed.tasks.length, 2);
    assert.equal(listed.tasks[0].leadTitle, 'ABC Flooring');

    const activity = dbService.listTeamActivity({ workspaceId: WS_A, leadKey, limit: 10 });
    assert.ok(activity.some((a) => a.summary === 'Task for Maria Lopez: Call ABC Flooring · due 2026-10-01'));
  });

  it('rejects non-members, ambiguous names, and leads from another workspace', async () => {
    const outsider = await executeCrmTool(ctxA, 'create_task', { title: 'x', assignee: 'olga@b.test' });
    assert.equal(outsider.success, false);
    assert.equal(outsider.code, 'NOT_A_MEMBER');
    assert.match(outsider.error, /Maria Lopez/, 'error lists the real members');
    const byName = await executeCrmTool(ctxA, 'create_task', { title: 'x', assignee: 'Olga' });
    assert.equal(byName.code, 'NOT_A_MEMBER');
    const ambiguous = await executeCrmTool(ctxA, 'create_task', { title: 'x', assignee: 'Mar' });
    assert.equal(ambiguous.code, 'AMBIGUOUS_ASSIGNEE');
    const foreign = await executeCrmTool(ctxA, 'create_task', { title: 'x', assignee: 'Mark', lead_id: foreignLead });
    assert.equal(foreign.code, 'NOT_FOUND');
    assert.equal((await dbService.listUserTasks(WS_A, 'mark@a.test')).length, 0);
    assert.equal((await dbService.listUserTasks(WS_A, 'olga@b.test')).length, 0);
  });

  it("updates a teammate's task and reassigns it to another member", async () => {
    const created = await executeCrmTool(ctxA, 'create_task', { title: 'Visit showroom', assignee: 'Maria' });
    const id = created.task.id;
    const renamed = await executeCrmTool(ctxA, 'update_task', { task_id: id, title: 'Visit the showroom' });
    assert.equal(renamed.success, true, renamed.error);
    assert.equal(renamed.task.assignedTo.email, 'maria@a.test');

    const moved = await executeCrmTool(ctxA, 'update_task', { task_id: id, assignee: 'Mark' });
    assert.equal(moved.success, true, moved.error);
    assert.equal(moved.task.assignedTo.email, 'mark@a.test');
    assert.ok(!(await dbService.listUserTasks(WS_A, 'maria@a.test')).some((t) => t.id === id));
    const markTask = (await dbService.listUserTasks(WS_A, 'mark@a.test')).find((t) => t.id === id);
    assert.equal(markTask.title, 'Visit the showroom');

    const missing = await executeCrmTool(ctxB, 'update_task', { task_id: id, title: 'hijack' });
    assert.equal(missing.code, 'NOT_FOUND', 'workspace B cannot touch workspace A tasks');
  });

  it('still creates tasks for the signed-in user when no assignee is given', async () => {
    const out = await executeCrmTool(ctxA, 'create_task', { title: 'My own task' });
    assert.equal(out.success, true, out.error);
    assert.equal(out.task.assignedTo, undefined);
    assert.ok((await dbService.listUserTasks(WS_A, 'owner@a.test')).some((t) => t.title === 'My own task'));
  });
});
