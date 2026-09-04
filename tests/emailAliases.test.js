const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { emailAliases } = require('../services/workspaceService');
const { userCanAccessWorkspace } = require('../services/workspaceBootstrap');

describe('adhello email aliases', () => {
  it('maps .io ↔ .ai for the same local part', () => {
    assert.deepEqual(emailAliases('Alex@adhello.io'), ['alex@adhello.io', 'alex@adhello.ai']);
    assert.deepEqual(emailAliases('alex@adhello.ai'), ['alex@adhello.ai', 'alex@adhello.io']);
  });

  it('grants access when membership is on the sister domain', () => {
    const ws = {
      ownerUserId: 'alex@adhello.ai',
      members: {
        'alex@adhello.ai': { role: 'owner' },
      },
    };
    assert.equal(userCanAccessWorkspace(ws, 'alex@adhello.io'), true);
    assert.equal(userCanAccessWorkspace(ws, 'other@adhello.io'), false);
  });
});
