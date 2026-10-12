const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-workspace-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');
const store = require('../services/networkStore');
const ex = require('../services/referralExchange');
const workspaceIntegrations = require('../services/workspaceIntegrations');
const smsOutbound = require('../services/smsOutbound');
const ghlMessaging = require('../services/ghlMessaging');
const memberWork = require('../services/memberWork');
const { OWNER_MEMBER_ID } = require('../services/ownerReferralApp');
const { createDemoWorkspace, ensureDemoOwnerReviewApp, LEADS, REFERRALS } = require('../services/demoWorkspace');

const OWNER = 'owner@example.com';

test('demo workspace seeds leads, territories, referrals, cadences and blocks real sends', async () => {
  process.env.GHL_API_KEY = 'real-server-key';
  const first = await createDemoWorkspace(OWNER);
  const ws = await dbService.getWorkspace(first.workspaceId);
  assert.equal(ws.isDemo, true);

  const leads = await dbService.getAllLeads(first.workspaceId);
  assert.equal(leads.length, LEADS.length);
  assert.ok(leads.every((l) => l.isDemo && /^\(\d{3}\) 555-01\d\d$/.test(l.phone) && l.email.endsWith('@example.com')));
  assert.equal(new Set(leads.map((l) => l.phone)).size, leads.length);
  assert.ok(leads.filter((l) => l.sequenceState && l.sequenceState.status === 'active').length >= 6);
  assert.equal(ws.customCadences.length, 1);
  assert.equal(leads.filter((l) => l.ghlCadence && l.ghlCadence.status === 'active').length, 4);
  assert.ok(leads.filter((l) => l.opportunityPipelineId).length >= 20);

  const network = await store.getNetworkForWorkspace(first.workspaceId);
  assert.equal(network.autoGhlSubaccount, false);
  const zones = await store.listZones(network.id);
  assert.equal(zones.length, 4);
  const referrals = await store.listReferrals(network.id);
  // Network partner referrals + a couple owner Review-app sample refs.
  assert.ok(referrals.length >= REFERRALS.length + 2);
  const totals = ex.networkTotals(referrals);
  assert.ok(totals.won >= 5 && totals.unrouted >= 1 && totals.sent >= 3 && totals.wonValue > 30000);
  const members = await store.listMembers(network.id);
  const seated = members.filter((m) => ex.seatsForMember(zones, m.id).length);
  const ownerMember = await store.getMember(network.id, OWNER_MEMBER_ID);
  assert.ok(ownerMember);
  assert.equal(ownerMember.companyName, 'Cascade Home Pros');
  assert.ok(ownerMember.reviewLinks && ownerMember.reviewLinks.google);
  assert.ok(ownerMember.reviewLinks.facebook, 'owner has Facebook review link');
  assert.ok(ownerMember.reviewLinks.yelp, 'owner has Yelp review link');
  assert.ok(ownerMember.profilePhotoUpdatedAt, 'owner has profile photo');
  // Waiting partner + workspace owner Review app (no territory seat).
  assert.equal(members.length - seated.length, 2);
  assert.equal(ex.seatsForMember(zones, OWNER_MEMBER_ID).length, 0);

  const ownerCustomers = await memberWork.listCustomers(network.id, OWNER_MEMBER_ID);
  const ownerJobs = await memberWork.listJobs(network.id, OWNER_MEMBER_ID);
  assert.ok(ownerCustomers.length >= 5, 'Review app owner has sample customers');
  assert.ok(ownerJobs.length >= 5, 'Review app owner has sample jobs');
  assert.ok(ownerCustomers.some((c) => c.name === 'Avery Moss'));
  assert.ok(ownerJobs.some((j) => j.status === 'scheduled'));
  const ownerPhotos = ownerJobs.reduce((n, j) => n + ((j.photos || []).length), 0);
  assert.ok(ownerPhotos >= 4, 'owner jobs include demo photos');
  assert.ok(first.memberApp && first.memberApp.ownerCustomers >= 5);
  assert.ok(first.memberApp.featuredCustomers >= 5);
  assert.ok(first.memberApp.ownerPhotos >= 4);
  assert.ok(first.memberApp.ownerPendingRefs >= 1);
  assert.ok(first.memberApp.ownerSentRefs >= 1);

  const hero = await store.getBrandImage(network.id, 'hero');
  assert.ok(hero && hero.buffer && hero.buffer.length > 500, 'network hero banner seeded');
  const logo = await store.getBrandImage(network.id, 'logo');
  assert.ok(logo && logo.buffer && logo.buffer.length > 200, 'network logo seeded');
  const reviewStats = await store.getReviewStats(network.id, OWNER_MEMBER_ID);
  assert.ok(reviewStats.views >= 50, 'demo review page has visits');
  assert.ok(network.brand && network.brand.statValue >= 50);

  const env = await workspaceIntegrations.getResolvedIntegrationEnv(first.workspaceId);
  assert.equal(env.DEMO_WORKSPACE, '1');
  assert.notEqual(env.GHL_API_KEY, 'real-server-key');
  const lead = leads[0];
  await assert.rejects(smsOutbound.sendSmsToLead({ lead, message: 'hi', integrationEnv: env }), /demo workspace/i);
  await assert.rejects(ghlMessaging.sendEmailToLead({ lead, subject: 's', body: 'b', integrationEnv: env }), /demo workspace/i);

  const second = await createDemoWorkspace(OWNER);
  assert.notEqual(second.workspaceId, first.workspaceId);
  assert.ok((await dbService.getWorkspace(first.workspaceId)).archivedAt);
  assert.equal((await dbService.getAllLeads(first.workspaceId)).length, 0);
  const ids = await dbService.getUserWorkspaceIds(OWNER);
  assert.ok(ids.includes(second.workspaceId) && !ids.includes(first.workspaceId));
});

test('ensureDemoOwnerReviewApp backfills an empty demo owner portfolio', async () => {
  const created = await createDemoWorkspace('backfill@example.com');
  const network = await store.getNetworkForWorkspace(created.workspaceId);
  // Wipe owner portfolio to simulate a pre-seed / empty demo.
  const customers = await memberWork.listCustomers(network.id, OWNER_MEMBER_ID);
  for (const c of customers) {
    await memberWork.deleteCustomer(network.id, OWNER_MEMBER_ID, c.id);
  }
  await store.saveMember(network.id, {
    ...(await store.getMember(network.id, OWNER_MEMBER_ID)),
    reviewLinks: { google: '', facebook: '', yelp: '', nextdoor: '', other: [] },
    profilePhotoUpdatedAt: '',
  });
  await store.deleteBrandImage(network.id, 'hero');
  await dbService.putStorageKey(`netreviewstats:${network.id}:${OWNER_MEMBER_ID}`, {
    stars: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    clicks: {},
    views: 0,
  });

  const once = await ensureDemoOwnerReviewApp(created.workspaceId, { email: 'backfill@example.com' });
  assert.equal(once.ok, true);
  assert.equal(once.seeded, true);
  assert.ok(once.customerCount >= 5);
  assert.ok(once.photoCount >= 4);

  const owner = await store.getMember(network.id, OWNER_MEMBER_ID);
  assert.ok(owner.reviewLinks.facebook);
  assert.ok(owner.profilePhotoUpdatedAt);
  const hero = await store.getBrandImage(network.id, 'hero');
  assert.ok(hero && hero.buffer.length > 500);
  const again = await ensureDemoOwnerReviewApp(created.workspaceId, { email: 'backfill@example.com' });
  assert.equal(again.ok, true);
  assert.equal(again.seeded, false, 'second open is a no-op');
});
