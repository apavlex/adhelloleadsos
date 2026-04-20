const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isCoachBriefCacheUsable } = require('../services/prospectingCoachCache');

describe('prospectingCoachCache', () => {
  it('rejects empty body', () => {
    assert.equal(isCoachBriefCacheUsable({ success: true, body: '' }), false);
    assert.equal(isCoachBriefCacheUsable({ success: true, body: '   ' }), false);
  });

  it('accepts usable payload', () => {
    assert.equal(
      isCoachBriefCacheUsable({ success: true, body: 'Hello', headline: 'H' }),
      true
    );
  });

  it('rejects explicit failure', () => {
    assert.equal(isCoachBriefCacheUsable({ success: false, body: 'x' }), false);
  });
});
