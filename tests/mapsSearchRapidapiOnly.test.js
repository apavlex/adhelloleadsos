const test = require('node:test');
const assert = require('node:assert/strict');
const mapsSearch = require('../services/mapsSearch');

test('resolvePrimary defaults to rapidapi and remaps monid', () => {
  assert.equal(mapsSearch.resolvePrimary({}), 'rapidapi');
  assert.equal(mapsSearch.resolvePrimary({ SEARCH_MAPS_PRIMARY: '' }), 'rapidapi');
  assert.equal(mapsSearch.resolvePrimary({ SEARCH_MAPS_PRIMARY: 'monid' }), 'rapidapi');
  assert.equal(mapsSearch.resolvePrimary({ SEARCH_MAPS_PRIMARY: 'auto' }), 'auto');
  assert.equal(mapsSearch.resolvePrimary({ SEARCH_MAPS_PRIMARY: 'rapidapi' }), 'rapidapi');
  assert.equal(mapsSearch.resolvePrimary({ SEARCH_MAPS_PRIMARY: 'searchapi' }), 'searchapi');
});

test('getMapsProviderStatusList no longer lists Monid', () => {
  const list = mapsSearch.getMapsProviderStatusList({});
  assert.ok(list.some((p) => p.id === 'rapidapi'));
  assert.ok(!list.some((p) => p.id === 'monid'));
});

test('isMapsSearchConfigured ignores Monid-only keys', () => {
  assert.equal(mapsSearch.isMapsSearchConfigured({ MONID_API_KEY: 'monid_live_x' }), false);
  assert.equal(mapsSearch.isMapsSearchConfigured({ RAPIDAPI_KEY: 'rapid-key' }), true);
});
