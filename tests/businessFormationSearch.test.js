const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  parseFormationStatesFromBody,
  normalizeStateCode,
  defaultRegisteredAfter,
  stateNamesForCodes,
} = require('../services/businessFormationConstants');
const { buildActorInput } = require('../services/businessFormationSearch');
const { formationToLead, formationsToLeads } = require('../services/businessFormationLeadEnrich');
const { computeDedupeKey } = require('../services/leadDedupe');
const { normalizeJobType, JOB_TYPES } = require('../services/scrapeJobTypes');

test('parseFormationStatesFromBody accepts codes and names', () => {
  const codes = parseFormationStatesFromBody({ formationStates: ['NY', 'Colorado', 'XX'] });
  assert.deepEqual(codes, ['NY', 'CO']);
});

test('normalizeStateCode maps state names', () => {
  assert.equal(normalizeStateCode('oregon'), 'OR');
  assert.equal(normalizeStateCode('PA'), 'PA');
});

test('buildActorInput maps state codes to Apify state names', () => {
  const input = buildActorInput({
    stateCodes: ['NY', 'CO'],
    entityTypes: ['LLC'],
    registeredAfter: '2026-01-01',
    maxResults: 25,
    monitorMode: true,
  });
  assert.deepEqual(input.states, ['New York', 'Colorado']);
  assert.equal(input.registeredAfter, '2026-01-01');
  assert.equal(input.monitorMode, true);
  assert.deepEqual(input.entityTypes, ['LLC']);
});

test('formationToLead maps registry record to CRM lead', () => {
  const lead = formationToLead(
    {
      businessName: 'Sunrise HVAC LLC',
      stateCode: 'CO',
      city: 'Denver',
      registryNumber: '20261234567',
      entityCategory: 'LLC',
      formationDate: '2026-06-10T00:00:00.000Z',
      registeredAgent: { name: 'Jane Smith', isOrganization: false },
      leadScore: 84,
    },
    { workspaceId: 'default', folderKey: 'folder:1' }
  );
  assert.equal(lead.title, 'Sunrise HVAC LLC');
  assert.equal(lead.source, 'business_formation');
  assert.equal(lead.jobType, JOB_TYPES.BUSINESS_FORMATIONS);
  assert.equal(lead.formationRegistryId, '20261234567');
  assert.equal(lead.dedupeKey, 'formation:co:20261234567');
  assert.ok(Array.isArray(lead.buyingSignals));
});

test('computeDedupeKey prefers formation registry id', () => {
  const key = computeDedupeKey({
    formationRegistryId: 'ABC123',
    state: 'NY',
    title: 'Example LLC',
  });
  assert.equal(key, 'formation:ny:abc123');
});

test('formationsToLeads skips empty business names', () => {
  const leads = formationsToLeads([{ businessName: '' }, { businessName: 'Valid Co LLC', stateCode: 'OR' }], {});
  assert.equal(leads.length, 1);
});

test('normalizeJobType accepts formations aliases', () => {
  assert.equal(normalizeJobType('formations'), JOB_TYPES.BUSINESS_FORMATIONS);
  assert.equal(normalizeJobType('new_formations'), JOB_TYPES.BUSINESS_FORMATIONS);
});

test('defaultRegisteredAfter returns ISO date', () => {
  const d = defaultRegisteredAfter(7);
  assert.match(d, /^\d{4}-\d{2}-\d{2}$/);
});

test('stateNamesForCodes returns full names', () => {
  assert.deepEqual(stateNamesForCodes(['NY', 'OR']), ['New York', 'Oregon']);
});
