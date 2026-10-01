const test = require('node:test');
const assert = require('node:assert/strict');
const { describeBusinessProfile } = require('../services/pavlex/pavlexContext');
const { isCrmIntent } = require('../services/pavlex/pavlexCrmIntent');
const { CRM_COMMAND_HINTS } = require('../services/pavlex/pavlexConstants');

test('business profile summarizes workspace setup answers and service area', () => {
  const line = describeBusinessProfile({
    name: 'Flooring',
    salesIntake: {
      businessName: 'Camas Flooring',
      vertical: 'Flooring',
      targetAudience: 'Interior Designers',
      differentiator: 'Same day measure',
    },
    icp: { keyword: 'flooring', city: 'Camas', state: 'WA' },
  });
  assert.match(line, /Camas Flooring/);
  assert.match(line, /Flooring/);
  assert.match(line, /sells to Interior Designers/);
  assert.match(line, /area: Camas, WA/);
});

test('business profile falls back to the ICP keyword and is empty when nothing is set', () => {
  assert.equal(describeBusinessProfile({ icp: { keyword: 'roofing' } }), 'roofing');
  assert.equal(describeBusinessProfile({}), '');
  assert.equal(describeBusinessProfile(null), '');
});

test('referral partner questions route to CRM tools', () => {
  for (const msg of [
    'Help me find referral partners',
    'Who could send me work?',
    'I need more referrals',
    'Which partners should I team up with?',
  ]) {
    assert.equal(isCrmIntent(msg), true, msg);
  }
  assert.equal(isCrmIntent('hello'), false);
});

test('prompt hints include the referral partner playbook', () => {
  assert.match(CRM_COMMAND_HINTS, /REFERRAL PARTNER PLAYBOOK/);
  assert.match(CRM_COMMAND_HINTS, /folder_name "Referral Partners"/);
});
