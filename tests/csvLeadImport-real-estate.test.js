const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseImportFile } = require('../services/csvLeadImport');
const dbService = require('../services/database');

describe('csvLeadImport real estate listings', () => {
  it('maps mobile-home-fixers export to distinct real estate leads', () => {
    const fixture = path.join(__dirname, 'fixtures', 'mobile-home-fixers-sample.csv');
    const buf = fs.readFileSync(fixture);
    const { leads, rawRowCount } = parseImportFile(buf, 'mobile-home-fixers-latest.csv');
    assert.equal(rawRowCount, 3);
    assert.equal(leads.length, 3);

    const fb = leads.find((l) => /FACEBOOK:/i.test(l.title));
    assert.ok(fb);
    assert.equal(fb.jobType, 'real_estate');
    assert.equal(fb.sourceType, 'real_estate');
    assert.equal(fb.sourceChannel, 'facebook_marketplace');
    assert.equal(fb.categoryName, 'Real Estate - Mobile Home');
    assert.equal(fb.city, 'Longview');
    assert.equal(fb.state, 'WA');
    assert.match(fb.website, /facebook\.com\/marketplace\/item\//i);
    assert.equal(fb.listing.price, 1495);
    assert.equal(fb.listing.beds, 2);
    assert.equal(fb.listing.baths, 1);

    const cl = leads.find((l) => /CRAIGSLIST:/i.test(l.title));
    assert.ok(cl);
    assert.equal(cl.sourceChannel, 'craigslist');
    assert.match(cl.website, /craigslist\.org/i);
  });

  it('dedupes marketplace listings by full listing path, not hostname only', () => {
    const csv = [
      'company_name,company_website,city,state,url,source,note',
      'FB listing A,,Portland,OR,https://www.facebook.com/marketplace/item/111,facebook marketplace,Price: $1000 | Beds: 2 | Baths: 1',
      'FB listing B,,Salem,OR,https://www.facebook.com/marketplace/item/222,facebook marketplace,Price: $2000 | Beds: 3 | Baths: 2',
    ].join('\n');
    const { leads } = parseImportFile(Buffer.from(csv, 'utf8'), 'listings.csv');
    const domains = leads.map((l) => dbService.normalizeDomain(l.website));
    assert.equal(new Set(domains).size, 2);
    assert.ok(domains.every((d) => d.includes('/marketplace/item/')));
  });

  it('maps spreadsheet columns Title, Price, Beds, Baths, City, State, Source, URL', () => {
    const csv = [
      'Title,Price,Beds,Baths,City,State,Source,URL',
      '1 Bed 1 Bath - House,"$1,000",1,1,Camas,WA,facebook marketplace,https://www.facebook.com/marketplace/item/1369773571376466',
    ].join('\n');
    const { leads } = parseImportFile(Buffer.from(csv, 'utf8'), 'mobile-home-fixers-latest.csv');
    assert.equal(leads.length, 1);
    const lead = leads[0];
    assert.equal(lead.jobType, 'real_estate');
    assert.match(lead.title, /1 Bed 1 Bath/i);
    assert.equal(lead.city, 'Camas');
    assert.equal(lead.state, 'WA');
    assert.equal(lead.sourceChannel, 'facebook_marketplace');
    assert.equal(lead.listing.price, 1000);
    assert.equal(lead.listing.beds, 1);
    assert.equal(lead.listing.baths, 1);
  });
});
