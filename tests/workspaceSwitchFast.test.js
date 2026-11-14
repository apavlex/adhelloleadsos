const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.APP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-switch-fast-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/database');

test('workspace switch warms leads and skips chrome extras', () => {
  const switchSrc = fs.readFileSync(path.join(__dirname, '../routes/workspaces.js'), 'utf8');
  assert.match(switchSrc, /router\.post\('\/switch'/);
  assert.match(switchSrc, /void dbService\.getAllLeads\(raw\)\.catch/);
  assert.match(switchSrc, /router\.get\('\/open'/);
  assert.match(switchSrc, /countLeadsListInflight/);
  assert.match(switchSrc, /skipped: true/);

  const mw = fs.readFileSync(path.join(__dirname, '../middleware/withWorkspace.js'), 'utf8');
  assert.match(mw, /workspaceSwitchFastPath/);
  assert.match(mw, /htmlNavFastPath/);
  assert.match(mw, /seoLightFastPath/);
  assert.match(mw, /skipChromeExtras/);
  assert.match(mw, /warmSwitcherCache/);
  assert.match(mw, /\/workspaces\/switch/);
  // 1.0.697 broke menus by skipping script seed on every HTML hop — must stay tied to dial/switch only.
  assert.match(mw, /Do NOT skip script seeding/);
  assert.match(
    mw,
    /const skipChromeExtras = telephonyFastPath \|\| workspaceSwitchFastPath;/
  );
  // 1.0.698 awaited seed on HTML and could 502 — background kick instead.
  assert.match(mw, /_scriptSeedKick/);
  assert.match(mw, /background script seed failed/);
  // 1.0.700: Reviews/Q&A inbox.json must share the same non-blocking chrome as HTML.
  assert.match(mw, /appJsonFastPath/);
  assert.match(mw, /const navFastPath = htmlNavFastPath \|\| appJsonFastPath;/);

  const shell = fs.readFileSync(path.join(__dirname, '../public/js/sidebarShell.js'), 'utf8');
  assert.match(shell, /Switching…/);
  assert.match(shell, /markWorkspaceSwitchBusy/);
  assert.match(shell, /clearWorkspaceSwitchBusy/);
  assert.match(shell, /warmOneWorkspace/);
  assert.match(shell, /hydrateSwitcherList/);
  assert.match(shell, /\/workspaces\/switcher\.json/);
  assert.doesNotMatch(shell, /warmSwitcherWorkspaces/);
  assert.match(shell, /getAttribute\('action'\) !== '\/workspaces\/switch'/);

  const nav = fs.readFileSync(path.join(__dirname, '../views/partials/navbar.ejs'), 'utf8');
  assert.match(nav, /sidebarShell\.js\?v=sidebar13/);

  // 1.0.748+: never await switcher build on nav/inbox hops (747's 400ms race re-froze hydrate).
  assert.doesNotMatch(mw, /Promise\.race/);
  assert.match(mw, /Cache-only on HTML/);
  assert.match(mw, /isLightInboxHop/);
  assert.match(mw, /countSwitcherInflight/);
  // 1.0.754+: all HTML/json nav hops skip ensureWorkspaceAndMember.
  assert.match(mw, /if \(!navFastPath\)/);
  assert.match(mw, /ensureWorkspaceAndMember/);
  assert.match(switchSrc, /router\.get\('\/switcher\.json'/);
  assert.match(switchSrc, /warmSwitcherCache/);
  assert.match(switchSrc, /countLeadsListInflight/);
  assert.doesNotMatch(shell, /requestIdleCallback/);
});

test('concurrent getAllLeads cold loads share one in-flight scan', async () => {
  const coldWid = 'ws_switch_inflight_cold';
  await dbService.putStorageKey('lead:7101', { title: 'Cold one', workspaceId: coldWid });
  await dbService.putStorageKey('lead:7102', { title: 'Cold two', workspaceId: coldWid });

  const [a, b] = await Promise.all([dbService.getAllLeads(coldWid), dbService.getAllLeads(coldWid)]);
  assert.deepEqual(
    a.map((l) => l.key),
    b.map((l) => l.key),
  );
  assert.deepEqual(
    a.map((l) => l.key).sort(),
    ['lead:7101', 'lead:7102'],
  );
  const again = await dbService.getAllLeads(coldWid);
  assert.equal(again.length, 2);
});

test('countLeadsListInflight reports active cold scans', async () => {
  assert.equal(typeof dbService.countLeadsListInflight(), 'number');
});
