const test = require('node:test');
const assert = require('node:assert/strict');
const mapsSearch = require('../services/mapsSearch');

test('resolvePrimary defaults to rapidapi and remaps monid/auto', () => {
  assert.equal(mapsSearch.resolvePrimary({}), 'rapidapi');
  assert.equal(mapsSearch.resolvePrimary({ SEARCH_MAPS_PRIMARY: '' }), 'rapidapi');
  assert.equal(mapsSearch.resolvePrimary({ SEARCH_MAPS_PRIMARY: 'monid' }), 'rapidapi');
  assert.equal(mapsSearch.resolvePrimary({ SEARCH_MAPS_PRIMARY: 'auto' }), 'rapidapi');
  assert.equal(mapsSearch.resolvePrimary({ SEARCH_MAPS_PRIMARY: 'rapidapi' }), 'rapidapi');
  assert.equal(mapsSearch.resolvePrimary({ SEARCH_MAPS_PRIMARY: 'outscraper' }), 'outscraper');
  assert.equal(mapsSearch.resolvePrimary({ SEARCH_MAPS_PRIMARY: 'searchapi' }), 'searchapi');
});

test('getMapsProviderStatusList lists RapidAPI then Outscraper first', () => {
  const list = mapsSearch.getMapsProviderStatusList({});
  assert.equal(list[0].id, 'rapidapi');
  assert.equal(list[1].id, 'outscraper');
  assert.ok(!list.some((p) => p.id === 'monid'));
});

test('isMapsSearchConfigured accepts RapidAPI or Outscraper', () => {
  assert.equal(mapsSearch.isMapsSearchConfigured({ MONID_API_KEY: 'monid_live_x' }), false);
  assert.equal(mapsSearch.isMapsSearchConfigured({ RAPIDAPI_KEY: 'rapid-key' }), true);
  assert.equal(mapsSearch.isMapsSearchConfigured({ OUTSCRAPER_API_KEY: 'out-key' }), true);
});

test('auto / rapidapi falls back to Outscraper when RapidAPI fails', async () => {
  const rapidapi = require('../services/rapidapiLocalBusiness');
  const outscraper = require('../services/outscraperClient');
  const origRapid = rapidapi.searchGoogleMaps;
  const origOut = outscraper.searchGoogleMaps;
  const origRapidCfg = rapidapi.isConfigured;
  const origOutCfg = outscraper.isConfigured;

  rapidapi.isConfigured = () => true;
  outscraper.isConfigured = () => true;
  rapidapi.searchGoogleMaps = async () => {
    throw new Error('RapidAPI rate limit');
  };
  outscraper.searchGoogleMaps = async () => [
    { title: 'Fallback Co', phone: '555', placeId: 'pid_fallback', website: 'N/A', email: 'N/A' },
  ];

  try {
    for (const mapsProvider of ['auto', 'rapidapi', undefined]) {
      const rows = await mapsSearch.searchGoogleMaps({
        keyword: 'plumber',
        city: 'Camas',
        state: 'WA',
        maxResults: 5,
        integrationEnv: { RAPIDAPI_KEY: 'x', OUTSCRAPER_API_KEY: 'y' },
        mapsProvider,
      });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].title, 'Fallback Co');
    }
  } finally {
    rapidapi.searchGoogleMaps = origRapid;
    outscraper.searchGoogleMaps = origOut;
    rapidapi.isConfigured = origRapidCfg;
    outscraper.isConfigured = origOutCfg;
  }
});

test('workspace SearchAPI primary uses SearchAPI then Outscraper on auto', async () => {
  const searchapi = require('../services/searchapiGoogleLocal');
  const outscraper = require('../services/outscraperClient');
  const rapidapi = require('../services/rapidapiLocalBusiness');
  const origSearch = searchapi.searchGoogleMaps;
  const origOut = outscraper.searchGoogleMaps;
  const origRapid = rapidapi.searchGoogleMaps;
  const origSearchCfg = searchapi.isConfigured;
  const origOutCfg = outscraper.isConfigured;
  const origRapidCfg = rapidapi.isConfigured;

  searchapi.isConfigured = () => true;
  outscraper.isConfigured = () => true;
  rapidapi.isConfigured = () => true;
  let rapidCalled = false;
  rapidapi.searchGoogleMaps = async () => {
    rapidCalled = true;
    return [];
  };
  searchapi.searchGoogleMaps = async () => {
    throw new Error('SearchAPI quota');
  };
  outscraper.searchGoogleMaps = async () => [
    { title: 'Outscraper Fallback', placeId: 'pid_out' },
  ];

  try {
    const rows = await mapsSearch.searchGoogleMaps({
      keyword: 'siding contractor',
      city: 'Portland',
      state: 'OR',
      maxResults: 5,
      integrationEnv: {
        SEARCHAPI_API_KEY: 'z',
        OUTSCRAPER_API_KEY: 'y',
        RAPIDAPI_KEY: 'x',
        SEARCH_MAPS_PRIMARY: 'searchapi',
      },
      mapsProvider: 'auto',
    });
    assert.equal(rapidCalled, false);
    assert.equal(rows[0].title, 'Outscraper Fallback');
  } finally {
    searchapi.searchGoogleMaps = origSearch;
    outscraper.searchGoogleMaps = origOut;
    rapidapi.searchGoogleMaps = origRapid;
    searchapi.isConfigured = origSearchCfg;
    outscraper.isConfigured = origOutCfg;
    rapidapi.isConfigured = origRapidCfg;
  }
});
