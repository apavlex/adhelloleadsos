const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateGeoMatch,
  evaluateNicheMatch,
  passesIcpAPlusGate,
  scoreToGrade,
  rulesOnlyScore,
  normalizeIcpReview,
  DEFAULT_MIN_ICP_SCORE,
} = require('../services/icpFitReview');

describe('icpFitReview', () => {
  test('scoreToGrade maps A+ / A thresholds', () => {
    assert.equal(scoreToGrade(9), 'A+');
    assert.equal(scoreToGrade(8), 'A');
    assert.equal(scoreToGrade(6.5), 'B');
    assert.equal(DEFAULT_MIN_ICP_SCORE, 8);
  });

  test('evaluateGeoMatch hard-rejects wrong state', () => {
    const r = evaluateGeoMatch(
      { city: 'Austin', state: 'TX' },
      { cities: ['sacramento'], states: ['CA'] },
    );
    assert.equal(r.geoMatch, false);
    assert.equal(r.hardReject, true);
  });

  test('evaluateGeoMatch accepts matching state', () => {
    const r = evaluateGeoMatch(
      { city: 'Sacramento', state: 'CA' },
      { cities: [], states: ['CA'] },
    );
    assert.equal(r.geoMatch, true);
    assert.equal(r.hardReject, false);
  });

  test('evaluateNicheMatch finds vertical overlap', () => {
    const r = evaluateNicheMatch(
      { title: 'Summit Flooring Co', category: 'Flooring contractor', website: '' },
      { vertical: 'Flooring', offerLabel: 'Local SEO for Flooring' },
      { icpKeyword: 'flooring', targetAudience: 'homeowners' },
    );
    assert.equal(r.nicheMatch, true);
  });

  test('evaluateNicheMatch uses folder name when offer vertical differs', () => {
    const r = evaluateNicheMatch(
      { title: 'Bay Area Water Damage Pros', category: 'Water damage restoration', website: '' },
      { vertical: 'Flooring', offerLabel: 'Local SEO for Flooring' },
      { icpKeyword: 'flooring', targetAudience: '' },
      { name: 'Water Restoration', goal: 'wholesale flooring specials for restorers' },
    );
    assert.equal(r.nicheMatch, true);
    assert.match(r.note, /Folder niche|Niche overlap/i);
  });

  test('passesIcpAPlusGate requires approve + min score', () => {
    assert.equal(
      passesIcpAPlusGate({ decision: 'approve', score: 8.5, grade: 'A' }, 8),
      true,
    );
    assert.equal(
      passesIcpAPlusGate({ decision: 'approve', score: 7, grade: 'B' }, 8),
      false,
    );
    assert.equal(
      passesIcpAPlusGate({ decision: 'reject', score: 9, grade: 'A+' }, 8),
      false,
    );
  });

  test('rulesOnlyScore rewards geo + niche', () => {
    const strong = rulesOnlyScore({
      geo: { geoMatch: true },
      niche: { nicheMatch: true },
      opportunityScore: 8,
    });
    const weak = rulesOnlyScore({
      geo: { geoMatch: false },
      niche: { nicheMatch: false },
      opportunityScore: 3,
    });
    assert.ok(strong >= 8);
    assert.ok(weak < 5);
  });

  test('normalizeIcpReview clamps fields', () => {
    const r = normalizeIcpReview({
      decision: 'approve',
      score: 12,
      reason: 'x'.repeat(500),
      nicheMatch: true,
      geoMatch: true,
      offerKey: 'flooring',
    });
    assert.equal(r.score, 10);
    assert.equal(r.grade, 'A+');
    assert.ok(r.reason.length <= 400);
  });
});
