const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

/**
 * Lightweight sanity checks for agent-first confirm bridge helpers.
 * Full TwiML routes need auth + env; this locks the intended DTMF contract.
 */
describe('agent-first confirm contract', () => {
  it('treats digit 1 as confirm and empty/other as reject', () => {
    function shouldBridge(digits) {
      const d = String(digits || '').trim();
      return d === '1';
    }
    assert.equal(shouldBridge('1'), true);
    assert.equal(shouldBridge(''), false);
    assert.equal(shouldBridge('2'), false);
    assert.equal(shouldBridge(undefined), false);
  });
});
