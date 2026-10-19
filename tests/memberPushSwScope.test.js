/**
 * Reviews / member and contractor portal must not share the workspace /sw.js
 * push worker — that made Agency OS search/task alerts appear on the Reviews app.
 */
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');

test('Reviews and contractor portal register scoped service workers', () => {
  const memberPush = fs.readFileSync(path.join(root, 'public/js/member-app-push.js'), 'utf8');
  const memberBell = fs.readFileSync(path.join(root, 'public/js/member-app-notifications.js'), 'utf8');
  const portalPush = fs.readFileSync(path.join(root, 'public/js/contractor-portal-push.js'), 'utf8');
  const workspacePush = fs.readFileSync(path.join(root, 'public/js/push-alerts.js'), 'utf8');

  assert.match(memberPush, /register\('\/m\/sw\.js'/);
  assert.match(memberPush, /scope:\s*'\/m\/'/);
  assert.doesNotMatch(memberPush, /register\('\/sw\.js'/);

  assert.match(memberBell, /register\('\/m\/sw\.js'/);
  assert.match(memberBell, /scope:\s*'\/m\/'/);
  assert.doesNotMatch(memberBell, /register\('\/sw\.js'/);

  assert.match(portalPush, /register\('\/p\/sw\.js'/);
  assert.match(portalPush, /scope:\s*'\/p\/'/);
  assert.doesNotMatch(portalPush, /register\('\/sw\.js'/);

  // Workspace Agency OS keeps the root worker.
  assert.match(workspacePush, /register\('\/sw\.js'/);
});

test('scoped SW files exist and handle push', () => {
  const mSw = fs.readFileSync(path.join(root, 'public/m/sw.js'), 'utf8');
  const pSw = fs.readFileSync(path.join(root, 'public/p/sw.js'), 'utf8');
  assert.match(mSw, /addEventListener\('push'/);
  assert.match(mSw, /scoped to \/m\//i);
  assert.match(pSw, /addEventListener\('push'/);
  assert.match(pSw, /scoped to \/p\//i);
});

test('Reviews unregisters the Agency OS root worker so task reminders stop landing there', () => {
  const memberApp = fs.readFileSync(path.join(root, 'public/js/member-app.js'), 'utf8');
  const memberPush = fs.readFileSync(path.join(root, 'public/js/member-app-push.js'), 'utf8');
  assert.match(memberApp, /pathname === '\/sw\.js'/);
  assert.match(memberApp, /reg\.unregister/);
  assert.match(memberApp, /task reminders/);
  assert.match(memberPush, /dropWorkspaceWorker/);
  assert.match(memberPush, /pathname === '\/sw\.js'/);
});
