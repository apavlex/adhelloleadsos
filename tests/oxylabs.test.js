const test = require('node:test');
const assert = require('node:assert/strict');
const oxylabs = require('../services/oxylabsClient');
const oxylabsSource = require('../services/listingSearch/sources/oxylabs');
const { parseSourcesList } = require('../services/listingSearch');
const mapsSearch = require('../services/mapsSearch');

test('oxylabs isConfigured with username and password', () => {
  assert.equal(oxylabs.isConfigured({}), false);
  assert.equal(
    oxylabs.isConfigured({ OXYLABS_USERNAME: 'customer-test', OXYLABS_PASSWORD: 'secret' }),
    true
  );
});

test('oxylabs listing source is registered', () => {
  assert.equal(oxylabsSource.id, 'oxylabs');
  assert.equal(
    oxylabsSource.isConfigured({ OXYLABS_USERNAME: 'u', OXYLABS_PASSWORD: 'p' }),
    true
  );
  const ids = parseSourcesList(['oxylabs', 'craigslist']);
  assert.ok(ids.includes('oxylabs'));
});

test('maps provider status includes oxylabs', () => {
  const list = mapsSearch.getMapsProviderStatusList({
    OXYLABS_USERNAME: 'customer-x',
    OXYLABS_PASSWORD: 'y',
  });
  const ox = list.find((p) => p.id === 'oxylabs');
  assert.ok(ox);
  assert.equal(ox.configured, true);
});

test('geoLocationForCityState formats US city', () => {
  const loc = oxylabs.geoLocationForCityState('Phoenix', 'AZ');
  assert.match(loc, /Phoenix/i);
  assert.match(loc, /United States/i);
});
