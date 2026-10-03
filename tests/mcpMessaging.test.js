const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-messaging-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');
const workspaceIntegrations = require('../services/workspaceIntegrations');
const smsOutbound = require('../services/smsOutbound');
const ghlMessaging = require('../services/ghlMessaging');
const messageLog = require('../services/messageLog');
const { smsWindowBlock } = require('../services/leadOutreachSend');
const { executeCrmTool, getOpenAiFunctionTools } = require('../services/mcp/mcpToolExecutor');
const { createCrmMcpServer } = require('../services/mcp/mcpServerFactory');

const OWNER = 'owner@example.com';
const VIEWER = 'viewer@example.com';
const ZONES = ['Pacific/Honolulu', 'America/Los_Angeles', 'America/New_York', 'Europe/London', 'Asia/Dubai', 'Asia/Tokyo', 'Pacific/Auckland'];

function hourIn(tz) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, hour: '2-digit' }).format(new Date())) % 24;
}
const DAY_TZ = ZONES.find((tz) => hourIn(tz) >= 10 && hourIn(tz) <= 18);
const NIGHT_TZ = ZONES.find((tz) => hourIn(tz) >= 23 || hourIn(tz) <= 5);

const sent = { sms: [], email: [], logs: [] };
// Left in place after the tests: the post-send GHL sync runs on setImmediate.
global.fetch = async () => {
  throw new Error('offline in tests');
};
test.before(() => {
  workspaceIntegrations.getResolvedIntegrationEnv = async () => ({ GHL_API_KEY: 'k', GHL_LOCATION_ID: 'loc' });
  ghlMessaging.messagingReady = () => ({ configured: true, smsReady: true, emailReady: true, hasEmailFrom: true, hasSmsFromNumber: true });
  smsOutbound.sendSmsToLead = async (opts) => {
    sent.sms.push(opts);
    return { messageId: `sms_${sent.sms.length}`, contactId: 'ghl_c1', provider: 'ghl' };
  };
  ghlMessaging.sendEmailToLead = async (opts) => {
    sent.email.push(opts);
    return { messageId: `em_${sent.email.length}`, contactId: 'ghl_c1', emailTo: opts.toEmail || 'pat@patrickplumbing.com' };
  };
  messageLog.record = (ctx, entry) => sent.logs.push({ ctx, entry });
});

let n = 0;
async function setup(leadExtra = {}) {
  n += 1;
  const wid = `ws_msg_${n}`;
  await dbService.saveWorkspace(wid, {
    id: wid,
    name: 'Msg WS',
    ownerUserId: OWNER,
    members: { [OWNER]: { role: 'owner', name: 'Alex' }, [VIEWER]: { role: 'viewer' } },
    salesScriptOfferCatalog: [{ key: 'overflow', label: 'Overflow Referral', senderBusinessName: 'AdHello' }],
  });
  const saved = await dbService.saveLeadWithMeta({
    workspaceId: wid,
    title: 'Patrick Plumbing',
    phone: '+15555550100',
    ownerFirstName: 'Pat',
    timezone: DAY_TZ,
    ...leadExtra,
  });
  return { wid, ctx: { workspaceId: wid, userEmail: OWNER, clientName: 'Muse' }, leadKey: saved.key };
}

test('send_sms fills merge tags, texts through GHL, and records it on the lead like a manual send', async () => {
  const { wid, ctx, leadKey } = await setup();
  const before = sent.sms.length;
  const res = await executeCrmTool(ctx, 'send_sms', { lead_id: leadKey, message: 'Hi {{name}}, quick one about {{company}}?' });
  assert.equal(res.success, true, res.error);
  assert.equal(res.status, 'sent');
  assert.equal(res.message, 'Hi Pat, quick one about Patrick Plumbing?');
  assert.equal(sent.sms.length, before + 1);
  assert.equal(sent.sms.at(-1).requireProvider, 'ghl');
  assert.equal(sent.sms.at(-1).message, 'Hi Pat, quick one about Patrick Plumbing?');

  const lead = await dbService.getLead(leadKey, wid);
  assert.equal(lead.status, 'Follow-up');
  assert.equal(lead.lastTouchChannel, 'sms');
  assert.equal(lead.ghlContactId, 'ghl_c1');
  const entry = lead.updates.at(-1);
  assert.equal(entry.type, 'sms_outbound');
  assert.equal(entry.via, 'Muse');
  const log = sent.logs.at(-1);
  assert.equal(log.entry.source, 'ai');
  assert.equal(log.entry.provider, 'ghl');
  assert.equal(log.ctx.actor.email, OWNER);

  const activity = dbService.listTeamActivity({ workspaceId: wid });
  assert.equal(activity.length, 1, 'one row: the send, not a second generic one');
  assert.equal(activity[0].actor_email, 'bot:muse');
  assert.equal(activity[0].summary, 'Sent SMS: Hi Pat, quick one about Patrick Plumbing?');
});

