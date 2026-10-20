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

    const rows = await memberGhlAlerts.listPendingForMember(owner, network, { now });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, 'missed_call');
    assert.match(rows[0].title, /T Munezero/);

    const off = await store.saveMember(NID, { ...owner, ghlAlertsEnabled: false });
    assert.equal((await memberGhlAlerts.listPendingForMember(off, network, { now })).length, 0);
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
