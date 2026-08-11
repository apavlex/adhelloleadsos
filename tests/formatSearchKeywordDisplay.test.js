const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { formatSearchKeywordDisplay } = require('../services/formatSearchKeywordDisplay');

describe('formatSearchKeywordDisplay', () => {
  it('replaces underscores and hyphens with spaces', () => {
    assert.equal(formatSearchKeywordDisplay('new_construction'), 'new construction');
    assert.equal(formatSearchKeywordDisplay('mobile-home'), 'mobile home');
    assert.equal(formatSearchKeywordDisplay('roof_repair-job'), 'roof repair job');
  });

  it('collapses extra whitespace and trims', () => {
    assert.equal(formatSearchKeywordDisplay('  plumber   hvac  '), 'plumber hvac');
    assert.equal(formatSearchKeywordDisplay(''), '');
    assert.equal(formatSearchKeywordDisplay(null), '');
  });

  it('leaves already-readable keywords unchanged', () => {
    assert.equal(formatSearchKeywordDisplay('general contractor'), 'general contractor');
    assert.equal(formatSearchKeywordDisplay('Plumber'), 'Plumber');
  });
});
