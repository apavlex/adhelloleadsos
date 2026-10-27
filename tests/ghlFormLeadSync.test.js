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

  it('scheduler runs form lead sync every 2 minutes without opening the app', () => {
    const sched = fs.readFileSync(path.join(__dirname, '../services/scheduler.js'), 'utf8');
    assert.match(sched, /ghlFormLeadSync'\)\.syncAllWorkspaces/);
    assert.match(sched, /GHL form lead sync failed/);
    const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    assert.match(server, /\/api\/cron\/form-lead-sync/);
  });

  it('syncRecentFormLeads stamps form inbound + notifies for new GHL contacts', async () => {
    mock.method(workspaceIntegrations, 'getResolvedIntegrationEnv', async () => ({
      GHL_API_KEY: 'key',
      GHL_LOCATION_ID: 'loc_tpr',
    }));
    mock.method(ghlClient, 'isConfigured', () => true);
    mock.method(ghlClient, 'listLocationContactCustomFields', async () => ([
      { id: 'cf_need', name: 'What do you need?' },
    ]));
    mock.method(ghlClient, 'listFormSubmissions', async () => ({ submissions: [] }));
    const added = new Date().toISOString();
    const casey = {
      id: 'ghl_form_casey',
      name: 'Casey Buyer',
      firstName: 'Casey',
      lastName: 'Buyer',
      phone: '+15550003333',
      email: 'casey@buyers.test',
      source: 'Website',
      dateAdded: added,
      customFields: [{ id: 'cf_need', value: 'New floors' }],
    };
    mock.method(ghlClient, 'listContacts', async () => ({ contacts: [casey] }));
    mock.method(ghlClient, 'getContact', async () => casey);

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
    const caseyLead = leads.find((l) => /Casey/i.test(l.title || ''));
    assert.ok(caseyLead);
    assert.ok(Array.isArray(caseyLead.formAnswers) && caseyLead.formAnswers.some((a) => /New floors/i.test(a.a)));
    const rows = pendingInboundItems(leads);
    assert.ok(rows.some((r) => r.type === 'form' && /Casey/i.test(r.title) && Array.isArray(r.answers) && r.answers.length));
    assert.ok(pushes.some((p) => p && p.event && p.event.type === 'form' && Array.isArray(p.event.answers)));
  });

  it('does not re-notify the same GHL contact twice', async () => {
    mock.method(workspaceIntegrations, 'getResolvedIntegrationEnv', async () => ({
      GHL_API_KEY: 'key',
      GHL_LOCATION_ID: 'loc_tpr',
    }));
    mock.method(ghlClient, 'isConfigured', () => true);
    mock.method(ghlClient, 'listLocationContactCustomFields', async () => []);
    mock.method(ghlClient, 'listFormSubmissions', async () => ({ submissions: [] }));
    const contact = {
      id: 'ghl_form_dup',
      name: 'Dup Lead',
      phone: '+15550004444',
      source: 'Website',
      dateAdded: new Date().toISOString(),
    };
    mock.method(ghlClient, 'listContacts', async () => ({ contacts: [contact] }));
    mock.method(ghlClient, 'getContact', async () => contact);

    const first = await ghlFormLeadSync.syncRecentFormLeads(WID, { force: true });
    assert.equal(first.synced, 1);
    const second = await ghlFormLeadSync.syncRecentFormLeads(WID, { force: true });
    assert.equal(second.synced, 0);
    assert.equal(second.notified, 0);
  });

  it('notifies again when the same contact submits a new form (Alex Pavlenko re-fill)', async () => {
    mock.method(workspaceIntegrations, 'getResolvedIntegrationEnv', async () => ({
      GHL_API_KEY: 'key',
      GHL_LOCATION_ID: 'loc_tpr',
    }));
    mock.method(ghlClient, 'isConfigured', () => true);
    mock.method(ghlClient, 'listLocationContactCustomFields', async () => []);

    const contact = {
      id: 'ghl_alex',
      name: 'Alex',
      phone: '+13608726483',
      email: 'alex@adhelo.io',
      source: 'ai_studio',
      dateAdded: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    };
    // First sync: contact-only (no submissions API rows yet).
    mock.method(ghlClient, 'listFormSubmissions', async () => ({ submissions: [] }));
    mock.method(ghlClient, 'listContacts', async () => ({
      contacts: [{ ...contact, dateAdded: new Date().toISOString() }],
    }));
    mock.method(ghlClient, 'getContact', async () => contact);

    const first = await ghlFormLeadSync.syncRecentFormLeads(WID, { force: true });
    assert.equal(first.notified, 1);

    // Age the first form stamp + notify claim so the re-fill is not treated as a
    // ContactCreate race (dedupe window is 2 minutes for first-fill doubles).
    const afterFirst = await dbService.getAllLeads(WID);
    const alexLead = afterFirst.find((l) => l.ghlContactId === 'ghl_alex');
    assert.ok(alexLead);
    const agedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const agedEvents = (alexLead.inboundEvents || []).map((e) => (
      e && e.id === 'form:ghl-contact:ghl_alex' ? { ...e, at: agedAt } : e
    ));
    await dbService.updateLead(alexLead.key, { inboundEvents: agedEvents, inboundHandledAt: agedAt }, WID);
    dbService.setKvSync(`formLeadNotify:${WID}:ghl_alex`, { at: Date.now() - 10 * 60 * 1000 });

    // Re-fill: same GHL contact, new submission id, fuller name.
    mock.method(ghlClient, 'listFormSubmissions', async () => ({
      submissions: [{
        id: 'sub_alex_2',
        contactId: 'ghl_alex',
        name: 'Alex Pavlenko',
        email: 'alex@adhelo.io',
        phone: '+13608726483',
        createdAt: new Date().toISOString(),
        others: { project_interest: 'Hardwood Collection' },
      }],
    }));
    mock.method(ghlClient, 'listContacts', async () => ({
      contacts: [{ ...contact, name: 'Alex Pavlenko' }],
    }));
    mock.method(ghlClient, 'getContact', async () => ({ ...contact, name: 'Alex Pavlenko' }));

    const second = await ghlFormLeadSync.syncRecentFormLeads(WID, { force: true });
    assert.equal(second.synced, 1);
    assert.equal(second.notified, 1);

    const leads = await dbService.getAllLeads(WID);
    const lead = leads.find((l) => l.ghlContactId === 'ghl_alex');
    assert.ok(lead);
    assert.match(String(lead.title || ''), /Pavlenko/i);
    const events = Array.isArray(lead.inboundEvents) ? lead.inboundEvents : [];
    assert.ok(events.some((e) => e && e.id === 'form:ghl-contact:ghl_alex'));
    assert.ok(events.some((e) => e && e.id === 'form:ghl-sub:sub_alex_2'));
    const rows = pendingInboundItems(leads);
    assert.ok(rows.some((r) => r.type === 'form' && /Pavlenko/i.test(r.title)));
  });

  it('retouches a known form lead when submissions are empty and contact falls off listContacts', async () => {
    mock.method(workspaceIntegrations, 'getResolvedIntegrationEnv', async () => ({
      GHL_API_KEY: 'key',
      GHL_LOCATION_ID: 'loc_tpr',
    }));
    mock.method(ghlClient, 'isConfigured', () => true);
    mock.method(ghlClient, 'listLocationContactCustomFields', async () => []);
    mock.method(ghlClient, 'listFormSubmissions', async () => ({ submissions: [] }));

    const added = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const contact = {
      id: 'ghl_alex_touch',
      name: 'Alex',
      phone: '+13608726483',
      email: 'alex@adhelo.io',
      source: 'ai_studio',
      dateAdded: added,
      dateUpdated: added,
    };
    mock.method(ghlClient, 'listContacts', async () => ({ contacts: [{ ...contact }] }));
    mock.method(ghlClient, 'getContact', async () => contact);

    const first = await ghlFormLeadSync.syncRecentFormLeads(WID, { force: true });
    assert.equal(first.notified, 1);

    const afterFirst = await dbService.getAllLeads(WID);
    const alexLead = afterFirst.find((l) => l.ghlContactId === 'ghl_alex_touch');
    assert.ok(alexLead);
    const agedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const agedEvents = (alexLead.inboundEvents || []).map((e) => (
      e && e.id === 'form:ghl-contact:ghl_alex_touch' ? { ...e, at: agedAt } : e
    ));
    await dbService.updateLead(alexLead.key, { inboundEvents: agedEvents, inboundHandledAt: agedAt }, WID);
    dbService.setKvSync(`formLeadNotify:${WID}:ghl_alex_touch`, { at: Date.now() - 20 * 60 * 1000 });

    // Re-fill: submissions API empty, contact no longer on the first listContacts page.
    const updatedAt = new Date().toISOString();
    mock.method(ghlClient, 'listContacts', async () => ({ contacts: [] }));
    mock.method(ghlClient, 'getContact', async () => ({
      ...contact,
      name: 'Alex Pavlenko',
      dateUpdated: updatedAt,
    }));

    const second = await ghlFormLeadSync.syncRecentFormLeads(WID, { force: true });
    assert.equal(second.synced, 1);
    assert.equal(second.notified, 1);

    const leads = await dbService.getAllLeads(WID);
    const lead = leads.find((l) => l.ghlContactId === 'ghl_alex_touch');
    assert.ok(lead);
    assert.match(String(lead.title || ''), /Pavlenko/i);
    const events = Array.isArray(lead.inboundEvents) ? lead.inboundEvents : [];
    assert.ok(events.some((e) => e && String(e.id || '').startsWith('form:ghl-touch:ghl_alex_touch:')));
  });

  it('does not phone-notify historical GHL contacts older than the notify window', async () => {
    mock.method(workspaceIntegrations, 'getResolvedIntegrationEnv', async () => ({
      GHL_API_KEY: 'key',
      GHL_LOCATION_ID: 'loc_tpr',
    }));
    mock.method(ghlClient, 'isConfigured', () => true);
    mock.method(ghlClient, 'listLocationContactCustomFields', async () => []);
    mock.method(ghlClient, 'listFormSubmissions', async () => ({ submissions: [] }));
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    mock.method(ghlClient, 'listContacts', async () => ({
      contacts: [
        {
          id: 'ghl_old_kim',
          name: 'Kim Hamilton',
          phone: '+15550006666',
          source: 'Website',
          dateAdded: threeDaysAgo,
        },
      ],
    }));
    mock.method(ghlClient, 'getContact', async () => null);
    const result = await ghlFormLeadSync.syncRecentFormLeads(WID, {
      force: true,
      notifyMaxAgeMs: 2 * 60 * 60 * 1000,
    });
    assert.equal(result.synced, 0);
    assert.equal(result.notified, 0);
  });

  it('still notifies a form contact that lagged behind the first listContacts pull', async () => {
    mock.method(workspaceIntegrations, 'getResolvedIntegrationEnv', async () => ({
      GHL_API_KEY: 'key',
      GHL_LOCATION_ID: 'loc_tpr',
    }));
    mock.method(ghlClient, 'isConfigured', () => true);

    mock.method(ghlClient, 'listLocationContactCustomFields', async () => []);
    mock.method(ghlClient, 'listFormSubmissions', async () => ({ submissions: [] }));
    // First sync: GHL has not indexed the new form contact yet.
    mock.method(ghlClient, 'listContacts', async () => ({ contacts: [] }));
    const first = await ghlFormLeadSync.syncRecentFormLeads(WID, { force: true });
    assert.equal(first.synced, 0);
    assert.equal(first.notified, 0);

    // Contact was created ~10 minutes ago (before first sync's wall clock), but
    // only appears now. Prior bug: watermark jumped to now-5s and skipped it.
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const lagged = {
      id: 'ghl_form_lagged',
      name: 'Lagged Form Lead',
      phone: '+15550007777',
      email: 'lagged@buyers.test',
      source: 'Website',
      dateAdded: tenMinutesAgo,
    };
    mock.method(ghlClient, 'listContacts', async () => ({ contacts: [lagged] }));
    mock.method(ghlClient, 'getContact', async () => lagged);

    const second = await ghlFormLeadSync.syncRecentFormLeads(WID, {
      force: true,
      notifyMaxAgeMs: 2 * 60 * 60 * 1000,
    });
    assert.equal(second.synced, 1);
    assert.equal(second.notified, 1);

    const leads = await dbService.getAllLeads(WID);
    const row = leads.find((l) => /Lagged Form/i.test(l.title || ''));
    assert.ok(row);
    const events = Array.isArray(row.inboundEvents) ? row.inboundEvents : [];
    assert.ok(events.some((e) => e && e.id === 'form:ghl-contact:ghl_form_lagged'));
  });

  it('re-opens Waiting on a reply when a new form is stamped after Done', async () => {
    mock.method(workspaceIntegrations, 'getResolvedIntegrationEnv', async () => ({
      GHL_API_KEY: 'key',
      GHL_LOCATION_ID: 'loc_tpr',
    }));
    mock.method(ghlClient, 'isConfigured', () => true);
    mock.method(ghlClient, 'listLocationContactCustomFields', async () => []);
    mock.method(ghlClient, 'listFormSubmissions', async () => ({ submissions: [] }));

    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const contact = {
      id: 'ghl_form_reopen',
      name: 'Reopen Form',
      phone: '+15550008888',
      source: 'Website',
      dateAdded: tenMinutesAgo,
    };
    mock.method(ghlClient, 'listContacts', async () => ({ contacts: [contact] }));
    mock.method(ghlClient, 'getContact', async () => contact);

    // Prior Done left the lead handled; dateAdded is older than that stamp.
    await dbService.saveLead({
      key: 'lead:reopen',
      workspaceId: WID,
      title: 'Reopen Form',
      phone: '+15550008888',
      ghlContactId: 'ghl_form_reopen',
      inboundHandledAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
      inboundEvents: [],
    }, WID);

    const result = await ghlFormLeadSync.syncRecentFormLeads(WID, { force: true });
    assert.equal(result.synced, 1);
    assert.equal(result.notified, 1);

    const leads = await dbService.getAllLeads(WID);
    const lead = leads.find((l) => l.ghlContactId === 'ghl_form_reopen');
    assert.ok(lead);
    assert.equal(String(lead.inboundHandledAt || ''), '');
    const rows = pendingInboundItems(leads);
    assert.ok(rows.some((r) => r.type === 'form' && /Reopen/i.test(r.title)));
  });

  it('syncAllWorkspaces pulls form leads without opening the Reviews bell', async () => {
    mock.method(workspaceIntegrations, 'getResolvedIntegrationEnv', async (wid) => (
      wid === WID
        ? { GHL_API_KEY: 'key', GHL_LOCATION_ID: 'loc_tpr' }
        : { DEMO_WORKSPACE: true }
    ));
    mock.method(ghlClient, 'isConfigured', (env) => !!(env && env.GHL_API_KEY));
    mock.method(ghlClient, 'listLocationContactCustomFields', async () => []);
    mock.method(ghlClient, 'listFormSubmissions', async () => ({
      submissions: [{
        id: 'sub_bg_1',
        contactId: 'ghl_bg_alex',
        name: 'Alex Background',
        phone: '+15550006666',
        createdAt: new Date().toISOString(),
      }],
    }));
    mock.method(ghlClient, 'listContacts', async () => ({ contacts: [] }));
    mock.method(ghlClient, 'getContact', async () => ({
      id: 'ghl_bg_alex',
      name: 'Alex Background',
      phone: '+15550006666',
      source: 'Website',
      dateAdded: new Date().toISOString(),
    }));

    await store.saveNetwork({
      id: NID,
      name: 'TPR Net',
      ownerWorkspaceId: WID,
      ownerEmail: 'owner@example.com',
    });
    await dbService.putStorageKey(`wsnetwork:${WID}`, { networkId: NID, role: 'operator' });

    const out = await ghlFormLeadSync.syncAllWorkspaces({ force: true });
    assert.equal(out.skipped, undefined);
    const row = (out.results || []).find((r) => r.workspaceId === WID);
    assert.ok(row);
    assert.equal(row.synced, 1);
    assert.equal(row.notified, 1);

    const leads = await dbService.getAllLeads(WID);
    assert.ok(leads.some((l) => l.ghlContactId === 'ghl_bg_alex'));
  });

  it('listPendingForMember surfaces pulled form leads for network partners', async () => {
    mock.method(workspaceIntegrations, 'getResolvedIntegrationEnv', async () => ({
      GHL_API_KEY: 'key',
      GHL_LOCATION_ID: 'loc_tpr',
    }));
    mock.method(ghlClient, 'isConfigured', () => true);
    mock.method(ghlClient, 'listLocationContactCustomFields', async () => []);
    mock.method(ghlClient, 'listFormSubmissions', async () => ({ submissions: [] }));
    const pat = {
      id: 'ghl_form_pat',
      name: 'Pat Form',
      phone: '+15550005555',
      source: 'Lead Connector Form',
      dateAdded: new Date().toISOString(),
    };
    mock.method(ghlClient, 'listContacts', async () => ({ contacts: [pat] }));
    mock.method(ghlClient, 'getContact', async () => pat);

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
