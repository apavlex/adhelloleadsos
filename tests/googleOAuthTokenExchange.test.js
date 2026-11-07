/**
 * Guards the Google OAuth token-exchange patch: must use timed fetch against
 * oauth2.googleapis.com so Render sign-in cannot hang forever on the legacy
 * `oauth` HTTP client.
 */
const { test, mock } = require('node:test');
const assert = require('node:assert/strict');

test('Google strategies patch token exchange onto oauth2.googleapis.com', async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.BASE_URL = 'https://leads.adhello.io';
  process.env.GOOGLE_OAUTH_TOKEN_TIMEOUT_MS = '250';

  // Fresh require so strategies register with our env.
  delete require.cache[require.resolve('../services/auth')];
  const { passport } = require('../services/auth');

  const strategy = passport._strategy('google');
  assert.ok(strategy, 'google strategy registered');
  assert.ok(strategy._oauth2, 'oauth2 client present');
  assert.equal(strategy._oauth2.__adhelloFetchToken, true);
  assert.match(String(strategy._oauth2._accessTokenUrl || ''), /oauth2\.googleapis\.com\/token/);

  const originalFetch = global.fetch;
  let sawUrl = '';
  let sawMethod = '';
  global.fetch = mock.fn(async (url, init) => {
    sawUrl = String(url);
    sawMethod = init && init.method;
    return {
      ok: false,
      status: 400,
      async text() {
        return JSON.stringify({ error: 'invalid_grant', error_description: 'Bad code' });
      },
    };
  });

  try {
    const err = await new Promise((resolve) => {
      strategy._oauth2.getOAuthAccessToken('fake-code', { grant_type: 'authorization_code' }, (e) =>
        resolve(e || null)
      );
    });
    assert.ok(err, 'invalid grant should fail');
    assert.equal(sawMethod, 'POST');
    assert.equal(sawUrl, 'https://oauth2.googleapis.com/token');
    assert.match(String(err.message), /Bad code|invalid_grant/i);
  } finally {
    global.fetch = originalFetch;
  }
});

test('Google token exchange aborts on timeout', async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.BASE_URL = 'https://leads.adhello.io';
  process.env.GOOGLE_OAUTH_TOKEN_TIMEOUT_MS = '50';

  delete require.cache[require.resolve('../services/auth')];
  const { passport } = require('../services/auth');
  const strategy = passport._strategy('google');

  const originalFetch = global.fetch;
  global.fetch = mock.fn(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        const signal = init && init.signal;
        if (!signal) return;
        signal.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      })
  );

  try {
    const started = Date.now();
    const err = await new Promise((resolve) => {
      strategy._oauth2.getOAuthAccessToken('fake-code', { grant_type: 'authorization_code' }, (e) =>
        resolve(e || null)
      );
    });
    const elapsed = Date.now() - started;
    assert.ok(err, 'timeout should fail');
    assert.equal(err.code, 'OAUTH_TOKEN_TIMEOUT');
    assert.ok(elapsed < 2000, `should fail quickly, took ${elapsed}ms`);
  } finally {
    global.fetch = originalFetch;
  }
});
