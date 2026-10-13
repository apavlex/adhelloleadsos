const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const reward = require('../services/reviewReferralReward');

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
