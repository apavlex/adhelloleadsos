const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeSocialUrl,
  sanitizeExtractSocials,
  sanitizeLeadSocialPatch,
} = require('../services/socialUrlNormalize');
const { renderLinks, linkHtml } = require('../services/socialBrandIcons');
const { firecrawlExtractToLeadUpdates } = require('../services/enrichmentNormalize');

test('normalizeSocialUrl rejects comma-only and city/state garbage', () => {
  assert.equal(normalizeSocialUrl(',', 'facebook'), '');
  assert.equal(normalizeSocialUrl('Portland, OR', 'facebook'), '');
  assert.equal(normalizeSocialUrl(', OR', 'instagram'), '');
});

test('normalizeSocialUrl accepts full URLs and plain handles', () => {
  assert.equal(
    normalizeSocialUrl('https://facebook.com/cascadehomesolutions', 'facebook'),
    'https://facebook.com/cascadehomesolutions',
  );
  assert.equal(normalizeSocialUrl('cascadehomesolutions', 'instagram'), 'https://www.instagram.com/cascadehomesolutions/');
  assert.equal(normalizeSocialUrl('@CascadeHome', 'twitter'), 'https://x.com/CascadeHome');
});

test('normalizeSocialUrl rejects wrong-platform hosts', () => {
  assert.equal(normalizeSocialUrl('https://instagram.com/acme', 'facebook'), '');
});

test('sanitizeExtractSocials strips invalid social fields', () => {
  const out = sanitizeExtractSocials({
    facebook: ',',
    instagram: 'https://instagram.com/acme',
    twitter: 'Portland, OR',
    email: 'hello@example.com',
  });
  assert.equal(out.facebook, undefined);
  assert.equal(out.instagram, 'https://instagram.com/acme');
  assert.equal(out.twitter, undefined);
  assert.equal(out.email, 'hello@example.com');
});

test('firecrawlExtractToLeadUpdates sanitizes social fields', () => {
  const patch = firecrawlExtractToLeadUpdates({
    facebook: ',',
    linkedin: 'https://www.linkedin.com/company/acme',
    phone: '503-555-0100',
  });
  assert.equal(patch.facebook, undefined);
  assert.equal(patch.linkedin, 'https://www.linkedin.com/company/acme');
  assert.equal(patch.phone, '503-555-0100');
});

test('renderLinks skips invalid social hrefs', () => {
  const html = renderLinks({
    fb: ',',
    ig: 'https://instagram.com/acme',
    tw: 'Portland, OR',
    li: 'https://www.linkedin.com/company/acme',
    gradSuffix: 'bad',
  });
  assert.doesNotMatch(html, /facebook\.com/);
  assert.match(html, /instagram\.com\/acme/);
  assert.doesNotMatch(html, /x\.com/);
  assert.match(html, /linkedin\.com\/company\/acme/);
});

test('linkHtml returns empty string for malformed href', () => {
  assert.equal(linkHtml('facebook', ','), '');
  assert.match(linkHtml('instagram', 'https://instagram.com/valid'), /instagram\.com\/valid/);
});

test('sanitizeLeadSocialPatch keeps only valid social URLs', () => {
  const patch = sanitizeLeadSocialPatch({
    facebook: 'fb.com/acme',
    twitter: 'N/A',
    instagram: ' ',
  });
  assert.match(patch.facebook, /^https:\/\/fb\.com\/acme/);
  assert.equal(patch.twitter, undefined);
  assert.equal(patch.instagram, undefined);
});
