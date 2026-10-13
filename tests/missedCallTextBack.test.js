const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'missed-call-tb-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');
const missedCallTextBack = require('../services/missedCallTextBack');
const smsOutbound = require('../services/smsOutbound');
const { inboundPushPayload } = require('../services/inboundPush');

const WID = 'ws_missed_tb';

test.before(async () => {
  await dbService.saveWorkspace(WID, {
    id: WID,
    name: 'Missed TB Co',
    ownerUserId: 'owner@example.com',
    members: { 'owner@example.com': { role: 'owner' } },
    missedCallTextBack: {
      enabled: true,
      message: 'Hey{{name_part}} — {{business}} missed your call. Reply here.',
    },
  });
});

test('renderMessage fills name_part and business', () => {
  const msg = missedCallTextBack.renderMessage('Hey{{name_part}} — {{business}} here', {
    lead: { title: 'Isabelle SDR' },
    workspace: { id: WID, name: 'Missed TB Co' },
  });
  assert.match(msg, /^Hey Isabelle —/);
  assert.match(msg, /Missed TB Co/);
});

test('settingsFromWorkspace / normalizeSettings', () => {
  assert.equal(missedCallTextBack.settingsFromWorkspace({}).enabled, false);
  assert.equal(
    missedCallTextBack.settingsFromWorkspace({ missedCallTextBack: { enabled: true } }).enabled,
    true,
  );
  const n = missedCallTextBack.normalizeSettings({
    missedCallTextBackEnabled: '1',
    missedCallTextBackMessage: 'Hi {{name}}',
  });
  assert.equal(n.enabled, true);
  assert.equal(n.message, 'Hi {{name}}');
  assert.equal(missedCallTextBack.normalizeSettings({}).enabled, false);
});

test('recentTextBack and isReplyToMissedCallTextBack ignore device SMS', () => {
  const lead = {
    updates: [
      {
        type: 'sms_outbound',
        provider: 'device',
        reason: 'device_sms',
        deviceSms: true,
        timestamp: new Date().toISOString(),
      },
      {
        type: 'call_inbound',
        outcome: 'missed_call',
        timestamp: new Date().toISOString(),
      },
    ],
  };
  assert.equal(missedCallTextBack.recentTextBack(lead, { callEventId: 'x' }), false);
  assert.equal(missedCallTextBack.isReplyToMissedCallTextBack(lead), false);

  lead.updates.push({
    type: 'sms_outbound',
    provider: 'ghl',
    reason: 'missed_call_textback',
    missedCallTextBack: true,
    callEventId: 'call_1',
    timestamp: new Date().toISOString(),
  });
  assert.equal(missedCallTextBack.recentTextBack(lead, { callEventId: 'call_1' }), true);
  assert.equal(missedCallTextBack.isReplyToMissedCallTextBack(lead), true);
});

test('maybeSendMissedCallTextBack sends via GHL requireProvider and logs', async (t) => {
  const saved = await dbService.saveLeadWithMeta({
    workspaceId: WID,
    title: 'Alex Caller',
    phone: '+15553334444',
    updates: [],
  });
  const lead = saved.lead || (await dbService.getLead(saved.key));
  t.mock.method(smsOutbound, 'ghlGroupSmsReadiness', () => ({ ready: true, message: '' }));
  t.mock.method(smsOutbound, 'sendSmsToLead', async (opts) => {
    assert.equal(opts.requireProvider, 'ghl');
    assert.match(opts.message, /Alex/);
    assert.match(opts.message, /Missed TB Co/);
    return { messageId: 'ghl_msg_1', contactId: 'ghl_c1', provider: 'ghl' };
  });

  const r = await missedCallTextBack.maybeSendMissedCallTextBack({
    lead,
    workspaceId: WID,
    outcome: 'missed_call',
    callEventId: 'evt_miss_1',
  });
  assert.equal(r.sent, true);
  assert.equal(r.messageId, 'ghl_msg_1');
  const updated = await dbService.getLead(lead.key);
  const tb = (updated.updates || []).find((u) => u.reason === 'missed_call_textback');
  assert.ok(tb);
  assert.equal(tb.provider, 'ghl');

  const again = await missedCallTextBack.maybeSendMissedCallTextBack({
    lead: updated,
    workspaceId: WID,
    outcome: 'missed_call',
    callEventId: 'evt_miss_1',
  });
  assert.equal(again.sent, false);
  assert.equal(again.skipped, 'already_sent');
});

test('maybeSendMissedCallTextBack skips when disabled', async () => {
  await dbService.saveWorkspace(WID, {
    ...(await dbService.getWorkspace(WID)),
    missedCallTextBack: { enabled: false, message: 'x' },
  });
  const lead = { key: 'lead:skip', phone: '+15550001111', updates: [] };
  const r = await missedCallTextBack.maybeSendMissedCallTextBack({
    lead,
    workspaceId: WID,
    outcome: 'missed_call',
    callEventId: 'e2',
  });
  assert.equal(r.sent, false);
  assert.equal(r.skipped, 'disabled');
  await dbService.saveWorkspace(WID, {
    ...(await dbService.getWorkspace(WID)),
    missedCallTextBack: { enabled: true, message: 'Hey{{name_part}} — {{business}} missed your call. Reply here.' },
  });
});

test('inbound push payload for missed-call text sent opens Focus SMS channel', () => {
  const p = inboundPushPayload(
    { key: 'lead:abc', title: 'Dana' },
    { type: 'missed_call_text_sent', label: 'After missed call', preview: 'Sorry we missed you' },
    WID,
  );
  assert.equal(p.title, 'Missed-call text sent: Dana');
  assert.match(p.body, /Sorry we missed you/);
  assert.match(decodeURIComponent(p.url), /next=\/focus\?lead=abc$/);
});
