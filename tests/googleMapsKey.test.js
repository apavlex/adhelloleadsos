const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

describe('getGoogleMapsApiKey', () => {
  let prev;

  beforeEach(() => {
    prev = process.env.GOOGLE_MAPS_API_KEY;
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = prev;
  });

  it('trims whitespace and newlines from the env key', () => {
    process.env.GOOGLE_MAPS_API_KEY = '  AIza-test-key\n';
    delete require.cache[require.resolve('../services/googleMapsKey')];
    const { getGoogleMapsApiKey } = require('../services/googleMapsKey');
    assert.equal(getGoogleMapsApiKey(), 'AIza-test-key');
  });

  it('returns null when unset or blank', () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    delete require.cache[require.resolve('../services/googleMapsKey')];
    const { getGoogleMapsApiKey } = require('../services/googleMapsKey');
    assert.equal(getGoogleMapsApiKey(), null);
  });
});
