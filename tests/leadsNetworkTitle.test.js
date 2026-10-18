/**
 * Naming split:
 * - Leads Network = teammate field work / calendar
 * - Referral Network = seats / referrals / members / branding / setup
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

test('Leads Network nav is active for teammate tabs only', () => {
  assert.match(iaNav, /networkTab === 'field-work'/);
  assert.match(iaNav, /networkTab === 'calendar'/);
  assert.match(iaNav, /navNetworkTab = 'leads'/);
  assert.match(iaNav, /navNetworkTab = 'referral'/);
  assert.doesNotMatch(iaNav, /networkTab === 'referrals'/);
  assert.doesNotMatch(iaNav, /networkTab === 'members'/);
});

test('Leads Network page title covers teammate tabs', () => {
  assert.match(networkRoute, /'Leads Network'/);
  assert.match(networkRoute, /tab === 'field-work' \|\| tab === 'calendar'/);
  assert.match(networkView, /leadsNetworkTabIds/);
  assert.match(networkView, /const leadsTabs = \[/);
  assert.match(networkView, />Leads Network</);
  assert.match(nav, /href="\/network\?tab=field-work"/);
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
  const leadsStart = networkView.indexOf('const leadsTabs = [');
  const leadsBlock = networkView.slice(leadsStart, networkView.indexOf('];', leadsStart) + 2);
  const refStart = networkView.indexOf('const referralTabs = [');
  const refBlock = networkView.slice(refStart, networkView.indexOf('];', refStart) + 2);
  assert.doesNotMatch(leadsBlock, /id:\s*'brand'/);
  assert.doesNotMatch(leadsBlock, /id:\s*'setup'/);
  assert.doesNotMatch(refBlock, /id:\s*'brand'/);
  assert.doesNotMatch(refBlock, /id:\s*'setup'/);
});
