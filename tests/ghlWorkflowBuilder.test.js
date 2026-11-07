const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { PROMPT } = require('../services/ghlAutoOutreachPromptText');

describe('ghl auto-outreach prompt + API disable detection', () => {
  it('ships a shared auto-outreach prompt for UI and automation fallback', () => {
    assert.ok(PROMPT.length > 1000);
    assert.match(PROMPT, /auto-outreach/);
    assert.match(PROMPT, /Contact tag added/);
  });

  it('detects WORKFLOW_API_NOT_ENABLED_FOR_LOCATION errors', () => {
    // Keep this helper inline so the test stays dependency-light (no better-sqlite3).
    function isWorkflowApiDisabledError(err) {
      const msg = String((err && err.message) || err || '');
      const code = String((err && err.code) || '');
      return (
        code === 'WORKFLOW_API_NOT_ENABLED_FOR_LOCATION' ||
        /WORKFLOW_API_NOT_ENABLED_FOR_LOCATION/i.test(msg) ||
        /workflows?\s*api.*(not enabled|not available|private beta)/i.test(msg)
      );
    }
    assert.equal(isWorkflowApiDisabledError({ code: 'WORKFLOW_API_NOT_ENABLED_FOR_LOCATION' }), true);
    assert.equal(isWorkflowApiDisabledError(new Error('Workflows API not enabled for this location')), true);
    assert.equal(isWorkflowApiDisabledError(new Error('network timeout')), false);
  });
});
