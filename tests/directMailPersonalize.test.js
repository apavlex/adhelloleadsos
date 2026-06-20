const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  applyMergeFields,
  buildMergeContext,
  resolveAuditUrl,
  hasMergeTokens,
  wrapImageWithPersonalizedOverlay,
} = require('../services/directMailPersonalize');
const { buildPostcardHtml } = require('../services/lobDirectMail');

const sampleLead = {
  title: 'Blue Ridge Plumbing',
  city: 'Asheville',
  state: 'NC',
  stitchDesignUrl: 'https://example.com/site-preview',
};

test('applyMergeFields substitutes business, city, state, and audit_url', () => {
  const out = applyMergeFields(
    'Hi {business} in {city}, {state} — {audit_url}',
    sampleLead,
  );
  assert.match(out, /Blue Ridge Plumbing/);
  assert.match(out, /Asheville/);
  assert.match(out, /NC/);
  assert.match(out, /example\.com\/site-preview/);
});

test('resolveAuditUrl prefers stitch design URL', () => {
  assert.equal(resolveAuditUrl(sampleLead), 'https://example.com/site-preview');
  assert.equal(resolveAuditUrl({ website: 'https://biz.com' }), 'https://biz.com');
});

test('hasMergeTokens detects placeholders', () => {
  assert.equal(hasMergeTokens('Hello {business}'), true);
  assert.equal(hasMergeTokens('Hello world'), false);
});

test('buildPostcardHtml uses merged copy per lead', () => {
  const html = buildPostcardHtml({
    lead: sampleLead,
    headline: 'Ready, {business}?',
    bodyText: 'See your site in {city}.',
    ctaUrl: '{audit_url}',
  });
  assert.match(html.front, /Ready, Blue Ridge Plumbing/);
  assert.match(html.front, /See your site in Asheville/);
  assert.match(html.front, /example\.com\/site-preview/);
});

test('wrapImageWithPersonalizedOverlay includes business in HTML', () => {
  const html = wrapImageWithPersonalizedOverlay('https://cdn.example.com/postcard.jpg', {
    lead: sampleLead,
    headline: 'Your site is ready',
    bodyText: 'Custom preview for {business}',
    ctaUrl: '{audit_url}',
    showOverlay: true,
  });
  assert.match(html, /Blue Ridge Plumbing/);
  assert.match(html, /cdn\.example\.com\/postcard\.jpg/);
  assert.match(html, /Prepared for/);
});
