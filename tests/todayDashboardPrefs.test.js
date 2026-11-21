const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  SECTION_IDS,
  sanitizeTodayDashboardPrefs,
} = require('../services/todayDashboardPrefs');

describe('todayDashboardPrefs', () => {
  it('sanitizes order, hidden, and updatedAt', () => {
    const prefs = sanitizeTodayDashboardPrefs(
      {
        order: ['touches', 'bogus', 'hero', 'touches'],
        hidden: { pipeline: true, nope: true, hero: 0 },
        updatedAt: 1_700_000_000_000,
      },
      1_800_000_000_000,
    );
    assert.ok(prefs);
    assert.equal(prefs.order[0], 'touches');
    assert.equal(prefs.order[1], 'hero');
    assert.ok(prefs.order.includes('pipeline'));
    assert.equal(prefs.order.length, SECTION_IDS.length);
    assert.equal(prefs.hidden.pipeline, true);
    assert.equal(prefs.hidden.nope, undefined);
    assert.equal(prefs.hidden.hero, undefined);
    assert.equal(prefs.updatedAt, 1_700_000_000_000);
  });

  it('clamps future updatedAt to now', () => {
    const now = 1_700_000_000_000;
    const prefs = sanitizeTodayDashboardPrefs({ order: ['hero'], updatedAt: now + 60_000 }, now);
    assert.equal(prefs.updatedAt, now);
  });

  it('returns null for empty payload', () => {
    assert.equal(sanitizeTodayDashboardPrefs(null), null);
    assert.equal(sanitizeTodayDashboardPrefs('x'), null);
  });
});
