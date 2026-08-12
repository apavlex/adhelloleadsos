const test = require('node:test');
const assert = require('node:assert/strict');
const { catalogForPrompt, toolById } = require('../services/ghlToolsCatalog');
const { buildHeuristicReport, normalizeReport } = require('../services/geoSeoGhlAudit');
const { auditOpenRouterProviders, OPENROUTER_FREE_MODEL, OPENROUTER_FREE_ROUTER } = require('../services/llmClient');

test('ghlToolsCatalog exposes GHL tools for prompts', () => {
  const text = catalogForPrompt();
  assert.match(text, /reputation_management/);
  assert.match(text, /listings_seo/);
  assert.ok(toolById('websites_funnels'));
});

test('buildHeuristicReport returns sellable agency + GHL shape', () => {
  const r = buildHeuristicReport({
    title: 'Peninsula Electric Corp',
    city: 'Poulsbo',
    state: 'WA',
    categoryName: 'Electrician',
    reviewsCount: 88,
    totalScore: 4.7,
    aiWebsiteAnalysis: { siteHealth100: 62, topGapLabels: ['Slow mobile load'] },
    hasSchemaMarkup: false,
    isMobileFriendly: false,
  });
  assert.ok(r.overallScore >= 0 && r.overallScore <= 100);
  assert.ok(r.ghlRecommendations.length >= 4);
  assert.ok(r.agencyOffer.primaryServiceKey);
  assert.equal(typeof r.headline, 'string');
});

test('normalizeReport validates agency service keys', () => {
  const r = normalizeReport({
    overallScore: 72,
    grade: 'B',
    headline: 'Test',
    geoSeoScore: 70,
    conversionScore: 68,
    gaps: [{ area: 'SEO', severity: 'high', finding: 'x', impact: 'y' }],
    quickWins: ['a'],
    agencyOffer: { primaryServiceKey: 'not_a_real_key', rationale: 'r', talkTrack: 't' },
    ghlRecommendations: [{ toolId: 'reputation_management', toolName: 'Rep', priority: 1, why: 'w', whatToSell: 's', setupEffort: 'low' }],
    thirtyDayPlan: [{ week: 1, action: 'a', ghlTool: 'Rep' }],
  });
  assert.notEqual(r.agencyOffer.primaryServiceKey, 'not_a_real_key');
  assert.equal(r.ghlRecommendations[0].toolId, 'reputation_management');
});

test('auditOpenRouterProviders prefers free auto-router by default', () => {
  const prevKey = process.env.OPENROUTER_API_KEY;
  const prevAudit = process.env.OPENROUTER_AUDIT_MODEL;
  const prevPaid = process.env.OPENROUTER_ALLOW_PAID_FALLBACK;
  process.env.OPENROUTER_API_KEY = 'test-key';
  delete process.env.OPENROUTER_AUDIT_MODEL;
  delete process.env.OPENROUTER_MODEL;
  delete process.env.OPENROUTER_ALLOW_PAID_FALLBACK;
  try {
    const providers = auditOpenRouterProviders();
    assert.equal(providers.length, 2);
    assert.equal(providers[0].model, OPENROUTER_FREE_ROUTER);
    assert.equal(providers[1].model, OPENROUTER_FREE_MODEL);
  } finally {
    if (prevKey == null) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = prevKey;
    if (prevAudit == null) delete process.env.OPENROUTER_AUDIT_MODEL;
    else process.env.OPENROUTER_AUDIT_MODEL = prevAudit;
    if (prevPaid == null) delete process.env.OPENROUTER_ALLOW_PAID_FALLBACK;
    else process.env.OPENROUTER_ALLOW_PAID_FALLBACK = prevPaid;
  }
});
