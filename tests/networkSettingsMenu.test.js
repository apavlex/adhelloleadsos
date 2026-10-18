/**
 * App branding + Setup are under the top-bar settings gear, not the main tab strip.
 */
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const network = fs.readFileSync(path.join(root, 'views/network.ejs'), 'utf8');
const navbar = fs.readFileSync(path.join(root, 'views/partials/navbar.ejs'), 'utf8');

test('network page exposes branding and setup via top-bar settings icon', () => {
  assert.match(navbar, /id="netSettingsMenu"/);
  assert.match(navbar, /net-settings--topbar/);
  assert.match(navbar, /np === 'network'/);
  assert.match(navbar, /aria-label="App branding and setup"/);
  assert.match(navbar, /href="\/network\?tab=brand"/);
  assert.match(navbar, /href="\/network\?tab=setup"/);
  assert.match(network, /settingsTabs/);
  assert.match(network, /id:\s*'brand',\s*label:\s*'App branding'/);
  assert.match(network, /id:\s*'setup',\s*label:\s*'Setup'/);
  assert.doesNotMatch(network, /id="netSettingsMenu"/);
});

test('main network tabs array no longer lists brand or setup', () => {
  const leadsStart = network.indexOf('const leadsTabs = [');
  const leadsBlock = network.slice(leadsStart, network.indexOf('];', leadsStart) + 2);
  const refStart = network.indexOf('const referralTabs = [');
  const refBlock = network.slice(refStart, network.indexOf('];', refStart) + 2);
  assert.ok(leadsStart >= 0);
  assert.ok(refStart >= 0);
  assert.doesNotMatch(leadsBlock, /id:\s*'brand'/);
  assert.doesNotMatch(leadsBlock, /id:\s*'setup'/);
  assert.doesNotMatch(refBlock, /id:\s*'brand'/);
  assert.doesNotMatch(refBlock, /id:\s*'setup'/);
  assert.match(refBlock, /id:\s*'seats'/);
  assert.match(leadsBlock, /id:\s*'calendar'/);
});

test('settings sub-nav appears when brand or setup is active', () => {
  assert.match(network, /onSettingsTab/);
  assert.match(network, /net-settings-tabs/);
});
