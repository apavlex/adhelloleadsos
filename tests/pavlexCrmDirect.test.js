const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { matchDirectCrmQuery } = require('../services/pavlex/pavlexCrmDirect');

describe('pavlexCrmDirect', () => {
  it('matches list folders', () => {
    assert.equal(matchDirectCrmQuery('List my folders').tool, 'list_folders');
    assert.equal(matchDirectCrmQuery('Show my pipeline').tool, 'list_folders');
  });

  it('matches total lead count', () => {
    const m = matchDirectCrmQuery('How many leads do I have?');
    assert.equal(m.tool, 'count_leads');
    assert.deepEqual(m.args, {});
  });

  it('matches folder lead count', () => {
    const m = matchDirectCrmQuery('How many leads are in Landscaping?');
    assert.equal(m.tool, 'count_leads');
    assert.equal(m.args.folder_name, 'Landscaping');
  });

  it('matches list leads with limit', () => {
    const m = matchDirectCrmQuery('Show first 10 landscaping leads');
    assert.equal(m.tool, 'list_leads');
    assert.equal(m.args.limit, 10);
    assert.match(m.args.folder_name, /landscaping/i);
  });

  it('matches search', () => {
    const m = matchDirectCrmQuery('Find Acme Roofing');
    assert.equal(m.tool, 'search_leads');
    assert.equal(m.args.query, 'Acme Roofing');
  });

  it('returns null for non-direct questions', () => {
    assert.equal(matchDirectCrmQuery('What should I focus on today?'), null);
  });
});
