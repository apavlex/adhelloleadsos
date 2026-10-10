/**
 * Guards the Get the app menu label + Share control regressions:
 * - CTA label must use an explicit dark color (not inherit → white-on-white in the drawer)
 * - Share on /get-app must be a button wired for navigator.share, not an <a href="/today">
 * - Sidebar "Get the app" navigates to /get-app (no data-get-app-share intercept)
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('Get the app menu + Share', () => {
  it('CTA styles use an explicit text color, not inherit', () => {
    const css = read('public/css/custom.css');
    const blocks = css.match(/\.sidebar-nav-link\.sidebar-nav-cta\s*\{[^}]+\}/g) || [];
    const colorBlock = blocks.find((b) => /color\s*:/.test(b));
    assert.ok(colorBlock, 'expected .sidebar-nav-link.sidebar-nav-cta color rule');
    assert.match(colorBlock, /color:\s*(var\(--ghl-sidebar-text-strong|#111827)/);
    assert.doesNotMatch(colorBlock, /color:\s*inherit/);

    const shell = read('views/partials/app_shell_styles.ejs');
    const shellBlocks = shell.match(/\.sidebar-nav-link\.sidebar-nav-cta\s*\{[^}]+\}/g) || [];
    const shellColor = shellBlocks.find((b) => /color\s*:/.test(b));
    assert.ok(shellColor, 'expected app_shell_styles CTA color rule');
    assert.match(shellColor, /color:\s*#111827/);
    assert.doesNotMatch(shellColor, /color:\s*inherit/);
  });

  it('Share control is a button that never links to /today', () => {
    const page = read('views/get_app.ejs');
    assert.match(page, /data-get-app-share/);
    assert.match(page, /<button[\s\S]*data-get-app-share/);
    assert.doesNotMatch(page, /<a[\s\S]*data-get-app-share/);
  });

  it('sidebar Get the app links navigate to /get-app without share intercept', () => {
    const sidebar = read('views/partials/app_sidebar.ejs');
    const mobile = read('views/partials/navbar.ejs');
    assert.match(sidebar, /href="\/get-app"/);
    assert.match(mobile, /href="\/get-app"/);
    assert.doesNotMatch(sidebar, /data-get-app-share/);
    const idx = mobile.indexOf('href="/get-app"');
    assert.ok(idx >= 0, 'expected mobile Get the app link');
    const mobileCta = mobile.slice(idx, idx + 500);
    assert.match(mobileCta, /Get the app/);
    assert.doesNotMatch(mobileCta, /data-get-app-share/);
  });

  it('share click handler always preventDefault and does not early-return before it', () => {
    const js = read('public/js/navbar-shell.js');
    const start = js.indexOf("closest('[data-get-app-share]')");
    assert.ok(start > 0, 'expected share click handler');
    const snippet = js.slice(start, start + 1200);
    assert.match(snippet, /e\.preventDefault\(\)/);
    const beforePrevent = snippet.slice(0, snippet.indexOf('e.preventDefault()'));
    assert.doesNotMatch(beforePrevent, /navigator\.share/);
  });
});
