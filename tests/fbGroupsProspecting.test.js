const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isFacebookGroupUrl,
  canonicalizeGroupUrl,
  normalizeUrl,
  titleFromGroupUrl,
} = require('../routes/fbGroups');
const { listFbGroupScriptsFlat, FB_GROUP_SCRIPT_CATEGORIES } = require('../config/fbGroupScripts');
const { generatePostIdeas } = require('../services/socialPostIdeas');

describe('fb group URL helpers', () => {
  it('accepts facebook group URLs and rejects pages', () => {
    assert.equal(isFacebookGroupUrl('https://www.facebook.com/groups/vancouverflooring'), true);
    assert.equal(isFacebookGroupUrl('https://m.facebook.com/groups/123456/'), true);
    assert.equal(isFacebookGroupUrl('https://www.facebook.com/SomeBusinessPage'), false);
    assert.equal(isFacebookGroupUrl('https://instagram.com/groups/foo'), false);
  });

  it('normalizes and canonicalizes group URLs', () => {
    assert.equal(
      canonicalizeGroupUrl(normalizeUrl('facebook.com/groups/my-group/?ref=share')),
      'https://www.facebook.com/groups/my-group',
    );
    assert.match(titleFromGroupUrl('https://www.facebook.com/groups/my-cool-group'), /My Cool Group/i);
  });
});

describe('fb group script pack', () => {
  it('exposes educational categories with copyable bodies', () => {
    assert.ok(FB_GROUP_SCRIPT_CATEGORIES.length >= 3);
    const flat = listFbGroupScriptsFlat();
    assert.ok(flat.length >= 6);
    assert.ok(flat.every((s) => s.body && s.title && s.categoryId));
    assert.ok(flat.some((s) => s.categoryId === 'educational'));
  });
});

describe('social post ideas include facebook_group educational templates', () => {
  it('generates facebook_group ideas for agency and business presets', () => {
    const agency = generatePostIdeas('flooring', null, { isAgencyWorkspace: true });
    assert.ok(Array.isArray(agency.facebook_group) && agency.facebook_group.length > 0);
    assert.ok(agency.facebook_group.every((i) => i.educational === true && i.group === true));
    assert.ok(agency.facebook.every((i) => i.educational === true));

    const biz = generatePostIdeas('flooring', 'facebook_group', { isAgencyWorkspace: false });
    assert.ok(Array.isArray(biz.facebook_group) && biz.facebook_group.length > 0);
  });
});
