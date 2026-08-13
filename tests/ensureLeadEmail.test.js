const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { hasUsableEmail, buildEmailPatch, normalizeWebsite } = require('../services/ensureLeadEmail');

describe('ensureLeadEmail helpers', () => {
  test('hasUsableEmail rejects empty and invalid', () => {
    assert.equal(hasUsableEmail({ email: '' }), false);
    assert.equal(hasUsableEmail({ email: 'N/A' }), false);
    assert.equal(hasUsableEmail({ email: 'not-an-email' }), false);
    assert.equal(hasUsableEmail({ email: 'owner@acme.com' }), true);
  });

  test('normalizeWebsite adds https', () => {
    assert.equal(normalizeWebsite({ website: 'acme.com' }), 'https://acme.com');
    assert.equal(normalizeWebsite({ website: 'https://acme.com' }), 'https://acme.com');
    assert.equal(normalizeWebsite({ website: 'N/A' }), '');
  });

  test('buildEmailPatch includes log and optional validation', () => {
    const patch = buildEmailPatch(
      { key: 'lead:1' },
      'hello@acme.com',
      { source: 'bettercontact', emailValidationStatus: 'valid' },
    );
    assert.equal(patch.email, 'hello@acme.com');
    assert.equal(patch.emailValidationStatus, 'valid');
    assert.equal(patch.logs[0].type, 'email_find');
  });
});
