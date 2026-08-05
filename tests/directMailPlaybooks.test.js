const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  suggestPlaybookForLead,
  getPlaybookById,
  scorePlaybook,
  normalizeContext,
} = require('../services/directMailPlaybooks');

test('normalizeContext maps aliases', () => {
  assert.equal(normalizeContext('after-call'), 'after_call');
  assert.equal(normalizeContext('voicemail'), 'after_voicemail');
});

test('suggestPlaybookForLead picks HVAC playbook for HVAC lead', () => {
  const { playbook } = suggestPlaybookForLead(
    { title: 'Cool Air HVAC', categoryName: 'hvac contractor', city: 'Portland' },
    'after_call'
  );
  assert.equal(playbook.id, 'hvac_audit');
});

test('suggestPlaybookForLead picks no-answer bump on disposition', () => {
  const { playbook } = suggestPlaybookForLead(
    { title: 'Acme Services', lastDisposition: 'no_answer' },
    'after_voicemail'
  );
  assert.equal(playbook.id, 'no_answer_bump');
});

test('suggestPlaybookForLead picks formation playbook by job type', () => {
  const { playbook } = suggestPlaybookForLead(
    { title: 'Sunrise LLC', jobType: 'business_formations', city: 'Denver' },
    'after_email'
  );
  assert.equal(playbook.id, 'new_formation_welcome');
});

test('getPlaybookById returns playbook', () => {
  const pb = getPlaybookById('plumbing_audit');
  assert.ok(pb);
  assert.match(pb.headline, /\{business\}/);
});

test('scorePlaybook ranks category match above generic', () => {
  const hvac = scorePlaybook(
    getPlaybookById('hvac_audit'),
    { title: 'Best Heating Co' },
    'after_call'
  );
  const general = scorePlaybook(
    getPlaybookById('local_audit_general'),
    { title: 'Best Heating Co' },
    'after_call'
  );
  assert.ok(hvac > general);
});
