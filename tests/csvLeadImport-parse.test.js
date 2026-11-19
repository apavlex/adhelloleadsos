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

  it('maps Chrome extension Flooring Leads CSV columns', () => {
    const csv = [
      'Business Name,Phone Number,Address,Category,Rating,Review Count,Extraction Date,Google Maps URL,Review Snippet,Sponsored',
      'Floor & Decor,(503) 382-0506,11919 North Jantzen Drive,Flooring store,4.5,397,2026-06-27,https://www.google.com/maps/place/test,,"Yes"',
      'All About Floors NW,(360) 947-2876,6700 NE 152nd Ave #140,Flooring store,4.8,120,2026-06-27,https://www.google.com/maps/place/test2,"Great service and fair prices",No',
    ].join('\n');
    const { leads } = parseImportFile(Buffer.from(csv, 'utf8'), 'Flooring Leads.csv', {
      leadSource: 'chrome_extension',
    });
    assert.equal(leads.length, 2);
    assert.equal(leads[0].reviewsCount, 397);
    assert.equal(leads[0].categoryName, 'Flooring store');
    assert.equal(leads[0].totalScore, 4.5);
    assert.equal(leads[0].sponsored, true);
    assert.equal(leads[0].reviewSnippets, undefined);
    assert.equal(leads[1].reviewsCount, 120);
    assert.deepEqual(leads[1].reviewSnippets, ['Great service and fair prices']);
    assert.equal(leads[1].sponsored, false);
  });

  it('imports an FMCSA carrier list without renaming columns', () => {
    const csv = [
      'Type,MC No.,Auth,DOT No,Name,Address,City,St,Zip,County,Phone,Fax No,Company Rep,Email,Power,Driver,Cargo,Ins Co,Cover,EffDate,Policy No',
      'MC,1079735,C,3368666,ADEBOLA ADEDAYO JOHNSON,23110 BROAD SPRINGS COURT,77407,TX,77488,WHARTON,5126624236,,ADEBOLA JOHNSON,beejayyjohnson@gmail.com,A,1,D,PROGRESSIVE COUNTY MUTUAL,BI&PD,12/12/2023,CA01532554',
      'MC,697761,P,1971700,EDWARD CANTU JR,1520 SOUTH EAST THIRD,AMARILLO,TX,79102,POTTER,8063738880,,EDWARD CANTU JR,,C,4,DE,ARGONAUT-MIDWEST INSURANCE COM,BI&PD,12/14/2024,MC8724917',
      'MC,697761,P,1971700,EDWARD CANTU JR,1520 SOUTH EAST THIRD,AMARILLO,TX,79102,POTTER,8063738880,,EDWARD CANTU JR,,C,4,DE,"COLONY INSURANCE COMPANY",Cargo,12/14/2024,GAT-1000000-00',
      'FF,12,C,99,FORWARD CO,1 MAIN,DALLAS,TX,75201,DALLAS,2145550100,,PAT FORWARD,pat@forward.example,A,1,A,ACME INS,BI&PD,1/1/2024,POL1',
      'MC,1689147,C,4327350,ROADRUNNER MOBILE HOME TR,9 OAK,TYLER,TX,75701,SMITH,9035550100,,ALISHA CLEMMER,a@example.com,A,1,A,ACME INS,BI&PD,1/1/2024,POL2',
    ].join('\n');
    const { leads, rawRowCount } = parseImportFile(Buffer.from(csv, 'utf8'), 'TX - December cleaned.csv');
    assert.equal(rawRowCount, 5);
    assert.equal(leads.length, 4);
    const ade = leads[0];
    assert.equal(ade.title, 'ADEBOLA ADEDAYO JOHNSON');
    assert.equal(ade.state, 'TX');
    assert.equal(ade.city, '');
    assert.equal(ade.zip, '77488');
    assert.equal(ade.contactName, 'ADEBOLA JOHNSON');
    assert.equal(ade.categoryName, 'Motor carrier');
    assert.equal(ade.mcNumber, '1079735');
    assert.equal(ade.dotNumber, '3368666');
    assert.match(ade.updates[0].message, /WHARTON/);
    const edward = leads[1];
    assert.equal(edward.mcNumber, '697761');
    assert.match(edward.updates[0].message, /BI&PD/);
    assert.match(edward.updates[0].message, /Cargo/);
    assert.equal(leads[2].categoryName, 'Freight forwarder');
    assert.equal(leads[2].city, 'DALLAS');
    assert.equal(leads[2].state, 'TX');
    assert.equal(leads[3].categoryName, 'Motor carrier');
    assert.equal(leads[3].jobType, undefined);
  });

  it('keeps a normal type column as the category', () => {
    const csv = 'name,type,state\nAcme Paint,Painter,OR\n';
    const { leads } = parseImportFile(Buffer.from(csv, 'utf8'), 'leads.csv');
    assert.equal(leads[0].categoryName, 'Painter');
    assert.equal(leads[0].state, 'OR');
    assert.equal(leads[0].mcNumber, undefined);
  });

  it('maps source_channel from extension bulk scrape CSV', () => {
    const csv = [
      'company_name,phone_number,source,source_channel',
      'Acme Floors,(503) 555-0100,chrome_extension_maps_bulk,google_maps',
    ].join('\n');
    const { leads } = parseImportFile(Buffer.from(csv, 'utf8'), 'bulk.csv', {
      leadSource: 'chrome_extension',
    });
    assert.equal(leads.length, 1);
    assert.equal(leads[0].sourceChannel, 'google_maps');
  });
});
