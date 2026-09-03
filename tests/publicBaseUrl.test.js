const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  getPublicBaseUrl,
  getRequestOrigin,
  googleOAuthRedirectUris,
  normalizePublicOrigin,
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
});
