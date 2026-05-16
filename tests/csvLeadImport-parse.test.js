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
});
