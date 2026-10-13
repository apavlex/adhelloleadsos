const fs = require('fs');
const os = require('os');
const path = require('path');
const { mock } = require('node:test');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'member-share-invite-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const store = require('../services/networkStore');
const work = require('../services/memberWork');
const shareInvite = require('../services/memberShareInvite');
const ghlMessaging = require('../services/ghlMessaging');
const workspaceIntegrations = require('../services/workspaceIntegrations');
const { createMemberPortalToken } = require('../services/networkLinkSign');
const memberApp = require('../routes/memberApp');
const shareInviteRoutes = require('../routes/shareInvite');
const freeAppSignup = require('../services/freeAppSignup');

function startApp() {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use('/', shareInviteRoutes);
  app.use('/', memberApp);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

function post(url, body) {
  return fetch(url, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
}

test('createOrShare invites outsider, claim delivers contact + all projects', async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(workspaceIntegrations, 'getResolvedIntegrationEnv', async () => ({
    GHL_API_KEY: 'key',
    GHL_LOCATION_ID: 'loc',
    GHL_SMS_FROM_NUMBER: '+15551234567',
    GHL_EMAIL_FROM: 'from@example.com',
  }));
  const smsCalls = [];
  mock.method(ghlMessaging, 'messagingReady', () => ({
    configured: true, smsReady: true, emailReady: true, hasEmailFrom: true, hasSmsFromNumber: true,
  }));
  mock.method(ghlMessaging, 'sendSmsToPerson', async (opts) => {
    smsCalls.push(opts);
    return { messageId: 'sms_invite_1' };
  });

  const network = await store.getOrCreateNetworkForWorkspace('ws_share_invite', { name: 'Invite Net' });
  const from = await store.saveMember(network.id, {
    companyName: 'Camas Flooring',
    contactName: 'Pat',
    status: 'active',
    phone: '3605550101',
    email: 'pat@example.com',
  });
  const cust = await work.saveCustomer(network.id, from.id, {
    name: 'Jordan Outside',
    phone: '3605550999',
    address: '9 Oak',
  });
  assert.equal(cust.ok, true);
  const job1 = await work.saveJob(network.id, from.id, {
    customerId: cust.customer.id,
    title: 'Kitchen',
    status: 'scheduled',
    date: '2026-11-10',
    time: '09:00',
  });
  const job2 = await work.saveJob(network.id, from.id, {
    customerId: cust.customer.id,
    title: 'Bath',
    status: 'lead',
  });
  assert.equal(job1.ok && job2.ok, true);

  const created = await shareInvite.createOrShare({
    network,
    fromMember: from,
    customerId: cust.customer.id,
    phone: '3605557777',
    contactName: 'Alex New',
    companyName: 'New Partner Co',
    baseUrl: 'https://app.example.com',
  });
  assert.equal(created.ok, true);
  assert.equal(created.mode, 'invite');
  assert.ok(created.invite && created.invite.id);
  assert.match(created.url, /\/share\/c\/[a-z0-9]+$/);
  assert.equal(smsCalls.length, 1);
  assert.match(smsCalls[0].message, /Jordan Outside/);
  assert.match(smsCalls[0].message, /\/share\/c\//);

  const { server, base } = await startApp();
  try {
    const claimGet = await fetch(`${base}/share/c/${created.invite.id}`);
    assert.equal(claimGet.status, 200);
    const claimHtml = await claimGet.text();
    assert.match(claimHtml, /Join &amp; open contact|Join & open contact/);
    assert.match(claimHtml, /Jordan Outside/);
    assert.match(claimHtml, /Camas Flooring|Pat/);

    const claimed = await post(`${base}/share/c/${created.invite.id}`, {
      companyName: 'New Partner Co',
      contactName: 'Alex New',
      phone: '3605557777',
      email: 'alex@newpartner.example',
    });
    assert.equal(claimed.status, 200);
    const doneHtml = await claimed.text();
    assert.match(doneHtml, /You’re in|You're in/);
    assert.match(doneHtml, /Open in/);

    const invite = await shareInvite.getInvite(created.invite.id);
    assert.equal(invite.status, 'claimed');
    assert.ok(invite.claimedMemberId);
    assert.ok(invite.claimedCustomerId);

    const member = await store.getMember(network.id, invite.claimedMemberId);
    assert.ok(member);
    assert.equal(member.plan, freeAppSignup.PLAN_APP_FREE);
    assert.equal(member.companyName, 'New Partner Co');

    const theirCustomers = await work.listCustomers(network.id, member.id);
    assert.equal(theirCustomers.length, 1);
    assert.equal(theirCustomers[0].name, 'Jordan Outside');
    assert.equal(theirCustomers[0].sharedFromMemberId, from.id);

    const theirJobs = await work.listJobs(network.id, member.id);
    assert.equal(theirJobs.length, 2);
    assert.ok(theirJobs.every((j) => j.sharedFromMemberId === from.id));
  } finally {
    server.close();
  }
});

test('createOrShare shares with existing teammate when phone matches', async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(workspaceIntegrations, 'getResolvedIntegrationEnv', async () => ({}));
  mock.method(ghlMessaging, 'messagingReady', () => ({
    configured: false, smsReady: false, emailReady: false, hasEmailFrom: false, hasSmsFromNumber: false,
  }));

  const network = await store.getOrCreateNetworkForWorkspace('ws_share_existing', { name: 'Existing Net' });
  const a = await store.saveMember(network.id, {
    companyName: 'Alpha', contactName: 'Ann', status: 'active', phone: '3605550201',
  });
  const b = await store.saveMember(network.id, {
    companyName: 'Beta Electric', contactName: 'Bo', status: 'active', phone: '3605550202', email: 'bo@beta.example',
  });
  const cust = await work.saveCustomer(network.id, a.id, { name: 'Shared Lead', phone: '3605550209' });
  await work.saveJob(network.id, a.id, {
    customerId: cust.customer.id, title: 'Panel', status: 'lead',
  });

  const result = await shareInvite.createOrShare({
    network,
    fromMember: a,
    customerId: cust.customer.id,
    phone: '3605550202',
    baseUrl: 'https://app.example.com',
  });
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'existing_member');
  assert.equal(result.member.id, b.id);
  const bCust = await work.listCustomers(network.id, b.id);
  assert.ok(bCust.some((c) => c.name === 'Shared Lead' && c.sharedFromMemberId === a.id));
  assert.equal((await work.listJobs(network.id, b.id)).length, 1);
});

test('member app invite-outside form creates claimable invite', async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(workspaceIntegrations, 'getResolvedIntegrationEnv', async () => ({
    GHL_API_KEY: 'key',
    GHL_LOCATION_ID: 'loc',
    GHL_SMS_FROM_NUMBER: '+15551234567',
  }));
  mock.method(ghlMessaging, 'messagingReady', () => ({
    configured: true, smsReady: true, emailReady: false, hasEmailFrom: false, hasSmsFromNumber: true,
  }));
  mock.method(ghlMessaging, 'sendSmsToPerson', async () => ({ messageId: 'sms_2' }));

  const network = await store.getOrCreateNetworkForWorkspace('ws_share_ui', { name: 'UI Net' });
  const a = await store.saveMember(network.id, {
    companyName: 'Solo Floors', contactName: 'Sam', status: 'active', phone: '3605550301',
  });
  // No teammates — outside invite UI must still show.
  const token = createMemberPortalToken({ networkId: network.id, memberId: a.id });
  const cust = await work.saveCustomer(network.id, a.id, { name: 'Riley', phone: '3605550309' });

  const { server, base } = await startApp();
  const A = `${base}/m/${token}`;
  try {
    const page = await (await fetch(`${A}/customers/c/${cust.customer.id}`)).text();
    assert.match(page, /Share contact &amp; projects|Share contact & projects/);
    assert.match(page, /Invite outside network/);
    assert.match(page, /name="invitePhone"/);
    assert.doesNotMatch(page, /Pick a teammate/);

    const invited = await post(`${A}/customers/c/${cust.customer.id}/share`, {
      invitePhone: '3605558888',
      inviteName: 'Chris',
      inviteCompany: 'Chris HVAC',
    });
    assert.equal(invited.status, 303);
    assert.match(invited.headers.get('location') || '', /ok=share_invited/);
  } finally {
    server.close();
  }
});
