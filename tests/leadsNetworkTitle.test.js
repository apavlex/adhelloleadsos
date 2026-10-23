/**
 * Naming split:
 * - Leads Network = teammate field work / calendar
 * - Referral Leads = seats / referrals / members / branding / setup
 * - Referral Network = partner send/receive page (niches + partners)
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

test('Referral Leads title used on network referrals / seats / members', () => {
  assert.match(networkRoute, /'Referral Leads'/);
  assert.match(networkView, /Referral leads/);
  assert.match(nav, /href="\/network\?tab=referrals"[\s\S]*?<span>Referral Leads<\/span>/);
});

test('Referral Network page is the partners / niches board', () => {
  assert.match(referralsRoute, /title: 'Referral Network'/);
  assert.match(referralsView, />Referral Network</);
  assert.match(nav, /href="\/referrals"[\s\S]*?<span>Referral Network<\/span>/);
});

test('app branding and setup remain behind the settings gear', () => {
  const navbar = fs.readFileSync(path.join(root, 'views/partials/navbar.ejs'), 'utf8');
  assert.match(navbar, /id="netSettingsMenu"/);
  assert.match(navbar, /net-settings--topbar/);
  const leadsStart = networkView.indexOf('const leadsTabs = [');
  const leadsBlock = networkView.slice(leadsStart, networkView.indexOf('];', leadsStart) + 2);
  const refStart = networkView.indexOf('const referralTabs = [');
  const refBlock = networkView.slice(refStart, networkView.indexOf('];', refStart) + 2);
  assert.doesNotMatch(leadsBlock, /id:\s*'brand'/);
  assert.doesNotMatch(leadsBlock, /id:\s*'setup'/);
  assert.doesNotMatch(refBlock, /id:\s*'brand'/);
  assert.doesNotMatch(refBlock, /id:\s*'setup'/);
});
