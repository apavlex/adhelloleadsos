const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'reviews-onboarding-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const { DateTime } = require('luxon');
const reviewsOnboardingDrip = require('../services/reviewsOnboardingDrip');
const reviewsOnboardingConfig = require('../services/reviewsOnboardingConfig');

test('Reviews onboarding has 7 Reviews-focused steps (not Agency OS prospecting)', () => {
  assert.equal(reviewsOnboardingConfig.DEFAULT_STEPS.length, 7);
  assert.match(reviewsOnboardingConfig.DEFAULT_STEPS[0].subject, /review/i);
  assert.doesNotMatch(reviewsOnboardingConfig.DEFAULT_STEPS.map((s) => s.body).join(' '), /prospect search|cadence|pipeline/i);
});

test('enroll with skipDay1 starts at Day 2; drip sends next morning', async (t) => {
  const networkNotify = require('../services/networkNotify');
  const store = require('../services/networkStore');
  const sent = [];

  t.mock.method(networkNotify, 'memberPortalShortLink', async (_b, _n, _m, pathAndQuery) => {
    return `https://reviews.adhello.io/a/demo${pathAndQuery || ''}`;
  });
  t.mock.method(networkNotify, 'messageMember', async (_network, _member, payload) => {
    sent.push(payload);
    return { ok: true };
  });
  t.mock.method(store, 'getNetwork', async (id) => ({ id, ownerWorkspaceId: 'ws1', name: 'AdHello Agency' }));
  t.mock.method(store, 'getMember', async (_nid, mid) => ({
    id: mid,
    contactName: 'Greg Owner',
    email: 'greg@tprflooring.com',
    companyName: 'TPR Flooring',
    status: 'active',
    plan: 'app_free',
  }));

  const network = { id: 'net_reviews_1', ownerWorkspaceId: 'ws1', name: 'AdHello Agency' };
  const member = {
    id: 'mem_1',
    contactName: 'Greg Owner',
    email: 'greg@tprflooring.com',
    companyName: 'TPR Flooring',
    status: 'active',
    plan: 'app_free',
  };

  const enr = await reviewsOnboardingDrip.enrollMember({
    network,
    member,
    baseUrl: 'https://reviews.adhello.io',
    skipDay1: true,
  });
  assert.equal(enr.nextIndex, 1);
  assert.equal(sent.length, 0);

  const nextMorning = DateTime.now()
    .setZone('America/Los_Angeles')
    .plus({ days: 1 })
    .set({ hour: 9, minute: 5 })
    .toJSDate();
  const result = await reviewsOnboardingDrip.runReviewsOnboardingDrips(nextMorning);
  assert.equal(result.sent, 1);
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /Day 2/i);
  assert.match(sent[0].email, /Home Screen|home screen/i);
});
