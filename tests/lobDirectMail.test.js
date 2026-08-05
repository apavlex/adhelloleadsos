const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseMailableAddress,
  hasMailableAddress,
  getLeadLobAddressPreview,
  resolvePostcardCreative,
  resolveLobQrRedirectUrl,
} = require('../services/lobDirectMail');

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

test('parseMailableAddress reads city, state, and zip from a single address line', () => {
  const parsed = parseMailableAddress({
    title: 'Seattle Electric Pros',
    address: '7323 20th Ave NW, Seattle, WA 98117',
  });
  assert.ok(parsed);
  assert.equal(parsed.address_city, 'Seattle');
  assert.equal(parsed.address_state, 'WA');
  assert.equal(parsed.address_zip, '98117');
  assert.match(parsed.address_line1, /7323 20th Ave NW/i);
});

test('getLeadLobAddressPreview exposes zip for Lob table rows', () => {
  const preview = getLeadLobAddressPreview({
    title: '26001 NE 60th St, Vancouver, WA 98682 · $757,000',
    address: '26001 NE 60th St, Vancouver, WA 98682',
    city: 'Vancouver',
    state: 'WA',
  });
  assert.equal(preview.mailable, true);
  assert.equal(preview.zip, '98682');
  assert.equal(preview.city, 'Vancouver');
  assert.equal(preview.state, 'WA');
  assert.match(preview.addressLine1, /26001 NE 60th St/i);
});

test('parseMailableAddress keeps street numbers that look like zip codes', () => {
  const parsed = parseMailableAddress({
    title: '26001 NE 60th St, Vancouver, WA 98682 · $757,000',
    address: '26001 NE 60th St, Vancouver, WA 98682',
    city: 'Vancouver',
    state: 'WA',
  });
  assert.ok(parsed);
  assert.equal(parsed.address_zip, '98682');
  assert.equal(parsed.address_line1, '26001 NE 60th St');
});

test('resolvePostcardCreative wraps public image URLs in Lob-sized HTML', () => {
  const html = {
    front: '<html><body>fallback front</body></html>',
    back: '<html><body>fallback back</body></html>',
  };
  const creative = resolvePostcardCreative(
    {},
    html,
    {
      frontImageUrl: 'https://cdn.example.com/front.jpg',
      backImageUrl: 'https://cdn.example.com/back.jpg',
    },
    { personalizeOverlay: false },
  );
  assert.match(creative.front, /6\.25in/);
  assert.match(creative.front, /cdn\.example\.com\/front\.jpg/);
  assert.match(creative.back, /cdn\.example\.com\/back\.jpg/);
  assert.equal(creative.mode, 'html');
});

test('resolvePostcardCreative rejects non-public generated image URLs', () => {
  const html = {
    front: '<html><body>fallback front</body></html>',
    back: '<html><body>fallback back</body></html>',
  };
  assert.throws(
    () =>
      resolvePostcardCreative(
        {},
        html,
        { frontImageUrl: 'data:image/png;base64,abc' },
        { personalizeOverlay: false },
      ),
    /public https image/i,
  );
});

test('parseMailableAddress coalesces listing-style title when address field is empty', () => {
  const parsed = parseMailableAddress({
    title: '20301 NE 68th St, Vancouver, WA 98682 · $757,000',
    address: '',
    city: '',
    state: '',
  });
  assert.ok(parsed);
  assert.equal(parsed.address_zip, '98682');
  assert.equal(parsed.address_city, 'Vancouver');
  assert.equal(parsed.address_state, 'WA');
  assert.match(parsed.address_line1, /20301 NE 68th St/i);
});

test('parseMailableAddress coalesces city and state from listing title', () => {
  const parsed = parseMailableAddress({
    title: '20301 NE 68th St, Vancouver, WA · $757,000',
    address: '20301 NE 68th St',
    postalCode: '98682',
  });
  assert.ok(parsed);
  assert.equal(parsed.address_city, 'Vancouver');
  assert.equal(parsed.address_state, 'WA');
  assert.equal(parsed.address_zip, '98682');
});

test('parseMailableAddress uses Current Resident for listing-style titles', () => {
  const parsed = parseMailableAddress({
    title: '26001 NE 60th St, Vancouver, WA 98682 · $757,000',
    address: '26001 NE 60th St, Vancouver, WA 98682',
    city: 'Vancouver',
    state: 'WA',
  });
  assert.ok(parsed);
  assert.equal(parsed.name, 'Current Resident');
  assert.equal(parsed.name.length, 16);
});

test('parseMailableAddress keeps business name under Lob 40 char limit', () => {
  const parsed = parseMailableAddress({
    title: 'Peninsula Electric',
    address: '123 Main St, Portland, OR 97201',
    city: 'Portland',
    state: 'OR',
  });
  assert.ok(parsed);
  assert.equal(parsed.name, 'Peninsula Electric');
});

test('parseMailableAddress prefers contactName over listing title', () => {
  const parsed = parseMailableAddress({
    title: '26001 NE 60th St, Vancouver, WA 98682 · $757,000',
    contactName: 'Jane Smith',
    address: '26001 NE 60th St, Vancouver, WA 98682',
    city: 'Vancouver',
    state: 'WA',
  });
  assert.equal(parsed.name, 'Jane Smith');
});

test('parseMailableAddress truncates long business names for Lob', () => {
  const parsed = parseMailableAddress({
    title: 'Super Long Business Name That Exceeds Forty Characters Limit',
    address: '123 Main St, Portland, OR 97201',
    city: 'Portland',
    state: 'OR',
  });
  assert.ok(parsed);
  assert.ok(parsed.name.length <= 40);
  assert.match(parsed.name, /^Super Long Business Name/);
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

test('resolveLobQrRedirectUrl merges audit_url and adds tracking params', () => {
  const lead = {
    key: 'lead-abc',
    title: 'Acme Co',
    stitchDesignUrl: 'https://example.com/audit/acme',
    city: 'Portland',
    state: 'OR',
  };
  const url = resolveLobQrRedirectUrl(lead, '{audit_url}');
  assert.match(url, /^https:\/\/example\.com\/audit\/acme\?/);
  assert.match(url, /utm_source=lob_postcard/);
  assert.match(url, /utm_content=lead-abc/);
});

test('resolveLobQrRedirectUrl falls back to lead audit URL when CTA blank', () => {
  const url = resolveLobQrRedirectUrl(
    { key: 'x', website: 'https://biz.example.com' },
    '',
  );
  assert.equal(url, 'https://biz.example.com/?utm_source=lob_postcard&utm_medium=direct_mail&utm_content=x');
});

test('lobClient buildDefaultPostcardQrCode returns null without redirect URL', () => {
  const lobClient = require('../services/lobClient');
  assert.equal(lobClient.buildDefaultPostcardQrCode(''), null);
  const qr = lobClient.buildDefaultPostcardQrCode('https://example.com/audit');
  assert.equal(qr.redirect_url, 'https://example.com/audit');
  assert.equal(qr.pages, 'front');
  assert.equal(qr.bottom, '0.35');
  assert.equal(qr.right, '0.35');
  assert.equal(qr.width, '1.0');
});
