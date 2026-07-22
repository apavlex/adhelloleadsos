const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { resolveSmsProvider, providerDisplayName } = require('../services/smsOutbound');

describe('smsOutbound', () => {
  it('prefers comms when SMS_PRIMARY=comms', () => {
    const env = { SMS_PRIMARY: 'comms', COMMS_API_KEY: 'osis_test', GHL_API_KEY: 'ghl', GHL_LOCATION_ID: 'loc' };
    assert.equal(resolveSmsProvider(env), 'comms');
  });

  it('prefers ghl when SMS_PRIMARY=auto and both configured', () => {
    const env = { SMS_PRIMARY: 'auto', COMMS_API_KEY: 'osis_test', GHL_API_KEY: 'ghl', GHL_LOCATION_ID: 'loc' };
    assert.equal(resolveSmsProvider(env), 'ghl');
  });

  it('uses comms when ghl is not configured', () => {
    const env = { COMMS_API_KEY: 'osis_test' };
    assert.equal(resolveSmsProvider(env), 'comms');
  });

  it('providerDisplayName maps known providers', () => {
    assert.equal(providerDisplayName('comms'), 'Comms');
    assert.equal(providerDisplayName('ghl'), 'Go High Level');
  });
});
