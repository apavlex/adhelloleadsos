const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-workspace-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');
const store = require('../services/networkStore');
const ex = require('../services/referralExchange');
const workspaceIntegrations = require('../services/workspaceIntegrations');
const smsOutbound = require('../services/smsOutbound');
const ghlMessaging = require('../services/ghlMessaging');
const { createDemoWorkspace, LEADS, REFERRALS } = require('../services/demoWorkspace');

const OWNER = 'owner@example.com';

test('demo workspace seeds leads, territories, referrals, cadences and blocks real sends', async () => {
  process.env.GHL_API_KEY = 'real-server-key';
  const first = await createDemoWorkspace(OWNER);
  const ws = await dbService.getWorkspace(first.workspaceId);
  assert.equal(ws.isDemo, true);

  const leads = await dbService.getAllLeads(first.workspaceId);
  assert.equal(leads.length, LEADS.length);
  assert.ok(leads.every((l) => l.isDemo && /^\(\d{3}\) 555-01\d\d$/.test(l.phone) && l.email.endsWith('@example.com')));
  assert.equal(new Set(leads.map((l) => l.phone)).size, leads.length);
  assert.ok(leads.filter((l) => l.sequenceState && l.sequenceState.status === 'active').length >= 6);
  assert.ok(leads.filter((l) => l.opportunityPipelineId).length >= 20);

  const network = await store.getNetworkForWorkspace(first.workspaceId);
  assert.equal(network.autoGhlSubaccount, false);
  const zones = await store.listZones(network.id);
  assert.equal(zones.length, 4);
  const referrals = await store.listReferrals(network.id);
  assert.equal(referrals.length, REFERRALS.length);
  const totals = ex.networkTotals(referrals);
  assert.ok(totals.won >= 5 && totals.unrouted >= 1 && totals.sent >= 3 && totals.wonValue > 30000);
  const members = await store.listMembers(network.id);
  const seated = members.filter((m) => ex.seatsForMember(zones, m.id).length);
  assert.equal(members.length - seated.length, 1);

  const env = await workspaceIntegrations.getResolvedIntegrationEnv(first.workspaceId);
  assert.equal(env.DEMO_WORKSPACE, '1');
  assert.notEqual(env.GHL_API_KEY, 'real-server-key');
  const lead = leads[0];
  await assert.rejects(smsOutbound.sendSmsToLead({ lead, message: 'hi', integrationEnv: env }), /demo workspace/i);
  await assert.rejects(ghlMessaging.sendEmailToLead({ lead, subject: 's', body: 'b', integrationEnv: env }), /demo workspace/i);

  const second = await createDemoWorkspace(OWNER);
  assert.notEqual(second.workspaceId, first.workspaceId);
  assert.ok((await dbService.getWorkspace(first.workspaceId)).archivedAt);
  assert.equal((await dbService.getAllLeads(first.workspaceId)).length, 0);
  const ids = await dbService.getUserWorkspaceIds(OWNER);
  assert.ok(ids.includes(second.workspaceId) && !ids.includes(first.workspaceId));
});
