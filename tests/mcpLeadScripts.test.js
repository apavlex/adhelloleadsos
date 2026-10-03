const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-lead-scripts-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');
const { executeCrmTool, getOpenAiFunctionTools } = require('../services/mcp/mcpToolExecutor');
const { createCrmMcpServer } = require('../services/mcp/mcpServerFactory');
const { sanitizeBlockOverridesForCatalog } = require('../services/workspaceSalesScripts');

const OWNER = 'owner@example.com';
let n = 0;

async function setup({ dm = 'Hey {{name}}! Saw {{company}} in {{city}}. [your company] here, quick question?' } = {}) {
  n += 1;
  const wid = `ws_dm_${n}`;
  await dbService.saveWorkspace(wid, {
    id: wid,
    name: 'DM WS',
    ownerUserId: OWNER,
    members: { [OWNER]: { role: 'owner' } },
    salesScriptOfferCatalog: [
      { key: 'overflow', label: 'Overflow Referral', senderBusinessName: 'AdHello' },
      { key: 'seo', label: 'Local SEO' },
    ],
    salesScriptBlockOverrides: {
      overflow: { opening: 'Hi, is this {{name}}?', sms: 'Hi {{name}}, AdHello here.', dm },
      seo: { opening: 'SEO call opener', dm: 'SEO DM for {{company}}' },
    },
  });
  const saved = await dbService.saveLeadWithMeta({
    workspaceId: wid,
    title: 'Patrick Plumbing',
    city: 'Camas',
    phone: '3605550100',
    ownerFirstName: 'Pat',
    instagram: 'https://instagram.com/patrickplumbing',
  });
  return { wid, ctx: { workspaceId: wid, userEmail: OWNER }, leadKey: saved.key };
}

test('get_lead_script fills the offer DM for the lead and returns where to message them', async () => {
  const { ctx, leadKey } = await setup();
  const res = await executeCrmTool(ctx, 'get_lead_script', { lead_id: leadKey });
  assert.equal(res.success, true, res.error);
  assert.equal(res.channel, 'dm');
  assert.equal(res.source, 'offer');
  assert.equal(res.offer.label, 'Overflow Referral');
  assert.equal(res.message, 'Hey Pat! Saw Patrick Plumbing in Camas. AdHello here, quick question?');
  assert.equal(res.lead.instagram, 'https://instagram.com/patrickplumbing');
  assert.equal(res.unfilled_placeholders, undefined);

  const sms = await executeCrmTool(ctx, 'get_lead_script', { lead_id: leadKey, channel: 'sms' });
  assert.equal(sms.message, 'Hi Pat, AdHello here.');
  const other = await executeCrmTool(ctx, 'get_lead_script', { lead_id: leadKey, offer: 'local seo' });
  assert.equal(other.message, 'SEO DM for Patrick Plumbing');
});

test('a custom script saved on one lead wins, and clearing it falls back to the offer', async () => {
  const { ctx, leadKey } = await setup();
  const saved = await executeCrmTool(ctx, 'save_lead_script', { lead_id: leadKey, body: 'Pat, loved the {{city}} van wrap. Open to referrals?' });
  assert.equal(saved.success, true, saved.error);
  const custom = await executeCrmTool(ctx, 'get_lead_script', { lead_id: leadKey });
  assert.equal(custom.source, 'lead');
  assert.equal(custom.message, 'Pat, loved the Camas van wrap. Open to referrals?');
  assert.ok(custom.custom_saved_at);

  const sms = await executeCrmTool(ctx, 'get_lead_script', { lead_id: leadKey, channel: 'sms' });
  assert.equal(sms.source, 'offer', 'a custom DM does not replace other channels');

  await executeCrmTool(ctx, 'save_lead_script', { lead_id: leadKey, body: '' });
  const back = await executeCrmTool(ctx, 'get_lead_script', { lead_id: leadKey });
  assert.equal(back.source, 'offer');
});

test('several leads at once, with per-lead errors, and a missing DM explains how to add one', async () => {
  const { ctx, leadKey } = await setup({ dm: '' });
  const res = await executeCrmTool(ctx, 'get_lead_script', { lead_ids: [leadKey, 'lead:nope'] });
  assert.equal(res.success, true, res.error);
  assert.equal(res.count, 2);
  assert.equal(res.scripts[0].source, 'none');
  assert.match(res.scripts[0].note, /save_script \(section "dm", offer "Overflow Referral"\)/);
  assert.equal(res.scripts[1].code, 'NOT_FOUND');

  const missing = await executeCrmTool(ctx, 'get_lead_script', {});
  assert.equal(missing.success, false);
});

test('save_script stores an offer DM that get_lead_script then serves', async () => {
  const { wid, ctx, leadKey } = await setup({ dm: '' });
  const saved = await executeCrmTool(ctx, 'save_script', { name: 'Overflow DM', body: 'Yo {{name}}', section: 'dm', offer: 'Overflow Referral' });
  assert.equal(saved.success, true, saved.error);
  assert.match(saved.location, /DM script/);
  assert.equal((await dbService.getWorkspace(wid)).salesScriptBlockOverrides.overflow.dm, 'Yo {{name}}');
  assert.equal((await executeCrmTool(ctx, 'get_lead_script', { lead_id: leadKey })).message, 'Yo Pat');
});

test('DM scripts survive the Scripts page save and are published as MCP tools', async () => {
  const kept = sanitizeBlockOverridesForCatalog({ overflow: { dm: 'x'.repeat(5000), sms: 'hi' } }, ['overflow']);
  assert.equal(kept.overflow.dm.length, 2000);

  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
  const { wid, leadKey } = await setup();
  const server = createCrmMcpServer({ workspaceId: wid, userEmail: OWNER });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(clientSide);
  const { tools } = await client.listTools();
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  assert.equal(byName.get_lead_script.annotations.readOnlyHint, true);
  assert.ok(byName.get_lead_script.inputSchema.properties.lead_ids);
  assert.ok(byName.save_lead_script.inputSchema.properties.body);
  const result = await client.callTool({ name: 'get_lead_script', arguments: { lead_id: leadKey } });
  assert.match(JSON.parse(result.content[0].text).message, /^Hey Pat!/);
  await client.close();
  assert.ok(getOpenAiFunctionTools().some((t) => t.function.name === 'save_lead_script'));
});
