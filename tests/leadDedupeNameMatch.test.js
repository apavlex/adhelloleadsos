const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { nameMatchKey } = require('../services/leadDedupe');

describe('nameMatchKey', () => {
  it('matches exact same name across cities', () => {
    assert.equal(
      nameMatchKey({ title: 'Precision Garage Door Service', city: 'Vancouver, WA' }),
      nameMatchKey({ title: 'Precision Garage Door Service', city: 'Hillsboro, OR' }),
    );
  });

  it('strips city suffix from the title', () => {
    assert.equal(
      nameMatchKey({ title: 'Ponderosa Garage Doors Vancouver', city: 'Vancouver, WA' }),
      nameMatchKey({ title: 'Ponderosa Garage Doors Portland', city: 'Portland', state: 'Oregon' }),
    );
    assert.equal(
      nameMatchKey({ title: 'Ponderosa Garage Doors Vancouver', city: 'Vancouver, WA' }),
      'name:ponderosa garage doors',
    );
  });
});
