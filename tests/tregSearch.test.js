const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'treg-search-'));

const test = require('node:test');
const assert = require('node:assert/strict');

const tregClient = require('../services/tregClient');
const tregSearchMode = require('../services/tregSearchMode');
const tregSearches = require('../services/tregSearches');
const mapsSearch = require('../services/mapsSearch');
const webSearch = require('../services/listingSearch/sources/webSearch');

function mockResponse({ status = 200, headers = {}, json = {} }) {
  const lower = {};
  for (const [key, value] of Object.entries(headers)) lower[key.toLowerCase()] = value;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => lower[String(name).toLowerCase()] || null },
    text: async () => JSON.stringify(json),
  };
}

test('customer tags stay within the treg meta rules', () => {
  assert.equal(tregClient.customerTag('ws_home-elk'), 'ws_home-elk');
  assert.equal(tregClient.customerTag('owner@example.com'), 'workspace');
  assert.equal(tregClient.customerTag('a b/c'), 'a_b_c');
  assert.equal(tregClient.featureTag('maps search'), 'mapssearch');
});

test('treg billing errors do not include the account balance', () => {
  const msg = tregClient.safeUserMessage(
    402,
    true,
    { error: 'insufficient_balance', balance_micro: 12, topup_url: 'https://treg.to/topup' },
  );
  assert.match(msg, /topped up/i);
  assert.doesNotMatch(msg, /balance_micro|topup_url|insufficient_balance/);
});

test('workspace search mode round-trips and demos stay on default builds', () => {
  const wid = `treg-test-${Date.now()}`;
  assert.equal(tregSearchMode.getMode(wid), 'default');
  assert.equal(tregSearchMode.setMode(wid, 'treg'), 'treg');
  assert.equal(tregSearchMode.getMode(wid), 'treg');
  const env = tregSearchMode.applyToEnv(wid, {}, { isDemo: true });
  assert.equal(env.SEARCH_ENGINE, 'default');
  assert.equal(env.ADHELLO_WORKSPACE_ID, wid);
  const live = tregSearchMode.applyToEnv(wid, {}, null);
  assert.equal(live.SEARCH_ENGINE, 'treg');
  assert.equal(tregSearchMode.isOn(live), true);
  assert.throws(() => tregSearchMode.setMode(wid, 'somewhere-else'), /Default builds or Treg/);
});

test('Maps search uses treg when the workspace switch is on', async () => {
  const previous = process.env.TREG_TOKEN;
  process.env.TREG_TOKEN = 'treg_test_token';
  let seen = null;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return mockResponse({
      headers: {
        'x-treg-call-id': 'call_1',
        'x-treg-cost-micro': '230',
        'x-treg-served-by': 'crawl4ai',
      },
      json: {
        output: {
          places: [
            {
              title: "Joe's Plumbing",
              address: '1 Main St, Camas, WA',
              phone: '360-555-0100',
              rating: { value: 4.6, votes_count: 12 },
              place_id: 'ChIJtest',
              category: 'Plumber',
              website: 'https://joes.example',
            },
            {
              title: 'Serp Place',
              address: '2 Side St',
              phone: '360-555-0199',
              rating: 4.2,
              reviews: 8,
              place_id: 'pid_serp',
              type: 'Plumber',
              links: { website: 'https://serp.example' },
            },
          ],
        },
      },
    });
  };

  try {
    assert.equal(
      mapsSearch.isMapsSearchConfigured({ SEARCH_ENGINE: 'treg', ADHELLO_WORKSPACE_ID: 'ws1' }),
      true,
    );
    const rows = await mapsSearch.searchGoogleMaps({
      keyword: 'plumber',
      city: 'Camas',
      state: 'WA',
      maxResults: 5,
      mapsProvider: 'apify',
      integrationEnv: { SEARCH_ENGINE: 'treg', ADHELLO_WORKSPACE_ID: 'ws1' },
      fetchImpl,
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].title, "Joe's Plumbing");
    assert.equal(rows[0].phone, '360-555-0100');
    assert.equal(rows[0].totalScore, 4.6);
    assert.equal(rows[0].reviewsCount, 12);
    assert.equal(rows[0].website, 'https://joes.example');
    assert.equal(rows[0].placeId, 'ChIJtest');
    assert.equal(rows[1].website, 'https://serp.example');
    assert.equal(rows[1].reviewsCount, 8);
    assert.match(seen.url, /\/call\/treg\.google\.serp\.maps$/);
    assert.equal(seen.init.headers['X-Treg-Token'], 'treg_test_token');
    assert.equal(seen.init.headers['X-Treg-Meta'], 'customer=ws1, feature=maps-search');
    assert.equal(seen.init.headers['X-Treg-Route-Max-Cost'], '0.25');
    const body = JSON.parse(seen.init.body);
    assert.match(body.q, /plumber/i);
    assert.match(body.q, /Camas/i);
    assert.equal(body.country, 'us');
    const saved = tregClient.lastUsage('ws1');
    assert.equal(saved.callId, 'call_1');
    assert.equal(saved.costMicro, 230);
  } finally {
    if (previous == null) delete process.env.TREG_TOKEN;
    else process.env.TREG_TOKEN = previous;
  }
});

