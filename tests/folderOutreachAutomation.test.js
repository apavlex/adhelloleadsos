const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeFolderOutreachSettings,
  leadEligibleForFolderOutreach,
  resolveFolderKeysForOutreach,
  leadInFolderScope,
  MAX_GHL_GOAL_LEN,
  MAX_GHL_WORKFLOW_PROMPT_LEN,
} = require('../services/folderOutreachAutomation');
const { AUTO_OUTREACH_CAMPAIGN } = require('../services/prospectingEnroll');
const { valuesFromLead } = require('../services/ghlPhoneLineFields');
const { buildFolderTree } = require('../services/folderTree');

test('normalizeFolderOutreachSettings applies defaults', () => {
  const s = normalizeFolderOutreachSettings({ enabled: true, maxLeads: 999, smsOnly: true });
  assert.equal(s.enabled, true);
  assert.equal(s.maxLeads, 100);
  assert.equal(s.smsOnly, true);
  assert.equal(s.tier, '');
  assert.equal(s.ghlGoal, '');
  assert.equal(s.ghlWorkflowPrompt, '');
  assert.equal(s.aiIcpReview, true);
  assert.equal(s.minIcpScore, 8);
  assert.equal(s.findMissingEmail, true);
  assert.equal(s.requireEmail, false);
});

test('normalizeFolderOutreachSettings can disable AI ICP review', () => {
  const s = normalizeFolderOutreachSettings({ aiIcpReview: false, minIcpScore: 9.5 });
  assert.equal(s.aiIcpReview, false);
  assert.equal(s.minIcpScore, 9.5);
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

test('leadEligibleForFolderOutreach ignores paused cadence but blocks active other cadence', () => {
  const settings = normalizeFolderOutreachSettings({});
  const base = {
    key: 'lead:4',
    folderKey: 'folder:a',
    phone: '+15551234567',
    status: 'Not Contacted',
  };
  assert.equal(
    leadEligibleForFolderOutreach(
      { ...base, sequenceState: { status: 'paused', templateId: 'day1_call' } },
      settings,
      'folder:a',
    ),
    true,
  );
  assert.equal(
    leadEligibleForFolderOutreach(
      { ...base, sequenceState: { status: 'active', templateId: 'day1_call' } },
      settings,
      'folder:a',
    ),
    false,
  );
});

test('leadEligibleForFolderOutreach allows website-only when findMissingEmail is on', () => {
  const withHunt = normalizeFolderOutreachSettings({ findMissingEmail: true });
  const noHunt = normalizeFolderOutreachSettings({ findMissingEmail: false });
  const lead = {
    key: 'lead:5',
    folderKey: 'folder:a',
    phone: '',
    email: '',
    website: 'https://example-water.com',
    status: 'Not Contacted',
  };
  assert.equal(leadEligibleForFolderOutreach(lead, withHunt, 'folder:a'), true);
  assert.equal(leadEligibleForFolderOutreach(lead, noHunt, 'folder:a'), false);
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

test('kickoffFolderOutreachInBackground returns false without folderKey', () => {
  const { kickoffFolderOutreachInBackground } = require('../services/folderOutreachAutomation');
  assert.equal(kickoffFolderOutreachInBackground({ workspaceId: 'ws' }), false);
  assert.equal(kickoffFolderOutreachInBackground({ workspaceId: 'ws', folderKey: '' }), false);
});

test('leadEligibleForFolderOutreach includes nested subfolder leads via key set', () => {
  const settings = normalizeFolderOutreachSettings({});
  const folders = [
    { key: 'folder:parent', name: 'Parent', parentFolderKey: '' },
    { key: 'folder:child', name: 'Child', parentFolderKey: 'folder:parent' },
  ];
  const keys = resolveFolderKeysForOutreach(folders, 'folder:parent');
  assert.equal(keys.has('folder:parent'), true);
  assert.equal(keys.has('folder:child'), true);

  const childLead = {
    key: 'lead:1',
    folderKey: 'folder:child',
    phone: '+15551234567',
    status: 'Not Contacted',
  };
  assert.equal(leadEligibleForFolderOutreach(childLead, settings, 'folder:parent'), false);
  assert.equal(leadEligibleForFolderOutreach(childLead, settings, keys), true);
  assert.equal(leadInFolderScope(childLead, keys), true);
});

test('resolveFolderKeysForOutreach falls back to root key', () => {
  const keys = resolveFolderKeysForOutreach([], 'folder:solo');
  assert.equal(keys.size, 1);
  assert.equal(keys.has('folder:solo'), true);
  assert.ok(buildFolderTree);
});
