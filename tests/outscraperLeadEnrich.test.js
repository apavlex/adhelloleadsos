const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const outscraperLeadEnrich = require('../services/outscraperLeadEnrich');

describe('outscraperLeadEnrich', () => {
  it('resolves domain from lead website', () => {
    assert.equal(
      outscraperLeadEnrich.resolveLeadDomain({ website: 'https://www.acme-roof.com/about' }),
      'acme-roof.com',
    );
    assert.equal(outscraperLeadEnrich.resolveLeadDomain({ website: '' }), '');
  });

  it('maps contacts-and-leads row to patch and extract', () => {
    const pack = outscraperLeadEnrich.buildEnrichmentFromContactsRow(
      {
        domain: 'acmeroof.com',
        emails: [{ value: 'info@acmeroof.com' }],
        phones: ['503-555-0100'],
        socials: {
          facebook: 'https://facebook.com/acmeroof',
          linkedin: 'https://linkedin.com/company/acme-roof',
        },
        contacts: [
          {
            full_name: 'Jane Doe',
            title: 'Owner',
            emails: [{ value: 'jane@acmeroof.com' }],
          },
        ],
        details: { address: '123 Main St', city: 'Portland', state: 'OR' },
      },
      { title: 'Acme Roof', email: '', phone: '' },
    );

    assert.equal(pack.used, true);
    assert.equal(pack.patch.email, 'info@acmeroof.com');
    assert.equal(pack.patch.phone, '503-555-0100');
    assert.equal(pack.patch.decisionMakerName, 'Jane Doe');
    assert.equal(pack.patch.decisionMakerTitle, 'Owner');
    assert.equal(pack.patch.city, 'Portland');
    assert.match(pack.patch.website, /acmeroof\.com/);
    assert.match(pack.extract.facebook, /facebook\.com/);
  });

  it('does not overwrite existing lead fields', () => {
    const pack = outscraperLeadEnrich.buildEnrichmentFromContactsRow(
      {
        emails: [{ value: 'new@example.com' }],
        phones: ['555-0000'],
      },
      { email: 'existing@example.com', phone: '555-9999' },
    );
    assert.equal(pack.patch.email, undefined);
    assert.equal(pack.patch.phone, undefined);
  });

  it('detects when lead needs Outscraper contacts enrichment', () => {
    assert.equal(
      outscraperLeadEnrich.leadNeedsOutscraperContacts({
        website: 'https://joeplumbing.com',
        email: '',
        phone: '',
      }),
      true,
    );
    assert.equal(
      outscraperLeadEnrich.leadNeedsOutscraperContacts({
        website: 'https://joeplumbing.com',
        email: 'joe@joeplumbing.com',
        phone: '555-0100',
        facebook: 'https://facebook.com/joe',
        linkedin: 'https://linkedin.com/company/joe',
        decisionMakerName: 'Joe',
      }),
      false,
    );
    assert.equal(outscraperLeadEnrich.leadNeedsOutscraperContacts({ title: 'No site' }), false);
  });

  it('picks first email and phone from mixed list shapes', () => {
    assert.equal(
      outscraperLeadEnrich.firstEmailFromList(['a@x.com', 'b@x.com']),
      'a@x.com',
    );
    assert.equal(
      outscraperLeadEnrich.firstEmailFromList([{ email: 'c@x.com' }]),
      'c@x.com',
    );
    assert.equal(
      outscraperLeadEnrich.firstPhoneFromList([{ phone: '503-555-1212' }]),
      '503-555-1212',
    );
  });
});
