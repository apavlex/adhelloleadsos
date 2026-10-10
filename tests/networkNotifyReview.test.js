const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'network-notify-review-'));

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

const notify = require('../services/networkNotify');
const store = require('../services/networkStore');

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
  const network = await store.getOrCreateNetworkForWorkspace(`ws_notify_review_${Date.now()}`, { name: 'Notify Review Net' });
  const member = await store.saveMember(network.id, {
    companyName: 'Brightline Electric',
    contactName: 'Priya',
    status: 'active',
    reviewSlug: 'brightline-electric',
    reviewLinks: { google: 'https://g.page/r/demo/review' },
  });
  return { network, member };
}

test('sendReviewRequest texts the customer through GHL first', async () => {
  const { network, member } = await setup();
  const result = await notify.sendReviewRequest({
    network,
    member,
    baseUrl: 'https://app.example',
    toPhone: '3605550199',
    toEmail: 'jamie@example.com',
    customerName: 'Jamie Lee',
    channel: 'auto',
  });
  assert.equal(result.ok, true);
  assert.equal(result.channel, 'sms');
  assert.equal(result.provider, 'ghl');
  assert.equal(calls.sms.length, 1);
  assert.equal(calls.email.length, 0);
  assert.match(calls.sms[0].message, /https:\/\/app\.example\/rv\/brightline-electric/);
  assert.match(calls.sms[0].message, /Brightline Electric/);
});

test('sendReviewRequest falls back to GHL email when SMS is not ready', async () => {
  const { network, member } = await setup();
  calls.env = {
    GHL_API_KEY: 'key',
    GHL_LOCATION_ID: 'loc',
    GHL_EMAIL_FROM: 'from@example.com',
  };
  const result = await notify.sendReviewRequest({
    network,
    member,
    baseUrl: 'https://app.example',
    toPhone: '3605550199',
    toEmail: 'jamie@example.com',
    customerName: 'Jamie Lee',
  });
  assert.equal(result.ok, true);
  assert.equal(result.channel, 'email');
  assert.equal(calls.sms.length, 0);
  assert.equal(calls.email.length, 1);
  assert.match(calls.email[0].body, /rv\/brightline-electric/);
});

test('sendReviewRequest requires GHL to be connected', async () => {
  const { network, member } = await setup();
  calls.env = {};
  const result = await notify.sendReviewRequest({
    network,
    member,
    baseUrl: 'https://app.example',
    toPhone: '3605550199',
    customerName: 'Jamie',
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /Go High Level is not connected/i);
  assert.equal(calls.sms.length, 0);
});

test('messagingReadyForNetwork reports owner workspace GHL readiness', async () => {
  const { network } = await setup();
  const ready = await notify.messagingReadyForNetwork(network);
  assert.equal(ready.configured, true);
  assert.equal(ready.smsReady, true);
  assert.equal(ready.emailReady, true);
});
