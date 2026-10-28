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
    assert.match(page, /Leads from contacts and online forms/);
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
    assert.match(page, /maMarkLeadForm/);
    assert.match(page, /maMarkCustomerForm/);
    assert.match(page, /ma-titlebar__actions/);
    assert.match(page, /ma-stage-btn/);
    // Referral stage badge only; Lead/Customer pills removed — just Mark as customer / Mark as lead.
    assert.doesNotMatch(page, /ma-stage-btn--lead/);
    assert.doesNotMatch(page, /ma-stage-btn--customer/);
    assert.match(page, /ma-stage-btn--referral/);
    assert.match(page, /ma-btn--ghost[\s\S]*?Mark as customer/);
    assert.match(page, /ma-btn--ghost[\s\S]*?Mark as lead/);
    assert.match(page, /website_form.*_formAnswers\.length|_formAnswers\.length > 0/);
    assert.match(page, /'Referral'|Referral contact/);
    assert.doesNotMatch(page, /How this contact was added/);
    assert.match(
      page,
      /ma-titlebar[\s\S]*?ma-titlebar__actions[\s\S]*?Mark as lead[\s\S]*?<\/div>\s*<\/div>/,
    );
    assert.doesNotMatch(page, /ma-titlebar__actions"[^>]*justify-content:flex-start/);
    assert.match(page, /mark-lead/);
    // Contact-lead cards open the profile; Mark as customer lives on the profile titlebar.
    assert.match(referrals, /ma-card__nav/);
    assert.match(referrals, /ma-card__nav-chev/);
    assert.match(referrals, /contact-lead-[\s\S]*?ma-card__nav[\s\S]*?lead\.href/);
    assert.match(referrals, /contact-lead-[\s\S]*?ma-actions[\s\S]*?>Open</);
    assert.doesNotMatch(
      referrals,
      /contact-lead-[\s\S]*?mark-customer[\s\S]*?Mark as customer/,
    );
    assert.match(referrals, /Mark as customer/);
    assert.match(referrals, /mark-customer|to-customer/);
    assert.match(referrals, /leads\/<%= encodeURIComponent\(lead\.id\) %>\/to-customer/);
    assert.match(referrals, /sourceLabel/);
    assert.match(referrals, /Website form|lead\.sourceLabel/);
    assert.match(route, /sourceLabel: work\.customerSourceLabel/);
    assert.match(customers, /Open Leads/);
    assert.match(customers, /showLeads/);
    assert.match(route, /customers\/c\/:id\/mark-customer/);
    assert.match(route, /customers\/c\/:id\/unmark-lead/);
    assert.match(route, /removeFromLeads:\s*true/);
    assert.match(route, /match\.leadRemovedAt/);
    assert.match(work, /leadRemovedAt/);
    assert.match(route, /leads\/:leadId\/to-customer/);
    assert.match(route, /marked_customer/);
    assert.match(route, /website_form/);
    assert.match(route, /sourceLabel: customer \? work\.customerSourceLabel\(customer\)/);
    assert.match(route, /filter\(\(c\) => showLeads \|\| !c\.isLead\)/);
    assert.match(work, /website_form/);
    assert.match(work, /customerSourceLabel/);
    // Customer Details has no per-field mics (speak-once is New customer only).
    assert.doesNotMatch(page, /data-ma-voice-for="cuName"/);
    assert.doesNotMatch(page, /data-ma-voice-for="cuNotes"/);
    assert.doesNotMatch(page, /Mic works while driving/);
    assert.match(head, /alex-voice-icon--stop[\s\S]*display:none!important/);
    assert.match(work, /isLead: c\.isLead === true/);
    assert.match(work, /setCustomerLeadFlag/);
    assert.match(work, /listContactLeads/);
  });

  it('form-lead SMS and push deep-link to the lead profile (not legacy /leads alone)', () => {
    const notify = fs.readFileSync(path.join(root, 'services/networkNotify.js'), 'utf8');
    const pkgs = fs.readFileSync(path.join(root, 'services/appointmentPackages.js'), 'utf8');
    assert.match(notify, /resolveFormLeadProfileUrl/);
    assert.match(notify, /\/customers\/c\//);
    assert.doesNotMatch(notify, /const leadsUrl = `\$\{app\}\/leads`/);
    assert.match(notify, /pushMemberFormLeadAlert/);
    assert.match(notify, /async function notifyMemberFormLead/);
    assert.match(notify, /websiteFormLabel/);
    assert.match(pkgs, /notifyUrl = `\$\{memberUrl\}\/referrals`/);
    assert.match(pkgs, /attachFormLead/);
    assert.match(pkgs, /notifyContractorNewLead/);
    assert.match(pkgs, /notifyMemberFormLead/);
  });

  it('notifyMemberFormLead wires phone push alongside SMS/email and bell activity', () => {
    const notify = fs.readFileSync(path.join(root, 'services/networkNotify.js'), 'utf8');
    assert.match(notify, /async function pushMemberFormLeadAlert/);
    assert.match(notify, /pushMemberFormLeadAlert\(\{[\s\S]*network, member, baseUrl/);
    assert.match(notify, /sendMemberPush/);
    assert.match(notify, /New website lead/);
    // Locked-plan teasers still record activity + push before SMS.
    const fn = notify.slice(notify.indexOf('async function notifyMemberFormLead'));
    const activityIdx = fn.indexOf('recordMemberActivity');
    const pushIdx = fn.indexOf('pushMemberFormLeadAlert');
    const lockedIdx = fn.indexOf('if (!detailsAllowed)');
    assert.ok(activityIdx > 0 && pushIdx > activityIdx && lockedIdx > pushIdx);
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

  it('pushMemberFormLeadAlert sends a phone popup for website form leads', async () => {
    const push = require('../services/pushNotifications');
    const memberAppointmentLink = require('../services/memberAppointmentLink');
    const networkNotify = require('../services/networkNotify');

    push.saveMemberSubscription({
      subscription: {
        endpoint: 'https://push.example.com/send/member-form-1',
        keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
      },
      networkId: 'net_form',
      memberId: 'm_form',
    });

    mock.method(memberAppointmentLink, 'findPackageForMember', async () => ({
      id: 'pkg_form',
      portalEnabled: true,
      businessName: 'TPR Flooring',
      websiteUrl: 'https://www.TPRFlooring.com',
    }));

    const sent = [];
    mock.method(webpush, 'sendNotification', async (sub, body) => {
      sent.push({ endpoint: sub.endpoint, body: JSON.parse(body) });
    });

    const result = await networkNotify.pushMemberFormLeadAlert({
      network: { id: 'net_form', name: 'TPR', ownerWorkspaceId: 'ws_form' },
      member: { id: 'm_form', companyName: 'TPR Flooring' },
      baseUrl: 'https://reviews.adhello.io',
      leadName: 'Jordan Homeowner',
      formName: 'ai_studio',
      source: 'ghl',
      preview: 'Need flooring quote',
      detailsAllowed: true,
      phone: '+15551234567',
      email: 'jordan@example.com',
      customerId: 'cust_form_1',
    });

    assert.equal(result.sent, 1);
    assert.match(sent[0].body.title, /New website lead: Jordan Homeowner/i);
    // After the app brand line: phone · description (no Website form / Source clutter).
    assert.match(sent[0].body.body, /\(555\) 123-4567/);
    assert.match(sent[0].body.body, /Need flooring quote/i);
    assert.doesNotMatch(sent[0].body.body, /Website form|ai_studio|Source:/i);
    assert.match(sent[0].body.url, /\/customers\/c\/[a-z0-9]+/);
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
