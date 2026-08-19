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
  assert.match(popupJs, /EXT_VERSION = '1\.8\.5'/);
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

test('manifest is 1.8.5 and still injects extractors for popup save', () => {
  const manifest = JSON.parse(readExt('manifest.json'));
  assert.equal(manifest.version, '1.8.5');
  const scripts = manifest.content_scripts[0].js;
  assert.ok(scripts.includes('src/extractors.js'));
  assert.ok(scripts.includes('src/loyalty-detect.js'));
  assert.ok(scripts.includes('src/content.js'));
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
