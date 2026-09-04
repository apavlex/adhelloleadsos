const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSop, normalizeSteps } = require('../config/sops');

describe('sops normalize', () => {
  it('parses numbered steps from textarea', () => {
    const steps = normalizeSteps('1. Call the lead\n2. Send email\n\n3. Log CRM');
    assert.deepEqual(steps, ['Call the lead', 'Send email', 'Log CRM']);
  });

  it('requires title and steps', () => {
    assert.throws(() => normalizeSop({ title: '', steps: ['x'] }), /Title/);
    assert.throws(() => normalizeSop({ title: 'Test', steps: '' }), /step/i);
  });

  it('keeps a stable id when provided', () => {
    const sop = normalizeSop({
      id: 'inbound-new-leads',
      title: 'Responding to New Inbound Leads',
      steps: ['Call within 15 minutes'],
    });
    assert.equal(sop.id, 'inbound-new-leads');
    assert.equal(sop.steps.length, 1);
  });
});
