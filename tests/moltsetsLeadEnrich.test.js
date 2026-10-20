/**
 * MoltSets client + lead enrichment mapping.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const moltsetsClient = require('../services/moltsetsClient');
const moltsetsLeadEnrich = require('../services/moltsetsLeadEnrich');

describe('moltsetsClient', () => {
  it('isConfigured reads MOLTSETS_API_KEY', () => {
    assert.equal(moltsetsClient.isConfigured({ MOLTSETS_API_KEY: 'ms_test' }), true);
    assert.equal(moltsetsClient.isConfigured({}), false);
  });

  it('resolveConfig trims trailing slash on base', () => {
    const cfg = moltsetsClient.resolveConfig({
      MOLTSETS_API_KEY: 'ms_x',
      MOLTSETS_API_BASE: 'https://api.moltsets.com/api/v1/tools/',
    });
    assert.equal(cfg.apiBase, 'https://api.moltsets.com/api/v1/tools');
  });

  it('peopleFromSearchResults flattens nested results.results', () => {
    const rows = moltsetsClient.peopleFromSearchResults({
      results: [{ full_name: 'Pat Owner' }],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].full_name, 'Pat Owner');
  });
});

describe('moltsetsLeadEnrich', () => {
  it('profileToExtract maps reverse-email and people fields', () => {
    const extract = moltsetsLeadEnrich.profileToExtract({
      first_name: 'Satya',
      last_name: 'Nadella',
      title: 'Chairman and CEO',
      linkedinurl: 'https://www.linkedin.com/in/satyanadella',
      work_email_confirmed: 'msft@microsoft.com',
      work_email_confirmed_risk_score: 'A',
      work_email_confirmed_status: '2026-10-12',
    });
    assert.equal(extract.email, 'msft@microsoft.com');
    assert.equal(extract.decision_maker_name, 'Satya Nadella');
    assert.equal(extract.decision_maker_title, 'Chairman and CEO');
    assert.match(extract.linkedin, /linkedin\.com\/in\/satyanadella/i);
    assert.match(extract.email_validation_status, /A/);
  });

  it('extractHasSignal requires a contact signal', () => {
    assert.equal(moltsetsLeadEnrich.extractHasSignal({ email: 'a@b.com' }), true);
    assert.equal(moltsetsLeadEnrich.extractHasSignal({ decision_maker_name: 'Pat' }), true);
    assert.equal(moltsetsLeadEnrich.extractHasSignal({}), false);
  });

  it('pickBestPerson prefers local city matches', () => {
    const picked = moltsetsLeadEnrich.pickBestPerson(
      [
        { full_name: 'Far Away', city: 'Austin', state: 'TX', _score: 5 },
        { full_name: 'Local Owner', city: 'Vancouver', state: 'WA', _score: 3, linkedin_url: 'https://linkedin.com/in/local' },
      ],
      { city: 'Vancouver', state: 'WA' },
    );
    assert.equal(picked.full_name, 'Local Owner');
  });

  it('enrichLeadForBusiness reverse-looks up an existing email', async () => {
    const original = moltsetsClient.reverseEmailLookup;
    moltsetsClient.reverseEmailLookup = async () => ({
      status: 'ok',
      results: {
        first_name: 'Alex',
        last_name: 'Rivera',
        title: 'Owner',
        linkedinurl: 'https://linkedin.com/in/alex-rivera',
        work_email_confirmed: 'alex@acmeplumbing.com',
        work_email_confirmed_risk_score: 'A',
      },
      metadata: {},
    });
    try {
      const pack = await moltsetsLeadEnrich.enrichLeadForBusiness(
        {
          title: 'Acme Plumbing',
          email: 'alex@acmeplumbing.com',
          website: 'https://acmeplumbing.com',
        },
        { MOLTSETS_API_KEY: 'ms_test' },
        { includeMobile: false },
      );
      assert.equal(pack.used, true);
      assert.equal(pack.extract.email, 'alex@acmeplumbing.com');
      assert.equal(pack.extract.decision_maker_name, 'Alex Rivera');
      assert.ok(pack.steps.includes('reverse_email_lookup'));
    } finally {
      moltsetsClient.reverseEmailLookup = original;
    }
  });

  it('UI and integration wiring expose MoltSets', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const root = path.join(__dirname, '..');
    const integrations = fs.readFileSync(path.join(root, 'views/workspace/sections/integrations.ejs'), 'utf8');
    const envExample = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
    const providerTests = fs.readFileSync(path.join(root, 'services/integrationProviderTests.js'), 'utf8');
    const ensure = fs.readFileSync(path.join(root, 'services/ensureLeadEmail.js'), 'utf8');
    const leads = fs.readFileSync(path.join(root, 'routes/leads.js'), 'utf8');

    assert.match(integrations, /integration-moltsets/);
    assert.match(integrations, /integration-contact-enrich/);
    assert.match(integrations, /contactEnrichPrimary/);
    assert.match(integrations, /MoltSets → Outscraper fallback/);
    assert.match(integrations, /moltsetsApiKey/);
    assert.match(integrations, /provider: 'moltsets'/);
    assert.match(envExample, /MOLTSETS_API_KEY/);
    assert.match(providerTests, /moltsets:/);
    assert.match(providerTests, /testMoltsets/);
    assert.match(ensure, /tryMoltsetsEmail|moltsets/);
    assert.match(leads, /moltsetsLeadEnrich/);
    assert.match(leads, /MoltSets/);
    // Manual enhance: MoltSets before Outscraper contacts fallback.
    const enhanceBlock = leads.slice(leads.indexOf('async function runLeadEnhancement'));
    const msIdx = enhanceBlock.indexOf('MoltSets primary');
    const osIdx = enhanceBlock.indexOf('Outscraper Contacts & Leads — fallback');
    assert.ok(msIdx > 0 && osIdx > msIdx, 'MoltSets should run before Outscraper contacts in enhance');
    const moltsetsAttempt = ensure.indexOf("label: 'moltsets'");
    const outscraperAttempt = ensure.indexOf("label: 'outscraper_contacts'");
    assert.ok(
      moltsetsAttempt > 0 && outscraperAttempt > moltsetsAttempt,
      'ensureLeadEmail should try MoltSets before Outscraper',
    );
    const finder = fs.readFileSync(path.join(root, 'services/contactFinder.js'), 'utf8');
    assert.match(finder, /MoltSets first/);
    assert.match(finder, /collectFromMoltsetsExtract/);
  });
});
