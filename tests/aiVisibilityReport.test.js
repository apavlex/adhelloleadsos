const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { createAuditReportToken, verifyAuditReportToken } = require('../services/auditReportSign');
const {
  REPORT_TYPE,
  normalizeAiVisibilitySnapshot,
  sampleAiVisibilitySnapshot,
  createAiVisibilityShare,
  revokeShareMeta,
  shareAccessError,
  buildAiVisibilityClientViewModel,
  buildShareEmailStub,
  verifyAiVisibilityToken,
} = require('../services/aiVisibilityReport');

describe('aiVisibilityReport', () => {
  test('token type ai_visibility round-trips with version and jobId', () => {
    const token = createAuditReportToken({
      leadKey: 'lead:demo',
      workspaceId: 'ws1',
      type: REPORT_TYPE,
      jobId: 'job-9',
      version: 2,
      ttlMs: 86400000,
    });
    const payload = verifyAuditReportToken(token);
    assert.equal(payload.type, 'ai_visibility');
    assert.equal(payload.leadKey, 'lead:demo');
    assert.equal(payload.workspaceId, 'ws1');
    assert.equal(payload.jobId, 'job-9');
    assert.equal(payload.version, 2);
    assert.equal(verifyAiVisibilityToken(token).type, 'ai_visibility');
    assert.equal(verifyAiVisibilityToken(createAuditReportToken({
      leadKey: 'lead:x',
      workspaceId: 'w',
      type: 'website',
    })), null);
  });

  test('normalize and sample snapshot include local + engines + next steps', () => {
    const sample = sampleAiVisibilitySnapshot({ title: 'TPR Flooring' });
    assert.equal(sample.businessName, 'TPR Flooring');
    assert.ok(sample.score >= 0 && sample.score <= 100);
    assert.ok(sample.engines.some((e) => e.id === 'local_map_pack'));
    assert.ok(sample.local.gbpCompleteness > 0);
    assert.ok(sample.nextSteps.length >= 3);

    const normalized = normalizeAiVisibilitySnapshot({
      score: 150,
      engines: [{ label: 'ChatGPT', pct: 10 }],
      nextSteps: [{ action: 'Fix NAP', impact: 'High', why: 'mismatch' }],
    }, { title: 'Co' });
    assert.equal(normalized.score, 100);
    assert.equal(normalized.nextSteps[0].title, 'Fix NAP');
  });

  test('share create / revoke gates access', () => {
    const minted = createAiVisibilityShare({
      leadKey: 'lead:1',
      workspaceId: 'w1',
      version: 1,
      baseUrl: 'https://app.example.com',
    });
    assert.match(minted.reportUrl, /^https:\/\/app\.example\.com\/ai-visibility\/report\//);
    assert.equal(minted.share.version, 1);
    assert.equal(minted.share.revokedAt, '');

    const payload = verifyAiVisibilityToken(minted.token);
    const leadOk = {
      workspaceId: 'w1',
      aiVisibilityReport: {
        allowSample: true,
        share: minted.share,
        snapshot: sampleAiVisibilitySnapshot({ title: 'Acme' }),
      },
    };
    assert.equal(shareAccessError(payload, leadOk), null);

    const revokedShare = revokeShareMeta(minted.share);
    assert.equal(revokedShare.version, 2);
    assert.ok(revokedShare.revokedAt);
    assert.equal(
      shareAccessError(payload, { ...leadOk, aiVisibilityReport: { ...leadOk.aiVisibilityReport, share: revokedShare } }),
      'revoked',
    );
  });

  test('client view model is read-only and email stub has link', () => {
    const lead = {
      title: 'Acme Flooring',
      contactName: 'Brandon Edwards',
      aiVisibilityReport: {
        allowSample: true,
        share: { version: 1, expiresAt: '2026-12-01T00:00:00.000Z' },
        snapshot: sampleAiVisibilitySnapshot({ title: 'Acme Flooring' }),
      },
    };
    const vm = buildAiVisibilityClientViewModel(lead, {
      reportUrl: 'https://app.example.com/ai-visibility/report/tok',
      agencyName: 'AdHello Agency',
      workspaceAccent: '#0f766e',
    });
    assert.equal(vm.mode, 'client');
    assert.equal(vm.agencyName, 'AdHello Agency');
    assert.ok(vm.engines.length);
    assert.ok(vm.local);
    assert.ok(vm.nextSteps.length);
    assert.match(vm.followUpEmail.subject, /Acme Flooring/);
    assert.match(vm.followUpEmail.body, /ai-visibility\/report\/tok/);
    assert.doesNotMatch(vm.followUpEmail.body, /Settings|Refresh|Mark done/i);

    const email = buildShareEmailStub({
      businessName: 'Acme',
      contactFirstName: 'Brandon',
      reportUrl: 'https://x.test/r',
      score: 61,
      topNextStep: 'Respond to reviews',
      expiryDate: '2026-12-01T00:00:00.000Z',
      agencyName: 'AdHello',
    });
    assert.match(email.body, /Respond to reviews/);
    assert.match(email.body, /https:\/\/x\.test\/r/);
  });
});
