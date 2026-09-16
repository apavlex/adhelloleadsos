const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

const store = require('../services/agentSessionStore');

describe('agentSessionStore', () => {
  beforeEach(() => {
    store.removeSession('ws-test');
  });

  // Dial-in sessions are mirrored to SQLite, so leaving one behind would let a test
  // session answer a real inbound call on a dev machine.
  after(() => {
    store.removeSession('ws-test');
  });

  it('expires stale sessions so dials can place a fresh agent ring', () => {
    store.createSession('ws-test', { callSid: 'CA_old', agentTo: '+15551234567' });
    const s = store.getSession('ws-test');
    assert.ok(s);
    s.createdAt = Date.now() - store.SESSION_MAX_AGE_MS - 1000;
    assert.equal(store.getSession('ws-test'), null);
  });

  it('removeSessionForCall clears matching callSid', () => {
    store.createSession('ws-test', { callSid: 'CA_live' });
    assert.equal(store.removeSessionForCall('ws-test', 'CA_other'), false);
    assert.ok(store.getSession('ws-test'));
    assert.equal(store.removeSessionForCall('ws-test', 'CA_live'), true);
    assert.equal(store.getSession('ws-test'), null);
  });

  it('findPendingDialInByDid matches workspace DID', () => {
    store.createSession('ws-test', {
      mode: 'dial_in',
      dialInNumber: '+13607935057',
      dialTo: '+13605551212',
      agentTo: '+13606096937',
    });
    const hit = store.findPendingDialInByDid('+13607935057', '+13606096937');
    assert.ok(hit);
    assert.equal(hit.dialTo, '+13605551212');
    assert.equal(store.findPendingDialInByDid('+13607935057', ''), hit);
  });

  it('phonesMatch tolerates the formats SignalWire and the workspace store use', () => {
    assert.equal(store.phonesMatch('+1 (360) 609-6937', '+13606096937'), true);
    assert.equal(store.phonesMatch('3606096937', '+13606096937'), true);
    assert.equal(store.phonesMatch('+1 360-793-5057', '13607935057'), true);
    assert.equal(store.phonesMatch('+13606096937', '+13607935057'), false);
    // Suffix comparison must not make short strings match unrelated numbers.
    assert.equal(store.phonesMatch('6937', '+13606096937'), false);
    assert.equal(store.phonesMatch('', '+13606096937'), false);
  });

  it('bridges a dial-in even when the handset presents a different caller ID', () => {
    store.createSession('ws-test', {
      mode: 'dial_in',
      dialInNumber: '+1 360-793-5057',
      dialTo: '+13605665293',
      agentTo: '+1 (360) 609-6937',
    });
    // Same cell, unformatted.
    assert.ok(store.findPendingDialInByDid('3607935057', '3606096937'));
    // A second line / Google Voice number still reaches the parked lead.
    const other = store.findPendingDialInByDid('+13607935057', '+13607731505');
    assert.ok(other);
    assert.equal(other.dialTo, '+13605665293');
    // A different DID must not pick up this workspace's session.
    assert.equal(store.findPendingDialInByDid('+12065551212', '+13606096937'), null);
  });

  it('records whether the inbound webhook was verified so the UI can stop promising dial-in', () => {
    store.createSession('ws-test', { mode: 'dial_in', dialInNumber: '+13607935057', dialTo: '+13605665293' });
    assert.equal(store.getSession('ws-test').inboundConfigured, null);
    store.updateSession('ws-test', { inboundConfigured: false, inboundError: 'number_not_found' });
    assert.equal(store.getSession('ws-test').inboundConfigured, false);
    assert.equal(store.getSession('ws-test').inboundError, 'number_not_found');
  });
});
