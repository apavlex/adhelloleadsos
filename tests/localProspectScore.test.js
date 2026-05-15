const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { scoreLocalProspect, classifyWebsiteStatus } = require('../services/localProspectScore');

describe('localProspectScore', () => {
  it('Hot when no website and phone present', () => {
    const lead = {
      title: 'Joe Pizza',
      phone: '503-555-0100',
      website: 'N/A',
      email: 'N/A',
      url: 'https://maps.google.com/?q=1',
    };
    const r = scoreLocalProspect(lead);
    assert.equal(r.prospectTier, 'Hot');
    assert.match(r.websiteStatus, /no_site|social_only/);
  });

  it('Social-only URL is Hot with contact', () => {
    const lead = {
      title: 'Salon X',
      phone: '503-555-0200',
      website: 'https://instagram.com/salonx',
      email: 'N/A',
    };
    const r = scoreLocalProspect(lead);
    assert.equal(r.prospectTier, 'Hot');
    assert.equal(r.websiteStatus, 'social_only');
  });

  it('Warm for marketplace primary domain', () => {
    const lead = {
      title: 'Cuts Co',
      phone: '503-555-0300',
      website: 'https://booksy.com/en-us/dl/show-business',
      email: 'n/a',
    };
    const r = scoreLocalProspect(lead);
    assert.equal(r.prospectTier, 'Warm');
    assert.equal(r.websiteStatus, 'marketplace');
  });

  it('Skip missing title', () => {
    const r = scoreLocalProspect({ title: '', phone: '1' });
    assert.equal(r.prospectTier, 'Skip');
  });

  it('classifyWebsiteStatus detects weak site from audit flags', () => {
    const ws = classifyWebsiteStatus({
      title: 'Law LLC',
      website: 'https://example-law.com',
      phone: '555',
      isOutdated: true,
      isMobileFriendly: false,
    });
    assert.equal(ws.status, 'weak_site');
  });
});