test('a treg 402 becomes a user-safe maps error', async () => {
  const previous = process.env.TREG_TOKEN;
  process.env.TREG_TOKEN = 'treg_test_token';
  const fetchImpl = async () =>
    mockResponse({
      status: 402,
      headers: { 'x-treg-error': '1' },
      json: { error: 'insufficient_balance', balance_micro: 0, topup_url: 'https://treg.to/topup' },
    });
  try {
    await assert.rejects(
      () =>
        tregSearches.searchGoogleMaps({
          keyword: 'roofer',
          city: 'Austin',
          state: 'TX',
          integrationEnv: { ADHELLO_WORKSPACE_ID: 'ws-402' },
          fetchImpl,
        }),
      (err) => {
        assert.match(err.message, /topped up/i);
        assert.doesNotMatch(err.message, /topup|balance_micro/);
        return true;
      },
    );
  } finally {
    if (previous == null) delete process.env.TREG_TOKEN;
    else process.env.TREG_TOKEN = previous;
  }
});

test('web listing search keeps listing urls and drops the rest', async () => {
  const previous = process.env.TREG_TOKEN;
  process.env.TREG_TOKEN = 'treg_test_token';
  const fetchImpl = async () =>
    mockResponse({
      headers: { 'x-treg-call-id': 'call_web', 'x-treg-cost-micro': '150' },
      json: {
        output: {
          results: [
            {
              title: 'Mobile home for sale $89,000',
              url: 'https://www.zillow.com/homedetails/123',
              snippet: '3 bed in Camas',
            },
            {
              title: 'Wikipedia',
              url: 'https://en.wikipedia.org/wiki/Mobile_home',
              snippet: 'A manufactured house',
            },
          ],
        },
      },
    });
  try {
    assert.equal(webSearch.isConfigured({ SEARCH_ENGINE: 'treg' }), true);
    const rows = await webSearch.search({
      city: 'Camas',
      state: 'WA',
      query: 'mobile home',
      maxResults: 10,
      integrationEnv: { SEARCH_ENGINE: 'treg', ADHELLO_WORKSPACE_ID: 'ws-web' },
      fetchImpl,
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].listing.source, 'web_treg');
    assert.match(rows[0].url, /zillow\.com/);
    assert.equal(rows[0].listing.price, 89000);
  } finally {
    if (previous == null) delete process.env.TREG_TOKEN;
    else process.env.TREG_TOKEN = previous;
  }
});

test('default builds do not call treg', async () => {
  let called = false;
  const rapidapi = require('../services/rapidapiLocalBusiness');
  const original = rapidapi.searchGoogleMaps;
  const originalCfg = rapidapi.isConfigured;
  rapidapi.isConfigured = () => true;
  rapidapi.searchGoogleMaps = async () => {
    called = true;
    return [{ title: 'Built In Co', phone: '555', placeId: 'pid', website: 'N/A', email: 'N/A' }];
  };
  try {
    const rows = await mapsSearch.searchGoogleMaps({
      keyword: 'plumber',
      city: 'Camas',
      state: 'WA',
      integrationEnv: { RAPIDAPI_KEY: 'x', SEARCH_ENGINE: 'default' },
      fetchImpl: async () => {
        throw new Error('treg should not be called');
      },
    });
    assert.equal(called, true);
    assert.equal(rows[0].title, 'Built In Co');
    const token = process.env.TREG_TOKEN;
    delete process.env.TREG_TOKEN;
    assert.equal(mapsSearch.isMapsSearchConfigured({ SEARCH_ENGINE: 'treg' }), false);
    if (token != null) process.env.TREG_TOKEN = token;
    assert.match(mapsSearch.notConfiguredMessage({ SEARCH_ENGINE: 'treg' }), /TREG_TOKEN/);
    assert.match(mapsSearch.notConfiguredMessage({}), /API integrations/);
  } finally {
    rapidapi.searchGoogleMaps = original;
    rapidapi.isConfigured = originalCfg;
  }
});
