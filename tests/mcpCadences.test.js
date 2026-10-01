const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-cadences-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');
const { executeCrmTool, getOpenAiFunctionTools } = require('../services/mcp/mcpToolExecutor');
const { getOpenAiToolManifest } = require('../services/mcp/mcpServerFactory');
const customCadences = require('../services/customCadences');

const WID = 'ws_mcp_cadences';
const owner = { workspaceId: WID, userEmail: 'owner@example.com', baseUrl: 'https://leads.example.com' };
const rep = { workspaceId: WID, userEmail: 'rep@example.com' };

const STEPS = [
  { day: 0, channel: 'sms', message: 'Hi {{first_name}}, quick question about {{company}}.' },
  { day: 2, channel: 'email', subject: 'For {{company}}', message: '{{sender_pitch}}' },
  { day: 4, channel: 'call', message: 'Ask about their busy season.' },
];

test('cadence tools are offered to the chat and to MCP clients', () => {
  const chat = getOpenAiFunctionTools().map((t) => t.function.name);
  const manifest = getOpenAiToolManifest().tools.map((t) => t.name);
  for (const name of ['list_custom_cadences', 'save_custom_cadence', 'get_cadence_ghl_prompt']) {
    assert.ok(chat.includes(name), `chat has ${name}`);
    assert.ok(manifest.includes(name), `manifest has ${name}`);
  }
});

test('AI can draft, save, update and fetch the GHL prompt for a cadence', async () => {
  await dbService.saveWorkspace(WID, {
    id: WID,
    name: 'Cadence AI',
    members: { 'owner@example.com': { role: 'owner' }, 'rep@example.com': { role: 'sdr' } },
  });

  const empty = await executeCrmTool(owner, 'list_custom_cadences', {});
  assert.equal(empty.success, true);
  assert.equal(empty.count, 0);
  assert.equal(empty.cadences_page, 'https://leads.example.com/sequences#custom-cadences');

  const denied = await executeCrmTool(rep, 'save_custom_cadence', { name: 'Nope', steps: STEPS });
  assert.equal(denied.success, false);
  assert.match(denied.error, /owners and admins/);

  const bad = await executeCrmTool(owner, 'save_custom_cadence', { name: 'Bad', steps: [{ day: 0, channel: 'fax', message: 'x' }] });
  assert.equal(bad.success, false);

  const saved = await executeCrmTool(owner, 'save_custom_cadence', { name: 'Seat invite', goal: 'Book a call', steps: STEPS });
  assert.equal(saved.success, true);
  assert.equal(saved.cadence.ghl_tag, 'cadence-seat-invite');
  assert.equal(saved.cadence.steps.length, 3);
  assert.match(saved.next_steps, /Launch cadence/);

  await customCadences.markGhlSetup(WID, saved.cadence.id);

  const sameSteps = await executeCrmTool(owner, 'save_custom_cadence', { cadence: 'seat invite', goal: 'Book a 15-minute call', steps: STEPS });
  assert.equal(sameSteps.cadence.ghl_workflow_ready, true, 'goal-only edit keeps the GHL workflow ready');
  assert.equal(sameSteps.cadence.name, 'Seat invite');

  const changed = await executeCrmTool(owner, 'save_custom_cadence', {
    cadence: 'Seat invite',
    steps: [...STEPS, { day: 7, channel: 'sms', message: 'Last note, {{first_name}}.' }],
  });
  assert.equal(changed.success, true);
  assert.equal(changed.cadence.ghl_workflow_ready, false);
  assert.equal(changed.ghl_workflow_outdated, true);
  assert.equal(changed.cadence.goal, 'Book a 15-minute call', 'goal kept when not passed');

  const list = await executeCrmTool(owner, 'list_custom_cadences', {});
  assert.equal(list.count, 1);
  assert.equal(list.cadences[0].steps.length, 4);

  const prompt = await executeCrmTool(rep, 'get_cadence_ghl_prompt', { cadence: 'seat' });
  assert.equal(prompt.success, true);
  assert.match(prompt.prompt, /cadence-seat-invite/);
  assert.match(prompt.prompt, /\{\{contact\.first_name\}\}/);

  const missing = await executeCrmTool(owner, 'get_cadence_ghl_prompt', { cadence: 'nothing like it' });
  assert.equal(missing.success, false);
  assert.match(missing.error, /Seat invite/);
});
