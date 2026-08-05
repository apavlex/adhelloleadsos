const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseCommsWebhook, processWebhook } = require('../services/commsSync');

describe('commsSync', () => {
  it('parses inbound message.received payloads', () => {
    const parsed = parseCommsWebhook({
      type: 'message.received',
      message: {
        id: 'msg_123',
        body: 'Hello there',
        from: '+15551234567',
        to: '+15559876543',
        channel: 'imessage',
      },
    });
    assert.ok(parsed);
    assert.equal(parsed.direction, 'inbound');
    assert.equal(parsed.body, 'Hello there');
    assert.equal(parsed.messageId, 'msg_123');
    assert.equal(parsed.channel, 'imessage');
  });

  it('inbound processWebhook runs inbound reply rules (cadence pause + engagement)', async () => {
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
        key: 'lead:comms-1',
        phone: '+15551234567',
        updates: [],
        sequenceState: { status: 'active', nextDueAt: '2026-08-06T12:00:00.000Z' },
      },
    ];
    dbService.getWorkspace = async () => ({
      id: 'default',
      ownerUserId: 'owner@test.com',
    });
    dbService.updateLead = async (key, patch) => {
      saved.push({ key, patch });
      return { key, ...patch };
    };
    sequenceEngine.pauseSequence = async () => ({ ok: true });
    userTasks.upsertOpenTaskForLead = async () => ({ id: 'task-99' });

    try {
      const result = await processWebhook(
        {
          type: 'message.received',
          message: {
            id: 'msg_in_1',
            body: 'Yes call me',
            from: '+15551234567',
            to: '+15559876543',
            channel: 'imessage',
          },
        },
        { workspaceId: 'default' },
      );
      assert.equal(result.action, 'inbound_reply');
      assert.equal(result.pausedSequence, true);
      assert.ok(result.taskId);
      assert.ok(saved.length >= 1);
      assert.equal(saved[0].patch.status, 'Connected - Follow Up');
      assert.equal(saved[0].patch.engagementSignals.lastSignalType, 'sms_reply');
      const inbound = saved[0].patch.updates.find((u) => u.type === 'sms_inbound');
      assert.ok(inbound);
      assert.equal(inbound.commsMessageId, 'msg_in_1');
      assert.equal(inbound.channel, 'imessage');
    } finally {
      dbService.getAllLeads = origAll;
      dbService.updateLead = origUpdate;
      dbService.getWorkspace = origWs;
      sequenceEngine.pauseSequence = origPause;
      userTasks.upsertOpenTaskForLead = origTask;
    }
  });
});
