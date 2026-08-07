const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const builtWithEnrich = require('../services/builtWithEnrich');

describe('builtWithEnrich', () => {
  it('detects when lead needs BuiltWith enrichment', () => {
    assert.equal(
      builtWithEnrich.leadNeedsBuiltWith({
        website: 'https://acme.com',
        cmsPlatform: '',
        techStackTags: [],
      }),
      true,
    );
    assert.equal(
      builtWithEnrich.leadNeedsBuiltWith({
        website: 'https://acme.com',
        cmsPlatform: 'WordPress',
        techStackTags: ['Google Analytics'],
      }),
      false,
    );
    assert.equal(builtWithEnrich.leadNeedsBuiltWith({ title: 'No site' }), false);
  });

  it('parses tech stack tags from array or JSON string', () => {
    assert.deepEqual(builtWithEnrich.parseTechStackTags(['HubSpot', 'GTM']), ['HubSpot', 'GTM']);
    assert.deepEqual(builtWithEnrich.parseTechStackTags('["Meta Pixel","Calendly"]'), [
      'Meta Pixel',
      'Calendly',
    ]);
  });
});
