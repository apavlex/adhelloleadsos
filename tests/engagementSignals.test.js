const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildEngagementUpdateEntry,
  engagementBadgeForLead,
  applyEngagementSignal,
} = require('../services/engagementSignals');

test('buildEngagementUpdateEntry includes signal metadata', () => {
  const entry = buildEngagementUpdateEntry('link_click', '2026-08-05T12:00:00.000Z', {
    provider: 'ghl',
    linkUrl: 'https://example.com/audit',
    messageId: 'msg-1',
  });
  assert.equal(entry.type, 'engagement_signal');
  assert.equal(entry.signalType, 'link_click');
  assert.match(entry.value, /Link click/);
  assert.match(entry.value, /example.com/);
  assert.equal(entry.messageId, 'msg-1');
});

test('engagementBadgeForLead returns recent signal', () => {
  const now = Date.parse('2026-08-05T12:00:00.000Z');
  const badge = engagementBadgeForLead(
    {
      engagementSignals: {
        lastSignalType: 'email_open',
        lastSignalAt: '2026-08-05T11:00:00.000Z',
      },
    },
    7,
    now,
  );
  assert.ok(badge);
  assert.equal(badge.label, 'Email open');
});

test('engagementBadgeForLead hides stale signals', () => {
  const now = Date.parse('2026-08-05T12:00:00.000Z');
  const badge = engagementBadgeForLead(
    {
      engagementSignals: {
        lastSignalType: 'email_open',
        lastSignalAt: '2026-07-01T11:00:00.000Z',
      },
    },
    7,
    now,
  );
  assert.equal(badge, null);
});

test('applyEngagementSignal shape includes updates entry', async () => {
  const saved = [];
  const dbService = require('../services/database');
  const origGet = dbService.getLead;
  const origUpdate = dbService.updateLead;
  const origWs = require('../services/userTasks').upsertOpenTaskForLead;

  dbService.getLead = async () => null;
  dbService.updateLead = async (key, patch) => {
    saved.push({ key, patch });
    return { key, ...patch };
  };
  require('../services/userTasks').upsertOpenTaskForLead = async () => ({ id: 'task-1' });

  try {
    const result = await applyEngagementSignal({
      lead: { key: 'lead:test', title: 'Acme', updates: [] },
      workspaceId: 'ws1',
      signalType: 'email_open',
      at: '2026-08-05T12:00:00.000Z',
      createTask: false,
      provider: 'ghl',
    });
    assert.equal(result.applied, true);
    assert.ok(Array.isArray(saved[0].patch.updates));
    assert.equal(saved[0].patch.updates[0].type, 'engagement_signal');
    assert.equal(saved[0].patch.updates[0].signalType, 'email_open');
  } finally {
    dbService.getLead = origGet;
    dbService.updateLead = origUpdate;
    require('../services/userTasks').upsertOpenTaskForLead = origWs;
  }
});
