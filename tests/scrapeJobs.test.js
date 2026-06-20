const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSchedulePayload } = require('../services/scheduleHelpers');
const { normalizeListingRow, mergeListingResults } = require('../services/listingSearch/normalize');
const { parseSourcesList } = require('../services/listingSearch');
const { scheduleDisplayTitle, JOB_TYPES } = require('../services/scrapeJobTypes');

test('parseSchedulePayload accepts recurring daily schedule', () => {
  const result = parseSchedulePayload({
    scheduleKind: 'recurring',
    frequency: 'daily',
    scheduledTime: '02:30',
    timezone: 'America/Phoenix',
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.scheduleKind, 'recurring');
  assert.equal(result.data.frequency, 'daily');
  assert.equal(result.data.scheduledTime, '02:30');
  assert.equal(result.data.scheduledRunAt, undefined);
});

test('normalizeListingRow tags source and dedupes by url', () => {
  const row = normalizeListingRow({
    source: 'craigslist',
    sourceId: 'abc',
    title: '1998 double wide',
    price: 45000,
    url: 'https://phoenix.craigslist.org/test',
    city: 'Phoenix',
    state: 'AZ',
  });
  assert.equal(row.sourceType, 'mobile_home_listing');
  assert.equal(row.listing.source, 'craigslist');
  const merged = mergeListingResults([row], [row], 10);
  assert.equal(merged.length, 1);
});

test('parseSourcesList defaults to all sources', () => {
  const ids = parseSourcesList(null);
  assert.ok(ids.includes('craigslist'));
  assert.ok(ids.includes('facebook_marketplace'));
  assert.ok(ids.includes('zillow'));
});

test('parseSourcesList includes new sources', () => {
  const ids = parseSourcesList(['offerup', 'mhvillage', 'web_search']);
  assert.ok(ids.includes('offerup'));
  assert.ok(ids.includes('mhvillage'));
  assert.ok(ids.includes('web_search'));
});

test('webSearch isConfigured with SerpAPI key', () => {
  const web = require('../services/listingSearch/sources/webSearch');
  assert.equal(web.isConfigured({ SERPAPI_API_KEY: 'test' }), true);
  assert.equal(web.isConfigured({}), false);
});

test('scheduleDisplayTitle for mobile homes job', () => {
  const title = scheduleDisplayTitle({
    jobType: JOB_TYPES.MOBILE_HOMES,
    city: 'Tucson',
    state: 'AZ',
    query: 'manufactured home',
  });
  assert.match(title, /manufactured home/i);
  assert.match(title, /Tucson/i);
});
