const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ghl-inbound-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');
const ghlInbound = require('../services/ghlInbound');
const ghlSync = require('../services/ghlSync');
const { pendingInboundItems, appendInboundEvent } = require('../services/inboundEvents');

const WID = 'ws_inbound_test';

test.before(async () => {
  await dbService.saveWorkspace(WID, {
    id: WID,
    name: 'Inbound Test',
    ownerUserId: 'owner@example.com',
    members: [{ email: 'owner@example.com', role: 'admin' }],
  });
});

const formPayload = (over = {}) => ({
  contact_id: 'ghl_form_1',
  first_name: 'Dana',
  last_name: 'Roofer',
  full_name: 'Dana Roofer',
  email: 'dana@roofs.test',
  phone: '+15550001111',
  tags: 'facebook lead, roof',
  location: { id: 'loc_x', name: 'Agency' },
  workflow: { id: 'wf1', name: 'FB Lead → Agency OS' },
  contact: { attributionSource: { sessionSource: 'Paid Social', utmSource: 'facebook', utmCampaign: 'Roof Q4', fbclid: 'abc' } },
  'What service do you need?': 'Roof replacement',
  customData: { event: 'form', form_name: 'Free Roof Quote' },
  ...over,
});

test('parseGhlWorkflowPayload reads form leads with Facebook attribution and answers', () => {
  const p = ghlInbound.parseGhlWorkflowPayload(formPayload());
  assert.equal(p.kind, 'form');
  assert.equal(p.contactId, 'ghl_form_1');
  assert.equal(p.locationId, 'loc_x');
  assert.equal(p.label, 'Free Roof Quote');
  assert.equal(p.attribution.adSource, 'Facebook Ads');
  assert.equal(p.attribution.utmCampaign, 'Roof Q4');
  assert.deepEqual(p.answers, [{ q: 'What service do you need?', a: 'Roof replacement' }]);
  assert.deepEqual(p.contact.tags, ['facebook lead', 'roof']);
});

test('native GHL contact / message webhooks are not treated as workflow payloads', () => {
  assert.equal(ghlInbound.isWorkflowPayload({ type: 'ContactCreate', id: 'c1', email: 'a@b.c' }), false);
  assert.equal(ghlInbound.isWorkflowPayload({ type: 'InboundMessage', contactId: 'c1' }), false);
  assert.equal(ghlInbound.isWorkflowPayload({ contact_id: 'c1', phone: '+1555' }), true);
});

test('detectWorkflowEvent: customData.event wins, workflow name is the fallback', () => {
  const base = { contact_id: 'c1', phone: '+1555' };
  assert.equal(ghlInbound.detectWorkflowEvent({ ...base, customData: { event: 'missed call' } }), 'missed_call');
  assert.equal(ghlInbound.detectWorkflowEvent({ ...base, customData: { event: 'voicemail' } }), 'voicemail');
  assert.equal(ghlInbound.detectWorkflowEvent({ ...base, customData: { event: 'sms' }, message: { body: 'hi' } }), 'sms');
  assert.equal(ghlInbound.detectWorkflowEvent({ ...base, workflow: { name: 'Missed call text back' } }), 'missed_call');
  assert.equal(ghlInbound.detectWorkflowEvent({ ...base, workflow: { name: 'Customer replied' }, message: { body: 'yes' } }), 'sms');
  assert.equal(ghlInbound.detectWorkflowEvent({ ...base, workflow: { name: 'Website form' } }), 'form');
  assert.equal(
    ghlInbound.detectWorkflowEvent({ ...base, workflow: { name: 'Call status' }, customData: { call_status: 'no-answer' } }),
    'missed_call',
  );
});

