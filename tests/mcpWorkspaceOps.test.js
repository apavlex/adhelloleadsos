const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-workspace-ops-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');
const { executeCrmTool } = require('../services/mcp/mcpToolExecutor');
const { withBotActivity } = require('../services/mcp/mcpBotActivity');

global.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' });

const OWNER = 'owner@example.com';
const MEMBER = 'maria@example.com';
const VIEWER = 'viewer@example.com';
const WID = 'ws_ops';
const keys = {};
let phoneSeq = 100;

const ctx = (email = OWNER, extra = {}) => ({ workspaceId: WID, userEmail: email, ...extra });

async function call(name, args = {}, c = ctx()) {
  const res = await executeCrmTool(c, name, args);
  assert.equal(res.success, true, `${name}: ${res.error}`);
  return res;
}

async function fails(name, args, c = ctx()) {
  const res = await executeCrmTool(c, name, args);
  assert.equal(res.success, false, `${name} should fail`);
  return res;
}

async function newLead(title, extra = {}) {
  phoneSeq += 1;
  const { key } = await dbService.saveLeadWithMeta({ workspaceId: WID, title, phone: `+1555555${String(phoneSeq).padStart(4, '0')}`, ...extra });
  return key;
}

test.before(async () => {
  await dbService.saveWorkspace(WID, {
    id: WID,
    name: 'Ops WS',
    ownerUserId: OWNER,
    members: {
      [OWNER]: { role: 'owner', name: 'Olivia Owner' },
      [MEMBER]: { role: 'member', name: 'Maria Lopez' },
      [VIEWER]: { role: 'viewer', name: 'Vic Viewer' },
    },
  });
  keys.a = await newLead('Acme Roofing');
  keys.b = await newLead('Best Plumbing');
  keys.c = await newLead('City HVAC');
});

test('opportunity pipelines: stages can be added, renamed and deleted; deals listed with value', async () => {
  const { pipelines } = await call('list_opportunity_pipelines');
  const pipeline = pipelines[0];
  const added = await call('manage_opportunity_pipeline', { action: 'add_stage', pipeline: pipeline.name, name: 'Proposal Sent' });
  assert.ok(added.stage_id);
  await call('manage_opportunity_pipeline', { action: 'rename_stage', stage: 'Proposal Sent', name: 'Proposal Out' });
  await call('manage_opportunity_pipeline', { action: 'rename_pipeline', pipeline: pipeline.id, name: 'Sales' });

  const deal = await call('create_opportunity', { title: 'Delta Remodel', pipeline: 'Sales', stage: 'Proposal Out', value: 4500, source: 'Referral' });
  assert.equal(deal.stage, 'Proposal Out');
  await call('move_opportunity', { lead_id: keys.a, pipeline_name: 'Sales', stage_name: 'Proposal Out' });
  await call('update_lead', { lead_id: keys.a, fields: { opportunityValue: 1500 } });

  const list = await call('list_opportunities', { pipeline: 'Sales', stage: 'Proposal Out' });
  assert.equal(list.total, 2);
  assert.equal(list.total_value, 6000);
  assert.deepEqual(list.opportunities.map((o) => o.title).sort(), ['Acme Roofing', 'Delta Remodel']);

  const paged = await call('list_opportunities', { pipeline: 'Sales', stage: 'Proposal Out', limit: 1 });
  assert.equal(paged.opportunities.length, 1);
  assert.equal(paged.has_more, true);

  const removed = await call('manage_opportunity_pipeline', { action: 'delete_stage', stage: 'Proposal Out' });
  assert.equal(removed.moved, 2, 'cards on a deleted stage move to the fallback stage');
  const after = await call('list_opportunities', { pipeline: 'Sales' });
  assert.ok(after.opportunities.some((o) => o.title === 'Delta Remodel'));
  assert.ok(!after.stages.some((s) => s.name === 'Proposal Out'));

  await call('remove_opportunities', { lead_ids: [keys.a] });
  const lead = await dbService.getLead(keys.a);
  assert.equal(lead.opportunityDismissed, true);
  assert.equal(lead.opportunityStageId, '');
});

