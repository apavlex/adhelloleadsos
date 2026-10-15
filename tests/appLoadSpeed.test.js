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
  assert.match(js, /showNavProgress/);
  assert.match(js, /backdrop-filter',\s*'none'/);
  assert.match(js, /adhello-navigating/);
  assert.match(js, /function leaveToUrl/);
  assert.match(js, /_failSafe/);
  const leaveFn = js.slice(js.indexOf('function leaveToUrl'), js.indexOf('function leaveToUrl') + 700);
  assert.match(leaveFn, /location\.assign/);
  // Must stay synchronous with the tap — deferred assign blanks iOS on the wash.
  assert.doesNotMatch(leaveFn, /requestAnimationFrame/);
  assert.doesNotMatch(leaveFn, /setTimeout\(\s*go/);
  const css = fs.readFileSync(path.join(root, 'public/css/custom.css'), 'utf8');
  assert.match(css, /html\.adhello-navigating::before/);
});

test('prospecting folders tab skips unused lead JSON and Drive OAuth', () => {
  const route = fs.readFileSync(path.join(root, 'routes/prospecting.js'), 'utf8');
  assert.match(route, /needPipelineDecorate = safeTab === 'pipeline'/);
  assert.match(route, /folderListLeads = \[\]/);
  assert.match(route, /queueListLeads = \[\]/);
  assert.match(route, /needPipelineDecorate \? buildDriveImportBundle/);
});
