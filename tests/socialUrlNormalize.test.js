const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeSocialUrl,
  isLikelyBusinessSocialUrl,
  buildRejectedSocialCleanupPatch,
  sanitizeExtractSocials,
  sanitizeExtractSocialsForLead,
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

test('business-aware social validation rejects roots, hosting vendors, and unrelated profiles', () => {
  const lead = {
    title: 'Buildex Construction',
    website: 'https://buildexconstructionnw.com',
  };
  assert.equal(isLikelyBusinessSocialUrl('https://facebook.com/', 'facebook', lead), false);
  assert.equal(isLikelyBusinessSocialUrl('https://instagram.com/wix', 'instagram', lead), false);
  assert.equal(
    isLikelyBusinessSocialUrl('https://x.com/randomwebdesigner', 'twitter', lead),
    false,
  );
  assert.equal(
    isLikelyBusinessSocialUrl(
      'https://instagram.com/buildexconstructionnw',
      'instagram',
      lead,
    ),
    true,
  );
});

test('sanitizeExtractSocialsForLead keeps only profiles tied to business identity', () => {
  const out = sanitizeExtractSocialsForLead(
    {
      facebook: 'https://facebook.com/wix',
      instagram: 'https://instagram.com/buildexconstructionnw',
      twitter: 'https://x.com/webflow',
      email: 'buildexnw@gmail.com',
    },
    {
      title: 'Buildex Construction',
      website: 'buildexconstructionnw.com',
    },
  );
  assert.equal(out.facebook, undefined);
  assert.equal(out.instagram, 'https://instagram.com/buildexconstructionnw');
  assert.equal(out.twitter, undefined);
  assert.equal(out.email, 'buildexnw@gmail.com');
});

test('cleanup patch clears previously stored unrelated socials', () => {
  const patch = buildRejectedSocialCleanupPatch({
    title: 'Buildex Construction',
    website: 'buildexconstructionnw.com',
    facebook: 'https://facebook.com/wix',
    instagram: 'https://instagram.com/buildexconstructionnw',
    twitter: 'https://x.com/randomwebdesigner',
  });
  assert.deepEqual(patch, {
    facebook: '',
    twitter: '',
  });
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
