const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');

test('mobile menu does not use full-screen backdrop-blur (kills mid-range phones)', () => {
  const html = fs.readFileSync(path.join(root, 'views/partials/navbar.ejs'), 'utf8');
  const menuAt = html.indexOf('id="mobileMenu"');
  assert.ok(menuAt > -1);
  const chunk = html.slice(menuAt, menuAt + 280);
  assert.match(chunk, /bg-black\/45|bg-black\/50/);
  assert.doesNotMatch(chunk, /backdrop-blur/);
});

test('nav shell closes menu instantly and shows progress on leave', () => {
  const js = fs.readFileSync(path.join(root, 'public/js/navbar-shell.js'), 'utf8');
  assert.match(js, /function clearNavOverlaysForLeave/);
  assert.match(js, /closeMobileMenu\(\{\s*instant:\s*true\s*\}\)/);
  assert.match(js, /showNavLoading/);
  assert.match(js, /adhelloNavLoading/);
  assert.match(js, /adhello-nav-bottom-bar/);
  assert.match(js, /backdrop-filter',\s*'none'/);
  // Never hijack link clicks or opaque-blank the page — that stuck iOS.
  assert.doesNotMatch(js, /adhello-navigating/);
  assert.doesNotMatch(js, /function leaveToUrl/);
  assert.doesNotMatch(js, /location\.assign/);
  assert.doesNotMatch(js, /adhello-nav-radiant/);
  const css = fs.readFileSync(path.join(root, 'public/css/custom.css'), 'utf8');
  assert.doesNotMatch(css, /adhello-navigating/);
  assert.doesNotMatch(css, /adhello-nav-radiant/);
  assert.match(css, /#adhelloNavLoading/);
  assert.match(css, /adhello-nav-bottom-bar/);
  assert.match(css, /adhello-nav-bottom-bar-slide/);
});

test('prospecting folders tab skips unused lead JSON and Drive OAuth', () => {
  const route = fs.readFileSync(path.join(root, 'routes/prospecting.js'), 'utf8');
  assert.match(route, /needPipelineDecorate = safeTab === 'pipeline'/);
  assert.match(route, /folderListLeads = \[\]/);
  assert.match(route, /queueListLeads = \[\]/);
  assert.match(route, /needPipelineDecorate \? buildDriveImportBundle/);
});
