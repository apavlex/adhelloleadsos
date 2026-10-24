const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  getPublicBaseUrl,
  getReviewPublicBaseUrl,
  getReviewsAppSignupUrl,
  getNetworkJoinUrl,
  getNetworkFlooringJoinUrl,
  getReviewPageUrl,
  getRequestOrigin,
  googleOAuthRedirectUris,
  normalizePublicOrigin,
  ADHELLO_REVIEW_PUBLIC_BASE,
} = require('../lib/publicBaseUrl');


describe('publicBaseUrl', () => {
  it('prefers BASE_URL from env when no request', () => {
    const prev = { base: process.env.BASE_URL, render: process.env.RENDER_EXTERNAL_URL };
    process.env.BASE_URL = 'https://app.example.com/';
    delete process.env.RENDER_EXTERNAL_URL;
    assert.equal(getPublicBaseUrl(), 'https://app.example.com');
    process.env.BASE_URL = prev.base;
    if (prev.render) process.env.RENDER_EXTERNAL_URL = prev.render;
    else delete process.env.RENDER_EXTERNAL_URL;
  });

  it('rewrites leads.adhello.ai to leads.adhello.io', () => {
    assert.equal(normalizePublicOrigin('https://leads.adhello.ai'), 'https://leads.adhello.io');
  });

  it('prefers request host over RENDER_EXTERNAL_URL so custom domains stick', () => {
    const prev = {
      base: process.env.BASE_URL,
      render: process.env.RENDER_EXTERNAL_URL,
    };
    process.env.BASE_URL = 'https://adhelloleadsos.onrender.com';
    process.env.RENDER_EXTERNAL_URL = 'https://adhelloleadsos.onrender.com';
    const req = {
      protocol: 'https',
      get(name) {
        if (name === 'host') return 'leads.adhello.io';
        if (name === 'x-forwarded-proto') return 'https';
        return '';
      },
    };
    assert.equal(getRequestOrigin(req), 'https://leads.adhello.io');
    assert.equal(getPublicBaseUrl(req), 'https://leads.adhello.io');
    process.env.BASE_URL = prev.base;
    if (prev.render) process.env.RENDER_EXTERNAL_URL = prev.render;
    else delete process.env.RENDER_EXTERNAL_URL;
  });

  it('builds drive and sign-in redirect URIs', () => {
    const uris = googleOAuthRedirectUris('https://leads.adhello.io');
    assert.equal(uris.signIn, 'https://leads.adhello.io/auth/google/callback');
    assert.equal(uris.drive, 'https://leads.adhello.io/auth/google/drive/callback');
  });

  it('brands review + reviews-app links to reviews.adhello.io even when BASE_URL is the CRM host', () => {
    const prev = {
      base: process.env.BASE_URL,
      review: process.env.REVIEW_PUBLIC_BASE_URL,
      publicBase: process.env.PUBLIC_BASE_URL,
      render: process.env.RENDER_EXTERNAL_URL,
    };
    process.env.BASE_URL = 'https://leads.adhello.io';
    delete process.env.REVIEW_PUBLIC_BASE_URL;
    delete process.env.PUBLIC_BASE_URL;
    delete process.env.RENDER_EXTERNAL_URL;
    assert.equal(ADHELLO_REVIEW_PUBLIC_BASE, 'https://reviews.adhello.io');
    assert.equal(getReviewPublicBaseUrl(), 'https://reviews.adhello.io');
    assert.equal(getReviewsAppSignupUrl(), 'https://reviews.adhello.io/app');
    assert.equal(getNetworkJoinUrl('tpr-flooring'), 'https://reviews.adhello.io/join/tpr-flooring');
    assert.equal(
      getNetworkFlooringJoinUrl('tpr-flooring'),
      'https://reviews.adhello.io/join/tpr-flooring/flooring',
    );
    assert.equal(getNetworkFlooringJoinUrl('Flooring'), 'https://reviews.adhello.io/join/flooring/flooring');
    assert.equal(getReviewPageUrl('brightline-electric'), 'https://reviews.adhello.io/rv/brightline-electric');
    assert.equal(
      require('../lib/publicBaseUrl').getBusinessVcardUrl('brightline-electric'),
      'https://reviews.adhello.io/c/brightline-electric.vcf',
    );
    process.env.REVIEW_PUBLIC_BASE_URL = 'https://reviews.adhello.io/';
    assert.equal(getReviewPageUrl('acme'), 'https://reviews.adhello.io/rv/acme');
    process.env.BASE_URL = prev.base;
    if (prev.review) process.env.REVIEW_PUBLIC_BASE_URL = prev.review;
    else delete process.env.REVIEW_PUBLIC_BASE_URL;
    if (prev.publicBase) process.env.PUBLIC_BASE_URL = prev.publicBase;
    else delete process.env.PUBLIC_BASE_URL;
    if (prev.render) process.env.RENDER_EXTERNAL_URL = prev.render;
    else delete process.env.RENDER_EXTERNAL_URL;
  });
});
