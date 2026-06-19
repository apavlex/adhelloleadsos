const test = require('node:test');
const assert = require('node:assert/strict');
const { UPWORK_PROPOSAL_EXAMPLE } = require('../config/upworkProposalExample');
const { UPWORK_PROPOSAL_SERVICES } = require('../config/upworkProposalServices');
const { normalizeUpworkProposal, trimProposalList } = require('../services/upworkProposalStorage');
const { sanitizeProposalOutput } = require('../services/upworkProposalAi');

test('example proposal includes structure markers', () => {
  assert.match(UPWORK_PROPOSAL_EXAMPLE, /cross-device consistency/i);
  assert.match(UPWORK_PROPOSAL_EXAMPLE, /\*\*My approach for your project:\*\*/);
  assert.match(UPWORK_PROPOSAL_EXAMPLE, /Looking forward to hearing more/i);
});

test('service options include website design', () => {
  assert.ok(UPWORK_PROPOSAL_SERVICES.some((s) => s.key === 'website_design'));
});

test('normalizeUpworkProposal requires proposal text', () => {
  assert.equal(normalizeUpworkProposal({ jobTitle: 'x' }), null);
  const one = normalizeUpworkProposal({
    jobTitle: 'Squarespace redesign',
    proposal: 'Hello there',
    serviceKey: 'website_design',
  });
  assert.ok(one && one.id);
  assert.equal(one.serviceKey, 'website_design');
});

test('sanitizeProposalOutput strips markdown header', () => {
  assert.equal(
    sanitizeProposalOutput('# Upwork Proposal\n\n---\n\nHey there'),
    'Hey there',
  );
});

test('trimProposalList caps length', () => {
  const list = Array.from({ length: 100 }, (_, i) => ({ id: String(i) }));
  assert.equal(trimProposalList(list).length, 80);
});
