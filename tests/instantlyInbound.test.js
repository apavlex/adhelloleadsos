const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const instantlyInbound = require('../services/instantlyInbound');
const { buildEngagementInbox } = require('../services/engagementInbox');

describe('Instantly inbound webhooks → engagement', () => {
  it('parses reply_received payload fields', () => {
    const payload = {
      event_type: 'reply_received',
      timestamp: '2026-11-19T20:00:00.000Z',
      lead_email: 'Jordan <jordan@acme.test>',
      email_id: 'em-uuid-1',
      email_account: 'outreach@agency.test',
      unibox_url: 'https://app.instantly.ai/unibox?id=em-uuid-1',
      reply_text: 'Yes, call me tomorrow',
      campaign_id: 'camp-9',
    };
    assert.equal(instantlyInbound.eventTypeOf(payload), 'reply_received');
    assert.equal(instantlyInbound.leadEmailOf(payload), 'jordan@acme.test');
    assert.equal(instantlyInbound.replyBodyOf(payload), 'Yes, call me tomorrow');
    assert.equal(instantlyInbound.messageIdOf(payload), 'em-uuid-1');
    assert.equal(instantlyInbound.uniboxUrlOf(payload), 'https://app.instantly.ai/unibox?id=em-uuid-1');
    assert.equal(instantlyInbound.emailAccountOf(payload), 'outreach@agency.test');
    assert.equal(instantlyInbound.isReplyEvent('reply_received'), true);
    assert.equal(instantlyInbound.signalTypeForEvent('email_opened'), 'email_open');
    assert.equal(instantlyInbound.signalTypeForEvent('link_clicked'), 'link_click');
  });

  it('processWebhook records email_reply engagement + Unibox fields', async () => {
    const dbService = require('../services/database');
    const sequenceEngine = require('../services/sequenceEngine');
    const userTasks = require('../services/userTasks');
    const origAll = dbService.getAllLeads;
    const origByEmail = dbService.findLeadByEmail;
    const origUpdate = dbService.updateLead;
    const origWs = dbService.getWorkspace;
    const origPause = sequenceEngine.pauseSequence;
    const origTask = userTasks.upsertOpenTaskForLead;
    const saved = [];

    dbService.findLeadByEmail = async () => ({
      key: 'lead:acme',
      email: 'jordan@acme.test',
      title: 'Acme HVAC',
      updates: [],
      sequenceState: { status: 'active', nextDueAt: '2026-11-20T12:00:00.000Z' },
    });
    dbService.getAllLeads = async () => [];
    dbService.getWorkspace = async () => ({ id: 'default', ownerUserId: 'owner@test.com' });
    dbService.updateLead = async (key, patch) => {
      saved.push({ key, patch });
      return { key, email: 'jordan@acme.test', title: 'Acme HVAC', ...patch };
    };
    sequenceEngine.pauseSequence = async () => ({ ok: true });
    userTasks.upsertOpenTaskForLead = async () => ({ id: 'task-1' });

    try {
      const result = await instantlyInbound.processWebhook(
        {
          event_type: 'reply_received',
          timestamp: '2026-11-19T20:05:00.000Z',
          lead_email: 'jordan@acme.test',
          email_id: 'em-reply-9',
          email_account: 'sdr@agency.test',
          unibox_url: 'https://app.instantly.ai/app/unibox/em-reply-9',
          reply_text: 'Interested — text me',
          campaign_id: 'camp-1',
        },
        { workspaceId: 'default' },
      );
      assert.equal(result.action, 'email_inbound');
      assert.equal(result.replyHandled, true);
      assert.ok(saved.length >= 1);
      const patch = saved[0].patch;
      assert.equal(patch.engagementSignals.lastSignalType, 'email_reply');
      assert.ok(patch.engagementSignals.emailRepliedAt);
      assert.equal(patch.instantlyLastEmailId, 'em-reply-9');
      assert.equal(patch.instantlyUniboxUrl, 'https://app.instantly.ai/app/unibox/em-reply-9');
      assert.equal(patch.instantlyEmailAccount, 'sdr@agency.test');
      const inbound = patch.updates.find((u) => u.type === 'email_inbound');
      assert.ok(inbound);
      assert.equal(inbound.provider, 'instantly');
      assert.match(inbound.value, /Interested/);

      const inbox = buildEngagementInbox(
        [
          {
            key: 'lead:acme',
            title: 'Acme HVAC',
            instantlyUniboxUrl: patch.instantlyUniboxUrl,
            instantlyLastEmailId: patch.instantlyLastEmailId,
            instantlyEmailAccount: patch.instantlyEmailAccount,
            ...patch,
          },
        ],
        { now: new Date('2026-11-20T12:00:00.000Z'), windowDays: 7 },
      );
      assert.ok(inbox.summary.byType.email_reply >= 1);
      assert.equal(inbox.rows[0].uniboxUrl, 'https://app.instantly.ai/app/unibox/em-reply-9');
      assert.equal(inbox.rows[0].canInstantlyReply, true);
    } finally {
      dbService.getAllLeads = origAll;
      dbService.findLeadByEmail = origByEmail;
      dbService.updateLead = origUpdate;
      dbService.getWorkspace = origWs;
      sequenceEngine.pauseSequence = origPause;
      userTasks.upsertOpenTaskForLead = origTask;
    }
  });

  it('processWebhook maps email_opened to engagement signal', async () => {
    const dbService = require('../services/database');
    const origByEmail = dbService.findLeadByEmail;
    const origUpdate = dbService.updateLead;
    const saved = [];
    dbService.findLeadByEmail = async () => ({
      key: 'lead:open',
      email: 'open@acme.test',
      updates: [],
    });
    dbService.updateLead = async (key, patch) => {
      saved.push(patch);
      return { key, ...patch };
    };
    try {
      const result = await instantlyInbound.processWebhook(
        {
          event_type: 'email_opened',
          lead_email: 'open@acme.test',
          email_id: 'em-open-1',
          timestamp: '2026-11-19T18:00:00.000Z',
        },
        { workspaceId: 'default' },
      );
      assert.equal(result.action, 'email_open');
      assert.equal(result.applied, true);
      assert.equal(saved[0].engagementSignals.lastSignalType, 'email_open');
    } finally {
      dbService.findLeadByEmail = origByEmail;
      dbService.updateLead = origUpdate;
    }
  });

  it('dedupes the same Instantly email_id', async () => {
    const dbService = require('../services/database');
    const sequenceEngine = require('../services/sequenceEngine');
    const userTasks = require('../services/userTasks');
    const origByEmail = dbService.findLeadByEmail;
    const origUpdate = dbService.updateLead;
    const origWs = dbService.getWorkspace;
    const origPause = sequenceEngine.pauseSequence;
    const origTask = userTasks.upsertOpenTaskForLead;
    let updates = [];

    dbService.findLeadByEmail = async () => ({
      key: 'lead:dup',
      email: 'dup@acme.test',
      updates,
    });
    dbService.getWorkspace = async () => ({ id: 'default', ownerUserId: 'o@test.com' });
    dbService.updateLead = async (key, patch) => {
      updates = patch.updates || updates;
      return { key, email: 'dup@acme.test', updates, ...patch };
    };
    sequenceEngine.pauseSequence = async () => ({});
    userTasks.upsertOpenTaskForLead = async () => ({ id: 't' });

    try {
      const first = await instantlyInbound.processWebhook(
        {
          event_type: 'reply_received',
          lead_email: 'dup@acme.test',
          email_id: 'same-id',
          reply_text: 'hello',
        },
        { workspaceId: 'default' },
      );
      assert.equal(first.replyHandled, true);
      const second = await instantlyInbound.processWebhook(
        {
          event_type: 'reply_received',
          lead_email: 'dup@acme.test',
          email_id: 'same-id',
          reply_text: 'hello again',
        },
        { workspaceId: 'default' },
      );
      assert.equal(second.replyHandled, false);
      assert.equal(second.reason, 'duplicate');
    } finally {
      dbService.findLeadByEmail = origByEmail;
      dbService.updateLead = origUpdate;
      dbService.getWorkspace = origWs;
      sequenceEngine.pauseSequence = origPause;
      userTasks.upsertOpenTaskForLead = origTask;
    }
  });
});
