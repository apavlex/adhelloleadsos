/**
 * Naming split:
 * - Leads Network = routed leads + teammates
 * - Referral Network = seats / branding / setup
 * - Referral Leads = partner send/receive page
 */
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const networkView = fs.readFileSync(path.join(root, 'views/network.ejs'), 'utf8');
const networkRoute = fs.readFileSync(path.join(root, 'routes/network.js'), 'utf8');
const nav = fs.readFileSync(path.join(root, 'views/partials/app_nav_items.ejs'), 'utf8');
const iaNav = fs.readFileSync(path.join(root, 'middleware/iaNav.js'), 'utf8');
const referralsView = fs.readFileSync(path.join(root, 'views/referrals.ejs'), 'utf8');
const referralsRoute = fs.readFileSync(path.join(root, 'routes/referrals.js'), 'utf8');

test('sidebar labels: Leads Network, Referral Network, Referral Leads', () => {
  assert.match(nav, /<span>Leads Network<\/span>/);
  assert.match(nav, /<span>Referral Network<\/span>/);
  assert.match(nav, /<span>Referral Leads<\/span>/);
  assert.doesNotMatch(nav, /<span>Network<\/span>/);
  assert.doesNotMatch(nav, /<span>Referral Partners<\/span>/);
});

test('Leads Network nav is active for leads and teammate tabs', () => {
  assert.match(iaNav, /networkTab === 'referrals'/);
  assert.match(iaNav, /networkTab === 'field-work'/);
  assert.match(iaNav, /networkTab === 'calendar'/);
  assert.match(iaNav, /networkTab === 'members'/);
  assert.match(iaNav, /navNetworkTab = 'leads'/);
  assert.match(iaNav, /navNetworkTab = 'referral'/);
});

test('Leads Network page title covers leads and teammates', () => {
  assert.match(networkRoute, /'Leads Network'/);
  assert.match(networkRoute, /tab === 'field-work'/);
  assert.match(networkView, /leadsNetworkTabs/);
  assert.match(networkView, />Leads Network</);
});

test('Referral Network title used outside leads/teammate tabs', () => {
  assert.match(networkRoute, /'Referral Network'/);
  assert.match(networkView, /Referral network/);
});

test('Referral Leads page uses the new name', () => {
  assert.match(referralsRoute, /title: 'Referral Leads'/);
  assert.match(referralsView, />Referral Leads</);
});

test('app branding and setup remain behind the settings gear', () => {
  assert.match(networkView, /id="netSettingsMenu"/);
  const start = networkView.indexOf('const tabs = [');
  const block = networkView.slice(start, networkView.indexOf('];', start) + 2);
  assert.doesNotMatch(block, /id:\s*'brand'/);
  assert.doesNotMatch(block, /id:\s*'setup'/);
});
