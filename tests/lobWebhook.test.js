const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  parseLobWebhook,
  findLeadByPostcardId,
  leadHasPostcardId,
  processLobWebhook,
} = require('../services/lobWebhook');

test('parseLobWebhook extracts postcard.viewed events', () => {
  const parsed = parseLobWebhook({
    event_type: 'postcard.viewed',
    body: {
      id: 'psc_abc123',
      date_created: '2026-08-05T14:00:00.000Z',
      qr_code_redirect_url: 'https://leads.adhello.io/audit/x',
    },
  });
  assert.ok(parsed);
  assert.equal(parsed.postcardId, 'psc_abc123');
  assert.equal(parsed.eventType, 'postcard.viewed');
  assert.match(parsed.redirectUrl, /audit/);
});

test('parseLobWebhook ignores non-viewed events', () => {
  assert.equal(parseLobWebhook({ event_type: 'postcard.created', body: { id: 'x' } }), null);
});

test('leadHasPostcardId matches updates and logs', () => {
  const lead = {
    updates: [{ type: 'direct_mail_sent', postcardId: 'psc_1' }],
    logs: [],
  };
  assert.equal(leadHasPostcardId(lead, 'psc_1'), true);
  assert.equal(leadHasPostcardId(lead, 'psc_2'), false);
  assert.equal(findLeadByPostcardId([lead], 'psc_1')?.updates?.[0]?.postcardId, 'psc_1');
});

test('processLobWebhook applies mail_scan engagement', async () => {
  const saved = [];
  const dbService = require('../services/database');
  const ghlProspectSync = require('../services/ghlProspectSync');
  const origAll = dbService.getAllLeads;
  const origUpdate = dbService.updateLead;
  const origWs = require('../services/userTasks').upsertOpenTaskForLead;
  const origTrigger = ghlProspectSync.triggerGhlProspectSync;
  const ghlCalls = [];

  dbService.getAllLeads = async () => [
    {
      key: 'lead:lob-test',
      title: 'Acme HVAC',
      updates: [{ type: 'direct_mail_sent', postcardId: 'psc_xyz' }],
    },
  ];
  dbService.updateLead = async (key, patch) => {
    saved.push({ key, patch });
    return { key, ...patch };
  };
  require('../services/userTasks').upsertOpenTaskForLead = async () => ({ id: 'task-lob' });
  ghlProspectSync.triggerGhlProspectSync = (key, workspaceId, extra) => {
    ghlCalls.push({ key, workspaceId, extra });
  };

  try {
    const result = await processLobWebhook(
      {
        event_type: 'postcard.viewed',
        body: {
          id: 'psc_xyz',
          date_created: '2026-08-05T15:00:00.000Z',
          qr_code_redirect_url: 'https://leads.adhello.io/audit/x',
        },
      },
      { workspaceId: 'default' },
    );
    assert.equal(result.applied, true);
    assert.equal(result.action, 'mail_scan');
    assert.equal(result.key, 'lead:lob-test');
    assert.ok(saved.length >= 1);
    assert.equal(saved[0].patch.engagementSignals.lastSignalType, 'mail_scan');
    assert.equal(ghlCalls.length, 1);
    assert.equal(ghlCalls[0].key, 'lead:lob-test');
    assert.equal(ghlCalls[0].extra.trigger, 'postcard_qr_scan');
    assert.match(ghlCalls[0].extra.note, /Postcard QR scanned/);
    assert.match(ghlCalls[0].extra.note, /psc_xyz/);
  } finally {
    dbService.getAllLeads = origAll;
    dbService.updateLead = origUpdate;
    require('../services/userTasks').upsertOpenTaskForLead = origWs;
    ghlProspectSync.triggerGhlProspectSync = origTrigger;
  }
});
