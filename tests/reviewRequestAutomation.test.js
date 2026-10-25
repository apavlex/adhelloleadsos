const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'review-req-auto-'));

const test = require('node:test');
const assert = require('node:assert/strict');

const calls = { sms: [], email: [], env: null };

const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (request === './workspaceIntegrations' || request.endsWith('/workspaceIntegrations')) {
    return {
      getResolvedIntegrationEnv: async () => calls.env || {
        GHL_API_KEY: 'key',
        GHL_LOCATION_ID: 'loc',
        GHL_SMS_FROM_NUMBER: '+15551234567',
        GHL_EMAIL_FROM: 'from@example.com',
      },
    };
  }
  if (request === './ghlMessaging' || request.endsWith('/ghlMessaging')) {
    const real = originalLoad.call(this, request, parent, isMain);
    return {
      ...real,
      messagingReady: (env) => real.messagingReady(env),
      sendSmsToPerson: async (opts) => {
        calls.sms.push(opts);
        return { provider: 'ghl', messageId: 'sms_1', contactId: 'c1' };
      },
      sendEmailToPerson: async (opts) => {
        calls.email.push(opts);
        return { provider: 'ghl', messageId: 'em_1', contactId: 'c1' };
      },
    };
  }
  if (request === './smsOutbound' || request.endsWith('/smsOutbound')) {
    return {
      sendSmsToLead: async () => ({ provider: 'ghl', messageId: 'lead_sms' }),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const store = require('../services/networkStore');
const work = require('../services/memberWork');
const automation = require('../services/reviewRequestAutomation');
const mcpNetwork = require('../services/mcp/mcpNetwork');

test.after(() => {
  Module._load = originalLoad;
});

async function setup() {
  calls.sms.length = 0;
  calls.email.length = 0;
  calls.env = {
    GHL_API_KEY: 'key',
    GHL_LOCATION_ID: 'loc',
    GHL_SMS_FROM_NUMBER: '+15551234567',
    GHL_EMAIL_FROM: 'from@example.com',
  };
  const network = await store.getOrCreateNetworkForWorkspace(`ws_rra_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, {
    name: 'Review Auto Net',
  });
  const member = await store.saveMember(network.id, {
    companyName: 'Cascade Floors',
    contactName: 'Owner',
    status: 'active',
    reviewSlug: 'cascade-floors',
    reviewLinks: { google: 'https://g.page/r/demo/review' },
    email: 'owner@cascade.test',
  });
  return { network, member };
}

test('resolveReviewMember prefers the owner with a review slug', async () => {
  const network = await store.getOrCreateNetworkForWorkspace(`ws_rra_owner_${Date.now()}`, {
    name: 'Owner Prefer Net',
  });
  const owner = await store.saveMember(network.id, {
    id: 'owner',
    companyName: 'Cascade Floors',
    contactName: 'Owner',
    status: 'active',
    reviewSlug: 'cascade-owner',
    reviewLinks: { google: 'https://g.page/r/demo/review' },
  });
  const other = await store.saveMember(network.id, {
    companyName: 'Partner Co',
    contactName: 'Pat',
    status: 'active',
    reviewSlug: 'partner-co',
  });
  const members = await store.listMembers(network.id);
  const picked = automation.resolveReviewMember(network, members);
  assert.equal(picked.ok, true);
  assert.equal(picked.member.id, owner.id);
  assert.notEqual(picked.member.id, other.id);
});

test('requestReview preview builds SMS without sending', async () => {
  const { network } = await setup();
  const result = await automation.requestReview({
    network,
    customerName: 'Jamie Lee',
    phone: '3605550199',
    useAi: false,
    preview: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.preview, true);
  assert.match(result.message, /Cascade Floors|review/i);
  assert.match(result.review_link, /\/rv\/cascade-floors/);
  assert.equal(calls.sms.length, 0);
});

test('requestReview sends through GHL SMS', async () => {
  const { network } = await setup();
  const result = await automation.requestReview({
    network,
    customerName: 'Jamie Lee',
    phone: '3605550199',
    useAi: false,
    preview: false,
  });
  assert.equal(result.ok, true);
  assert.equal(result.preview, false);
  assert.equal(result.channel, 'sms');
  assert.equal(calls.sms.length, 1);
  assert.match(calls.sms[0].message, /cascade-floors/);
});

test('requestReview matches a saved customer by phone', async () => {
  const { network, member } = await setup();
  const saved = await work.saveCustomer(network.id, member.id, {
    name: 'Saved Customer',
    phone: '3605550199',
    email: 'saved@example.com',
  });
  assert.equal(saved.ok, true);
  const result = await automation.requestReview({
    network,
    phone: '360-555-0199',
    useAi: false,
    preview: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.customer.name, 'Saved Customer');
  assert.equal(result.customer.email, 'saved@example.com');
});

test('MCP registers send_review_request and rejects empty input', async () => {
  assert.ok(mcpNetwork.NETWORK_TOOL_NAMES.includes('send_review_request'));
  assert.ok(mcpNetwork.OPEN_WORLD_NETWORK_TOOLS.includes('send_review_request'));
  await assert.rejects(
    () => mcpNetwork.executeNetworkTool(
      { workspaceId: 'missing_ws_for_rra', userEmail: 'a@b.c' },
      'send_review_request',
      { preview: true },
    ),
    /no referral network/i,
  );
});
