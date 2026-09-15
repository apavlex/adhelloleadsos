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
  it('slugs business names for my.adhello.io hosts', () => {
    assert.equal(websiteBuildSlug('Lifestyle Flooring'), 'lifestyle-flooring');
    assert.equal(websiteBuildSlug('A & B HVAC!!'), 'a-b-hvac');
    assert.equal(websiteBuildSlug(''), 'site');
  });

  it('builds a public website URL on my.adhello.io', () => {
    assert.equal(
      websiteBuildPublicUrl({ title: 'Flooring Pros' }),
      'https://flooring-pros.my.adhello.io',
    );
    assert.equal(
      websiteBuildPublicUrl({ title: 'X', websiteBuildUrl: 'https://custom.example.com' }),
      'https://custom.example.com',
    );
  });

  it('rewrites legacy my.adhello.ai dashboard URLs to .io', () => {
    assert.equal(ghlCrmBaseUrl('https://my.adhello.ai'), 'https://my.adhello.io');
    assert.equal(ghlCrmBaseUrl('https://my.adhello.ai/'), 'https://my.adhello.io');
    assert.equal(
      websiteBuildPublicUrl({ title: 'X', websiteBuildUrl: 'https://flooring.my.adhello.ai' }),
      'https://flooring.my.adhello.io',
    );
  });

  it('points GHL websites builder at my.adhello.io', () => {
    assert.equal(ghlCrmBaseUrl(''), DEFAULT_CRM_HOST);
    assert.equal(DEFAULT_CRM_HOST, 'https://my.adhello.io');
    assert.equal(
      ghlWebsitesBuilderUrl({ locationId: 'loc123' }),
      'https://my.adhello.io/v2/location/loc123/funnels-websites/websites',
    );
    assert.equal(
      ghlContactCrmUrl({ locationId: 'loc123', contactId: 'abc' }),
      'https://my.adhello.io/v2/location/loc123/contacts/detail/abc',
    );
  });
});
