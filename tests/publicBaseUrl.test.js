const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getPublicBaseUrl, googleOAuthRedirectUris } = require('../lib/publicBaseUrl');

describe('publicBaseUrl', () => {
  it('prefers BASE_URL from env', () => {
    const prev = { base: process.env.BASE_URL, render: process.env.RENDER_EXTERNAL_URL };
    process.env.BASE_URL = 'https://app.example.com/';
    delete process.env.RENDER_EXTERNAL_URL;
    assert.equal(getPublicBaseUrl(), 'https://app.example.com');
    process.env.BASE_URL = prev.base;
    if (prev.render) process.env.RENDER_EXTERNAL_URL = prev.render;
  });

  it('builds drive and sign-in redirect URIs', () => {
    const uris = googleOAuthRedirectUris('https://leads.adhello.ai');
    assert.equal(uris.signIn, 'https://leads.adhello.ai/auth/google/callback');
    assert.equal(uris.drive, 'https://leads.adhello.ai/auth/google/drive/callback');
  });
});
