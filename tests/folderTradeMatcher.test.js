const test = require('node:test');
const assert = require('node:assert/strict');
const { matchFolderToTrade, normalizeFolderName } = require('../services/folderTradeMatcher');

test('normalizeFolderName strips location tokens', () => {
  assert.equal(normalizeFolderName('Electricians PDX'), 'electricians');
  assert.equal(normalizeFolderName('Portland Plumbers'), 'plumbers');
});

test('matchFolderToTrade maps regional trade folders', () => {
  assert.equal(matchFolderToTrade('Electricians PDX').slug, 'electrical');
  assert.equal(matchFolderToTrade('Landscaper').slug, 'landscaping');
  assert.equal(matchFolderToTrade('Commercial Fridge').slug, 'refrigeration');
  assert.equal(matchFolderToTrade('HVAC Portland').slug, 'hvac');
  assert.equal(matchFolderToTrade('Referrals'), null);
});

test('matchFolderToTrade prefers best trade match', () => {
  const hit = matchFolderToTrade('Pool cleaning service');
  assert.ok(hit);
  assert.equal(hit.slug, 'pool_service');
});
