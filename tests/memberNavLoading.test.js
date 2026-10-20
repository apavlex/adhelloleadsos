/**
 * Reviews app: centered loading motion while a contact / in-app page is opening.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

describe('memberNavLoading', () => {
  it('ships a centered nav loader for Reviews in-app navigations', () => {
    const js = fs.readFileSync(path.join(root, 'public/js/member-app.js'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'public/css/member-app.css'), 'utf8');
    const head = fs.readFileSync(path.join(root, 'views/member_app/_head.ejs'), 'utf8');

    assert.match(js, /function showMaNavLoading/);
    assert.match(js, /function hideMaNavLoading/);
    assert.match(js, /maNavLoading/);
    assert.match(js, /ma-nav-loader/);
    assert.match(js, /pageshow/);
    assert.match(css, /#maNavLoading/);
    assert.match(css, /ma-nav-loader-spin/);
    assert.match(head, /#maNavLoading/);
  });
});
