const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeSearchPreset,
  searchPresetToFindContext,
  parseSearchPresetFromForm,
} = require('../services/folderSearchPreset');
const { JOB_TYPES } = require('../services/scrapeJobTypes');

test('normalizeSearchPreset mobile homes with flip filter', () => {
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
  assert.equal(p.jobType, JOB_TYPES.MOBILE_HOMES);
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
  assert.equal(ctx.searchType, 'mobile_homes');
  assert.equal(ctx.searchPrefill.keyword, 'mobile home');
  assert.equal(ctx.searchPrefill.qty, 25);
});

test('parseSearchPresetFromForm reads flip toggles from body', () => {
  const p = parseSearchPresetFromForm({
    jobType: 'mobile_homes',
    query: 'trailer',
    maxResults: '30',
    flipFilterEnabled: 'on',
    minFlipScore: '7.5',
    minRoiPercent: '18',
    flipLandMode: 'exclude_park',
    flipExcludePark: 'on',
  });
  assert.equal(p.jobType, JOB_TYPES.MOBILE_HOMES);
  assert.ok(p.flipFilter && p.flipFilter.enabled);
  assert.equal(p.flipFilter.landMode, 'exclude_park');
  assert.equal(p.flipFilter.excludeParkRent, true);
});
