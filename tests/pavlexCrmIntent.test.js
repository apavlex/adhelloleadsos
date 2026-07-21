const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isCrmIntent, crmUnavailableMessage } = require('../services/pavlex/pavlexCrmIntent');

describe('pavlexCrmIntent', () => {
  it('detects lead count questions', () => {
    assert.equal(isCrmIntent('How many leads do I have?'), true);
    assert.equal(isCrmIntent('How many leads are in the Landscaping folder?'), true);
  });

  it('detects folder and search questions', () => {
    assert.equal(isCrmIntent('List my folders'), true);
    assert.equal(isCrmIntent('Find Acme Roofing'), true);
    assert.equal(isCrmIntent('Show first 10 landscaping leads'), true);
  });

  it('allows general chitchat without CRM tools', () => {
    assert.equal(isCrmIntent('What should I focus on today?'), false);
    assert.equal(isCrmIntent('Hello'), false);
  });

  it('formats CRM unavailable message', () => {
    assert.match(crmUnavailableMessage('OPENAI_API_KEY missing'), /CRM connection unavailable/);
  });
});
