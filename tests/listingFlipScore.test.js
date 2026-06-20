const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseFlipFilter,
  resolveDealCriteria,
  classifyLandTenure,
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

test('classifyLandTenure detects own land vs park rent', () => {
  assert.equal(classifyLandTenure('fee simple with deeded land'), 'own_land');
  assert.equal(classifyLandTenure('in a mobile home park, lot rent $450'), 'park_lot_rent');
  assert.equal(classifyLandTenure('nice double wide for sale'), 'unknown');
});

test('parseFlipFilter reads land automode fields', () => {
  const f = parseFlipFilter({
    flipFilterEnabled: 'on',
    flipLandMode: 'own_land_only',
    flipRequireOwnLand: 'on',
    flipExcludePark: 'on',
    flipRequireNoHoa: 'on',
    flipRequirePhrases: 'own land, fee simple',
    flipExcludePhrases: 'lot rent, park rent',
  });
  assert.equal(f.landMode, 'own_land_only');
  assert.equal(f.requireOwnLand, true);
  assert.equal(f.excludeParkRent, true);
  assert.equal(f.requireNoHoa, true);
  assert.equal(f.requirePhrases.length, 2);
  assert.equal(f.excludePhrases.length, 2);
});

test('resolveDealCriteria merges preset land phrases', () => {
  const c = resolveDealCriteria({
    landMode: 'exclude_park',
    excludeParkRent: true,
    requireOwnLand: true,
  });
  assert.ok(c.requirePhrases.includes('own land'));
  assert.ok(c.excludePhrases.includes('lot rent'));
});

test('scoreAndFilterListings excludes park deals in own_land_only mode', async () => {
  const landDeal = sampleListing({
    url: 'https://example.com/land',
    description: 'Motivated seller — fixer, fee simple, land included.',
  });
  const parkDeal = sampleListing({
    url: 'https://example.com/park',
    title: 'Double wide in park',
    description: 'Nice home in mobile home park. Lot rent $500/mo. Must sell.',
  });

  const { listings, stats } = await scoreAndFilterListings(
    [landDeal, parkDeal],
    {
      enabled: true,
      minFlipScore: 4,
      minRoiPercent: 0,
      useAi: false,
      landMode: 'own_land_only',
      excludeParkRent: true,
    },
    { city: 'Phoenix', state: 'AZ' }
  );

  assert.ok(stats.criteriaExcluded >= 1);
  assert.ok(listings.every((r) => r.listing.flipAnalysis.landTenure !== 'park_lot_rent'));
  assert.ok(listings.some((r) => r.listing.flipAnalysis.landTenure === 'own_land'));
});

test('scoreAndFilterListings ranks land-owned above park when prefer_own_land', async () => {
  const landDeal = sampleListing({
    url: 'https://example.com/land2',
    price: 45000,
    description: 'Handyman special, own land included.',
  });
  const parkDeal = sampleListing({
    url: 'https://example.com/park2',
    price: 28000,
    description: 'Motivated fixer in park, lot rent $400.',
  });

  const { listings } = await scoreAndFilterListings(
    [parkDeal, landDeal],
    {
      enabled: true,
      minFlipScore: 0,
      minRoiPercent: 0,
      useAi: false,
      landMode: 'prefer_own_land',
      excludeParkRent: false,
    },
    { city: 'Phoenix', state: 'AZ' }
  );

  assert.ok(listings.length >= 2);
  assert.equal(listings[0].listing.flipAnalysis.landTenure, 'own_land');
});
