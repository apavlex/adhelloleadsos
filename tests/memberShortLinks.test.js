/**
 * Short /a/:code member-app links for SMS.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'member-short-'));

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const store = require('../services/networkStore');
const memberShortLinks = require('../services/memberShortLinks');
const networkNotify = require('../services/networkNotify');
const { createMemberPortalToken, verifyNetworkToken } = require('../services/networkLinkSign');
const memberApp = require('../routes/memberApp');

describe('memberShortLinks', () => {
  it('allocates a stable short code and builds /a/ URLs', async () => {
    const network = await store.getOrCreateNetworkForWorkspace('ws_short_1', { name: 'Short net' });
    const member = await store.saveMember(network.id, {
      companyName: 'Short Co',
      contactName: 'Pat',
      status: 'active',
    });
    const code = await memberShortLinks.ensurePortalCode(network.id, member);
    assert.match(code, memberShortLinks.CODE_RE);
    const again = await memberShortLinks.ensurePortalCode(network.id, await store.getMember(network.id, member.id));
    assert.equal(again, code);

    const home = await memberShortLinks.memberAppShortLink('https://leads.adhello.io', network, await store.getMember(network.id, member.id));
    assert.equal(home, `https://leads.adhello.io/a/${code}`);
    const review = await memberShortLinks.memberAppShortLink(
      'https://leads.adhello.io',
      network,
      await store.getMember(network.id, member.id),
      '/review?ask=1',
    );
    assert.equal(review, `https://leads.adhello.io/a/${code}/review?ask=1`);
  });

  it('sendMemberPortalLink texts short /a/ URLs not long /m/ tokens', async () => {
    const network = await store.getOrCreateNetworkForWorkspace('ws_short_2', { name: 'Short net 2' });
    const member = await store.saveMember(network.id, {
      companyName: 'SMS Co',
      contactName: 'Lee',
      phone: '5035550199',
      status: 'active',
    });
    let smsBody = '';
    const ghlMessaging = require('../services/ghlMessaging');
    const { mock } = require('node:test');
    mock.method(ghlMessaging, 'messagingReady', () => ({ configured: true, smsReady: true, emailReady: true }));
    mock.method(ghlMessaging, 'sendSmsToPerson', async ({ message }) => {
      smsBody = message;
      return { provider: 'ghl', messageId: 'm1' };
    });
    const workspaceIntegrations = require('../services/workspaceIntegrations');
    mock.method(workspaceIntegrations, 'getResolvedIntegrationEnv', async () => ({}));

    await networkNotify.sendMemberPortalLink({
      network,
      member,
      baseUrl: 'https://leads.adhello.io',
      welcome: true,
    });
    assert.match(smsBody, /https:\/\/leads\.adhello\.io\/a\/[a-z0-9]{8}\/review\?ask=1/);
    assert.match(smsBody, /https:\/\/leads\.adhello\.io\/a\/[a-z0-9]{8}(?:\s|\.|$)/);
    assert.doesNotMatch(smsBody, /\/m\/[A-Za-z0-9_-]{40,}/);
    mock.restoreAll();
  });

  it('GET /a/:code redirects to a fresh signed /m/ token with path preserved', async () => {
    const network = await store.getOrCreateNetworkForWorkspace('ws_short_3', { name: 'Short net 3' });
    let member = await store.saveMember(network.id, {
      companyName: 'Redirect Co',
      contactName: 'Sam',
      status: 'active',
    });
    const code = await memberShortLinks.ensurePortalCode(network.id, member);
    member = await store.getMember(network.id, member.id);

    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'views'));
    app.locals.assetVersion = 'test';
    app.use('/', memberApp);
    const server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const home = await fetch(`${base}/a/${code}`, { redirect: 'manual' });
      assert.equal(home.status, 302);
      const loc = home.headers.get('location') || '';
      assert.match(loc, /^\/m\/[^/]+$/);
      const token = decodeURIComponent(loc.slice(3));
      const payload = verifyNetworkToken(token, 'mem');
      assert.equal(payload.networkId, network.id);
      assert.equal(payload.memberId, member.id);

      const review = await fetch(`${base}/a/${code}/review?ask=1`, { redirect: 'manual' });
      assert.equal(review.status, 302);
      const reviewLoc = review.headers.get('location') || '';
      assert.match(reviewLoc, /^\/m\/[^/]+\/review\?ask=1$/);

      // Long signed token still works for in-app use.
      const long = createMemberPortalToken({ networkId: network.id, memberId: member.id });
      const page = await fetch(`${base}/m/${long}`);
      assert.equal(page.status, 200);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});
