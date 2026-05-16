const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parsePageContacts, parseDirectoryListings } = require('../services/cheerioParser');
const {
  dedupeLeads,
  mergeMapsAndDirectoryLeads,
  listingToLead,
  directorySupplementEnabled,
} = require('../services/directoryLeadSearch');
const { looksLikeBotWall } = require('../services/pageScraper');

describe('cheerioParser', () => {
  it('extracts email and phone from static HTML', () => {
    const html = `
      <html><head><title>Acme Plumbing</title></head>
      <body>
        <a href="mailto:hello@acmeplumbing.com">Email</a>
        <a href="tel:+15125551234">Call</a>
        <p>Backup: (512) 555-9999</p>
      </body></html>`;
    const contacts = parsePageContacts(html, 'https://acmeplumbing.com');
    assert.ok(contacts.emails.includes('hello@acmeplumbing.com'));
    assert.ok(contacts.phones.some((p) => p.includes('512')));
    assert.equal(contacts.businessName, 'Acme Plumbing');
  });

  it('parses JSON-LD local business', () => {
    const html = `<script type="application/ld+json">{"@type":"LocalBusiness","name":"Joe's HVAC","telephone":"+1-512-555-0001","email":"joe@hvac.test"}</script>`;
    const listings = parseDirectoryListings(html, 'test');
    assert.ok(listings.some((l) => l.title.includes("Joe's HVAC")));
  });
});

describe('directoryLeadSearch helpers', () => {
  it('dedupes by title and phone', () => {
    const rows = [
      { title: 'A Co', phone: '512-555-0001' },
      { title: 'A Co', phone: '512-555-0001' },
      { title: 'B Co', phone: '512-555-0002' },
    ];
    assert.equal(dedupeLeads(rows).length, 2);
  });

  it('mergeMapsAndDirectoryLeads keeps maps first and caps total', () => {
    const maps = [{ title: 'Maps Lead', phone: '111' }];
    const dirs = [
      { title: 'Dir Lead', phone: '222' },
      { title: 'Maps Lead', phone: '111' },
    ];
    const merged = mergeMapsAndDirectoryLeads(maps, dirs, 2);
    assert.equal(merged.length, 2);
    assert.equal(merged[0].title, 'Maps Lead');
    assert.equal(merged[1].title, 'Dir Lead');
  });

  it('listingToLead maps to pipeline shape', () => {
    const lead = listingToLead(
      { title: 'Test Biz', phone: '512-555-1234', website: 'https://test.biz', address: '1 Main', source: 'yelp' },
      { keyword: 'plumber', city: 'Austin', state: 'TX' }
    );
    assert.equal(lead.title, 'Test Biz');
    assert.equal(lead.leadSource, 'directory_yelp');
    assert.equal(lead.city, 'Austin');
  });
});

describe('pageScraper', () => {
  it('detects bot wall HTML', () => {
    assert.equal(looksLikeBotWall('<html>please enable javascript</html>'), true);
    assert.equal(looksLikeBotWall('<html>' + 'x'.repeat(500) + '</html>'), false);
  });
});

describe('directorySupplementEnabled', () => {
  it('defaults on when env unset', () => {
    const prev = process.env.SEARCH_DIRECTORY_SUPPLEMENT;
    delete process.env.SEARCH_DIRECTORY_SUPPLEMENT;
    assert.equal(directorySupplementEnabled(null), true);
    if (prev != null) process.env.SEARCH_DIRECTORY_SUPPLEMENT = prev;
  });
});
