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

test('buildSourceCards includes Go High Level and Lob', () => {
  const prevGhl = process.env.GHL_API_KEY;
  const prevLoc = process.env.GHL_LOCATION_ID;
  const prevLob = process.env.LOB_API_KEY;
  const prevLobLine = process.env.LOB_FROM_ADDRESS_LINE1;
  const prevLobCity = process.env.LOB_FROM_CITY;
  const prevLobState = process.env.LOB_FROM_STATE;
  const prevLobZip = process.env.LOB_FROM_ZIP;
  process.env.GHL_API_KEY = 'ghl-test';
  process.env.GHL_LOCATION_ID = 'loc-test';
  process.env.LOB_API_KEY = 'test_lob';
  process.env.LOB_FROM_ADDRESS_LINE1 = '123 Main';
  process.env.LOB_FROM_CITY = 'Portland';
  process.env.LOB_FROM_STATE = 'OR';
  process.env.LOB_FROM_ZIP = '97201';
  try {
    const { sources, tasks } = getDashboardPayload({}, {});
    const ghl = sources.find((s) => s.id === 'ghl');
    const lob = sources.find((s) => s.id === 'lob');
    assert.ok(ghl);
    assert.ok(lob);
    assert.equal(ghl.name, 'Go High Level');
    assert.equal(ghl.connectAnchor, 'ghl-integration');
    assert.equal(ghl.configured, true);
    assert.equal(lob.name, 'Lob (Direct Mail)');
    assert.equal(lob.connectAnchor, 'lob-integration');
    assert.equal(lob.configured, true);
    assert.ok(tasks.some((t) => /Go High Level|CRM/i.test(t.inApp)));
    assert.ok(tasks.some((t) => /Lob|Direct Mail/i.test(t.inApp)));
  } finally {
    if (prevGhl === undefined) delete process.env.GHL_API_KEY;
    else process.env.GHL_API_KEY = prevGhl;
    if (prevLoc === undefined) delete process.env.GHL_LOCATION_ID;
    else process.env.GHL_LOCATION_ID = prevLoc;
    if (prevLob === undefined) delete process.env.LOB_API_KEY;
    else process.env.LOB_API_KEY = prevLob;
    if (prevLobLine === undefined) delete process.env.LOB_FROM_ADDRESS_LINE1;
    else process.env.LOB_FROM_ADDRESS_LINE1 = prevLobLine;
    if (prevLobCity === undefined) delete process.env.LOB_FROM_CITY;
    else process.env.LOB_FROM_CITY = prevLobCity;
    if (prevLobState === undefined) delete process.env.LOB_FROM_STATE;
    else process.env.LOB_FROM_STATE = prevLobState;
    if (prevLobZip === undefined) delete process.env.LOB_FROM_ZIP;
    else process.env.LOB_FROM_ZIP = prevLobZip;
  }
});

test('buildSourceCards includes OpenRouter AI card', () => {
  const prev = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'or-test';
  try {
    const { sources, tasks } = getDashboardPayload({}, {});
    const or = sources.find((s) => s.id === 'openrouter');
    assert.ok(or);
    assert.equal(or.name, 'OpenRouter (AI)');
    assert.equal(or.connectAnchor, 'openrouter-integration');
    assert.equal(or.configured, true);
    assert.match(or.tip, /openrouter\/free/);
    assert.ok(tasks.some((t) => /OpenRouter|deepseek\/deepseek-v4-flash/i.test(t.inApp)));
  } finally {
    if (prev === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = prev;
  }
});
