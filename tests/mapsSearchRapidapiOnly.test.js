const test = require('node:test');
const assert = require('node:assert/strict');
const mapsSearch = require('../services/mapsSearch');

test('resolvePrimary defaults to auto and remaps monid', () => {
  assert.equal(mapsSearch.resolvePrimary({}), 'auto');
  assert.equal(mapsSearch.resolvePrimary({ SEARCH_MAPS_PRIMARY: '' }), 'auto');
  assert.equal(mapsSearch.resolvePrimary({ SEARCH_MAPS_PRIMARY: 'monid' }), 'auto');
  assert.equal(mapsSearch.resolvePrimary({ SEARCH_MAPS_PRIMARY: 'auto' }), 'auto');
  assert.equal(mapsSearch.resolvePrimary({ SEARCH_MAPS_PRIMARY: 'rapidapi' }), 'rapidapi');
  assert.equal(mapsSearch.resolvePrimary({ SEARCH_MAPS_PRIMARY: 'outscraper' }), 'outscraper');
});

test('getMapsProviderStatusList lists Auto chain order', () => {
  const list = mapsSearch.getMapsProviderStatusList({});
  assert.deepEqual(
    list.map((p) => p.id),
    ['rapidapi', 'searchapi', 'serpapi', 'oxylabs', 'outscraper', 'apify'],
  );
  assert.ok(!list.some((p) => p.id === 'monid'));
});

test('isMapsSearchConfigured accepts RapidAPI or Outscraper', () => {
  assert.equal(mapsSearch.isMapsSearchConfigured({ MONID_API_KEY: 'monid_live_x' }), false);
  assert.equal(mapsSearch.isMapsSearchConfigured({ RAPIDAPI_KEY: 'rapid-key' }), true);
  assert.equal(mapsSearch.isMapsSearchConfigured({ OUTSCRAPER_API_KEY: 'out-key' }), true);
  assert.equal(mapsSearch.isMapsSearchConfigured({ SEARCHAPI_API_KEY: 'search-key' }), true);
});

test('rapidapi mode falls back to Outscraper when RapidAPI fails', async () => {
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
    const rows = await mapsSearch.searchGoogleMaps({
      keyword: 'plumber',
      city: 'Camas',
      state: 'WA',
      maxResults: 5,
      integrationEnv: { RAPIDAPI_KEY: 'x', OUTSCRAPER_API_KEY: 'y' },
      mapsProvider: 'rapidapi',
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, 'Fallback Co');
  } finally {
    rapidapi.searchGoogleMaps = origRapid;
    outscraper.searchGoogleMaps = origOut;
    rapidapi.isConfigured = origRapidCfg;
    outscraper.isConfigured = origOutCfg;
  }
});

test('auto mode continues past RapidAPI and Outscraper to SearchAPI', async () => {
  const rapidapi = require('../services/rapidapiLocalBusiness');
  const outscraper = require('../services/outscraperClient');
  const searchapi = require('../services/searchapiGoogleLocal');
  const origRapid = rapidapi.searchGoogleMaps;
  const origOut = outscraper.searchGoogleMaps;
  const origSearch = searchapi.searchGoogleMaps;
  const origRapidCfg = rapidapi.isConfigured;
  const origOutCfg = outscraper.isConfigured;
  const origSearchCfg = searchapi.isConfigured;

  rapidapi.isConfigured = () => true;
  outscraper.isConfigured = () => true;
  searchapi.isConfigured = () => true;
  rapidapi.searchGoogleMaps = async () => {
    throw new Error('You have exceeded the M quota for Requests on your current plan, BASIC');
  };
  outscraper.searchGoogleMaps = async () => {
    throw new Error('Please check credit card information is correct, add credits');
  };
  searchapi.searchGoogleMaps = async () => [
    { title: 'SearchAPI Co', phone: '555', placeId: 'pid_searchapi', website: 'N/A', email: 'N/A' },
  ];

  try {
    const rows = await mapsSearch.searchGoogleMaps({
      keyword: 'siding contractor',
      city: 'Portland',
      state: 'OR',
      maxResults: 5,
      integrationEnv: {
        RAPIDAPI_KEY: 'x',
        OUTSCRAPER_API_KEY: 'y',
        SEARCHAPI_API_KEY: 'z',
      },
      mapsProvider: 'auto',
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, 'SearchAPI Co');
  } finally {
    rapidapi.searchGoogleMaps = origRapid;
    outscraper.searchGoogleMaps = origOut;
    searchapi.searchGoogleMaps = origSearch;
    rapidapi.isConfigured = origRapidCfg;
    outscraper.isConfigured = origOutCfg;
    searchapi.isConfigured = origSearchCfg;
  }
});

test('explicit mapsProvider=auto is not overridden by SEARCH_MAPS_PRIMARY=rapidapi', async () => {
  const rapidapi = require('../services/rapidapiLocalBusiness');
  const searchapi = require('../services/searchapiGoogleLocal');
  const outscraper = require('../services/outscraperClient');
  const origRapid = rapidapi.searchGoogleMaps;
  const origSearch = searchapi.searchGoogleMaps;
  const origOut = outscraper.searchGoogleMaps;
  const origRapidCfg = rapidapi.isConfigured;
  const origSearchCfg = searchapi.isConfigured;
  const origOutCfg = outscraper.isConfigured;

  rapidapi.isConfigured = () => true;
  searchapi.isConfigured = () => true;
  outscraper.isConfigured = () => false;
  let searchapiCalled = false;
  rapidapi.searchGoogleMaps = async () => {
    throw new Error('quota exceeded');
  };
  searchapi.searchGoogleMaps = async () => {
    searchapiCalled = true;
    return [{ title: 'From Auto Chain', placeId: 'pid_a' }];
  };
  outscraper.searchGoogleMaps = async () => [];

  try {
    const rows = await mapsSearch.searchGoogleMaps({
      keyword: 'plumber',
      city: 'Portland',
      state: 'OR',
      maxResults: 5,
      integrationEnv: {
        RAPIDAPI_KEY: 'x',
        SEARCHAPI_API_KEY: 'z',
        SEARCH_MAPS_PRIMARY: 'rapidapi',
      },
      mapsProvider: 'auto',
    });
    assert.equal(searchapiCalled, true);
    assert.equal(rows[0].title, 'From Auto Chain');
  } finally {
    rapidapi.searchGoogleMaps = origRapid;
    searchapi.searchGoogleMaps = origSearch;
    outscraper.searchGoogleMaps = origOut;
    rapidapi.isConfigured = origRapidCfg;
    searchapi.isConfigured = origSearchCfg;
    outscraper.isConfigured = origOutCfg;
  }
});
