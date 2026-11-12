/**
 * Workspace owner + staff share one customer/lead book; attribution on changes.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'team-shared-leads-'));

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');
const store = require('../services/networkStore');
const work = require('../services/memberWork');
const memberGhlAlerts = require('../services/memberGhlAlerts');

const WID = 'ws_team_shared_leads';
const NID = 'net_team_shared_leads';

describe('team shared leads book', () => {
  beforeEach(async () => {
    await dbService.saveWorkspace(WID, {
      id: WID,
      name: 'TPR Flooring',
      ownerUserId: 'alex@example.com',
      members: [{ email: 'alex@example.com', role: 'admin' }],
    });
    await store.saveNetwork({
      id: NID,
      name: 'TPR Flooring network',
      ownerWorkspaceId: WID,
      ownerEmail: 'alex@example.com',
    });
    await dbService.putStorageKey(`wsnetwork:${WID}`, { networkId: NID, role: 'operator' });
    for (const mid of ['owner', 'staff_greg']) {
      const rows = await work.listCustomers(NID, mid);
      for (const c of rows) await work.deleteCustomer(NID, mid, c.id);
    }
    for (const lead of await dbService.listLeads(WID)) {
      await dbService.deleteLead(lead.key || lead.id);
    }
  });

  it('teamBookMemberId routes staff onto the owner book', () => {
    const network = { id: NID, ownerEmail: 'alex@example.com', ownerWorkspaceId: WID };
    assert.equal(work.teamBookMemberId(network, { id: 'owner' }), 'owner');
    assert.equal(
      work.teamBookMemberId(network, { id: 'staff_greg', workspaceStaff: true }),
      'owner',
    );
    assert.equal(
      work.teamBookMemberId(network, { id: 'partner1', email: 'pat@example.com' }),
      'partner1',
    );
  });

  it('staff and owner see the same inbound call/SMS lead', async () => {
    const network = await store.getNetwork(NID);
    const owner = await store.saveMember(NID, {
      id: 'owner',
      companyName: 'TPR Flooring',
      contactName: 'Alex',
      email: 'alex@example.com',
      ghlAlertsEnabled: true,
    });
    const staff = await store.saveMember(NID, {
      id: 'staff_greg',
      companyName: 'TPR Flooring',
      contactName: 'Greg',
      email: 'greg@tprflooring.com',
      workspaceStaff: true,
      ghlAlertsEnabled: true,
    });

    const now = Date.parse('2026-11-10T12:00:00.000Z');
    await dbService.saveLead({
      key: 'lead:shared_sms',
      workspaceId: WID,
      title: 'Shared Texter',
      phone: '+15557654321',
      ghlContactId: 'ghl_shared_1',
      inboundEvents: [
        { id: 's1', type: 'sms', at: '2026-11-10T11:00:00.000Z', preview: 'Need flooring' },
      ],
    });

    const ownerRows = await memberGhlAlerts.listPendingForMember(owner, network, { now });
    assert.equal(ownerRows.length, 1);
    assert.ok(ownerRows[0].customerId);

    const staffRows = await memberGhlAlerts.listPendingForMember(staff, network, { now });
    assert.equal(staffRows.length, 1);
    assert.equal(staffRows[0].customerId, ownerRows[0].customerId);

    const ownerBook = await work.listContactLeads(NID, 'owner');
    const staffBook = await work.listContactLeads(NID, work.teamBookMemberId(network, staff));
    assert.equal(ownerBook.length, 1);
    assert.equal(staffBook.length, 1);
    assert.equal(ownerBook[0].id, staffBook[0].id);
    assert.equal(ownerBook[0].isLead, true);
  });

  it('mark as customer stamps teammate name for the shared profile', async () => {
    const network = await store.getNetwork(NID);
    await store.saveMember(NID, {
      id: 'owner',
      contactName: 'Alex',
      email: 'alex@example.com',
    });
    const staff = await store.saveMember(NID, {
      id: 'staff_greg',
      contactName: 'Greg',
      email: 'greg@tprflooring.com',
      workspaceStaff: true,
    });
    const bookId = work.teamBookMemberId(network, staff);
    const saved = await work.saveCustomer(
      NID,
      bookId,
      { name: 'Lead Contact', phone: '+15550001111' },
      { source: 'ghl' },
    );
    assert.equal(saved.ok, true);
    await work.setCustomerLeadFlag(NID, bookId, saved.customer.id, true);

    const marked = await work.setCustomerKind(NID, bookId, saved.customer.id, 'customer', {
      removeFromLeads: true,
      touchedByMemberId: staff.id,
      touchedByName: work.memberAddedByLabel(staff),
      touchedAction: 'marked_customer',
    });
    assert.equal(marked.ok, true);
    assert.equal(marked.customer.isLead, false);
    assert.equal(marked.customer.lastTouchedByName, 'Greg');
    assert.equal(marked.customer.lastTouchedAction, 'marked_customer');

    const page = fs.readFileSync(path.join(__dirname, '../views/member_app/customer.ejs'), 'utf8');
    assert.match(page, /data-ma-last-touched/);
    assert.match(page, /Marked as customer by/);
    assert.match(page, /Delete <%= customer\.isLead \? 'lead' : 'customer' %>/);

    const route = fs.readFileSync(path.join(__dirname, '../routes/memberApp.js'), 'utf8');
    assert.match(route, /bookMemberId/);
    assert.match(route, /teamBookMemberId/);
    assert.match(route, /touchedByName: actorName/);
  });

  it('loadContext always sets bookMemberId so Home does not throw invalid scope', async () => {
    const route = fs.readFileSync(path.join(__dirname, '../routes/memberApp.js'), 'utf8');
    const loadStart = route.indexOf('async function loadContext(token)');
    const loadEnd = route.indexOf('async function maybeEnsureDemoOwnerReviewApp');
    assert.ok(loadStart >= 0 && loadEnd > loadStart, 'loadContext present');
    const loadBody = route.slice(loadStart, loadEnd);
    assert.match(loadBody, /bookMemberId\s*=\s*work\.teamBookMemberId\(network,\s*member\)/);
    assert.match(loadBody, /bookMemberId,/);
    // Regression: listing with undefined memberId throws and surfaces as Link unavailable.
    await assert.rejects(
      () => work.listCustomers(NID, undefined),
      /invalid scope/,
    );
  });
});
