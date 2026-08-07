const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const outscraper = require('../services/outscraperClient');
const {
  listingToLead,
  dedupeLeads,
  resolveProfileUrl,
  DIRECTORY_SOURCES,
} = require('../services/directoryLeadSearch');

describe('outscraper directory search helpers', () => {
  it('builds Angi company list URL', () => {
    const url = outscraper.buildAngiSearchUrl('Plumber', 'Portland', 'OR');
    assert.match(url, /angi\.com\/companylist\/plumber\/portland-or\.htm/);
  });

  it('builds Zillow agents URL', () => {
    const url = outscraper.buildZillowAgentsSearchUrl('Seattle', 'WA');
    assert.match(url, /zillow\.com\/professionals\/real-estate-agent-reviews\/seattle-wa/);
  });

  it('normalizes Yelp directory row', () => {
    const row = outscraper.normalizeYelpDirectoryRow({
      name: 'Joe Plumbing',
      phone: '(503) 555-0100',
      business_url: 'https://www.yelp.com/biz/joe-plumbing',
      rating: 4.5,
      reviews: 42,
      categories: ['Plumbing'],
    });
    assert.equal(row.title, 'Joe Plumbing');
    assert.equal(row.reviewsCount, 42);
    assert.match(row.url, /yelp\.com/);
  });

  it('normalizes Angi directory row', () => {
    const row = outscraper.normalizeAngiDirectoryRow({
      company_name: 'Acme HVAC',
      phone_number: '503-555-1212',
      profile_url: 'https://www.angi.com/companylist/acme',
      rating: 4.8,
      review_count: 15,
    });
    assert.equal(row.title, 'Acme HVAC');
    assert.equal(row.phone, '503-555-1212');
    assert.equal(row.reviewsCount, 15);
  });

  it('normalizes Yellow Pages row', () => {
    const row = outscraper.normalizeYellowpagesDirectoryRow({
      name: 'Best Electric',
      phone: '+1 503 555 0000',
      street: '100 Main St',
      locality: 'Portland, OR 97201',
      business_link: 'https://www.yellowpages.com/portland-or/mip/best-electric-123',
      site: 'https://bestelectric.com',
    });
    assert.equal(row.title, 'Best Electric');
    assert.match(row.address, /100 Main St/);
    assert.match(row.website, /bestelectric/);
  });

  it('normalizes Zillow agent row with brokerage', () => {
    const row = outscraper.normalizeZillowAgentRow({
      name: 'Jane Agent',
      brokerage: 'Premier Realty',
      phone: '503-555-9999',
      profile_url: 'https://www.zillow.com/profile/janeagent/',
      rating: 5,
      reviews: 88,
    });
    assert.match(row.title, /Jane Agent/);
    assert.match(row.title, /Premier Realty/);
    assert.equal(row.categoryName, 'Real estate agent');
  });

  it('parses AI scraper listing arrays', () => {
    const rows = outscraper.parseAiScraperListings({
      businesses: [{ name: 'A' }, { name: 'B' }],
    });
    assert.equal(rows.length, 2);
  });
});

describe('directoryLeadSearch sources', () => {
  it('includes Outscraper-backed sources', () => {
    const ids = DIRECTORY_SOURCES.map((s) => s.id);
    assert.ok(ids.includes('yelp'));
    assert.ok(ids.includes('angi'));
    assert.ok(ids.includes('yellowpages'));
    assert.ok(ids.includes('zillow_agents'));
    assert.ok(ids.includes('bbb'));
  });

  it('resolveProfileUrl prefixes relative Yelp paths', () => {
    assert.match(resolveProfileUrl({ url: '/biz/foo' }, 'yelp'), /yelp\.com\/biz\/foo/);
  });

  it('listingToLead maps directory source and scores', () => {
    const lead = listingToLead(
      {
        title: 'Angi Pro',
        phone: '503-555-0100',
        website: 'https://pro.test',
        address: '1 Main',
        url: 'https://www.angi.com/companylist/pro',
        totalScore: 4.2,
        reviewsCount: 9,
        source: 'angi',
        cmsPlatform: 'WordPress',
        techStackTags: ['Google Analytics'],
      },
      { keyword: 'hvac', city: 'Portland', state: 'OR', sourceId: 'angi' },
    );
    assert.equal(lead.leadSource, 'directory_angi');
    assert.equal(lead.totalScore, 4.2);
    assert.equal(lead.cmsPlatform, 'WordPress');
    assert.deepEqual(lead.techStackTags, ['Google Analytics']);
  });

  it('dedupes by title and phone', () => {
    const rows = [
      { title: 'A Co', phone: '512-555-0001' },
      { title: 'A Co', phone: '512-555-0001' },
      { title: 'B Co', phone: '512-555-0002' },
    ];
    assert.equal(dedupeLeads(rows).length, 2);
  });
});
