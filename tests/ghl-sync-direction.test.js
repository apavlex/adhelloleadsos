const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeGhlSyncDirection,
  getWorkspaceGhlSyncDirection,
  allowsGhlPush,
  allowsGhlPull,
  DEFAULT_GHL_SYNC_DIRECTION,
} = require('../services/ghlSyncDirection');

describe('ghlSyncDirection', () => {
  it('defaults unknown values to both', () => {
    assert.equal(normalizeGhlSyncDirection(''), DEFAULT_GHL_SYNC_DIRECTION);
    assert.equal(normalizeGhlSyncDirection('nope'), DEFAULT_GHL_SYNC_DIRECTION);
  });

  it('normalizes pull and push', () => {
    assert.equal(normalizeGhlSyncDirection('PULL'), 'pull');
    assert.equal(normalizeGhlSyncDirection('push'), 'push');
  });

  it('reads direction from workspace', () => {
    assert.equal(getWorkspaceGhlSyncDirection({ ghlSyncDirection: 'pull' }), 'pull');
    assert.equal(getWorkspaceGhlSyncDirection({}), DEFAULT_GHL_SYNC_DIRECTION);
  });

  it('allows push only for push and both', () => {
    assert.equal(allowsGhlPush('push'), true);
    assert.equal(allowsGhlPush('both'), true);
    assert.equal(allowsGhlPush('pull'), false);
  });

  it('allows pull only for pull and both', () => {
    assert.equal(allowsGhlPull('pull'), true);
    assert.equal(allowsGhlPull('both'), true);
    assert.equal(allowsGhlPull('push'), false);
  });
});
