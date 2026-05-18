const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const rapidapi = require('../services/rapidapiLocalBusiness');

describe('rapidapiLocalBusiness hostFromEndpointUrl', () => {
  test('extracts hostname from full search URL', () => {
    assert.equal(
      rapidapi.hostFromEndpointUrl('https://maps-data.p.rapidapi.com/search.php'),
      'maps-data.p.rapidapi.com'
    );
  });

  test('returns empty for invalid URL', () => {
    assert.equal(rapidapi.hostFromEndpointUrl('not-a-url'), '');
  });
});

describe('rapidapiLocalBusiness apiHost', () => {
  test('derives host from endpoint when RAPIDAPI_HOST unset', () => {
    const prevHost = process.env.RAPIDAPI_HOST;
    const prevEndpoint = process.env.RAPIDAPI_LOCAL_BUSINESS_ENDPOINT;
    delete process.env.RAPIDAPI_HOST;
    process.env.RAPIDAPI_LOCAL_BUSINESS_ENDPOINT =
      'https://maps-data.p.rapidapi.com/search.php';
    try {
      assert.equal(rapidapi.apiHost(null), 'maps-data.p.rapidapi.com');
    } finally {
      if (prevHost === undefined) delete process.env.RAPIDAPI_HOST;
      else process.env.RAPIDAPI_HOST = prevHost;
      if (prevEndpoint === undefined) delete process.env.RAPIDAPI_LOCAL_BUSINESS_ENDPOINT;
      else process.env.RAPIDAPI_LOCAL_BUSINESS_ENDPOINT = prevEndpoint;
    }
  });
});