test('deleting stages and pipelines is owners/admins only', async () => {
  await fails('manage_opportunity_pipeline', { action: 'delete_stage', stage: 'Won' }, ctx(MEMBER));
  const res = await fails('manage_opportunity_pipeline', { action: 'add_stage', name: 'Nope' }, ctx(VIEWER));
  assert.match(res.error, /Viewers/);
});

test('prospecting stages: list with counts and move leads by stage name', async () => {
  const { stages } = await call('list_lead_stages');
  assert.ok(stages.length >= 2);
  const target = stages[1];
  const moved = await call('set_lead_stage', { lead_ids: [keys.b, keys.c, 'lead:missing'], stage: target.name, status: 'Contacted' });
  assert.equal(moved.moved, 2);
  assert.equal(moved.results.find((r) => r.lead_id === 'lead:missing').success, false);
  const lead = await dbService.getLead(keys.b);
  assert.equal(lead.stageId, target.id);
  assert.equal(lead.status, 'Contacted');
  const again = await call('list_lead_stages');
  assert.equal(again.stages.find((s) => s.id === target.id).lead_count, 2);
});

test('tags: create, rename, recolor, archive, delete (removed from leads)', async () => {
  await call('manage_tags', { action: 'create', name: 'VIP', color: '#22c55e' });
  await call('tag_leads', { lead_ids: [keys.b], add: ['VIP'] });
  await call('manage_tags', { action: 'rename', tag: 'VIP', name: 'Top Client' });
  await call('manage_tags', { action: 'recolor', tag: 'Top Client', color: '#ef4444' });
  let tag = (await dbService.listTags(WID)).find((t) => t.name === 'Top Client');
  assert.equal(tag.color.toLowerCase(), '#ef4444');
  await call('manage_tags', { action: 'archive', tag: 'Top Client' });
  tag = (await dbService.listTags(WID)).find((t) => t.name === 'Top Client');
  assert.equal(tag.isActive, false);
  await call('manage_tags', { action: 'delete', tag: 'Top Client' });
  assert.ok(!(await dbService.listTags(WID)).some((t) => t.name === 'Top Client'));
  assert.deepEqual((await dbService.getLead(keys.b)).tags || [], []);
});

test('folders: file leads, nest a folder, delete it without deleting leads', async () => {
  await call('create_folder', { names: ['Clients', 'Hot Clients'] });
  const moved = await call('move_leads_to_folder', { lead_ids: [keys.b, keys.c], folder: 'Hot Clients' });
  assert.equal(moved.moved, 2);
  await call('manage_folder', { action: 'move', folder: 'Hot Clients', parent_folder: 'Clients' });
  const folders = await dbService.listFolders(WID);
  const hot = folders.find((f) => f.name === 'Hot Clients');
  const clients = folders.find((f) => f.name === 'Clients');
  assert.equal(hot.parentFolderKey, clients.key);
  const del = await call('manage_folder', { action: 'delete', folder: 'Hot Clients' });
  assert.equal(del.unfiled, 2);
  assert.ok(await dbService.getLead(keys.b), 'leads survive folder deletion');
});

test('create_lead with folder, tags and a first note; add_lead_note appends', async () => {
  const created = await call('create_lead', {
    title: 'Echo Painting',
    phone: '+15555559999',
    city: 'Camas',
    state: 'WA',
    folder: 'Clients',
    tags: ['Warm'],
    note: 'Met at the expo',
  });
  keys.e = created.lead_id;
  const lead = await dbService.getLead(keys.e);
  assert.ok(lead.folderKey);
  assert.equal(lead.tags.length, 1);

  await call('add_lead_note', { lead_id: keys.e, note: 'Wants a quote Friday' });
  const hist = await call('get_lead_history', { lead_id: keys.e, types: ['note'] });
  assert.deepEqual(hist.history.map((h) => h.text).slice(0, 2).sort(), ['Met at the expo', 'Wants a quote Friday']);

  const dup = await call('create_lead', { title: 'Echo Painting LLC', phone: '+15555559999' });
  assert.equal(dup.merged_with_existing, true);
});

