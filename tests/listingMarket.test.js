const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const listingMarket = require('../services/listingMarket');
const fs = require('fs');
const path = require('path');

describe('listingMarket', () => {
  it('defaults to both (active + recently sold)', () => {
    assert.equal(listingMarket.normalizeListingMarket(''), 'both');
    assert.equal(listingMarket.normalizeListingMarket(null), 'both');
    assert.equal(listingMarket.listingMarketLabel('both'), 'Active + recently sold');
  });

  it('normalizes active and sold aliases', () => {
    assert.equal(listingMarket.normalizeListingMarket('for_sale'), 'active');
    assert.equal(listingMarket.normalizeListingMarket('recently_sold'), 'sold');
    assert.equal(listingMarket.marketsFor('both').map((m) => m.id).join(','), 'active,sold');
    assert.equal(listingMarket.marketsFor('sold').length, 1);
  });

  it('builds Zillow for-sale and sold search URLs', () => {
    const both = listingMarket.zillowSearchUrls('Camas', 'WA', 'both');
    assert.equal(both.length, 2);
    assert.equal(both[0].url, 'https://www.zillow.com/camas-wa/');
    assert.equal(both[1].url, 'https://www.zillow.com/camas-wa/sold/');
    const sold = listingMarket.zillowSearchUrls('Phoenix', 'AZ', 'sold');
    assert.deepEqual(sold, [{ url: 'https://www.zillow.com/phoenix-az/sold/', market: 'sold' }]);
  });

  it('treats generic sale/sold queries as passthrough', () => {
    assert.equal(listingMarket.isGenericListingQuery('homes for sale'), true);
    assert.equal(listingMarket.isGenericListingQuery('recently sold homes'), true);
    assert.equal(listingMarket.isGenericListingQuery('homes for sale and recently sold'), true);
    assert.equal(listingMarket.isGenericListingQuery('mobile home'), false);
  });

  it('classifies sold vs active status codes', () => {
    assert.equal(listingMarket.classifyListingStatus({ statusType: 'RECENTLY_SOLD' }), 'sold');
    assert.equal(listingMarket.classifyListingStatus({ marketingStatusSimplifiedCd: 'for_sale' }), 'active');
  });

  it('Find Real Estate UI exposes listing market control', () => {
    const panel = fs.readFileSync(path.join(__dirname, '../views/partials/find_panel_real_estate.ejs'), 'utf8');
    assert.match(panel, /name="listingMarket"/);
    assert.match(panel, /Active for sale \+ recently sold/);
    assert.match(panel, /Recently sold only/);
    const zillow = fs.readFileSync(path.join(__dirname, '../services/listingSearch/sources/zillow.js'), 'utf8');
    assert.match(zillow, /zillowSearchUrls/);
    assert.match(zillow, /listingMarket/);
  });
});
