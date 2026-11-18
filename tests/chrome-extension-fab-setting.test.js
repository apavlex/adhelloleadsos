'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const EXT_ROOT = path.join(__dirname, '..', 'chrome-extension');

function readExt(rel) {
  return fs.readFileSync(path.join(EXT_ROOT, rel), 'utf8');
}

test('showSaveLeadFab defaults on in settings and GET_SETTINGS', () => {
  const background = readExt('src/background.js');
  assert.match(background, /showSaveLeadFab:\s*true/);
  assert.match(background, /showSaveLeadFab:\s*stored\.showSaveLeadFab\s*!==\s*false/);

  const optionsJs = readExt('src/options.js');
  assert.match(optionsJs, /showSaveLeadFab:\s*true/);
  assert.match(optionsJs, /showSaveLeadFab:\s*!!form\.showSaveLeadFab\?\.checked/);
});

test('options and popup expose Show Save lead button on pages toggle', () => {
  const optionsHtml = readExt('src/options.html');
  assert.match(optionsHtml, /name="showSaveLeadFab"/);
  assert.match(optionsHtml, /Show Save lead button on pages/);

  const popupHtml = readExt('src/popup.html');
  assert.match(popupHtml, /id="showSaveLeadFab"/);
  assert.match(popupHtml, /Show Save lead button on pages/);

  const popupJs = readExt('src/popup.js');
  assert.match(popupJs, /chrome\.storage\.sync\.set\(\{\s*showSaveLeadFab:/);
  assert.match(popupJs, /EXT_VERSION = '1\.9\.14'/);
});

test('content script skips FAB when showSaveLeadFab is off and reacts to storage', () => {
  const content = readExt('src/content.js');
  assert.match(content, /showSaveLeadFab/);
  assert.match(content, /function removeFab\s*\(/);
  assert.match(content, /function syncFabVisibility\s*\(/);
  assert.match(content, /chrome\.storage\.onChanged\.addListener/);
  assert.match(content, /buildPanel\(extractLeadFromPage\(\)\)/);
  assert.doesNotMatch(content, /buildPanel\(extractLeadFromPage\(\)\);\s*\}\)\(\);/);
});

test('manifest is 1.9.14 and still injects extractors for popup save', () => {
  const manifest = JSON.parse(readExt('manifest.json'));
  assert.equal(manifest.version, '1.9.14');
  const scripts = manifest.content_scripts[0].js;
  assert.ok(scripts.includes('src/extractors.js'));
  assert.ok(scripts.includes('src/zillow-bulk-scrape.js'));
  assert.ok(scripts.includes('src/loyalty-detect.js'));
  assert.ok(scripts.includes('src/content.js'));
});

test('zillow bulk scrape opens listing tabs and extracts agent cards', () => {
  const zillowBulk = readExt('src/zillow-bulk-scrape.js');
  assert.match(zillowBulk, /zillowBulkGetListingUrls/);
  assert.match(zillowBulk, /zillowBulkScrapeListing/);
  assert.match(zillowBulk, /homedetails/);

  const listingExtractors = readExt('src/listing-extractors.js');
  assert.match(listingExtractors, /extractZillowAgentCard/);
  assert.match(listingExtractors, /attribution-LISTING_AGENT/);

  const background = readExt('src/background.js');
  assert.match(background, /runZillowBulkScrapeJob/);
  assert.match(background, /scrapeZillowListingUrl/);
  assert.match(background, /ZILLOW_BULK_CONCURRENCY/);

  const popupJs = readExt('src/popup.js');
  assert.match(popupJs, /isZillowSearchUrl/);
  assert.match(popupJs, /source:\s*bulkSource === 'zillow' \? 'zillow' : 'maps'/);
});

test('popup and FAB expose Find loyalty rewards', () => {
  const popupHtml = readExt('src/popup.html');
  assert.match(popupHtml, /id="findLoyaltyBtn"/);
  assert.match(popupHtml, /Find loyalty rewards/);

  const popupJs = readExt('src/popup.js');
  assert.match(popupJs, /FIND_LOYALTY_PROGRAM/);
  assert.match(popupJs, /loyaltyProgram/);

  const content = readExt('src/content.js');
  assert.match(content, /adhello-loyalty/);
  assert.match(content, /FIND_LOYALTY_PROGRAM/);

  const background = readExt('src/background.js');
  assert.match(background, /importScripts\('loyalty-detect\.js'\)/);
  assert.match(background, /FIND_LOYALTY_PROGRAM/);
});
