const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const rapidapiWebsiteEnrich = require('../services/rapidapiWebsiteEnrich');

describe('rapidapiWebsiteEnrich', () => {
  test('isConfigured requires key, endpoint, and host', () => {
    assert.equal(rapidapiWebsiteEnrich.isConfigured({}), false);
    assert.equal(
      rapidapiWebsiteEnrich.isConfigured({
        RAPIDAPI_WEBSITE_KEY: 'k',
        RAPIDAPI_WEBSITE_ENDPOINT: 'https://example.p.rapidapi.com/scrape',
      }),
      true,
    );
    assert.equal(
      rapidapiWebsiteEnrich.isConfigured({
        RAPIDAPI_KEY: 'shared',
        RAPIDAPI_WEBSITE_ENDPOINT: 'https://example.p.rapidapi.com/scrape',
      }),
      true,
    );
  });

  test('parsePayloadToExtract finds nested emails phones and socials', () => {
    const extract = rapidapiWebsiteEnrich.parsePayloadToExtract({
      data: {
        emails: ['owner@acme.com', 'sales@acme.com'],
        phones: ['(555) 123-4567'],
        socials: {
          facebook: 'https://facebook.com/acme',
          instagram: 'https://instagram.com/acme',
        },
      },
    });
    assert.equal(extract.email, 'owner@acme.com');
    assert.equal(extract.phone, '(555) 123-4567');
    assert.match(extract.facebook, /facebook\.com/i);
    assert.match(extract.instagram, /instagram\.com/i);
  });

  test('enrichLeadFromWebsite merges only missing fields', async () => {
    const env = {
      RAPIDAPI_WEBSITE_KEY: 'test',
      RAPIDAPI_WEBSITE_ENDPOINT: 'https://example.p.rapidapi.com/scrape',
      RAPIDAPI_WEBSITE_HOST: 'example.p.rapidapi.com',
    };
    const origFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      text: async () =>
        JSON.stringify({
          email: 'new@co.com',
          phone: '5559876543',
          facebook: 'https://facebook.com/co',
        }),
    });
    try {
      const pack = await rapidapiWebsiteEnrich.enrichLeadFromWebsite(
        { website: 'https://acme.com', email: 'keep@acme.com' },
        env,
      );
      assert.equal(pack.patch.email, undefined);
      assert.equal(pack.patch.phone, '5559876543');
      assert.ok(pack.filled.includes('phone'));
    } finally {
      global.fetch = origFetch;
    }
  });

  test('refresh mode overwrites existing instagram when scrape returns new value', async () => {
    const env = {
      RAPIDAPI_WEBSITE_KEY: 'test',
      RAPIDAPI_WEBSITE_ENDPOINT: 'https://example.p.rapidapi.com/scrape',
      RAPIDAPI_WEBSITE_HOST: 'example.p.rapidapi.com',
    };
    const origFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      text: async () =>
        JSON.stringify({
          instagram: 'https://instagram.com/allaboutfloorsnw',
        }),
    });
    try {
      const pack = await rapidapiWebsiteEnrich.enrichLeadFromWebsite(
        {
          website: 'https://allaboutfloorsnw.com',
          instagram: 'https://instagram.com/wilsonsonsinicareers',
        },
        env,
        { mode: 'refresh' },
      );
      assert.equal(pack.patch.instagram, 'https://instagram.com/allaboutfloorsnw');
      assert.ok(pack.filled.includes('instagram'));
    } finally {
      global.fetch = origFetch;
    }
  });

  test('endpointWithoutLeadQueryParams strips query param', () => {
    const cleaned = rapidapiWebsiteEnrich.endpointWithoutLeadQueryParams(
      'https://example.p.rapidapi.com/scrape?query=wsgr.com&foo=bar',
    );
    assert.equal(cleaned, 'https://example.p.rapidapi.com/scrape?foo=bar');
  });
});
