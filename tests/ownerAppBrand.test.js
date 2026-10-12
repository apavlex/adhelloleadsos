const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-app-brand-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const dbService = require('../services/database');
const store = require('../services/networkStore');
const whiteLabel = require('../services/whiteLabel');
const ownerAppBrand = require('../services/ownerAppBrand');
const { OWNER_MEMBER_ID } = require('../services/ownerReferralApp');
const { createMemberPortalToken } = require('../services/networkLinkSign');
const memberApp = require('../routes/memberApp');

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function setupOwnerApp() {
  const wid = `ws_owner_brand_${Date.now().toString(36)}`;
  await dbService.saveWorkspace(wid, {
    id: wid,
    name: 'Cascade Home Pros',
    ownerUserId: 'owner@example.com',
    members: { 'owner@example.com': { role: 'owner' } },
  });
  const network = await store.getOrCreateNetworkForWorkspace(wid, {
    name: 'Cascade Pro Network',
    ownerEmail: 'owner@example.com',
  });
  const owner = await store.saveMember(network.id, {
    id: OWNER_MEMBER_ID,
    companyName: 'Cascade Home Pros',
    contactName: 'Alex',
    email: 'owner@example.com',
    status: 'active',
  });
  const token = createMemberPortalToken({ networkId: network.id, memberId: owner.id });
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use('/', memberApp);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { wid, network, owner, token, server, base };
}

test('owner can save Workspace white-label branding from Profile', async () => {
  const { wid, network, owner, token, server, base } = await setupOwnerApp();
  try {
    const profile = await fetch(`${base}/m/${token}/profile`);
    assert.equal(profile.status, 200);
    const html = await profile.text();
    assert.match(html, /App branding/);
    assert.match(html, /profile\/branding/);
    assert.match(html, /Workspace → White label|Workspace.*White label/);
    assert.match(html, /name="appName"/);
    assert.match(html, /name="logo"/);

    const boundary = '----maBrandBoundary';
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="appName"',
      '',
      'Cascade Pros',
      `--${boundary}`,
      'Content-Disposition: form-data; name="logo"; filename="logo.png"',
      'Content-Type: image/png',
      '',
    ].join('\r\n');
    const payload = Buffer.concat([
      Buffer.from(body + '\r\n'),
      TINY_PNG,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const saved = await fetch(`${base}/m/${token}/profile/branding`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': String(payload.length),
      },
      body: payload,
    });
    assert.equal(saved.status, 303);
    assert.match(String(saved.headers.get('location') || ''), /branding_saved/);

    const ws = await dbService.getWorkspace(wid);
    const brand = whiteLabel.brandForWorkspace(ws);
    assert.equal(brand.customName, 'Cascade Pros');
    assert.equal(brand.hasLogo, true);
    assert.ok(await whiteLabel.getLogo(wid));

    const net = await store.getNetwork(network.id);
    assert.match(String(net.brand && net.brand.logoUrl || ''), /\/m\/brand\//);
    assert.equal(net.brand.appName, 'Cascade Pros');

    const out = await ownerAppBrand.saveOwnerWorkspaceBranding(network, owner, { removeLogo: true });
    assert.equal(out.ok, true);
    assert.equal(whiteLabel.brandForWorkspace(await dbService.getWorkspace(wid)).hasLogo, false);
  } finally {
    server.close();
  }
});

test('partner members do not see App branding controls', async () => {
  const wid = `ws_partner_brand_${Date.now().toString(36)}`;
  await dbService.saveWorkspace(wid, {
    id: wid,
    name: 'Agency',
    ownerUserId: 'owner@example.com',
    members: { 'owner@example.com': { role: 'owner' } },
  });
  const network = await store.getOrCreateNetworkForWorkspace(wid, {
    name: 'Net',
    ownerEmail: 'owner@example.com',
  });
  const zone = await store.saveZone(network.id, { name: 'Camas', cities: ['Camas'], zips: ['98607'] });
  const lead = await dbService.saveLeadWithMeta({
    workspaceId: wid,
    title: 'Partner Co',
    phone: 'N/A',
    city: 'Camas',
  });
  const { member } = await require('../services/networkReferrals').saveMemberWithSeats(network, {
    leadKey: lead.key,
    companyName: 'Partner Co',
    contactName: 'Pat',
    status: 'active',
  }, { trades: ['plumbing'], zoneIds: [zone.id] });
  const token = createMemberPortalToken({ networkId: network.id, memberId: member.id });
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use('/', memberApp);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const html = await (await fetch(`http://127.0.0.1:${server.address().port}/m/${token}/profile`)).text();
    assert.doesNotMatch(html, /id="maAppBranding"/);
    assert.doesNotMatch(html, /profile\/branding/);
  } finally {
    server.close();
  }
});
