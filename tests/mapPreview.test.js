const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseLatLngPair,
  buildOsmStaticMapUrl,
  buildGoogleStaticMapUrl,
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
});
