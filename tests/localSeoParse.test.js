const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  findBusinessInMapsItems,
  parseGbpInfo,
  parseReviews,
  scoreLocalResearch,
  defaultKeywords,
  extractLocalPackFromOrganic,
} = require('../services/localSeoParse');
const { fallbackPlan } = require('../services/localSeoPlanner');

describe('localSeoParse', () => {
  test('findBusinessInMapsItems matches by name', () => {
    const match = findBusinessInMapsItems(
      [
        { type: 'maps_search', title: 'Other Co', rank_group: 1, domain: 'other.com' },
        { type: 'maps_search', title: 'Acme Flooring', rank_group: 2, domain: 'acme.com', place_id: 'ChIJx' },
      ],
      { businessName: 'Acme Flooring LLC', website: 'https://www.acme.com' }
    );
    assert.equal(match.rank, 2);
    assert.equal(match.placeId, 'ChIJx');
  });

  test('scoreLocalResearch blends maps gbp reviews', () => {
    const scores = scoreLocalResearch({
      keywordRanks: [{ mapsRank: 2 }, { mapsRank: 3 }],
      gbp: { completeness: 80 },
      reviews: { rating: 4.8, votes: 100, unanswered: 2 },
    });
    assert.ok(scores.overall >= 50);
    assert.ok(scores.avgMapsRank >= 2 && scores.avgMapsRank <= 3);
  });

  test('parseGbpInfo and reviews', () => {
    const gbp = parseGbpInfo({
      tasks: [
        {
          result: [
            {
              items: [
                {
                  title: 'Acme',
                  phone: '555',
                  address: '1 Main',
                  url: 'https://acme.com',
                  category: 'Flooring',
                  work_hours: { timetable: { monday: [] } },
                  description: 'We install floors',
                  total_photos: 12,
                  rating: { value: 4.6, votes_count: 40 },
                },
              ],
            },
          ],
        },
      ],
    });
    assert.ok(gbp.completeness >= 70);
    const reviews = parseReviews({
      tasks: [
        {
          result: [
            {
              reviews_count: 40,
              rating: { value: 4.6 },
              items: [
                { rating: { value: 5 }, review_text: 'Great', owner_answer: 'Thanks' },
                { rating: { value: 4 }, review_text: 'Ok' },
              ],
            },
          ],
        },
      ],
    });
    assert.equal(reviews.unanswered, 1);
  });

  test('defaultKeywords and local pack extract', () => {
    const kws = defaultKeywords({ businessName: 'Acme', vertical: 'Flooring', city: 'Portland' });
    assert.ok(kws.some((k) => /Flooring Portland/i.test(k)));
    const pack = extractLocalPackFromOrganic(
      [
        {
          type: 'local_pack',
          items: [
            { title: 'Rival', rank_group: 1, domain: 'rival.com' },
            { title: 'Acme Flooring', rank_group: 2, domain: 'acme.com' },
          ],
        },
      ],
      { businessName: 'Acme Flooring', website: 'acme.com' }
    );
    assert.equal(pack.you.rank, 2);
  });

  test('fallbackPlan produces steps', () => {
    const plan = fallbackPlan({
      scores: { overall: 55, mapsScore: 40, gbpScore: 60, reviewScore: 50 },
      keywordRanks: [{ keyword: 'flooring portland', mapsRank: 8 }],
      gbp: { checks: { hasHours: false, hasDescription: false, photos: 2 } },
      reviews: { unanswered: 4, votes: 10 },
    });
    assert.ok(plan.steps.length >= 3);
  });
});
