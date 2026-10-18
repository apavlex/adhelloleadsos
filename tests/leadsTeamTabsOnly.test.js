/**
 * Separate Active Numbers:
 * - Referral Network = open referrals + won $
 * - Leads Network = teammate field-work cards only
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

test('referral network active numbers are open referrals and won only', () => {
  assert.match(html, /!onLeadsNetwork && !onSettingsTab && canManage/);
  assert.match(html, /fw-active--network/);
  const netStart = html.indexOf('fw-active--network');
  const netEnd = html.indexOf('</section>', netStart);
  const netBlock = html.slice(netStart, netEnd);
  assert.match(netBlock, /Open referrals/);
  assert.match(netBlock, /wonValueLabel/);
  assert.match(netBlock, />Won</);
  assert.match(netBlock, />Referral</);
  assert.doesNotMatch(netBlock, /fieldWorkSummary\.sources/);
  assert.doesNotMatch(netBlock, />Lead</);
});

test('leads network active numbers are teammate stats only', () => {
  assert.match(html, /onLeadsNetwork && canManage && typeof fieldWorkSummary/);
  assert.match(html, /fw-active--leads/);
  const leadsStart = html.indexOf('fw-active--leads');
  const leadsEnd = html.indexOf('</section>', leadsStart);
  const leadsBlock = html.slice(leadsStart, leadsEnd);
  assert.match(leadsBlock, /fieldWorkSummary\.sources\.forEach/);
  assert.match(leadsBlock, />Lead</);
  assert.doesNotMatch(leadsBlock, /Open referrals/);
  assert.doesNotMatch(leadsBlock, /wonValueLabel/);
  assert.doesNotMatch(leadsBlock, />Referral</);
});
