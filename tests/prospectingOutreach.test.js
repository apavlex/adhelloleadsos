const test = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');
const { getTemplate } = require('../services/sequenceTemplates');
const {
  normalizeEngagementSignals,
  recordEngagementSignals,
  signalPriorityForLead,
} = require('../services/engagementSignals');
const {
  isActiveProspecting,
  isActiveOtherCadence,
  leadMatchesFilter,
  enrollLeadInAutoOutreach,
  leadHasAutoOutreachTag,
  AUTO_OUTREACH_CAMPAIGN,
} = require('../services/prospectingEnroll');
const { buildCallQueue } = require('../services/callQueue');
const {
  leadEligibleForPool,
  rankLeadForPool,
  normalizeAutoPoolSettings,
} = require('../services/prospectingAutoPool');
const { parseGhlEngagementWebhook } = require('../services/ghlSync');

test('auto_outreach_7 template is email/sms only', () => {
  const tpl = getTemplate('auto_outreach_7');
  assert.ok(tpl);
  assert.equal(tpl.steps.length, 4);
  tpl.steps.forEach((step) => {
    assert.ok(['email', 'sms'].includes(step.channel));
  });
});

test('recordEngagementSignals sets reply and last signal fields', () => {
  const sig = recordEngagementSignals({}, 'sms_reply', '2026-08-05T10:00:00.000Z');
  assert.equal(sig.smsRepliedAt, '2026-08-05T10:00:00.000Z');
  assert.equal(sig.lastSignalType, 'sms_reply');
  assert.equal(sig.lastSignalAt, '2026-08-05T10:00:00.000Z');
});

test('signalPriorityForLead ranks reply above click above audit open', () => {
  const replyLead = { engagementSignals: normalizeEngagementSignals({ emailRepliedAt: '2026-08-05T09:00:00.000Z' }) };
  const clickLead = { engagementSignals: normalizeEngagementSignals({ linkClickedAt: '2026-08-05T09:00:00.000Z' }) };
  const auditLead = { engagementSignals: normalizeEngagementSignals({ auditOpenedAt: '2026-08-05T09:00:00.000Z' }) };
  const openLead = { engagementSignals: normalizeEngagementSignals({ emailOpenedAt: '2026-08-05T09:00:00.000Z' }) };
  assert.ok(signalPriorityForLead(replyLead) < signalPriorityForLead(clickLead));
  assert.ok(signalPriorityForLead(clickLead) < signalPriorityForLead(auditLead));
  assert.ok(signalPriorityForLead(auditLead) < signalPriorityForLead(openLead));
});

test('buildCallQueue sorts by engagement priority', () => {
  const now = new Date('2026-08-06T12:00:00.000Z');
  const queue = buildCallQueue(
    [
      {
        key: 'lead:open',
        title: 'Open Co',
        status: 'Lead Captured',
        engagementSignals: { emailOpenedAt: '2026-08-05T11:00:00.000Z', lastSignalAt: '2026-08-05T11:00:00.000Z', lastSignalType: 'email_open' },
      },
      {
        key: 'lead:reply',
        title: 'Reply Co',
        status: 'Lead Captured',
        engagementSignals: { smsRepliedAt: '2026-08-05T10:00:00.000Z', lastSignalAt: '2026-08-05T10:00:00.000Z', lastSignalType: 'sms_reply' },
      },
      {
        key: 'lead:click',
        title: 'Click Co',
        status: 'Lead Captured',
        engagementSignals: { linkClickedAt: '2026-08-05T09:00:00.000Z', lastSignalAt: '2026-08-05T09:00:00.000Z', lastSignalType: 'link_click' },
      },
      {
        key: 'lead:closed',
        title: 'Closed Co',
        status: 'Closed - Won',
        engagementSignals: { smsRepliedAt: '2026-08-05T08:00:00.000Z', lastSignalAt: '2026-08-05T08:00:00.000Z' },
      },
    ],
    { now, windowDays: 7 },
  );
  assert.equal(queue.length, 3);
  assert.equal(queue[0].leadKey, 'lead:reply');
  assert.equal(queue[1].leadKey, 'lead:click');
  assert.equal(queue[2].leadKey, 'lead:open');
});

