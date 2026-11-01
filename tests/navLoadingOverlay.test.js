/**
 * Nav frost overlay must not let clicks restart the spinner forever,
 * and must not clear mid-leave (that left a blank white iOS screen).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

describe('adhelloNavLoading stuck-spinner guard', () => {
  it('captures pointer events when on and keeps frost during leave nav', () => {
    const css = fs.readFileSync(path.join(root, 'public/css/custom.css'), 'utf8');
    assert.match(css, /#adhelloNavLoading\.is-on[\s\S]*pointer-events:\s*auto\s*!important/);
    assert.match(css, /body\.app-with-sidebar\s*>\s*#adhelloNavLoading\.is-on/);

    const js = fs.readFileSync(path.join(root, 'public/js/navbar-shell.js'), 'utf8');
    assert.match(js, /untilPageShow/);
    assert.match(js, /showNavLoading\(\{\s*untilPageShow:\s*true\s*\}\)/);
    assert.match(js, /ms = 45000/);
    assert.match(js, /showNavLoading\._leaving/);
    assert.match(js, /addEventListener\('load',\s*hideNavLoading\)/);
    assert.match(js, /visibilitychange/);
    assert.match(js, /!showNavLoading\._leaving/);
    assert.match(js, /el\.addEventListener\('click'/);
    // Accidental taps during leave must not reveal the white void.
    assert.match(js, /Date\.now\(\) - started < 8000/);
  });

  it('service worker times out hung HTML navigations', () => {
    const sw = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8');
    assert.match(sw, /adhello-pwa-v1\.0\.674/);
    assert.match(sw, /AbortController/);
    assert.match(sw, /28000/);
    assert.match(sw, /offline\.html/);
  });
});
