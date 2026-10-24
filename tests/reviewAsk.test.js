const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'review-ask-'));
process.env.SESSION_SECRET = 'review-ask-test-secret';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const reviewAsk = require('../services/reviewAsk');
const { getReviewPageUrl } = require('../lib/publicBaseUrl');
const reviewPage = require('../services/reviewPage');

describe('review ask tracking + 48h reminder', () => {
  it('gates automated reminder SMS to monthly-plan members', () => {
    const src = fs.readFileSync(path.join(__dirname, '../services/reviewAsk.js'), 'utf8');
    assert.match(src, /freeAppSignup\.isAppFreeMember\(member\)/);
    assert.match(src, /plan_required/);
    assert.match(src, /monthly-plan feature/);
  });

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

  it('returns the latest ask for a customer', async () => {
    const older = await reviewAsk.createAsk({
      networkId: 'n4',
      memberId: 'm4',
      customerId: 'custabcd01',
      name: 'Old',
      phone: '+15550004444',
      channel: 'sms',
      reviewSlug: 'latest-co',
      now: Date.parse('2026-09-01T12:00:00.000Z'),
    });
    const newer = await reviewAsk.createAsk({
      networkId: 'n4',
      memberId: 'm4',
      customerId: 'custabcd01',
      name: 'New',
      phone: '+15550004444',
      channel: 'sms',
      reviewSlug: 'latest-co',
      now: Date.parse('2026-09-10T12:00:00.000Z'),
    });
    const latest = await reviewAsk.latestAskForCustomer('n4', 'm4', 'custabcd01');
    assert.equal(latest.id, newer.id);
    assert.notEqual(latest.id, older.id);
    assert.equal(await reviewAsk.latestAskForCustomer('n4', 'm4', 'missing1'), null);
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

  it('tracks rating → pending confirm → sent / skipped', async () => {
    const ask = await reviewAsk.createAsk({
      networkId: 'n5',
      memberId: 'm5',
      customerId: 'custreward1',
      name: 'Riley',
      phone: '+15550005555',
      channel: 'sms',
      reviewSlug: 'reward-co',
      now: Date.parse('2026-12-01T12:00:00.000Z'),
    });
    const rated = await reviewAsk.markRated(ask.id, 5);
    assert.equal(rated.rating, 5);
    assert.ok(rated.ratedAt);
    assert.equal(reviewAsk.pendingRewardConfirm(rated), false);

    const notified = await reviewAsk.saveAsk({
      ...rated,
      rewardNotifiedAt: '2026-12-01T12:01:00.000Z',
    });
    assert.equal(reviewAsk.pendingRewardConfirm(notified), true);

    const pending = await reviewAsk.listPendingRewardConfirms({
      networkId: 'n5',
      memberId: 'm5',
    });
    assert.ok(pending.some((a) => a.id === ask.id));

    const confirmed = await reviewAsk.markReviewConfirmed(ask.id, { by: 'm5' });
    assert.ok(confirmed.reviewConfirmedAt);
    assert.equal(confirmed.reviewConfirmedBy, 'm5');
    assert.equal(reviewAsk.pendingRewardConfirm(confirmed), true);

    const sent = await reviewAsk.markRewardSent(ask.id, 'msg_reward_1');
    assert.ok(sent.rewardSentAt);
    assert.equal(sent.rewardMessageId, 'msg_reward_1');
    assert.equal(reviewAsk.pendingRewardConfirm(sent), false);

    const other = await reviewAsk.createAsk({
      networkId: 'n5',
      memberId: 'm5',
      name: 'Skipme',
      phone: '+15550006666',
      channel: 'sms',
      reviewSlug: 'reward-co',
      now: Date.parse('2026-12-02T12:00:00.000Z'),
    });
    await reviewAsk.markRated(other.id, 4);
    await reviewAsk.saveAsk({
      ...(await reviewAsk.getAsk(other.id)),
      rewardNotifiedAt: '2026-12-02T12:01:00.000Z',
    });
    const skipped = await reviewAsk.markRewardSkipped(other.id);
    assert.ok(skipped.rewardSkippedAt);
    assert.equal(reviewAsk.pendingRewardConfirm(skipped), false);
  });
});