test('classifyCallOutcome', () => {
  assert.equal(ghlInbound.classifyCallOutcome({ status: 'no-answer' }), 'missed_call');
  assert.equal(ghlInbound.classifyCallOutcome({ status: 'busy', hasRecording: true }), 'voicemail');
  assert.equal(ghlInbound.classifyCallOutcome({ status: 'voicemail' }), 'voicemail');
  assert.equal(ghlInbound.classifyCallOutcome({ status: 'completed', durationSec: 95 }), 'call');
  assert.equal(ghlInbound.classifyCallOutcome({ status: 'completed', durationSec: 0 }), 'missed_call');
});

test('adAttribution labels Google click ids and plain utm sources', () => {
  assert.equal(ghlInbound.adAttribution({ attributionSource: { gclid: 'g1' } }).adSource, 'Google Ads');
  assert.equal(ghlInbound.adAttribution({ attributionSource: { utmSource: 'newsletter' } }).adSource, 'newsletter');
  assert.equal(ghlInbound.adAttribution({}).adSource, '');
});

test('workflow form webhook creates a warm inbound lead with a Today feed row', async () => {
  const r = await ghlInbound.processWorkflowWebhook(formPayload(), { workspaceId: WID });
  assert.equal(r.action, 'form_lead');
  assert.equal(r.created, true);
  assert.equal(r.adSource, 'Facebook Ads');
  const lead = await dbService.getLead(r.key);
  assert.equal(lead.source, 'inbound_ghl_form');
  assert.equal(lead.adSource, 'Facebook Ads');
  assert.equal(lead.inboundFormName, 'Free Roof Quote');
  assert.equal(lead.status, 'Connected - Follow Up');
  assert.equal(lead.inboundEvents.length, 1);
  assert.equal(lead.inboundEvents[0].type, 'form');
  assert.match(lead.inboundEvents[0].label, /Free Roof Quote · Facebook Ads/);
  assert.ok(lead.logs.some((l) => /What service do you need\?: Roof replacement/.test(l.message)));

  const feed = pendingInboundItems(await dbService.getAllLeads(WID));
  const row = feed.find((x) => x.leadKey === r.key);
  assert.ok(row);
  assert.equal(row.typeLabel, 'New form lead');
  assert.equal(row.phone, '+15550001111');
});

test('a second submission from the same contact reuses the lead', async () => {
  const r = await ghlInbound.processWorkflowWebhook(
    formPayload({ customData: { event: 'form', form_name: 'Spring Promo', event_id: 'sub2' } }),
    { workspaceId: WID },
  );
  assert.equal(r.created, false);
  const leads = (await dbService.getAllLeads(WID)).filter((l) => l.ghlContactId === 'ghl_form_1');
  assert.equal(leads.length, 1);
  assert.equal(leads[0].inboundEvents.length, 2);
});

test('native GHL missed call from an unknown number creates a lead and a call-back event', async () => {
  const r = await ghlSync.processMessageWebhook(
    {
      type: 'InboundMessage',
      messageType: 'CALL',
      contactId: 'ghl_caller_9',
      from: '+15559998888',
      direction: 'inbound',
      callStatus: 'no-answer',
      callDuration: 0,
      messageId: 'call_msg_1',
      dateAdded: new Date().toISOString(),
    },
    { workspaceId: WID },
  );
  assert.equal(r.action, 'missed_call');
  assert.equal(r.created, true);
  const lead = await dbService.getLead(r.key);
  assert.equal(lead.source, 'inbound_ghl_call');
  assert.ok(lead.updates.some((u) => u.type === 'call_inbound' && u.outcome === 'missed_call'));
  assert.ok(lead.nextActionAt);

  const dup = await ghlSync.processMessageWebhook(
    { type: 'InboundMessage', messageType: 'CALL', contactId: 'ghl_caller_9', direction: 'inbound', callStatus: 'no-answer', messageId: 'call_msg_1' },
    { workspaceId: WID },
  );
  assert.equal(dup.reason, 'duplicate');

  const tasks = await dbService.listUserTasks(WID, 'owner@example.com');
  assert.ok(tasks.some((t) => t.leadKey === r.key && /Call back/.test(t.title)));
});

