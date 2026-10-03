const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ghl-webhook-token-'));
process.env.WORKSPACE_INTEGRATIONS_SECRET = 'test-integrations-secret-123';

const test = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');
const workspaceIntegrations = require('../services/workspaceIntegrations');
const ghlInbound = require('../services/ghlInbound');
const ghlWebhookLog = require('../services/ghlWebhookLog');

const TOKEN = 'a1b2c3d4e5f6a1b2c3d4e5f6';

test.before(async () => {
  for (const id of ['ws_token_a', 'ws_token_b']) {
    await dbService.saveWorkspace(id, { id, name: id, ownerUserId: 'owner@example.com', members: {} });
  }
  await workspaceIntegrations.saveWorkspaceIntegrations('ws_token_a', { ghlWebhookSecret: TOKEN });
  await workspaceIntegrations.saveWorkspaceIntegrations('ws_token_b', { ghlLocationId: 'loc_b' });
});

test('a workspace webhook token identifies its workspace', async () => {
  assert.equal(await workspaceIntegrations.findWorkspaceIdByGhlWebhookSecret(TOKEN), 'ws_token_a');
  assert.equal(await workspaceIntegrations.findWorkspaceIdByGhlWebhookSecret('wrong-token-123'), null);
  assert.equal(await workspaceIntegrations.findWorkspaceIdByGhlWebhookSecret(''), null);
});

test('a locked workspace ignores a locationId that belongs to another workspace', async () => {
  const body = {
    contact_id: 'lock_1',
    full_name: 'Locked Caller',
    phone: '+15550101010',
    location: { id: 'loc_b' },
    customData: { event: 'missed_call' },
  };
  const locked = await ghlInbound.processWorkflowWebhook(body, { workspaceId: 'ws_token_a', lockWorkspace: true });
  assert.equal(locked.workspaceId, 'ws_token_a');
  const unlocked = await ghlInbound.processWorkflowWebhook(
    { ...body, contact_id: 'lock_2', phone: '+15550202020' },
    { workspaceId: 'ws_token_a' },
  );
  assert.equal(unlocked.workspaceId, 'ws_token_b');
});

test('webhook log keeps the newest entries per workspace', () => {
  ghlWebhookLog.record('ws_token_a', { workflow: { name: 'Missed calls' } }, { action: 'missed_call', key: 'lead:1' });
  ghlWebhookLog.record('ws_token_a', { type: 'InboundMessage', messageType: 'SMS' }, { ignored: true, reason: 'duplicate' });
  const entries = ghlWebhookLog.list('ws_token_a');
  assert.equal(entries.length, 2);
  assert.equal(entries[0].event, 'InboundMessage · SMS');
  assert.equal(entries[0].reason, 'duplicate');
  assert.equal(entries[1].event, 'Workflow: Missed calls');
  assert.deepEqual(ghlWebhookLog.list('ws_token_b'), []);
});
