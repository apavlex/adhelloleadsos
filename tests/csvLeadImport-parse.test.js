const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseImportFile, parseCsvRawRows, detectCsvDelimiter } = require('../services/csvLeadImport');

describe('csvLeadImport parse', () => {
  it('detects semicolon delimiter', () => {
    assert.equal(detectCsvDelimiter('name;phone;email'), ';');
  });

  it('parses semicolon CSV', () => {
    const csv = 'company_name;phone_number\nAcme LLC;555-0100\n';
    const rows = parseCsvRawRows(Buffer.from(csv, 'utf8'));
    assert.equal(rows.length, 1);
    const { leads, rawRowCount } = parseImportFile(Buffer.from(csv, 'utf8'), 'leads.csv');
    assert.equal(rawRowCount, 1);
    assert.equal(leads.length, 1);
    assert.equal(leads[0].title, 'Acme LLC');
  });

  it('derives title from website when name column missing', () => {
    const csv = 'company_website,phone_number\nhttps://acme-paint.com,555-0199\n';
    const { leads } = parseImportFile(Buffer.from(csv, 'utf8'), 'leads.csv');
    assert.equal(leads.length, 1);
    assert.match(leads[0].title, /acme-paint/i);
  });

  it('strips UTF-8 BOM', () => {
    const csv = '\uFEFFcompany_name,phone\nBiz,555\n';
    const { leads, rawRowCount } = parseImportFile(Buffer.from(csv, 'utf8'), 'leads.csv');
    assert.equal(rawRowCount, 1);
    assert.equal(leads[0].title, 'Biz');
  });

  it('maps GitHub prospect-format columns (business, website_url, social_urls, area)', () => {
    const csv = [
      'score,business,category,area,distance_km,website_status,website_url,social_urls,phone,source_urls,why_prospect',
      'Hot,Metro Painters LLC,Residential painter,"Portland, OR",5,Has site,https://metro-painters.example.com,https://facebook.com/metro https://instagram.com/metro,+1 503 555 0100,https://www.google.com/maps/place/test,Strong owned-site hook',
    ].join('\n');
    const { leads } = parseImportFile(Buffer.from(csv, 'utf8'), 'prospects.csv');
    assert.equal(leads.length, 1);
    const l = leads[0];
    assert.equal(l.title, 'Metro Painters LLC');
    assert.match(l.website, /metro-painters\.example\.com/i);
    assert.match(l.facebook, /facebook\.com\/metro/i);
    assert.match(l.instagram, /instagram\.com\/metro/i);
    assert.equal(l.city, 'Portland');
    assert.equal(l.state, 'OR');
    assert.match(l.url, /google\.com\/maps/i);
    assert.equal(l.prospectTier, 'Hot');
    assert.equal(l.ownerSignal, 'Strong owned-site hook');
    assert.equal(l.websiteStatusLabel, 'Has site');
  });

  it('treats Not found as empty website', () => {
    const csv = 'business,website_url,phone\nNo Site Co,Not found,555-0200\n';
    const { leads } = parseImportFile(Buffer.from(csv, 'utf8'), 'leads.csv');
    assert.equal(leads[0].website, 'N/A');
    assert.equal(leads[0].title, 'No Site Co');
  });
});
