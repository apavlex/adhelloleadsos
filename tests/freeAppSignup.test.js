/**
 * Public free member-app signup (/app) — AdHello.io paste link.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'free-app-'));

const { describe, it, before, mock } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const dbService = require('../services/database');
const store = require('../services/networkStore');
const freeAppSignup = require('../services/freeAppSignup');
const memberLeadRequests = require('../services/memberLeadRequests');
const freeAppRoutes = require('../routes/freeApp');

function areaFields(extra = {}) {
  return {
    serviceTrades: 'Flooring, carpet',
    serviceCity: 'Camas',
    serviceRadiusMiles: '30',
    ...extra,
  };
}

describe('freeAppSignup', { concurrency: false }, () => {
  let network;
  let flooringNetwork;

  before(async () => {
    await dbService.saveWorkspace('ws_free_app_agency', {
      name: 'AdHello Agency',
      slug: 'adhello-agency',
      salesScriptsPresetKey: 'agency',
      members: { 'ops@adhello.io': { role: 'owner' } },
    });
    await dbService.saveWorkspaceSlug('adhello-agency', 'ws_free_app_agency');
    network = await store.getOrCreateNetworkForWorkspace('ws_free_app_agency', {
      name: 'AdHello',
      ownerEmail: 'ops@adhello.io',
    });

    await dbService.saveWorkspace('ws_tpr_flooring', {
      name: 'TPR Flooring',
      slug: 'tpr-flooring',
      salesScriptsPresetKey: 'retail_install',
      members: { 'greg@tprflooring.com': { role: 'owner' } },
    });
    await dbService.saveWorkspaceSlug('tpr-flooring', 'ws_tpr_flooring');
    flooringNetwork = await store.getOrCreateNetworkForWorkspace('ws_tpr_flooring', {
      name: 'TPR Flooring',
      ownerEmail: 'greg@tprflooring.com',
    });
  });

  it('validates the public form', () => {
    const empty = freeAppSignup.readForm({});
    assert.ok(empty.errors.length >= 2);
    assert.ok(empty.errors.some((e) => /Terms/i.test(e)));
    assert.ok(empty.errors.some((e) => /trades or areas/i.test(e)));
    assert.ok(empty.errors.some((e) => /city/i.test(e)));
    assert.ok(empty.errors.some((e) => /drive/i.test(e)));
    const noTerms = freeAppSignup.readForm({
      contactName: 'Sam',
      companyName: 'Sam Plumbing',
      phone: '(503) 555-0199',
      ...areaFields(),
    });
    assert.ok(noTerms.errors.some((e) => /pay-per-performance|Terms/i.test(e)));
    const ok = freeAppSignup.readForm({
      contactName: 'Sam',
      companyName: 'Sam Plumbing',
      phone: '(503) 555-0199',
      acceptTerms: 'on',
      ...areaFields(),
    });
    assert.deepEqual(ok.errors, []);
    assert.equal(ok.digits, '5035550199');
    assert.equal(ok.form.acceptTerms, true);
    assert.equal(ok.form.serviceTrades, 'Flooring, carpet');
    assert.equal(ok.form.serviceCity, 'Camas');
    assert.equal(ok.form.serviceRadiusMiles, 30);
  });

  it('resolves the adhello-agency network', async () => {
    const net = await freeAppSignup.resolveFreeAppNetwork();
    assert.equal(net.id, network.id);
  });

  it('resolves the tpr-flooring network for /app/flooring', async () => {
    const net = await freeAppSignup.resolveFlooringAppNetwork();
    assert.equal(net.id, flooringNetwork.id);
    assert.equal(freeAppSignup.isFlooringHostWorkspace({ slug: 'tpr-flooring' }), true);
    assert.equal(freeAppSignup.isFlooringHostWorkspace({ slug: 'adhello-agency' }), false);
    assert.equal(freeAppSignup.isFlooringHostWorkspace({ slug: 'bright-electric', name: 'Bright Electric' }), false);
    assert.equal(freeAppSignup.isFlooringHostWorkspace({ name: 'Bright Electric' }), false);
    assert.equal(await freeAppSignup.isFlooringHostNetwork(flooringNetwork), true);
    assert.equal(await freeAppSignup.isFlooringHostNetwork(network), false);
  });

  it('creates an app_free member and marks the lead', async () => {
    const notify = require('../services/networkNotify');
    let sent = null;
    mock.method(notify, 'sendMemberPortalLink', async (args) => {
      sent = args;
      return { ok: true, channel: 'sms' };
    });

    const { form, digits, email } = freeAppSignup.readForm({
      contactName: 'Alex',
      companyName: 'Alex Electric',
      phone: '503-555-0100',
      email: 'alex@example.com',
      acceptTerms: 'on',
      ...areaFields({ serviceTrades: 'Electrical', serviceCity: 'Portland', serviceRadiusMiles: '45' }),
    });
    const result = await freeAppSignup.signupFreeApp({
      form,
      digits,
      email,
      baseUrl: 'https://leads.adhello.io',
      ip: '203.0.113.10',
    });
    assert.equal(result.ok, true);
    assert.equal(result.created, true);
    assert.equal(result.member.plan, 'app_free');
    assert.equal(result.member.companyName, 'Alex Electric');
    assert.equal(result.member.serviceTrades, 'Electrical');
    assert.equal(result.member.serviceCity, 'Portland');
    assert.equal(result.member.serviceRadiusMiles, 45);
    assert.equal(result.member.reviewKeywordCity, 'Portland');
    assert.ok(result.member.trialEndsAt);
    assert.ok(result.member.termsAcceptedAt);
    assert.equal(result.member.termsVersion, freeAppSignup.TERMS_VERSION);
    const trial = freeAppSignup.appTrialStatus(result.member);
    assert.equal(trial.state, 'trial');
    assert.ok(trial.daysLeft >= 29 && trial.daysLeft <= 30);
    assert.equal(sent.welcome, true);
    assert.equal(sent.member.id, result.member.id);

    const lead = await dbService.getLead(result.member.leadKey, network.ownerWorkspaceId);
    assert.equal(lead.source, 'free_app_signup');
    mock.restoreAll();
  });

  it('creates an app_flooring member with no trial end (material partners)', async () => {
    const notify = require('../services/networkNotify');
    let sent = null;
    mock.method(notify, 'sendMemberPortalLink', async (args) => {
      sent = args;
      return { ok: true, channel: 'sms' };
    });

    const { form, digits, email } = freeAppSignup.readForm({
      contactName: 'Fran',
      companyName: 'Fran Flooring',
      phone: '503-555-0144',
      email: 'fran@example.com',
      acceptTerms: 'on',
      ...areaFields({ serviceTrades: 'Flooring', serviceCity: 'Camas', serviceRadiusMiles: '30' }),
    });
    const result = await freeAppSignup.signupFreeApp({
      form,
      digits,
      email,
      baseUrl: 'https://leads.adhello.io',
      ip: '203.0.113.55',
      offer: freeAppSignup.OFFER_FLOORING,
    });
    assert.equal(result.ok, true);
    assert.equal(result.created, true);
    assert.equal(result.member.plan, freeAppSignup.PLAN_APP_FLOORING);
    assert.equal(result.member.signupOffer, freeAppSignup.OFFER_FLOORING);
    assert.equal(result.member.trialEndsAt, '');
    assert.equal(result.member.termsVersion, freeAppSignup.TERMS_VERSION_FLOORING);
    assert.equal(freeAppSignup.isAppFreeMember(result.member), true);
    assert.equal(freeAppSignup.isFlooringOffer(result.member), true);
    assert.equal(freeAppSignup.isAppTrialExpired(result.member), false);
    const status = freeAppSignup.appTrialStatus(result.member);
    assert.equal(status.state, 'active');
    assert.equal(status.label, 'Flooring partner');
    assert.equal(sent.welcome, true);
    assert.equal(result.network.id, flooringNetwork.id);

    const lead = await dbService.getLead(result.member.leadKey, flooringNetwork.ownerWorkspaceId);
    assert.equal(lead.source, 'flooring_partner_signup');
    mock.restoreAll();
  });

  it('can activate a reviews-app trial member before the trial ends', async () => {
    const members = await store.listMembers(network.id);
    const alex = members.find((m) => freeAppSignup.phoneDigits(m.phone) === '5035550100');
    assert.ok(alex);
    assert.equal(freeAppSignup.isAppFreeMember(alex), true);
    const out = await freeAppSignup.activateAppMember(network.id, alex, { by: 'ops@adhello.io' });
    assert.equal(out.already, false);
    assert.equal(freeAppSignup.isAppFreeMember(out.member), false);
    assert.ok(out.member.planActivatedAt);
    assert.equal(freeAppSignup.isAppTrialExpired(out.member), false);
  });

  it('resends the link for an existing phone without creating a duplicate', async () => {
    const notify = require('../services/networkNotify');
    // Clear signup send cooldown from the create test so an intentional later resend still works.
    dbService.deleteKvSync(`${freeAppSignup.SEND_COOLDOWN_PREFIX}${freeAppSignup.contactLockKey({ digits: '5035550100' })}`);
    let calls = 0;
    mock.method(notify, 'sendMemberPortalLink', async () => {
      calls += 1;
      return { ok: true };
    });
    const { form, digits, email } = freeAppSignup.readForm({
      contactName: 'Alex',
      companyName: 'Alex Electric Again',
      phone: '503-555-0100',
      acceptTerms: 'on',
      ...areaFields(),
    });
    const again = await freeAppSignup.signupFreeApp({
      form,
      digits,
      email,
      baseUrl: 'https://leads.adhello.io',
      ip: '203.0.113.11',
    });
    assert.equal(again.ok, true);
    assert.equal(again.created, false);
    assert.equal(calls, 1);
    const members = await store.listMembers(network.id);
    assert.equal(members.filter((m) => freeAppSignup.phoneDigits(m.phone) === '5035550100').length, 1);
    mock.restoreAll();
  });

  it('does not send a second SMS when signup is double-submitted', async () => {
    const notify = require('../services/networkNotify');
    let calls = 0;
    mock.method(notify, 'sendMemberPortalLink', async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 80));
      return { ok: true, channel: 'sms' };
    });

    const { form, digits, email } = freeAppSignup.readForm({
      contactName: 'Casey',
      companyName: 'Casey Roofing',
      phone: '503-555-0177',
      acceptTerms: 'on',
      ...areaFields({ serviceTrades: 'Roofing', serviceCity: 'Vancouver' }),
    });
    const args = {
      form,
      digits,
      email,
      baseUrl: 'https://leads.adhello.io',
      ip: '203.0.113.40',
    };
    const [first, second] = await Promise.all([
      freeAppSignup.signupFreeApp(args),
      freeAppSignup.signupFreeApp({ ...args, ip: '203.0.113.41' }),
    ]);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(calls, 1);
    assert.ok(
      (first.notified && first.notified.skipped) || (second.notified && second.notified.skipped),
      'one request should skip send',
    );
    const members = await store.listMembers(network.id);
    assert.equal(members.filter((m) => freeAppSignup.phoneDigits(m.phone) === '5035550177').length, 1);

    // Immediate third click after send still no duplicate SMS (cooldown).
    const third = await freeAppSignup.signupFreeApp({ ...args, ip: '203.0.113.42' });
    assert.equal(third.ok, true);
    assert.equal(third.notified && third.notified.skipped, 'cooldown');
    assert.equal(calls, 1);
    mock.restoreAll();
  });

  it('filters Network → Members by free vs partner plan', () => {
    assert.equal(freeAppSignup.normalizeMemberPlanFilter('free'), 'free');
    assert.equal(freeAppSignup.normalizeMemberPlanFilter('PARTNER'), 'partner');
    assert.equal(freeAppSignup.normalizeMemberPlanFilter('all'), '');
    assert.equal(freeAppSignup.matchesMemberPlanFilter({ plan: 'app_free' }, 'free'), true);
    assert.equal(freeAppSignup.matchesMemberPlanFilter({ plan: 'app_free' }, 'partner'), false);
    assert.equal(freeAppSignup.matchesMemberPlanFilter({ plan: '' }, 'partner'), true);
    assert.equal(freeAppSignup.matchesMemberPlanFilter({ plan: 'partner' }, ''), true);

    const networkView = fs.readFileSync(path.join(__dirname, '../views/network.ejs'), 'utf8');
    const networkRoute = fs.readFileSync(path.join(__dirname, '../routes/network.js'), 'utf8');
    assert.match(networkView, /App trial \(<%= totals\.freeMembers %>\)/);
    assert.match(networkView, /net-pill-free/);
    assert.match(networkView, /net-join-link/);
    assert.match(networkView, /networkJoinUrl/);
    assert.match(networkView, /partner signup link/i);
    assert.match(networkView, /<%= totals\.freeMembers %> free · <%= totals\.partnerMembers %> partners/);
    assert.match(networkView, /Joined <%= m\.joinedLabel %>/);
    assert.match(networkRoute, /freeMembers/);
    assert.match(networkRoute, /memberPlanFilter/);
    assert.match(networkRoute, /joinedLabel/);
    assert.match(networkRoute, /joinedAt/);
    assert.match(networkRoute, /getOrEnsureJoinSlug/);
  });

  it('gates lead requests for app_free members even on a paid agency network', async () => {
    const trials = require('../services/trials');
    mock.method(dbService, 'getWorkspace', async () => ({ id: 'ws1', trial: { activatedAt: '2026-01-01' } }));
    mock.method(trials, 'isRestricted', () => false);
    assert.equal(
      await memberLeadRequests.planAllowsLeadRequests({ ownerWorkspaceId: 'ws1' }, { plan: 'app_free' }),
      false,
    );
    assert.equal(
      await memberLeadRequests.planAllowsLeadRequests(
        { ownerWorkspaceId: 'ws1' },
        { plan: freeAppSignup.PLAN_APP_FLOORING },
      ),
      false,
    );
    assert.equal(
      await memberLeadRequests.planAllowsLeadRequests({ ownerWorkspaceId: 'ws1' }, { plan: '' }),
      true,
    );
    mock.restoreAll();
  });

  it('serves GET /app/flooring and accepts POST without a timed trial', async () => {
    const notify = require('../services/networkNotify');
    mock.method(notify, 'sendMemberPortalLink', async () => ({ ok: true, channel: 'sms' }));

    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'views'));
    app.locals.assetVersion = 'test';
    app.use('/', freeAppRoutes);

    const server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const get = await fetch(`${base}/app/flooring`);
      assert.equal(get.status, 200);
      const html = await get.text();
      assert.match(html, /Flooring partners/);
      assert.match(html, /Keep your account as long as you buy material from us/);
      assert.match(html, /action="\/app\/flooring"/);
      assert.match(html, /Text me my app link/);
      assert.doesNotMatch(html, /30-day free trial/);
      assert.doesNotMatch(html, /Text me my trial link/);
      assert.match(html, /buy material from you/i);
      assert.match(html, /name="acceptTerms"/);

      const post = await fetch(`${base}/app/flooring`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          contactName: 'Lee',
          companyName: 'Lee Floors',
          phone: '503-555-0166',
          acceptTerms: 'on',
          ...areaFields({ serviceTrades: 'Flooring', serviceCity: 'Vancouver', serviceRadiusMiles: '25' }),
        }),
      });
      assert.equal(post.status, 200);
      assert.match(await post.text(), /Check your phone/);

      const members = await store.listMembers(flooringNetwork.id);
      const lee = members.find((m) => freeAppSignup.phoneDigits(m.phone) === '5035550166');
      assert.ok(lee);
      assert.equal(lee.plan, freeAppSignup.PLAN_APP_FLOORING);
      assert.equal(lee.trialEndsAt, '');
      assert.equal(lee.signupOffer, freeAppSignup.OFFER_FLOORING);
      assert.equal(freeAppSignup.isAppTrialExpired(lee), false);
      const onAgency = (await store.listMembers(network.id))
        .find((m) => freeAppSignup.phoneDigits(m.phone) === '5035550166');
      assert.equal(onAgency, undefined);
    } finally {
      await new Promise((r) => server.close(r));
      mock.restoreAll();
    }
  });

  it('join on tpr-flooring creates a flooring partner without offer param', async () => {
    const notify = require('../services/networkNotify');
    mock.method(notify, 'sendMemberPortalLink', async () => ({ ok: true, channel: 'sms' }));

    const { form, digits, email } = freeAppSignup.readForm({
      contactName: 'Pat',
      companyName: 'Pat Floors',
      phone: '503-555-0191',
      acceptTerms: 'on',
      ...areaFields({ serviceTrades: 'LVP', serviceCity: 'Camas', serviceRadiusMiles: '20' }),
    });
    const result = await freeAppSignup.signupFreeApp({
      form,
      digits,
      email,
      baseUrl: 'https://reviews.adhello.io',
      ip: '203.0.113.91',
      joinSlug: 'tpr-flooring',
      network: flooringNetwork,
    });
    assert.equal(result.ok, true);
    assert.equal(result.network.id, flooringNetwork.id);
    assert.ok(result.member);
    assert.equal(result.member.plan, freeAppSignup.PLAN_APP_FLOORING);
    assert.equal(result.member.signupOffer, freeAppSignup.OFFER_FLOORING);
    assert.equal(result.member.trialEndsAt, '');
    mock.restoreAll();
  });

  it('serves GET /app and accepts POST /app', async () => {
    const notify = require('../services/networkNotify');
    mock.method(notify, 'sendMemberPortalLink', async () => ({ ok: true, channel: 'email' }));

    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'views'));
    app.locals.assetVersion = 'test';
    app.use('/', freeAppRoutes);

    const server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const get = await fetch(`${base}/app`);
      assert.equal(get.status, 200);
      const html = await get.text();
      assert.match(html, /Get more reviews for your business!/);
      assert.match(html, /30-day free trial/);
      assert.match(html, /action="\/app"/);
      assert.match(html, /Text me my trial link/);
      assert.match(html, /id="fa-form"/);
      assert.match(html, /id="fa-submit"/);
      assert.match(html, /Sending…/);
      assert.match(html, /btn\.disabled = true/);
      assert.match(html, /\.fa-btn:disabled/);
      assert.match(html, /\.fa-btn[^}]*margin-top:\s*2\.75rem/);
      assert.match(html, /name="acceptTerms"/);
      assert.match(html, /name="serviceTrades"/);
      assert.match(html, /name="serviceCity"/);
      assert.match(html, /name="serviceRadiusMiles"/);
      assert.match(html, /Trades or areas you work in/);
      assert.match(html, /Willing to drive/);
      assert.match(html, /pay-per-performance/i);
      assert.match(html, /commission/i);

      const rejected = await fetch(`${base}/app`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          contactName: 'Jordan',
          companyName: 'Jordan HVAC',
          email: 'jordan@example.com',
          ...areaFields(),
        }),
      });
      assert.equal(rejected.status, 400);
      assert.match(await rejected.text(), /Terms/i);

      const post = await fetch(`${base}/app`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          contactName: 'Jordan',
          companyName: 'Jordan HVAC',
          email: 'jordan@example.com',
          acceptTerms: 'on',
          ...areaFields({ serviceTrades: 'HVAC', serviceCity: 'Camas', serviceRadiusMiles: '25' }),
        }),
      });
      assert.equal(post.status, 200);
      const done = await post.text();
      assert.match(done, /Check your phone/);
    } finally {
      await new Promise((r) => server.close(r));
      mock.restoreAll();
    }
  });

  it('serves GET /join/:slug onto that agency network', async () => {
    const notify = require('../services/networkNotify');
    mock.method(notify, 'sendMemberPortalLink', async () => ({ ok: true, channel: 'email' }));

    await dbService.saveWorkspace('ws_partner_agency', {
      name: 'Partner Agency Co',
      slug: 'partner-agency-co',
      members: { 'ops@partner.test': { role: 'owner' } },
    });
    await dbService.saveWorkspaceSlug('partner-agency-co', 'ws_partner_agency');
    const partnerNet = await store.getOrCreateNetworkForWorkspace('ws_partner_agency', {
      name: 'Partner Agency Co',
      ownerEmail: 'ops@partner.test',
    });

    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'views'));
    app.locals.assetVersion = 'test';
    app.use('/', freeAppRoutes);
    const server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const missing = await fetch(`${base}/join/does-not-exist`);
      assert.equal(missing.status, 404);

      const get = await fetch(`${base}/join/partner-agency-co`);
      assert.equal(get.status, 200);
      const html = await get.text();
      assert.match(html, /action="\/join\/partner-agency-co"/);
      assert.match(html, /Partner Agency Co/);

      const post = await fetch(`${base}/join/partner-agency-co`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          contactName: 'Pat',
          companyName: 'Pat Plumbing',
          phone: '503-555-0188',
          acceptTerms: 'on',
          ...areaFields({ serviceTrades: 'Plumbing', serviceCity: 'Battle Ground', serviceRadiusMiles: '20' }),
        }),
      });
      assert.equal(post.status, 200);
      assert.match(await post.text(), /Check your phone/);

      const members = await store.listMembers(partnerNet.id);
      const pat = members.find((m) => freeAppSignup.phoneDigits(m.phone) === '5035550188');
      assert.ok(pat);
      assert.equal(pat.plan, 'app_free');
      assert.ok(pat.termsAcceptedAt);
      assert.equal(pat.serviceTrades, 'Plumbing');
      assert.equal(pat.serviceCity, 'Battle Ground');
      assert.equal(pat.serviceRadiusMiles, 20);

      const lead = await dbService.getLead(pat.leadKey, partnerNet.ownerWorkspaceId);
      assert.equal(lead.source, 'network_join_signup');
    } finally {
      await new Promise((r) => server.close(r));
      mock.restoreAll();
    }
  });

  it('serves GET /join/:slug/flooring onto that supplier network with Quote plan', async () => {
    const notify = require('../services/networkNotify');
    mock.method(notify, 'sendMemberPortalLink', async () => ({ ok: true, channel: 'email' }));

    await dbService.saveWorkspace('ws_tpr_flooring', {
      name: 'TPR Flooring',
      slug: 'tpr-flooring',
      members: { 'ops@tpr.test': { role: 'owner' } },
    });
    await dbService.saveWorkspaceSlug('tpr-flooring', 'ws_tpr_flooring');
    const tprNet = await store.getOrCreateNetworkForWorkspace('ws_tpr_flooring', {
      name: 'TPR Flooring',
      ownerEmail: 'ops@tpr.test',
    });
    assert.equal(freeAppSignup.isFlooringNetworkWorkspace({ name: 'TPR Flooring' }), true);
    assert.equal(freeAppSignup.isFlooringNetworkWorkspace({ name: 'Bright Electric' }), false);

    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'views'));
    app.locals.assetVersion = 'test';
    app.use('/', freeAppRoutes);
    const server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const get = await fetch(`${base}/join/tpr-flooring/flooring`);
      assert.equal(get.status, 200);
      const html = await get.text();
      assert.match(html, /action="\/join\/tpr-flooring\/flooring"/);
      assert.match(html, /TPR Flooring|Flooring partners/);

      const post = await fetch(`${base}/join/tpr-flooring/flooring`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          contactName: 'Sam',
          companyName: 'Sam Floors',
          phone: '503-555-0199',
          acceptTerms: 'on',
          ...areaFields({ serviceTrades: 'Flooring', serviceCity: 'Portland', serviceRadiusMiles: '25' }),
        }),
      });
      assert.equal(post.status, 200);
      assert.match(await post.text(), /Check your phone/);

      const members = await store.listMembers(tprNet.id);
      const sam = members.find((m) => freeAppSignup.phoneDigits(m.phone) === '5035550199');
      assert.ok(sam);
      assert.equal(sam.plan, freeAppSignup.PLAN_APP_FLOORING);
      assert.equal(sam.signupOffer, freeAppSignup.OFFER_FLOORING);
      assert.equal(freeAppSignup.isFlooringOffer(sam), true);
    } finally {
      await new Promise((r) => server.close(r));
      mock.restoreAll();
    }
  });

  it('wires the public route before auth and documents the paste URL', () => {
    const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const route = fs.readFileSync(path.join(__dirname, '../routes/freeApp.js'), 'utf8');
    const view = fs.readFileSync(path.join(__dirname, '../views/free_app.ejs'), 'utf8');
    const networkView = fs.readFileSync(path.join(__dirname, '../views/network.ejs'), 'utf8');
    const referralsView = fs.readFileSync(path.join(__dirname, '../views/referrals.ejs'), 'utf8');
    const callout = fs.readFileSync(path.join(__dirname, '../views/member_app/_lead_request_callout.ejs'), 'utf8');
    const publicBase = fs.readFileSync(path.join(__dirname, '../lib/publicBaseUrl.js'), 'utf8');
    assert.match(server, /routes\/freeApp/);
    assert.match(route, /router\.(get|post)\('\/app'/);
    assert.match(route, /\/app\/flooring/);
    assert.match(route, /\/join\/:slug\/flooring/);
    assert.match(route, /router\.(get|post)\('\/join\/:slug'/);
    assert.match(view, /_flooring/);
    assert.match(view, /buy material from us/i);
    assert.match(view, /Get more reviews for your business!/);
    assert.match(view, /Extras included/);
    assert.match(view, /reviews-flooring-owner-testimonial\.jpg/);
    assert.match(view, /Flooring business owner/);
    assert.ok(fs.existsSync(path.join(__dirname, '../public/images/reviews-flooring-owner-testimonial.jpg')));
    assert.match(view, /fa-card-trial/);
    assert.match(view, /30-day free trial/);
    assert.match(view, /Text me my trial link/);
    assert.match(view, /id="fa-form"/);
    assert.match(view, /formAction/);
    assert.match(view, /name="acceptTerms"/);
    assert.match(view, /name="serviceTrades"/);
    assert.match(view, /name="serviceCity"/);
    assert.match(view, /name="serviceRadiusMiles"/);
    assert.match(view, /pay-per-performance/i);
    assert.match(view, /btn\.disabled = true/);
    assert.match(view, /\.fa-btn:disabled/);
    assert.match(view, /\.fa-btn[^}]*margin-top:\s*2\.75rem/);
    assert.match(view, /\.fa-foot[^}]*margin-top:\s*2\.5rem/);
    assert.match(view, /class="fa-foot"/);
    assert.match(networkView, /net-join-link/);
    assert.match(networkView, /networkJoinUrl/);
    assert.match(networkView, /networkJoinIsFlooring|Flooring partner signup link/);
    assert.match(referralsView, /Flooring partner signup link/);
    assert.match(publicBase, /getNetworkJoinUrl/);
    assert.match(publicBase, /getNetworkFlooringJoinUrl/);
    assert.match(callout, /href="\/signup"/);
  });
});
