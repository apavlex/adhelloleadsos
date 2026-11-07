const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { phasePercent } = require('../services/localSeoProgress');

describe('localSeoSync phasePercent', () => {
  it('ramps during maps by keyword index', () => {
    assert.equal(phasePercent('maps', 0, 8), 0);
    assert.equal(phasePercent('maps', 4, 8), 28);
    assert.ok(phasePercent('maps', 8, 8) >= 50);
  });

  it('orders later phases after maps', () => {
    const mapsEnd = phasePercent('maps', 8, 8);
    assert.ok(phasePercent('volume', 8, 8) > mapsEnd);
    assert.ok(phasePercent('category', 8, 8) > phasePercent('volume', 8, 8));
    assert.ok(phasePercent('gbp', 8, 8) > phasePercent('category', 8, 8));
    assert.ok(phasePercent('reviews', 8, 8) > phasePercent('gbp', 8, 8));
    assert.equal(phasePercent('done', 8, 8), 100);
  });
});
