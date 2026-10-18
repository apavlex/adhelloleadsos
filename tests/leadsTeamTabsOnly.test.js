/**
 * Separate Active Numbers — do not combine lead count with lead deals value as one idea,
 * and do not reuse referral wording on Leads:
 * - Referral Network = open referrals + referral deals value only
 * - Leads Network = open leads + lead deals value + teammate cards
 */
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const html = fs.readFileSync(path.join(__dirname, '../views/network.ejs'), 'utf8');

test('leads and referral tab strips are split', () => {
  assert.match(html, /const leadsTabs = \[/);
  assert.match(html, /const referralTabs = \[/);
  assert.match(html, /const tabs = onLeadsNetwork \? leadsTabs : referralTabs/);
});

test('team field work and calendar are leads tabs only', () => {
  const leadsStart = html.indexOf('const leadsTabs = [');
  const leadsBlock = html.slice(leadsStart, html.indexOf('];', leadsStart) + 2);
  assert.match(leadsBlock, /id: 'field-work'/);
  assert.match(leadsBlock, /id: 'calendar'/);
  assert.doesNotMatch(leadsBlock, /id: 'referrals'/);
  assert.doesNotMatch(leadsBlock, /id: 'members'/);
});

test('referrals and members live on referral network tabs', () => {
  const refStart = html.indexOf('const referralTabs = [');
  const refBlock = html.slice(refStart, html.indexOf('];', refStart) + 2);
  assert.match(refBlock, /id: 'seats'/);
  assert.match(refBlock, /id: 'referrals'/);
  assert.match(refBlock, /id: 'members'/);
  assert.doesNotMatch(refBlock, /field-work/);
  assert.doesNotMatch(refBlock, /calendar/);
});

test('leads network CTA says Send lead; referral keeps Send referral', () => {
  assert.match(html, /onLeadsNetwork \? 'Send lead' : 'Send referral'/);
});

test('referral network shows open referrals and referral deals value only', () => {
  assert.match(html, /!onLeadsNetwork && !onSettingsTab && canManage/);
  const netStart = html.indexOf('fw-active--network');
  const netEnd = html.indexOf('</section>', netStart);
  const netBlock = html.slice(netStart, netEnd);
  assert.match(netBlock, /Open referrals/);
  assert.match(netBlock, /Deals value/);
  assert.match(netBlock, /referrals won/);
  assert.match(netBlock, />Referral</);
  assert.doesNotMatch(netBlock, /Open leads/);
  assert.doesNotMatch(netBlock, /Teammate/);
  assert.doesNotMatch(netBlock, /fieldWorkSummary\.sources/);
});

test('leads network shows open leads, lead deals value, and teammates separately', () => {
  assert.match(html, /onLeadsNetwork && canManage/);
  const leadsStart = html.indexOf('fw-active--leads');
  const leadsEnd = html.indexOf('</section>', leadsStart);
  const leadsBlock = html.slice(leadsStart, leadsEnd);
  assert.match(leadsBlock, /Open leads/);
  assert.match(leadsBlock, /Deals value/);
  assert.match(leadsBlock, /leads won/);
  assert.match(leadsBlock, />Lead</);
  assert.match(leadsBlock, />Teammate</);
  assert.match(leadsBlock, /fieldWorkSummary\.sources/);
  assert.doesNotMatch(leadsBlock, /Open referrals/);
  assert.doesNotMatch(leadsBlock, /referrals won/);
});

test('settings gear lives in the app top bar on network pages', () => {
  const navbar = fs.readFileSync(path.join(__dirname, '../views/partials/navbar.ejs'), 'utf8');
  assert.match(navbar, /net-settings--topbar/);
  assert.match(navbar, /id="netSettingsMenu"/);
  assert.doesNotMatch(html, /id="netSettingsMenu"/);
});
