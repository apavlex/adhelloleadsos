const test = require('node:test');
const assert = require('node:assert/strict');
const {
  leadHasPhone,
  leadHasEmail,
  messagingReady,
  textToHtml,
} = require('../services/ghlMessaging');

test('leadHasPhone and leadHasEmail detect valid contact fields', () => {
  assert.equal(leadHasPhone({ phone: '+15551234567' }), true);
  assert.equal(leadHasPhone({ phone: 'N/A' }), false);
  assert.equal(leadHasEmail({ email: 'a@b.com' }), true);
  assert.equal(leadHasEmail({ email: '' }), false);
});

test('messagingReady requires email from for outbound email', () => {
  const ready = messagingReady({
    GHL_API_KEY: 'key',
    GHL_LOCATION_ID: 'loc123',
    GHL_EMAIL_FROM: 'hello@example.com',
  });
  assert.equal(ready.configured, true);
  assert.equal(ready.smsReady, true);
  assert.equal(ready.emailReady, true);

  const noEmail = messagingReady({
    GHL_API_KEY: 'key',
    GHL_LOCATION_ID: 'loc123',
  });
  assert.equal(noEmail.smsReady, true);
  assert.equal(noEmail.emailReady, false);
});

test('textToHtml escapes and preserves line breaks', () => {
  const html = textToHtml('Hi <there>\nLine 2');
  assert.match(html, /&lt;there&gt;/);
  assert.match(html, /<br\/>/);
});
