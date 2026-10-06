const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-prospecting-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');
const { executeCrmTool, TOOL_NAMES, getOpenAiFunctionTools } = require('../services/mcp/mcpToolExecutor');
const { createCrmMcpServer, getOpenAiToolManifest } = require('../services/mcp/mcpServerFactory');
const { PROSPECTING_TOOL_NAMES } = require('../services/mcp/mcpProspecting');

const OWNER = 'owner@example.com';
let n = 0;

async function setup(wsExtra = {}) {
  n += 1;
  const wid = `ws_prospect_${n}`;
  await dbService.saveWorkspace(wid, {
    id: wid,
    name: 'Prospecting WS',
    ownerUserId: OWNER,
    isDemo: true,
    members: { [OWNER]: { role: 'owner' } },
    ...wsExtra,
  });
  const lead = async (fields) => (await dbService.saveLeadWithMeta({ workspaceId: wid, city: 'Camas', state: 'WA', ...fields })).key;
  return { wid, ctx: { workspaceId: wid, userEmail: OWNER }, lead };
}

test('every prospecting tool is on the MCP server, the manifest and the Ask AI function list', () => {
  const registered = Object.keys(createCrmMcpServer({ workspaceId: 'x' })._registeredTools);
  const manifest = getOpenAiToolManifest().tools.map((t) => t.name);
  const fns = getOpenAiFunctionTools().map((t) => t.function.name);
  for (const name of PROSPECTING_TOOL_NAMES) {
    assert.ok(TOOL_NAMES.includes(name), name);
    assert.ok(registered.includes(name), name);
    assert.ok(manifest.includes(name), name);
    assert.ok(fns.includes(name), name);
  }
});

test('log_call_outcome sets the status and creates the follow-up task', async () => {
  const { ctx, lead } = await setup();
  const key = await lead({ title: 'Patrick Plumbing', phone: '3605550100' });
  const due = new Date(Date.now() + 2 * 86400000).toISOString();
  const res = await executeCrmTool(ctx, 'log_call_outcome', { lead_id: key, outcome: 'connected', notes: 'Wants a quote Friday', follow_up_at: due });
  assert.equal(res.success, true, res.error);
  assert.equal(res.status, 'Connected - Follow Up');
  assert.ok(res.follow_up && res.follow_up.task_id);
  const saved = await dbService.getLead(key);
  assert.equal(saved.status, 'Connected - Follow Up');

  const bad = await executeCrmTool(ctx, 'log_call_outcome', { lead_id: key, outcome: 'maybe' });
  assert.equal(bad.success, false);
  assert.equal(bad.code, 'INVALID_ARGUMENTS');
});

test('score_leads ranks best first and refuses leads from another workspace', async () => {
  const { ctx, lead } = await setup();
  const strong = await lead({ title: 'No Site Roofing', rating: 4.9, reviewsCount: 80, phone: '3605550101', website: '' });
  const weak = await lead({ title: 'Big Chain HVAC', rating: 3.1, reviewsCount: 2, phone: '3605550102', website: 'https://example.com' });
  const other = await setup();
  const foreign = await other.lead({ title: 'Elsewhere Co' });

  const res = await executeCrmTool(ctx, 'score_leads', { lead_ids: [weak, strong, foreign] });
  assert.equal(res.success, true, res.error);
  assert.equal(res.count, 2);
  assert.ok(res.leads[0].score >= res.leads[1].score);
  assert.ok(res.leads.every((l) => typeof l.score === 'number' && l.tier));
  assert.equal(res.errors.length, 1);
  assert.equal(res.errors[0].lead_id, foreign);
});

test('manage_sequence lists templates, starts one on a lead and pauses it', async () => {
  const { ctx, lead } = await setup();
  const key = await lead({ title: 'Seq Painting', email: 'owner@seqpainting.com' });
  const list = await executeCrmTool(ctx, 'manage_sequence', { action: 'list_templates' });
  assert.equal(list.success, true, list.error);
  const ids = list.templates.map((t) => t.id);
  const templateId = ids.find((id) => !id.startsWith('audit_')) || ids[0];
  assert.ok(templateId);

  const started = await executeCrmTool(ctx, 'manage_sequence', { action: 'start', lead_ids: [key], template_id: templateId });
  assert.equal(started.success, true, started.error);
  assert.equal(started.done, 1, JSON.stringify(started.results));
  assert.equal((await dbService.getLead(key)).sequenceState.status, 'active');

  const paused = await executeCrmTool(ctx, 'manage_sequence', { action: 'pause', lead_ids: [key] });
  assert.equal(paused.done, 1);
  assert.notEqual((await dbService.getLead(key)).sequenceState.status, 'active');

  const unknown = await executeCrmTool(ctx, 'manage_sequence', { action: 'start', lead_ids: [key], template_id: 'nope' });
  assert.equal(unknown.success, false);
});

test('launch_cadence puts leads on a saved cadence by name and stop_cadence takes them off', async () => {
  const { ctx, lead } = await setup();
  const key = await lead({ title: 'Cadence Flooring', phone: '3605550103' });
  const saved = await executeCrmTool(ctx, 'save_custom_cadence', {
    name: 'Flooring follow-up',
    steps: [{ day: 0, channel: 'sms', message: 'Hi {{first_name}}, quick question about {{company}}.' }],
  });
  assert.equal(saved.success, true, saved.error);

  const launched = await executeCrmTool(ctx, 'launch_cadence', { cadence: 'flooring follow-up', lead_ids: [key] });
  assert.equal(launched.success, true, launched.error);
  assert.equal(launched.launched, 1);
  assert.ok(launched.warning, 'warns that the GHL workflow is not set up yet');
  assert.equal((await dbService.getLead(key)).ghlCadence.status, 'active');

  const stopped = await executeCrmTool(ctx, 'stop_cadence', { lead_ids: [key] });
  assert.equal(stopped.success, true, stopped.error);
  assert.equal(stopped.stopped, 1);
  assert.equal((await dbService.getLead(key)).ghlCadence.status, 'stopped');
});

test('get_call_queue lists recently engaged leads, hottest first', async () => {
  const { ctx, lead } = await setup();
  const now = new Date().toISOString();
  const replied = await lead({ title: 'Replied Plumbing', engagementSignals: { smsRepliedAt: now, lastSignalAt: now, lastSignalType: 'sms_reply' } });
  await lead({ title: 'Quiet Electric' });
  const res = await executeCrmTool(ctx, 'get_call_queue', {});
  assert.equal(res.success, true, res.error);
  assert.equal(res.count, 1);
  assert.equal(res.queue[0].lead_id, replied);
  assert.equal(res.queue[0].business, 'Replied Plumbing');
});
