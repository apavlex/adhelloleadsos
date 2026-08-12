const { test } = require('node:test');
const assert = require('node:assert/strict');
const workspaceSalesScripts = require('../services/workspaceSalesScripts');
const { SCRIPT_LIBRARY } = require('../services/salesConstants');

test('materializeOfferCatalog returns empty when workspace has none', () => {
  const ws = {};
  const catalog = workspaceSalesScripts.materializeOfferCatalog(ws, SCRIPT_LIBRARY);
  assert.deepEqual(catalog, []);
});

test('materializeOfferCatalog returns stored custom catalog', () => {
  const ws = {
    salesScriptOfferCatalog: [{ key: 'electric', label: 'Spark Electric', vertical: 'Electrical' }],
  };
  const catalog = workspaceSalesScripts.materializeOfferCatalog(ws, SCRIPT_LIBRARY);
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].key, 'electric');
});

test('patchOfferOutreachFields updates sender metadata', () => {
  const row = { key: 'electric', label: 'Spark Electric Co' };
  const next = workspaceSalesScripts.patchOfferOutreachFields(row, {
    senderBusinessName: 'Spark Electric Co',
    vertical: 'Electrical / Home Services',
    auditLink: 'https://example.com/audit',
  });
  assert.equal(next.senderBusinessName, 'Spark Electric Co');
  assert.equal(next.vertical, 'Electrical / Home Services');
  assert.equal(next.auditLink, 'https://example.com/audit');
  assert.equal(next.label, 'Spark Electric Co');
});
