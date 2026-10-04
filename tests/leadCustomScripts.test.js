const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeChannel, publicCustomScripts, withCustomScript } = require('../services/leadCustomScripts');

test('normalizeChannel maps lead panel and Money mode names', () => {
  assert.equal(normalizeChannel('call'), 'call');
  assert.equal(normalizeChannel('text'), 'sms');
  assert.equal(normalizeChannel('call-script'), 'call');
  assert.equal(normalizeChannel('voicemail'), 'voicemail');
  assert.equal(normalizeChannel('fax'), '');
});

test('withCustomScript keeps editor formatting and a plain copy for AI tools', () => {
  const lead = { customScripts: { sms: { text: 'Hi {{name}}', updatedAt: 'x' } } };
  const saved = withCustomScript(lead, 'call', 'Hi <b>Maria</b><br>Got a minute?<script>alert(1)</script>', 'Alex@Example.com');
  assert.equal(saved.ok, true);
  assert.equal(saved.channel, 'call');
  assert.equal(saved.customScripts.call.text, 'Hi Maria\nGot a minute?');
  assert.equal(saved.customScripts.call.html, 'Hi <b>Maria</b><br>Got a minute?');
  assert.equal(saved.customScripts.call.updatedBy, 'alex@example.com');
  assert.equal(saved.customScripts.sms.text, 'Hi {{name}}', 'other channels are kept');
  assert.equal(lead.customScripts.call, undefined, 'input lead is not mutated');
});

test('withCustomScript stores plain text without html and clears on empty body', () => {
  const plain = withCustomScript({}, 'text', '  Quick question & offer  ', '');
  assert.equal(plain.channel, 'sms');
  assert.deepEqual(Object.keys(plain.customScripts.sms).sort(), ['text', 'updatedAt', 'updatedBy']);
  assert.equal(plain.customScripts.sms.text, 'Quick question & offer');

  const cleared = withCustomScript({ customScripts: plain.customScripts }, 'sms', '   ', '');
  assert.equal(cleared.ok, true);
  assert.equal(cleared.script, null);
  assert.deepEqual(cleared.customScripts, {});

  assert.equal(withCustomScript({}, 'fax', 'hi', '').ok, false);
});

test('publicCustomScripts drops empty and unknown channels', () => {
  const out = publicCustomScripts({
    customScripts: {
      call: { text: 'Hello', html: '<b>Hello</b>', updatedAt: 't', updatedBy: 'a@b.c' },
      sms: { text: '   ' },
      fax: { text: 'nope' },
    },
  });
  assert.deepEqual(Object.keys(out), ['call']);
  assert.equal(out.call.html, '<b>Hello</b>');
  assert.deepEqual(publicCustomScripts(null), {});
});
