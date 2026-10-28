const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { buildGapRows, summarizeGaps } = require('../services/seoGapEngine');
const { fallbackPlan } = require('../services/seoActionPlanner');
const {
  parseCompetitorDomainItems,
  parseIntersectionAsCompetitorRanks,
} = require('../services/seoGapParse');

describe('seoGapEngine', () => {
  test('builds missing and weaker gaps with opportunity scores', () => {
    const gaps = buildGapRows({
      youRankings: [
        { keyword: 'hardwood floors portland', position: 18, volume: 500, kd: 40 },
        { keyword: 'flooring near me', position: 4, volume: 1200, kd: 55 },
      ],
      competitorRankings: [
        {
          domain: 'floors.com',
          keyword: 'hardwood floors portland',
          position: 3,
          volume: 500,
          kd: 40,
          etv: 80,
        },
        {
          domain: 'floors.com',
          keyword: 'engineered hardwood portland',
          position: 2,
          volume: 300,
          kd: 35,
          etv: 60,
        },
        {
          domain: 'floors.com',
          keyword: 'flooring near me',
          position: 8,
          volume: 1200,
          kd: 55,
        },
      ],
    });
    assert.ok(gaps.some((g) => g.gapType === 'missing' && g.keyword.includes('engineered')));
    assert.ok(gaps.some((g) => g.gapType === 'weaker' && g.keyword.includes('hardwood')));
    assert.ok(!gaps.some((g) => g.keyword === 'flooring near me')); // you win → protect skipped
    const summary = summarizeGaps(gaps);
    assert.equal(summary.total, gaps.length);
    assert.ok(gaps[0].opportunityScore >= gaps[gaps.length - 1].opportunityScore);
  });

  test('fallback plan cites stored keywords', () => {
    const plan = fallbackPlan({
      seedDomain: 'acme.com',
      gapRows: [
        {
          keyword: 'acme flooring',
          gapType: 'missing',
          youPos: null,
          rivalPos: 2,
          rivalDomain: 'floors.com',
          volume: 200,
          kd: 30,
          opportunityScore: 72,
        },
      ],
    });
    assert.equal(plan.source, 'rules');
    assert.ok(plan.steps[0].title.includes('acme flooring'));
  });
});

describe('seoGapSync parsers', () => {
  test('parse competitor and intersection payloads', () => {
    const comps = parseCompetitorDomainItems({
      tasks: [
        {
          result: [
            {
              items: [
                { domain: 'www.Floors.com', avg_position: 12, intersections: 40, etv: 900 },
                { domain: 'acme.com', avg_position: 5, intersections: 10 },
              ],
            },
          ],
        },
      ],
    });
    assert.equal(comps[0].domain, 'floors.com');

    const ranks = parseIntersectionAsCompetitorRanks(
      {
        tasks: [
          {
            result: [
              {
                items: [
                  {
                    keyword_data: {
                      keyword: 'Best Flooring',
                      keyword_info: { search_volume: 100, cpc: 2.1 },
                      keyword_properties: { keyword_difficulty: 33 },
                    },
                    first_domain_serp_element: {
                      serp_item: { rank_group: 4, url: 'https://floors.com/x' },
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
      'floors.com',
    );
    assert.equal(ranks[0].keyword, 'best flooring');
    assert.equal(ranks[0].position, 4);
    assert.equal(ranks[0].domain, 'floors.com');
  });
});
