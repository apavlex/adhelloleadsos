/**
 * Team field work / Team calendar / Active Numbers stay on Leads Network only.
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

test('active numbers with team cards only render on leads network', () => {
  assert.match(html, /onLeadsNetwork && canManage && typeof fieldWorkSummary/);
});
