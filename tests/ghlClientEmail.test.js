const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isValidEmailForGhl, leadToGhlContactPayload } = require('../services/ghlClient');

describe('isValidEmailForGhl', () => {
  it('accepts valid emails', () => {
    assert.equal(isValidEmailForGhl('owner@acmeplumbing.com'), true);
    assert.equal(isValidEmailForGhl('  info@example.co.uk  '), false); // example.* blocked
    assert.equal(isValidEmailForGhl('hello@bayareawater.com'), true);
  });

  it('rejects invalid or placeholder emails', () => {
    assert.equal(isValidEmailForGhl(''), false);
    assert.equal(isValidEmailForGhl('N/A'), false);
    assert.equal(isValidEmailForGhl('not-an-email'), false);
    assert.equal(isValidEmailForGhl('missing@domain'), false);
    assert.equal(isValidEmailForGhl('@nodomain.com'), false);
    assert.equal(isValidEmailForGhl('zillow bad value'), false);
  });

  it('rejects scraped asset filenames and theme placeholders', () => {
    assert.equal(isValidEmailForGhl('m-home-banner@2x.jpg'), false);
    assert.equal(isValidEmailForGhl('chosen-sprite@2x.png'), false);
    assert.equal(isValidEmailForGhl('logo@cdn.example.png'), false);
    assert.equal(isValidEmailForGhl('office@mikado-themes.com'), false);
    assert.equal(isValidEmailForGhl('user@domain.com'), false);
    assert.equal(isValidEmailForGhl('test@example.com'), false);
    assert.equal(isValidEmailForGhl('email@email.com'), false);
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
      { title: 'Test Co', email: 'hello@bayareawater.com', phone: '5551234567' },
      'loc123',
    );
    assert.equal(payload.email, 'hello@bayareawater.com');
  });

  it('omits scraped junk email from payload', () => {
    const payload = leadToGhlContactPayload(
      { title: 'Test Co', email: 'm-home-banner@2x.jpg', phone: '5551234567' },
      'loc123',
    );
    assert.equal('email' in payload, false);
  });

  it('omits N/A email from payload', () => {
    const payload = leadToGhlContactPayload(
      { title: 'Test Co', email: 'N/A', phone: '5551234567' },
      'loc123',
    );
    assert.equal('email' in payload, false);
  });
});
