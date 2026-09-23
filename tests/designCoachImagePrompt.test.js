const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isUnusableDesignImagePrompt,
  sanitizeDesignImagePrompt,
  userAskedForDesign,
  buildFallbackDesignImagePrompt,
} = require('../services/designCoachImagePrompt');

const SCHEMA_LEAK =
  'null or a detailed English prompt ready for GPT image 2 — specify platform (Facebook Cover), 16:9 composition, typography zones, brand colors, mood. Include business contact details in the design when the user wants them on the ad. Null if still exploring.';

test('rejects schema instruction text that models copy into imagePrompt', () => {
  assert.equal(isUnusableDesignImagePrompt(SCHEMA_LEAK), true);
  assert.equal(sanitizeDesignImagePrompt(SCHEMA_LEAK), '');
  assert.equal(sanitizeDesignImagePrompt('null'), '');
  assert.equal(sanitizeDesignImagePrompt(null), '');
});

test('keeps a real production image prompt', () => {
  const real =
    'Facebook Cover 16:9. Bold headline for local service marketing. Warm photo of storefronts, clean amber accents, sharp mobile-readable type.';
  assert.equal(isUnusableDesignImagePrompt(real), false);
  assert.equal(sanitizeDesignImagePrompt(real), real);
});

test('detects make-me-a-cover requests', () => {
  assert.equal(
    userAskedForDesign(
      'Make me a facebook banner cover highlighting marketing and advertising for businesses like flooring, electricians, hvac and etc.',
    ),
    true,
  );
  assert.equal(userAskedForDesign('what colors work best?'), false);
});

test('fallback prompt includes the marketer direction and platform', () => {
  const prompt = buildFallbackDesignImagePrompt({
    userMessage: 'Make me a facebook banner cover for HVAC and flooring ads',
    platformLabel: 'Facebook Cover',
    aspectRatio: '16:9',
    headline: 'More service calls',
    bodyText: 'Quick wins for Maps and reviews',
    brandKitSummary: 'Business name: AdHello Agency',
  });
  assert.match(prompt, /Facebook Cover/);
  assert.match(prompt, /16:9/);
  assert.match(prompt, /HVAC and flooring/);
  assert.match(prompt, /AdHello Agency/);
  assert.doesNotMatch(prompt, /Null if still exploring/i);
});