test('send_sms refuses Do Not Contact, opted-out, late-night and unfilled messages without texting', async (t) => {
  const before = sent.sms.length;
  const dnc = await setup({ doNotContact: true });
  const r1 = await executeCrmTool(dnc.ctx, 'send_sms', { lead_id: dnc.leadKey, message: 'Hi' });
  assert.equal(r1.success, false);
  assert.match(r1.error, /Do Not Contact/);

  const opted = await setup({ smsOptOut: true });
  const r2 = await executeCrmTool(opted.ctx, 'send_sms', { lead_id: opted.leadKey, message: 'Hi' });
  assert.match(r2.error, /opted out/);

  const tags = await setup();
  const r3 = await executeCrmTool(tags.ctx, 'send_sms', { lead_id: tags.leadKey, message: 'Hi {{nickname}}, [Your Offer] inside' });
  assert.equal(r3.success, false);
  assert.match(r3.error, /placeholders/);
  const short = await executeCrmTool(tags.ctx, 'send_sms', { lead_id: tags.leadKey, message: 'Hi' });
  assert.match(short.error, /too short/);

  if (NIGHT_TZ) {
    const late = await setup({ timezone: NIGHT_TZ });
    const r4 = await executeCrmTool(late.ctx, 'send_sms', { lead_id: late.leadKey, message: 'Hi there, quick question for you' });
    assert.equal(r4.success, false);
    assert.match(r4.error, /8 AM – 9 PM/);
  } else {
    t.diagnostic('no night-time zone in the list right now; late-night check covered by smsWindowBlock test');
  }
  assert.equal(sent.sms.length, before);
});

test('smsWindowBlock allows 8 AM – 9 PM lead time only', () => {
  const lead = { phone: '+15555550100', timezone: 'America/New_York' };
  assert.equal(smsWindowBlock(lead, {}, new Date('2026-06-10T16:00:00Z')), null);
  assert.match(smsWindowBlock(lead, {}, new Date('2026-06-10T03:30:00Z')), /America\/New_York/);
});

test('bulk send reports per lead, preview sends nothing, viewers are blocked', async () => {
  const a = await setup();
  const b = await dbService.saveLeadWithMeta({ workspaceId: a.wid, title: 'Bob Roofing', phone: '+15555550101', ownerFirstName: 'Bob', timezone: DAY_TZ, doNotCall: true });
  const before = sent.sms.length;

  const message = 'Hey {{name}}, got a minute?';
  const preview = await executeCrmTool(a.ctx, 'send_sms', { lead_ids: [a.leadKey, b.key], message, preview: true });
  assert.equal(preview.success, true, preview.error);
  assert.equal(preview.previewed, 2);
  assert.equal(preview.results[1].message, 'Hey Bob, got a minute?');
  assert.equal(sent.sms.length, before);

  const bulk = await executeCrmTool(a.ctx, 'send_sms', { lead_ids: [a.leadKey, b.key, 'lead:nope'], message });
  assert.equal(bulk.sent, 1);
  assert.equal(bulk.failed, 2);
  assert.equal(bulk.results[1].code, 'lead_dnc');
  assert.equal(sent.sms.length, before + 1);

  const toMany = await executeCrmTool(a.ctx, 'send_sms', { lead_ids: [a.leadKey, b.key], message: 'x', to: '+15555550199' });
  assert.match(toMany.error, /single lead_id/);

  const viewer = await executeCrmTool({ ...a.ctx, userEmail: VIEWER }, 'send_sms', { lead_id: a.leadKey, message: 'Hi' });
  assert.equal(viewer.success, false);
  assert.match(viewer.error, /Viewers/);
});

test('send_email emails through GHL, stores a found address, and marks the lead Email Sent', async () => {
  const { wid, ctx, leadKey } = await setup();
  const res = await executeCrmTool(ctx, 'send_email', {
    lead_id: leadKey,
    subject: 'Referrals for {{company}}',
    body: 'Hi {{name}},\n\nGot overflow work?',
  });
  assert.equal(res.success, true, res.error);
  assert.equal(res.subject, 'Referrals for Patrick Plumbing');
  assert.equal(sent.email.at(-1).subject, 'Referrals for Patrick Plumbing');
  assert.match(sent.email.at(-1).body, /^Hi Pat,/);

  const lead = await dbService.getLead(leadKey, wid);
  assert.equal(lead.status, 'Email Sent');
  assert.equal(lead.lastTouchChannel, 'email');
  assert.equal(lead.email, 'pat@patrickplumbing.com');
  assert.equal(lead.updates.at(-1).type, 'email_outbound');

  const dnc = await setup({ doNotContact: true });
  const blocked = await executeCrmTool(dnc.ctx, 'send_email', { lead_id: dnc.leadKey, subject: 's', body: 'b' });
  assert.match(blocked.error, /Do Not Contact/);
});

test('messaging tools are published to MCP clients with send tools flagged as irreversible', async () => {
  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
  const { wid } = await setup();
  const server = createCrmMcpServer({ workspaceId: wid, userEmail: OWNER });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(clientSide);
  const { tools } = await client.listTools();
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  assert.equal(byName.get_messaging_status.annotations.readOnlyHint, true);
  for (const name of ['send_sms', 'send_email']) {
    assert.equal(byName[name].annotations.destructiveHint, true, name);
    assert.equal(byName[name].annotations.openWorldHint, true, name);
    assert.ok(byName[name].inputSchema.properties.lead_ids, name);
  }
  const status = await client.callTool({ name: 'get_messaging_status', arguments: {} });
  assert.equal(JSON.parse(status.content[0].text).sms_ready, true);
  await client.close();
  assert.ok(getOpenAiFunctionTools().some((t) => t.function.name === 'send_email'));
});
