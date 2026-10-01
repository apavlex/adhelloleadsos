const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'message-log-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');
const messageLog = require('../services/messageLog');

function fakeReq(email, workspaceId = 'ws_msg') {
  return { workspaceId, user: { emails: [{ value: email }], email, displayName: 'Anna' }, headers: {} };
}

const lead = { key: 'lead:abc', title: 'Acme Roofing', phone: '+15551230000', email: 'hi@acme.test' };

test('record stores the send with actor, recipient and source; provider ids dedupe', () => {
  const req = fakeReq('anna@example.com');
  const id = messageLog.record(req, { channel: 'sms', lead, body: 'Hi there', provider: 'ghl', providerMessageId: 'm1' });
  assert.ok(id);
  const again = messageLog.record(req, { channel: 'sms', lead, body: 'Hi there', provider: 'ghl', providerMessageId: 'm1' });
  assert.equal(again, null);

  const { rows, total } = dbService.listOutboundMessages({ workspaceId: 'ws_msg' });
  assert.equal(total, 1);
  assert.equal(rows[0].recipient, '+15551230000');
  assert.equal(rows[0].source, 'manual');
  assert.equal(rows[0].status, 'sent');
  assert.equal(rows[0].actor_email, 'anna@example.com');
  assert.equal(rows[0].lead_key, 'lead:abc');
});

test('failed sends are logged with the error', () => {
  messageLog.record(fakeReq('anna@example.com'), {
    channel: 'email',
    lead,
    subject: 'Quick idea',
    body: 'Hello',
    error: 'GHL rejected the contact',
  });
  const { rows } = dbService.listOutboundMessages({ workspaceId: 'ws_msg', status: 'failed' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].recipient, 'hi@acme.test');
  assert.equal(rows[0].error, 'GHL rejected the contact');
});

test('campaign groups bulk sends and reports counts; foreign workspaces cannot join it', () => {
  const req = fakeReq('anna@example.com', 'ws_camp');
  messageLog.startCampaign(req, { id: 'camp-0001', channel: 'sms', template: 'Hi {first}', planned: 3 });
  messageLog.record(req, { channel: 'sms', campaignId: 'camp-0001', lead, body: 'Hi Al', providerMessageId: 'c1' });
  messageLog.record(req, { channel: 'sms', campaignId: 'camp-0001', lead: { ...lead, key: 'lead:x' }, body: 'Hi Bo', error: 'No phone' });
  messageLog.updateStatus({ workspaceId: 'ws_camp', providerMessageId: 'c1', status: 'delivered' });
  messageLog.finishCampaign(req, 'camp-0001', { skipped: 1 });

  const other = fakeReq('eve@example.com', 'ws_other');
  messageLog.record(other, { channel: 'sms', campaignId: 'camp-0001', lead, body: 'sneaky' });

  const c = dbService.getOutboundCampaign('ws_camp', 'camp-0001');
  assert.equal(c.total, 2);
  assert.equal(c.failed, 1);
  assert.equal(c.delivered, 1);
  assert.equal(c.skipped, 1);
  assert.equal(c.template, 'Hi {first}');
  assert.equal(dbService.getOutboundCampaign('ws_other', 'camp-0001'), null);
  const otherRows = dbService.listOutboundMessages({ workspaceId: 'ws_other' }).rows;
  assert.equal(otherRows[0].campaign_id, null);
  assert.equal(otherRows[0].source, 'manual');

  const sent = dbService.listOutboundMessages({ workspaceId: 'ws_camp', campaignId: 'camp-0001' }).rows;
  assert.ok(sent.every((m) => m.source === 'bulk'));
});

