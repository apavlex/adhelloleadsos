const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adhello-owner-ref-app-'));
process.env.APP_DATA_DIR = tmpDir;
process.env.SESSION_SECRET = 'test-owner-ref-secret';

const dbService = require('../services/database');
const { ensureOwnerReferralApp, OWNER_MEMBER_ID } = require('../services/ownerReferralApp');
const networkStore = require('../services/networkStore');

describe('ownerReferralApp', () => {
  before(async () => {
    await dbService.saveWorkspace('ws_owner_ref_1', {
      id: 'ws_owner_ref_1',
      name: 'Bright Electric',
      slug: 'bright-electric',
      members: { 'pat@example.com': { role: 'owner' } },
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
        whiteLabel: { appName: 'Bright Electric Co' },
      },
      user: { displayName: 'Patrick', emails: [{ value: 'pat@example.com' }] },
      protocol: 'https',
      get: () => 'leads.adhello.io',
    };
    const first = await ensureOwnerReferralApp(req);
    assert.equal(first.member.id, OWNER_MEMBER_ID);
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
});
