const fs = require('fs');
const os = require('os');
const path = require('path');
const { mock } = require('node:test');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'form-lead-refer-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const store = require('../services/networkStore');
const appointmentPackages = require('../services/appointmentPackages');
const networkReferrals = require('../services/networkReferrals');
const notify = require('../services/networkNotify');
const { createMemberPortalToken } = require('../services/networkLinkSign');
const memberApp = require('../routes/memberApp');

function startApp() {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
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

test('sendReferral can target a partner directly', async () => {
  const network = await store.getOrCreateNetworkForWorkspace('ws_fl_direct', {
    name: 'Direct Net',
    trades: ['flooring', 'electrical', 'handyman'],
  });
  const a = await store.saveMember(network.id, {
    companyName: 'Floors Co', contactName: 'Pat', status: 'active', trades: ['flooring'], phone: '3605550101',
  });
  const b = await store.saveMember(network.id, {
    companyName: 'Electric Co', contactName: 'Sam', status: 'active', trades: ['electrical'], phone: '3605550102',
  });

  const result = await networkReferrals.sendReferral({
    network,
    fromMemberId: a.id,
    by: a.companyName,
    toMemberId: b.id,
    input: {
      tradeSlug: 'electrical',
      name: 'Jordan Form',
      phone: '3605550999',
      note: 'Website form · Needs a panel upgrade',
      consent: 'on',
    },
    baseUrl: 'https://app.example.com',
  });
  assert.equal(result.ok, true);
  assert.equal(result.referral.status, 'sent');
  assert.equal(result.referral.toMemberId, b.id);
  assert.equal(result.referral.homeowner.name, 'Jordan Form');
  assert.match(result.referral.homeowner.note, /Website form/);
});

test('member app refers a website form lead to a partner without copy/paste', async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(notify, 'notifyReferralRecipient', async () => ({ ok: true, channel: 'sms' }));
  mock.method(notify, 'notifyReferralPool', async () => 0);
  mock.method(notify, 'syncPartnerCounter', async () => {});
  mock.method(notify, 'createOperatorTask', async () => null);

  const network = await store.getOrCreateNetworkForWorkspace('ws_fl_ui', {
    name: 'Form Lead Net',
    trades: ['flooring', 'electrical', 'handyman'],
  });
  const a = await store.saveMember(network.id, {
    companyName: 'Owner Floors',
    contactName: 'Pat',
    status: 'active',
    trades: ['flooring'],
    phone: '3605550201',
    email: 'pat@owner.example',
  });
  const b = await store.saveMember(network.id, {
    companyName: 'Partner Electric',
    contactName: 'Sam',
    status: 'active',
    trades: ['electrical'],
    phone: '3605550202',
  });

  const pkg = await appointmentPackages.createPackage(network.ownerWorkspaceId, {
    businessName: 'Owner Floors',
    trade: 'Flooring',
    contactEmail: 'pat@owner.example',
    contactPhone: '3605550201',
  });
  await appointmentPackages.deliverLeadToPackage(network.ownerWorkspaceId, pkg.id, {
    name: 'Taylor Brooks',
    phone: '3605550105',
    email: 'taylor.brooks@example.com',
    preview: 'Deck railing repair — flexible on day.',
    source: 'ghl',
    formName: 'Website contact',
  });

  const freshPkg = await appointmentPackages.getPackage(network.ownerWorkspaceId, pkg.id);
  const formLead = (freshPkg.formLeads || []).find((f) => f.name === 'Taylor Brooks');
  assert.ok(formLead);

  // Ensure package link is explicit for the member app.
  await store.saveMember(network.id, { ...a, appointmentPackageId: pkg.id });
  const token = createMemberPortalToken({ networkId: network.id, memberId: a.id });

  const { server, base } = await startApp();
  const A = `${base}/m/${token}`;
  try {
    const page = await (await fetch(`${A}/referrals`)).text();
    assert.match(page, /Taylor Brooks/);
    assert.match(page, /Send to a partner/);
    assert.match(page, /leads\/[^"]+\/refer/);
    assert.match(page, /Partner Electric/);

    const sent = await post(`${A}/leads/${encodeURIComponent(formLead.id)}/refer`, {
      toMemberId: b.id,
      tradeSlug: 'electrical',
    });
    assert.equal(sent.status, 303);
    assert.match(sent.headers.get('location') || '', /ok=lead_referred/);

    const referrals = await store.listReferrals(network.id);
    const hit = referrals.find((r) => r.homeowner && r.homeowner.name === 'Taylor Brooks');
    assert.ok(hit);
    assert.equal(hit.toMemberId, b.id);
    assert.equal(hit.fromMemberId, a.id);
    assert.match(hit.homeowner.note || '', /Deck railing|Website contact/);

    const closedPkg = await appointmentPackages.getPackage(network.ownerWorkspaceId, pkg.id);
    const closedLead = (closedPkg.formLeads || []).find((f) => f.id === formLead.id);
    assert.equal(closedLead.status, 'closed');
  } finally {
    server.close();
  }
});
test('referrals template includes send-to-partner UI for form leads', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'views/member_app/referrals.ejs'), 'utf8');
  assert.match(page, /Send to a partner/);
  assert.match(page, /leads\/<%= encodeURIComponent\(lead\.id\) %>\/refer/);
  assert.match(page, /toMemberId/);
});
