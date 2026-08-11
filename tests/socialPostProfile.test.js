const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveSocialPostProfile,
  isAgencyOrLocalGuideWorkspace,
  marketingPlatformForSocial,
} = require('../services/socialPostProfile');
const { generatePostIdeas } = require('../services/socialPostIdeas');

test('resolveSocialPostProfile uses icpKeyword for flooring workspace', () => {
  const profile = resolveSocialPostProfile({
    name: 'Flooring Co',
    icpKeyword: 'flooring retail and installation',
    brandKit: { businessName: 'Pacific Floor & Design' },
    cwIntake: { businessDescription: 'Hardwood, LVP, and tile for homeowners and GCs' },
  });
  assert.match(profile.niche, /flooring/i);
  assert.equal(profile.isAgencyWorkspace, false);
  assert.equal(profile.showLocalContent, false);
  assert.equal(profile.businessName, 'Pacific Floor & Design');
});

test('resolveSocialPostProfile defaults to agency preset for AdHello workspace', () => {
  const profile = resolveSocialPostProfile({
    name: 'AdHello Agency',
    slug: 'adhello-agency',
    coachPrompt: 'You are coaching a digital ad agency owner',
  });
  assert.equal(profile.isAgencyWorkspace, true);
  assert.equal(profile.showLocalContent, true);
  assert.match(profile.niche, /AdHello|Clark/i);
});

test('isAgencyOrLocalGuideWorkspace detects Clark County by name', () => {
  assert.equal(isAgencyOrLocalGuideWorkspace({ name: 'Clark County Guide' }), true);
  assert.equal(isAgencyOrLocalGuideWorkspace({ name: 'Flooring Warehouse' }), false);
});

test('generatePostIdeas uses business templates for flooring niche', () => {
  const ideas = generatePostIdeas('flooring retail and installation', 'instagram', {
    isAgencyWorkspace: false,
  });
  assert.ok(ideas.instagram.length > 0);
  assert.match(ideas.instagram[0].hook, /flooring/i);
  assert.doesNotMatch(ideas.instagram[0].hook, /Google Maps/i);
});

test('generatePostIdeas uses agency templates for Clark County workspace', () => {
  const ideas = generatePostIdeas('AdHello agency and @ClarkCountyGuide', 'instagram', {
    isAgencyWorkspace: true,
  });
  assert.ok(ideas.instagram.length > 0);
  assert.match(ideas.instagram[0].hook, /Google/i);
});

test('marketingPlatformForSocial maps platforms', () => {
  assert.equal(marketingPlatformForSocial('instagram'), 'instagram_feed');
  assert.equal(marketingPlatformForSocial('linkedin'), 'linkedin_post');
  assert.equal(marketingPlatformForSocial('tiktok'), 'instagram_story');
});
