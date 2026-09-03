const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const store = require('../services/agentSessionStore');

describe('agentSessionStore', () => {
  beforeEach(() => {
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
});
