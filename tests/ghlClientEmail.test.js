const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isValidEmailForGhl, leadToGhlContactPayload } = require('../services/ghlClient');

describe('isValidEmailForGhl', () => {
  it('accepts valid emails', () => {
    assert.equal(isValidEmailForGhl('user@example.com'), true);
    assert.equal(isValidEmailForGhl('  user@example.co.uk  '), true);
  });

  it('rejects invalid or placeholder emails', () => {
    assert.equal(isValidEmailForGhl(''), false);
    assert.equal(isValidEmailForGhl('N/A'), false);
    assert.equal(isValidEmailForGhl('not-an-email'), false);
    assert.equal(isValidEmailForGhl('missing@domain'), false);
    assert.equal(isValidEmailForGhl('@nodomain.com'), false);
    assert.equal(isValidEmailForGhl('zillow bad value'), false);
  });
});

describe('leadToGhlContactPayload email', () => {
  it('omits invalid email from payload', () => {
    const payload = leadToGhlContactPayload(
      { title: 'Test Co', email: 'invalid-email', phone: '5551234567' },
      'loc123',
    );
    assert.equal('email' in payload, false);
    assert.equal(payload.phone, '+15551234567');
  });

  it('includes valid email in payload', () => {
    const payload = leadToGhlContactPayload(
      { title: 'Test Co', email: 'valid@example.com', phone: '5551234567' },
      'loc123',
    );
    assert.equal(payload.email, 'valid@example.com');
  });

  it('omits N/A email from payload', () => {
    const payload = leadToGhlContactPayload(
      { title: 'Test Co', email: 'N/A', phone: '5551234567' },
      'loc123',
    );
    assert.equal('email' in payload, false);
  });
});
