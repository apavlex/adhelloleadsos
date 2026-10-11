const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { PLATFORMS, reviewDestinations } = require('../services/reviewPage');
const { iconFor, ICONS } = require('../services/reviewPlatformIcons');

describe('review platform logos', () => {
  it('ships an SVG mark for every built-in platform', () => {
    for (const p of PLATFORMS) {
      assert.ok(p.icon, `missing icon for ${p.key}`);
      assert.match(p.icon, /<svg[\s\S]*<\/svg>/);
      assert.match(p.icon, /preserveAspectRatio="xMidYMid meet"/);
      assert.match(p.icon, /viewBox="0 0 24 24"/);
      assert.ok(p.tile, `missing tile for ${p.key}`);
      assert.equal(iconFor(p.key), ICONS[p.key]);
    }
  });

  it('yelp uses a centered five-petal burst (not a skewed scribble)', () => {
    const yelp = iconFor('yelp');
    assert.match(yelp, /ellipse/);
    assert.match(yelp, /rotate\(72\)/);
    assert.match(yelp, /D32323/);
  });

  it('locks badge sizing in CSS so logos stay square', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const css = fs.readFileSync(path.join(__dirname, '../public/css/member-app.css'), 'utf8');
    const head = fs.readFileSync(path.join(__dirname, '../views/member_app/_head.ejs'), 'utf8');
    assert.match(css, /\.rv-field-badge\s*\{[\s\S]*aspect-ratio:\s*1\s*\/\s*1/);
    assert.match(css, /\.rv-field-badge svg\s*\{[\s\S]*aspect-ratio:\s*1\s*\/\s*1/);
    assert.match(head, /\.rv-field-badge\{[^}]*aspect-ratio:1\/1/);
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
