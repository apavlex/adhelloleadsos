const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { PLATFORMS, reviewDestinations } = require('../services/reviewPage');
const { iconFor, ICONS } = require('../services/reviewPlatformIcons');

describe('review platform logos', () => {
  it('ships an SVG mark for every built-in platform', () => {
    for (const p of PLATFORMS) {
      assert.ok(p.icon, `missing icon for ${p.key}`);
      assert.match(p.icon, /<svg[\s\S]*<\/svg>/);
      assert.ok(p.tile, `missing tile for ${p.key}`);
      assert.equal(iconFor(p.key), ICONS[p.key]);
    }
  });

  it('includes icons on review destinations', () => {
    const dest = reviewDestinations(
      {
        google: 'https://g.page/r/x/review',
        yelp: 'https://yelp.com/biz/x',
        other: [{ label: 'HomeAdvisor', url: 'https://example.com' }],
      },
      'acme',
    );
    const google = dest.find((d) => d.key === 'google');
    const yelp = dest.find((d) => d.key === 'yelp');
    const other = dest.find((d) => d.key === 'other');
    assert.match(google.icon, /4285F4/);
    assert.match(yelp.icon, /D32323/);
    assert.equal(other.icon, '');
    assert.equal(other.letter, 'H');
  });
});
