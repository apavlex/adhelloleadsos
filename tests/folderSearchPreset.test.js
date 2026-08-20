const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeSearchPreset,
  searchPresetToFindContext,
  parseSearchPresetFromForm,
} = require('../services/folderSearchPreset');
const { JOB_TYPES } = require('../services/scrapeJobTypes');

test('normalizeSearchPreset maps legacy mobile_homes to real_estate with flip filter', () => {
  const p = normalizeSearchPreset({
    jobType: 'mobile_homes',
    query: 'manufactured home',
    maxResults: 40,
    minPrice: 10000,
    maxPrice: 80000,
    flipFilter: {
      enabled: true,
      minFlipScore: 8,
      minRoiPercent: 20,
      landMode: 'own_land_only',
      excludeParkRent: true,
      requireOwnLand: true,
    },
  });
  assert.equal(p.jobType, JOB_TYPES.REAL_ESTATE);
  assert.equal(p.query, 'manufactured home');
  assert.equal(p.maxResults, 40);
  assert.equal(p.minPrice, 10000);
  assert.ok(p.flipFilter && p.flipFilter.enabled);
  assert.equal(p.flipFilter.landMode, 'own_land_only');
});

test('searchPresetToFindContext maps job type to find tab', () => {
  const ctx = searchPresetToFindContext({
    jobType: 'mobile_homes',
    query: 'mobile home',
    maxResults: 25,
  });
  assert.equal(ctx.searchType, 'real_estate');
  assert.equal(ctx.searchPrefill.keyword, 'mobile home');
  assert.equal(ctx.searchPrefill.qty, 25);
});

test('parseSearchPresetFromForm reads flip toggles from body', () => {
  const p = parseSearchPresetFromForm({
    jobType: 'real_estate',
    query: 'trailer',
    maxResults: '30',
    flipFilterEnabled: 'on',
    minFlipScore: '7.5',
    minRoiPercent: '18',
    flipLandMode: 'exclude_park',
    flipExcludePark: 'on',
    source_craigslist: 'on',
    source_zillow: 'on',
  });
  assert.equal(p.jobType, JOB_TYPES.REAL_ESTATE);
  assert.ok(p.flipFilter && p.flipFilter.enabled);
  assert.equal(p.flipFilter.landMode, 'exclude_park');
  assert.equal(p.flipFilter.excludeParkRent, true);
  assert.deepEqual(p.sources, ['craigslist', 'zillow']);
});

test('describeSearchPreset summarizes scrapers and prices', () => {
  const { describeSearchPreset } = require('../services/folderSearchPreset');
  const summary = describeSearchPreset({
    jobType: 'real_estate',
    query: 'manufactured home',
    maxResults: 25,
    minPrice: 15000,
    maxPrice: 60000,
    sources: ['craigslist', 'zillow'],
    flipFilter: { enabled: true, minFlipScore: 7, minRoiPercent: 15, landMode: 'prefer_own_land' },
  });
  assert.equal(summary.typeLabel, 'Real estate');
  assert.ok(summary.rows.some((r) => r.label === 'Scrapers' && r.value.includes('Craigslist')));
  assert.ok(summary.rows.some((r) => r.label === 'Price range' && r.value.includes('15,000')));
});

test('normalizeSearchPreset products defaults marketplace scrapers', () => {
  const p = normalizeSearchPreset({ jobType: 'products', query: 'iPhone', maxResults: 20 });
  assert.equal(p.jobType, JOB_TYPES.PRODUCTS);
  assert.deepEqual(p.sources, ['facebook_marketplace', 'craigslist', 'offerup', 'ebay']);
});

test('parseAutoTags splits comma-separated labels', () => {
  const { parseAutoTags } = require('../services/folderSearchPreset');
  assert.deepEqual(parseAutoTags('GBP Setup, Local SEO'), ['GBP Setup', 'Local SEO']);
});

test('filterMapsResults applies rating and review thresholds', () => {
  const { filterMapsResults } = require('../services/mapsSearch');
  const rows = [
    { title: 'A', totalScore: 4.5, reviewsCount: 20 },
    { title: 'B', totalScore: 3.5, reviewsCount: 5 },
  ];
  const out = filterMapsResults(rows, { minRating: 4, minReviews: 10 });
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'A');
});

test('resolveEffectiveSearchPreset replays trade keyword and parent location', () => {
  const { resolveEffectiveSearchPreset } = require('../services/folderSearchPreset');
  const resolved = resolveEffectiveSearchPreset(
    {
      key: 'folder:1',
      name: 'Mechanical',
      jobType: 'maps_business',
      tradeSlug: 'mechanical',
      searchPreset: { jobType: 'maps_business', keyword: 'mechanical contractor', maxResults: 25 },
    },
    {
      parent: {
        name: 'Businesses',
        isPipelineDefault: true,
        searchPreset: {
          jobType: 'maps_business',
          keyword: 'plumber',
          city: 'Portland',
          state: 'OR',
          mapsProvider: 'rapidapi',
          maxResults: 40,
        },
      },
      icp: { city: 'Austin', state: 'TX' },
    }
  );
  assert.equal(resolved.ok, true);
  assert.equal(resolved.preset.keyword, 'mechanical contractor');
  assert.equal(resolved.preset.city, 'Portland');
  assert.equal(resolved.preset.state, 'OR');
  assert.equal(resolved.preset.mapsProvider, 'rapidapi');
  assert.equal(resolved.preset.maxResults, 25);
});

test('resolveEffectiveSearchPreset infers Flooring Companies keyword and does not default plumber', () => {
  const { resolveEffectiveSearchPreset, inferKeywordForFolder } = require('../services/folderSearchPreset');
  assert.equal(inferKeywordForFolder({ name: 'Flooring Companies' }), 'flooring');
  const resolved = resolveEffectiveSearchPreset(
    { key: 'folder:2', name: 'Flooring Companies', jobType: 'maps_business' },
    { icp: { city: 'Vancouver', state: 'WA' } }
  );
  assert.equal(resolved.ok, true);
  assert.equal(resolved.preset.keyword, 'flooring');
  assert.notEqual(resolved.preset.keyword, 'plumber');
  assert.equal(resolved.preset.city, 'Vancouver');
  assert.equal(resolved.preset.state, 'WA');
});

test('resolveEffectiveSearchPreset requires setup when system folder has no keyword', () => {
  const { resolveEffectiveSearchPreset } = require('../services/folderSearchPreset');
  const resolved = resolveEffectiveSearchPreset({
    name: 'Businesses',
    isPipelineDefault: true,
    jobType: 'maps_business',
  });
  assert.equal(resolved.ok, false);
  assert.equal(resolved.needSetup, true);
});

test('searchPresetToFindContext keeps stored city and state', () => {
  const ctx = searchPresetToFindContext({
    jobType: 'maps_business',
    keyword: 'flooring contractor',
    city: 'Camas',
    state: 'WA',
    maxResults: 20,
  });
  assert.equal(ctx.searchPrefill.keyword, 'flooring contractor');
  assert.equal(ctx.searchPrefill.city, 'Camas');
  assert.equal(ctx.searchPrefill.state, 'WA');
});

test('locationFromLeads picks majority city/state for folder refresh', () => {
  const { locationFromLeads } = require('../services/folderSearchRun');
  const loc = locationFromLeads([
    { city: 'Portland', state: 'OR' },
    { city: 'Portland', state: 'OR' },
    { city: 'Seattle', state: 'WA' },
  ]);
  assert.equal(loc.city, 'Portland');
  assert.equal(loc.state, 'OR');
});
