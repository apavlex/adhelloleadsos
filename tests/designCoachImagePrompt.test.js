const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isUnusableDesignImagePrompt,
  sanitizeDesignImagePrompt,
  userAskedForDesign,
  hasRichCreativeDirection,
  isVagueDesignBrief,
  isDesignCoachReasoningLeak,
  sanitizeDesignCoachReply,
  formatDesignCoachClarifyReply,
  formatDesignCoachReplyForDisplay,
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

test('treats industry-only cover requests as vague', () => {
  const brief =
    'Make a design for facebook cover highlight marketing for home services such as flooring, cabinets, electrician, hvac, etc.';
  assert.equal(userAskedForDesign(brief), true);
  assert.equal(isVagueDesignBrief(brief), true);
  assert.equal(hasRichCreativeDirection(brief), false);
});

test('detects rich creative direction', () => {
  const rich =
    'Photo style, navy and amber palette, lifestyle shot of a flooring installer in a bright kitchen, headline "Floors that sell the job" on the left.';
  assert.equal(hasRichCreativeDirection(rich), true);
  assert.equal(isVagueDesignBrief(rich), false);
});

test('strips model reasoning leaks from chat replies', () => {
  const leak =
    'We need answer based on developer user task. Need obey JSON only. Must null and ask 2-3 specific questions. Need valid JSON.';
  assert.equal(isDesignCoachReasoningLeak(leak), true);
  assert.equal(sanitizeDesignCoachReply(leak), '');
});

test('formats clarifying replies with line breaks', () => {
  const clarify = formatDesignCoachClarifyReply({ platformLabel: 'Facebook Cover' });
  assert.match(clarify, /Happy to help with your Facebook Cover/);
  assert.match(clarify, /\n1\. Photo/);
  assert.match(clarify, /\n2\. Main colors/);
  assert.match(clarify, /\n3\. /);

  const jammed =
    'Happy to help. A few questions: 1. Photo or illustration? 2. Main colors? 3. What’s the hero?';
  const formatted = formatDesignCoachReplyForDisplay(jammed);
  assert.match(formatted, /\n1\. /);
  assert.match(formatted, /\n2\. /);
  assert.match(formatted, /\n3\. /);
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
  assert.match(prompt, /Art direction/i);
  assert.doesNotMatch(prompt, /Null if still exploring/i);
});