test('leadMatchesFilter supports tier filter', () => {
  const hot = { prospectTier: 'Hot', folderKey: 'f1' };
  const warm = { prospectTier: 'Warm', folderKey: 'f1' };
  assert.equal(leadMatchesFilter(hot, { tier: 'Hot' }), true);
  assert.equal(leadMatchesFilter(warm, { tier: 'Hot' }), false);
  assert.equal(leadMatchesFilter(hot, { folderKey: 'f1' }), true);
});

test('isActiveProspecting detects active auto outreach campaign', () => {
  assert.equal(
    isActiveProspecting({ prospecting: { status: 'active', campaign: AUTO_OUTREACH_CAMPAIGN } }),
    true,
  );
  assert.equal(isActiveProspecting({ prospecting: { status: 'paused', campaign: AUTO_OUTREACH_CAMPAIGN } }), false);
});

test('isActiveOtherCadence ignores legacy auto_outreach_7 sequenceState', () => {
  assert.equal(
    isActiveOtherCadence({
      sequenceState: { status: 'active', templateId: AUTO_OUTREACH_CAMPAIGN },
    }),
    false,
  );
  assert.equal(
    isActiveOtherCadence({
      sequenceState: { status: 'active', templateId: 'clay_5' },
    }),
    true,
  );
});

test('enrollLeadInAutoOutreach tags and sets prospecting without internal cadence', async () => {
  let testKey = '';
  try {
    testKey = await dbService.saveLead({
      title: 'Auto Outreach Tag Test',
      workspaceId: 'default',
      status: 'Not Contacted',
      pipelineStage: 1,
      tags: [],
      phone: '+15555550201',
      email: 'auto@test.com',
      source: 'test',
    });
    const saved = await dbService.getLead(testKey);
    const wid = saved.workspaceId;
    const result = await enrollLeadInAutoOutreach({
      leadKey: testKey,
      workspaceId: wid,
    });
    assert.equal(result.enrolled, true);
    const lead = await dbService.getLead(testKey, wid);
    assert.equal(lead.prospecting.status, 'active');
    assert.equal(lead.prospecting.campaign, AUTO_OUTREACH_CAMPAIGN);
    assert.ok(!(lead.sequenceState && lead.sequenceState.status === 'active' && lead.sequenceState.templateId === AUTO_OUTREACH_CAMPAIGN));
    assert.equal(await leadHasAutoOutreachTag(lead, wid), true);
  } finally {
    if (testKey) await dbService.deleteLead(testKey);
  }
});

test('enrollLeadInAutoOutreach skips already enrolled unless reEnroll', async () => {
  let testKey = '';
  try {
    testKey = await dbService.saveLead({
      title: 'Auto Outreach Skip Test',
      workspaceId: 'default',
      status: 'Not Contacted',
      pipelineStage: 1,
      tags: [],
      phone: '+15555550202',
      email: 'skip@test.com',
      source: 'test',
      prospecting: {
        status: 'active',
        campaign: AUTO_OUTREACH_CAMPAIGN,
        enrolledAt: '2026-08-01T00:00:00.000Z',
      },
    });
    const saved = await dbService.getLead(testKey);
    const wid = saved.workspaceId;
    const skipped = await enrollLeadInAutoOutreach({ leadKey: testKey, workspaceId: wid });
    assert.equal(skipped.enrolled, false);
    assert.equal(skipped.reason, 'already_enrolled');
    const re = await enrollLeadInAutoOutreach({
      leadKey: testKey,
      workspaceId: wid,
      reEnroll: true,
    });
    assert.equal(re.enrolled, true);
    assert.equal(re.reEnroll, true);
  } finally {
    if (testKey) await dbService.deleteLead(testKey);
  }
});

