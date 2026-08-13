const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseGhlMessageWebhook,
  findLeadForGhlMessage,
  extractEmailAddress,
  processMessageWebhook,
} = require('../services/ghlSync');
const { buildEngagementInbox } = require('../services/engagementInbox');

describe('GHL InboundMessage email / SMS → engagement', () => {
  it('extractEmailAddress parses angle-bracket from headers', () => {
    assert.equal(extractEmailAddress('Jordan Lead <jordan@acme.test>'), 'jordan@acme.test');
    assert.equal(extractEmailAddress('jordan@acme.test'), 'jordan@acme.test');
  });

  it('parseGhlMessageWebhook handles official GHL inbound email sample', () => {
    const parsed = parseGhlMessageWebhook({
      type: 'InboundMessage',
      locationId: 'kF4NJ5gzRyQF2gKFD34G',
      body: '<div style="font-family: verdana, geneva; font-size: 11pt;">Testing Email Notification</div>',
      contactId: '3bN9f8LYJFG8F232XMUbfq',
      conversationId: 'yCdNo6pwyTLYKgg6V2gj',
      dateAdded: '2024-01-12T12:59:04.045Z',
      direction: 'inbound',
      messageType: 'Email',
      emailMessageId: 'sddfDSF3G56GHG',
      from: 'Jordan Lead <jordan@acme.test>',
      threadId: 'sddfDSF3G56GHG',
      subject: 'Order Confirmed',
      to: 'sales@agency.test',
    });
    assert.ok(parsed);
    assert.equal(parsed.channel, 'email');
    assert.equal(parsed.direction, 'inbound');
    assert.equal(parsed.messageId, 'sddfDSF3G56GHG');
    assert.equal(parsed.fromEmail, 'jordan@acme.test');
    assert.match(parsed.body, /Testing Email Notification/);
  });

  it('parseGhlMessageWebhook accepts eventType and subject-only email bodies', () => {
    const parsed = parseGhlMessageWebhook({
      eventType: 'InboundMessage',
      contactId: 'ct_1',
      messageType: 'Email',
      emailMessageId: 'em_1',
      subject: 'Re: interested',
      body: '',
      from: 'lead@example.com',
      direction: 'inbound',
    });
    assert.ok(parsed);
    assert.equal(parsed.channel, 'email');
    assert.equal(parsed.body, 'Re: interested');
    assert.equal(parsed.messageId, 'em_1');
  });

  it('parseGhlMessageWebhook still parses SMS inbound', () => {
    const parsed = parseGhlMessageWebhook({
      type: 'InboundMessage',
      contactId: 'ct_sms',
      messageType: 'SMS',
      messageId: 'msg_1',
      body: 'Yes call me',
      from: '+15551234567',
      direction: 'inbound',
    });
    assert.ok(parsed);
    assert.equal(parsed.channel, 'sms');
    assert.equal(parsed.fromPhone, '15551234567');
  });

  it('findLeadForGhlMessage falls back to from email when ghlContactId missing', () => {
    const parsed = parseGhlMessageWebhook({
      type: 'InboundMessage',
      contactId: 'unknown_ghl_id',
      messageType: 'Email',
      emailMessageId: 'em_2',
      body: 'Interested',
      from: 'match@acme.test',
      direction: 'inbound',
    });
    const lead = findLeadForGhlMessage(
      [{ key: 'lead:acme', email: 'match@acme.test' }],
      parsed,
    );
    assert.equal(lead.key, 'lead:acme');
  });

  it('processMessageWebhook records email_reply engagement for matched lead', async () => {
    const dbService = require('../services/database');
    const sequenceEngine = require('../services/sequenceEngine');
    const userTasks = require('../services/userTasks');
    const origAll = dbService.getAllLeads;
    const origUpdate = dbService.updateLead;
    const origWs = dbService.getWorkspace;
    const origPause = sequenceEngine.pauseSequence;
    const origTask = userTasks.upsertOpenTaskForLead;
    const saved = [];

    dbService.getAllLeads = async () => [
      {
        key: 'lead:email-1',
        email: 'jordan@acme.test',
        updates: [],
        sequenceState: { status: 'active', nextDueAt: '2026-08-12T12:00:00.000Z' },
      },
    ];
    dbService.getWorkspace = async () => ({
      id: 'default',
      ownerUserId: 'owner@test.com',
    });
    dbService.updateLead = async (key, patch) => {
      saved.push({ key, patch });
      return { key, email: 'jordan@acme.test', ...patch };
    };
    sequenceEngine.pauseSequence = async () => ({ ok: true });
    userTasks.upsertOpenTaskForLead = async () => ({ id: 'task-email-1' });

    try {
      const result = await processMessageWebhook(
        {
          type: 'InboundMessage',
          locationId: 'loc_test',
          body: '<p>Sounds good — call me</p>',
          contactId: 'ghl_unlinked',
          dateAdded: '2026-08-12T16:00:00.000Z',
          direction: 'inbound',
          messageType: 'Email',
          emailMessageId: 'em_reply_1',
          from: 'Jordan <jordan@acme.test>',
          subject: 'Re: Audit',
        },
        { workspaceId: 'default' },
      );
      assert.equal(result.action, 'email_inbound');
      assert.equal(result.replyHandled, true);
      assert.ok(saved.length >= 1);
      assert.equal(saved[0].patch.engagementSignals.lastSignalType, 'email_reply');
      assert.ok(saved[0].patch.engagementSignals.emailRepliedAt);
      const signalUpdate = saved[0].patch.updates.find((u) => u.type === 'engagement_signal');
      assert.ok(signalUpdate);
      assert.equal(signalUpdate.signalType, 'email_reply');

      const inbox = buildEngagementInbox(
        [{ key: 'lead:email-1', title: 'Acme', ...saved[0].patch }],
        { now: new Date('2026-08-13T12:00:00.000Z'), windowDays: 7 },
      );
      assert.ok(inbox.summary.byType.email_reply >= 1);
    } finally {
      dbService.getAllLeads = origAll;
      dbService.updateLead = origUpdate;
      dbService.getWorkspace = origWs;
      sequenceEngine.pauseSequence = origPause;
      userTasks.upsertOpenTaskForLead = origTask;
    }
  });
});
