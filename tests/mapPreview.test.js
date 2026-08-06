const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseLatLngPair,
  normalizeAddressSeparators,
  buildMapQueryFromLead,
  parseGeoapifyGeocodeResult,
  buildOsmStaticMapUrl,
  buildGoogleStaticMapUrl,
  buildGeoapifyStaticMapUrl,
  buildGeocodeQueryVariants,
  isGoogleStaticMapErrorImage,
} = require('../services/mapPreview');

describe('mapPreview helpers', () => {
  it('parseLatLngPair accepts decimal coordinates', () => {
    assert.deepEqual(parseLatLngPair('45.5152, -122.6784'), {
      lat: 45.5152,
      lng: -122.6784,
    });
  });

  it('buildOsmStaticMapUrl includes center and marker', () => {
    const url = buildOsmStaticMapUrl(45.5152, -122.6784, 640, 300);
    assert.match(url, /staticmap\.openstreetmap\.de/);
    assert.match(url, /45\.5152/);
    assert.match(url, /-122\.6784/);
  });

  it('buildGoogleStaticMapUrl requires key and coordinates', () => {
    assert.equal(buildGoogleStaticMapUrl(45.5, -122.6, '', 640, 300), '');
    const url = buildGoogleStaticMapUrl(45.5, -122.6, 'test-key', 640, 300);
    assert.match(url, /maps\.googleapis\.com\/maps\/api\/staticmap/);
    assert.match(url, /test-key/);
  });

  it('buildGeoapifyStaticMapUrl includes center, marker, and key', () => {
    assert.equal(buildGeoapifyStaticMapUrl(45.5, -122.6, '', 560, 336), '');
    const url = buildGeoapifyStaticMapUrl(45.5152, -122.6784, 'geo-key', 560, 336);
    assert.match(url, /maps\.geoapify\.com\/v1\/staticmap/);
    assert.match(url, /geo-key/);
    assert.match(url, /-122\.6784/);
    assert.match(url, /45\.5152/);
    assert.match(url, /EAB308/);
  });

  it('normalizeAddressSeparators converts middle dots to commas', () => {
    assert.equal(
      normalizeAddressSeparators('17513 NE 25th St · Vancouver, WA'),
      '17513 NE 25th St, Vancouver, WA',
    );
  });

  it('buildMapQueryFromLead joins street with city and state', () => {
    assert.equal(
      buildMapQueryFromLead({
        address: '17513 NE 25th St',
        city: 'Vancouver',
        state: 'WA',
      }),
      '17513 NE 25th St, Vancouver, WA',
    );
  });

  it('parseGeoapifyGeocodeResult reads json and geojson payloads', () => {
    assert.deepEqual(parseGeoapifyGeocodeResult({ results: [{ lat: 45.64, lon: -122.49 }] }), {
      lat: 45.64,
      lng: -122.49,
    });
    assert.deepEqual(
      parseGeoapifyGeocodeResult({ features: [{ geometry: { coordinates: [-122.49, 45.64] } }] }),
      { lat: 45.64, lng: -122.49 },
    );
  });

  it('buildGeocodeQueryVariants handles dot-separated addresses', () => {
    const variants = buildGeocodeQueryVariants('17513 NE 25th St · Vancouver, WA');
    assert.ok(variants.includes('17513 NE 25th St, Vancouver, WA'));
  });

  it('buildGeocodeQueryVariants handles mall-style addresses', () => {
    const variants = buildGeocodeQueryVariants('900 Lloyd Center, Portland, OR 97232, USA');
    assert.ok(variants.includes('900 Lloyd Center, Portland, OR 97232, USA'));
    assert.ok(variants.some((v) => /Lloyd Center, Portland/i.test(v)));
    assert.ok(variants.some((v) => /Portland, OR 97232/i.test(v)));
  });

  it('buildGeocodeQueryVariants strips suite numbers for geocoding', () => {
    const variants = buildGeocodeQueryVariants('8644 SW Canyon Rd #1590, Portland, OR 97225, USA');
    assert.ok(variants.some((v) => /8644 SW Canyon Rd, Portland, OR 97225/i.test(v)));
    assert.ok(variants.some((v) => /Portland, OR 97225/i.test(v)));
    assert.ok(!variants.some((v) => /#1590/.test(v) && v.includes('8644 SW Canyon Rd, Portland')));
  });

  it('isGoogleStaticMapErrorImage detects Google error PNG payloads', () => {
    const errBuf = Buffer.from('PNG fake Google Maps Platform rejected your request');
    assert.equal(isGoogleStaticMapErrorImage(errBuf), true);
    assert.equal(isGoogleStaticMapErrorImage(Buffer.from('valid-image-bytes'.repeat(20))), false);
  });
});
