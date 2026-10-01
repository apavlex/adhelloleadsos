const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'script-push-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');
const scriptPush = require('../services/scriptPush');
const { buildWorkspaceOfferLibrary, sanitizeOfferCatalogInput } = require('../services/workspaceSalesScripts');
const { shouldRepairAgencyCatalogLeak } = require('../services/workspaceScriptBootstrap');
const { SCRIPT_LIBRARY } = require('../services/salesConstants');

const ME = 'owner@example.com';

async function makeWs(id, name, role, extra = {}) {
  await dbService.saveWorkspace(id, {
    id,
    name,
    slug: id,
    members: { [ME]: { role }, 'rep@example.com': { role: 'sdr' } },
    salesScriptsSeededAt: '2026-01-01T00:00:00.000Z',
    salesScriptsPresetKey: extra.presetKey || 'local_service',
    salesScriptOfferCatalog: extra.catalog || [],
    salesScriptBlockOverrides: extra.blocks || {},
  });
  await dbService.addUserWorkspaceId(ME, id);
}

test('push offer scripts to managed workspaces, then update them in place', async () => {
  await makeWs('ws_main', 'AdHello', 'owner', {
    presetKey: 'agency',
    catalog: [
      { key: 'reputation', label: 'Reputation', senderBusinessName: 'AdHello' },
      { key: 'seat_invite', label: 'Seat invite' },
    ],
    blocks: {
      reputation: { opening: 'Call v1', sms: 'SMS v1', email: 'Email v1' },
      seat_invite: { opening: 'Seat call' },
    },
  });
  await makeWs('ws_roof', 'Roof Co', 'admin', {
    catalog: [{ key: 'roof_repair', label: 'Roof repair', senderBusinessName: 'Roof Co' }, { key: 'seat', label: 'Seat Invite' }],
    blocks: { roof_repair: { opening: 'Roof call' }, seat: { opening: 'Old seat call' } },
  });
  await makeWs('ws_viewer', 'Not mine', 'sdr');

  const targets = await scriptPush.listPushTargets(ME, 'ws_main');
  assert.deepEqual(targets.map((t) => t.id), ['ws_roof'], 'only workspaces I manage, never the source');

  const denied = await scriptPush.pushOffers({ email: ME, sourceWid: 'ws_main', offerKeys: ['reputation'], targetIds: ['ws_viewer'] });
  assert.equal(denied.results[0].ok, false);
  assert.equal((await dbService.getWorkspace('ws_viewer')).salesScriptOfferCatalog.length, 0);

  const first = await scriptPush.pushOffers({
    email: ME,
    sourceWid: 'ws_main',
    offerKeys: ['reputation', 'seat_invite'],
    targetIds: ['ws_roof'],
  });
  assert.deepEqual(first.results[0], { id: 'ws_roof', name: 'Roof Co', ok: true, created: 1, updated: 1 });

  let roof = await dbService.getWorkspace('ws_roof');
  let lib = buildWorkspaceOfferLibrary(roof, SCRIPT_LIBRARY);
  assert.deepEqual(lib.keys, ['roof_repair', 'seat', 'reputation'], 'same-name offer reused, new one appended');
  assert.equal(lib.library.seat.opening, 'Seat call');
  assert.equal(lib.library.reputation.opening, 'Call v1');
  assert.equal(lib.library.reputation.sms, 'SMS v1');
  assert.equal(lib.library.roof_repair.opening, 'Roof call', 'unrelated offers untouched');
  assert.equal(lib.catalog.find((c) => c.key === 'reputation').senderBusinessName, '', 'sender details not copied by default');
  assert.equal(shouldRepairAgencyCatalogLeak(roof), false, 'pushed agency offer must not trigger the catalog repair');

  // Rename in the target, then a reorder save (which re-sanitizes the catalog) must keep the link.
  roof.salesScriptOfferCatalog = sanitizeOfferCatalogInput(
    roof.salesScriptOfferCatalog.map((c) => (c.key === 'reputation' ? { ...c, label: 'Reviews' } : c)).reverse(),
  );
  await dbService.saveWorkspace('ws_roof', roof);

  const main = await dbService.getWorkspace('ws_main');
  main.salesScriptBlockOverrides.reputation = { opening: 'Call v2', sms: 'SMS v2', email: '' };
  await dbService.saveWorkspace('ws_main', main);

  const second = await scriptPush.pushOffers({
    email: ME,
    sourceWid: 'ws_main',
    offerKeys: ['reputation'],
    targetIds: ['ws_roof'],
    includeSender: true,
  });
  assert.equal(second.results[0].updated, 1);
  assert.equal(second.results[0].created, 0);
  roof = await dbService.getWorkspace('ws_roof');
  lib = buildWorkspaceOfferLibrary(roof, SCRIPT_LIBRARY);
  assert.equal(lib.keys.filter((k) => k === 'reputation').length, 1);
  assert.equal(lib.library.reputation.opening, 'Call v2');
  assert.equal(lib.library.reputation.email, '');
  assert.equal(lib.catalog.find((c) => c.key === 'reputation').senderBusinessName, 'AdHello');

  const after = await scriptPush.listPushTargets(ME, 'ws_main');
  assert.deepEqual(after[0].linkedKeys.sort(), ['reputation', 'seat_invite']);
  const log = (await dbService.getWorkspace('ws_main')).scriptPushLog;
  assert.equal(log.length, 3);
  assert.equal(log[0].includeSender, true);
});

test('push rejects users who cannot manage the source workspace', async () => {
  const res = await scriptPush.pushOffers({ email: ME, sourceWid: 'ws_viewer', offerKeys: ['x'], targetIds: ['ws_roof'] });
  assert.equal(res.ok, false);
});
