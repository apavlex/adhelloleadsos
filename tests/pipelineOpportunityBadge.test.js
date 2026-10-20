const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  getAiAuditGap10,
  calculateClientOpportunityScore,
  getUnifiedClientScore,
  buildPipelineOpportunityBadge,
  renderPipelineOpportunityBadge,
} = require('../services/pipelineOpportunityBadge');

const ROOT = path.join(__dirname, '..');

describe('pipelineOpportunityBadge', () => {
  it('prefers AI audit gap score when present', () => {
    assert.equal(getAiAuditGap10({ aiWebsiteAnalysisScore: 1 }), 1);
    assert.equal(getAiAuditGap10({ aiWebsiteAnalysisScore: 90 }), 1); // legacy health → gap
    assert.equal(
      getUnifiedClientScore({
        aiWebsiteAnalysisScore: 1,
        website: 'https://example.com',
        reviewsCount: 0,
      }),
      1,
    );
  });

  it('falls back to rules score from contact gaps', () => {
    const score = calculateClientOpportunityScore(
      {
        website: 'https://example.com',
        reviewsCount: 2,
        facebook: 'N/A',
        instagram: 'N/A',
      },
      { lowReviewsThreshold: 30 },
    );
    assert.ok(score >= 2.5);
    assert.equal(getAiAuditGap10({}), null);
  });

  it('SSR HTML includes score and gap labels (no Scoring placeholder)', () => {
    const { html, gapLabels, score } = buildPipelineOpportunityBadge(
      {
        website: 'https://example.com',
        reviewsCount: 5,
        facebook: 'N/A',
        instagram: 'N/A',
      },
      { lowReviewsThreshold: 30 },
    );
    assert.ok(score > 0);
    assert.ok(gapLabels.includes('WEAK SOCIAL'));
    assert.ok(gapLabels.includes('LOW REVIEWS'));
    assert.match(html, /\d+\/10/);
    assert.match(html, /WEAK SOCIAL/);
    assert.equal(html.includes('Scoring'), false);
    assert.equal(typeof renderPipelineOpportunityBadge({}, { lowReviewsThreshold: 30 }), 'string');
  });

  it('pipeline rows render Opportunity from persisted score helpers', () => {
    const ejs = fs.readFileSync(path.join(ROOT, 'views/partials/pipeline_lead_rows.ejs'), 'utf8');
    assert.match(ejs, /buildPipelineOpportunityBadge|renderPipelineOpportunityBadge/);
    assert.match(ejs, /data-opportunity-ready/);
    assert.ok(ejs.includes('<%- _oppHtml %>') || ejs.includes('<%-_oppHtml%>'));
  });
});
