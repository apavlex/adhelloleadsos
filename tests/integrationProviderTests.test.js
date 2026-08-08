const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  mergeBodyIntoIntegrationEnv,
  listProviderIds,
  PROVIDERS,
} = require('../services/integrationProviderTests');

describe('integrationProviderTests', () => {
  test('mergeBodyIntoIntegrationEnv overlays non-empty form fields', () => {
    const base = { RAPIDAPI_KEY: 'saved', RAPIDAPI_HOST: 'old.example.com' };
    const merged = mergeBodyIntoIntegrationEnv(base, {
      rapidapiHost: 'maps-data.p.rapidapi.com',
      rapidapiKey: '',
    });
    assert.equal(merged.RAPIDAPI_KEY, 'saved');
    assert.equal(merged.RAPIDAPI_HOST, 'maps-data.p.rapidapi.com');
  });

  test('listProviderIds includes rapidapi and pagespeed', () => {
    const ids = listProviderIds();
    assert.ok(ids.includes('rapidapi'));
    assert.ok(ids.includes('pagespeed'));
    assert.equal(PROVIDERS.rapidapi.fields.length, 5);
  });

  test('resolveProviderId matches camelCase rapidapiWebsite', () => {
    const { resolveProviderId } = require('../services/integrationProviderTests');
    assert.equal(resolveProviderId('rapidapiWebsite'), 'rapidapiWebsite');
    assert.equal(resolveProviderId('rapidapiwebsite'), 'rapidapiWebsite');
  });
});
