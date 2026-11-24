const fs = require('fs');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const filter = require('../public/js/directory-list-filter');

const vancouverWa = {
  id: '1',
  name: 'IECO STAR C G CONSTRUCTION LLC',
  category: 'Remodelers',
  city: 'Vancouver',
  state: 'WA',
  address: '100 Main St, Vancouver, WA 98661',
  phone: '(360) 555-0100',
  published: true,
};

const vancouverBc = {
  id: '2',
  name: 'Harbour Tile',
  category: 'Flooring',
  city: 'Vancouver',
  state: 'BC',
  address: '10 Water St, Vancouver, BC V6B 1A1',
  published: true,
};

const portland = {
  id: '3',
  name: 'Rose City Heat',
  category: 'HVAC',
  city: 'Portland',
  state: 'Oregon',
  address: '12345 SE 10th Ave, Portland, OR 97214',
  postalCode: '97214',
  published: false,
};

describe('directory listing filter', () => {
  it('reads a zip that follows the state, not the street number', () => {
    assert.equal(filter.postalCodeOf(vancouverWa), '98661');
    assert.equal(filter.postalCodeOf(portland), '97214');
    assert.equal(
      filter.postalCodeOf({
        address: '12345 SE 10th Ave, Portland, OR 97214',
        state: 'OR',
      }),
      '97214',
    );
  });

  it('reads a Canadian postal code', () => {
    assert.equal(filter.postalCodeOf(vancouverBc), 'V6B1A1');
    assert.equal(filter.normalizePostal('v6b 1a1'), 'V6B1A1');
  });

  it('treats Vancouver, WA as that city and state', () => {
    const parsed = filter.parseSearchQuery('Vancouver, WA');
    assert.equal(parsed.city, 'Vancouver');
    assert.equal(parsed.state, 'wa');
    assert.deepEqual(
      filter.filterListings([vancouverWa, vancouverBc, portland], { q: 'Vancouver, WA' }).map((r) => r.id),
      ['1'],
    );
    assert.deepEqual(
      filter.filterListings([vancouverWa, vancouverBc], { q: 'Vancouver WA' }).map((r) => r.id),
      ['1'],
    );
    assert.deepEqual(
      filter.filterListings([vancouverWa, vancouverBc], { q: 'Vancouver, British Columbia' }).map((r) => r.id),
      ['2'],
    );
  });

  it('treats a state name or abbreviation on its own as a state filter', () => {
    assert.deepEqual(
      filter.filterListings([vancouverWa, vancouverBc, portland], { q: 'WA' }).map((r) => r.id),
      ['1'],
    );
    assert.deepEqual(
      filter.filterListings([vancouverWa, portland], { q: 'Washington' }).map((r) => r.id),
      ['1'],
    );
    assert.deepEqual(
      filter.filterListings([vancouverWa, portland], { q: 'Oregon' }).map((r) => r.id),
      ['3'],
    );
  });

  it('matches Washington and WA as the same state', () => {
    assert.equal(filter.canonicalState('Washington'), 'wa');
    assert.equal(filter.canonicalState('WA'), 'wa');
    assert.equal(filter.matchesListing(portland, { state: 'OR' }), true);
    assert.equal(filter.matchesListing(portland, { city: 'Portland', state: 'Washington' }), false);
  });

  it('filters by zip and a zip prefix', () => {
    assert.deepEqual(
      filter.filterListings([vancouverWa, portland], { q: '98661' }).map((r) => r.id),
      ['1'],
    );
    assert.deepEqual(
      filter.filterListings([vancouverWa, portland], { zip: '972' }).map((r) => r.id),
      ['3'],
    );
    assert.deepEqual(
      filter.filterListings([vancouverBc], { q: 'V6B 1A1' }).map((r) => r.id),
      ['2'],
    );
  });

  it('searches the business name and can limit to drafts', () => {
    assert.deepEqual(
      filter.filterListings([vancouverWa, portland], { q: 'rose heat' }).map((r) => r.id),
      ['3'],
    );
    assert.deepEqual(
      filter.filterListings([vancouverWa, portland], { status: 'draft' }).map((r) => r.id),
      ['3'],
    );
    assert.deepEqual(
      filter.filterListings([vancouverWa, portland], { q: 'remodelers', status: 'published' }).map((r) => r.id),
      ['1'],
    );
  });

  it('directory page wires the search controls to the filter', () => {
    const view = fs.readFileSync(path.join(__dirname, '../views/directory.ejs'), 'utf8');
    assert.match(view, /id="dirFilterQuery"/);
    assert.match(view, /directory-list-filter\.js/);
    assert.match(view, /function applyListingFilter/);
    assert.match(view, /Vancouver, WA/);
    assert.match(view, /listingBoxes\(true\)/);
  });

  it('combines a city field with a zip field', () => {
    assert.equal(filter.matchesListing(vancouverWa, { city: 'Vancouver', state: 'WA', zip: '98661' }), true);
    assert.equal(filter.matchesListing(vancouverBc, { city: 'Vancouver', state: 'WA' }), false);
  });
});
