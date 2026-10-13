const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adhello-owner-ref-app-'));
process.env.APP_DATA_DIR = tmpDir;
process.env.SESSION_SECRET = 'test-owner-ref-secret';

const dbService = require('../services/database');
const {
  ensureOwnerReferralApp,
  OWNER_MEMBER_ID,
  staffMemberIdForEmail,
} = require('../services/ownerReferralApp');
const networkStore = require('../services/networkStore');
const memberAppointmentLink = require('../services/memberAppointmentLink');

describe('ownerReferralApp', () => {
  before(async () => {
    await dbService.saveWorkspace('ws_owner_ref_1', {
      id: 'ws_owner_ref_1',
      name: 'Bright Electric',
      slug: 'bright-electric',
      ownerUserId: 'pat@example.com',
      members: {
        'pat@example.com': { role: 'owner' },
        'sam@example.com': { role: 'sdr' },
      },
    });
  });

  after(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('creates a stable owner member with short share URL and /m/ open path', async () => {
    const req = {
      workspaceId: 'ws_owner_ref_1',
      workspace: {
        id: 'ws_owner_ref_1',
        name: 'Bright Electric',
        ownerUserId: 'pat@example.com',
        members: {
          'pat@example.com': { role: 'owner' },
          'sam@example.com': { role: 'sdr' },
        },
        whiteLabel: { appName: 'Bright Electric Co' },
      },
      user: { displayName: 'Patrick', emails: [{ value: 'pat@example.com' }] },
      protocol: 'https',
      get: () => 'leads.adhello.io',
    };
    const first = await ensureOwnerReferralApp(req);
    assert.equal(first.member.id, OWNER_MEMBER_ID);
    assert.equal(first.isStaff, false);
    assert.match(first.path, /^\/m\/[^/]+$/);
    assert.match(first.url, /\/a\/[a-z0-9]{8,12}$/);
    assert.doesNotMatch(first.url, /\/m\/eyJ/);
    assert.equal(first.member.companyName, 'Bright Electric Co');

    const second = await ensureOwnerReferralApp(req);
    assert.equal(second.member.id, first.member.id);
    assert.equal(second.network.id, first.network.id);
    assert.match(second.path, /^\/m\/[^/]+$/);
    assert.match(second.url, /\/a\/[a-z0-9]{8,12}$/);

    const stored = await networkStore.getMember(first.network.id, OWNER_MEMBER_ID);
    assert.ok(stored);
    assert.equal(stored.companyName, 'Bright Electric Co');
    assert.ok(stored.portalCode);
  });

  it('gives each staff login their own personal app (not the owner row)', async () => {
    const ws = {
      id: 'ws_owner_ref_1',
      name: 'Bright Electric',
      ownerUserId: 'pat@example.com',
      members: {
        'pat@example.com': { role: 'owner' },
        'sam@example.com': { role: 'sdr' },
      },
      whiteLabel: { appName: 'Bright Electric Co' },
    };
    const staffReq = {
      workspaceId: 'ws_owner_ref_1',
      workspace: ws,
      user: { displayName: 'Sam Rivera', emails: [{ value: 'sam@example.com' }] },
      protocol: 'https',
      get: () => 'leads.adhello.io',
    };
    const staff = await ensureOwnerReferralApp(staffReq);
    assert.equal(staff.isStaff, true);
    assert.equal(staff.member.id, staffMemberIdForEmail('sam@example.com'));
    assert.notEqual(staff.member.id, OWNER_MEMBER_ID);
    assert.equal(staff.member.contactName, 'Sam');
    assert.equal(staff.member.email, 'sam@example.com');
    assert.equal(staff.member.workspaceStaff, true);
    assert.match(staff.path, /^\/m\/[^/]+$/);
    assert.match(staff.url, /\/a\/[a-z0-9]{8,12}$/);

    const again = await ensureOwnerReferralApp(staffReq);
    assert.equal(again.member.id, staff.member.id);

    const owner = await ensureOwnerReferralApp({
      workspaceId: 'ws_owner_ref_1',
      workspace: ws,
      user: { displayName: 'Patrick', emails: [{ value: 'pat@example.com' }] },
      protocol: 'https',
      get: () => 'leads.adhello.io',
    });
    assert.equal(owner.member.id, OWNER_MEMBER_ID);
    assert.notEqual(owner.path, staff.path);

    const listed = await memberAppointmentLink.listPartnerAppsForWorkspace('ws_owner_ref_1');
    assert.ok(!listed.partners.some((p) => p.memberId === staff.member.id),
      'workspace staff must not appear as referral partners');
  });
});
