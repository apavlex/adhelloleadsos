const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildGoogleMapsSearchQuery,
  resolveGoogleMapsSearchHref,
} = require('../services/googleMapsSearchHref');

describe('googleMapsSearchHref', () => {
  it('includes name + street + city + state for USA leads', () => {
    const q = buildGoogleMapsSearchQuery({
      title: 'ALP TRANSPORTATION LLC',
      address: '2608 PARKBRIDGE CT',
      city: 'WYLIE',
      state: 'TX',
    });
    assert.equal(q, 'ALP TRANSPORTATION LLC 2608 PARKBRIDGE CT WYLIE TX');
  });

  it('does not drop city/state when street address is present', () => {
    const href = resolveGoogleMapsSearchHref({
      title: 'ALP TRANSPORTATION LLC',
      address: '2608 PARKBRIDGE CT',
      city: 'WYLIE',
      state: 'TX',
    });
    assert.match(href, /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
    const q = decodeURIComponent(href.split('query=')[1]);
    assert.match(q, /ALP TRANSPORTATION LLC/);
    assert.match(q, /2608 PARKBRIDGE CT/);
    assert.match(q, /WYLIE/);
    assert.match(q, /TX/);
  });

  it('avoids duplicating city/state already embedded in address', () => {
    const q = buildGoogleMapsSearchQuery({
      title: 'CK ROADLINE INC',
      address: '123 Main St, Dallas, TX 75201',
      city: 'Dallas',
      state: 'TX',
    });
    assert.equal(q, 'CK ROADLINE INC 123 Main St, Dallas, TX 75201');
  });

  it('falls back to name + city + state when street is missing', () => {
    const q = buildGoogleMapsSearchQuery({
      title: 'Global Freight Co',
      city: 'Miami',
      state: 'FL',
    });
    assert.equal(q, 'Global Freight Co Miami FL');
  });

  it('prefers a stored Google Maps listing URL', () => {
    const href = resolveGoogleMapsSearchHref({
      url: 'https://www.google.com/maps/place/?q=place_id:ChIJtest',
      title: 'ALP TRANSPORTATION LLC',
      city: 'WYLIE',
      state: 'TX',
    });
    assert.equal(href, 'https://www.google.com/maps/place/?q=place_id:ChIJtest');
  });
});
