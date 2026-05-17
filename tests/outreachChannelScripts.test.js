const { test } = require('node:test');
const assert = require('node:assert/strict');
const { scriptForChannel, buildOutreachLibrary, CHANNELS } = require('../services/outreachChannelScripts');

test('CHANNELS includes call text voicemail email', () => {
  assert.deepEqual(CHANNELS, ['call', 'text', 'voicemail', 'email']);
});

test('scriptForChannel maps sections per channel', () => {
  const def = {
    opening: 'OPEN',
    discovery: 'DISC',
    valueProp: 'VALUE',
  };
  assert.equal(scriptForChannel(def, 'call'), 'OPEN\n\nDISC');
  assert.equal(scriptForChannel(def, 'text'), 'OPEN');
  assert.equal(scriptForChannel(def, 'email'), 'VALUE');
});

test('buildOutreachLibrary builds channel map', () => {
  const lib = buildOutreachLibrary(
    {
      reputation: { label: 'Reputation', opening: 'Hi', valueProp: 'We help' },
    },
    ['reputation']
  );
  assert.equal(lib.reputation.label, 'Reputation');
  assert.equal(lib.reputation.channels.call, 'Hi');
  assert.equal(lib.reputation.channels.email, 'We help');
});

test('Speed to Lead Agent is in default script library with all channels', () => {
  const { SCRIPT_LIBRARY, SCRIPT_LIBRARY_KEYS } = require('../services/salesConstants');
  assert.ok(SCRIPT_LIBRARY_KEYS.includes('speedToLeadAgent'));
  const lib = buildOutreachLibrary(SCRIPT_LIBRARY, ['speedToLeadAgent']);
  const entry = lib.speedToLeadAgent;
  assert.equal(entry.label, 'Speed to Lead Agent');
  assert.ok(entry.channels.call.includes('{{name}}'));
  assert.ok(entry.channels.text);
  assert.ok(entry.channels.voicemail);
  assert.ok(entry.channels.email);
});
