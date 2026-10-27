const test = require('node:test');
const assert = require('node:assert/strict');
const {
  websiteFormLabel,
  looksLikeRealFormName,
  looksLikeWebsiteFormContact,
  hostFromWebsite,
} = require('../services/websiteFormLabel');

test('drops GHL attribution crumbs like Direct and AI Studio', () => {
  assert.equal(looksLikeRealFormName('direct'), false);
  assert.equal(looksLikeRealFormName('AI Studio'), false);
  assert.equal(looksLikeRealFormName('ai_studio'), false);
  assert.equal(looksLikeRealFormName('Free Roof Quote'), true);
  assert.equal(
    websiteFormLabel({ formName: 'ai_studio', websiteUrl: 'https://tprflooring.com' }),
    'Tprflooring.com Form',
  );
  assert.equal(
    websiteFormLabel({ label: 'Direct', websiteUrl: 'https://www.TPRFlooring.com/contact' }),
    'TPRFlooring.com Form',
  );
  assert.equal(
    websiteFormLabel({ formName: 'Contact us', websiteUrl: 'https://tprflooring.com' }),
    'Contact us',
  );
  assert.equal(websiteFormLabel({ formName: 'direct' }), 'Website form');
});

test('hostFromWebsite normalizes domains', () => {
  assert.equal(hostFromWebsite('https://www.tprflooring.com/form'), 'tprflooring.com');
  assert.equal(hostFromWebsite('tprflooring.com'), 'tprflooring.com');
  assert.equal(hostFromWebsite(''), '');
});

test('looksLikeWebsiteFormContact rejects call/SMS and phone-only blanks', () => {
  assert.equal(looksLikeWebsiteFormContact({ source: 'Website' }), true);
  assert.equal(looksLikeWebsiteFormContact({ source: 'Inbound Call', phone: '+13602611532' }), false);
  assert.equal(looksLikeWebsiteFormContact({ source: 'SMS' }), false);
  assert.equal(looksLikeWebsiteFormContact({ phone: '+13602611532' }), false);
  assert.equal(looksLikeWebsiteFormContact({
    phone: '+13602611532',
    email: 'brett@example.com',
  }), true);
});
