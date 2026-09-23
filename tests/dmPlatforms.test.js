const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DM_PLATFORMS,
  PLATFORM_IDS,
  platformLabel,
  platformAspectRatio,
  platformGenerationSpec,
} = require('../services/dmPlatforms');

const UI_FORMAT_IDS = [
  'postcard',
  'instagram_feed',
  'instagram_story',
  'instagram_portrait',
  'facebook_feed',
  'facebook_cover',
  'facebook_story',
  'linkedin_post',
  'linkedin_banner',
  'google_display',
  'google_business_post',
  'youtube_thumb',
  'custom',
];

test('every Marketing Studio format card has a platform preset', () => {
  UI_FORMAT_IDS.forEach((id) => {
    assert.ok(DM_PLATFORMS[id], `missing platform preset for ${id}`);
    assert.ok(platformLabel(id), `missing label for ${id}`);
    assert.ok(platformGenerationSpec(id, 'front').trim(), `missing generation spec for ${id}`);
  });
  assert.deepEqual(PLATFORM_IDS.slice().sort(), UI_FORMAT_IDS.slice().sort());
});

test('social formats are single-sided with fixed aspect ratios', () => {
  UI_FORMAT_IDS.filter((id) => id !== 'postcard' && id !== 'custom').forEach((id) => {
    assert.equal(DM_PLATFORMS[id].dualSided, false, id);
    assert.ok(DM_PLATFORMS[id].aspectRatio, id);
  });
  assert.equal(DM_PLATFORMS.postcard.dualSided, true);
  assert.equal(platformAspectRatio('facebook_cover'), '16:9');
  assert.equal(platformAspectRatio('instagram_story'), '9:16');
  assert.equal(platformAspectRatio('google_business_post'), '4:3');
  assert.equal(platformAspectRatio('custom', '1:1'), '1:1');
});

test('postcard back uses CTA layout, not front footer language', () => {
  const back = platformGenerationSpec('postcard', 'back');
  assert.match(back, /BACK/i);
  assert.match(back, /CTA/i);
  assert.doesNotMatch(platformGenerationSpec('facebook_cover', 'front'), /postcard BACK/i);
  assert.match(platformGenerationSpec('facebook_cover', 'front'), /Facebook Cover/i);
  assert.match(platformGenerationSpec('youtube_thumb', 'front'), /YouTube/i);
});
