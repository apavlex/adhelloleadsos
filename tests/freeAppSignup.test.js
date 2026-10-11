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

describe('freeAppSignup', () => {
  let network;

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
  });

  it('validates the public form', () => {
    const empty = freeAppSignup.readForm({});
    assert.ok(empty.errors.length >= 2);
    const ok = freeAppSignup.readForm({
      contactName: 'Sam',
      companyName: 'Sam Plumbing',
      phone: '(503) 555-0199',
    });
    assert.deepEqual(ok.errors, []);
    assert.equal(ok.digits, '5035550199');
  });

  it('resolves the adhello-agency network', async () => {
    const net = await freeAppSignup.resolveFreeAppNetwork();
    assert.equal(net.id, network.id);
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
    assert.equal(sent.welcome, true);
    assert.equal(sent.member.id, result.member.id);

    const lead = await dbService.getLead(result.member.leadKey, network.ownerWorkspaceId);
    assert.equal(lead.source, 'free_app_signup');
    mock.restoreAll();
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

  it('gates lead requests for app_free members even on a paid agency network', async () => {
    const trials = require('../services/trials');
    mock.method(dbService, 'getWorkspace', async () => ({ id: 'ws1', trial: { activatedAt: '2026-01-01' } }));
    mock.method(trials, 'isRestricted', () => false);
    assert.equal(
      await memberLeadRequests.planAllowsLeadRequests({ ownerWorkspaceId: 'ws1' }, { plan: 'app_free' }),
      false,
    );
    assert.equal(
      await memberLeadRequests.planAllowsLeadRequests({ ownerWorkspaceId: 'ws1' }, { plan: '' }),
      true,
    );
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
      assert.match(html, /Get the reviews app/);
      assert.match(html, /action="\/app"/);
      assert.match(html, /Text me the reviews app/);
      assert.match(html, /id="fa-form"/);
      assert.match(html, /id="fa-submit"/);
      assert.match(html, /Sending…/);
      assert.match(html, /btn\.disabled = true/);
      assert.match(html, /\.fa-btn:disabled/);
      assert.match(html, /\.fa-btn[^}]*margin-top:\s*2\.75rem/);

      const post = await fetch(`${base}/app`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          contactName: 'Jordan',
          companyName: 'Jordan HVAC',
          email: 'jordan@example.com',
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

  it('wires the public route before auth and documents the paste URL', () => {
    const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const route = fs.readFileSync(path.join(__dirname, '../routes/freeApp.js'), 'utf8');
    const view = fs.readFileSync(path.join(__dirname, '../views/free_app.ejs'), 'utf8');
    const callout = fs.readFileSync(path.join(__dirname, '../views/member_app/_lead_request_callout.ejs'), 'utf8');
    assert.match(server, /routes\/freeApp/);
    assert.match(route, /router\.(get|post)\('\/app'/);
    assert.match(view, /Get the reviews app/);
    assert.match(view, /Text me the reviews app/);
    assert.match(view, /id="fa-form"/);
    assert.match(view, /btn\.disabled = true/);
    assert.match(view, /\.fa-btn:disabled/);
    assert.match(view, /\.fa-btn[^}]*margin-top:\s*2\.75rem/);
    assert.match(view, /\.fa-foot[^}]*margin-top:\s*2\.5rem/);
    assert.match(view, /class="fa-foot"/);
    assert.match(callout, /href="\/signup"/);
  });
});
