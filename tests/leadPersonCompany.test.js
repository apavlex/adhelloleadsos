const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolvePersonCompany,
  directoryHost,
  splitTitlePersonCompany,
} = require('../services/leadPersonCompany');

describe('leadPersonCompany', () => {
  it('splits agent - brokerage titles', () => {
    const s = splitTitlePersonCompany('Brenda Rojas - Manor Realty Group');
    assert.equal(s.person, 'Brenda Rojas');
    assert.equal(s.company, 'Manor Realty Group');
  });

  it('detects Zillow as listing host', () => {
    assert.equal(directoryHost('www.zillow.com'), 'zillow.com');
    assert.equal(directoryHost('https://www.zillow.com/homedetails/x'), 'zillow.com');
    assert.equal(directoryHost('manorrealty.com'), '');
  });

  it('resolvePersonCompany prefers contactName and brokerage', () => {
    const r = resolvePersonCompany({
      title: 'Brenda Rojas - Manor Realty Group',
      contactName: 'Brenda Rojas',
      website: 'https://www.zillow.com/homedetails/x',
    });
    assert.equal(r.personName, 'Brenda Rojas');
    assert.equal(r.companyName, 'Manor Realty Group');
    assert.equal(r.firstName, 'Brenda');
    assert.equal(r.lastName, 'Rojas');
    assert.equal(r.listingHost, 'zillow.com');
    assert.equal(r.canEnrichByName, true);
  });
});
