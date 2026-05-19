const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const geo = require('../services/geocodeLocation');

describe('geocodeLocation buildLocationLabel', () => {
  test('uses Canada for BC', () => {
    assert.equal(geo.buildLocationLabel('Vancouver', 'BC'), 'Vancouver, BC, Canada');
  });

  test('uses USA for TX', () => {
    assert.equal(geo.buildLocationLabel('Austin', 'TX'), 'Austin, TX, USA');
  });
});

describe('geocodeLocation buildMapsSearchQuery', () => {
  test('includes correct country in search text', () => {
    assert.equal(
      geo.buildMapsSearchQuery('Coffee Shop', 'Vancouver', 'BC'),
      'Coffee Shop in Vancouver, BC, Canada'
    );
  });
});
