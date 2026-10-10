/**
 * Member app install modal + tab bar flush helpers (static checks).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

describe('member app install modal and tab bar', () => {
  it('CSS pins a solid tab bar flush to the bottom without translucent blur', () => {
    const css = fs.readFileSync(path.join(root, 'public/css/member-app.css'), 'utf8');
    assert.match(css, /html\s*\{[^}]*background:\s*var\(--card\)/s);
    assert.match(css, /\.ma-tabbar\s*\{[^}]*bottom:\s*0/s);
    assert.match(css, /\.ma-tabbar\s*\{[^}]*background:\s*var\(--card\)/s);
    assert.match(css, /\.ma-tabbar::after\s*\{[^}]*height:\s*120px/s);
    assert.doesNotMatch(css, /\.ma-tabbar\s*\{[^}]*backdrop-filter:\s*saturate/s);
  });

  it('tabbar partial includes install modal with workspace + browser panels', () => {
    const html = fs.readFileSync(path.join(root, 'views/member_app/_tabbar.ejs'), 'utf8');
    assert.match(html, /ma-install-modal/);
    assert.match(html, /data-ma-install-panel="workspace"/);
    assert.match(html, /data-ma-install-panel="browser-ios"/);
    assert.match(html, /data-ma-install-panel="browser-android"/);
    assert.match(html, /data-ma-install-copy/);
    assert.match(html, /data-ma-install-share/);
    assert.doesNotMatch(html, /class="ma-install"/);
  });

  it('settings profile exposes Install open control (not the top bar)', () => {
    const top = fs.readFileSync(path.join(root, 'views/member_app/_top.ejs'), 'utf8');
    assert.doesNotMatch(top, /data-ma-install-open/);
    const profile = fs.readFileSync(path.join(root, 'views/member_app/profile.ejs'), 'utf8');
    assert.match(profile, /data-ma-install-open/);
    assert.match(profile, /Save as a phone app/);
  });

  it('settings row icons stay compact', () => {
    const css = fs.readFileSync(path.join(root, 'public/css/member-app.css'), 'utf8');
    assert.match(css, /\.ma-settings-row__icon\s*\{[^}]*width:\s*28px/s);
    assert.match(css, /\.ma-settings-row__icon svg\s*\{[^}]*width:\s*14px/s);
  });

  it('member-app.js shows install guidance inside workspace standalone shells', () => {
    const js = fs.readFileSync(path.join(root, 'public/js/member-app.js'), 'utf8');
    assert.match(js, /fromWorkspaceShell/);
    assert.match(js, /memberPwa/);
    assert.match(js, /source'\) === 'pwa'/);
    assert.match(js, /data-ma-install-open/);
    assert.match(js, /showPanel\('workspace'\)/);
    // Must not skip the modal solely because display-mode is standalone.
    assert.doesNotMatch(js, /isIOS && !standalone && !dismissed/);
  });
});
