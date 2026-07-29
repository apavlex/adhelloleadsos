const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  PERMIT_STACK_CITIES,
  normalizePermitStackCity,
  permitCitiesByState,
} = require('../services/permitStackCities');

test('PERMIT_STACK_CITIES includes Camas WA', () => {
  assert.ok(PERMIT_STACK_CITIES.length > 100);
  const camas = normalizePermitStackCity('Camas');
  assert.ok(camas);
  assert.equal(camas.state, 'WA');
  assert.equal(camas.city, 'Camas');
});

test('normalizePermitStackCity is case insensitive', () => {
  const austin = normalizePermitStackCity('austin');
  assert.ok(austin);
  assert.equal(austin.state, 'TX');
});

test('normalizePermitStackCity returns null for unknown city', () => {
  assert.equal(normalizePermitStackCity('Not A Real City'), null);
});

test('permitCitiesByState groups by state code', () => {
  const groups = permitCitiesByState();
  assert.ok(groups.length > 10);
  const wa = groups.find(([st]) => st === 'WA');
  assert.ok(wa);
  assert.ok(wa[1].some((row) => row.city === 'Camas'));
});

test('permitCitiesByState puts Other group last', () => {
  const groups = permitCitiesByState();
  const last = groups[groups.length - 1];
  assert.equal(last[0], '—');
});
