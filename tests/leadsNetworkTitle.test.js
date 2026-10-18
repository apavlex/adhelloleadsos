/**
 * Leads nav page titles as Leads Network; branding/setup stay behind the settings gear.
 */
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const networkView = fs.readFileSync(path.join(root, 'views/network.ejs'), 'utf8');
const networkRoute = fs.readFileSync(path.join(root, 'routes/network.js'), 'utf8');
const nav = fs.readFileSync(path.join(root, 'views/partials/app_nav_items.ejs'), 'utf8');

test('referrals tab document title is Leads Network', () => {
  assert.match(
    networkRoute,
    /title:\s*tab === 'referrals' \? 'Leads Network' : 'Referral network'/,
  );
});

test('referrals tab page header uses Leads Network', () => {
  assert.match(networkView, /tab === 'referrals'/);
  assert.match(networkView, />Leads Network</);
  assert.match(networkView, /Leads network/);
});

test('sidebar Leads Network item points at network referrals', () => {
  assert.match(nav, /href="\/network\?tab=referrals"/);
  assert.match(nav, /<span>Leads Network<\/span>/);
});

test('app branding and setup remain behind the settings gear', () => {
  assert.match(networkView, /id="netSettingsMenu"/);
  const start = networkView.indexOf('const tabs = [');
  const block = networkView.slice(start, networkView.indexOf('];', start) + 2);
  assert.doesNotMatch(block, /id:\s*'brand'/);
  assert.doesNotMatch(block, /id:\s*'setup'/);
});
