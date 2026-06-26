const test = require('node:test');
const assert = require('node:assert/strict');
const signalwire = require('../services/signalwire');

test('normalizeCallStatus reads common provider fields', () => {
  assert.equal(signalwire.normalizeCallStatus({ status: 'completed' }), 'completed');
  assert.equal(signalwire.normalizeCallStatus({ Status: 'In-Progress' }), 'in-progress');
  assert.equal(signalwire.normalizeCallStatus({ call_status: 'failed' }), 'failed');
  assert.equal(signalwire.normalizeCallStatus({ CallStatus: 'busy' }), 'busy');
});

test('isTerminalCallStatus recognizes finished calls', () => {
  assert.equal(signalwire.isTerminalCallStatus('completed'), true);
  assert.equal(signalwire.isTerminalCallStatus('canceled'), true);
  assert.equal(signalwire.isTerminalCallStatus('in-progress'), false);
});

test('isCallAlreadyFinishedError matches SignalWire hangup races', () => {
  const samples = [
    'POST /Calls/abc.json Status Cannot update a completed call.',
    'Completed calls cannot be updated.',
    'Call is not in-progress. Cannot redirect.',
    'An attempt was made to update a completed call',
  ];
  samples.forEach((msg) => {
    assert.equal(signalwire.isCallAlreadyFinishedError(new Error(msg)), true, msg);
  });
  assert.equal(signalwire.isCallAlreadyFinishedError(new Error('Network timeout')), false);
});
