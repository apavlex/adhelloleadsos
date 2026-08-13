const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  hasUsableEmail,
  buildEmailPatch,
  normalizeWebsite,
  mergeEnrichmentOntoLead,
  hasUsableWebsite,
  withTimeout,
} = require('../services/ensureLeadEmail');

describe('ensureLeadEmail helpers', () => {
  test('withTimeout rejects hung promises', async () => {
    await assert.rejects(
      () =>
        withTimeout(
          new Promise(() => {}),
          40,
          'hung_step',
        ),
      /hung_step timed out/,
    );
  });

  test('withTimeout resolves when promise finishes first', async () => {
    const value = await withTimeout(Promise.resolve('ok'), 200, 'fast_step');
    assert.equal(value, 'ok');
  });

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

  test('mergeEnrichmentOntoLead fills missing website from Monid extract', () => {
    const { lead, patch } = mergeEnrichmentOntoLead(
      { key: 'lead:1', title: 'Acme', website: 'N/A' },
      { website: 'https://acme.com', phone: '+15551234567' },
    );
    assert.equal(patch.website, 'https://acme.com');
    assert.equal(hasUsableWebsite(lead), true);
    assert.equal(lead.phone, '+15551234567');
  });
});
