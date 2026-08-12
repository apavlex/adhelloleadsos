const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildWorkspaceContext,
  buildSystemPrompt,
  buildFolderOptimizerSystemPrompt,
  buildFolderOptimizerUserPrompt,
} = require('../services/ghlWorkflowCoach');

test('buildWorkspaceContext maps offer outreach metadata', () => {
  const ctx = buildWorkspaceContext({
    brandKit: { businessName: 'Agency Parent' },
    prospecting: { autoPool: { senderOfferKey: 'electric' } },
    salesScriptOfferCatalog: [
      {
        key: 'electric',
        label: 'Spark Electric Co',
        vertical: 'Electrical',
        senderBusinessName: 'Spark Electric Co',
        auditLink: 'https://example.com/audit',
      },
    ],
    salesScriptBlockOverrides: {
      electric: { opening: 'We help electricians get more emergency calls.' },
    },
  });
  assert.equal(ctx.brandName, 'Agency Parent');
  assert.equal(ctx.autoPoolSenderOfferKey, 'electric');
  assert.equal(ctx.offers.length, 1);
  assert.equal(ctx.offers[0].vertical, 'Electrical');
  assert.match(ctx.offers[0].pitch, /emergency calls/);
});

test('buildSystemPrompt includes sender focus and merge field guidance', () => {
  const ctx = buildWorkspaceContext({
    salesScriptOfferCatalog: [{ key: 'flooring', label: 'Premier Flooring', vertical: 'Flooring' }],
  });
  const prompt = buildSystemPrompt(ctx, 'flooring');
  assert.match(prompt, /auto-outreach/);
  assert.match(prompt, /AdHello Sender Business/);
  assert.match(prompt, /Premier Flooring/);
  assert.match(prompt, /workflowPrompt/);
});

test('buildFolderOptimizerSystemPrompt includes folder goal and sender focus', () => {
  const ctx = buildWorkspaceContext({
    salesScriptOfferCatalog: [{ key: 'flooring', label: 'Premier Flooring', vertical: 'Flooring' }],
  });
  const prompt = buildFolderOptimizerSystemPrompt(ctx, {
    folderName: 'Dallas Flooring',
    senderOfferKey: 'flooring',
    ghlGoal: 'Book in-home flooring estimates',
  });
  assert.match(prompt, /Book in-home flooring estimates/);
  assert.match(prompt, /Dallas Flooring/);
  assert.match(prompt, /Premier Flooring/);
  assert.match(prompt, /do NOT keep generic agency/i);
});

test('buildFolderOptimizerUserPrompt embeds goal and base prompt', () => {
  const user = buildFolderOptimizerUserPrompt({
    basePrompt: 'TRIGGER: auto-outreach',
    ghlGoal: 'Book flooring estimates',
    folderName: 'Flooring Leads',
  });
  assert.match(user, /Book flooring estimates/);
  assert.match(user, /Flooring Leads/);
  assert.match(user, /TRIGGER: auto-outreach/);
});
