const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseCommsWebhook } = require('../services/commsSync');

describe('commsSync', () => {
  it('parses inbound message.received payloads', () => {
    const parsed = parseCommsWebhook({
      type: 'message.received',
      message: {
        id: 'msg_123',
        body: 'Hello there',
        from: '+15551234567',
        to: '+15559876543',
        channel: 'imessage',
      },
    });
    assert.ok(parsed);
    assert.equal(parsed.direction, 'inbound');
    assert.equal(parsed.body, 'Hello there');
    assert.equal(parsed.messageId, 'msg_123');
    assert.equal(parsed.channel, 'imessage');
  });
});
