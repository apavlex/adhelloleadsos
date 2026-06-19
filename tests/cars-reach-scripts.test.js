const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CARS_REACH_SPECIALTIES,
  defaultElevatorScript,
  defaultFollowupScript,
  defaultAppointmentScript,
} = require('../config/carsReachScripts');
const {
  generateCarsReachScript,
  sanitizeNetworkingScript,
} = require('../services/carsReachScriptAi');

test('specialties include website design and general', () => {
  const keys = CARS_REACH_SPECIALTIES.map((s) => s.key);
  assert.ok(keys.includes('website_design'));
  assert.ok(keys.includes('general'));
  assert.equal(CARS_REACH_SPECIALTIES.length, 7);
});

test('defaultElevatorScript uses name and specialty', () => {
  const script = defaultElevatorScript('Bobby', 'website_design');
  assert.match(script, /Hi, I'm Bobby/i);
  assert.match(script, /websites/i);
});

test('defaultFollowupScript fills meetup fields', () => {
  const script = defaultFollowupScript('Bobby', 'Therapist', 'Thursday BNI');
  assert.match(script, /Hey Bobby/i);
  assert.match(script, /Thursday BNI/i);
  assert.match(script, /Therapist/i);
});

test('defaultAppointmentScript includes optional time', () => {
  const withTime = defaultAppointmentScript('Friday 5pm');
  assert.match(withTime, /Friday 5pm/i);
  const flex = defaultAppointmentScript('');
  assert.match(flex, /this week/i);
});

test('sanitizeNetworkingScript strips meta prefix and why-it-works', () => {
  const raw = "Here's Bobby's elevator speech:\n---\nHi, I'm Bobby — I help businesses.\n\nWhy it works:\n- Sounds human";
  assert.equal(sanitizeNetworkingScript(raw), "Hi, I'm Bobby — I help businesses.");
});

test('generateCarsReachScript returns default elevator without regenerate', async () => {
  const result = await generateCarsReachScript({
    scriptType: 'elevator',
    yourName: 'Alex',
    specialtyKey: 'seo',
    regenerate: false,
    currentScript: '',
  });
  assert.equal(result.success, true);
  assert.equal(result.provider, 'default');
  assert.match(result.script, /Hi, I'm Alex/i);
});

test('generateCarsReachScript requires name for elevator', async () => {
  const result = await generateCarsReachScript({
    scriptType: 'elevator',
    yourName: '',
    specialtyKey: 'seo',
  });
  assert.equal(result.success, false);
  assert.match(result.error, /name/i);
});

test('generateCarsReachScript requires followup fields', async () => {
  const result = await generateCarsReachScript({
    scriptType: 'followup',
    theirName: 'Sam',
    whereMet: '',
  });
  assert.equal(result.success, false);
});

test('generateCarsReachScript returns default appointment script', async () => {
  const result = await generateCarsReachScript({
    scriptType: 'appointment',
    suggestedTime: 'Tuesday morning',
    regenerate: false,
    currentScript: '',
  });
  assert.equal(result.success, true);
  assert.match(result.script, /Tuesday morning/i);
});
