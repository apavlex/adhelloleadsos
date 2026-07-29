const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const monidMapsSearch = require('../services/monidMapsSearch');

describe('monidMapsSearch', () => {
  it('isConfigured reflects Monid API key', () => {
    assert.equal(monidMapsSearch.isConfigured({ MONID_API_KEY: 'monid_live_test' }), true);
    assert.equal(monidMapsSearch.isConfigured({}), false);
  });

  it('extractOutputRows accepts array or wrapped payloads', () => {
    assert.deepEqual(monidMapsSearch.extractOutputRows([{ title: 'A' }]), [{ title: 'A' }]);
    assert.deepEqual(monidMapsSearch.extractOutputRows({ results: [{ title: 'B' }] }), [{ title: 'B' }]);
    assert.deepEqual(monidMapsSearch.extractOutputRows({}), []);
  });

  it('normalizeItem maps damilo scraper fields to lead shape', () => {
    const row = monidMapsSearch.normalizeItem(
      {
        title: 'Sarkinen Plumbing',
        address: '9502 NE 72nd Ave, Vancouver, WA 98665',
        rating: 4.7,
        ratingCount: 2508,
        type: 'Plumber',
        website: 'https://example.com',
        phoneNumber: '(360) 229-7743',
        placeId: 'ChIJXdYVRyaulVQRJmLhEAXKqnU',
      },
      'Vancouver',
      'WA',
    );
    assert.equal(row.title, 'Sarkinen Plumbing');
    assert.equal(row.phone, '(360) 229-7743');
    assert.equal(row.website, 'https://example.com');
    assert.equal(row.totalScore, 4.7);
    assert.equal(row.reviewsCount, 2508);
    assert.equal(row.categoryName, 'Plumber');
    assert.equal(row.city, 'Vancouver');
    assert.equal(row.state, 'WA');
    assert.ok(row.url.includes('place_id'));
    assert.equal(row.placeId, 'ChIJXdYVRyaulVQRJmLhEAXKqnU');
  });

  it('normalizeItem returns null without title', () => {
    assert.equal(monidMapsSearch.normalizeItem({ phone: '555' }), null);
  });
});
