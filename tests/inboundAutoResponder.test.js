const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'inbound-auto-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const { isAutoResponderBody } = require('../services/inboundReplyRules');

test('canned "this number cannot text" replies are auto-responders', () => {
  [
    'This number does not reply to text messages. Please call 360-555-0100.',
    "We can't receive texts at this number, call the office instead.",
    'Text messages are not monitored. Please call us.',
    'This is an automated message from Grasstains Lawn Care.',
    'Auto-reply: we are closed until Monday.',
    'Please do not reply to this message.',
  ].forEach((body) => assert.equal(isAutoResponderBody(body), true, body));
});

test('real business replies are not auto-responders', () => {
  [
    'Yeah, we could use more jobs this fall. What does it cost?',
    "Not interested, thanks",
    "I can't talk right now, text me the details",
    'Call me tomorrow after 3',
    '',
  ].forEach((body) => assert.equal(isAutoResponderBody(body), false, body));
});
