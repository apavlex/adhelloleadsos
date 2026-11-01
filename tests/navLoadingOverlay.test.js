/**
 * Nav frost overlay must not let clicks restart the spinner forever.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

describe('adhelloNavLoading stuck-spinner guard', () => {
  it('captures pointer events when on and auto-hides aggressively', () => {
    const css = fs.readFileSync(path.join(root, 'public/css/custom.css'), 'utf8');
    assert.match(css, /#adhelloNavLoading\.is-on[\s\S]*pointer-events:\s*auto\s*!important/);
    assert.match(css, /body\.app-with-sidebar\s*>\s*#adhelloNavLoading\.is-on/);

    const js = fs.readFileSync(path.join(root, 'public/js/navbar-shell.js'), 'utf8');
    assert.match(js, /var ms = 3500/);
    assert.match(js, /hideNavLoading\(\);\n/);
    assert.match(js, /addEventListener\('load',\s*hideNavLoading\)/);
    assert.match(js, /visibilitychange/);
    assert.match(js, /el\.addEventListener\('click'/);
  });
});
