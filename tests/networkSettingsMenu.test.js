/**
 * App branding + Setup are under the top-right settings gear, not the main tab strip.
 */
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const network = fs.readFileSync(path.join(__dirname, '../views/network.ejs'), 'utf8');

test('network page exposes branding and setup via top-right settings icon', () => {
  assert.match(network, /id="netSettingsMenu"/);
  assert.match(network, /aria-label="App branding and setup"/);
  assert.match(network, /settingsTabs/);
  assert.match(network, /id:\s*'brand',\s*label:\s*'App branding'/);
  assert.match(network, /id:\s*'setup',\s*label:\s*'Setup'/);
  assert.match(network, /href="\/network\?tab=<%= t\.id %>"/);
});

test('main network tabs array no longer lists brand or setup', () => {
  const start = network.indexOf('const tabs = [');
  assert.ok(start >= 0);
  const block = network.slice(start, network.indexOf('];', start) + 2);
  assert.doesNotMatch(block, /id:\s*'brand'/);
  assert.doesNotMatch(block, /id:\s*'setup'/);
  assert.match(block, /id:\s*'seats'/);
  assert.match(block, /id:\s*'calendar'/);
});

test('settings sub-nav appears when brand or setup is active', () => {
  assert.match(network, /onSettingsTab/);
  assert.match(network, /net-settings-tabs/);
});
