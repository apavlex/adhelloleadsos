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
});
