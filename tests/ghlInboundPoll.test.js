const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ghl-inbound-poll-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');
const ghlSync = require('../services/ghlSync');
const { messageToWebhookPayload, pollLocation, FIRST_RUN_LOOKBACK_MS } = require('../services/ghlInboundPoll');
const { pendingInboundItems } = require('../services/inboundEvents');

const WID = 'ws_inbound_poll';
const NOW = Date.parse('2026-10-05T23:00:00Z');
const iso = (minsAgo) => new Date(NOW - minsAgo * 60000).toISOString();

test.before(async () => {
  await dbService.saveWorkspace(WID, {
    id: WID,
    name: 'Poll Test',
    ownerUserId: 'owner@example.com',
    members: [{ email: 'owner@example.com', role: 'admin' }],
  });
});

const conversations = [
  { id: 'conv_text', contactId: 'ghl_c_text', fullName: 'Pat Painter', phone: '+15550102020', lastMessageDate: NOW - 5 * 60000 },
  { id: 'conv_call', contactId: 'ghl_c_call', fullName: 'Casey Caller', phone: '+15550103030', lastMessageDate: NOW - 20 * 60000 },
  { id: 'conv_old', contactId: 'ghl_c_old', fullName: 'Old Thread', phone: '+15550104040', lastMessageDate: NOW - FIRST_RUN_LOOKBACK_MS - 60000 },
];

const messagesByConv = {
  conv_text: [
    { id: 'm_text_1', direction: 'inbound', messageType: 'TYPE_SMS', body: 'Can you quote my kitchen?', contactId: 'ghl_c_text', conversationId: 'conv_text', dateAdded: iso(5) },
  ],
  conv_call: [
    { id: 'm_call_1', direction: 'inbound', messageType: 'TYPE_CALL', body: '', contactId: 'ghl_c_call', conversationId: 'conv_call', dateAdded: iso(20), meta: { call: { status: 'no-answer', duration: 0 } } },
  ],
  conv_old: [],
};

function stubClient(calls) {
  return {
    listRecentConversations: async () => ({ conversations }),
    getConversationMessages: async (cid) => {
      calls.push(cid);
      return { messages: { messages: messagesByConv[cid] || [], nextPage: false } };
    },
  };
}

function memoryCursor() {
  const store = {};
  return { getCursor: (loc) => store[loc] || 0, setCursor: (loc, ms) => { store[loc] = ms; }, store };
}

const processMessage = (payload) => ghlSync.processMessageWebhook(payload, { workspaceId: WID, lockWorkspace: true });

test('messageToWebhookPayload maps a GHL call message to a webhook body', () => {
  const p = messageToWebhookPayload(messagesByConv.conv_call[0], conversations[1], 'loc_1');
  assert.equal(p.type, 'InboundMessage');
  assert.equal(p.messageType, 'TYPE_CALL');
  assert.equal(p.messageId, 'm_call_1');
  assert.equal(p.callStatus, 'no-answer');
  assert.equal(p.phone, '+15550103030');
  assert.deepEqual(p.contact, { id: 'ghl_c_call', phone: '+15550103030', email: '', name: 'Casey Caller' });
  const parsed = ghlSync.parseGhlMessageWebhook(p);
  assert.equal(parsed.channel, 'call');
  assert.equal(parsed.direction, 'inbound');
});

test('pollLocation turns new GHL texts and missed calls into inbound items, once', async () => {
  const calls = [];
  const cur = memoryCursor();
  const stats = await pollLocation({ env: {}, locationId: 'loc_1', now: NOW, client: stubClient(calls), processMessage, ...cur });
  assert.deepEqual(calls, ['conv_call', 'conv_text']);
  assert.equal(stats.messages, 2);
  assert.equal(stats.applied, 2);
  assert.equal(cur.store.loc_1, conversations[0].lastMessageDate);

  const feed = pendingInboundItems(await dbService.getAllLeads(WID), { now: NOW });
  const text = feed.find((r) => r.title === 'Pat Painter');
  const call = feed.find((r) => r.title === 'Casey Caller');
  assert.ok(text && call, 'both contacts show up as inbound');
  assert.equal(text.type, 'sms');
  assert.equal(text.preview, 'Can you quote my kitchen?');
  assert.equal(call.type, 'missed_call');

  const again = await pollLocation({ env: {}, locationId: 'loc_1', now: NOW, client: stubClient([]), processMessage, ...cur });
  assert.equal(again.conversations, 0);

  const replay = await pollLocation({ env: {}, locationId: 'loc_1', now: NOW, client: stubClient([]), processMessage, getCursor: () => 0, setCursor: () => {} });
  assert.equal(replay.applied, 0, 'already-seen messages are skipped');
  const lead = (await dbService.getAllLeads(WID)).find((l) => l.title === 'Pat Painter');
  assert.equal(lead.inboundEvents.length, 1);
});
