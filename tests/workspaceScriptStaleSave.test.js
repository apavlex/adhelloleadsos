const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'script-stale-save-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');
const { restoreMissingOffers } = require('../services/workspaceSalesScripts');
const { rememberMemberProfile } = require('../services/teamActivity');

const OFFER = { key: 'overflow_referral', label: 'Overflow Referral', tabLabel: 'Overflow Referral' };

async function seed(id) {
  await dbService.saveWorkspace(id, {
    id,
    name: 'Agency',
    members: { 'alex@example.com': { role: 'owner' } },
    salesScriptOfferCatalog: [{ key: 'reputation', label: 'Reputation' }],
    salesScriptBlockOverrides: {},
    salesScriptsUpdatedAt: '2026-10-01T10:00:00.000Z',
  });
}

test('a stale whole-workspace save does not roll back newer script edits', async () => {
  await seed('ws_stale');
  const staleCopy = await dbService.getWorkspace('ws_stale');

  const live = await dbService.getWorkspace('ws_stale');
  live.salesScriptOfferCatalog.push({ ...OFFER, senderBusinessName: 'Partnering any way' });
  live.salesScriptBlockOverrides = { overflow_referral: { sms: 'Hi {{name}}' } };
  live.salesScriptsUpdatedAt = '2026-10-01T10:05:00.000Z';
  await dbService.saveWorkspace('ws_stale', live);

  staleCopy.prospecting = { autoPool: { lastRunAt: '2026-10-01T10:06:00.000Z' } };
  await dbService.saveWorkspace('ws_stale', staleCopy);

  const after = await dbService.getWorkspace('ws_stale');
  assert.deepEqual(after.salesScriptOfferCatalog.map((r) => r.key), ['reputation', 'overflow_referral']);
  assert.equal(after.salesScriptBlockOverrides.overflow_referral.sms, 'Hi {{name}}');
  assert.equal(after.salesScriptsUpdatedAt, '2026-10-01T10:05:00.000Z');
  assert.equal(after.prospecting.autoPool.lastRunAt, '2026-10-01T10:06:00.000Z', 'non-script fields still save');
});

test('a newer script save still replaces the stored scripts', async () => {
  await seed('ws_newer');
  const ws = await dbService.getWorkspace('ws_newer');
  ws.salesScriptOfferCatalog = [OFFER];
  ws.salesScriptsUpdatedAt = '2026-10-01T11:00:00.000Z';
  await dbService.saveWorkspace('ws_newer', ws);
  const after = await dbService.getWorkspace('ws_newer');
  assert.deepEqual(after.salesScriptOfferCatalog.map((r) => r.key), ['overflow_referral']);
});

test('a save without a script stamp keeps the stored scripts', async () => {
  await seed('ws_nostamp');
  await dbService.saveWorkspace('ws_nostamp', { id: 'ws_nostamp', name: 'Renamed', members: {} });
  const after = await dbService.getWorkspace('ws_nostamp');
  assert.equal(after.name, 'Renamed');
  assert.deepEqual(after.salesScriptOfferCatalog.map((r) => r.key), ['reputation']);
});

test('member profile refresh does not overwrite scripts saved after the request loaded', async () => {
  await seed('ws_profile');
  const reqWorkspace = await dbService.getWorkspace('ws_profile');

  const live = await dbService.getWorkspace('ws_profile');
  live.salesScriptOfferCatalog.push(OFFER);
  live.salesScriptsUpdatedAt = '2026-10-01T10:05:00.000Z';
  live.accentColor = '#123456';
  await dbService.saveWorkspace('ws_profile', live);

  await rememberMemberProfile({
    workspace: reqWorkspace,
    user: { emails: [{ value: 'alex@example.com' }], displayName: 'Alex', photos: [{ value: 'https://x/a.png' }] },
  });
  const after = await dbService.getWorkspace('ws_profile');
  assert.equal(after.members['alex@example.com'].name, 'Alex');
  assert.equal(after.accentColor, '#123456');
  assert.ok(after.salesScriptOfferCatalog.some((r) => r.key === 'overflow_referral'));
});

test('restoreMissingOffers re-adds only the offers being saved', () => {
  const ws = { id: 'w', salesScriptOfferCatalog: [{ key: 'reputation', label: 'Reputation' }] };
  const gone = { key: 'deleted_elsewhere', label: 'Old' };
  assert.deepEqual(restoreMissingOffers(ws, ['overflow_referral'], [OFFER, gone]), ['overflow_referral']);
  assert.deepEqual(ws.salesScriptOfferCatalog.map((r) => r.key), ['reputation', 'overflow_referral']);
  assert.deepEqual(restoreMissingOffers(ws, ['overflow_referral'], [OFFER]), [], 'no duplicates');
  assert.deepEqual(restoreMissingOffers(ws, ['bad key'], [{ key: 'bad key', label: 'x' }]), []);
});
