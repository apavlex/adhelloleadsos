const test = require('node:test');
const assert = require('node:assert/strict');
const { renderLinks, linkHtml } = require('../services/socialBrandIcons');

test('renderLinks uses branded button markup for Facebook and Instagram', () => {
  const html = renderLinks({
    gm: 'https://maps.google.com/?q=test',
    fb: 'https://facebook.com/acme',
    ig: 'https://instagram.com/acme',
    gradSuffix: 't1',
  });
  assert.match(html, /#4285F4/);
  assert.match(html, /#1877F2/);
  assert.match(html, /igGradt1/);
  assert.match(html, /w-8 h-8/);
});

test('linkHtml returns empty for blank href', () => {
  assert.equal(linkHtml('facebook', 'N/A'), '');
});
