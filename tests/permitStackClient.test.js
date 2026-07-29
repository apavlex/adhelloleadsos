const { test } = require('node:test');
const assert = require('node:assert/strict');

const { permitToLead, permitsToLeads, permitBuyingSignals } = require('../services/permitLeadEnrich');
const { buildSearchParams, isConfigured } = require('../services/permitStackClient');

test('permitToLead maps contractor and address fields', () => {
  const lead = permitToLead(
    {
      id: 'abc-123',
      permit_number: '2026-094029 BP',
      status: 'ISSUED',
      category: 'ROOFING',
      address_street: '2204 THORNTON RD',
      address_city: 'AUSTIN',
      address_state: 'TX',
      address_zip: '78704',
      contractor_name: 'Texas Storm Group, LLC',
      description_raw: 'Re-roof project',
      date_filed: '2026-07-21',
      estimated_value: 15000,
    },
    { workspaceId: 'ws1', city: 'Austin', state: 'TX' }
  );
  assert.equal(lead.title, 'Texas Storm Group, LLC');
  assert.equal(lead.city, 'AUSTIN');
  assert.equal(lead.state, 'TX');
  assert.equal(lead.source, 'permit_stack');
  assert.equal(lead.permitNumber, '2026-094029 BP');
  assert.equal(lead.company, 'Texas Storm Group, LLC');
  assert.ok(Array.isArray(lead.buyingSignals) && lead.buyingSignals.length >= 1);
});

test('permitsToLeads returns one lead per permit', () => {
  const rows = permitsToLeads([{ contractor_name: 'Acme Roof', address_street: '1 Main' }], {});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'Acme Roof');
});

test('buildSearchParams normalizes category, filters, and pagination', () => {
  const q = buildSearchParams({
    city: 'Austin',
    state: 'tx',
    category: 'ROOFING',
    keyword: 'solar panel',
    contractor: 'ABC Roofing',
    zip: '78702',
    filed_after: '2026-01-01',
    maxResults: 5,
  });
  assert.equal(q.get('city'), 'Austin');
  assert.equal(q.get('state'), 'TX');
  assert.equal(q.get('category'), 'roofing');
  assert.equal(q.get('keyword'), 'solar panel');
  assert.equal(q.get('contractor_name'), 'ABC Roofing');
  assert.equal(q.get('zip_code'), '78702');
  assert.equal(q.get('filed_after'), '2026-01-01');
  assert.equal(q.get('per_page'), '5');
  assert.equal(q.get('zip'), null);
});

test('buildSearchParams accepts zip-only search', () => {
  const q = buildSearchParams({ zip: '98607', per_page: 10 });
  assert.equal(q.get('zip_code'), '98607');
  assert.equal(q.get('city'), null);
});

test('isConfigured reads PERMITSTACK_API_KEY from env object', () => {
  assert.equal(isConfigured({ PERMITSTACK_API_KEY: 'pk_test' }), true);
  assert.equal(isConfigured({}), false);
});

test('permitBuyingSignals flags recent high-value permits', () => {
  const recent = new Date();
  recent.setDate(recent.getDate() - 5);
  const signals = permitBuyingSignals({
    category: 'SOLAR',
    date_filed: recent.toISOString().slice(0, 10),
    estimated_value: 25000,
    description_raw: 'Solar install',
  });
  assert.ok(signals.some((s) => s.label.includes('30 days')));
  assert.ok(signals.some((s) => s.label.includes('High-value')));
});
