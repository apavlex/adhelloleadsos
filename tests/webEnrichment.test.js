const test = require('node:test');
const assert = require('node:assert/strict');

const { mergeLocalContactsWithProvider } = require('../services/webEnrichment');

test('local HTML email fills a gap when provider extraction omits it', () => {
  const merged = mergeLocalContactsWithProvider(
    {
      phone: '(503) 863-8030',
      instagram: 'https://instagram.com/buildexconstructionnw',
    },
    {
      email: 'buildexnw@gmail.com',
      phone: '(503) 000-0000',
    },
  );

  assert.equal(merged.email, 'buildexnw@gmail.com');
  assert.equal(merged.phone, '(503) 863-8030');
  assert.equal(merged.instagram, 'https://instagram.com/buildexconstructionnw');
});

test('empty local values never shadow provider contact fields', () => {
  const merged = mergeLocalContactsWithProvider(
    { email: 'office@buildexconstructionnw.com' },
    { email: '', phone: '', business_name: '' },
  );

  assert.equal(merged.email, 'office@buildexconstructionnw.com');
  assert.ok(!('business_name' in merged));
});
