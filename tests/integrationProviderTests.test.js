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
    assert.ok(ids.includes('openrouter'));
    assert.equal(PROVIDERS.rapidapi.fields.length, 5);
  });

  test('treg Test & save checks the catalog with the pasted key', async () => {
  const { runProviderTest } = require('../services/integrationProviderTests');
  const previous = process.env.TREG_TOKEN;
  delete process.env.TREG_TOKEN;
  const original = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), token: init && init.headers && init.headers['X-Treg-Token'] });
    return new Response(JSON.stringify({ results: [{ id: 'treg.web.search', name: 'web search' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const missing = await runProviderTest('treg', {});
    assert.equal(missing.ok, false);
    assert.match(missing.message, /Treg API key/);
    const result = await runProviderTest('treg', { TREG_TOKEN: 'treg_test_key' });
    assert.equal(result.ok, true);
    assert.equal(result.provider, 'treg');
    assert.match(result.message, /web search/);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/catalog\/search\?q=web/);
    assert.equal(calls[0].token, 'treg_test_key');
  } finally {
    global.fetch = original;
    if (previous == null) delete process.env.TREG_TOKEN;
    else process.env.TREG_TOKEN = previous;
  }
});

test('resolveProviderId matches camelCase rapidapiWebsite', () => {
    const { resolveProviderId } = require('../services/integrationProviderTests');
    assert.equal(resolveProviderId('rapidapiWebsite'), 'rapidapiWebsite');
    assert.equal(resolveProviderId('rapidapiwebsite'), 'rapidapiWebsite');
  });

  test('resolveOpenRouterEnv prefers workspace integration key', () => {
    const { resolveOpenRouterEnv } = require('../services/llmClient');
    const prev = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = 'env-key';
    try {
      const fromWs = resolveOpenRouterEnv({ OPENROUTER_API_KEY: 'ws-key', OPENROUTER_MODEL: 'openrouter/free' });
      assert.equal(fromWs.apiKey, 'ws-key');
      assert.equal(fromWs.model, 'openrouter/free');
      const fromEnv = resolveOpenRouterEnv({});
      assert.equal(fromEnv.apiKey, 'env-key');
    } finally {
      if (prev == null) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = prev;
    }
  });
});
