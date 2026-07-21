const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { CRM_COMMAND_HINTS } = require('../services/pavlex/pavlexAgent');

describe('pavlexAgent', () => {
  it('documents supported CRM command patterns', () => {
    assert.match(CRM_COMMAND_HINTS, /list_folders/);
    assert.match(CRM_COMMAND_HINTS, /count_leads/);
    assert.match(CRM_COMMAND_HINTS, /list_leads/);
    assert.match(CRM_COMMAND_HINTS, /update_lead/);
  });
});

describe('pavlex routes module', () => {
  it('loads without error', () => {
    assert.ok(require('../routes/pavlex'));
    assert.ok(require('../routes/debug'));
  });
});
