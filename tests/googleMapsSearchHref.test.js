const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildGoogleMapsSearchQuery,
  resolveGoogleMapsSearchHref,
} = require('../services/googleMapsSearchHref');

describe('googleMapsSearchHref', () => {
  it('searches name first then zipcode (not street address)', () => {
    const q = buildGoogleMapsSearchQuery({
      title: 'JK TRANS',
      address: '304 DOMINION DR',
      city: 'WYLIE',
      state: 'TX',
      zip: '75098',
    });
    assert.equal(q, 'JK TRANS 75098');
  });

  it('extracts zip from address when zip field is missing', () => {
    const q = buildGoogleMapsSearchQuery({
      title: 'ALP TRANSPORTATION LLC',
      address: '2608 PARKBRIDGE CT, WYLIE, TX 75098',
      city: 'WYLIE',
      state: 'TX',
    });
    assert.equal(q, 'ALP TRANSPORTATION LLC 75098');
  });

  it('falls back to name + city + state when zip is unknown', () => {
    const q = buildGoogleMapsSearchQuery({
      title: 'Global Freight Co',
      address: '100 Main St',
      city: 'Miami',
      state: 'FL',
    });
    assert.equal(q, 'Global Freight Co Miami FL');
  });

  it('never puts street before the business name', () => {
    const href = resolveGoogleMapsSearchHref({
      title: 'JK TRANS',
      address: '304 DOMINION DR',
      city: 'WYLIE',
      state: 'TX',
      zip: '75098',
    });
    const q = decodeURIComponent(href.split('query=')[1]);
    assert.equal(q, 'JK TRANS 75098');
    assert.doesNotMatch(q, /304 DOMINION/);
  });

  it('prefers a stored Google Maps listing URL', () => {
    const href = resolveGoogleMapsSearchHref({
      url: 'https://www.google.com/maps/place/?q=place_id:ChIJtest',
      title: 'ALP TRANSPORTATION LLC',
      city: 'WYLIE',
      state: 'TX',
      zip: '75098',
    });
    assert.equal(href, 'https://www.google.com/maps/place/?q=place_id:ChIJtest');
  });
});
