/**
 * Team field work / Team calendar stay on Leads Network.
 * Active Numbers: Network = referral stats; Leads = teammate stats — not mixed.
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
  assert.match(leadsBlock, /id: 'referrals'/);
  assert.match(leadsBlock, /id: 'members'/);

  const refStart = html.indexOf('const referralTabs = [');
  const refBlock = html.slice(refStart, html.indexOf('];', refStart) + 2);
  assert.match(refBlock, /id: 'seats'/);
  assert.match(refBlock, /id: 'applications'/);
  assert.doesNotMatch(refBlock, /field-work/);
  assert.doesNotMatch(refBlock, /calendar/);
});

test('referral network active numbers are open referrals and won only', () => {
  assert.match(html, /!onLeadsNetwork && !onSettingsTab && canManage/);
  assert.match(html, /aria-label="Network referral stats"/);
  assert.match(html, /fw-active--network/);
  assert.match(html, /fw-active-grid--network/);
  const netStart = html.indexOf('fw-active--network');
  const netEnd = html.indexOf('</section>', netStart);
  const netBlock = html.slice(netStart, netEnd);
  assert.match(netBlock, /Open referrals/);
  assert.match(netBlock, />Won</);
  assert.match(netBlock, />Network</);
  assert.doesNotMatch(netBlock, /fieldWorkSummary\.sources/);
  assert.doesNotMatch(netBlock, />Team</);
  assert.doesNotMatch(netBlock, />Lead</);
});

test('leads network active numbers are teammate stats only', () => {
  assert.match(html, /onLeadsNetwork && canManage && typeof fieldWorkSummary/);
  assert.match(html, /aria-label="Teammate field work stats"/);
  assert.match(html, /fw-active--leads/);
  const leadsStart = html.indexOf('fw-active--leads');
  const leadsEnd = html.indexOf('</section>', leadsStart);
  const leadsBlock = html.slice(leadsStart, leadsEnd);
  assert.match(leadsBlock, /fieldWorkSummary\.sources\.forEach/);
  assert.match(leadsBlock, />Lead</);
  assert.doesNotMatch(leadsBlock, /Open referrals/);
  assert.doesNotMatch(leadsBlock, /wonValueLabel/);
  assert.doesNotMatch(leadsBlock, />Network</);
});
