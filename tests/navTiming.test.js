const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const navTimingStore = require('../lib/navTimingStore');

const root = path.join(__dirname, '..');

test('nav timing store summarizes slow hops', () => {
  navTimingStore.push({
    path: '/business-reviews',
    from: '/today',
    clickToPageshowMs: 400,
    clickToHydrateMs: 900,
    version: '1.0.766',
  });
  navTimingStore.push({
    path: '/sequences',
    from: '/today',
    clickToPageshowMs: 2200,
    clickToHydrateMs: 5000,
    version: '1.0.766',
  });
  const sum = navTimingStore.summary(20);
  assert.equal(sum.thresholds.pageshowPassMs, 1500);
  assert.equal(sum.thresholds.hydratePassMs, 4000);
  assert.ok(sum.paths.some((p) => p.path === '/sequences' && p.slowPageshow >= 1));
});

test('nav timing route and client reporter are wired', () => {
  const route = fs.readFileSync(path.join(root, 'routes/navTiming.js'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const shell = fs.readFileSync(path.join(root, 'public/js/navbar-shell.js'), 'utf8');
  const head = fs.readFileSync(path.join(root, 'views/partials/head.ejs'), 'utf8');
  assert.match(route, /nav-timing\.json/);
  assert.match(route, /nav-timing\/recent\.json/);
  assert.match(server, /routes\/navTiming/);
  assert.match(shell, /markNavLeave/);
  assert.match(shell, /reportNavPageshow/);
  assert.match(shell, /reportNavHydrate/);
  assert.match(shell, /adhello:inbox-hydrated/);
  assert.match(head, /data-app-version/);
});
