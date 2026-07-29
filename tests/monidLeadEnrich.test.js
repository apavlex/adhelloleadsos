const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const monid = require('../services/monidClient');
const monidLeadEnrich = require('../services/monidLeadEnrich');

describe('monidClient', () => {
  it('detects configured API key', () => {
    assert.equal(monid.isConfigured({ MONID_API_KEY: 'monid_live_test' }), true);
    assert.equal(monid.isConfigured({}), false);
  });

  it('resolves API base', () => {
    const cfg = monid.resolveConfig({ MONID_API_KEY: 'k', MONID_API_BASE: 'https://api.monid.ai/' });
    assert.equal(cfg.apiBase, 'https://api.monid.ai');
  });
});

describe('monidLeadEnrich', () => {
  it('maps Apollo organization output', () => {
    const extract = monidLeadEnrich.apolloOrgToExtract({
      organization: {
        name: 'Acme Roofing',
        website_url: 'http://www.acmeroof.com',
        sanitized_phone: '+15035551234',
        linkedin_url: 'http://www.linkedin.com/company/acme',
        facebook_url: 'https://facebook.com/acme',
        twitter_url: 'https://twitter.com/acme',
      },
    });
    assert.equal(extract.phone, '+15035551234');
    assert.match(extract.website, /acmeroof\.com/);
    assert.match(extract.linkedin, /linkedin\.com/);
    assert.match(extract.facebook, /facebook\.com/);
  });

  it('maps PDL company output', () => {
    const extract = monidLeadEnrich.pdlCompanyToExtract({
      status: 200,
      website: 'acmeroof.com',
      linkedin_url: 'linkedin.com/company/acme',
      location: { street_address: '123 Main St', name: 'portland, oregon, united states' },
    });
    assert.match(extract.website, /acmeroof/);
    assert.match(extract.linkedin, /linkedin/);
    assert.equal(extract.address, '123 Main St');
  });

  it('builds Apollo query from lead', () => {
    const q = monidLeadEnrich.buildApolloQuery({
      title: 'Joe Plumbing',
      website: 'https://www.joeplumbing.com',
    });
    assert.equal(q.name, 'Joe Plumbing');
    assert.equal(q.domain, 'joeplumbing.com');
  });

  it('detects extract signal', () => {
    assert.equal(monidLeadEnrich.extractHasSignal({ phone: '503-555-0100' }), true);
    assert.equal(monidLeadEnrich.extractHasSignal({}), false);
  });
});
