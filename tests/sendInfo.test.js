const { test } = require('node:test');
const assert = require('node:assert/strict');

test('sendSmsToLead uses to override instead of lead.phone', async () => {
  const ghlClient = require('../services/ghlClient');
  const commsClient = require('../services/commsClient');
  const smsOutbound = require('../services/smsOutbound');

  const origResolve = smsOutbound.resolveSmsProvider;
  const origComms = commsClient.sendMessage;
  const origConfigured = commsClient.isConfigured;

  smsOutbound.resolveSmsProvider = () => 'comms';
  commsClient.isConfigured = () => true;
  commsClient.sendMessage = async (opts) => {
    assert.equal(opts.to, '+15559998888');
    assert.match(opts.body, /audit link/i);
    return { message: { id: 'msg-1', channel: 'sms' } };
  };

  try {
    const result = await smsOutbound.sendSmsToLead({
      lead: { key: 'lead:test', phone: '+15551112222' },
      message: 'Here is your audit link',
      integrationEnv: {},
      to: '+15559998888',
    });
    assert.equal(result.provider, 'comms');
    assert.equal(result.messageId, 'msg-1');
  } finally {
    smsOutbound.resolveSmsProvider = origResolve;
    commsClient.sendMessage = origComms;
    commsClient.isConfigured = origConfigured;
  }
});
