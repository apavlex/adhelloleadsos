const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'review-ask-'));
process.env.SESSION_SECRET = 'review-ask-test-secret';

const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');
const reviewAsk = require('../services/reviewAsk');
const { getReviewPageUrl } = require('../lib/publicBaseUrl');
const reviewPage = require('../services/reviewPage');
const store = require('../services/networkStore');
const ghlMessaging = require('../services/ghlMessaging');
const workspaceIntegrations = require('../services/workspaceIntegrations');

describe('review ask tracking + 48h reminder', () => {
  it('builds tracked review URLs with ask id', () => {
    const url = getReviewPageUrl('camas-flooring', { askId: 'abc12345def', imageId: 'img1' });
    assert.match(url, /\/rv\/camas-flooring\?/);
    assert.match(url, /[?&]a=abc12345def/);
    assert.match(url, /[?&]i=img1/);
  });

  it('puts ask id on destination click-throughs', () => {
    const dest = reviewPage.reviewDestinations(
      { google: 'https://g.page/r/x/review' },
      'camas-flooring',
      { askId: 'ask99xyz' },
    );
    assert.equal(dest[0].href, '/rv/camas-flooring/go/google?a=ask99xyz');
  });

  it('creates an ask and marks open/click as engaged', async () => {
    const ask = await reviewAsk.createAsk({
      networkId: 'n1',
      memberId: 'm1',
      customerId: 'c1abc0',
      name: 'Pat',
      phone: '+15551234567',
      email: '',
      channel: 'sms',
      reviewSlug: 'camas-flooring',
      now: Date.parse('2026-10-01T12:00:00.000Z'),
    });
    assert.ok(reviewAsk.isAskId(ask.id));
    assert.match(ask.reviewUrl, new RegExp(`[?&]a=${ask.id}`));
    assert.equal(ask.remindAfterAt, '2026-10-03T12:00:00.000Z');
    assert.equal(reviewAsk.isEngaged(ask), false);

    const opened = await reviewAsk.markOpened(ask.id, Date.parse('2026-10-01T12:05:00.000Z'));
    assert.ok(opened.openedAt);
    assert.equal(reviewAsk.isEngaged(opened), true);
    assert.equal(reviewAsk.dueForReminder(opened, Date.parse('2026-10-04T12:00:00.000Z')), false);

    const ask2 = await reviewAsk.createAsk({
      networkId: 'n1',
      memberId: 'm1',
      name: 'Sam',
      phone: '+15557654321',
      channel: 'sms',
      reviewSlug: 'camas-flooring',
      now: Date.parse('2026-10-01T12:00:00.000Z'),
    });
    const clicked = await reviewAsk.markClicked(ask2.id, 'google', Date.parse('2026-10-01T13:00:00.000Z'));
    assert.ok(clicked.clickedAt);
    assert.equal(clicked.clickPlatform, 'google');
    assert.equal(reviewAsk.isEngaged(clicked), true);
  });

  it('only schedules a reminder after 48h when not engaged', async () => {
    const nowAsk = Date.parse('2026-10-01T12:00:00.000Z');
    const ask = await reviewAsk.createAsk({
      networkId: 'n2',
      memberId: 'm2',
      name: 'Casey',
      phone: '+15550001111',
      channel: 'sms',
      reviewSlug: 'acme',
      now: nowAsk,
    });

    assert.equal(reviewAsk.dueForReminder(ask, nowAsk + 47 * 60 * 60 * 1000), false);
    assert.equal(reviewAsk.dueForReminder(ask, nowAsk + 49 * 60 * 60 * 1000), true);

    const reminded = await reviewAsk.saveAsk({
      ...ask,
      remindedAt: '2026-10-03T13:00:00.000Z',
    });
    assert.equal(reviewAsk.dueForReminder(reminded, nowAsk + 50 * 60 * 60 * 1000), false);
  });

  it('sends reminders through the workspace GHL connection', async () => {
    const network = await store.getOrCreateNetworkForWorkspace('ws_review_ask_ghl', { name: 'Ask Net' });
    const member = await store.saveMember(network.id, {
      companyName: 'Ask Co',
      contactName: 'Pat',
      status: 'active',
      reviewSlug: 'ask-co',
    });
    const ask = await reviewAsk.createAsk({
      networkId: network.id,
      memberId: member.id,
      name: 'Casey',
      phone: '+15550005555',
      channel: 'sms',
      reviewSlug: 'ask-co',
      now: Date.parse('2026-10-01T12:00:00.000Z'),
    });

    let resolvedWid = '';
    mock.method(workspaceIntegrations, 'getResolvedIntegrationEnv', async (wid) => {
      resolvedWid = wid;
      return { GHL_API_KEY: 'k', GHL_LOCATION_ID: 'loc', GHL_SMS_FROM: '+15550009999' };
    });
    mock.method(ghlMessaging, 'messagingReady', () => ({ configured: true, smsReady: true, emailReady: true }));
    mock.method(ghlMessaging, 'sendSmsToPerson', async (payload) => {
      assert.equal(payload.integrationEnv.GHL_LOCATION_ID, 'loc');
      return { messageId: 'msg1', provider: 'ghl' };
    });

    try {
      const result = await reviewAsk.sendReminderForAsk(ask);
      assert.equal(result.ok, true);
      assert.equal(resolvedWid, network.ownerWorkspaceId);
      assert.ok(result.ask.remindedAt);
    } finally {
      mock.restoreAll();
    }
  });

  it('lists due asks for the reminder tick', async () => {
    const t0 = Date.parse('2026-11-01T10:00:00.000Z');
    const dueAsk = await reviewAsk.createAsk({
      networkId: 'n3',
      memberId: 'm3',
      name: 'Due',
      phone: '+15550002222',
      channel: 'sms',
      reviewSlug: 'due-co',
      now: t0,
    });
    await reviewAsk.createAsk({
      networkId: 'n3',
      memberId: 'm3',
      name: 'Fresh',
      phone: '+15550003333',
      channel: 'sms',
      reviewSlug: 'due-co',
      now: t0 + 40 * 60 * 60 * 1000,
    });

    const due = await reviewAsk.listDueReminderAsks(t0 + 49 * 60 * 60 * 1000);
    assert.ok(due.some((a) => a.id === dueAsk.id));
    assert.ok(!due.some((a) => a.name === 'Fresh'));
  });
});
