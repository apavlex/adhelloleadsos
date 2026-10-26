const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ghl-form-lead-sync-'));

const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');
const ghlClient = require('../services/ghlClient');
const workspaceIntegrations = require('../services/workspaceIntegrations');
const ghlFormLeadSync = require('../services/ghlFormLeadSync');
const memberGhlAlerts = require('../services/memberGhlAlerts');
const store = require('../services/networkStore');
const { pendingInboundItems } = require('../services/inboundEvents');

const WID = 'ws_form_sync';
const NID = 'net_form_sync';

describe('ghlFormLeadSync', () => {
  beforeEach(async () => {
    mock.restoreAll();
    await dbService.saveWorkspace(WID, {
      id: WID,
      name: 'Form Sync',
      ownerUserId: 'owner@example.com',
      members: [{ email: 'owner@example.com', role: 'admin' }],
    });
    const leads = await dbService.listLeads(WID).catch(() => []);
    for (const lead of leads || []) {
      await dbService.deleteLead(lead.key || lead.id);
    }
    dbService.deleteKvSync(`ghlFormLeadSync:${WID}`);
  });

  it('looksLikeWebsiteForm accepts blank and form-like sources', () => {
    assert.equal(ghlFormLeadSync.looksLikeWebsiteForm({}), true);
    assert.equal(ghlFormLeadSync.looksLikeWebsiteForm({ source: 'Website' }), true);
    assert.equal(ghlFormLeadSync.looksLikeWebsiteForm({ source: 'Facebook Lead Form' }), true);
    assert.equal(ghlFormLeadSync.looksLikeWebsiteForm({ source: 'Manual import' }), false);
  });

  it('syncRecentFormLeads stamps form inbound + notifies for new GHL contacts', async () => {
    mock.method(workspaceIntegrations, 'getResolvedIntegrationEnv', async () => ({
      GHL_API_KEY: 'key',
      GHL_LOCATION_ID: 'loc_tpr',
    }));
    mock.method(ghlClient, 'isConfigured', () => true);
    const added = new Date().toISOString();
    mock.method(ghlClient, 'listContacts', async () => ({
      contacts: [
        {
          id: 'ghl_form_casey',
          name: 'Casey Buyer',
          firstName: 'Casey',
          lastName: 'Buyer',
          phone: '+15550003333',
          email: 'casey@buyers.test',
          source: 'Website',
          dateAdded: added,
        },
      ],
    }));

    const pushes = [];
    mock.method(memberGhlAlerts, 'notifyEnabledMembers', async (args) => {
      pushes.push(args);
      return { sent: 0, members: 0 };
    });
    // notifyInboundEvent calls memberGhlAlerts — also stub push path via inboundPush
    const inboundPush = require('../services/inboundPush');
    const originals = inboundPush.notifyInboundEvent;
    mock.method(inboundPush, 'notifyInboundEvent', (args) => {
      pushes.push(args);
      return originals(args);
    });

    const result = await ghlFormLeadSync.syncRecentFormLeads(WID, { force: true });
    assert.ok(result.synced >= 1);
    assert.ok(result.notified >= 1);

    const leads = await dbService.getAllLeads(WID);
    assert.ok(leads.some((l) => /Casey/i.test(l.title || '')));
    const rows = pendingInboundItems(leads);
    assert.ok(rows.some((r) => r.type === 'form' && /Casey/i.test(r.title)));
    assert.ok(pushes.some((p) => p && p.event && p.event.type === 'form'));
  });

  it('does not re-notify the same GHL contact twice', async () => {
    mock.method(workspaceIntegrations, 'getResolvedIntegrationEnv', async () => ({
      GHL_API_KEY: 'key',
      GHL_LOCATION_ID: 'loc_tpr',
    }));
    mock.method(ghlClient, 'isConfigured', () => true);
    const contact = {
      id: 'ghl_form_dup',
      name: 'Dup Lead',
      phone: '+15550004444',
      source: 'Website',
      dateAdded: new Date().toISOString(),
    };
    mock.method(ghlClient, 'listContacts', async () => ({ contacts: [contact] }));

    const first = await ghlFormLeadSync.syncRecentFormLeads(WID, { force: true });
    assert.equal(first.synced, 1);
    const second = await ghlFormLeadSync.syncRecentFormLeads(WID, { force: true });
    assert.equal(second.synced, 0);
    assert.equal(second.notified, 0);
  });

  it('listPendingForMember surfaces pulled form leads for network partners', async () => {
    mock.method(workspaceIntegrations, 'getResolvedIntegrationEnv', async () => ({
      GHL_API_KEY: 'key',
      GHL_LOCATION_ID: 'loc_tpr',
    }));
    mock.method(ghlClient, 'isConfigured', () => true);
    mock.method(ghlClient, 'listContacts', async () => ({
      contacts: [
        {
          id: 'ghl_form_pat',
          name: 'Pat Form',
          phone: '+15550005555',
          source: 'Lead Connector Form',
          dateAdded: new Date().toISOString(),
        },
      ],
    }));

    await store.saveNetwork({
      id: NID,
      name: 'TPR Net',
      ownerWorkspaceId: WID,
      ownerEmail: 'owner@example.com',
    });
    await dbService.putStorageKey(`wsnetwork:${WID}`, { networkId: NID, role: 'operator' });
    const partner = await store.saveMember(NID, {
      id: 'partner',
      companyName: 'Partner Floors',
      email: 'partner@example.com',
      status: 'active',
    });
    const network = await store.getNetwork(NID);

    const rows = await memberGhlAlerts.listPendingForMember(partner, network, { forceFormSync: true });
    assert.ok(rows.some((r) => r.kind === 'form' && /Pat Form/i.test(r.title)));
  });
});
