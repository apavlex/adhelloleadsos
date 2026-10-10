const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { roleForEmail } = require('../services/workspaceService');

describe('roleForEmail', () => {
  it('treats workspace ownerUserId as owner even when members has a lower role', () => {
    const ws = {
      ownerUserId: 'alex@adhello.ai',
      members: {
        'alex@adhello.ai': { role: 'viewer' },
        'alex@adhello.io': { role: 'sdr' },
      },
    };
    assert.equal(roleForEmail(ws, 'alex@adhello.ai'), 'owner');
    assert.equal(roleForEmail(ws, 'Alex@adhello.io'), 'owner');
  });

  it('resolves membership via brand-domain aliases', () => {
    const ws = {
      ownerUserId: 'other@example.com',
      members: {
        'alex@adhello.ai': { role: 'admin' },
      },
    };
    assert.equal(roleForEmail(ws, 'alex@adhello.io'), 'admin');
  });

  it('returns viewer when there is no membership or owner match', () => {
    const ws = {
      ownerUserId: 'owner@example.com',
      members: { 'owner@example.com': { role: 'owner' } },
    };
    assert.equal(roleForEmail(ws, 'guest@example.com'), 'viewer');
  });
});
