const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'member-appt-link-'));
process.env.APP_DATA_DIR = tmpDir;

const dbService = require('../services/database');
const appointmentPackages = require('../services/appointmentPackages');
const networkStore = require('../services/networkStore');
const {
  OWNER_MEMBER_ID,
  findPackageForMember,
  findMemberForPackage,
  listPartnerAppsForWorkspace,
  listOwnerFormLeads,
  networkHasReferralPartners,
  normName,
} = require('../services/memberAppointmentLink');

describe('memberAppointmentLink', () => {
  before(async () => {
    await dbService.saveWorkspace('ws_link', { id: 'ws_link', members: {} });
  });

  after(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('normalizes company names for fuzzy match', () => {
    assert.equal(normName('Handymen LLC'), 'handymen llc');
    assert.equal(normName('  Floor-Co!! '), 'floor co');
  });

  it('matches member to package by leadKey, email, name, or explicit id', async () => {
    const a = await appointmentPackages.createPackage('ws_link', {
      businessName: 'Spark Electric',
      trade: 'Electrician',
      purchased: 5,
      leadKey: 'lead_spark',
      contactEmail: 'spark@example.com',
      leadsPurchased: 10,
    });
    const b = await appointmentPackages.createPackage('ws_link', {
      businessName: 'Floor Co Showroom',
      trade: 'Flooring',
      purchased: 3,
      contactEmail: 'floor@example.com',
      leadsPurchased: 5,
    });

    const byLead = await findPackageForMember('ws_link', { leadKey: 'lead_spark' });
    assert.equal(byLead.id, a.id);

    const byEmail = await findPackageForMember('ws_link', { email: 'floor@example.com' });
    assert.equal(byEmail.id, b.id);

    const byName = await findPackageForMember('ws_link', { companyName: 'Spark Electric Co' });
    assert.equal(byName.id, a.id);

    const byId = await findPackageForMember('ws_link', { appointmentPackageId: b.id });
    assert.equal(byId.id, b.id);

    const miss = await findPackageForMember('ws_link', { companyName: 'Nobody LLC' });
    assert.equal(miss, null);
  });

  it('finds network member for a package and lists partner apps for Get the app', async () => {
    const network = await networkStore.getOrCreateNetworkForWorkspace('ws_link', {
      name: 'Bright Electric network',
      ownerEmail: 'owner@example.com',
    });
    const pkg = await appointmentPackages.createPackage('ws_link', {
      businessName: 'A Apple Plumbing',
      trade: 'Plumbing',
      purchased: 4,
      contactEmail: 'apple@plumbing.test',
      leadsPurchased: 8,
    });
    const member = await networkStore.saveMember(network.id, {
      companyName: 'A Apple Plumbing',
      email: 'apple@plumbing.test',
      phone: '5550100',
      appointmentPackageId: pkg.id,
      status: 'active',
    });

    const linked = await findMemberForPackage('ws_link', pkg);
    assert.ok(linked);
    assert.equal(linked.member.id, member.id);
    assert.equal(linked.network.id, network.id);

    const listed = await listPartnerAppsForWorkspace('ws_link');
    assert.ok(listed.network);
    assert.ok(listed.partners.some((p) => p.memberId === member.id && p.packageId === pkg.id));
  });

  it('workspace owner gets package + form leads even with no referral partners', async () => {
    const wid = 'ws_owner_only';
    await dbService.saveWorkspace(wid, { id: wid, members: {} });
    const network = await networkStore.getOrCreateNetworkForWorkspace(wid, {
      name: 'Owner solo network',
      ownerEmail: 'boss@example.com',
    });
    const owner = await networkStore.saveMember(network.id, {
      id: OWNER_MEMBER_ID,
      companyName: 'Cascade Home Pros',
      email: 'boss@example.com',
      status: 'active',
    });
    // Package name does not match owner company — still must attach for owner-only networks.
    const pkg = await appointmentPackages.createPackage(wid, {
      businessName: 'Website Forms Inbox',
      trade: 'General',
      purchased: 2,
      contactEmail: 'forms@other.test',
      leadsPurchased: 20,
    });
    await appointmentPackages.attachFormLead(wid, {
      leadKey: 'lead_owner_1',
      name: 'Pat Homeowner',
      phone: '3605550100',
      formName: 'Contact form',
      source: 'ghl',
      at: new Date().toISOString(),
    }, { packageId: pkg.id });

    assert.equal(await networkHasReferralPartners(network), false);

    const linked = await findPackageForMember(wid, owner, network);
    assert.ok(linked);
    assert.equal(linked.id, pkg.id);

    const reverse = await findMemberForPackage(wid, pkg);
    assert.ok(reverse);
    assert.equal(reverse.member.id, OWNER_MEMBER_ID);

    const leads = await listOwnerFormLeads(wid);
    assert.ok(leads.some((l) => l.name === 'Pat Homeowner'));
  });
});
