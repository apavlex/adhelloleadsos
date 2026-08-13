'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  pickLeadWebsite,
  leadNeedsWebsiteEnrich,
  missingWebsiteEnrichFields,
  buildWebsiteEnrichQueueItems,
  buildWebsiteEnrichPatchFromScrape,
  normalizeWebsiteUrl,
} = require('../services/websiteEnrichQueue');

test('normalizeWebsiteUrl and pickLeadWebsite prefer real company sites', () => {
  assert.equal(normalizeWebsiteUrl(''), '');
  assert.equal(normalizeWebsiteUrl('N/A'), '');
  assert.match(normalizeWebsiteUrl('acmeplumbing.com'), /^https:\/\/acmeplumbing\.com\/?$/);
  assert.equal(normalizeWebsiteUrl('https://www.google.com/maps/place/foo'), '');

  const lead = {
    key: 'lead:1',
    website: 'N/A',
    importFields: { company_domain: 'servpluswaterdamage.com' },
  };
  assert.match(pickLeadWebsite(lead), /servpluswaterdamage\.com/);
});

test('leadNeedsWebsiteEnrich only when website present and fields missing', () => {
  assert.equal(leadNeedsWebsiteEnrich({ website: '', email: '' }), false);
  assert.equal(
    leadNeedsWebsiteEnrich({
      website: 'https://acme.com',
      email: 'info@acme.com',
      phone: '555-111-2222',
      address: '1 Main St',
      city: 'Portland',
      state: 'OR',
      zip: '97201',
      facebook: 'https://facebook.com/acme',
      instagram: 'https://instagram.com/acme',
      twitter: 'https://x.com/acme',
      linkedin: 'https://linkedin.com/company/acme',
      tiktok: 'https://tiktok.com/@acme',
    }),
    false,
  );
  assert.equal(
    leadNeedsWebsiteEnrich({ website: 'https://acme.com', email: 'N/A', phone: 'N/A' }),
    true,
  );
  assert.ok(missingWebsiteEnrichFields({ website: 'https://acme.com' }).includes('email'));
});

test('buildWebsiteEnrichQueueItems skips leads without websites', () => {
  const items = buildWebsiteEnrichQueueItems([
    { key: 'lead:a', website: '', email: '' },
    { key: 'lead:b', website: 'https://b.com', email: 'N/A', phone: 'N/A' },
    {
      key: 'lead:c',
      website: 'https://c.com',
      email: 'a@c.com',
      phone: '555-000-1111',
      address: '2 Oak',
      city: 'Seattle',
      state: 'WA',
      zip: '98101',
      facebook: 'https://facebook.com/c',
      instagram: 'https://instagram.com/c',
      twitter: 'https://x.com/c',
      linkedin: 'https://linkedin.com/company/c',
      tiktok: 'https://tiktok.com/@c',
    },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].key, 'lead:b');
  assert.ok(items[0].missing.includes('email'));
});

test('buildWebsiteEnrichPatchFromScrape fills only missing + rejects junk email', () => {
  const patch = buildWebsiteEnrichPatchFromScrape(
    {
      email: 'logo@2x.png',
      phone: '(503) 555-1212',
      address: 'N/A',
      city: 'Portland',
      facebook: 'https://facebook.com/acme',
      instagram: 'N/A',
    },
    {
      missing: ['email', 'phone', 'address', 'city', 'facebook', 'instagram'],
      isValidEmail: (e) => e.includes('@') && !e.endsWith('.png'),
    },
  );
  assert.equal(patch.email, undefined);
  assert.equal(patch.phone, '(503) 555-1212');
  assert.equal(patch.address, undefined);
  assert.equal(patch.city, 'Portland');
  assert.equal(patch.facebook, 'https://facebook.com/acme');
  assert.equal(patch.instagram, undefined);
});
