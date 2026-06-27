const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeGoogleMapsPlaceKey,
  computeDedupeKey,
  findExistingLead,
  leadMapsPlaceKey,
} = require('../services/leadDedupe');

describe('leadDedupe', () => {
  const mapsUrlA =
    'https://www.google.com/maps/place/All+About+Floors+NW/data=!4m7!3m6!1s0x5495b070e7461ea5:0x2af84da70f2d6624!8m2!3d45.6714922!4d-122.5175045!16s%2Fg%2F11dzw7q_wz!19sChIJpR5G53CwlVQRJGYtD6dN-Co?authuser=0&hl=en&rclk=1';
  const mapsUrlB =
    'https://www.google.com/maps/place/All+About+Floors+NW/@45.6714922,-122.5175045,17z/data=!3m1!4b1!4m6!3m5!1s0x5495b070e7461ea5:0x2af84da70f2d6624!8m2!3d45.6714922!4d-122.5175045!16s%2Fg%2F11dzw7q_wz!19sChIJpR5G53CwlVQRJGYtD6dN-Co';

  it('normalizes Google Maps place URLs to the same key', () => {
    const a = normalizeGoogleMapsPlaceKey(mapsUrlA);
    const b = normalizeGoogleMapsPlaceKey(mapsUrlB);
    assert.ok(a);
    assert.equal(a, b);
    assert.match(a, /^gmaps:chij:/);
  });

  it('matches incoming extension save to existing CSV lead by phone and maps url', () => {
    const existing = [
      {
        key: 'lead:1',
        workspaceId: 'default',
        title: 'All About Floors NW',
        phone: '(360) 947-2876',
        url: mapsUrlA,
        address: '6700 NE 152nd Ave #140',
        city: '',
        state: '',
        source: 'chrome_extension',
      },
    ];
    const incoming = {
      workspaceId: 'default',
      title: 'All About Floors NW',
      phone: '(360) 947-2876',
      url: mapsUrlB,
      address: '6200 NE 152nd Ave #110',
      city: 'Vancouver',
      state: 'WA',
      website: 'https://www.allaboutfloorsnw.com/',
      source: 'chrome_extension',
    };
    const match = findExistingLead(existing, incoming, 'default');
    assert.ok(match);
    assert.equal(match.key, 'lead:1');
  });

  it('matches by name and phone when city/state are missing', () => {
    const existing = [
      {
        key: 'lead:2',
        workspaceId: 'default',
        title: 'Paulson\'s Floor Coverings',
        phone: '(360) 574-7399',
        city: '',
        state: '',
      },
    ];
    const incoming = {
      workspaceId: 'default',
      title: 'Paulsons Floor Coverings',
      phone: '360-574-7399',
    };
    const match = findExistingLead(existing, incoming, 'default');
    assert.ok(match);
    assert.equal(match.key, 'lead:2');
  });

  it('prefers maps place key in dedupe key', () => {
    const key = computeDedupeKey({
      title: 'Biz',
      phone: '(503) 555-0100',
      url: mapsUrlA,
    });
    assert.equal(key, leadMapsPlaceKey({ url: mapsUrlA }));
  });
});
