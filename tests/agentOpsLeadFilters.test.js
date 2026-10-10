const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  leadBlocksOutreach,
  isHomeServiceLead,
  isPnwMetroLead,
  filterProspectPool,
  filterOpportunityPool,
} = require('../services/agentOps/leadFilters');

describe('agentOps lead filters', () => {
  it('blocks DNC, smsOptOut, and SMS STOP tags', () => {
    assert.equal(leadBlocksOutreach({ doNotCall: true }), true);
    assert.equal(leadBlocksOutreach({ doNotContact: true }), true);
    assert.equal(leadBlocksOutreach({ smsOptOut: true }), true);
    assert.equal(leadBlocksOutreach({ tags: ['SMS STOP'] }), true);
    assert.equal(leadBlocksOutreach({ tags: ['Do Not Contact'] }), true);
    assert.equal(leadBlocksOutreach({ tags: ['Hot'], phone: '5035550100' }), false);
  });

  it('keeps home-service trades and drops restaurants / SEO', () => {
    assert.equal(isHomeServiceLead({ categoryName: 'Plumber', title: '1st Call Plumbing', city: 'Vancouver' }), true);
    assert.equal(isHomeServiceLead({ categoryName: 'HVAC contractor', title: 'Big Deal HVAC', city: 'Portland' }), true);
    assert.equal(isHomeServiceLead({ categoryName: 'Korean restaurant', title: 'KO Sisters Seoul Food', city: 'Portland' }), false);
    assert.equal(isHomeServiceLead({ title: 'KO SISTERS SEOUL FOOD', categoryName: 'Restaurant' }), false);
  });

  it('limits Prospect pool to Portland–Vancouver metro', () => {
    assert.equal(isPnwMetroLead({ city: 'Vancouver', state: 'WA' }), true);
    assert.equal(isPnwMetroLead({ city: 'Portland' }), true);
    assert.equal(isPnwMetroLead({ city: 'Camas' }), true);
    assert.equal(isPnwMetroLead({ city: 'Seattle' }), false);
    assert.equal(isPnwMetroLead({ city: 'Austin' }), false);
  });

  it('filterProspectPool applies all prospect rules', () => {
    const leads = [
      { key: 'a', title: 'Camas Plumbing', categoryName: 'Plumber', city: 'Camas', phone: '1' },
      { key: 'b', title: 'KO Sisters Seoul Food', categoryName: 'Restaurant', city: 'Portland', phone: '1' },
      { key: 'c', title: 'PDX HVAC', categoryName: 'HVAC', city: 'Portland', phone: '1', tags: ['SMS STOP'] },
      { key: 'd', title: 'Seattle Electric', categoryName: 'Electrician', city: 'Seattle', phone: '1' },
    ];
    const out = filterProspectPool(leads);
    assert.deepEqual(out.map((l) => l.key), ['a']);
  });

  it('filterOpportunityPool drops blocked contacts only', () => {
    const leads = [
      { key: 'a', title: '1st Call Plumbing', tags: ['SMS STOP'] },
      { key: 'b', title: 'M&R Tree', city: 'Vancouver' },
      { key: 'c', title: 'Other', doNotContact: true },
    ];
    const out = filterOpportunityPool(leads);
    assert.deepEqual(out.map((l) => l.key), ['b']);
  });
});
