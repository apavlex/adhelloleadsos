const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'inbound-push-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const webpush = require('web-push');
const dbService = require('../services/database');
const push = require('../services/pushNotifications');
const { inboundPushPayload, notifyInboundEvent } = require('../services/inboundPush');
const ghlSync = require('../services/ghlSync');

const WID = 'ws_push_inbound';
const sub = (n) => ({ endpoint: `https://push.example.com/inbound/${n}`, keys: { p256dh: 'p', auth: 'a' } });

test.before(async () => {
  await dbService.saveWorkspace(WID, {
    id: WID,
    name: 'Push Inbound',
    ownerUserId: 'owner@example.com',
    members: { 'owner@example.com': { role: 'owner' }, 'rep@example.com': { role: 'sdr' } },
  });
  push.saveSubscription({ subscription: sub(1), userEmail: 'owner@example.com', workspaceId: WID });
  push.saveSubscription({ subscription: sub(2), userEmail: 'rep@example.com', workspaceId: WID });
  push.saveSubscription({ subscription: sub(3), userEmail: 'removed@example.com', workspaceId: WID });
  push.saveSubscription({ subscription: sub(4), userEmail: 'other@example.com', workspaceId: 'ws_other' });
});

test('payload wording and deep link per event type', () => {
  const lead = { key: 'lead:abc', title: 'Dana Roofer', phone: '+15550001111' };
  const form = inboundPushPayload(lead, { type: 'form', label: 'Free Roof Quote · Facebook Ads' }, WID);
  assert.equal(form.title, 'New lead: Dana Roofer');
  assert.equal(form.body, 'Free Roof Quote · Facebook Ads');
  assert.equal(form.url, `/workspaces/open?workspaceId=${WID}&next=${encodeURIComponent('/focus?lead=abc&channel=call')}`);

  const missed = inboundPushPayload({ key: 'lead:x', title: '', phone: '+15559998888' }, { type: 'missed_call', label: 'New caller' }, WID);
  assert.equal(missed.title, 'Missed call: +15559998888');
  assert.equal(missed.body, 'New caller · Tap to call back.');

  const sms = inboundPushPayload(lead, { type: 'sms', preview: 'Do you do gutters?' }, WID);
  assert.equal(sms.title, 'New text: Dana Roofer');
  assert.equal(sms.body, 'Do you do gutters?');
  assert.match(decodeURIComponent(sms.url), /next=\/focus\?lead=abc$/);

  assert.equal(inboundPushPayload(lead, { type: 'call' }, WID), null);
});

test('notifies every current workspace member with alerts on, nobody else', async (t) => {
  const sent = [];
  t.mock.method(webpush, 'sendNotification', async (s, body) => sent.push({ endpoint: s.endpoint, body: JSON.parse(body) }));
  const r = await notifyInboundEvent({
    workspaceId: WID,
    lead: { key: 'lead:abc', title: 'Dana Roofer' },
    event: { type: 'voicemail' },
  });
  assert.equal(r.sent, 2);
  assert.deepEqual(sent.map((s) => s.endpoint.split('/').pop()).sort(), ['1', '2']);
  assert.equal(sent[0].body.title, 'New voicemail: Dana Roofer');
});

test('a GHL missed call webhook sends the push', async (t) => {
  const sent = [];
  t.mock.method(webpush, 'sendNotification', async (s, body) => sent.push(JSON.parse(body)));
  await ghlSync.processMessageWebhook(
    {
      type: 'InboundMessage',
      messageType: 'CALL',
      contactId: 'push_caller',
      from: '+15551112222',
      direction: 'inbound',
      callStatus: 'no-answer',
      messageId: 'push_call_1',
    },
    { workspaceId: WID },
  );
  for (let i = 0; i < 20 && sent.length < 2; i += 1) await new Promise((r) => setTimeout(r, 25));
  assert.equal(sent.length, 2);
  assert.equal(sent[0].title, 'Missed call: +15551112222');
});
