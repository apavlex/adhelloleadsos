const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Load networkStore first (production boot order) — must not poison freeAppSignup
// via a circular require that leaves store.saveMember undefined.
const store = require('../services/networkStore');
const freeAppSignup = require('../services/freeAppSignup');
const reward = require('../services/reviewReferralReward');

describe('review referral reward circular load', () => {
  it('keeps networkStore exports intact when reward module is loaded', () => {
    assert.equal(typeof store.saveMember, 'function');
    assert.equal(typeof store.getOrCreateNetworkForWorkspace, 'function');
    assert.equal(typeof freeAppSignup.isAppFreeMember, 'function');
    assert.equal(freeAppSignup.isAppFreeMember({ plan: 'app_free' }), true);
  });
});

describe('review referral reward settings UI', () => {
  it('keeps setup closed until the offer checkbox is checked', () => {
    const fs = require('fs');
    const path = require('path');
    const view = fs.readFileSync(
      path.join(__dirname, '../views/member_app/review_settings.ejs'),
      'utf8'
    );
    assert.match(view, /id="maReviewRewardSetup"/);
    assert.match(view, /maReviewRewardSetup" <%= _rw\.enabled \? '' : 'hidden' %>/);
    assert.match(view, /id="rvRewardEnabled"/);
    assert.match(view, /setup\.hidden = !box\.checked/);
  });
});

describe('review referral reward settings', () => {
  it('normalizes defaults and body', () => {
    const empty = reward.normalizeSettings(null);
    assert.equal(empty.enabled, false);
    assert.equal(empty.minStars, 4);
    assert.equal(empty.rewardType, 'gift_card');
    assert.ok(empty.rewardScript.includes('{{reward}}'));

    const fromBody = reward.settingsFromBody({
      rewardEnabled: '1',
      rewardMinStars: '5',
      rewardType: 'discount',
      rewardLabel: '  10% off next visit  ',
      rewardScript: 'Hi {{name}} — get {{reward}} from {{company}} for {{stars}}★',
    });
    assert.equal(fromBody.enabled, true);
    assert.equal(fromBody.minStars, 5);
    assert.equal(fromBody.rewardType, 'discount');
    assert.equal(fromBody.rewardLabel, '10% off next visit');
  });

  it('qualifies only when enabled, labeled, and stars meet the bar', () => {
    const settings = reward.normalizeSettings({
      enabled: true,
      minStars: 4,
      rewardLabel: '$25 gift card',
    });
    assert.equal(reward.qualifies(settings, 5), true);
    assert.equal(reward.qualifies(settings, 4), true);
    assert.equal(reward.qualifies(settings, 3), false);
    assert.equal(reward.qualifies({ ...settings, enabled: false }, 5), false);
    assert.equal(reward.qualifies({ ...settings, rewardLabel: '' }, 5), false);
    assert.equal(reward.qualifies({ ...settings, minStars: 5 }, 4), false);
  });

  it('blocks free-plan members from qualifying', () => {
    const settings = reward.normalizeSettings({
      enabled: true,
      minStars: 4,
      rewardLabel: '$25 gift card',
    });
    assert.equal(reward.isPaidMember({ plan: 'app_free' }), false);
    assert.equal(reward.isPaidMember({ plan: '' }), true);
    assert.equal(reward.qualifies(settings, 5, { plan: 'app_free' }), false);
    assert.equal(reward.qualifies(settings, 5, { plan: '' }), true);
  });

  it('fills the customer offer script', () => {
    const msg = reward.buildCustomerMessage(
      {
        enabled: true,
        rewardLabel: '$25 gift card',
        rewardScript: 'Thanks {{name}} for {{stars}}★! Refer someone to {{company}} and get {{reward}}.',
      },
      { name: 'Pat', company: 'Bright Plumbing', stars: 5 },
    );
    assert.equal(
      msg,
      'Thanks Pat for 5★! Refer someone to Bright Plumbing and get $25 gift card.',
    );
  });

  it('reads settings from a member record', () => {
    const fromMember = reward.settingsFromMember({
      reviewReward: { enabled: 'on', rewardLabel: 'Free tune-up', rewardType: 'prize', minStars: 5 },
    });
    assert.equal(fromMember.enabled, true);
    assert.equal(fromMember.rewardType, 'prize');
    assert.equal(fromMember.minStars, 5);
    assert.equal(fromMember.rewardLabel, 'Free tune-up');
  });
});
