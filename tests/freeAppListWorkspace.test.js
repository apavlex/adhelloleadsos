/**
 * Reviews-app list upload → managed Agency OS workspace.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'free-app-list-ws-'));

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

const dbService = require('../services/database');
const store = require('../services/networkStore');
const freeAppSignup = require('../services/freeAppSignup');
const freeAppListWorkspace = require('../services/freeAppListWorkspace');

describe('freeAppListWorkspace', () => {
  let network;
  let member;

  before(async () => {
    await dbService.saveWorkspace('ws_list_agency', {
      id: 'ws_list_agency',
      name: 'AdHello Agency',
      slug: 'adhello-agency',
      ownerUserId: 'ops@adhello.io',
      members: { 'ops@adhello.io': { role: 'owner' } },
    });
    await dbService.saveWorkspaceSlug('adhello-agency', 'ws_list_agency');
    network = await store.getOrCreateNetworkForWorkspace('ws_list_agency', {
      name: 'AdHello',
      ownerEmail: 'ops@adhello.io',
    });
    member = await store.saveMember(network.id, {
      companyName: 'Camas Cabinets',
      contactName: 'Jordan',
      phone: '3605550100',
      email: 'jordan@camascabinets.example',
      status: 'active',
      plan: freeAppSignup.PLAN_APP_FREE,
      trialEndsAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      joinedAt: new Date().toISOString(),
      leadKey: 'lead:test_camas',
    });
  });

  it('skips non-free members', async () => {
    const partner = { ...member, plan: '', id: 'partner1' };
    const out = await freeAppListWorkspace.syncListUpload({
      network,
      member: partner,
      rows: [{ name: 'A', phone: '5035550111' }],
    });
    assert.equal(out.skipped, true);
    assert.equal(out.reason, 'not_free_app');
  });

  it('creates a managed workspace and imports the list as leads', async () => {
    const rows = [
      { name: 'Ann Lee', phone: '3605550101', email: 'ann@example.com', address: '1 Oak St', notes: 'VIP' },
      { name: 'Bob Builder', phone: '5035550199', email: 'bob@example.com' },
    ];
    const out = await freeAppListWorkspace.syncListUpload({ network, member, rows });
    assert.equal(out.skipped, undefined);
    assert.equal(out.created, true);
    assert.ok(out.workspaceId);
    assert.equal(out.member.managedWorkspaceId, out.workspaceId);
    assert.equal(out.imported.created, 2);
    assert.equal(out.imported.failed, 0);

    const ws = await dbService.getWorkspace(out.workspaceId);
    assert.equal(ws.name, 'Camas Cabinets');
    assert.equal(ws.fromReviewsAppList, true);
    assert.equal(ws.reviewsAppMemberId, member.id);
    assert.equal(ws.ownerUserId, 'ops@adhello.io');
    assert.ok(ws.reviewsAppListFolderKey);

    const ownerIds = await dbService.getUserWorkspaceIds('ops@adhello.io');
    assert.ok(ownerIds.includes(out.workspaceId));

    const leads = await dbService.getAllLeads(out.workspaceId);
    assert.equal(leads.length, 2);
    const ann = leads.find((l) => l.title === 'Ann Lee');
    assert.ok(ann);
    assert.equal(ann.folderKey, ws.reviewsAppListFolderKey);
    assert.equal(ann.source, freeAppListWorkspace.SOURCE);
    assert.match(String(ann.message || ''), /VIP/);

    member = out.member;
  });

  it('reuses the same workspace on a later upload and merges duplicates', async () => {
    const rows = [
      { name: 'Ann Lee', phone: '3605550101', email: 'ann@example.com', notes: 'VIP again' },
      { name: 'Chris Cook', phone: '9715550102', email: 'chris@example.com' },
    ];
    const out = await freeAppListWorkspace.syncListUpload({ network, member, rows });
    assert.equal(out.created, false);
    assert.equal(out.workspaceId, member.managedWorkspaceId);
    assert.ok(out.imported.merged >= 1);
    assert.ok(out.imported.created >= 1);

    const leads = await dbService.getAllLeads(out.workspaceId);
    assert.equal(leads.length, 3);
  });
});
