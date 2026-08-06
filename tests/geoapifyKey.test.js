const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { getGeoapifyApiKey } = require('../services/geoapifyKey');

describe('geoapifyKey', () => {
  let prev;

  beforeEach(() => {
    prev = process.env.GEOAPIFY_API_KEY;
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.GEOAPIFY_API_KEY;
    else process.env.GEOAPIFY_API_KEY = prev;
  });

  it('returns trimmed key from env', () => {
    process.env.GEOAPIFY_API_KEY = '  abc123\n';
    assert.equal(getGeoapifyApiKey(), 'abc123');
  });

  it('returns null when unset', () => {
    delete process.env.GEOAPIFY_API_KEY;
    assert.equal(getGeoapifyApiKey(), null);
  });
});