test('assign_leads: owners assign by name or round-robin; members are refused', async () => {
  const res = await call('assign_leads', { lead_ids: [keys.b], assignee: 'Maria' });
  assert.equal(res.results[0].assigned_to, MEMBER);
  assert.equal((await dbService.getLead(keys.b)).assignedTo, MEMBER);
  await call('assign_leads', { lead_ids: [keys.b], assignee: 'none' });
  assert.equal((await dbService.getLead(keys.b)).assignedTo, '');
  await fails('assign_leads', { lead_ids: [keys.b], assignee: 'me' }, ctx(MEMBER));
});

test('list_recent_replies finds inbound texts and whether we still owe a reply', async () => {
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  await dbService.updateLead(keys.c, {
    updates: [
      { type: 'sms_outbound', value: 'Hi there', timestamp: iso(now - 5 * 3600e3) },
      { type: 'sms_inbound', value: 'How much is it?', timestamp: iso(now - 2 * 3600e3) },
    ],
  }, WID);
  await dbService.updateLead(keys.b, {
    updates: [
      { type: 'email_inbound', value: 'Interested', timestamp: iso(now - 3 * 3600e3) },
      { type: 'email_outbound', value: 'Great, here is a link', timestamp: iso(now - 1 * 3600e3) },
    ],
  }, WID);
  const all = await call('list_recent_replies', { since_hours: 24 });
  assert.equal(all.total, 2);
  assert.equal(all.replies[0].title, 'City HVAC');
  const owed = await call('list_recent_replies', { since_hours: 24, unanswered_only: true });
  assert.deepEqual(owed.replies.map((r) => r.message), ['How much is it?']);
  const hist = await call('get_lead_history', { lead_id: keys.c, types: ['sms'] });
  assert.deepEqual(hist.history.map((h) => [h.direction, h.text]), [['inbound', 'How much is it?'], ['outbound', 'Hi there']]);
});

test('delete_leads requires confirm: true', async () => {
  const k = await newLead('Zed Junk');
  const res = await fails('delete_leads', { lead_ids: [k], confirm: false });
  assert.match(res.error, /confirm/i);
  const ok = await call('delete_leads', { lead_ids: [k], confirm: true });
  assert.equal(ok.deleted, 1);
  assert.equal(await dbService.getLead(k), null);
});

test('bot actions land in Team history and list_team_activity reads them back', async () => {
  const botCtx = withBotActivity(ctx(OWNER, { clientName: 'Muse', viaMcp: true }));
  await call('add_lead_note', { lead_id: keys.c, note: 'Bot follow-up' }, botCtx);
  await call('manage_tags', { action: 'create', name: 'Bot Tag' }, botCtx);
  const feed = await call('list_team_activity', { person: 'Muse' });
  const actions = feed.activity.map((a) => a.action);
  assert.ok(actions.includes('note_add'));
  assert.ok(actions.includes('tag_create'));
  assert.equal(feed.activity.filter((a) => a.action === 'note_add').length, 1, 'no duplicate generic row');
  assert.ok(feed.activity.every((a) => a.is_ai_assistant));

  const tags = await call('list_team_activity', { category: 'tags' });
  assert.ok(tags.activity.length >= 1);
});

test('get_workspace_overview summarizes leads, replies, stages, pipelines and tags', async () => {
  const o = await call('get_workspace_overview');
  assert.equal(o.workspace.name, 'Ops WS');
  assert.ok(o.leads.total >= 4);
  assert.equal(o.replies.awaiting_our_reply_last_7d, 1);
  assert.ok(o.opportunity_pipelines.some((p) => p.name === 'Sales'));
  assert.ok(o.prospecting_stages.length >= 2);
  assert.ok(o.tags.some((t) => t.name === 'Warm' && t.lead_count === 1));
  assert.equal(o.members, 3);
});
