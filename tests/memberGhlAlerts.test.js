/**
 * Reviews-app optional GHL missed-call / text alerts (toggle + feed).
 */
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'member-ghl-alerts-'));

const root = path.join(__dirname, '..');
const dbService = require('../services/database');
const store = require('../services/networkStore');
const memberGhlAlerts = require('../services/memberGhlAlerts');
const memberActivity = require('../services/memberActivity');

const WID = 'ws_member_ghl_test';
const NID = 'net_member_ghl_test';

describe('memberGhlAlerts', () => {
  beforeEach(async () => {
    await dbService.saveWorkspace(WID, {
      id: WID,
      name: 'Member GHL Test',
      ownerUserId: 'owner@example.com',
      members: [{ email: 'owner@example.com', role: 'admin' }],
    });
    await store.saveNetwork({
      id: NID,
      name: 'Test net',
      ownerWorkspaceId: WID,
      ownerEmail: 'owner@example.com',
    });
    await dbService.putStorageKey(`wsnetwork:${WID}`, { networkId: NID, role: 'operator' });
    dbService.deleteKvSync(`memberActivity:${NID}:owner`);
    dbService.deleteKvSync(`memberActivity:${NID}:partner`);

    // Isolate Open / ensureCustomer tests from leftover customers + inbound leads.
    const work = require('../services/memberWork');
    for (const memberId of ['owner', 'partner']) {
      const customers = await work.listCustomers(NID, memberId);
      for (const c of customers) {
        await work.deleteCustomer(NID, memberId, c.id);
      }
    }
    const leads = await dbService.listLeads(WID);
    for (const lead of leads) {
      await dbService.deleteLead(lead.key || lead.id);
    }
  });

  afterEach(async () => {
    try { await store.deleteMember(NID, { id: 'owner' }); } catch (_) { /* ignore */ }
    try { await store.deleteMember(NID, { id: 'partner' }); } catch (_) { /* ignore */ }
  });

  it('is off by default and only owners/staff can enable', async () => {
    const owner = await store.saveMember(NID, {
      id: 'owner',
      companyName: 'Owner Co',
      email: 'owner@example.com',
    });
    const partner = await store.saveMember(NID, {
      id: 'partner',
      companyName: 'Partner Co',
      email: 'partner@example.com',
    });
    const network = await store.getNetwork(NID);

    assert.equal(memberGhlAlerts.isEnabled(owner), false);
    assert.equal(memberGhlAlerts.canUseGhlAlerts(owner, network), true);
    assert.equal(memberGhlAlerts.canUseGhlAlerts(partner, network), false);

    const denied = await memberGhlAlerts.setEnabled(network, partner, true);
    assert.equal(denied.ok, false);

    const ok = await memberGhlAlerts.setEnabled(network, owner, true);
    assert.equal(ok.ok, true);
    assert.equal(ok.enabled, true);
    assert.equal(memberGhlAlerts.isEnabled(ok.member), true);
  });

  it('lists pending GHL calls/texts only when enabled', async () => {
    const network = await store.getNetwork(NID);
    const owner = await store.saveMember(NID, {
      id: 'owner',
      companyName: 'Owner Co',
      email: 'owner@example.com',
      ghlAlertsEnabled: true,
    });
    const now = Date.parse('2026-10-19T12:00:00.000Z');
    await dbService.saveLead({
      key: 'lead:ghl1',
      workspaceId: WID,
      title: 'T Munezero',
      phone: '+15551112222',
      ghlContactId: 'ghl_contact_tm',
      inboundEvents: [
        {
          id: 'm1',
          type: 'missed_call',
          at: '2026-10-19T11:57:00.000Z',
          label: 'New caller',
        },
      ],
    });
    await dbService.saveLead({
      key: 'lead:form1',
      workspaceId: WID,
      title: 'Form Lead',
      inboundEvents: [
        { id: 'f1', type: 'form', at: '2026-10-19T11:50:00.000Z', label: 'Website' },
      ],
    });

    const work = require('../services/memberWork');
    const saved = await work.saveCustomer(NID, 'owner', {
      name: 'T Munezero',
      phone: '+15551112222',
    }, { ghlContactId: 'ghl_contact_tm', source: 'ghl' });
    assert.equal(saved.ok, true);

    const rows = await memberGhlAlerts.listPendingForMember(owner, network, { now });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, 'missed_call');
    assert.match(rows[0].title, /T Munezero/);
    assert.equal(rows[0].customerId, saved.customer.id);
    assert.equal(rows[0].openHref, `/customers/c/${encodeURIComponent(saved.customer.id)}`);
    assert.doesNotMatch(rows[0].openHref, /gohighlevel|leadconnector|\/focus|\/pipeline/i);

    const off = await store.saveMember(NID, { ...owner, ghlAlertsEnabled: false });
    assert.equal((await memberGhlAlerts.listPendingForMember(off, network, { now })).length, 0);
  });

  it('Open creates an in-app customer for unmatched GHL inbound (never CRM focus/pipeline)', async () => {
    const network = await store.getNetwork(NID);
    const owner = await store.saveMember(NID, {
      id: 'owner',
      companyName: 'Owner Co',
      email: 'owner@example.com',
      ghlAlertsEnabled: true,
    });
    const now = Date.parse('2026-10-19T12:00:00.000Z');
    await dbService.saveLead({
      key: 'lead:emailonly',
      workspaceId: WID,
      title: 'ismaelbonilla096@gmail.com',
      email: 'ismaelbonilla096@gmail.com',
      ghlContactId: 'ghl_email_only',
      inboundEvents: [
        {
          id: 's1',
          type: 'sms',
          at: '2026-10-19T11:10:00.000Z',
          label: 'Reply to missed-call text',
          preview: 'Ok',
        },
      ],
    });

    const work = require('../services/memberWork');
    assert.equal((await work.listCustomers(NID, 'owner')).length, 0);

    const rows = await memberGhlAlerts.listPendingForMember(owner, network, { now });
    assert.equal(rows.length, 1);
    assert.ok(rows[0].customerId);
    assert.match(rows[0].openHref, /^\/customers\/c\//);
    assert.doesNotMatch(rows[0].openHref, /\/focus|\/pipeline|gohighlevel|leadconnector|https?:/i);

    const customers = await work.listCustomers(NID, 'owner');
    assert.equal(customers.length, 1);
    assert.equal(customers[0].id, rows[0].customerId);
    assert.equal(customers[0].ghlContactId, 'ghl_email_only');
  });

  it('Open patches ghlContactId onto an existing phone-matched customer', async () => {
    const network = await store.getNetwork(NID);
    const owner = await store.saveMember(NID, {
      id: 'owner',
      companyName: 'Owner Co',
      email: 'owner@example.com',
      ghlAlertsEnabled: true,
    });
    const work = require('../services/memberWork');
    const prior = await work.saveCustomer(NID, 'owner', {
      name: 'C Hattenhauer',
      phone: '+15559876543',
    });
    assert.equal(prior.ok, true);
    assert.equal(prior.customer.ghlContactId || '', '');

    const now = Date.parse('2026-10-19T12:00:00.000Z');
    await dbService.saveLead({
      key: 'lead:hatten',
      workspaceId: WID,
      title: 'C Hattenhauer',
      phone: '+15559876543',
      ghlContactId: 'ghl_hatten_1',
      inboundEvents: [
        {
          id: 's1',
          type: 'sms',
          at: '2026-10-19T11:10:00.000Z',
          preview: 'MSI Stella La Perla',
        },
      ],
    });

    const rows = await memberGhlAlerts.listPendingForMember(owner, network, { now });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].customerId, prior.customer.id);
    assert.equal(rows[0].customerId && (await work.getCustomer(NID, 'owner', rows[0].customerId)).ghlContactId, 'ghl_hatten_1');
  });

  it('notifyEnabledMembers records activity for opted-in owners', async () => {
    const network = await store.getNetwork(NID);
    await store.saveMember(NID, {
      id: 'owner',
      companyName: 'Owner Co',
      email: 'owner@example.com',
      ghlAlertsEnabled: true,
    });
    const lead = {
      key: 'lead:sms1',
      workspaceId: WID,
      title: 'Alex',
      phone: '+15553334444',
    };
    const result = await memberGhlAlerts.notifyEnabledMembers({
      workspaceId: WID,
      lead,
      event: { type: 'sms', preview: 'Can you come tomorrow?' },
    });
    assert.equal(result.members, 1);
    const items = memberActivity.list(NID, 'owner');
    assert.ok(items.some((i) => i.kind === 'sms' && /Alex/.test(i.title)));
    assert.ok(network);
  });

  it('UI and routes expose the GHL alerts toggle and hide GHL duplicates from Leads & referrals', () => {
    const top = fs.readFileSync(path.join(root, 'views/member_app/_top.ejs'), 'utf8');
    const js = fs.readFileSync(path.join(root, 'public/js/member-app-notifications.js'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'public/css/member-app.css'), 'utf8');
    const route = fs.readFileSync(path.join(root, 'routes/memberApp.js'), 'utf8');
    const push = fs.readFileSync(path.join(root, 'services/inboundPush.js'), 'utf8');

    assert.match(top, /data-ma-bell-ghl-toggle/);
    assert.match(top, /GHL calls &amp; texts/);
    assert.match(js, /activity\/ghl-alerts/);
    assert.match(js, /activity\/ghl-done/);
    assert.match(js, /ghlAlertsEnabled/);
    assert.match(js, /Waiting on a reply/);
    assert.match(js, /GHL_KINDS/);
    assert.match(js, /function ghlProfileHref/);
    assert.match(js, /ghlProfileHref\(item\)/);
    assert.match(js, /data-ma-bell-ghl-open/);
    // Open is the primary pill; Lead Connector / Call in LC match Done (text link).
    assert.match(js, /ma-bell__ghl-btn"[^>]*>Open</);
    assert.match(js, /ma-bell__ghl-link"[^>]*data-ma-no-nav-progress/);
    assert.match(js, /\/\?\(focus\|pipeline\|leads\|prospecting\)/);
    assert.doesNotMatch(js, /portalHref\(rawOpen\)/);
    assert.doesNotMatch(js, /ma-bell__ghl-btn"[^>]*data-ma-no-nav-progress/);
    assert.match(css, /\.ma-bell__ghl-row/);
    assert.match(route, /activity\/ghl-alerts/);
    assert.match(route, /activity\/ghl-done/);
    assert.match(route, /memberGhlAlerts/);
    assert.match(route, /excludeGhlKinds/);
    assert.match(route, /GHL_ACTIVITY_TYPES/);
    assert.match(push, /memberGhlAlerts/);
    assert.match(push, /notifyEnabledMembers/);
  });
});
