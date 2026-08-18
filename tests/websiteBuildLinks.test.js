const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  websiteBuildSlug,
  websiteBuildPublicUrl,
  ghlCrmBaseUrl,
  ghlWebsitesBuilderUrl,
  ghlContactCrmUrl,
  DEFAULT_CRM_HOST,
} = require('../services/websiteBuildLinks');

describe('websiteBuildLinks', () => {
  it('slugs business names for my.adhello.ai hosts', () => {
    assert.equal(websiteBuildSlug('Lifestyle Flooring'), 'lifestyle-flooring');
    assert.equal(websiteBuildSlug('A & B HVAC!!'), 'a-b-hvac');
    assert.equal(websiteBuildSlug(''), 'site');
  });

  it('builds a public website URL on my.adhello.ai', () => {
    assert.equal(
      websiteBuildPublicUrl({ title: 'Flooring Pros' }),
      'https://flooring-pros.my.adhello.ai',
    );
    assert.equal(
      websiteBuildPublicUrl({ title: 'X', websiteBuildUrl: 'https://custom.example.com' }),
      'https://custom.example.com',
    );
  });

  it('points GHL websites builder at my.adhello.ai', () => {
    assert.equal(ghlCrmBaseUrl(''), DEFAULT_CRM_HOST);
    assert.equal(
      ghlWebsitesBuilderUrl({ locationId: 'loc123' }),
      'https://my.adhello.ai/v2/location/loc123/funnels-websites/websites',
    );
    assert.equal(
      ghlContactCrmUrl({ locationId: 'loc123', contactId: 'abc' }),
      'https://my.adhello.ai/v2/location/loc123/contacts/detail/abc',
    );
  });
});