test('inbound SMS from an unknown number creates a lead instead of being dropped', async () => {
  const r = await ghlSync.processMessageWebhook(
    {
      type: 'InboundMessage',
      messageType: 'SMS',
      contactId: 'ghl_texter_3',
      from: '+15557776666',
      direction: 'inbound',
      body: 'Do you do gutters?',
      messageId: 'sms_new_1',
    },
    { workspaceId: WID },
  );
  assert.equal(r.action, 'sms_inbound');
  const lead = await dbService.getLead(r.key);
  assert.equal(lead.source, 'inbound_ghl_sms');
  const ev = lead.inboundEvents.find((e) => e.type === 'sms');
  assert.equal(ev.preview, 'Do you do gutters?');
  assert.match(ev.label, /New contact/);
});

test('STOP from an unknown number does not create a lead', async () => {
  const r = await ghlSync.processMessageWebhook(
    { type: 'InboundMessage', messageType: 'SMS', contactId: 'ghl_stop', from: '+15550000000', direction: 'inbound', body: 'STOP', messageId: 'stop1' },
    { workspaceId: WID },
  );
  assert.equal(r.reason, 'lead_not_found');
});

test('outbound GHL call clears the lead from the Inbound feed', async () => {
  const before = pendingInboundItems(await dbService.getAllLeads(WID));
  const caller = before.find((x) => x.title.includes('5559998888') || x.phone.includes('5559998888'));
  assert.ok(caller, 'missed caller is in the feed');
  const r = await ghlSync.processMessageWebhook(
    {
      type: 'OutboundMessage',
      messageType: 'CALL',
      contactId: 'ghl_caller_9',
      direction: 'outbound',
      callStatus: 'completed',
      callDuration: 120,
      messageId: 'call_out_1',
      dateAdded: new Date(Date.now() + 1000).toISOString(),
    },
    { workspaceId: WID },
  );
  assert.equal(r.action, 'call_outbound');
  const after = pendingInboundItems(await dbService.getAllLeads(WID));
  assert.ok(!after.some((x) => x.leadKey === caller.leadKey));
});

test('pendingInboundItems: handled, old, and answered-call events are excluded', () => {
  const now = Date.parse('2026-10-01T12:00:00.000Z');
  const leads = [
    { key: 'lead:a', title: 'A', inboundEvents: [{ id: '1', type: 'form', at: '2026-10-01T11:00:00.000Z' }] },
    { key: 'lead:b', title: 'B', inboundHandledAt: '2026-10-01T11:30:00.000Z', inboundEvents: [{ id: '2', type: 'sms', at: '2026-10-01T11:00:00.000Z' }] },
    { key: 'lead:c', title: 'C', inboundEvents: [{ id: '3', type: 'missed_call', at: '2026-09-20T11:00:00.000Z' }] },
    { key: 'lead:d', title: 'D', inboundEvents: [{ id: '4', type: 'call', at: '2026-10-01T11:00:00.000Z' }] },
    {
      key: 'lead:e',
      title: 'E',
      updates: [{ type: 'sms_outbound', timestamp: '2026-10-01T11:10:00.000Z' }],
      inboundEvents: [{ id: '5', type: 'voicemail', at: '2026-10-01T11:00:00.000Z' }],
    },
  ];
  const rows = pendingInboundItems(leads, { now });
  assert.deepEqual(rows.map((r) => r.leadKey), ['lead:a']);
  assert.equal(rows[0].focusHref, '/focus?lead=a');
});

test('appendInboundEvent dedupes by id and caps the list', () => {
  let list = [];
  for (let i = 0; i < 30; i += 1) {
    list = appendInboundEvent(list, { id: `e${i}`, type: 'sms', at: new Date(1e12 + i * 1000).toISOString() });
  }
  list = appendInboundEvent(list, { id: 'e29', type: 'sms', at: new Date().toISOString() });
  assert.equal(list.length, 20);
  assert.equal(list[list.length - 1].id, 'e29');
});
