const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildLeadInput,
  betterContactRowToExtract,
  extractHasSignal,
  extractDomain,
} = require('../services/betterContactClient');

describe('betterContactClient', () => {
  it('buildLeadInput maps business lead with website domain', () => {
    const row = buildLeadInput({
      key: 'lead:abc',
      title: 'Acme Plumbing LLC',
      website: 'https://www.acme-plumbing.com',
      decisionMakerName: 'Jane Smith',
    });
    assert.equal(row.company, 'Acme Plumbing LLC');
    assert.equal(row.first_name, 'Jane');
    assert.equal(row.last_name, 'Smith');
    assert.equal(row.company_domain, 'acme-plumbing.com');
  });

  it('betterContactRowToExtract maps email and phone', () => {
    const ex = betterContactRowToExtract({
      contact_email_address: 'jane@acme.com',
      contact_phone_number: '+15125550100',
      contact_linkedin_profile_url: 'https://linkedin.com/in/jane',
      contact_first_name: 'Jane',
      contact_last_name: 'Smith',
      contact_job_title: 'Owner',
    });
    assert.equal(ex.email, 'jane@acme.com');
    assert.equal(ex.phone, '+15125550100');
    assert.equal(ex.linkedin, 'https://linkedin.com/in/jane');
    assert.ok(extractHasSignal(ex));
  });

  it('extractDomain normalizes website', () => {
    assert.equal(extractDomain('https://www.example.com/about'), 'example.com');
  });
});
