'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const contactEnrichPreference = require('../services/contactEnrichPreference');

describe('contactEnrichPreference', () => {
  test('defaults to moltsets primary', () => {
    assert.equal(contactEnrichPreference.resolvePrimary({}), 'moltsets');
    assert.equal(contactEnrichPreference.preferMoltsets({}), true);
  });

  test('honors CONTACT_ENRICH_PRIMARY=outscraper', () => {
    assert.equal(
      contactEnrichPreference.resolvePrimary({ CONTACT_ENRICH_PRIMARY: 'outscraper' }),
      'outscraper',
    );
    assert.equal(
      contactEnrichPreference.preferMoltsets({ CONTACT_ENRICH_PRIMARY: 'outscraper' }),
      false,
    );
  });

  test('status list labels MoltSets primary by default', () => {
    const list = contactEnrichPreference.getContactEnrichProviderStatusList({
      MOLTSETS_API_KEY: 'ms_x',
      OUTSCRAPER_API_KEY: 'os_x',
    });
    assert.equal(list[0].id, 'moltsets');
    assert.match(list[0].label, /primary/i);
    assert.match(list[1].label, /fallback/i);
    assert.equal(list[0].configured, true);
    assert.equal(list[1].configured, true);
  });
});
