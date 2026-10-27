/**
 * Reviews app: pull-to-refresh with a spinning refresh icon at the top.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

describe('memberPullToRefresh', () => {
  it('ships pull-to-refresh with a spinning top icon on Reviews shells', () => {
    const js = fs.readFileSync(path.join(root, 'public/js/member-app.js'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'public/css/member-app.css'), 'utf8');
    const icons = fs.readFileSync(path.join(root, 'services/memberAppIcons.js'), 'utf8');

    assert.match(js, /bootPullToRefresh/);
    assert.match(js, /maPtr/);
    assert.match(js, /ma-ptr/);
    assert.match(js, /is-refreshing/);
    assert.match(js, /location\.reload/);
    assert.match(css, /\.ma-ptr\b/);
    assert.match(css, /ma-ptr-spin/);
    assert.match(css, /\.ma-ptr\.is-refreshing/);
    assert.match(icons, /refresh:\s*icon\(/);
  });
});
