/**
 * Website/agency form leads land on Leads & Referrals; phone push + SMS deep-link there.
 * Network referrals also fire home-screen push when the partner has alerts on.
 */
const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const webpush = require('web-push');

const root = path.join(__dirname, '..');

describe('member leads + referral notifications', () => {
  beforeEach(() => {
    mock.restoreAll();
  });

  it('Leads & Referrals page renders website/agency form leads and lead alerts', () => {
    const page = fs.readFileSync(path.join(root, 'views/member_app/referrals.ejs'), 'utf8');
    const route = fs.readFileSync(path.join(root, 'routes/memberApp.js'), 'utf8');
    assert.match(page, /Website &amp; agency/);
    assert.match(page, /_formLeads\.forEach/);
    assert.match(page, /From contacts/);
    assert.match(page, /_contactLeads\.forEach/);
    assert.match(page, /maPushRoot/);
    assert.match(page, /member-app-push\.js/);
    assert.match(page, /leads\/<%= encodeURIComponent\(lead\.id\) %>\/close/);
    assert.match(page, /Send to a partner/);
    assert.match(page, /leads\/<%= encodeURIComponent\(lead\.id\) %>\/refer/);
    assert.match(route, /formLeads,/);
    assert.match(route, /contactLeads,/);
    assert.match(route, /listContactLeads/);
    assert.match(route, /openLeadCount:/);
    assert.match(route, /partnerDirectory/);
    assert.match(route, /appt \? \(appt\.formLeads \|\| \[\]\) : \[\]/);
    assert.match(route, /leads\/:leadId\/refer/);
    assert.match(route, /customers\/c\/:id\/mark-lead/);
    assert.match(route, /customers\/c\/:id\/unmark-lead/);
  });

  it('customer detail can mark a contact as a lead for the Leads folder', () => {
    const page = fs.readFileSync(path.join(root, 'views/member_app/customer.ejs'), 'utf8');
    const head = fs.readFileSync(path.join(root, 'views/member_app/_head.ejs'), 'utf8');
    const referrals = fs.readFileSync(path.join(root, 'views/member_app/referrals.ejs'), 'utf8');
    const customers = fs.readFileSync(path.join(root, 'views/member_app/customers.ejs'), 'utf8');
    const route = fs.readFileSync(path.join(root, 'routes/memberApp.js'), 'utf8');
    const work = fs.readFileSync(path.join(root, 'services/memberWork.js'), 'utf8');
    assert.match(page, /Mark as lead/);
    assert.match(page, /Mark as customer/);
    assert.match(page, /maMarkLeadForm/);
    assert.match(page, /ma-titlebar__actions/);
    assert.match(page, /form="maMarkLeadForm"/);
    assert.match(page, /ma-titlebar[\s\S]*Mark as lead/);
    assert.match(page, /mark-lead/);
    assert.match(page, /unmark-lead/);
    assert.doesNotMatch(page, /for="cuName"[\s\S]*Mark as lead/);
    assert.match(referrals, /Mark as customer/);
    assert.match(referrals, /mark-customer/);
    assert.match(referrals, /leads\/<%= encodeURIComponent\(lead\.id\) %>\/to-customer/);
    assert.match(customers, /Open Leads/);
    assert.match(customers, /showLeads/);
    assert.match(route, /customers\/c\/:id\/mark-customer/);
    assert.match(route, /leads\/:leadId\/to-customer/);
    assert.match(route, /marked_customer/);
    assert.match(route, /filter\(\(c\) => showLeads \|\| !c\.isLead\)/);
    // Field mics ship mic-only markup (no idle stop/spin squares).
    assert.doesNotMatch(page, /data-ma-voice-for="cuName"[\s\S]*?alex-voice-icon--stop/);
    assert.match(head, /alex-voice-icon--stop[\s\S]*display:none!important/);
    assert.match(work, /isLead: c\.isLead === true/);
    assert.match(work, /setCustomerLeadFlag/);
    assert.match(work, /listContactLeads/);
  });

  it('form-lead SMS and push deep-link to /referrals (not legacy /leads alone)', () => {
    const notify = fs.readFileSync(path.join(root, 'services/networkNotify.js'), 'utf8');
    const pkgs = fs.readFileSync(path.join(root, 'services/appointmentPackages.js'), 'utf8');
    assert.match(notify, /const leadsUrl = `\$\{app\}\/referrals`/);
    assert.doesNotMatch(notify, /const leadsUrl = `\$\{app\}\/leads`/);
    assert.match(pkgs, /notifyUrl = `\$\{memberUrl\}\/referrals`/);
    assert.match(pkgs, /attachFormLead/);
    assert.match(pkgs, /notifyContractorNewLead/);
    assert.match(pkgs, /notifyMemberFormLead/);
  });

  it('pushMemberReferralAlert sends a phone popup to the linked package subscription', async () => {
    const push = require('../services/pushNotifications');
    const memberAppointmentLink = require('../services/memberAppointmentLink');
    const networkNotify = require('../services/networkNotify');

    push.savePortalSubscription({
      subscription: {
        endpoint: 'https://push.example.com/send/member-ref-1',
        keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
      },
      workspaceId: 'ws_ref',
      packageId: 'pkg_ref',
    });

    mock.method(memberAppointmentLink, 'findPackageForMember', async () => ({
      id: 'pkg_ref',
      portalEnabled: true,
      businessName: 'Cascade Home Pros',
    }));

    const sent = [];
    mock.method(webpush, 'sendNotification', async (sub, body) => {
      sent.push({ endpoint: sub.endpoint, body: JSON.parse(body) });
    });

    const result = await networkNotify.pushMemberReferralAlert({
      network: { id: 'net1', name: 'Demo Network', ownerWorkspaceId: 'ws_ref' },
      member: { id: 'm1', companyName: 'Cascade Home Pros' },
      baseUrl: 'https://leads.adhello.io',
      referral: { id: 'ref1', tradeSlug: 'handyman', homeowner: { name: 'Taylor', city: 'Vancouver' } },
      kind: 'received',
    });

    assert.equal(result.sent, 1);
    assert.match(sent[0].body.title, /New referral/i);
    assert.match(sent[0].body.url, /\/referrals/);
    assert.doesNotMatch(sent[0].body.url, /\/leads$/);
  });

  it('notifyReferralRecipient wires push alongside SMS/email', () => {
    const notify = fs.readFileSync(path.join(root, 'services/networkNotify.js'), 'utf8');
    assert.match(notify, /async function notifyReferralRecipient/);
    assert.match(notify, /pushMemberReferralAlert/);
    assert.match(notify, /kind:\s*'received'/);
    assert.match(notify, /kind:\s*'pool'/);
  });

  it('records in-app bell activity for form leads and referrals', () => {
    const notify = fs.readFileSync(path.join(root, 'services/networkNotify.js'), 'utf8');
    assert.match(notify, /recordMemberActivity/);
    assert.match(notify, /New referral/);
    assert.match(notify, /Open referral in the pool/);
    assert.match(notify, /Your agency sent a lead|New website lead/);
  });

  it('owner member app aggregates form leads when there are no referral partners', () => {
    const route = fs.readFileSync(path.join(root, 'routes/memberApp.js'), 'utf8');
    const link = fs.readFileSync(path.join(root, 'services/memberAppointmentLink.js'), 'utf8');
    assert.match(route, /listOwnerFormLeads/);
    assert.match(route, /networkHasReferralPartners/);
    assert.match(route, /isOwnerMember\(ctx\.member/);
    assert.match(link, /pickOwnerPackageFallback/);
    assert.match(link, /OWNER_MEMBER_ID/);
    assert.match(link, /listOwnerFormLeads/);
  });
});
