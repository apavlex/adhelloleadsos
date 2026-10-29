const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { fallbackPlan } = require('../services/localSeoPlanner');

describe('localSeoPlanner fallbackPlan', () => {
  test('does not spam one Maps step per keyword', () => {
    const plan = fallbackPlan({
      profileSnapshot: { businessName: 'TPR Flooring', city: 'Camas', state: 'WA', vertical: 'Flooring' },
      scores: { overall: 30, mapsScore: 33, gbpScore: 25, reviewScore: 30 },
      keywordRanks: [
        { keyword: 'Flooring near me', mapsRank: null },
        { keyword: 'Flooring Camas', mapsRank: 6 },
        { keyword: 'best Flooring Camas', mapsRank: 8 },
        { keyword: 'Flooring near Camas', mapsRank: 7 },
      ],
      competitors: [
        { title: 'Prestige Flooring', domain: 'prestigeflooring-pdx.com', bestRank: 4, appearances: 3, avgRating: 4.9 },
      ],
      gbp: null,
      reviews: null,
    });

    assert.equal(plan.source, 'rules');
    assert.ok(plan.steps.length >= 3);
    assert.ok(plan.steps.length <= 8);

    const mapsTitles = plan.steps.filter((s) => /improve maps visibility for/i.test(s.title));
    assert.equal(mapsTitles.length, 0, 'must not emit per-keyword Maps spam');

    const mapPack = plan.steps.filter((s) => /map pack|maps/i.test(s.title));
    assert.ok(mapPack.length <= 1, 'at most one consolidated Maps strategy step');

    assert.ok(plan.steps.some((s) => /google business profile|place id/i.test(s.title)));
    assert.ok(plan.steps.some((s) => /prestige flooring/i.test(s.title)));
    assert.ok(plan.steps.every((s) => s.how), 'each step needs a concrete how');
  });

  test('with GBP + reviews emits reply and photo actions when needed', () => {
    const plan = fallbackPlan({
      profileSnapshot: { city: 'Camas', vertical: 'Flooring' },
      scores: { overall: 55, mapsScore: 60, gbpScore: 40, reviewScore: 45 },
      keywordRanks: [{ keyword: 'Flooring Camas', mapsRank: 2 }],
      competitors: [],
      gbp: {
        photos: 2,
        category: 'Flooring store',
        checks: { hasHours: true, hasDescription: false, photos: 2 },
        votes: 12,
      },
      reviews: { rating: 4.6, votes: 12, unanswered: 3, fetched: 10 },
    });

    assert.ok(plan.steps.some((s) => /description/i.test(s.title)));
    assert.ok(plan.steps.some((s) => /photo/i.test(s.title)));
    assert.ok(plan.steps.some((s) => /unanswered/i.test(s.title)));
    assert.ok(plan.steps.some((s) => /review request/i.test(s.title)));
  });
});
