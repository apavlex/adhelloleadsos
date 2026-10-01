const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'public-demo-'));
process.env.PUBLIC_DEMO_AI_CALLS_PER_SANDBOX = '2';

const test = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');
const store = require('../services/networkStore');
const publicDemo = require('../services/publicDemo');
const { createDemoWorkspace } = require('../services/demoWorkspace');
const { isBlocked } = require('../middleware/demoGuest');

test('link config: enable creates a key, regenerate replaces it, disable kills it', () => {
  assert.equal(publicDemo.keyMatches('anything'), false);
  const on = publicDemo.saveConfig({ enabled: true }, 'owner@example.com');
  assert.ok(on.enabled && on.key.length >= 10);
  assert.equal(publicDemo.keyMatches(on.key), true);
  assert.equal(publicDemo.keyMatches(`${on.key}x`), false);

  const next = publicDemo.saveConfig({ regenerate: true });
  assert.notEqual(next.key, on.key);
  assert.equal(publicDemo.keyMatches(on.key), false);

  assert.throws(() => publicDemo.saveConfig({ ctaUrl: 'javascript:alert(1)' }), /https/);
  assert.equal(publicDemo.saveConfig({ ctaUrl: 'https://adhello.ai/book', ctaLabel: 'Book a call' }).ctaUrl, 'https://adhello.ai/book');

  publicDemo.saveConfig({ enabled: false });
  assert.equal(publicDemo.keyMatches(next.key), false);
});

test('launch builds a private sandbox, rate limits per visitor, and budgets AI', async () => {
  publicDemo._resetForTests();
  const { user, sandbox } = await publicDemo.launchSandbox({
    ip: '203.0.113.5',
    visitor: { name: 'Jane Roofer', email: 'jane@example.com', source: 'sales-page' },
  });
  assert.ok(publicDemo.isGuestEmail(user.emails[0].value));
  assert.equal(user.displayName, 'Jane Roofer');
  assert.equal(user.demoGuest.workspaceId, sandbox.workspaceId);

  const ws = await dbService.getWorkspace(sandbox.workspaceId);
  assert.equal(ws.isDemo, true);
  assert.ok(ws.publicDemoSandbox && ws.publicDemoSandbox.expiresAt);
  assert.match(ws.slug, /^live-demo-/);
  assert.ok((await dbService.getAllLeads(sandbox.workspaceId)).length > 10);
  assert.equal(publicDemo.isSandboxLive(user.demoGuest), true);
  assert.equal(publicDemo.recentLaunches(1)[0].email, 'jane@example.com');

  assert.equal(publicDemo.takeAiCall(sandbox.workspaceId), true);
  assert.equal(publicDemo.takeAiCall(sandbox.workspaceId), true);
  assert.equal(publicDemo.takeAiCall(sandbox.workspaceId), false);
  assert.equal(publicDemo.getSandbox(sandbox.workspaceId).aiCalls, 2);

  await publicDemo.launchSandbox({ ip: '203.0.113.5' });
  await publicDemo.launchSandbox({ ip: '203.0.113.5' });
  await assert.rejects(publicDemo.launchSandbox({ ip: '203.0.113.5' }), (e) => e instanceof publicDemo.DemoLimitError);
});

test('expired sandboxes are fully purged without touching other workspaces', async () => {
  publicDemo._resetForTests();
  const keep = await createDemoWorkspace('owner@example.com');
  const keepLeads = (await dbService.getAllLeads(keep.workspaceId)).length;
  const keepNetwork = await store.getNetworkForWorkspace(keep.workspaceId);

  const past = Date.now() - 25 * 3600000;
  const { user, sandbox } = await publicDemo.launchSandbox({ ip: '198.51.100.9' }, past);
  const wid = sandbox.workspaceId;
  const network = await store.getNetworkForWorkspace(wid);
  assert.ok(network && network.id);
  assert.equal(publicDemo.isSandboxLive(user.demoGuest), false);

  const purged = await publicDemo.purgeExpired();
  assert.ok(purged >= 1);
  assert.equal(await dbService.getWorkspace(wid), null);
  assert.equal((await dbService.getAllLeads(wid)).length, 0);
  assert.equal(dbService.listKvKeysSync('').filter((k) => k.includes(wid) || k.includes(`:${network.id}`)).length, 0);
  assert.equal((await dbService.getAllSearches()).filter((s) => s.workspaceId === wid).length, 0);
  assert.deepEqual(await dbService.getUserWorkspaceIds(sandbox.email), []);
  assert.equal(publicDemo.getSandbox(wid), null);

  assert.equal((await dbService.getAllLeads(keep.workspaceId)).length, keepLeads);
  assert.equal((await store.getNetworkForWorkspace(keep.workspaceId)).id, keepNetwork.id);
  await assert.rejects(publicDemo.purgeSandbox(keep.workspaceId), /not a public demo sandbox/);
});

test('only agency owners/admins manage the link; guests are kept out of settings', async () => {
  const agencyId = 'ws_agency_public_demo_test';
  await dbService.saveWorkspace(agencyId, {
    name: 'AdHello',
    ownerUserId: 'alex@adhello.ai',
    members: { 'alex@adhello.ai': { role: 'owner' }, 'rep@adhello.ai': { role: 'member' }, 'ops@adhello.ai': { role: 'admin' } },
  });
  await dbService.saveWorkspaceSlug('adhello-agency', agencyId);
  assert.equal(await publicDemo.canManage('alex@adhello.ai'), true);
  assert.equal(await publicDemo.canManage('alex@adhello.io'), true);
  assert.equal(await publicDemo.canManage('ops@adhello.ai'), true);
  assert.equal(await publicDemo.canManage('rep@adhello.ai'), false);
  assert.equal(await publicDemo.canManage('guest-abc@demo-guest.invalid'), false);

  const req = (method, p) => ({ method, path: p });
  assert.equal(isBlocked(req('GET', '/workspace/integrations')), true);
  assert.equal(isBlocked(req('POST', '/workspace/team/invite')), true);
  assert.equal(isBlocked(req('POST', '/workspaces')), true);
  assert.equal(isBlocked(req('GET', '/workspaces/live-demo')), true);
  assert.equal(isBlocked(req('GET', '/oauth/authorize')), true);
  assert.equal(isBlocked(req('GET', '/ceo')), true);
  assert.equal(isBlocked(req('GET', '/today')), false);
  assert.equal(isBlocked(req('POST', '/api/pavlex/chat')), false);
  assert.equal(isBlocked(req('POST', '/workspaces/switch')), false);
});
