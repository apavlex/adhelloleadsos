const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveSmsProvider,
  providerDisplayName,
  leadSmsBlock,
  ghlGroupSmsReadiness,
  sendSmsToLead,
  GHL_REQUIRED_FOR_GROUP_SMS_MESSAGE,
} = require('../services/smsOutbound');

describe('smsOutbound', () => {
  it('prefers comms when SMS_PRIMARY=comms', () => {
    const env = { SMS_PRIMARY: 'comms', COMMS_API_KEY: 'osis_test', GHL_API_KEY: 'ghl', GHL_LOCATION_ID: 'loc' };
    assert.equal(resolveSmsProvider(env), 'comms');
  });

  it('prefers saperly when SMS_PRIMARY=saperly', () => {
    const env = {
      SMS_PRIMARY: 'saperly',
      SAPERLY_API_KEY: 'sap_sk_test',
      SAPERLY_FROM_NUMBER_ID: 'num_123',
      COMMS_API_KEY: 'osis_test',
    };
    assert.equal(resolveSmsProvider(env), 'saperly');
  });

  it('prefers ghl when SMS_PRIMARY=auto and both configured', () => {
    const env = { SMS_PRIMARY: 'auto', COMMS_API_KEY: 'osis_test', GHL_API_KEY: 'ghl', GHL_LOCATION_ID: 'loc' };
    assert.equal(resolveSmsProvider(env), 'ghl');
  });

  it('uses comms when ghl is not configured', () => {
    const env = { COMMS_API_KEY: 'osis_test' };
    assert.equal(resolveSmsProvider(env), 'comms');
  });

  it('uses saperly when ghl and comms are not configured', () => {
    const env = { SAPERLY_API_KEY: 'sap_sk_test', SAPERLY_FROM_NUMBER_ID: 'num_123' };
    assert.equal(resolveSmsProvider(env), 'saperly');
  });

  it('providerDisplayName maps known providers', () => {
    assert.equal(providerDisplayName('comms'), 'Comms');
    assert.equal(providerDisplayName('saperly'), 'Saperly');
    assert.equal(providerDisplayName('ghl'), 'Go High Level');
  });
});

describe('smsOutbound compliance + group SMS gating', () => {
  it('leadSmsBlock flags DNC leads', () => {
    const block = leadSmsBlock({ key: 'lead:1', doNotCall: true });
    assert.equal(block.code, 'lead_dnc');
    assert.equal(block.reason, 'dnc');
    assert.match(block.message, /Do Not Contact/);
  });

  it('leadSmsBlock flags SMS opt-outs', () => {
    const block = leadSmsBlock({ key: 'lead:1', smsOptOut: true });
    assert.equal(block.code, 'lead_sms_opt_out');
    assert.equal(block.reason, 'opted_out');
  });

  it('leadSmsBlock allows normal leads', () => {
    assert.equal(leadSmsBlock({ key: 'lead:1', doNotCall: false }), null);
    assert.equal(leadSmsBlock(null), null);
  });

  it('ghlGroupSmsReadiness requires GHL connection', () => {
    const r = ghlGroupSmsReadiness({ GHL_API_KEY: '', GHL_LOCATION_ID: '', SAPERLY_API_KEY: 'sap_sk_test' });
    assert.equal(r.ready, false);
    assert.equal(r.reason, 'not_connected');
    assert.equal(r.message, GHL_REQUIRED_FOR_GROUP_SMS_MESSAGE);
    assert.equal(r.settingsUrl, '/workspace/integrations');
  });

  it('ghlGroupSmsReadiness requires an SMS from number', () => {
    const r = ghlGroupSmsReadiness({ GHL_API_KEY: 'ghl', GHL_LOCATION_ID: 'loc', GHL_SMS_FROM_NUMBER: '' });
    assert.equal(r.ready, false);
    assert.equal(r.reason, 'missing_sms_from');
  });

  it('ghlGroupSmsReadiness is ready with key, location, and from number', () => {
    const r = ghlGroupSmsReadiness({ GHL_API_KEY: 'ghl', GHL_LOCATION_ID: 'loc', GHL_SMS_FROM_NUMBER: '+15125550100' });
    assert.equal(r.ready, true);
  });

  it('sendSmsToLead with requireProvider ghl never falls back to another provider', async () => {
    const env = {
      GHL_API_KEY: '',
      GHL_LOCATION_ID: '',
      SAPERLY_API_KEY: 'sap_sk_test',
      SAPERLY_FROM_NUMBER_ID: 'num_123',
    };
    await assert.rejects(
      sendSmsToLead({
        lead: { key: 'lead:1', phone: '+15125550123' },
        message: 'Hello there from the test suite',
        integrationEnv: env,
        provider: 'ghl',
        requireProvider: 'ghl',
      }),
      (err) => err.code === 'ghl_not_ready' && err.status === 412,
    );
  });
});