test('enrollLeadInAutoOutreach blocks active other cadence', async () => {
  let testKey = '';
  try {
    testKey = await dbService.saveLead({
      title: 'Other Cadence Block Test',
      workspaceId: 'default',
      status: 'Not Contacted',
      pipelineStage: 1,
      tags: [],
      phone: '+15555550203',
      email: 'block@test.com',
      source: 'test',
      sequenceState: { status: 'active', templateId: 'clay_5', stepIndex: 0 },
    });
    const saved = await dbService.getLead(testKey);
    const wid = saved.workspaceId;
    const result = await enrollLeadInAutoOutreach({ leadKey: testKey, workspaceId: wid });
    assert.equal(result.enrolled, false);
    assert.equal(result.reason, 'active_other_cadence');
  } finally {
    if (testKey) await dbService.deleteLead(testKey);
  }
});

test('normalizeAutoPoolSettings caps maxLeads at 100 for GHL spam safety', () => {
  const s = normalizeAutoPoolSettings({ enabled: true, maxLeads: 500 });
  assert.equal(s.maxLeads, 100);
  assert.equal(normalizeAutoPoolSettings({ maxLeads: 0 }).maxLeads, 1);
});

test('utcDayKey and leadAutoOutreachEnrolledOnDay detect same UTC day', () => {
  const {
    utcDayKey,
    leadAutoOutreachEnrolledOnDay,
    AUTO_OUTREACH_DAILY_CAP,
  } = require('../services/prospectingEnroll');
  assert.equal(AUTO_OUTREACH_DAILY_CAP, 100);
  const day = utcDayKey('2026-08-12T15:00:00.000Z');
  assert.equal(day, '2026-08-12');
  assert.equal(
    leadAutoOutreachEnrolledOnDay(
      {
        prospecting: {
          campaign: AUTO_OUTREACH_CAMPAIGN,
          lastEnrolledAt: '2026-08-12T01:00:00.000Z',
        },
      },
      day,
    ),
    true,
  );
  assert.equal(
    leadAutoOutreachEnrolledOnDay(
      {
        prospecting: {
          campaign: AUTO_OUTREACH_CAMPAIGN,
          lastEnrolledAt: '2026-08-11T23:00:00.000Z',
        },
      },
      day,
    ),
    false,
  );
});

test('auto-pool eligibility skips enrolled and closed leads', () => {
  const settings = normalizeAutoPoolSettings({ tier: 'Hot', maxLeads: 10 });
  const hot = {
    key: 'lead:1',
    phone: '+15551234567',
    prospectTier: 'Hot',
    status: 'Not Contacted',
  };
  assert.equal(leadEligibleForPool(hot, settings), true);
  assert.equal(
    leadEligibleForPool(
      { ...hot, prospecting: { status: 'active', campaign: AUTO_OUTREACH_CAMPAIGN } },
      settings,
    ),
    false,
  );
  assert.equal(leadEligibleForPool({ ...hot, status: 'Closed - Won' }, settings), false);
});

test('rankLeadForPool prefers Hot tier and higher score', () => {
  const a = { title: 'A', phone: '555', prospectTier: 'Hot', website: 'N/A', email: 'a@test.com' };
  const b = { title: 'B', phone: '555', prospectTier: 'Warm', website: 'https://b.com', email: 'b@test.com' };
  assert.ok(rankLeadForPool(a) > rankLeadForPool(b));
});

test('parseGhlEngagementWebhook detects email open and link click samples', () => {
  const openPayload = {
    type: 'EmailOpened',
    locationId: 'loc_1',
    contactId: 'ct_1',
    dateAdded: '2026-08-05T12:00:00.000Z',
  };
  const clickPayload = {
    event: 'LinkClicked',
    location_id: 'loc_1',
    contact: { id: 'ct_2' },
    linkUrl: 'https://example.com/report',
  };
  const openParsed = parseGhlEngagementWebhook(openPayload);
  const clickParsed = parseGhlEngagementWebhook(clickPayload);
  assert.equal(openParsed.signalType, 'email_open');
  assert.equal(clickParsed.signalType, 'link_click');
  assert.equal(openParsed.contactId, 'ct_1');
  assert.equal(clickParsed.contactId, 'ct_2');
});
