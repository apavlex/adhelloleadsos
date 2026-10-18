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

test('referral network shows open, deals, leads sent, and partners cards', () => {
  assert.match(html, /!onLeadsNetwork && !onSettingsTab && canManage/);
  const netStart = html.indexOf('fw-active--network');
  const netEnd = html.indexOf('</section>', netStart);
  const netBlock = html.slice(netStart, netEnd);
  assert.match(netBlock, /Open referrals/);
  assert.match(netBlock, /Deals value/);
  assert.match(netBlock, /referrals won/);
  assert.match(netBlock, /Leads sent/);
  assert.match(netBlock, /totals\.leadsSent/);
  assert.match(netBlock, /Referral partners/);
  assert.match(netBlock, /totals\.partnerMembers/);
  assert.match(netBlock, />Partner</);
  assert.match(netBlock, />Referral</);
  assert.doesNotMatch(netBlock, /Referral network/);
  assert.doesNotMatch(netBlock, />Network</);
  assert.doesNotMatch(netBlock, /Open leads/);
  assert.doesNotMatch(netBlock, /Teammate/);
  assert.doesNotMatch(netBlock, /fieldWorkSummary\.sources/);
});

test('leads network shows open leads, project value, and teammates separately', () => {
  assert.match(html, /onLeadsNetwork && canManage/);
  // Include the leadOpen / leadDeals* locals declared just above the section.
  const leadsStart = html.indexOf('<%\n      const leadOpen = fwTotals');
  assert.ok(leadsStart >= 0, 'lead locals from fwTotals');
  const leadsEnd = html.indexOf('</section>', html.indexOf('fw-active--leads'));
  const leadsBlock = html.slice(leadsStart, leadsEnd);
  assert.match(leadsBlock, /Open leads/);
  assert.match(leadsBlock, /Project value/);
  assert.match(leadsBlock, /open ·/);
  assert.match(leadsBlock, /fwTotals\.open/);
  assert.match(leadsBlock, />Lead</);
  assert.match(leadsBlock, />Teammate</);
  assert.match(leadsBlock, /fieldWorkSummary\.sources/);
  // Must use teammate field-work rollups — never referral networkTotals.
  assert.match(leadsBlock, /fwTotals\.leads/);
  assert.match(leadsBlock, /fwTotals\.dealsValueLabel/);
  assert.match(leadsBlock, /fwTotals\.dealsWon/);
  assert.doesNotMatch(leadsBlock, /totals\.wonValueLabel/);
  assert.doesNotMatch(leadsBlock, /totals\.open/);
  assert.doesNotMatch(leadsBlock, /totals\.won\b/);
  assert.doesNotMatch(leadsBlock, /tab=referrals/);
  assert.doesNotMatch(leadsBlock, /Open referrals/);
  assert.doesNotMatch(leadsBlock, /referrals won/);
});

test('settings gear lives in the app top bar on network pages', () => {
  const navbar = fs.readFileSync(path.join(__dirname, '../views/partials/navbar.ejs'), 'utf8');
  assert.match(navbar, /net-settings--topbar/);
  assert.match(navbar, /id="netSettingsMenu"/);
  assert.doesNotMatch(html, /id="netSettingsMenu"/);
});
