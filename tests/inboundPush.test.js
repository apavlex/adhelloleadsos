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
const ghlNotificationPrefs = require('../services/ghlNotificationPrefs');
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

test.afterEach(() => {
  for (const email of ['owner@example.com', 'rep@example.com']) {
    const key = ghlNotificationPrefs.PREFIX + dbService._emailKeyFragment(email);
    if (key) dbService.deleteKvSync(key);
  }
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

test('website form leads skip Agency OS workspace push (Reviews-only)', async (t) => {
  const sent = [];
  t.mock.method(webpush, 'sendNotification', async (s, body) => sent.push({ endpoint: s.endpoint, body: JSON.parse(body) }));
  const memberGhlAlerts = require('../services/memberGhlAlerts');
  let memberCalls = 0;
  t.mock.method(memberGhlAlerts, 'notifyEnabledMembers', async () => {
    memberCalls += 1;
    return { sent: 1, members: 1 };
  });
  const lead = { key: 'lead:form1', title: 'Alex Form', ghlContactId: 'ghl_form_dedupe_1' };
  const r = await notifyInboundEvent({
    workspaceId: WID,
    lead,
    event: { type: 'form', label: 'ai_studio' },
  });
  assert.equal(memberCalls, 1);
  assert.equal(sent.length, 0, 'must not ring Agency OS workspace subscriptions');
  assert.equal(r.sent, 1);

  // ContactCreate + Form sync both fire — only the first phone-notifies.
  const again = await notifyInboundEvent({
    workspaceId: WID,
    lead,
    event: { type: 'form', label: 'direct' },
  });
  assert.equal(memberCalls, 1, 'second form notify for same contact is deduped');
  assert.equal(again.deduped, true);
  assert.equal(again.sent, 0);
});

test('form:ghl-touch after first stamp does not double-notify (Alex enrichment)', async (t) => {
  const memberGhlAlerts = require('../services/memberGhlAlerts');
  let memberCalls = 0;
  t.mock.method(memberGhlAlerts, 'notifyEnabledMembers', async () => {
    memberCalls += 1;
    return { sent: 1, members: 1 };
  });
  const stampedAt = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const lead = {
    key: 'lead:alex_touch',
    title: 'Alex',
    phone: '+13602611532',
    ghlContactId: 'ghl_alex_touch',
    inboundEvents: [
      { id: 'form:ghl-contact:ghl_alex_touch', type: 'form', at: stampedAt },
    ],
  };
  const first = await notifyInboundEvent({
    workspaceId: WID,
    lead,
    event: {
      id: 'form:ghl-contact:ghl_alex_touch',
      type: 'form',
      label: 'Website form',
      preview: 'Source: Website · Address: 98682',
    },
  });
  assert.equal(first.sent, 1);
  assert.equal(memberCalls, 1);

  // ~2 minutes later GHL enriches Type/country → form sync retouches.
  const again = await notifyInboundEvent({
    workspaceId: WID,
    lead,
    event: {
      id: `form:ghl-touch:ghl_alex_touch:${Date.now()}`,
      type: 'form',
      label: 'Website form',
      preview: 'Source: Website · Type: lead · Address: 98682, US',
    },
  });
  assert.equal(again.deduped, true);
  assert.equal(memberCalls, 1, 'contact enrichment must not ring twice');
});

test('dedupes when first notify keyed by lead.key and second by ghlContactId', async (t) => {
  const memberGhlAlerts = require('../services/memberGhlAlerts');
  let memberCalls = 0;
  t.mock.method(memberGhlAlerts, 'notifyEnabledMembers', async () => {
    memberCalls += 1;
    return { sent: 1, members: 1 };
  });
  const phone = '+15559876543';
  const first = await notifyInboundEvent({
    workspaceId: WID,
    lead: { key: 'lead:key_only', title: 'Alex', phone },
    event: { id: 'form:contact-create:lead:key_only', type: 'form', label: 'Website' },
  });
  assert.equal(first.sent, 1);

  const again = await notifyInboundEvent({
    workspaceId: WID,
    lead: {
      key: 'lead:key_only',
      title: 'Alex',
      phone,
      ghlContactId: 'ghl_key_bridge',
    },
    event: { id: 'form:ghl-contact:ghl_key_bridge', type: 'form', label: 'Website' },
  });
  assert.equal(again.deduped, true);
  assert.equal(memberCalls, 1, 'phone/lead key must bridge ContactCreate → form sync');
});

test('ContactCreate then form:ghl-sub does not double-notify the same first fill', async (t) => {
  const memberGhlAlerts = require('../services/memberGhlAlerts');
  let memberCalls = 0;
  t.mock.method(memberGhlAlerts, 'notifyEnabledMembers', async () => {
    memberCalls += 1;
    return { sent: 1, members: 1 };
  });
  const lead = {
    key: 'lead:form_race',
    title: 'bob test',
    ghlContactId: 'ghl_bob_race',
    inboundEvents: [
      { id: 'form:contact-create:lead:form_race', type: 'form', at: new Date(Date.now() - 4 * 60 * 1000).toISOString() },
    ],
  };
  const first = await notifyInboundEvent({
    workspaceId: WID,
    lead,
    event: { id: 'form:contact-create:lead:form_race', type: 'form', label: 'Website' },
  });
  assert.equal(first.sent, 1);
  assert.equal(memberCalls, 1);

  // ~4 minutes later the submissions poll finds the same fill.
  const again = await notifyInboundEvent({
    workspaceId: WID,
    lead,
    event: { id: 'form:ghl-sub:sub_bob_1', type: 'form', label: 'Website' },
  });
  assert.equal(again.deduped, true);
  assert.equal(memberCalls, 1, 'same first fill must not ring twice');
});

test('retries form notify when the first attempt sent zero pushes', async (t) => {
  const memberGhlAlerts = require('../services/memberGhlAlerts');
  const { formEventNeedsNotifyRetry } = require('../services/inboundPush');
  let memberCalls = 0;
  t.mock.method(memberGhlAlerts, 'notifyEnabledMembers', async () => {
    memberCalls += 1;
    return { sent: memberCalls === 1 ? 0 : 1, members: 1 };
  });
  const lead = { key: 'lead:form_retry', title: 'Retry Form', ghlContactId: 'ghl_form_retry_1' };
  const first = await notifyInboundEvent({
    workspaceId: WID,
    lead,
    event: { id: 'form:ghl-sub:sub_retry_1', type: 'form', label: 'Website' },
  });
  assert.equal(first.sent, 0);
  assert.equal(formEventNeedsNotifyRetry(WID, 'form:ghl-sub:sub_retry_1'), true);

  const second = await notifyInboundEvent({
    workspaceId: WID,
    lead,
    event: { id: 'form:ghl-sub:sub_retry_1', type: 'form', label: 'Website' },
  });
  assert.equal(memberCalls, 2, 'zero-send must not burn the claim');
  assert.equal(second.sent, 1);
  assert.equal(formEventNeedsNotifyRetry(WID, 'form:ghl-sub:sub_retry_1'), false);
});

test('skips workspace users who paused GHL call/text notifications', async (t) => {
  ghlNotificationPrefs.setPaused('owner@example.com', true);
  const sent = [];
  t.mock.method(webpush, 'sendNotification', async (s, body) => sent.push({ endpoint: s.endpoint, body: JSON.parse(body) }));
  const r = await notifyInboundEvent({
    workspaceId: WID,
    lead: { key: 'lead:abc', title: 'Dana Roofer' },
    event: { type: 'missed_call', label: 'New caller' },
  });
  assert.equal(r.sent, 1);
  assert.deepEqual(sent.map((s) => s.endpoint.split('/').pop()), ['2']);
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
