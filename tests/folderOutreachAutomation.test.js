const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeFolderOutreachSettings,
  leadEligibleForFolderOutreach,
  MAX_GHL_GOAL_LEN,
  MAX_GHL_WORKFLOW_PROMPT_LEN,
} = require('../services/folderOutreachAutomation');
const { AUTO_OUTREACH_CAMPAIGN } = require('../services/prospectingEnroll');
const { valuesFromLead } = require('../services/ghlPhoneLineFields');

test('normalizeFolderOutreachSettings applies defaults', () => {
  const s = normalizeFolderOutreachSettings({ enabled: true, maxLeads: 999, smsOnly: true });
  assert.equal(s.enabled, true);
  assert.equal(s.maxLeads, 100);
  assert.equal(s.smsOnly, true);
  assert.equal(s.tier, '');
  assert.equal(s.ghlGoal, '');
  assert.equal(s.ghlWorkflowPrompt, '');
});

test('normalizeFolderOutreachSettings trims and caps ghlGoal and ghlWorkflowPrompt', () => {
  const longGoal = 'x'.repeat(MAX_GHL_GOAL_LEN + 50);
  const longPrompt = 'p'.repeat(MAX_GHL_WORKFLOW_PROMPT_LEN + 100);
  const s = normalizeFolderOutreachSettings({
    ghlGoal: `  ${longGoal}  `,
    ghlWorkflowPrompt: longPrompt,
  });
  assert.equal(s.ghlGoal.length, MAX_GHL_GOAL_LEN);
  assert.equal(s.ghlGoal[0], 'x');
  assert.equal(s.ghlWorkflowPrompt.length, MAX_GHL_WORKFLOW_PROMPT_LEN);
  assert.equal(s.ghlWorkflowPrompt[0], 'p');
  assert.equal(normalizeFolderOutreachSettings({ ghlGoal: '  ' }).ghlGoal, '');
});

test('leadEligibleForFolderOutreach respects folderKey and smsOnly', () => {
  const settings = normalizeFolderOutreachSettings({ smsOnly: true });
  const mobileLead = {
    key: 'lead:1',
    folderKey: 'folder:a',
    phone: '+15551234567',
    email: 'a@test.com',
    status: 'Not Contacted',
    phoneLineType: 'mobile',
  };
  const landlineLead = {
    ...mobileLead,
    key: 'lead:2',
    phoneLineType: 'landline',
  };
  assert.equal(leadEligibleForFolderOutreach(mobileLead, settings, 'folder:a'), true);
  assert.equal(leadEligibleForFolderOutreach(landlineLead, settings, 'folder:a'), false);
  assert.equal(leadEligibleForFolderOutreach(mobileLead, settings, 'folder:b'), false);
});

test('leadEligibleForFolderOutreach skips active auto outreach', () => {
  const settings = normalizeFolderOutreachSettings({});
  const lead = {
    key: 'lead:3',
    folderKey: 'folder:a',
    phone: '+15551234567',
    status: 'Not Contacted',
    prospecting: { status: 'active', campaign: AUTO_OUTREACH_CAMPAIGN },
  };
  assert.equal(leadEligibleForFolderOutreach(lead, settings, 'folder:a'), false);
});

test('valuesFromLead maps mobile and landline for GHL', () => {
  assert.deepEqual(
    valuesFromLead({ phone: '+15551234567', phoneLineType: 'mobile', phoneCarrier: 'Verizon' }),
    { lineLabel: 'Mobile', carrier: 'Verizon', smsOk: 'Yes' },
  );
  assert.deepEqual(
    valuesFromLead({ phone: '+15551234567', phoneLineType: 'landline' }),
    { lineLabel: 'Landline', carrier: '', smsOk: 'No' },
  );
});
