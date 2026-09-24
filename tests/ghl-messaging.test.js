const test = require('node:test');
const assert = require('node:assert/strict');
const {
  leadHasPhone,
  leadHasEmail,
  resolveLeadRecipientEmail,
  messagingReady,
  textToHtml,
} = require('../services/ghlMessaging');

test('leadHasPhone and leadHasEmail detect valid contact fields', () => {
  assert.equal(leadHasPhone({ phone: '+15551234567' }), true);
  assert.equal(leadHasPhone({ phone: 'N/A' }), false);
  assert.equal(leadHasEmail({ email: 'a@b.com' }), true);
  assert.equal(leadHasEmail({ email: '' }), false);
});

test('resolveLeadRecipientEmail falls back to contacts when top-level email is empty', () => {
  assert.equal(resolveLeadRecipientEmail({ email: 'top@biz.com' }), 'top@biz.com');
  assert.equal(
    resolveLeadRecipientEmail({
      email: 'N/A',
      contacts: [{ email: 'from-contact@biz.com', primary: true }],
    }),
    'from-contact@biz.com',
  );
  assert.equal(resolveLeadRecipientEmail({ email: '', contacts: [] }), '');
  assert.equal(leadHasEmail({ contacts: [{ email: 'c@x.com' }] }), true);
});

test('messagingReady requires email from for outbound email', () => {
  const ready = messagingReady({
    GHL_API_KEY: 'key',
    GHL_LOCATION_ID: 'loc123',
    GHL_EMAIL_FROM: 'hello@example.com',
    GHL_SMS_FROM_NUMBER: '+15551234567',
  });
  assert.equal(ready.configured, true);
  assert.equal(ready.emailReady, true);
  assert.equal(ready.smsReady, true);

  const noEmail = messagingReady({
    GHL_API_KEY: 'key',
    GHL_LOCATION_ID: 'loc123',
    GHL_SMS_FROM_NUMBER: '+15551234567',
  });
  assert.equal(noEmail.emailReady, false);
  assert.equal(noEmail.smsReady, true);
});

test('textToHtml escapes and preserves line breaks', () => {
  const html = textToHtml('Hi <there>\nLine 2');
  assert.match(html, /&lt;there&gt;/);
  assert.match(html, /<br\/>/);
});
