const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseSummaryResult,
  parseReferringDomainItems,
  parseAnchorItems,
  computeCompetitorLinkGaps,
} = require('../services/backlinksParse');

describe('backlinksParse', () => {
  test('parseSummaryResult maps DFS summary fields', () => {
    const s = parseSummaryResult({
      backlinks: 1200,
      referring_domains: 340,
      referring_main_domains: 300,
      rank: 422,
      backlinks_spam_score: 12,
      broken_backlinks: 3,
    });
    assert.equal(s.backlinks, 1200);
    assert.equal(s.referringDomains, 340);
    assert.equal(s.rank, 422);
  });

  test('computeCompetitorLinkGaps finds domains you lack', () => {
    const gaps = computeCompetitorLinkGaps({
      yourReferring: [{ domain: 'news.com', rank: 100, backlinks: 2 }],
      competitorProfiles: [
        {
          domain: 'rival.com',
          referringDomains: [
            { domain: 'news.com', rank: 90, backlinks: 1 },
            { domain: 'industry-blog.com', rank: 200, backlinks: 5 },
            { domain: 'WWW.Industry-Blog.com', rank: 180, backlinks: 2 },
          ],
        },
      ],
    });
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].domain, 'industry-blog.com');
    assert.deepEqual(gaps[0].competitors, ['rival.com']);
    assert.ok(gaps[0].opportunityScore > 0);
  });

  test('parse referring and anchors', () => {
    const refs = parseReferringDomainItems([
      { domain: 'a.com', rank: 10, backlinks: 3, referring_pages: 2 },
      { domain: '', backlinks: 1 },
    ]);
    assert.equal(refs.length, 1);
    assert.equal(refs[0].domain, 'a.com');
    const anchors = parseAnchorItems([{ anchor: 'best plumber', backlinks: 4, referring_domains: 2 }]);
    assert.equal(anchors[0].anchor, 'best plumber');
  });
});
