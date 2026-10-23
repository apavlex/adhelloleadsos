/**
 * Leads Network Send lead — teammate multi-select / all, via referral accept path,
 * plus cross-workspace directory for owners/admins/managers.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const networkLeadSend = require('../services/networkLeadSend');

test('listLeadTeammates only includes active members', () => {
  const rows = networkLeadSend.listLeadTeammates([
    { id: 'a', companyName: 'Alpha Co', status: 'active', email: 'a@x.com' },
    { id: 'b', companyName: 'Beta Co', status: 'paused', email: 'b@x.com' },
    { id: 'c', contactName: 'Casey', status: 'active' },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, 'a');
  assert.equal(rows[0].name, 'Alpha Co');
  assert.equal(rows[1].id, 'c');
  assert.equal(rows[1].name, 'Casey');
});

test('recipientKey / parseRecipientKey round-trip', () => {
  const key = networkLeadSend.recipientKey('net1', 'mem2');
  assert.equal(key, 'net1:mem2');
  const parsed = networkLeadSend.parseRecipientKey(key);
  assert.deepEqual(parsed, { networkId: 'net1', memberId: 'mem2', key: 'net1:mem2' });
  assert.equal(networkLeadSend.parseRecipientKey('bad'), null);
});

test('sendLeadToTeammates requires name and phone or email', async () => {
  const noName = await networkLeadSend.sendLeadToTeammates({
    network: { id: 'n1', trades: ['hvac'] },
    members: [{ id: 'm1', companyName: 'Mate', status: 'active' }],
    memberIds: ['m1'],
    lead: { phone: '555' },
  });
  assert.equal(noName.ok, false);
  assert.match(noName.error, /name/i);

  const noContact = await networkLeadSend.sendLeadToTeammates({
    network: { id: 'n1', trades: ['hvac'] },
    members: [{ id: 'm1', companyName: 'Mate', status: 'active' }],
    memberIds: ['m1'],
    lead: { name: 'Pat' },
  });
  assert.equal(noContact.ok, false);
  assert.match(noContact.error, /phone or email/i);
});

test('sendLeadToTeammates requires a teammate selection', async () => {
  const result = await networkLeadSend.sendLeadToTeammates({
    network: { id: 'n1', trades: ['hvac'] },
    members: [{ id: 'm1', companyName: 'Mate', status: 'active' }],
    memberIds: [],
    sendAll: false,
    lead: { name: 'Pat', phone: '555' },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /teammate/i);
});

test('sendLeadAcrossWorkspaces requires a target selection', async () => {
  const result = await networkLeadSend.sendLeadAcrossWorkspaces({
    userEmail: 'nobody@example.com',
    targets: [],
    lead: { name: 'Pat', phone: '555' },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /Reviews-app user|name/i);
});

test('Leads Network CTA opens send-lead modal, not referral trade form', () => {
  const html = fs.readFileSync(path.join(__dirname, '../views/network.ejs'), 'utf8');
  const modal = fs.readFileSync(path.join(__dirname, '../views/partials/send_lead_modal.ejs'), 'utf8');
  assert.match(html, /data-open-send-lead/);
  assert.match(modal, /Send lead/);
  assert.match(modal, /Send to all/);
  assert.match(modal, /sendLeadTeammateList/);
  assert.match(modal, /All workspaces/);
  assert.match(modal, /sendLeadSearch/);
  assert.match(modal, /See accepts/);
  assert.doesNotMatch(modal, /Trade needed/);
  assert.doesNotMatch(modal, /Pick a trade/);
});

test('network routes expose lead-send options and cross-workspace send', () => {
  const route = fs.readFileSync(path.join(__dirname, '../routes/network.js'), 'utf8');
  assert.match(route, /\/lead-send-options/);
  assert.match(route, /\/leads\/send/);
  assert.match(route, /networkLeadSend\.sendLeadToTeammates/);
  assert.match(route, /networkLeadSend\.sendLeadAcrossWorkspaces/);
  assert.match(route, /listDirectoryRecipients/);
  assert.match(route, /canCrossWorkspace/);
});

test('send-lead modal JS supports all-workspaces scope and search', () => {
  const js = fs.readFileSync(path.join(__dirname, '../public/js/send-lead-modal.js'), 'utf8');
  assert.match(js, /canCrossWorkspace/);
  assert.match(js, /directory/);
  assert.match(js, /scope === 'all'/);
  assert.match(js, /sendLeadSearch/);
  assert.match(js, /targets/);
});

test('Engagement inbox Send lead button prefills the teammate modal', () => {
  const page = fs.readFileSync(path.join(__dirname, '../views/engagement.ejs'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '../public/js/send-lead-modal.js'), 'utf8');
  assert.match(page, /data-open-send-lead/);
  assert.match(page, /data-send-lead-name/);
  assert.match(page, /Send lead/);
  assert.match(page, /engagement-thread/);
  assert.match(page, /You · SMS/);
  assert.match(js, /prefillFromOpener/);
  assert.match(js, /applyPrefill/);
  assert.match(js, /data-send-lead-note/);
});