test('status only moves forward', () => {
  const req = fakeReq('anna@example.com', 'ws_status');
  messageLog.record(req, { channel: 'email', lead, subject: 'S', providerMessageId: 'e1' });
  messageLog.updateStatus({ workspaceId: 'ws_status', providerMessageId: 'e1', status: 'opened' });
  messageLog.updateStatus({ workspaceId: 'ws_status', providerMessageId: 'e1', status: 'delivered' });
  messageLog.updateStatus({ workspaceId: 'ws_status', providerMessageId: 'e1', status: 'undelivered' });
  assert.equal(dbService.listOutboundMessages({ workspaceId: 'ws_status' }).rows[0].status, 'opened');
  messageLog.updateStatus({ workspaceId: 'ws_status', providerMessageId: 'e1', status: 'clicked' });
  assert.equal(dbService.listOutboundMessages({ workspaceId: 'ws_status' }).rows[0].status, 'clicked');
});

test('GHL outbound messages are logged once and matched to app sends', () => {
  const req = fakeReq('anna@example.com', 'ws_ghl');
  messageLog.record(req, { channel: 'sms', lead, body: 'From app', providerMessageId: 'g1' });
  messageLog.syncProviderMessage({ workspaceId: 'ws_ghl', channel: 'sms', providerMessageId: 'g1', status: 'delivered', lead, body: 'From app' });
  messageLog.syncProviderMessage({ workspaceId: 'ws_ghl', channel: 'sms', providerMessageId: 'g2', lead, body: 'From a GHL workflow' });
  const { rows } = dbService.listOutboundMessages({ workspaceId: 'ws_ghl' });
  assert.equal(rows.length, 2);
  const byId = Object.fromEntries(rows.map((r) => [r.provider_message_id, r]));
  assert.equal(byId.g1.source, 'manual');
  assert.equal(byId.g1.status, 'delivered');
  assert.equal(byId.g2.source, 'ghl');
});

test('backfill imports earlier lead sends once, skipping anything the live log already has', async () => {
  const wid = 'ws_backfill';
  const live = Date.parse('2026-09-15T12:00:00Z');
  messageLog.record({ workspaceId: wid, actor: null }, { channel: 'sms', lead, body: 'live', createdAt: live });
  const original = dbService.getAllLeads;
  dbService.getAllLeads = async () => [
    {
      ...lead,
      updates: [
        { type: 'sms_outbound', value: 'old text', timestamp: '2026-09-01T10:00:00Z', provider: 'ghl', messageSid: 'old1' },
        { type: 'email_outbound', value: 'Old subject', timestamp: '2026-09-02T10:00:00Z', cadenceStep: 2 },
        { type: 'sms_outbound', value: 'after live', timestamp: '2026-09-20T10:00:00Z' },
        { type: 'note', value: 'not a send', timestamp: '2026-09-01T10:00:00Z' },
      ],
    },
  ];
  try {
    assert.equal(await messageLog.ensureBackfill(wid), 2);
    assert.equal(await messageLog.ensureBackfill(wid), 0);
  } finally {
    dbService.getAllLeads = original;
  }
  const { rows } = dbService.listOutboundMessages({ workspaceId: wid });
  assert.equal(rows.length, 3);
  const email = rows.find((r) => r.channel === 'email');
  assert.equal(email.subject, 'Old subject');
  assert.equal(email.source, 'cadence');
  const oldSms = rows.find((r) => r.body === 'old text');
  assert.equal(oldSms.source, 'history');
});

test('SDR visibility limits rows to their own sends and assigned leads', () => {
  const wid = 'ws_sdr';
  messageLog.record(fakeReq('sam@example.com', wid), { channel: 'sms', lead: { ...lead, key: 'lead:1' }, body: 'mine' });
  messageLog.record(fakeReq('ann@example.com', wid), { channel: 'sms', lead: { ...lead, key: 'lead:2' }, body: 'assigned to sam' });
  messageLog.record(fakeReq('ann@example.com', wid), { channel: 'sms', lead: { ...lead, key: 'lead:3' }, body: 'not visible' });
  const { rows } = dbService.listOutboundMessages({
    workspaceId: wid,
    visibleTo: { actorEmail: 'sam@example.com', leadKeys: ['lead:2'] },
  });
  assert.deepEqual(rows.map((r) => r.body).sort(), ['assigned to sam', 'mine']);
});
