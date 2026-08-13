const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildWorkspaceContext,
  buildSystemPrompt,
  buildFolderOptimizerSystemPrompt,
  buildFolderOptimizerUserPrompt,
  inferFolderOutreachIntent,
  promptLooksOffGoal,
  buildGoalAlignedWorkflowPrompt,
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

test('inferFolderOutreachIntent detects wholesale flooring specials', () => {
  const intent = inferFolderOutreachIntent(
    'Offer flooring, cabinets, countertops at wholesale prices. Try to get their interest to get a list of our weekly specials',
    { label: 'Wholesale Floors', vertical: 'Flooring' },
  );
  assert.equal(intent.vertical, 'flooring');
  assert.equal(intent.ctaStyle, 'specials_list');
  assert.equal(intent.forbidGenericOnlinePitch, true);
});

test('promptLooksOffGoal flags generic agency copy for flooring specials', () => {
  const intent = inferFolderOutreachIntent(
    'Offer flooring wholesale weekly specials',
    null,
  );
  assert.equal(
    promptLooksOffGoal(
      'I noticed {{contact.company_name}} may have room to improve online. Free quick scan. Reviews App variant.',
      intent,
    ),
    true,
  );
  assert.equal(
    promptLooksOffGoal(
      'Wholesale flooring specials list for {{contact.company_name}}. Reply YES for the list.',
      intent,
    ),
    false,
  );
});

test('buildGoalAlignedWorkflowPrompt centers flooring specials not site audits', () => {
  const intent = inferFolderOutreachIntent(
    'Offer flooring, cabinets, countertops at wholesale prices. Get interest in weekly specials',
    { label: 'Premier Flooring', vertical: 'Flooring', pitch: 'Wholesale materials weekly.' },
  );
  const prompt = buildGoalAlignedWorkflowPrompt({
    folderName: 'Flooring Leads',
    ghlGoal: intent.goal,
    focusOffer: { label: 'Premier Flooring', vertical: 'Flooring', pitch: 'Wholesale materials weekly.' },
    intent,
  });
  assert.match(prompt, /weekly specials/i);
  assert.match(prompt, /flooring/i);
  assert.doesNotMatch(prompt, /may have room to improve online/i);
  assert.doesNotMatch(prompt, /REVIEWS APP/i);
});

test('buildFolderOptimizerSystemPrompt includes folder goal and bans generic online pitch', () => {
  const ctx = buildWorkspaceContext({
    salesScriptOfferCatalog: [{ key: 'flooring', label: 'Premier Flooring', vertical: 'Flooring' }],
  });
  const intent = inferFolderOutreachIntent('Book in-home flooring estimates', {
    key: 'flooring',
    label: 'Premier Flooring',
    vertical: 'Flooring',
  });
  const prompt = buildFolderOptimizerSystemPrompt(ctx, {
    folderName: 'Dallas Flooring',
    senderOfferKey: 'flooring',
    ghlGoal: 'Book in-home flooring estimates',
    intent,
  });
  assert.match(prompt, /Book in-home flooring estimates/);
  assert.match(prompt, /Dallas Flooring/);
  assert.match(prompt, /Premier Flooring/);
  assert.match(prompt, /improve online/i);
  assert.match(prompt, /NOT a multi-business encyclopedia/i);
});

test('buildFolderOptimizerUserPrompt embeds goal without requiring full base rewrite', () => {
  const user = buildFolderOptimizerUserPrompt({
    ghlGoal: 'Book flooring estimates',
    folderName: 'Flooring Leads',
    focusOffer: { label: 'Premier Flooring', vertical: 'Flooring' },
    intent: inferFolderOutreachIntent('Book flooring estimates', {
      label: 'Premier Flooring',
      vertical: 'Flooring',
    }),
    structureHint: 'TRIGGER: auto-outreach',
  });
  assert.match(user, /Book flooring estimates/);
  assert.match(user, /Flooring Leads/);
  assert.match(user, /TRIGGER: auto-outreach/);
  assert.match(user, /Create a GHL auto-outreach/);
});
