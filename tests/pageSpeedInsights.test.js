const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeWebsiteUrl,
  parsePageSpeedResponse,
  buildOwnerSignalFromAudit,
} = require('../services/pageSpeedInsights');

test('normalizeWebsiteUrl adds https scheme', () => {
  assert.equal(normalizeWebsiteUrl('example.com'), 'https://example.com');
  assert.equal(normalizeWebsiteUrl('https://foo.com/path'), 'https://foo.com/path');
  assert.equal(normalizeWebsiteUrl(''), '');
  assert.equal(normalizeWebsiteUrl('N/A'), '');
});

test('parsePageSpeedResponse extracts category scores 0-100', () => {
  const sample = {
    lighthouseResult: {
      categories: {
        performance: { score: 0.72 },
        accessibility: { score: 0.91 },
        'best-practices': { score: 0.83 },
        seo: { score: 0.88 },
      },
      audits: {
        a: { score: 0.2, title: 'Reduce unused JavaScript' },
        b: { score: 0.95, title: 'Uses HTTPS' },
      },
    },
  };
  const { scores, averageScore, topIssues } = parsePageSpeedResponse(sample);
  assert.equal(scores.performance, 72);
  assert.equal(scores.accessibility, 91);
  assert.equal(scores.bestPractices, 83);
  assert.equal(scores.seo, 88);
  assert.equal(averageScore, 84);
  assert.ok(topIssues.includes('Reduce unused JavaScript'));
  assert.equal(topIssues.length, 1);
});

test('buildOwnerSignalFromAudit mentions weakest category', () => {
  const sig = buildOwnerSignalFromAudit('Acme Painting', {
    strategy: 'mobile',
    scores: { performance: 45, seo: 80, accessibility: 90, bestPractices: 70 },
    averageScore: 71,
  });
  assert.match(sig, /Acme Painting/);
  assert.match(sig, /performance.*45/i);
  assert.match(sig, /Weakest area: performance/i);
});
