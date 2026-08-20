const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  fallbackPersonalizedMessage,
  fallbackPersonalizedEmail,
  buildLeadSmsSnapshot,
} = require('../services/smsPersonalize');

describe('smsPersonalize fallbacks', () => {
  it('fills name company city placeholders', () => {
    const snap = buildLeadSmsSnapshot({
      title: 'Acme Plumbing',
      contactName: 'Pat',
      city: 'Austin',
      state: 'TX',
    });
    const msg = fallbackPersonalizedMessage(
      'Hi {{name}} at {{company}} in {{city}}',
      snap,
    );
    assert.match(msg, /Pat/);
    assert.match(msg, /Acme Plumbing/);
    assert.match(msg, /Austin/);
  });

  it('builds a follow-up email subject and body', () => {
    const snap = buildLeadSmsSnapshot({
      title: 'Bay Area Water',
      contactName: 'Jordan',
      city: 'Oakland',
      state: 'CA',
    });
    const out = fallbackPersonalizedEmail('Hi {{name}}, checking in for {{company}}.', snap);
    assert.match(out.subject, /Bay Area Water/);
    assert.match(out.body, /Jordan/);
    assert.match(out.body, /Bay Area Water/);
  });
});
