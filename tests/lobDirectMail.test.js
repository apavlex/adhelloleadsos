const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseMailableAddress, hasMailableAddress } = require('../services/lobDirectMail');

test('parseMailableAddress accepts street + city + state + zip in address', () => {
  const lead = {
    title: 'Peninsula Electric',
    address: '123 Main St, Portland, OR 97201',
    city: 'Portland',
    state: 'OR',
  };
  const parsed = parseMailableAddress(lead);
  assert.ok(parsed);
  assert.equal(parsed.address_zip, '97201');
  assert.equal(parsed.address_city, 'Portland');
});

test('hasMailableAddress rejects incomplete leads', () => {
  assert.equal(hasMailableAddress({ address: '123 Main', city: 'Portland', state: 'OR' }), false);
  assert.equal(hasMailableAddress({ address: 'N/A', city: 'Portland', state: 'OR', zip: '97201' }), false);
});

test('lobClient isConfigured requires key and return address', () => {
  const lobClient = require('../services/lobClient');
  assert.equal(lobClient.isConfigured({}), false);
  assert.equal(
    lobClient.isConfigured({
      LOB_API_KEY: 'test_key',
      LOB_FROM_ADDRESS_LINE1: '1 Main',
      LOB_FROM_CITY: 'Portland',
      LOB_FROM_STATE: 'OR',
      LOB_FROM_ZIP: '97201',
    }),
    true,
  );
});
