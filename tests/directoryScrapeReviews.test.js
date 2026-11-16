const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');

test('Directory scrape-reviews endpoint reuses reviewHunt and refreshes listings', () => {
  const route = fs.readFileSync(path.join(root, 'routes/directory.js'), 'utf8');
  const view = fs.readFileSync(path.join(root, 'views/directory.ejs'), 'utf8');
  assert.match(route, /listings\/scrape-reviews/);
  assert.match(route, /Registered before \/listings\/:id/);
  assert.match(route, /SCRAPE_REVIEWS_MAX/);
  assert.match(route, /runDirectoryScrapeJob/);
  assert.match(route, /runReviewHuntForLead/);
  assert.match(route, /status\(202\)/);
  assert.match(route, /scrape-reviews\/:jobId\.json/);
  assert.match(route, /_scrapeBusyByWs/);
  // Batch apply in-memory then one directoryStore.save — never N× upsertFromLead/saveWorkspace.
  assert.match(route, /applyLeadToBundle/);
  assert.match(route, /listingsDirty/);
  assert.match(route, /directoryStore\.save/);
  assert.doesNotMatch(
    route.slice(route.indexOf('async function runDirectoryScrapeJob'), route.indexOf('function baseUrlFromReq')),
    /upsertFromLead/,
  );
  assert.match(route, /updateLead/);
  assert.match(route, /outscraper\.isConfigured/);
  // Must be declared before /listings/:id so Express does not treat scrape-reviews as an id.
  const scrapeAt = route.indexOf("router.post('/listings/scrape-reviews'");
  const editAt = route.indexOf("router.post('/listings/:id'");
  assert.ok(scrapeAt > 0 && editAt > scrapeAt);
  assert.match(view, /dirPullReviewsBtn/);
  assert.match(view, /scrapeReviews/);
  assert.match(view, /js-dir-scrape/);
  assert.match(view, /dir-select/);
  assert.match(view, /\/directory\/listings\/scrape-reviews/);
  assert.match(view, /jobId/);
  assert.match(view, /Scraping Google reviews/);
  assert.match(view, /Launching review scrape/);
  assert.match(view, /js-dir-scrape-status/);
  assert.match(view, /setRowScrapeUi/);
  assert.match(view, /applyJobRowProgress/);
  assert.match(route, /listingIds:/);
  assert.match(route, /clearStaleScrapeBusy/);
  assert.match(route, /SCRAPE_JOB_MAX_MS/);
  assert.match(route, /currentListingId/);
  assert.match(route, /skipAiSummary:\s*true/);
  assert.match(route, /deferredLeadPatches/);
  assert.match(route, /deferred lead update failed/);
  // Lead KV writes must be deferred after job done — not inside the Outscraper for-loop.
  const jobFn = route.slice(
    route.indexOf('async function runDirectoryScrapeJob'),
    route.indexOf('function baseUrlFromReq'),
  );
  const loopSlice = jobFn.slice(0, jobFn.indexOf('deferredLeadPatches.slice'));
  assert.doesNotMatch(loopSlice, /await dbService\.updateLead/);
  assert.match(jobFn, /await dbService\.updateLead/);
  assert.match(view, /202 Accepted/);
  // Dashboard rows show contact + review score/summary via hydrate renderRow.
  assert.match(view, /function renderRow/);
  assert.match(view, /webParts/);
  assert.match(view, /ratingLabel/);
  assert.match(view, /row\.address/);
  assert.match(view, /row\.phone/);
  assert.match(view, /row\.website/);
  assert.match(view, /reviewSummary/);
  assert.match(view, /No review score yet/);
  assert.match(view, /No review summary yet/);
  assert.match(view, /Contact \+ reviews rows are painted by hydrate/);
  assert.match(route, /slimListingForInbox/);
});
