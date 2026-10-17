const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildBestRoiActivity, countCloseReady } = require('../services/bestRoiActivity');

describe('buildBestRoiActivity', () => {
  it('prefers warm replies over prospect queue', () => {
    const act = buildBestRoiActivity({
      repliesWaiting: 2,
      queueNeedingAction: 13,
      leadSources: { referralCount: 4 },
    });
    assert.equal(act.id, 'replies');
    assert.match(act.headline, /2 warm replies/);
    assert.equal(act.primaryHref, '/engagement');
  });

  it('routes to network leads when referrals are the top gap', () => {
    const act = buildBestRoiActivity({
      repliesWaiting: 0,
      queueNeedingAction: 8,
      leadSources: { referralCount: 3, poolOpen: 2 },
    });
    assert.equal(act.id, 'network_referrals');
    assert.equal(act.primaryHref, '/network?tab=referrals');
    assert.equal(act.primaryLabel, 'Open network leads');
    assert.match(act.detail, /open pool/);
  });

  it('suggests closing late-stage deals before cold dials', () => {
    const act = buildBestRoiActivity({
      repliesWaiting: 0,
      queueNeedingAction: 10,
      opportunityBoard: {
        stages: [
          { name: 'New', count: 5 },
          { name: 'Proposal sent', count: 2 },
          { name: 'Won', count: 1 },
        ],
      },
    });
    assert.equal(act.id, 'close_deals');
    assert.equal(act.count, 2);
    assert.equal(act.primaryHref, '/prospecting?tab=pipeline');
  });

  it('suggests finding partners when network is thin', () => {
    const act = buildBestRoiActivity({
      repliesWaiting: 0,
      queueNeedingAction: 0,
      networkMemberCount: 2,
      leadSources: {},
    });
    assert.equal(act.id, 'find_partners');
    assert.equal(act.primaryHref, '/network?tab=members');
    assert.equal(act.secondaryHref, '/network?tab=referrals');
  });

  it('falls back to prospect session with network leads secondary', () => {
    const act = buildBestRoiActivity({
      repliesWaiting: 0,
      queueNeedingAction: 13,
      networkMemberCount: 12,
      leadSources: {},
    });
    assert.equal(act.id, 'prospects');
    assert.equal(act.primaryHref, '/focus');
    assert.equal(act.secondaryHref, '/network?tab=referrals');
    assert.equal(act.secondaryLabel, 'Network leads');
  });

  it('countCloseReady ignores won/lost stages', () => {
    const { count } = countCloseReady({
      stages: [
        { name: 'Discovery', count: 3 },
        { name: 'Negotiation', count: 1 },
        { name: 'Closed lost', count: 4 },
        { name: 'Closed won', count: 2 },
      ],
    });
    assert.equal(count, 1);
  });
});
