const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseFlipFilter,
  scoreListingRules,
  scoreAndFilterListings,
  buildSourceCountMap,
} = require('../services/listingFlipScore');
const { normalizeListingRow } = require('../services/listingSearch/normalize');

function sampleListing(overrides = {}) {
  return normalizeListingRow({
    source: 'craigslist',
    sourceId: 'x1',
    title: '1998 double wide fixer',
    price: 32000,
    url: 'https://example.com/a',
    city: 'Phoenix',
    state: 'AZ',
    description: 'Motivated seller — as-is handyman special, land included. Must sell.',
    beds: 3,
    baths: 2,
    sqft: 1200,
    ...overrides,
  });
}

test('parseFlipFilter reads form checkbox fields', () => {
  const f = parseFlipFilter({
    flipFilterEnabled: 'on',
    minFlipScore: '8',
    minRoiPercent: '20',
    flipOnlyUnique: 'on',
  });
  assert.equal(f.enabled, true);
  assert.equal(f.minFlipScore, 8);
  assert.equal(f.minRoiPercent, 20);
  assert.equal(f.onlyUnique, true);
});

test('parseFlipFilter defaults when disabled', () => {
  const f = parseFlipFilter({});
  assert.equal(f.enabled, false);
  assert.equal(f.minFlipScore, 7);
});

test('scoreListingRules boosts motivated fixer listings', () => {
  const row = sampleListing();
  const { sourceCountByKey } = buildSourceCountMap([row]);
  const rules = scoreListingRules(row, {
    sourceCountByKey,
    medianPricePerSqft: 50,
  });
  assert.ok(rules.ruleScore >= 4);
  assert.ok(rules.reasons.some((r) => /motivated|flip|land/i.test(r)));
  assert.equal(rules.passesPreFilter, true);
});

test('scoreAndFilterListings filters by min flip score without AI', async () => {
  const strong = sampleListing({ url: 'https://example.com/strong', price: 28000 });
  const weak = sampleListing({
    url: 'https://example.com/weak',
    title: 'Nice home',
    price: 95000,
    description: 'Beautiful turnkey home, recently updated, no negotiations.',
  });

  const { listings, stats } = await scoreAndFilterListings(
    [strong, weak],
    { enabled: true, minFlipScore: 5, minRoiPercent: 0, useAi: false, onlyUnique: false },
    { city: 'Phoenix', state: 'AZ' }
  );

  assert.equal(stats.enabled, true);
  assert.equal(stats.inputCount, 2);
  assert.ok(listings.length >= 1);
  assert.ok(listings.every((r) => (r.flipScore || 0) >= 5));
  assert.ok(listings[0].listing.flipAnalysis);
});

test('scoreAndFilterListings passthrough when disabled', async () => {
  const row = sampleListing();
  const { listings, stats } = await scoreAndFilterListings([row], { enabled: false });
  assert.equal(stats.enabled, false);
  assert.equal(listings.length, 1);
  assert.equal(listings[0].listing.flipAnalysis, undefined);
});
