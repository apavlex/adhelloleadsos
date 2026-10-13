const test = require('node:test');
const assert = require('node:assert/strict');
const mapsSearch = require('../services/mapsSearch');

test('resolvePrimary defaults to rapidapi and remaps monid', () => {
  assert.equal(mapsSearch.resolvePrimary({}), 'rapidapi');
  assert.equal(mapsSearch.resolvePrimary({ SEARCH_MAPS_PRIMARY: '' }), 'rapidapi');
  assert.equal(mapsSearch.resolvePrimary({ SEARCH_MAPS_PRIMARY: 'monid' }), 'rapidapi');
  assert.equal(mapsSearch.resolvePrimary({ SEARCH_MAPS_PRIMARY: 'auto' }), 'auto');
  assert.equal(mapsSearch.resolvePrimary({ SEARCH_MAPS_PRIMARY: 'rapidapi' }), 'rapidapi');
  assert.equal(mapsSearch.resolvePrimary({ SEARCH_MAPS_PRIMARY: 'outscraper' }), 'outscraper');
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

test('preferred chain falls back to Outscraper when RapidAPI fails', async () => {
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
