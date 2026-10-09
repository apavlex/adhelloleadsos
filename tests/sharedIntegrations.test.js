const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-integrations-'));
process.env.WORKSPACE_INTEGRATIONS_SECRET = 'shared-integrations-test-secret';
['APIFY_API_TOKEN', 'RAPIDAPI_KEY', 'RAPIDAPI_LOCAL_BUSINESS_ENDPOINT', 'SERPAPI_API_KEY', 'GHL_API_KEY', 'GHL_LOCATION_ID', 'SHARED_INTEGRATIONS_WORKSPACE_ID'].forEach(
  (k) => delete process.env[k],
);

const test = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');
const wi = require('../services/workspaceIntegrations');

async function workspace(id, extra, keys) {
  await dbService.saveWorkspace(id, { id, name: id, members: {}, ...extra });
  if (keys) await wi.saveWorkspaceIntegrations(id, keys);
}

test.before(async () => {
  await workspace('ws_agency', { slug: 'adhello-agency' }, {
    rapidapiKey: 'agency-rapid',
    rapidapiLocalBusinessEndpoint: 'https://agency.example/search',
    apifyApiToken: 'agency-apify',
    serpapiApiKey: 'agency-serp',
    ghlApiKey: 'agency-ghl',
    ghlLocationId: 'agency-loc',
    lobApiKey: 'agency-lob',
  });
  await dbService.saveWorkspaceSlug('adhello-agency', 'ws_agency');
  await workspace('ws_client', {}, { rapidapiKey: 'client-rapid' });
  await workspace('ws_new', {});
  await workspace('ws_trial', { trial: { startedAt: new Date().toISOString(), endsAt: new Date(Date.now() + 864e5).toISOString() } });
  await workspace('ws_demo', { isDemo: true });
});

test('a new workspace borrows the agency lead-search and AI keys', async () => {
  const env = await wi.getResolvedIntegrationEnv('ws_new');
  assert.equal(env.RAPIDAPI_KEY, 'agency-rapid');
  assert.equal(env.RAPIDAPI_LOCAL_BUSINESS_ENDPOINT, 'https://agency.example/search');
  assert.equal(env.APIFY_API_TOKEN, 'agency-apify');
  assert.equal(env.SERPAPI_API_KEY, 'agency-serp');
});

test('GHL and direct mail are never shared', async () => {
  const env = await wi.getResolvedIntegrationEnv('ws_new');
  assert.equal(env.GHL_API_KEY, '');
  assert.equal(env.GHL_LOCATION_ID, '');
  assert.equal(env.LOB_API_KEY, '');
});

test("a workspace's own key wins, and its whole provider group stays its own", async () => {
  const env = await wi.getResolvedIntegrationEnv('ws_client');
  assert.equal(env.RAPIDAPI_KEY, 'client-rapid');
  assert.equal(env.RAPIDAPI_LOCAL_BUSINESS_ENDPOINT, '');
  assert.equal(env.APIFY_API_TOKEN, 'agency-apify');
  const labels = await wi.sharedProvidersFor('ws_client');
  assert.ok(labels.includes('Apify'));
  assert.ok(!labels.includes('RapidAPI (Maps)'));
});

test('trials borrow search keys but keep agency messaging off; demos borrow nothing', async () => {
  const trial = await wi.getResolvedIntegrationEnv('ws_trial');
  assert.equal(trial.APIFY_API_TOKEN, 'agency-apify');
  assert.equal(trial.GHL_API_KEY, 'trial-disabled');
  const demo = await wi.getResolvedIntegrationEnv('ws_demo');
  assert.equal(demo.APIFY_API_TOKEN, '');
  assert.deepEqual(await wi.sharedProvidersFor('ws_demo'), []);
});

test('the agency workspace itself is not marked as borrowing', async () => {
  assert.deepEqual(await wi.sharedProvidersFor('ws_agency'), []);
  const env = await wi.getResolvedIntegrationEnv('ws_agency');
  assert.equal(env.GHL_API_KEY, 'agency-ghl');
});
