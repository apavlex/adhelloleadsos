const test = require('node:test');
const assert = require('node:assert/strict');
const { getDashboardPayload, rapidapiConfigured } = require('../services/scrapeCostAdvisor');

test('buildSourceCards includes RapidAPI with configured flag', () => {
  const prev = process.env.RAPIDAPI_KEY;
  process.env.RAPIDAPI_KEY = 'test-key';
  try {
    assert.equal(rapidapiConfigured(), true);
    const { sources } = getDashboardPayload({}, {});
    const rapid = sources.find((s) => s.id === 'rapidapi');
    assert.ok(rapid);
    assert.equal(rapid.name, 'RapidAPI (Local Business Data)');
    assert.equal(rapid.configured, true);
    assert.match(rapid.role, /first in Auto/i);
  } finally {
    if (prev === undefined) delete process.env.RAPIDAPI_KEY;
    else process.env.RAPIDAPI_KEY = prev;
  }
});

test('RapidAPI card shows Not set when key missing', () => {
  const prev = process.env.RAPIDAPI_KEY;
  delete process.env.RAPIDAPI_KEY;
  try {
    const { sources } = getDashboardPayload({}, {});
    const rapid = sources.find((s) => s.id === 'rapidapi');
    assert.equal(rapid.configured, false);
    assert.match(rapid.tip, /RAPIDAPI_KEY/i);
  } finally {
    if (prev !== undefined) process.env.RAPIDAPI_KEY = prev;
  }
});
