const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  hostFromWebsite,
  isConfigured,
  resolveCredentials,
} = require('../services/dataForSeoClient');
const {
  seedKeywords,
  buildNextSteps,
  heuristicSnapshot,
  runAiVisibilityScan,
  markNextStepDone,
} = require('../services/aiVisibilityScan');

describe('dataForSeoClient helpers', () => {
  test('hostFromWebsite strips protocol and www', () => {
    assert.equal(hostFromWebsite('https://www.AcmeFlooring.com/about'), 'acmeflooring.com');
    assert.equal(hostFromWebsite('acmeflooring.com'), 'acmeflooring.com');
  });

  test('isConfigured requires login and password', () => {
    assert.equal(isConfigured({}), false);
    assert.equal(isConfigured({ DATAFORSEO_LOGIN: 'a@b.com' }), false);
    assert.equal(
      isConfigured({ DATAFORSEO_LOGIN: 'a@b.com', DATAFORSEO_API_PASSWORD: 'secret' }),
      true,
    );
    assert.equal(resolveCredentials({ DATAFORSEO_LOGIN: ' x ' }).login, 'x');
  });
});

describe('aiVisibilityScan', () => {
  test('heuristic scan produces engines, local, and next steps without DataForSEO', async () => {
    const lead = {
      title: 'TPR Flooring',
      website: 'https://tprflooring.com',
      city: 'Portland',
      state: 'OR',
      rating: 4.6,
      reviewsCount: 80,
    };
    const result = await runAiVisibilityScan(lead, { integrationEnv: {} });
    assert.equal(result.source, 'heuristic');
    assert.ok(result.snapshot.score >= 0 && result.snapshot.score <= 100);
    assert.ok(result.snapshot.engines.some((e) => e.id === 'local_map_pack'));
    assert.ok(result.snapshot.nextSteps.length >= 2);
    assert.ok(result.jobId);
    assert.match(result.warnings[0] || '', /DataForSEO/i);
  });

  test('seed keywords and mark done', () => {
    const kws = seedKeywords({ title: 'Acme Flooring', city: 'Portland', category: 'Flooring' });
    assert.ok(kws.length >= 2);
    const snap = heuristicSnapshot({
      title: 'Acme',
      website: 'https://acme.com',
      reviewsCount: 5,
    });
    snap.nextSteps = buildNextSteps({ snapshot: snap, lead: { website: 'https://acme.com' }, source: 'heuristic' });
    const updated = markNextStepDone(snap, 1, true);
    assert.equal(updated.nextSteps[0].done, true);
  });
});
